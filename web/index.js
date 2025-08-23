// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import db from "./db.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
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
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
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

      // Normalize product id to Shopify GID format if needed
      const productGid = (typeof product_id === 'string' ? product_id : String(product_id)).startsWith('gid://')
        ? String(product_id)
        : `gid://shopify/Product/${String(product_id)}`;

      // Now find the product in our database
      const productResult = await db.query(
        "SELECT product_gid, title, pdf_url FROM products WHERE shop_domain = $1 AND product_gid = $2",
        [session.shop, productGid]
      );

      if (productResult.rows.length === 0) {
        res.status(404).json({ 
          error: "Product not found", 
          product_id: product_id 
        });
        return;
      }

      const product = productResult.rows[0];

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

      res.status(200).json({
        success: true,
        message: "Customer created/updated and download recorded",
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


app.use(shopify.cspHeaders());

ensureTables().then(() => {
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (req, res, _next) => {
  try {
    let session = res.locals && res.locals.shopify ? res.locals.shopify.session : undefined;
    console.log("session", session);
    if (!session) {
      const rawShop = req.query && req.query.shop;
      const shop = Array.isArray(rawShop)
        ? rawShop[0]
        : (typeof rawShop === "string" ? rawShop : undefined);
      if (shop && typeof shop === 'string') {
        try {
          const offlineId = shopify.api.session.getOfflineId(shop);
          session = await shopify.config.sessionStorage.loadSession(offlineId);
        } catch (e) {
          // ignore, we just won't preload
        }
      }
    }
    if (session) {
      await loadProductsIfEmpty(session);
    }
  } catch (e) {
    console.error("Failed to load products on first run:", e);
  }
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
        pdf_url text,
        is_free boolean DEFAULT true,
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
    
    console.log('Creating indexes...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_shop_domain ON products (shop_domain)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_product_gid ON products (product_gid)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_shop_domain ON customers (shop_domain)');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_shop_lower_email ON customers (shop_domain, lower(email))');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_customer_gid ON customers (customer_gid) WHERE customer_gid IS NOT NULL');
    await db.query('CREATE INDEX IF NOT EXISTS idx_customers_downloads_gin ON customers USING GIN (downloads)');
    
    console.log('Database tables and indexes ensured successfully');
  } catch (error) {
    console.error('Error ensuring database tables:', error);
    throw error;
  }
}

const PDF_URL = "https://drive.google.com/uc?export=download&id=1Opf3AXJlGuyfbHtFbEbYMT9-x9UFD9hS";

async function loadProductsIfEmpty(session) {
  const shopDomain = session?.shop;
  if (!shopDomain) return;

  // Check if this shop already has products stored
  const countResult = await db.query(
    "SELECT COUNT(*)::int AS count FROM products WHERE shop_domain = $1",
    [shopDomain]
  );
  const rows = countResult.rows || [];
  const row0 = rows.length > 0 ? rows[0] : undefined;
  const existingCount = row0 ? Number(row0["count"]) : 0;
  if (existingCount > 0) return; // already loaded once

  console.log(`Loading products for ${shopDomain} (first run)...`);
  const client = new shopify.api.clients.Graphql({
    session: session,
    apiVersion: ApiVersion.July25,
  });

  let afterCursor = null;
  let totalLoaded = 0;
  
  // Paginate until all products are fetched
  while (true) {
    const query = `#graphql
      query Products($after: String) {
        products(first: 250, after: $after) {
          edges {
            cursor
            node {
              id
              title
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const resp = await client.request(query, { variables: { after: afterCursor } });
    const edges = resp?.data?.products?.edges || [];

    if (edges.length > 0) {
      // Build batched insert
      const values = [];
      const params = [];
      let paramIndex = 1;
      for (const edge of edges) {
        const node = edge.node;
        const gid = node.id;
        const title = node.title || "";
        values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        params.push(shopDomain, gid, title, PDF_URL);
      }
      const sql = `
        INSERT INTO products (shop_domain, product_gid, title, pdf_url)
        VALUES ${values.join(", ")}
        ON CONFLICT (shop_domain, product_gid) DO NOTHING
      `;
      await db.query(sql, params);
      totalLoaded += edges.length;
      console.log(`Loaded ${edges.length} products (${totalLoaded} total)...`);
    }

    const pageInfo = resp?.data?.products?.pageInfo;
    if (pageInfo?.hasNextPage) {
      afterCursor = pageInfo.endCursor;
    } else {
      break;
    }
  }

  console.log(`Finished loading ${totalLoaded} products for ${shopDomain}`);
}

