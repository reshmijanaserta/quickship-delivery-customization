// @ts-nocheck
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

var ATTR_KEY = "quickship_selections";

// Ensures the default Quick Ship selection is seeded into the cart attribute
// exactly once per session, and never overrides a selection that already exists.
var seedDone = false;

function numericId(gid) {
  if (!gid) return "";
  var parts = String(gid).split("/");
  return parts[parts.length - 1];
}

// Turn a delivery option's Money (cost / costAfterDiscounts) into a display string.
// 0 (or missing) => "Free", otherwise "12.50 USD".
function formatCost(option) {
  if (!option) return "Free";
  var money = option.costAfterDiscounts || option.cost;
  if (!money) return "Free";
  var amt = typeof money.amount === "number" ? money.amount : parseFloat(money.amount);
  if (!amt || amt <= 0) return "Free";
  return amt.toFixed(2) + " " + (money.currencyCode || "");
}

// Read the native Shopify delivery option (the "Free Delivery — ..." rate Shopify
// renders below) so each per-item block reuses the real name + price instead of
// hardcoded text. Returns a clean { label, cost } — the verbose guidance suffix
// after the dash is stripped so it reads well as a per-item radio label.
function readNativeStandard() {
  var result = { label: "Standard Delivery", cost: "Free" };

  var groups = [];
  try {
    var groupList = shopify.target ? shopify.target.value : null;
    if (groupList && groupList.deliveryGroups) groups = groupList.deliveryGroups;
    if ((!groups || groups.length === 0) && shopify.deliveryGroups) {
      groups = shopify.deliveryGroups.value || [];
    }
  } catch (e) {
    groups = [];
  }
  if (!groups || groups.length === 0) return result;

  var options = groups[0].deliveryOptions || [];
  var chosen = null;
  for (var d = 0; d < options.length; d++) {
    var rawTitle = options[d].title || "";
    // Skip any option that is itself a Quick Ship rate — we want the standard/free one.
    if (rawTitle.toLowerCase().indexOf("quick ship") !== -1) continue;
    if (!chosen) chosen = options[d];
    // Prefer a free option if there is one.
    if (formatCost(options[d]) === "Free") {
      chosen = options[d];
      break;
    }
  }
  if (chosen) {
    // Use the clean name before the em-dash guidance suffix, and strip any
    // leading "*" the delivery function may have added to the native rate —
    // otherwise the per-item label would read "*Free Delivery*".
    var cleanName = (chosen.title || "").split("\u2014")[0].trim();
    cleanName = cleanName.replace(/^\*+\s*/, "").replace(/\s*\*+$/, "");
    if (cleanName) result.label = cleanName;
    result.cost = formatCost(chosen);
  }
  return result;
}

// Build a readable label, avoiding redundancy like "Free Delivery — Free".
function buildStandardLabel(nativeStd) {
  var isFree = nativeStd.cost === "Free";
  var nameImpliesFree = nativeStd.label.toLowerCase().indexOf("free") !== -1;
  if (isFree && nameImpliesFree) return nativeStd.label;
  return nativeStd.label + " — " + nativeStd.cost;
}

// Single, guarded attribute write.
function writeSelections(idArray) {
  if (!shopify || typeof shopify.applyAttributeChange !== "function") return;
  try {
    var p = shopify.applyAttributeChange({
      type: "updateAttribute",
      key: ATTR_KEY,
      value: idArray.join(","),
    });
    if (p && typeof p.catch === "function") p.catch(function () {});
  } catch (e) {
    // Attribute updates can be disallowed by the checkout; fail quietly.
  }
}

function readAttribute() {
  var attrs = [];
  try {
    attrs = shopify.attributes ? shopify.attributes.value || [] : [];
  } catch (e) {
    attrs = [];
  }
  for (var a = 0; a < attrs.length; a++) {
    if (attrs[a] && attrs[a].key === ATTR_KEY) {
      return { present: true, value: attrs[a].value || "" };
    }
  }
  return { present: false, value: "" };
}

var METHOD_KEY = "_delivery_method";
var QUICK = "Quick Ship";
var STANDARD = "Standard Delivery";

