import { DeliveryMethod } from "@shopify/shopify-api";
import { ApiVersion } from "@shopify/shopify-api";
import db from "./db.js";
import { sendDownloadEmail } from "./emailService.js";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  ORDERS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      console.log("🔔 ORDERS_CREATE webhook received!", { 
        timestamp: new Date().toISOString(),
        shop, 
        webhookId,
        bodyLength: body?.length || 0
      });
      
      try {
        const payload = JSON.parse(body);
        console.log("📋 ORDERS_CREATE Details:", { 
          shop, 
          orderId: payload?.id, 
          orderNumber: payload?.order_number,
          webhookId,
          financial_status: payload?.financial_status,
          fulfillment_status: payload?.fulfillment_status,
          confirmed: payload?.confirmed,
          gateway: payload?.gateway,
          test: payload?.test,
          customer_email: payload?.customer?.email,
          line_items_count: payload?.line_items?.length || 0,
          total_price: payload?.total_price
        });

        // Process digital products for confirmed and paid orders
        if (payload?.confirmed && payload?.financial_status === 'paid') {
          console.log("✅ Order is confirmed and paid, processing digital products...");
          await processDigitalProductOrder(payload, shop);
        } else {
          console.log("⏳ Order not ready for processing:", {
            confirmed: payload?.confirmed,
            financial_status: payload?.financial_status,
            reason: !payload?.confirmed ? "Not confirmed" : "Not paid"
          });
        }
      } catch (e) {
        console.error("❌ ORDERS_CREATE parsing error:", e);
        console.log("📄 ORDERS_CREATE raw body:", body?.substring(0, 500) + "...");
      }
    },
  },


};

// Process digital product orders
async function processDigitalProductOrder(orderPayload, shopDomain) {
  try {
    console.log(`Processing digital products for order ${orderPayload.id} from ${shopDomain}`);

    // Extract customer information
    const customer = orderPayload.customer;
    if (!customer || !customer.email) {
      console.log('No customer email found, skipping digital product processing');
      return;
    }

    const customerEmail = customer.email;
    const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Valued Customer';
    
    // Extract line items (products) from the order
    const lineItems = orderPayload.line_items || [];
    if (lineItems.length === 0) {
      console.log('No line items found in order');
      return;
    }

    // Get digital products from our database that match the ordered products
    const digitalProducts = [];
    const productIds = [];
    const productTags = [];

    for (const item of lineItems) {
      // Only process digital products (require_shipping === false)
      if (item.product_id && item.requires_shipping === false) {
        const productGid = `gid://shopify/Product/${item.product_id}`;
        
        // Get PDF file URL from Shopify Files API
        const pdfUrl = await getProductPDFUrl(item.product_id, shopDomain);
        
        if (pdfUrl) {
          digitalProducts.push({
            id: item.product_id,
            gid: productGid,
            title: item.title || `Product ${item.product_id}`,
            pdf_url: pdfUrl,
            quantity: item.quantity
          });
          productIds.push(item.product_id.toString());
          productTags.push(item.product_id.toString());
          console.log(`✅ Found digital product with PDF: ${item.title || item.product_id} (ID: ${item.product_id})`);
          
          // Product data comes from Shopify API - no need to store in database
          console.log(`✅ Processing digital product: ${item.title || item.product_id}`);
        } else {
          console.log(`⚠️ No PDF file found for digital product: ${item.product_id}`);
        }
      } else if (item.requires_shipping === true) {
        console.log(`📦 Skipping physical product: ${item.title || item.product_id} (requires shipping)`);
      } else {
        console.log(`❓ Skipping product with unknown shipping requirement: ${item.title || item.product_id}`);
      }
    }

    if (digitalProducts.length === 0) {
      console.log('No digital products found in this order');
      return;
    }

    console.log(`🎯 Found ${digitalProducts.length} digital products in order (filtered by requires_shipping=false)`);

    // Create/update customer in our database
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    
    await db.query(`
      INSERT INTO customers (shop_domain, customer_gid, email, first_name, last_name, downloads)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (shop_domain, lower(email))
      DO UPDATE SET
        customer_gid = EXCLUDED.customer_gid,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        downloads = customers.downloads || EXCLUDED.downloads,
        updated_at = now()
    `, [
      shopDomain,
      customer.id ? `gid://shopify/Customer/${customer.id}` : null,
      customerEmail,
      firstName,
      lastName,
      productIds
    ]);

    // Get session to make GraphQL calls for customer tagging
    try {
      const { default: shopifyApp } = await import('./shopify.js');
      const offlineId = shopifyApp.api.session.getOfflineId(shopDomain);
      const session = await shopifyApp.config.sessionStorage.loadSession(offlineId);

      if (session && customer.id && productTags.length > 0) {
        const client = new shopifyApp.api.clients.Graphql({
          session: session,
          apiVersion: ApiVersion.July25,
        });

        // Add digital product ID tags to customer
        const tagsAddMutation = `#graphql
          mutation TagsAdd($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }
        `;
        
        const customerId = `gid://shopify/Customer/${customer.id}`;
        console.log(`🏷️ Adding ${productTags.length} digital product tags to customer: ${productTags.join(', ')}`);
        
        const tagResp = await client.request(tagsAddMutation, {
          variables: { id: customerId, tags: productTags }
        });
        
        const tagErrors = tagResp?.data?.tagsAdd?.userErrors || [];
        if (tagErrors.length > 0) {
          console.error('❌ Customer tag add errors:', tagErrors);
        } else {
          console.log(`✅ Added ${productTags.length} digital product tags to customer ${customerEmail}`);
        }
      }
    } catch (sessionError) {
      console.error('Failed to get session for customer tagging:', sessionError);
    }

    // Send email with all digital products
    if (digitalProducts.length === 1) {
      // Single product email
      const product = digitalProducts[0];
      const emailResult = await sendDownloadEmail(
        customerEmail,
        customerName,
        product.title,
        product.pdf_url,
        shopDomain
      );
      
      if (emailResult.success) {
        console.log(`Digital product email sent to ${customerEmail} for ${product.title}`);
      } else {
        console.error(`Failed to send email to ${customerEmail}:`, emailResult.error);
      }
    } else {
      // Multiple products email - send combined email
      await sendMultipleProductsEmail(customerEmail, customerName, digitalProducts, shopDomain);
    }

  } catch (error) {
    console.error('Error processing digital product order:', error);
  }
}

