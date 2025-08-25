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
      if (item.product_id) {
        const productGid = `gid://shopify/Product/${item.product_id}`;
        
        // Check if this product exists in our digital products database
        const productResult = await db.query(
          "SELECT product_gid, title, pdf_url FROM products WHERE shop_domain = $1 AND product_gid = $2",
          [shopDomain, productGid]
        );

        if (productResult.rows.length > 0) {
          const product = productResult.rows[0];
          digitalProducts.push({
            id: item.product_id,
            gid: productGid,
            title: product.title,
            pdf_url: product.pdf_url,
            quantity: item.quantity
          });
          productIds.push(item.product_id.toString());
          productTags.push(item.product_id.toString());
        }
      }
    }

    if (digitalProducts.length === 0) {
      console.log('No digital products found in this order');
      return;
    }

    console.log(`Found ${digitalProducts.length} digital products in order`);

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

        // Add product ID tags to customer
        const tagsAddMutation = `#graphql
          mutation TagsAdd($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }
        `;
        
        const customerId = `gid://shopify/Customer/${customer.id}`;
        const tagResp = await client.request(tagsAddMutation, {
          variables: { id: customerId, tags: productTags }
        });
        
        const tagErrors = tagResp?.data?.tagsAdd?.userErrors || [];
        if (tagErrors.length > 0) {
          console.error('Customer tag add errors:', tagErrors);
        } else {
          console.log(`Added product tags to customer ${customerEmail}`);
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
