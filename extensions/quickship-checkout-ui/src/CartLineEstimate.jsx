// @ts-nocheck
import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<CartLineEstimate />, document.body);
};

// Display-only: shows the per-item delivery method on the order summary (both
// checkout and thank-you). It writes nothing — Checkout.jsx is the single writer.
//
// SOLIDITY:
//  (1) Every signal is read ONCE, up front, before any early return. Reading a
//      signal's .value during render is what subscribes this component to it, so
//      reading them all unconditionally guarantees we re-render on ANY relevant
//      change — the buyer toggling a method, the address changing, metafields
//      loading. The previous version read some signals only inside a branch, so a
//      render that skipped that branch dropped the subscription and the display
//      could "stick" on a stale method until something else forced a re-render.
//      That dropped subscription is the "not sure at times" behaviour.
//  (2) The recorded selection (quickship_selections) is the source of truth and
//      is checked FIRST — it needs no metafields, so a cached cart resolves
//      immediately. Eligibility is only consulted before the seed has written a
//      selection, and even then we never commit to "Standard" while metafields
//      are still arriving (we render nothing for that one beat instead).
function CartLineEstimate() {
  // --- Read every signal up front so we always re-subscribe (see note 1). ---
  var target = shopify.target ? shopify.target.value : null;
  var addressVal = shopify.shippingAddress ? shopify.shippingAddress.value : null;
  var attrsVal = shopify.attributes ? shopify.attributes.value : null;
  var metafieldsVal = shopify.appMetafields ? shopify.appMetafields.value : null;

  var attrs = Array.isArray(attrsVal) ? attrsVal : [];
  var metafields = Array.isArray(metafieldsVal) ? metafieldsVal : [];

  // --- This line's numeric variant id ---
  var nid = "";
  if (target && target.merchandise && target.merchandise.id) {
    var parts = String(target.merchandise.id).split("/");
    nid = parts[parts.length - 1];
  }
  if (!nid) return <s-text></s-text>;

  // --- Need a destination zip before we can resolve anything ---
  var customerZip = "";
  if (addressVal && addressVal.zip) customerZip = String(addressVal.zip).trim();
  if (!customerZip) return <s-text></s-text>;

  // --- Resolve method: "quick" | "standard" | "" (unknown -> render nothing) ---
  var method = resolveMethod(nid, customerZip, attrs, metafields);

  if (method === "quick") {
    return (
      <s-stack gap="tight">
        <s-text emphasis="bold">Delivery Method: Quick Ship</s-text>
        <s-text emphasis="bold">Estimated delivery 4-7 days</s-text>
      </s-stack>
    );
  }

  if (method === "standard") {
    return (
      <s-stack gap="tight">
        <s-text emphasis="bold">Delivery Method: Standard Delivery</s-text>
        <s-text emphasis="bold">Estimated transit time 10-14 days</s-text>
      </s-stack>
    );
  }

  return <s-text></s-text>;
}

// Pure resolver — same selection-first logic, just isolated and testable. No
// signal reads in here (the caller already read + subscribed), so its result
// depends only on its inputs.
function resolveMethod(nid, customerZip, attrs, metafields) {
  // 1) Recorded selection FIRST — authoritative, needs no metafields.
  var selectionsValue = null;
  for (var sa = 0; sa < attrs.length; sa++) {
    if (attrs[sa] && attrs[sa].key === "quickship_selections") {
      selectionsValue = attrs[sa].value;
      break;
    }
  }
  if (selectionsValue !== null && selectionsValue !== undefined) {
    if (selectionsValue.length > 0) {
      var ids = selectionsValue.split(",");
      for (var s = 0; s < ids.length; s++) {
        if (ids[s].trim() === nid) return "quick";
      }
    }
    return "standard"; // recorded, but this variant isn't a Quick Ship pick
  }

  // 2) No selection yet (first paint, pre-seed). Consult eligibility — but never
  //    commit to "standard" while metafields are still loading. That empty beat
  //    is exactly what used to flash the wrong method on a cached zip.
  if (metafields.length === 0) return ""; // still loading — say nothing yet

  for (var m = 0; m < metafields.length; m++) {
    var meta = metafields[m];
    if (!meta || !meta.target || !meta.metafield) continue;
    if (meta.metafield.key !== "quickship_zips") continue;
    // meta.target.id may be a full GID ("gid://shopify/ProductVariant/123") while
    // nid is the numeric tail ("123"). Compare BOTH forms — the old
    // "String(meta.target.id) !== nid" compared the GID against the numeric id, so
    // it never matched, and every eligible item fell through to "standard" in the
    // window before the seed records a selection.
    var metaId = String(meta.target.id);
    var metaNid = metaId.indexOf("/") >= 0
      ? metaId.substring(metaId.lastIndexOf("/") + 1)
      : metaId;
    if (metaId !== nid && metaNid !== nid) continue;
    var zipArr = String(meta.metafield.value || "").split(",");
    for (var z = 0; z < zipArr.length; z++) {
      if (zipArr[z].trim() === customerZip) return "quick"; // eligible default
    }
  }
  return "standard"; // metafields loaded, genuinely not eligible
}