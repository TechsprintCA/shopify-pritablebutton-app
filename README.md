# Custom Shopify Add‑to‑Cart App

A private, embedded Shopify app that intercepts the default **Add to Cart** flow and applies store‑specific business logic (popups, bundling, restrictions, metadata) before committing changes to the cart.

> **Target users:** a single Shopify store (or a small set) that needs a controlled cart workflow, especially useful for regulated industries or complex bundling rules.

---

## ✨ Features

* **Add‑to‑Cart Intercept:** Override theme add‑to‑cart to call the app first.
* **Conditional Rules:** Enforce business rules (e.g., allow only one subscription item, block mixed categories, require accessory, etc.).
* **Auto Bundling:** Add/remove related items; support fixed bundles and optional add‑ons.
* **Dynamic Popups/Modals:** Surface upsells, warnings, or compliance notices before cart update.
* **Line‑Item Metadata:** Attach properties for compliance or fulfillment.
* **Per‑Handle Config:** Enable/disable rules per product or collection via Admin UI.
* **Audit Logging:** Optional log of rule decisions for support/compliance.
* **Mobile‑first UI:** Lightweight, accessible storefront components.
* **Embedded Admin:** Shopify App Bridge + Polaris admin for configuration.

---

## 🧱 Architecture

```
Storefront (Theme)       <—>  App Proxy Endpoint (/apps/cart-logic)
  └─ addToCart.js               └─ Node/Express (Remix/Next.js also OK)
        │                        └─ Shopify API (Storefront/GraphQL + REST)
        ▼                        └─ DB (SQLite/Postgres) for rules + logs (optional)
   Popup/UX layer
```

* **Storefront integration:** Lightweight JS snippet (or theme app extension) intercepts form/button submit, calls app endpoint, receives updated cart instructions.
* **App backend:** Validates rules, hits Shopify APIs to simulate/apply changes, returns a **cart patch** (add/remove/quantities/properties) and optional **UI instructions** (show popup X).
* **Admin:** Merchants configure rules, bundles, messages.

---

## 🧰 Tech Stack

* **Runtime:** Node.js 18+
* **Framework:** Express (or Remix/Next.js App Router—both supported)
* **Shopify SDKs:** `@shopify/shopify-api`, App Bridge, Polaris
* **Storefront APIs:** Storefront GraphQL, AJAX Cart API (fallback)
* **Persistence (optional):** SQLite (dev) / Postgres (prod) via Prisma
* **Auth:** OAuth 2.0 (Embedded app), HMAC validation for proxies/webhooks
* **Build/Deploy:** Dockerfile; deploy to Fly.io, Railway, Render, or Vercel

---

## 🔐 Permissions (Scopes)

Minimum recommended OAuth scopes:

* `read_products`
* `read_cart` (implicit via Storefront; use Storefront API token)
* `write_products` (only if writing metafields)
* `read_script_tags` / `write_script_tags` (if injecting scripts)
* `read_themes` / `write_themes` (if editing theme assets; prefer **theme app extension** instead)
* `read_orders` (optional for compliance checks)

> Use **Storefront API token** for cart mutations. For Plus stores you may optionally integrate **Shopify Functions** for enforcement at checkout.

---

## 🏁 Getting Started

### 1) Prerequisites

* Shopify Partner account & development store
* Node.js 18+, pnpm/npm, Git
* (Optional) Postgres or SQLite

### 2) Environment

Create `.env`:

```bash
SHOPIFY_API_KEY=xxxx
SHOPIFY_API_SECRET=xxxx
SHOPIFY_SCOPES=read_products,read_themes,write_themes,read_script_tags,write_script_tags
SHOPIFY_APP_URL=https://your-app-url
ENCRYPTION_KEY=32charrandomstring
DATABASE_URL=file:./dev.db  # or postgres://...
STOREFRONT_API_TOKEN=xxxx   # from store settings > apps > storefront api
```

### 3) Install & Run

```bash
pnpm install
pnpm dev
```

The app will print an installation URL. Install to your dev store and accept scopes.

---

## 🧭 Admin Configuration (Polaris)

* **Rules:** define constraints (e.g., category A cannot mix with B, only 1 subscription, min/max qty, required accessory).
* **Bundles:** fixed or conditional bundles; define trigger SKUs and auto‑added SKUs.
* **Popups:** content blocks (title, body, CTA) shown when certain rules trigger.
* **Logging:** toggle decision logs (level, retention days).

> Data model is stored in DB and can be exported/imported as JSON for easy migration.

---

## 🎯 Storefront Integration

Prefer a **Theme App Extension** for long‑term safety. For quick start, inject a small script tag.