// Maps an internal / AEM line-item-property key to its hidden ("_"-prefixed)
// form so the customer never sees it. Returns the key unchanged when it isn't
// one we hide — so a key that already arrives prefixed is left alone and can
// never be double-prefixed.
function hiddenKey(key) {
  if (key === "quickship_eligible") return "_quickship_eligible";
  if (key === "ship_from_facility") return "_ship_from_facility";
  if (key === "Image URL") return "_image_url";
  if (key === "Product Handle") return "_product_handle";
  if (key === "Product Type") return "_product_type";
  return key;
}

// Per-line in-flight guard so two writes never hit the same line at once.
var lineBusy = {};

// Build a line's next attributes: hide-rename the internal keys and set the
// chosen delivery method as a hidden _delivery_method property. The customer's
// method always wins over any pre-existing "Delivery Method" value. Returns
// null when nothing would change, so the caller skips the write — keeping it
// idempotent (it can't loop or double-write).
function buildLineAttrs(attrs, method) {
  var out = [];
  var changed = false;
  var hadMethod = false;
  for (var a = 0; a < attrs.length; a++) {
    var at = attrs[a];
    if (!at || !at.key) continue;
    var key = at.key;
    var val = at.value || "";
    if (key === METHOD_KEY || key === "Delivery Method" || key === "DELIVERY METHOD") {
      hadMethod = true;
      if (key !== METHOD_KEY) changed = true; // renamed from a visible key
      if (val !== method) changed = true;     // method value updated
      continue;                                // re-added once below
    }
    var hk = hiddenKey(key);
    if (hk !== key) changed = true;            // a hide-rename
    out.push({ key: hk, value: val });
  }
  out.push({ key: METHOD_KEY, value: method });
  if (!hadMethod) changed = true;
  return changed ? out : null;
}

// Write a line's attributes (hide-rename + method) once, guarded + idempotent.
// Skips when attributes haven't loaded yet so it never clobbers AEM properties.
// Returns a promise that settles when the write completes.
function writeLineAttrs(lineId, attrs, method) {
  if (!shopify || typeof shopify.applyCartLinesChange !== "function") return Promise.resolve();
  if (!lineId || lineBusy[lineId]) return Promise.resolve();
  if (!attrs || !attrs.length) return Promise.resolve(); // not loaded — don't clobber

  var next = buildLineAttrs(attrs, method);
  if (!next) return Promise.resolve(); // nothing to change

  lineBusy[lineId] = true;
  var clear = function () { lineBusy[lineId] = false; };
  try {
    var p = shopify.applyCartLinesChange({
      type: "updateCartLine",
      id: lineId,
      attributes: next,
    });
    if (p && typeof p.then === "function") {
      return p.then(function (r) { clear(); return r; }, function () { clear(); });
    }
    clear();
    return Promise.resolve();
  } catch (e) {
    clear();
    return Promise.resolve();
  }
}

// The method string for a line, derived purely from the buyer's recorded
// selection (quickship_selections) so _delivery_method can never disagree with
// it. A variant id is only ever in that list when the item is eligible AND
// chosen for Quick Ship — the seed adds the eligible defaults, handleChange
// adds/removes on toggle. Anything not in the list (eligible-but-deselected, or
// not eligible) is Standard. Crucially there is NO eligibility short-circuit
// here: that was what wrote "Standard Delivery" during the brief window while
// appMetafields were still loading (eligible momentarily false), leaving the
// order stale even though the selection was correct.
function methodForLine(nid, selectionsValue) {
  if (selectionsValue) {
    var arr = selectionsValue.split(",");
    for (var s = 0; s < arr.length; s++) {
      if (arr[s].trim() === nid) return QUICK;
    }
  }
  return STANDARD;
}

