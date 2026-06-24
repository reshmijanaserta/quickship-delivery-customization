// @ts-nocheck
import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<ThankYouMessage />, document.body);
};

function ThankYouMessage() {
  var attrs = shopify.attributes ? shopify.attributes.value : [];
  if (!attrs) attrs = [];

  var selectionsValue = "";
  var hasAttribute = false;
  for (var a = 0; a < attrs.length; a++) {
    if (attrs[a].key === "quickship_selections") {
      selectionsValue = attrs[a].value || "";
      hasAttribute = true;
      break;
    }
  }

  var hasQuickShip = hasAttribute && selectionsValue.length > 0;

  // Count Quick Ship selections
  var selectionsCount = 0;
  if (hasQuickShip) {
    selectionsCount = selectionsValue.split(",").length;
  }

  // Count total lines
  var lines = shopify.lines ? shopify.lines.value : [];
  var totalLines = lines ? lines.length : 0;

  // Scenario 1: All items are Quick Ship
  if (hasQuickShip && selectionsCount >= totalLines) {
    return (
      <s-banner tone="success">
        <s-stack gap="tight">
          <s-text emphasis="bold">Quick Ship Delivery Confirmed*</s-text>
          <s-text>All your items will be delivered via Quick Ship from a nearby warehouse. Check the order summary on the right for estimated delivery times.</s-text>
        </s-stack>
      </s-banner>
    );
  }

  // Scenario 2: Mixed cart — some Quick Ship, some Standard
  if (hasQuickShip && selectionsCount < totalLines) {
    return (
      <s-banner tone="success">
        <s-stack gap="tight">
          <s-text emphasis="bold">Your Delivery Preferences are Confirmed*</s-text>
          <s-text>Your selected delivery method for each item is shown in the order summary on the right. Items marked as Quick Ship will be delivered faster from a nearby warehouse. Other items will be shipped using our standard delivery service.</s-text>
        </s-stack>
      </s-banner>
    );
  }

  // Scenario 3: All Standard / normal orders (no Quick Ship selected or not eligible)
  return (
    <s-banner tone="info">
      <s-stack gap="tight">
        <s-text emphasis="bold">Standard Delivery Confirmed*</s-text>
        <s-text>Your items will be shipped using our standard delivery service. Bedding and accessories are shipped free via FedEx. All other products will be White Glove — free delivery and set up in the room of your choice. Check the order summary on the right for estimated delivery times.</s-text>
      </s-stack>
    </s-banner>
  );
}