### Option A: Theme App Extension (recommended)

* Expose an ES module that binds to product forms/buttons.
* Configure blocks (enable/disable per‑template or per‑section).

### Option B: Script Tag (fastest)

**addToCart.js** (simplified example):

```html
<script>
(function(){
  const forms = document.querySelectorAll('form[action^="/cart/add"], form[action^="/cart/add.js"]');
  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      // Call the app proxy first
      const res = await fetch('/apps/cart-logic/intercept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          line: {
            id: payload.id || payload.variantId,
            quantity: Number(payload.quantity || 1),
            properties: collectLineProperties(form)
          },
          url: window.location.href
        })
      });

      const result = await res.json();

      if (result.ui?.popup) {
        await showPopup(result.ui.popup);
      }

      if (result.cartPatch) {
        // Apply patch via AJAX Cart API
        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result.cartPatch)
        });
      }

      // Navigate or refresh cart drawer
      if (result.redirect) window.location.href = result.redirect;
      else document.dispatchEvent(new CustomEvent('cart:refresh'));
    }, { passive: false });
  });

  function collectLineProperties(form){
    const props = {};
    form.querySelectorAll('[name^="properties["]').forEach(i => {
      const key = i.name.replace(/^properties\[(.*)\]$/, '$1');
      props[key] = i.value;
    });
    return props;
  }

  async function showPopup(cfg){
    // Minimal popup; in production render an accessible modal
    alert(cfg.message || 'Please confirm');
  }
})();
</script>
```

> For carts using drawers/sections, replace the refresh with your theme’s refresh hook.

---

## 🔌 App Proxy Endpoint

Registered at **/apps/cart-logic**.

**POST /apps/cart-logic/intercept**
Request body:

```json
{
  "action": "add|update|remove",
  "line": { "id": "variantId", "quantity": 1, "properties": {"key":"val"} },
  "url": "https://store/product/handle"
}
```

Response body (example):

```json
{
  "ui": { "popup": { "message": "Age 18+ required" } },
  "cartPatch": {
    "updates": { "VARIANT_ID": 1 },
    "attributes": { "compliance_ack": "true" },
    "note": "Bundle: Starter Pack"
  },
  "redirect": "/cart"
}
```

> The backend evaluates rules, prepares a **cart patch** that the storefront applies via `/cart/update.js` (AJAX API) or Storefront GraphQL.

---

## 🧪 Testing

* **Unit tests:** rule engine (inputs → expected cart patch/UI).
* **E2E:** Cypress/Playwright against a dev store (mock Shop API where possible).
* **Accessibility:** Popups/modals pass keyboard+screen reader checks.
* **Performance:** Intercept round‑trip < 150ms P95; script < 8KB gz.

---

## 🚀 Deployment

* Build Docker image; set env vars in your platform (Fly.io, Railway, Render, Vercel w/ Edge function for proxy if needed).
* Configure **App Proxy** in Shopify Admin → App setup → App proxy (prefix `apps`, subpath `cart-logic`).
* Add **Content Security Policy** to allow your domain.
* Use HTTPS only; rotate tokens; enable Webhook HMAC verification.

---

## 🔎 Security & Compliance

* Validate HMAC on **App Proxy** requests.
* Sanitize all inputs; rate‑limit proxy.
* Never expose Admin API credentials to the storefront.
* Optional **Age/Region gates** before enabling add‑to‑cart.
* Logs exclude PII; configurable retention.

---

## 🧩 Optional: Shopify Plus Enhancements

* **Shopify Functions**: implement cart/discount validation at checkout for hard enforcement.
* **Checkout UI Extensions**: show compliance acknowledgements on checkout pages.

---

## 📚 Folder Structure (suggested)

```
app/
  admin/            # Polaris UI
  proxy/            # Intercept handlers
  rules/            # Rule engine (pure functions)
  services/         # Shopify API clients
  webhooks/
  public/
  theme-ext/        # Theme app extension assets
  prisma/           # schema.prisma

```

---

## 🗺️ Roadmap

* Visual rule builder
* A/B test upsell popups
* Multi‑store config w/ per‑store overrides
* Analytics events (add/remove/blocked reasons)

---

## 🙋 FAQ

**Q: Will this work without touching the theme?**
A: Yes via script tag, but a theme app extension is more robust and update‑safe.

**Q: Can we fully customize checkout?**
A: Checkout is limited; use Functions/Checkout UI Extensions (Plus) or enforce rules pre‑checkout.

**Q: Does it support headless?**
A: Yes; call the same proxy from your headless frontend and apply the returned cart patch using Storefront GraphQL.

---

## 📄 License

Private/custom app for the client store. Do not redistribute without permission.