function Extension() {
  var lines = [];
  try {
    lines = shopify.lines.value || [];
  } catch (e) {
    lines = [];
  }

  var customerZip = "";
  try {
    var address = shopify.shippingAddress ? shopify.shippingAddress.value : null;
    if (address && address.zip) customerZip = String(address.zip).trim();
  } catch (e) {
    customerZip = "";
  }

  var metafields = [];
  try {
    metafields = shopify.appMetafields ? shopify.appMetafields.value || [] : [];
  } catch (e) {
    metafields = [];
  }

  var nativeStd = readNativeStandard();
  var standardCost = nativeStd.cost === "Free" ? "FREE" : nativeStd.cost;
  var standardLabel = "Standard Shipping \u2013 " + standardCost + "*";

  // Eligibility map: variant id (both GID and numeric forms) -> true.
  var eligibleIds = {};
  if (customerZip) {
    for (var m = 0; m < metafields.length; m++) {
      var meta = metafields[m];
      if (!meta || !meta.target || !meta.metafield) continue;
      if (meta.metafield.key !== "quickship_zips") continue;
      var zipArr = String(meta.metafield.value || "").split(",");
      for (var z = 0; z < zipArr.length; z++) {
        if (zipArr[z].trim() === customerZip) {
          var targetId = String(meta.target.id);
          eligibleIds[targetId] = true;
          eligibleIds[numericId(targetId)] = true;
          break;
        }
      }
    }
  }

  var items = [];
  var eligibleNids = [];
  var seenNid = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var merch = line ? line.merchandise : null;
    if (!merch) continue;
    var fullId = merch.id || "";
    var nid = numericId(fullId);
    var eligible = eligibleIds[nid] === true || eligibleIds[fullId] === true;
    if (eligible && nid && !seenNid[nid]) {
      seenNid[nid] = true;
      eligibleNids.push(nid);
    }
    items.push({
      uid: nid || ("line-" + i),
      nid: nid,
      prodTitle: merch.product ? (merch.product.title || "Product") : "Product",
      varTitle: merch.title || "",
      qty: line.quantity || 1,
      eligible: eligible,
      idx: i,
    });
  }

  var hasAnyEligible = eligibleNids.length > 0;
  var eligibleKey = eligibleNids.join(",");

  // Current selection, read in render so it stays reactive to toggles.
  var selRead = readAttribute();
  var selectionsValue = selRead.value;
  var selectionsPresent = selRead.present;

  // Signature of every line's attribute keys + the selection — drives the sync
  // effect to re-run when attributes load/change or the buyer toggles a choice.
  var linesAttrSig = selectionsValue + "||";
  for (var sg = 0; sg < lines.length; sg++) {
    var sgLine = lines[sg];
    var sgAttrs = sgLine && sgLine.attributes ? sgLine.attributes : [];
    linesAttrSig += (sgLine && sgLine.id ? sgLine.id : "") + ":";
    for (var sk = 0; sk < sgAttrs.length; sk++) {
      if (sgAttrs[sk] && sgAttrs[sk].key) linesAttrSig += sgAttrs[sk].key + ",";
    }
    linesAttrSig += "|";
  }

  // Seed the all-eligible Quick Ship default once per load, as soon as
  // eligibility is known. We deliberately do NOT skip when a value is already
  // present on the cart: the LEFT picker resets to its Quick Ship defaults on
  // every load (s-choice defaultSelected), so the recorded selection must reset
  // to the same all-eligible default too. Otherwise a stale / empty / partial
  // value persisted on the cart from a previous load makes the right-hand summary
  // read "Standard" for an item the left still shows as "Quick Ship" — the
  // persistent (non-flickering) mismatch. The seedDone guard keeps this to a
  // single run; any buyer toggle is a later write that wins over this one (writes
  // are last-dispatch-wins), so an in-session choice is never lost.
  useEffect(function () {
    if (seedDone || !eligibleKey) return;
    seedDone = true;
    writeSelections(eligibleNids);
  }, [eligibleKey]);

  // Single, consolidated line-attribute writer — runs only here; CartLineEstimate
  // is display-only, so there is exactly one writer and no race. For each line,
  // in one write, it hides the internal property keys AND records the chosen
  // delivery method as _delivery_method (so it lands in the order). Re-runs when
  // attributes load or the selection changes; idempotent and sequential, so it
  // never loops, double-writes, or clobbers.
  //
  // Gated on selectionsPresent (not just zip): we never write _delivery_method
  // until the selection exists, which only happens after the seed has run — and
  // the seed runs only once eligibility is resolved. That guarantees the FIRST
  // write already reflects the real choice (Quick Ship for the seeded defaults),
  // so the property is never written as Standard during the brief window while
  // metafields are still loading and then left stale. That stale-Standard write
  // was the cause of order.json showing Standard for a Quick Ship selection.
  useEffect(function () {
    if (!customerZip || !selectionsPresent) return;
    var entries = [];
    for (var e = 0; e < items.length; e++) {
      var it = items[e];
      var ln = lines[it.idx];
      if (!ln) continue;
      entries.push({
        id: ln.id,
        attrs: ln.attributes || [],
        method: methodForLine(it.nid, selectionsValue),
      });
    }
    var idx = 0;
    function step() {
      if (idx >= entries.length) return;
      var en = entries[idx++];
      var pr = writeLineAttrs(en.id, en.attrs, en.method);
      if (pr && typeof pr.then === "function") pr.then(step, step);
      else step();
    }
    step();
  }, [customerZip, eligibleKey, linesAttrSig]);

  if (!customerZip || lines.length === 0 || !hasAnyEligible) {
    return <s-text></s-text>;
  }

  return (
    <s-stack gap="large" paddingBlockEnd="large-200">
      <s-heading>Delivery method</s-heading>

      <s-banner tone="success">
        <s-text>
          Quick Ship delivery is available for your area! Choose your preferred
          delivery method for each item below. Your selection will be confirmed in
          the order summary on the right.
        </s-text>
      </s-banner>

      {items.map(function (item) {
        var subtitle = item.varTitle
          ? item.varTitle + " — Qty: " + item.qty
          : "Qty: " + item.qty;

        if (item.eligible) {
          return (
            <s-stack gap="base" key={item.uid}>
              <s-text type="strong">{"Item " + (item.idx + 1)}</s-text>
              <s-text>{item.prodTitle}</s-text>
              <s-text color="subdued">{subtitle}</s-text>

              <s-choice-list
                name={"delivery-" + item.uid}
                variant="block"
                onChange={function (e) {
                  handleChange(item.nid, lines[item.idx], e);
                }}
              >
                <s-choice value="quickship" defaultSelected>
                  <s-text type="strong">Quick Ship – FREE*</s-text>
                  <s-text slot="details">
                    Ships fast from a nearby warehouse in as soon as 2 days.
                  </s-text>
                </s-choice>

                <s-choice value="standard">
                  <s-text type="strong">{standardLabel}</s-text>
                  <s-text slot="details">
                    Our local delivery partner will contact you to schedule your delivery in 7–10 days.
                  </s-text>
                </s-choice>
              </s-choice-list>

              {item.idx < items.length - 1 ? <s-divider /> : null}
            </s-stack>
          );
        }

        return (
          <s-stack gap="base" key={item.uid}>
            <s-text type="strong">{"Item " + (item.idx + 1)}</s-text>
            <s-text>{item.prodTitle}</s-text>
            <s-text color="subdued">{subtitle}</s-text>

            <s-choice-list
              name={"delivery-std-" + item.uid}
              variant="block"
            >
              <s-choice value="standard" defaultSelected>
                <s-text type="strong">{standardLabel}</s-text>
                <s-text slot="details">
                  Our local delivery partner will contact you to schedule your delivery in 7–10 days.
                </s-text>
              </s-choice>
            </s-choice-list>

            {item.idx < items.length - 1 ? <s-divider /> : null}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

function handleChange(variantNumericId, line, event) {
  if (!variantNumericId) return;
  var target = event && (event.currentTarget || event.target);
  if (!target) return;

  // s-choice-list exposes the selected option(s) as `values` (array); fall back to value.
  var selected = target.values;
  var choice = Array.isArray(selected) && selected.length ? selected[0] : (target.value || "");
  if (!choice) return;

  // Once the buyer interacts, the attribute is considered "set".
  seedDone = true;

  var current = readAttribute();
  var ids = current.value ? current.value.split(",") : [];

  var next = [];
  var seen = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i] ? ids[i].trim() : "";
    if (!id || id === variantNumericId || seen[id]) continue;
    seen[id] = true;
    next.push(id);
  }

  if (choice === "quickship") {
    next.push(variantNumericId);
  }

  writeSelections(next);

  // Record this line's method immediately too, so a delivery change lands fast
  // and isn't waiting on the sync effect to re-run through another render. The
  // effect re-affirms the same value from the updated selection right after, so
  // the two never disagree (and the idempotent write makes the re-affirm a no-op).
  var method = choice === "quickship" ? QUICK : STANDARD;
  if (line && line.id) writeLineAttrs(line.id, line.attributes || [], method);
}