// Send email for multiple digital products
async function sendMultipleProductsEmail(customerEmail, customerName, products, shopDomain) {
  try {
    // Create download links HTML
    const productLinksHtml = products.map(product => `
      <div style="margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea;">
        <h4 style="margin: 0 0 10px 0; color: #2c3e50;">${product.title}</h4>
        <a href="${product.pdf_url}" style="display: inline-block; background: #667eea; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none; font-size: 14px;">
          📥 Download ${product.title}
        </a>
      </div>
    `).join('');

    const productListText = products.map(product => `- ${product.title}: ${product.pdf_url}`).join('\n');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Digital Downloads are Ready!</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; color: white; }
        .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 10px; }
        .header p { font-size: 16px; opacity: 0.9; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 18px; color: #2c3e50; margin-bottom: 20px; }
        .products { margin: 30px 0; }
        .footer { background: #2c3e50; color: #ecf0f1; padding: 30px; text-align: center; }
        @media (max-width: 600px) { .container { margin: 10px; border-radius: 8px; } .header, .content, .footer { padding: 20px; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Your Downloads are Ready!</h1>
            <p>All your digital products are now available</p>
        </div>
        <div class="content">
            <div class="greeting">Hello ${customerName},</div>
            <p>Thank you for your purchase! Your ${products.length} digital products are now ready for download.</p>
            <div class="products">
                <h3 style="color: #2c3e50; margin-bottom: 20px;">Your Digital Products:</h3>
                ${productLinksHtml}
            </div>
            <p><strong>Important:</strong> Please save this email for your records. You can use these download links anytime to access your purchases.</p>
            <p>Thank you for choosing us!</p>
        </div>
        <div class="footer">
            <p><strong>${shopDomain}</strong></p>
            <p>© ${new Date().getFullYear()} ${shopDomain}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;

    const textContent = `Hello ${customerName},

Thank you for your purchase! Your ${products.length} digital products are now ready for download.

Your Digital Products:
${productListText}

Please save this email for your records. You can use these download links anytime to access your purchases.

Thank you for choosing ${shopDomain}!

Best regards,
${shopDomain} Team`;

    // Import nodemailer dynamically to avoid circular dependency
    const { default: nodemailer } = await import('nodemailer');
    
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      subject: `🎉 Your ${products.length} Digital Downloads are Ready!`,
      html: htmlContent,
      text: textContent
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Multiple products email sent to ${customerEmail}:`, result.messageId);
    
  } catch (error) {
    console.error(`Error sending multiple products email to ${customerEmail}:`, error);
  }
}

// Get PDF file URL from Shopify Files API for a specific product
async function getProductPDFUrl(productId, shopDomain) {
  try {
    // Get session to make GraphQL calls
    const { default: shopifyApp } = await import('./shopify.js');
    const offlineId = shopifyApp.api.session.getOfflineId(shopDomain);
    const session = await shopifyApp.config.sessionStorage.loadSession(offlineId);

    if (!session) {
      console.error(`No session found for shop: ${shopDomain}`);
      return null;
    }

    const client = new shopifyApp.api.clients.Graphql({
      session: session,
      apiVersion: ApiVersion.July25,
    });

    // Query to get product with PDF metafield
    const productQuery = `#graphql
      query GetProductPDF($id: ID!) {
        product(id: $id) {
          id
          title
          metafield(namespace: "custom", key: "download_pdf") {
            id
            key
            value
            type
          }
          metafields(first: 10) {
            nodes {
              id
              namespace
              key
              value
              type
            }
          }
        }
      }
    `;

    const productGid = `gid://shopify/Product/${productId}`;
    console.log(`🔍 Getting PDF metafield for product: ${productGid}`);

    const response = await client.request(productQuery, {
      variables: { id: productGid }
    });

    const product = response?.data?.product;
    if (!product) {
      console.log(`❌ Product not found: ${productId}`);
      return null;
    }

    console.log(`📦 Product found: ${product.title} (${product.id})`);

    // Check for the specific PDF metafield
    const pdfMetafield = product.metafield;
    if (pdfMetafield && pdfMetafield.value) {
      console.log(`✅ Found PDF metafield (custom.download_pdf):`, {
        key: pdfMetafield.key,
        type: pdfMetafield.type,
        value: pdfMetafield.value
      });

      // Handle different metafield types
      if (pdfMetafield.type === 'file_reference') {
        // Single file reference - get the file URL
        return await getFileUrlFromGid(pdfMetafield.value, session);
      } else if (pdfMetafield.type === 'list.file_reference') {
        // List of file references - parse and get the first one
        try {
          const fileGids = JSON.parse(pdfMetafield.value);
          if (fileGids.length > 0) {
            return await getFileUrlFromGid(fileGids[0], session);
          }
        } catch (e) {
          console.error('Error parsing file reference list:', e);
        }
      } else {
        // Direct URL or other format
        return pdfMetafield.value;
      }
    }

    // If custom.download_pdf not found, check all metafields for PDF-related ones
    const allMetafields = product.metafields?.nodes || [];
    console.log(`🔍 Checking ${allMetafields.length} metafields for PDF:`);
    
    allMetafields.forEach((metafield, index) => {
      console.log(`📄 Metafield ${index + 1}:`, {
        namespace: metafield.namespace,
        key: metafield.key,
        type: metafield.type,
        value: metafield.value?.substring(0, 100) + (metafield.value?.length > 100 ? '...' : '')
      });
    });

    // Look for PDF-related metafields
    const pdfMetafields = allMetafields.filter(metafield => {
      const key = metafield.key.toLowerCase();
      const namespace = metafield.namespace.toLowerCase();
      return (
        key.includes('pdf') ||
        key.includes('download') ||
        key === 'download_pdf' ||
        (namespace === 'custom' && (key.includes('pdf') || key.includes('download')))
      );
    });

    if (pdfMetafields.length > 0) {
      const selectedMetafield = pdfMetafields[0];
      console.log(`✅ Found PDF-related metafield:`, {
        namespace: selectedMetafield.namespace,
        key: selectedMetafield.key,
        type: selectedMetafield.type,
        value: selectedMetafield.value
      });

      // Handle different metafield types
      if (selectedMetafield.type === 'file_reference') {
        return await getFileUrlFromGid(selectedMetafield.value, session);
      } else if (selectedMetafield.type === 'list.file_reference') {
        try {
          const fileGids = JSON.parse(selectedMetafield.value);
          if (fileGids.length > 0) {
            return await getFileUrlFromGid(fileGids[0], session);
          }
        } catch (e) {
          console.error('Error parsing file reference list:', e);
        }
      } else {
        return selectedMetafield.value;
      }
    }

    console.log(`❌ No PDF metafield found for product ${productId}`);
    console.log(`Available metafields:`, allMetafields.map(m => `${m.namespace}.${m.key}`));
    return null;

  } catch (error) {
    console.error(`❌ Error getting PDF URL for product ${productId}:`, error);
    return null;
  }
}

// Helper function to get file URL from GID
async function getFileUrlFromGid(fileGid, session) {
  try {
    console.log(`🔍 Getting file URL for GID: ${fileGid}`);
    
    const { default: shopifyApp } = await import('./shopify.js');
    const client = new shopifyApp.api.clients.Graphql({
      session: session,
      apiVersion: ApiVersion.July25,
    });

    const fileQuery = `#graphql
      query GetFile($id: ID!) {
        node(id: $id) {
          ... on GenericFile {
            id
            url
            alt
            fileStatus
            originalFileSize
            mimeType
          }
          ... on MediaImage {
            id
            image {
              url
            }
            alt
            fileStatus
          }
        }
      }
    `;

    const response = await client.request(fileQuery, {
      variables: { id: fileGid }
    });

    const file = response?.data?.node;
    if (!file) {
      console.log(`❌ File not found for GID: ${fileGid}`);
      return null;
    }

    console.log(`📄 File details:`, {
      id: file.id,
      alt: file.alt,
      fileStatus: file.fileStatus,
      mimeType: file.mimeType,
      hasDirectUrl: !!file.url,
      hasImageUrl: !!(file.image && file.image.url)
    });

    // Get URL based on file type
    let fileUrl = null;
    if (file.url) {
      // GenericFile has direct url
      fileUrl = file.url;
    } else if (file.image && file.image.url) {
      // MediaImage has nested url
      fileUrl = file.image.url;
    }

    if (file.fileStatus === 'READY' && fileUrl) {
      console.log(`✅ File URL retrieved: ${fileUrl}`);
      return fileUrl;
    } else {
      console.warn(`⚠️ File not ready or missing URL:`, {
        fileStatus: file.fileStatus,
        hasUrl: !!fileUrl
      });
      return null;
    }

  } catch (error) {
    console.error(`❌ Error getting file URL from GID ${fileGid}:`, error);
    return null;
  }
}
