// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import db from "./db.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import OrderWebhookHandlers from "./webhooks.js";
import { sendDownloadEmail } from "./emailService.js";
import { ApiVersion } from "@shopify/shopify-api";
import dotenv from "dotenv";
dotenv.config({ path: '../.env' });

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();


const validateAuthenticatedSession = (req, res, next) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// App Proxy validator - for /data/* endpoints
const validateAppProxy = async (req, res, next) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(401).json({ error: "Shop parameter required" });
    }

    // Get the offline session for this shop to make admin API calls
    const offlineId = shopify.api.session.getOfflineId(shop);
    const session = await shopify.config.sessionStorage.loadSession(offlineId);
    
    if (!session) {
      return res.status(401).json({ error: "No session found for shop" });
    }

    // Attach session to res.locals for compatibility with existing code
    res.locals = res.locals || {};
    res.locals.shopify = { session };
    
    next();
  } catch (error) {
    console.error('App proxy validation error:', error);
    return res.status(500).json({ error: "Authentication error" });
  }
}



// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
// Combine both webhook handlers
const AllWebhookHandlers = {
  ...PrivacyWebhookHandlers,
  ...OrderWebhookHandlers,
};

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: AllWebhookHandlers })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

app.get("/data/*", validateAppProxy, async (req, res) => { 
  res.status(200).json({
    message: "Hello World"
  });
});



