// @ts-check

/**
 * Delivery customization function. It:
 * 1. ALWAYS hides the native "Quick Ship" rate (our UI extension handles selection).
 * 2. Routes between TWO free shipping rates so the native "Delivery details" box
 *    can differ by cart:
 *      - When ANY item is Quick Ship eligible for the destination zip: show the
 *        Quick Ship free rate (whose Delivery details holds the Quick Ship copy)
 *        and hide the standard free rate. The shown rate is renamed to the
 *        footnote label.
 *      - Otherwise: show the standard free rate (standard Delivery details) and
 *        hide the Quick Ship free rate.
 *
 *    The two free rates are told apart by NAME: the Quick Ship one must include
 *    the marker "(QS)" in its name in Shopify admin — e.g. "Free Standard
 *    Shipping (QS)". The marker must NOT contain "quick ship"/"quickship" (step 1
 *    would hide it), and the buyer never sees it, because the rate is renamed
 *    when shown.
 *
 *    SAFE TO DEPLOY BEFORE THE SECOND RATE EXISTS: if no "(QS)" rate is found,
 *    the function falls back to the original single-rate behavior — rename the
 *    one free rate when eligible, hide nothing. So you can deploy this first,
 *    then add the second rate and test, with no risk to the current checkout.
 *
 * Reads two variant metafields via the input query (run.graphql):
 *   - custom.quickship      → "true" / "false"
 *   - custom.quickship_zips → comma-separated zip codes
 */

// Title shown to the buyer on whichever free rate is presented when eligible.
// (Single place to change the pending wording.)
var RENAMED_TITLE = "Free Shipping";

/**
 * @typedef {{ value?: string | null } | null} Metafield
 * @typedef {{ quickship?: Metafield, quickshipZips?: Metafield }} Variant
 * @typedef {{ handle: string, title?: string | null }} DeliveryOption
 * @typedef {{ deliveryAddress?: { zip?: string | null } | null, deliveryOptions: DeliveryOption[] }} DeliveryGroup
 * @typedef {{ cart: { lines: Array<{ merchandise: any }>, deliveryGroups: DeliveryGroup[] } }} RunInput
 */

/**
 * @param {Variant} variant
 * @param {string} customerZip
 * @returns {boolean}
 */
function checkQuickShipEligibility(variant, customerZip) {
  var quickshipMeta = variant.quickship;
  if (!quickshipMeta || !quickshipMeta.value) {
    return false;
  }

  if (quickshipMeta.value.toLowerCase() !== "true") {
    return false;
  }

  var zipsMeta = variant.quickshipZips;
  if (!zipsMeta || !zipsMeta.value) {
    return false;
  }

  var zipList = zipsMeta.value.split(",");
  for (var i = 0; i < zipList.length; i++) {
    if (zipList[i].trim() === customerZip) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
function isQuickShipOption(title) {
  if (!title) return false;
  var lower = title.toLowerCase();
  return (
    lower.indexOf("quick ship") !== -1 || lower.indexOf("quickship") !== -1
  );
}

/**
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
function isFreeShippingOption(title) {
  if (!title) return false;
  var lower = title.toLowerCase();
  return (
    lower.indexOf("free shipping") !== -1 ||
    lower.indexOf("free standard shipping") !== -1
  );
}

/**
 * Identifies the Quick Ship free rate by the "(QS)" marker in its name.
 * Note: "(qs)" contains no "quick ship"/"quickship", so isQuickShipOption()
 * does NOT match it — it is never caught by the native-Quick-Ship hide above.
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
function isQuickShipFreeOption(title) {
  if (!title) return false;
  return title.toLowerCase().indexOf("(qs)") !== -1;
}

/**
 * @param {RunInput} input
 * @returns {{ operations: any[] }}
 */
export function run(input) {
  var operations = [];
  var cartLines = input.cart.lines;
  var groups = input.cart.deliveryGroups;

  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var zipField = group.deliveryAddress ? group.deliveryAddress.zip : null;
    var customerZip = zipField ? zipField.trim() : "";
    var deliveryOptions = group.deliveryOptions;

    // Step 1: ALWAYS hide the native Quick Ship rate.
    for (var j = 0; j < deliveryOptions.length; j++) {
      if (isQuickShipOption(deliveryOptions[j].title)) {
        operations.push({
          hide: { deliveryOptionHandle: deliveryOptions[j].handle },
        });
      }
    }

    // Identify the two free rates (skip the native Quick Ship rate; it's hidden).
    /** @type {DeliveryOption | null} */
    var qsFreeOpt = null;
    /** @type {DeliveryOption | null} */
    var standardFreeOpt = null;
    for (var f = 0; f < deliveryOptions.length; f++) {
      var opt = deliveryOptions[f];
      if (isQuickShipOption(opt.title)) {
        continue;
      }
      if (isQuickShipFreeOption(opt.title)) {
        qsFreeOpt = opt;
      } else if (isFreeShippingOption(opt.title)) {
        standardFreeOpt = opt;
      }
    }

    // Step 2: Is ANY cart line Quick Ship eligible for this zip?
    var anyEligible = false;
    if (customerZip) {
      for (var k = 0; k < cartLines.length; k++) {
        var merchandise = cartLines[k].merchandise;
        if (!merchandise || merchandise.__typename !== "ProductVariant") {
          continue;
        }
        if (checkQuickShipEligibility(merchandise, customerZip)) {
          anyEligible = true;
          break;
        }
      }
    }

    // Step 3: Route between the two free rates.
    if (anyEligible) {
      if (qsFreeOpt) {
        // Two-rate mode: show the Quick Ship rate (renamed), hide the standard one.
        operations.push({
          rename: {
            deliveryOptionHandle: qsFreeOpt.handle,
            title: RENAMED_TITLE,
          },
        });
        if (standardFreeOpt) {
          operations.push({
            hide: { deliveryOptionHandle: standardFreeOpt.handle },
          });
        }
      } else if (standardFreeOpt) {
        // Fallback (no "(QS)" rate created yet): original single-rate behavior.
        operations.push({
          rename: {
            deliveryOptionHandle: standardFreeOpt.handle,
            title: RENAMED_TITLE,
          },
        });
      }
    } else if (qsFreeOpt) {
      // Not eligible: hide the Quick Ship rate so only the standard one shows.
      operations.push({
        hide: { deliveryOptionHandle: qsFreeOpt.handle },
      });
    }
  }

  return { operations: operations };
}