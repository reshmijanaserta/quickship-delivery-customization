import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Checkout.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.shipping-option-list.render-before').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/CartLineEstimate.jsx' {
  const shopify:
    | import('@shopify/ui-extensions/purchase.checkout.cart-line-item.render-after').Api
    | import('@shopify/ui-extensions/purchase.thank-you.cart-line-item.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ThankYouMessage.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