// MODIFIED: This route now handles multiple data endpoints based on 'action' parameter
app.post("/data/*", validateAppProxy, async (req, res) => {
  const { shop, action } = req.query;
  console.log('Free printable is working')
  if(action === "storecustomeranddownload"){
    const { name, email, product_id } = req.body;
    console.log("name, email, product_id", name, email, product_id)
    if (!name || !email || !product_id) {
      res.status(400).json({ 
        error: "Missing required fields: name, email, and product_id are required" 
      });
      return;
    }

    try {
      // Get session for GraphQL operations
      const session = res.locals?.shopify?.session;
      if (!session) {
        res.status(401).json({ error: "No valid session found" });
        return;
      }

      const client = new shopify.api.clients.Graphql({
        session: session,
        apiVersion: ApiVersion.July25,
      });

      // First, check if customer exists
      const customerSearchQuery = `#graphql
        query CustomerSearch($email: String!) {
          customers(first: 1, query: $email) {
            edges {
              node {
                id
                email
                firstName
                lastName
                emailMarketingConsent {
                  marketingState
                }
              }
            }
          }
        }
      `;

      const searchResp = await client.request(customerSearchQuery, {
        variables: { email: `email:${email}` }
      });

      let customerId = null;
      const existingCustomers = searchResp?.data?.customers?.edges || [];

      if (existingCustomers.length > 0) {
        // Customer exists, update them
        customerId = existingCustomers[0].node.id;
        console.log(`Updating existing customer: ${email}`);

        const updateMutation = `#graphql
          mutation CustomerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
                email
                firstName
                lastName
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const nameParts = name.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const updateResp = await client.request(updateMutation, {
          variables: {
            input: {
              id: customerId,
              firstName: firstName,
              lastName: lastName
            }
          }
        });

        if (updateResp?.data?.customerUpdate?.userErrors?.length > 0) {
          console.error('Customer update errors:', updateResp.data.customerUpdate.userErrors);
          res.status(500).json({ 
            error: "Failed to update customer", 
            details: updateResp.data.customerUpdate.userErrors 
          });
          return;
        }

        // Update email marketing consent via dedicated mutation
        const emailConsentMutation = `#graphql
          mutation CustomerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
            customerEmailMarketingConsentUpdate(input: $input) {
              customer {
                id
                emailMarketingConsent {
                  marketingState
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const consentResp = await client.request(emailConsentMutation, {
          variables: {
            input: {
              customerId: customerId,
              emailMarketingConsent: {
                marketingState: "SUBSCRIBED",
                marketingOptInLevel: "SINGLE_OPT_IN"
              }
            }
          }
        });

        if (consentResp?.data?.customerEmailMarketingConsentUpdate?.userErrors?.length > 0) {
          console.error('Customer email marketing consent update errors:', consentResp.data.customerEmailMarketingConsentUpdate.userErrors);
          res.status(500).json({ 
            error: "Failed to update customer marketing consent", 
            details: consentResp.data.customerEmailMarketingConsentUpdate.userErrors 
          });
          return;
        }
      } else {
        // Customer doesn't exist, create them
        console.log(`Creating new customer: ${email}`);

        const createMutation = `#graphql
          mutation CustomerCreate($input: CustomerInput!) {
            customerCreate(input: $input) {
              customer {
                id
                email
                firstName
                lastName
                emailMarketingConsent {
                  marketingState
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const nameParts = name.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const createResp = await client.request(createMutation, {
          variables: {
            input: {
              email: email,
              firstName: firstName,
              lastName: lastName,
              emailMarketingConsent: {
                marketingState: "SUBSCRIBED",
                marketingOptInLevel: "SINGLE_OPT_IN"
              }
            }
          }
        });

        if (createResp?.data?.customerCreate?.userErrors?.length > 0) {
          console.error('Customer creation errors:', createResp.data.customerCreate.userErrors);
          res.status(500).json({ 
            error: "Failed to create customer", 
            details: createResp.data.customerCreate.userErrors 
          });
          return;
        }

        customerId = createResp?.data?.customerCreate?.customer?.id;
      }

      // Ensure the customer has the product ID as a tag (idempotent)
      const productIdTag = String(product_id).replace(/[^0-9]/g, "");
      if (productIdTag) {
        const tagsAddMutation = `#graphql
          mutation TagsAdd($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors { field message }
            }
          }
        `;
        const tagResp = await client.request(tagsAddMutation, {
          variables: { id: customerId, tags: [productIdTag] }
        });
        const tagErrors = tagResp?.data?.tagsAdd?.userErrors || [];
        if (tagErrors.length > 0) {
          console.error('Customer tag add errors:', tagErrors);
          res.status(500).json({ error: "Failed to add product tag to customer", details: tagErrors });
          return;
        }
      }

      // Get PDF URL from Shopify Files API
      const numericProductId = String(product_id).replace(/[^0-9]/g, "");
      const pdfUrl = await getProductPDFUrl(numericProductId, session.shop);
      
      if (!pdfUrl) {
        res.status(404).json({ 
          error: "PDF file not found for this product", 
          product_id: product_id 
        });
        return;
      }

      const product = {
        product_gid: `gid://shopify/Product/${numericProductId}`,
        title: `Product ${numericProductId}`, // We'll get this from the order data or API if needed
        pdf_url: pdfUrl
      };

      // Store/update digital product in database
      await db.query(`
        INSERT INTO products (shop_domain, product_gid, title, is_digital)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (shop_domain, product_gid)
        DO UPDATE SET
          title = EXCLUDED.title,
          is_digital = true,
          updated_at = now()
      `, [session.shop, product.product_gid, product.title]);
      
      console.log(`💾 Stored digital product in database: ${product.title}`);

      // Store customer in our database for tracking
      await db.query(`
        INSERT INTO customers (shop_domain, customer_gid, email, first_name, last_name, downloads)
        VALUES ($1, $2, $3, $4, $5, ARRAY[$6])
        ON CONFLICT (shop_domain, lower(email)) 
        DO UPDATE SET 
          customer_gid = EXCLUDED.customer_gid,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          downloads = CASE 
            WHEN $6 = ANY(customers.downloads) THEN customers.downloads
            ELSE array_append(customers.downloads, $6)
          END,
          updated_at = now()
      `, [
        session.shop,
        customerId,
        email,
        name.trim().split(' ')[0] || '',
        name.trim().split(' ').slice(1).join(' ') || '',
        product_id
      ]);

      console.log(`Successfully processed customer ${email} for product ${product_id}`);

      // Send download email
      try {
        const emailResult = await sendDownloadEmail(
          email,
          name,
          product['title'],
          product['pdf_url'],
          session.shop
        );
        if (emailResult.success) {
          console.log(`Download email sent to ${email}`);
        } else {
          console.error(`Failed to send email to ${email}:`, emailResult.error);
        }
      } catch (emailError) {
        console.error(`Email sending error for ${email}:`, emailError);
      }

      res.status(200).json({
        success: true,
        message: "Customer created/updated, download recorded, and email sent",
        customer_id: customerId,
        product: {
          id: product['product_gid'],
          title: product['title'],
          pdf_url: product['pdf_url']
        }
      });

    } catch (error) {
      console.error('Error in storecustomeranddownload:', error);
      res.status(500).json({ 
        error: "Internal server error", 
        details: error.message 
      });
      return;
    }
  }

  if (action === "lifetime_access-download"){
    const { name, email, product_id, tags } = req.body;
    if (!name || !email || !product_id) {
      res.status(400).json({
        error: "Missing required fields: name, email, and product_id are required"
      });
      return;
    }

    // Ensure we have an admin session (loaded via validateAppProxy)
    const session = res.locals?.shopify?.session;
    if (!session) {
      res.status(401).json({ error: "No valid session found" });
      return;
    }

    // Check lifetime_access tag from provided tags
    const tagsArray = Array.isArray(tags)
      ? tags
      : (typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : []);
    const hasLifetimeAccess = tagsArray.some((t) => (t || "").toLowerCase() === "lifetime_access");
    if (!hasLifetimeAccess) {
      res.status(403).json({ error: "Customer does not have lifetime_access tag" });
      return;
    }

    try {
      // Get PDF URL from Shopify Files API
      const numericProductId = String(product_id).replace(/[^0-9]/g, "");
      const pdfUrl = await getProductPDFUrl(numericProductId, session.shop);
      
      if (!pdfUrl) {
        res.status(404).json({ 
          error: "PDF file not found for this product", 
          product_id: product_id 
        });
        return;
      }

      const product = {
        product_gid: `gid://shopify/Product/${numericProductId}`,
        title: `Product ${numericProductId}`,
        pdf_url: pdfUrl
      };

      // Store/update digital product in database
      await db.query(`
        INSERT INTO products (shop_domain, product_gid, title, is_digital)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (shop_domain, product_gid)
        DO UPDATE SET
          title = EXCLUDED.title,
          is_digital = true,
          updated_at = now()
      `, [session.shop, product.product_gid, product.title]);
      
      console.log(`💾 Stored digital product in database: ${product.title}`);

      const firstName = (name || "").trim().split(' ')[0] || '';
      const lastName = (name || "").trim().split(' ').slice(1).join(' ') || '';

      // Upsert customer with lifetime_access = true and update downloads list
      await db.query(`
        INSERT INTO customers (shop_domain, customer_gid, email, first_name, last_name, downloads, lifetime_access)
        VALUES ($1, $2, $3, $4, $5, ARRAY[$6], true)
        ON CONFLICT (shop_domain, lower(email))
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          lifetime_access = true,
          downloads = CASE
            WHEN $6 = ANY(customers.downloads) THEN customers.downloads
            ELSE array_append(customers.downloads, $6)
          END,
          updated_at = now()
      `, [
        session.shop,
        null, // customer_gid unknown in this flow
        email,
        firstName,
        lastName,
        product_id
      ]);

      // Send download email
      try {
        const emailResult = await sendDownloadEmail(
          email,
          name,
          product['title'],
          product['pdf_url'],
          session.shop
        );
        if (emailResult.success) {
          console.log(`Lifetime access download email sent to ${email}`);
        } else {
          console.error(`Failed to send email to ${email}:`, emailResult.error);
        }
      } catch (emailError) {
        console.error(`Email sending error for ${email}:`, emailError);
      }

      res.status(200).json({
        success: true,
        message: "Lifetime access verified, download recorded, and email sent",
        product: {
          id: product['product_gid'],
          title: product['title'],
          pdf_url: product['pdf_url']
        }
      });
      // console.log("Lifetime access download recorded", {
      //   success: true,
      //   message: "Lifetime access verified and download recorded",
      //   product: {
      //     id: product['product_gid'],
      //     title: product['title'],
      //     pdf_url: product['pdf_url']
      //   }
      // })
      return;
    } catch (error) {
      console.error('Error in lifetime_access-download:', error);
      res.status(500).json({ error: "Internal server error", details: error.message });
      return;
    }
  }

  if (action === "already_downloaded"){
    const { name, email, product_id, tags } = req.body;
    if (!name || !email || !product_id) {
      res.status(400).json({
        error: "Missing required fields: name, email, and product_id are required"
      });
      return;
    }

    // Ensure admin session (from validateAppProxy)
    const session = res.locals?.shopify?.session;
    if (!session) {
      res.status(401).json({ error: "No valid session found" });
      return;
    }

    // Validate that customer has a tag equal to the product_id (digits only)
    const productIdTag = String(product_id).replace(/[^0-9]/g, "");
    const tagsArray = Array.isArray(tags)
      ? tags
      : (typeof tags === "string" ? tags.split(",").map((t) => t.trim()) : []);
    const hasProductTag = tagsArray.some((t) => String(t || "").replace(/[^0-9]/g, "") === productIdTag);
    if (!hasProductTag) {
      res.status(403).json({ error: "Customer is not authorized for this product" });
      return;
    }

    try {
      // Get PDF URL from Shopify Files API
      const pdfUrl = await getProductPDFUrl(productIdTag, session.shop);
      
      if (!pdfUrl) {
        res.status(404).json({ 
          error: "PDF file not found for this product", 
          product_id: product_id 
        });
        return;
      }

      const product = {
        product_gid: `gid://shopify/Product/${productIdTag}`,
        title: `Product ${productIdTag}`,
        pdf_url: pdfUrl
      };

      // Store/update digital product in database
      await db.query(`
        INSERT INTO products (shop_domain, product_gid, title, is_digital)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (shop_domain, product_gid)
        DO UPDATE SET
          title = EXCLUDED.title,
          is_digital = true,
          updated_at = now()
      `, [session.shop, product.product_gid, product.title]);
      
      console.log(`💾 Stored digital product in database: ${product.title}`);

      // Update downloads list for this customer (upsert, idempotent append)
      const firstName = (name || "").trim().split(' ')[0] || '';
      const lastName = (name || "").trim().split(' ').slice(1).join(' ') || '';
      await db.query(`
        INSERT INTO customers (shop_domain, customer_gid, email, first_name, last_name, downloads)
        VALUES ($1, $2, $3, $4, $5, ARRAY[$6])
        ON CONFLICT (shop_domain, lower(email))
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          downloads = CASE
            WHEN $6 = ANY(customers.downloads) THEN customers.downloads
            ELSE array_append(customers.downloads, $6)
          END,
          updated_at = now()
      `, [
        session.shop,
        null, // customer_gid not used here
        email,
        firstName,
        lastName,
        product_id
      ]);

      // Send download email
      try {
        const emailResult = await sendDownloadEmail(
          email,
          name,
          product['title'],
          product['pdf_url'],
          session.shop
        );
        if (emailResult.success) {
          console.log(`Already downloaded - email sent to ${email}`);
        } else {
          console.error(`Failed to send email to ${email}:`, emailResult.error);
        }
      } catch (emailError) {
        console.error(`Email sending error for ${email}:`, emailError);
      }

      res.status(200).json({
        success: true,
        message: "Download access confirmed and email sent",
        product: {
          id: product['product_gid'],
          title: product['title'],
          pdf_url: product['pdf_url']
        }
      });
      return;
    } catch (error) {
      console.error('Error in already_downloaded:', error);
      res.status(500).json({ error: "Internal server error", details: error.message });
      return;
    }
  }

  if (action === "customer-downloads") {
    const { name, email, tags } = req.body;
    if (!name || !email) {
      res.status(400).json({
        error: "Missing required fields: name and email are required"
      });
      return;
    }

    // Ensure admin session (from validateAppProxy)
    const session = res.locals?.shopify?.session;
    if (!session) {
      res.status(401).json({ error: "No valid session found" });
      return;
    }

    try {
      console.log(`🔍 Looking up downloads for customer: ${email}`);

      // Get customer from our database
      const customerResult = await db.query(
        "SELECT * FROM customers WHERE shop_domain = $1 AND lower(email) = lower($2)",
        [session.shop, email]
      );

      if (customerResult.rows.length === 0) {
        res.status(404).json({
          error: "Customer not found",
          message: "No download history found for this email address"
        });
        return;
      }

      const customer = customerResult.rows[0];
      const downloadedProductIds = customer['downloads'] || [];
      
      console.log(`📋 Customer found: ${customer['first_name']} ${customer['last_name']}`);
      console.log(`📦 Downloaded products: ${downloadedProductIds.length} items`);

      if (downloadedProductIds.length === 0) {
        res.status(200).json({
          success: true,
          customer: {
            name: `${customer['first_name']} ${customer['last_name']}`.trim(),
            email: customer['email'],
            lifetime_access: customer['lifetime_access']
          },
          downloads: [],
          message: "No downloads found for this customer"
        });
        return;
      }

      // Get unique product IDs (filter duplicates)
      const uniqueProductIds = [...new Set(downloadedProductIds)];
      console.log(`🔍 Unique products: ${uniqueProductIds.length} (filtered from ${downloadedProductIds.length} total downloads)`);
      
      // Get product details for each unique downloaded product
      const downloadedProducts = [];
      
      for (const productId of uniqueProductIds) {
        try {
          console.log(`🔍 Getting details for product: ${productId}`);
          
          const numericProductId = String(productId).replace(/[^0-9]/g, "");
          const productGid = `gid://shopify/Product/${numericProductId}`;
          
          // Get PDF URL from metafield
          const pdfUrl = await getProductPDFUrl(productId, session.shop);
          
          // Get product details from Shopify API (title and image)
          const productDetails = await getProductDetails(productGid, session);
          
          if (pdfUrl) {
            downloadedProducts.push({
              product_id: productId,
              product_gid: productGid,
              title: productDetails.title || `Product ${productId}`,
              pdf_url: pdfUrl,
              image_url: productDetails.image_url,
              download_count: downloadedProductIds.filter(id => id === productId).length
            });
            
            console.log(`✅ Added product: ${productDetails.title || productId}`);
          } else {
            console.log(`⚠️ No PDF found for product: ${productId}`);
            // Still include it but without PDF URL
            downloadedProducts.push({
              product_id: productId,
              product_gid: productGid,
              title: productDetails.title || `Product ${productId}`,
              pdf_url: null,
              image_url: productDetails.image_url,
              download_count: downloadedProductIds.filter(id => id === productId).length,
              error: "PDF not available"
            });
          }
        } catch (error) {
          console.error(`❌ Error getting details for product ${productId}:`, error);
          downloadedProducts.push({
            product_id: productId,
            product_gid: `gid://shopify/Product/${String(productId).replace(/[^0-9]/g, "")}`,
            title: `Product ${productId}`,
            pdf_url: null,
            image_url: null,
            download_count: downloadedProductIds.filter(id => id === productId).length,
            error: "Failed to retrieve product details"
          });
        }
      }

      res.status(200).json({
        success: true,
        customer: {
          name: `${customer['first_name']} ${customer['last_name']}`.trim(),
          email: customer['email'],
          lifetime_access: customer['lifetime_access'],
          unique_products: downloadedProducts.length,
          total_downloads: downloadedProductIds.length
        },
        downloads: downloadedProducts,
        download_history: downloadedProductIds,
        message: `Found ${downloadedProducts.length} unique products from ${downloadedProductIds.length} total downloads`
      });

      console.log(`✅ Successfully retrieved ${downloadedProducts.length} downloads for ${email}`);

    } catch (error) {
      console.error('Error in customer-downloads:', error);
      res.status(500).json({ 
        error: "Internal server error", 
        details: error.message 
      });
      return;
    }
  }

})

app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });
  console.log("api",res.locals.shopify.session)
  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);
  res.status(200).send({ count: countData.data.productsCount.count });
});

