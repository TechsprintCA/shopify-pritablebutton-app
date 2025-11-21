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
          await processDigitalProductOrder(payload, shop, webhookId);
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
async function processDigitalProductOrder(orderPayload, shopDomain, webhookId) {
  try {
    console.log(`Processing digital products for order ${orderPayload.id} from ${shopDomain}`);

    // Check if order has already been processed
    const existingOrder = await db.query(`
      SELECT id, order_id, order_number, processed_at 
      FROM orders 
      WHERE shop_domain = $1 AND order_id = $2
    `, [shopDomain, orderPayload.id]);

    if (existingOrder.rows.length > 0) {
      const processedOrder = existingOrder.rows[0];
      console.log(`🔄 Order ${orderPayload.id} (number: ${orderPayload.order_number}) already processed at ${processedOrder.processed_at}. Skipping duplicate processing.`);
      return;
    }

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
          // Get product details (title and image) from Shopify API
          let productTitle = item.title;
          let productImageUrl = null;
          try {
            const { default: shopifyApp } = await import('./shopify.js');
            const offlineId = shopifyApp.api.session.getOfflineId(shopDomain);
            const session = await shopifyApp.config.sessionStorage.loadSession(offlineId);
            if (session) {
              const productDetails = await getProductDetailsFromAPI(productGid, session);
              productTitle = productDetails.title || item.title || `Product ${item.product_id}`;
              productImageUrl = productDetails.image_url;
            }
          } catch (error) {
            console.error(`Error getting product details for ${item.product_id}:`, error);
            productTitle = item.title || `Product ${item.product_id}`;
          }
          
          digitalProducts.push({
            id: item.product_id,
            gid: productGid,
            title: productTitle,
            pdf_url: pdfUrl,
            image_url: productImageUrl,
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
        shopDomain,
        product.image_url
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

    // Record the order as processed to prevent duplicate processing
    await db.query(`
      INSERT INTO orders (shop_domain, order_id, order_number, customer_email, webhook_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (shop_domain, order_id) DO NOTHING
    `, [
      shopDomain, 
      orderPayload.id, 
      orderPayload.order_number, 
      customerEmail,
      webhookId || null
    ]);

    console.log(`✅ Order ${orderPayload.id} (number: ${orderPayload.order_number}) processing completed and recorded.`);

  } catch (error) {
    console.error('Error processing digital product order:', error);
  }
}

// Send email for multiple digital products
async function sendMultipleProductsEmail(customerEmail, customerName, products, shopDomain) {
  try {
    // Create product showcase cards for each product
    const productShowcaseHtml = products.map(product => {
      const imageUrl = product.image_url || 'https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-10-30_123528.png?v=1761809763';
      return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="80%" cellpadding="0" cellspacing="0" border="0" class="product-showcase" style="width: 80%; max-width: 900px; background: #63BDE6; border-radius: 30px; overflow: hidden;">
              <tr>
                <td style="padding: 35px 25px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <!-- Left Column: Product Image -->
                      <td class="product-image" width="45%" valign="middle" style=" padding-right: 15px;">
                        <img src="${imageUrl}" alt="${product.title}" style="margin: 0 auto; width: 100%; max-width: 250px; display: block; height: auto; border-radius: 20px;" />
                      </td>
                      <!-- Right Column: Product Info -->
                      <td class="product-info" width="55%" valign="middle" align="center" style="padding-left: 15px;">
                        <table cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td align="center" style="padding-bottom: 12px;">
                              <h3 style="font-family: Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 800; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">${product.title}</h3>
                            </td>
                          </tr>
                          <tr>
                            <td align="center" style="padding-bottom: 20px;">
                              <p class="product-description" style="font-family: Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 400; color: #ffffff; margin: 0; padding: 0 5px; line-height: 1.4; opacity: 0.95; text-align: center;">High-quality digital content, ready for instant download</p>
                            </td>
                          </tr>
                          <tr>
                            <td align="center" style="text-align: center;">
                              <!--[if mso]>
                              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${product.pdf_url}" style="height:50px;v-text-anchor:middle;width:200px;" arcsize="20%" stroke="f" fillcolor="#e7635c">
                              <w:anchorlock/>
                              <center>
                              <![endif]-->
                              <a href="${product.pdf_url}" class="button primary-button button-arrow" style="font-family: Helvetica, Arial, sans-serif; display: inline-block; text-decoration: none; text-align: center;">
                                <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                                  <tr>
                                    <td align="center" style="text-align: center;">
                                      <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/image-removebg-preview_4.png?v=1762176633" alt="Download" width="20" height="20" style="display: inline-block; vertical-align: middle; margin-right: 8px;" />
                                      <span style="font-size: 20px; font-weight: 700; vertical-align: middle; color:#fff">Download Now</span>
                                    </td>
                                  </tr>
                                </table>
                              </a>
                              <!--[if mso]>
                              </center>
                              </v:roundrect>
                              <![endif]-->
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
    }).join('');

    const productListText = products.map(product => `- ${product.title}: ${product.pdf_url}`).join('\n');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Downloads are Ready!</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap');
        * {
            margin: 0;
            padding: 0;
            font-family: Helvetica, sans-serif;
        }
        .button {
            border-radius: 10px;
            background: #eea527;
            display: inline-block;
            padding: 10px 20px;
            color: #fff;
            transition: all 0.25s;
            font-weight: bold;
            font-size: 18px;
        }

        .primary-button {
            background-color: #e7635c;
            border-color:rgb(232, 163, 159);
            border-width: 5px;
            border-style: solid;
            text-decoration: none;
        }
        .primary-button:hover {
            background-color: #d5807b;
        }
        .button-arrow {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
            gap: 15px;
        }
        .button-arrow svg {
            max-width: 25px;
            min-width: 25px;
        }

        @media (min-width: 1501px) {
            .button {
                font-size: 24px;
            }
        }
        @media (max-width: 540px) {
            .button {
                font-size: 18px;
                padding: 5px 10px;
            }
        }
        @media screen and (max-width: 768px) {
            .button-arrow svg {
                max-width: 15px;
                min-width: 15px;
            }
        }

        /* Section 1 - Hero Responsive */
        .hero-section {
            background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-10-30_113947.png?v=1761808148);
            background-size: cover;
            background-repeat: no-repeat;
            background-position: center;
        }

        /* Mobile Screens - Gmail Compatible */
        @media only screen and (max-width: 600px), only screen and (max-device-width: 600px) {
            /* Prevent auto-scaling */
            * {
                -webkit-text-size-adjust: none !important;
                -ms-text-size-adjust: none !important;
            }
            
            /* Text sizes - multiple selectors for Gmail */
            h1, h1[style] {
                font-size: 28px !important;
                line-height: 1.3 !important;
            }
            h2, h2[style] {
                font-size: 26px !important;
                line-height: 1.3 !important;
            }
            h3, h3[style] {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            p, p[style] {
                font-size: 16px !important;
                line-height: 1.5 !important;
            }
            
            /* Table widths */
            table[width="600"] {
                width: 100% !important;
            }
            
            /* Hero section */
            .hero-section {
                background-image: url(https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-03_230722.png?v=1762193415) !important;
                background-size: contain !important;
            }
            
            /* Product showcase */
            .product-showcase {
                border-radius: 20px !important;
                width: 95% !important;
            }
            .product-image,
            .product-info {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
            }
            .product-image {
                padding-bottom: 20px !important;
                text-align: center !important;
            }
            .product-image img {
                max-width: 200px !important;
                width: 200px !important;
                height: auto !important;
                margin: 0 auto !important;
            }
            
            /* Product description - more specific */
            .product-description, 
            .product-description[style],
            td .product-description {
                font-size: 15px !important;
                padding: 0 10px !important;
                line-height: 1.4 !important;
            }
            
            /* Button text - more specific */
            .button-arrow span,
            .button-arrow span[style],
            a span[style*="font-size"] {
                font-size: 18px !important;
            }
            
            /* Button icon */
            .button-arrow img {
                width: 18px !important;
                height: 18px !important;
            }
            
            /* Section 4 - Info columns */
            .info-section {
                width: 100% !important;
            }
            .info-column {
                display: block !important;
                width: 100% !important;
                padding: 0 !important;
                margin-bottom: 0 !important;
            }
            .divider-vertical {
                display: none !important;
            }
            .divider-horizontal {
                display: table !important;
                width: 100% !important;
            }
            
            /* Adjust list font size */
            ul, ul li {
                font-size: 16px !important;
            }
            
            /* Section 5 - CTA */
            .cta-section {
                width: 95% !important;
                padding: 40px 25px !important;
                border-radius: 25px !important;
            }
            .cta-description {
                font-size: 16px !important;
            }
            .cta-button {
                font-size: 20px !important;
                padding: 15px 35px !important;
            }
            
            /* Section 6 - Notice */
            .notice-section {
                width: 95% !important;
            }
            .collage-image {
                max-width: 100% !important;
            }
            .notice-text {
                font-size: 20px !important;
            }
            table[style*="background-color: #e4a947"] {
                padding: 20px 25px !important;
                border-radius: 15px !important;
            }
            /* Reduce outer padding for Section 6 */
            table[style*="padding: 50px 20px"]:last-of-type {
                padding: 30px 15px !important;
            }
            
            /* Colorful Border - Force Full Width on Mobile */
            .color-border {
                width: 100% !important;
                min-width: 100% !important;
            }
            .color-border td {
                display: table-cell !important;
                width: 20% !important;
                min-width: 20% !important;
            }
        }
    </style>
</head>
<body>
    <!-- Section 1: Hero - Download Ready -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="hero-section" style="background-color: #ffffff; padding: 30px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding-bottom: 20px;">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/E_Website_About_Page_7DP_2_2_copy-04.jpg?v=1761755674" alt="Download Ready" style="width: 100px; height: 100px; display: block;" />
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/7DaysofPlay_LogoV_940_2.png?v=1753886883" alt="7 Days of Play" style="width: 400px; max-width: 100%; height: auto; display: block;" />
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Section 2: Greeting Message -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding-bottom: 20px;">
                            <h2 style="font-family: Helvetica, Arial, sans-serif; font-size: 42px; font-weight: 800; color: #c55899; margin: 0; padding: 0; line-height: 1.2;">Hi ${customerName || 'Valued Customer'},</h2>
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <p style="font-family: Helvetica, Arial, sans-serif; font-size: 24px; font-weight: 400; color: #000000; margin: 0; padding: 0; line-height: 1.5;">Your ${products.length} printables are ready! 🎉 Can't wait for you to start using them — thank you for supporting 7 Days of Play.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 3: Product Showcases (Multiple) -->
    ${productShowcaseHtml}
    
    <!-- Section 4: What's Included & Need Help -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="75%" cellpadding="0" cellspacing="0" border="0" class="info-section" style="width: 75%; max-width: 850px;">
                    <tr>
                        <!-- Left Column: What's Included -->
                        <td class="info-column" width="48%" valign="top" style="padding: 0 20px 0 0;">
                            <h3 style="font-family: Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 800; color: #c55899; margin: 0 0 20px 0; padding: 0;">What's Included:</h3>
                            <ul style="font-family: Helvetica, Arial, sans-serif; font-size: 18px; color: #000000; margin: 0; padding: 0 0 0 20px; line-height: 1.2;">
                                <li style="margin-bottom: 10px;">Instant download access</li>
                                <li style="margin-bottom: 10px;">High-quality PDF format</li>
                                <li style="margin-bottom: 10px;">Access anytime through your account or this email</li>
                                <li style="margin-bottom: 10px;">Mobile and desktop compatible</li>
                            </ul>
                            <!-- Horizontal Divider (Mobile only - shows between sections) -->
                            <table class="divider-horizontal" width="100%" cellpadding="0" cellspacing="0" border="0" style="display: none; margin: 30px 0;">
                                <tr>
                                    <td style="border-top: 3px solid #c55899;"></td>
                                </tr>
                            </table>
                        </td>
                        
                        <!-- Vertical Divider (Desktop only) -->
                        <td class="divider-vertical" width="4%" style="border-left: 3px solid #c55899; height: 200px;"></td>
                        
                        <!-- Right Column: Need Help -->
                        <td class="info-column" width="48%" valign="top" style="padding: 0 0 0 20px;">
                            <h3 style="font-family: Helvetica, Arial, sans-serif; font-size: 32px; font-weight: 800; color: #c55899; margin: 0 0 20px 0; padding: 0;">Need Help?</h3>
                            <p style="font-family: Helvetica, Arial, sans-serif; font-size: 18px; color: #000000; margin: 0; padding: 0; line-height: 1.2;">If you have any questions or issues with your download, please don't hesitate to contact our support team.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Colorful Border -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
        <tr>
            <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
        </tr>
    </table>
    
    <!-- Section 5: All-Access Pass CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="cta-section" style="width: 80%; max-width: 900px; background: #C5579A; border-radius: 40px; padding: 50px 40px;">
                    <tr>
                        <td align="center">
                            <!-- Star Icon -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 30px;">
                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/star-circel.png?v=1755514449" alt="Star" style="width: 80px; height: 80px; display: block;" />
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Heading -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="padding-bottom: 20px;">
                                        <h2 style="font-family: Helvetica, Arial, sans-serif; font-size: 48px; font-weight: 800; color: #ffffff; margin: 0; padding: 0; line-height: 1.2; text-align: center;">Try the All-Access Pass</h2>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Subheading -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 10px;">
                                        <p style="font-family: Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.5; text-align: center;">Love printables like this?<br/>Unlock hundreds of printables with the All-Access Pass!</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Description -->
                            <table cellpadding="0" cellspacing="0" border="0" style="max-width: 700px;">
                                <tr>
                                    <td align="center" style="padding-bottom: 35px;">
                                        <p class="cta-description" style="font-family: Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 400; color: #ffffff; margin: 0; padding: 0; line-height: 1.6; text-align: center; opacity: 0.95;">Enjoy unlimited access to every printable in our library — plus new releases designed to make playtime fun, easy, and educational.</p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- CTA Button -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://shop.7daysofplay.com/products/all-access-pass" style="height:60px;v-text-anchor:middle;width:350px;" arcsize="20%" stroke="f" fillcolor="#f5a623">
                                        <w:anchorlock/>
                                        <center>
                                        <![endif]-->
                                        <a href="https://shop.7daysofplay.com/products/all-access-pass" class="button primary-button" style="font-family: Helvetica, Arial, sans-serif; background: #eea527; border-color: #ffdca9; text-decoration: none; text-align: center; color: #fff;">
                                            Explore the All-Access Pass
                                        </a>
                                        <!--[if mso]>
                                        </center>
                                        </v:roundrect>
                                        <![endif]-->
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    
    <!-- Section 6: Product Showcase & Save Email Notice -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
        <tr>
            <td align="center">
                <table width="80%" cellpadding="0" cellspacing="0" border="0" class="notice-section" style="width: 80%; max-width: 900px;">
                    <tr>
                        <td align="center">
                            <!-- Product Collage Image -->
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center">
                                        <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/Screenshot_2025-11-03_213254.png?v=1762187594" alt="Printables" class="collage-image" style="width: 100%; max-width: 900px; height: auto; display: block;" />
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Notice Box -->
                            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                                <tr>
                                    <td align="center" style="background-color: #e4a947; border-radius: 20px; padding: 30px 40px;">
                                        <p class="notice-text" style="font-family: Helvetica, Arial, sans-serif; font-size: 19px; font-weight: 600; color: #ffffff; margin: 0; padding: 0; line-height: 1.4; text-align: center;">Important: Save this email to easily re-download your files anytime.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
            <!-- Colorful Border -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" class="color-border" role="presentation" style="width: 100%; min-width: 100%; table-layout: fixed;">
            <tr>
                <td width="20%" style="background-color: #7bbae0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
                <td width="20%" style="background-color: #e4a947; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
                <td width="20%" style="background-color: #c55899; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
                <td width="20%" style="background-color: #d86b61; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
                <td width="20%" style="background-color: #8877b0; height: 8px; line-height: 8px; font-size: 8px; mso-line-height-rule: exactly; width: 20%;">&nbsp;</td>
            </tr>
        </table>
        
        <!-- Footer: Social Media -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; padding: 50px 20px;">
            <tr>
                <td align="center">
                    <table width="80%" cellpadding="0" cellspacing="0" border="0" class="footer-section" style="width: 80%; max-width: 800px;">
                        <!-- Follow Us Text -->
                        <tr>
                            <td align="center" style="padding-bottom: 30px;">
                                <h3 style="font-family: 'Urbanist', Arial, sans-serif; font-size: 30px; font-weight: lighter; color: #0A0B09; margin: 0; padding: 0; text-align: center;">Follow Us @7daysofplay for Activity Ideas</h3>
                            </td>
                        </tr>
                        
                        <!-- Social Media Icons -->
                        <tr>
                            <td align="center">
                                <table cellpadding="0" cellspacing="0" border="0" class="social-icons-table" style="display: inline-block;">
                                    <tr>
                                        <!-- Instagram -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://instagram.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/insta.png?v=1762256655" alt="Instagram" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                        
                                        <!-- TikTok -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://www.tiktok.com/@7daysofplay" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/tiktok_3.png?v=1762256654" alt="TikTok" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                        
                                        <!-- Facebook -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://facebook.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/facebook_1.png?v=1762256654" alt="Facebook" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                        
                                        <!-- Snapchat -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://www.snapchat.com/@sevendaysofplay" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/snapchat.png?v=1762256654" alt="Snapchat" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                        
                                        <!-- YouTube -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://youtube.com/7daysofplayshorts" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/youtube.png?v=1762256654" alt="YouTube" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                        
                                        <!-- Pinterest -->
                                        <td align="center" class="social-icon-cell" style="padding: 0 8px;">
                                            <a href="https://pinterest.com/7daysofplay" target="_blank" style="text-decoration: none;">
                                                <table cellpadding="0" cellspacing="0" border="0">
                                                    <tr>
                                                        <td align="center" class="social-icon-circle" style="background-color: #63BDE6; border-radius: 50%; width: 60px; height: 60px; text-align: center; line-height: 60px;">
                                                            <img src="https://cdn.shopify.com/s/files/1/0931/6453/6129/files/pinterest.png?v=1762256655" alt="Pinterest" class="social-icon-img" width="30" height="30" style="display: inline-block; vertical-align: middle;" />
                                                        </td>
                                                    </tr>
                                                </table>
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
</body>
</html>`;

    const textContent = `Hello ${customerName || 'Valued Customer'},

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
      logger: true,    // enable transport-level logging
      debug: true,     // include SMTP-level debug output
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: customerEmail,
      sender: process.env.SMTP_USER,                         // set sender header to be explicit
      envelope: {
        from: process.env.SMTP_USER,                         // MAIL FROM (Return-Path) — important for SPF alignment
        to: customerEmail,
      },  
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

// Helper function to get product details (title and image) from Shopify
async function getProductDetailsFromAPI(productGid, session) {
  try {
    console.log(`🔍 Getting product details for: ${productGid}`);
    
    const { default: shopifyApp } = await import('./shopify.js');
    const client = new shopifyApp.api.clients.Graphql({
      session: session,
      apiVersion: ApiVersion.July25,
    });

    const productQuery = `#graphql
      query GetProductDetails($id: ID!) {
        product(id: $id) {
          id
          title
          featuredImage {
            id
            url
            altText
            width
            height
          }
          images(first: 1) {
            nodes {
              id
              url
              altText
              width
              height
            }
          }
        }
      }
    `;

    const response = await client.request(productQuery, {
      variables: { id: productGid }
    });

    const product = response?.data?.product;
    if (!product) {
      console.log(`❌ Product not found: ${productGid}`);
      return { title: null, image_url: null };
    }

    // Get image URL (prefer featured image, fallback to first image)
    let imageUrl = null;
    if (product.featuredImage && product.featuredImage.url) {
      imageUrl = product.featuredImage.url;
    } else if (product.images && product.images.nodes.length > 0) {
      imageUrl = product.images.nodes[0].url;
    }

    console.log(`📦 Product details:`, {
      id: product.id,
      title: product.title,
      hasImage: !!imageUrl
    });

    return {
      title: product.title,
      image_url: imageUrl
    };

  } catch (error) {
    console.error(`❌ Error getting product details for ${productGid}:`, error);
    return { title: null, image_url: null };
  }
}
