# quickship-delivery-customization

Shopify app powering the **Quick Ship** experience across the Serta and Beautyrest
stores. It contains two extensions:

- **`quickship-delivery`** — a Delivery Customization **function** that runs at
  checkout. It reads each cart item's eligibility and the customer's shipping zip,
  then surfaces or hides the Quick Ship shipping rate accordingly.
- **`quickship-checkout-ui`** — a Checkout UI extension that renders the per-item
  Quick Ship vs Standard delivery selection (left-side picker, order-summary line
  estimates, and the Thank You message).

This guide takes a new developer from clone to a working checkout.

---

## Prerequisites

- **Node.js 18+** (the function uses built-in `fetch`).
- **Shopify CLI**: `npm install -g @shopify/cli@latest`
- Access to the Shopify app in the Partner org, and to the target store(s)
  (`serta-staging`, `beautyrest-staging`).
- **Shopify Plus** on the store — Delivery Customization functions require it.

---

## Get the code locally

```bash
git clone https://github.com/tuftandneedle/quickship-delivery-customization.git
cd quickship-delivery-customization
npm install
```

`npm install` pulls dependencies for the app and both extensions. Nothing secret is
committed — you supply your own credentials below.

---

## Project structure

```
quickship-delivery-customization/
├── shopify.app.toml                 # App config (client_id, scopes, name)
├── package.json
├── extensions/
│   ├── quickship-delivery/          # Delivery Customization FUNCTION
│   │   ├── shopify.extension.toml
│   │   └── src/
│   │       ├── cart_delivery_options_transform_run.graphql   # input query
│   │       └── cart_delivery_options_transform_run.js        # function logic
│   └── quickship-checkout-ui/       # Checkout UI extension
│       ├── shopify.extension.toml
│       └── src/
│           ├── Checkout.jsx
│           ├── CartLineEstimate.jsx
│           └── ThankYouMessage.jsx
└── README.md
```

---

## Configure

The app reads its API secret from a local `.env` file, which is **gitignored** and
never committed. After cloning, run the CLI once and it will create/populate `.env`
and link the app:

```bash
shopify app config link      # links this folder to the app in the Partner org
shopify app dev              # starts a dev session; press `g` for GraphiQL
```

If `.env` is missing values, the CLI prompts you through it. Do not paste tokens or
secrets into any tracked file — see [SECURITY.md](./SECURITY.md).

> Note: the staging stores are **not** dev stores, so `shopify app dev` previews
> won't target them directly. Develop/preview against a dev store, then deploy and
> activate against staging (below).

---

## Deploy

```bash
shopify app deploy
```

This builds both extensions and pushes them to the app. The app is installed per
store, so a single deploy makes the new version available on every store the app is
installed on. An already-active customization automatically uses the latest deployed
version — no re-activation needed after a redeploy.

---

## Activate the delivery function (per store)

Deploying makes the function *available*; it does not make it *run*. You activate it
once per store by creating a delivery customization. Run these in the store's
**Shopify GraphiQL App** (the staging stores aren't dev stores, so use the GraphiQL
App, not `shopify app dev`).

1. Find the function ID:

```graphql
{
  shopifyFunctions(first: 25) {
    nodes { app { title } apiType title id }
  }
}
```

Use the node where `app.title` is `quickship-delivery` and `apiType` is
`delivery_customization`. (Current ID, stable across deploys:
`019e3133-0725-77f5-83f0-d8df8952c6fd`.)

2. Check whether a customization already exists (avoid duplicates — two active ones
   fight over the same rates):

```graphql
{ deliveryCustomizations(first: 10) { nodes { id title enabled functionId } } }
```

3. If none exists, create + enable it:

```graphql
mutation {
  deliveryCustomizationCreate(deliveryCustomization: {
    functionId: "019e3133-0725-77f5-83f0-d8df8952c6fd"
    title: "Quick Ship Delivery"
    enabled: true
  }) {
    deliveryCustomization { id title enabled }
    userErrors { field message }
  }
}
```

If one exists but is disabled, enable it with `deliveryCustomizationUpdate` instead.

4. Verify: Admin → Settings → Shipping and delivery → Delivery customizations →
   "Quick Ship Delivery" listed and enabled.

---

## Metafield dependencies (variant level)

The function reads these at checkout. They must exist as definitions and be populated.

| Admin label                  | API key                    | Type             | Written by | Used by the function |
|------------------------------|----------------------------|------------------|------------|----------------------|
| Quick Ship                   | `custom.quickship`         | boolean string   | Azure      | Gate: is it a QS product |
| Zipcode for Shopify Function | `custom.quickship_zips`    | single line text | `quickship-zip-sync` repo | The eligible zips (comma-separated) |

The function logic: a line is Quick Ship eligible when `custom.quickship` is `"true"`
**and** the customer's zip is in the comma-separated `custom.quickship_zips` list.
Zips are compared as strings (never numeric — leading zeros like `01005` matter).

`custom.quickship_zips` is populated by the separate
[`quickship-zip-sync`](https://github.com/tuftandneedle/quickship-zip-sync) repo,
which derives it from `custom.zipcode_inventory` (the JSON Azure writes). Stock
quantity is validated upstream at the cart (AEM); checkout only confirms the zip.

---

## Delivery rates

The function routes between two free rates by name:

- A standard free rate (shown when not eligible).
- A Quick Ship free rate marked with **`(QS)`** in its name (shown when eligible,
  then renamed to the buyer-facing label). The `(QS)` marker must not contain
  "quick ship"/"quickship".

If no `(QS)` rate exists, the function falls back to renaming the single free rate —
safe to deploy before the second rate is set up.

The long "White Glove" delivery description is set on the rate via the
`deliveryProfileUpdate` mutation (the Admin API bypasses the UI's character cap).

---

## Local testing checklist

1. Hand-seed a test variant: `custom.quickship` = `true`,
   `custom.quickship_zips` = e.g. `01005,01007`.
2. Confirm the function is activated on the store (above).
3. Add that variant to a cart, go to checkout, enter zip `01005` → the Quick Ship
   rate surfaces. Change to a non-listed zip → it falls back to standard.
4. Use a fresh cart to avoid stale cart attributes.

---

## Known constraints

- **Pure JS in the function file** — no JSX in
  `cart_delivery_options_transform_run.js`, or the build fails with a JSX-syntax
  error.
- **Crashing checkout UI components** — do not use `s-card`, `s-pressable`,
  `s-inline-stack`, or `s-grid`. Use `s-banner` (with the `tone` attribute) for
  colored callouts.
- **Express checkout** — Checkout UI extensions do not run in Apple Pay / Google Pay
  / Amazon Pay / PayPal express flows (the delivery function still does). See the
  team's notes on the cart-attribute marker pattern for the permanent fix.

---

## Security

Never commit `.env`, tokens, or API secrets. The `client_id` in `shopify.app.toml`
and the extension `uid`s are public identifiers and are safe to commit. See
[SECURITY.md](./SECURITY.md). If a secret is ever exposed, rotate it immediately —
removing it from a later commit does not remove it from git history.