// Check webhook URL
app.get("/api/webhook-url", async (_req, res) => {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://connections-florist-explained-canberra.trycloudflare.com';
  const webhookUrl = `${appUrl}/api/webhooks`;
  
  res.json({
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    HOST: process.env.HOST,
    fallbackUrl: 'https://connections-florist-explained-canberra.trycloudflare.com',
    finalWebhookUrl: webhookUrl,
    envVars: Object.keys(process.env).filter(key => key.includes('SHOPIFY') || key.includes('HOST'))
  });
});

// Test webhook registration
app.post("/api/register-webhooks", async (_req, res) => {
  try {
    const session = res.locals.shopify.session;
    if (!session) {
      res.status(401).json({ error: "No session" });
      return;
    }

    const client = new shopify.api.clients.Graphql({
      session: session,
      apiVersion: ApiVersion.July25,
    });

    // Get the webhook URL - try multiple sources
    const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST || 'https://connections-florist-explained-canberra.trycloudflare.com';
    const webhookUrl = `${appUrl}/api/webhooks`;
    
    console.log(`🔧 Environment check:`, {
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
      HOST: process.env.HOST,
      finalWebhookUrl: webhookUrl
    });
    
    console.log(`🔧 Registering webhooks for ${session.shop} with URL: ${webhookUrl}`);

    const webhookMutation = `#graphql
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            callbackUrl
            topic
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Register ORDERS_CREATE
    const ordersCreateResp = await client.request(webhookMutation, {
      variables: {
        topic: "ORDERS_CREATE",
        webhookSubscription: {
          callbackUrl: webhookUrl,
          format: "JSON"
        }
      }
    });

    // Register ORDERS_PAID  
    const ordersPaidResp = await client.request(webhookMutation, {
      variables: {
        topic: "ORDERS_PAID",
        webhookSubscription: {
          callbackUrl: webhookUrl,
          format: "JSON"
        }
      }
    });

    res.status(200).json({
      success: true,
      webhookUrl,
      results: {
        ordersCreate: ordersCreateResp?.data?.webhookSubscriptionCreate,
        ordersPaid: ordersPaidResp?.data?.webhookSubscriptionCreate
      }
    });

  } catch (error) {
    console.error('❌ Webhook registration error:', error);
    res.status(500).json({ error: error.message });
  }
});


app.use(shopify.cspHeaders());

ensureTables().then(() => {
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (req, res, _next) => {
  res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});
app.listen(PORT);
}).catch((error) => {
  console.error("Error starting server:", error);
  process.exit(1);
});

async function ensureTables() {
  try {
    console.log('Creating extension...');
    await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    
    console.log('Creating products table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain text NOT NULL,
        product_gid text NOT NULL,
        title text NOT NULL,
        is_digital boolean DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (shop_domain, product_gid)
      )
    `);
    
    console.log('Creating customers table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain text NOT NULL,
        customer_gid text,
        email text NOT NULL,
        first_name text,
        last_name text,
        downloads text[] DEFAULT '{}',
        lifetime_access boolean DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (shop_domain, email)
      )
    `);
    
    console.log('Updating table schema...');
    // Remove pdf_url column if it exists (since we now use metafields)
    await db.query('ALTER TABLE products DROP COLUMN IF EXISTS pdf_url');
    // Remove is_free column if it exists (replaced with is_digital)
    await db.query('ALTER TABLE products DROP COLUMN IF EXISTS is_free');
    // Add is_digital column if it doesn't exist
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_digital boolean DEFAULT false');
    
    console.log('Creating indexes...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_shop_domain ON products (shop_domain)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_product_gid ON products (product_gid)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_is_digital ON products (is_digital) WHERE is_digital = true');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_shop_domain ON customers (shop_domain)');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_shop_lower_email ON customers (shop_domain, lower(email))');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_customer_gid ON customers (customer_gid) WHERE customer_gid IS NOT NULL');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_downloads_gin ON customers USING GIN (downloads)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_lifetime_access ON customers (lifetime_access) WHERE lifetime_access = true');
    
    console.log('Database tables and indexes ensured successfully');
  } catch (error) {
    console.error('Error ensuring database tables:', error);
    throw error;
  }
}

// Get PDF file URL from Shopify Files API for a specific product
async function getProductPDFUrl(productId, shopDomain) {
  try {
    // Get session to make GraphQL calls
    const offlineId = shopify.api.session.getOfflineId(shopDomain);
    const session = await shopify.config.sessionStorage.loadSession(offlineId);

    if (!session) {
      console.error(`No session found for shop: ${shopDomain}`);
      return null;
    }

    const client = new shopify.api.clients.Graphql({
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
    
    const client = new shopify.api.clients.Graphql({
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
async function getProductDetails(productGid, session) {
  try {
    console.log(`🔍 Getting product details for: ${productGid}`);
    
    const client = new shopify.api.clients.Graphql({
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



