function getOrderNumber(order, ...keys) {
  for (const key of keys) {
    const value = order?.[key];

    if (value !== undefined && value !== null && value !== "") {
      const numberValue = Number(value);

      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }

  return 0;
}

function calculateFundsChargeSummary(orders = []) {
  const filledOrders = orders.filter(order =>
    String(order.STATUS || order.Status || "").toLowerCase() === "filled"
  );

  let totalCharges = 0;
  let estimatedChargeCount = 0;

  filledOrders.forEach(order => {
    const action = String(order.ACTION || order.Action || "").toUpperCase();

    const quantity = getOrderNumber(
      order,
      "QUANTITY",
      "Quantity",
      "quantity"
    );

    const executedPrice = getOrderNumber(
      order,
      "EXECUTEDPRICE",
      "ExecutedPrice",
      "executedPrice",
      "PRICE",
      "Price",
      "price"
    );

    if (!action || quantity <= 0 || executedPrice <= 0) {
      return;
    }

    const turnover = quantity * executedPrice;
    const charges = calculateTradeCharges(turnover, action);

    totalCharges += charges.totalCharges;
    estimatedChargeCount++;
  });

  return {
    filledCount: filledOrders.length,
    estimatedChargeCount,
    totalCharges
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  bindLogout();
  activeNav("funds.html");

  const authenticated = await ensureAuthenticated();

  if (!authenticated) {
    return;
  }

  try {
    const account = await loadAccountSafe();

    let chargeSummary = {
      filledCount: 0,
      estimatedChargeCount: 0,
      totalCharges: 0
    };

    try {
      const response = await apiFetch(`${base_url}/api/orderbook`);

      if (response.ok) {
        const orders = await response.json();
        chargeSummary = calculateFundsChargeSummary(orders);
      }
    } catch {
      // Keep the funds page usable even if orderbook fails.
    }

    $("#fundSummary").innerHTML = `
      <div class="stat-card">
        <div class="label">Cash</div>
        <div class="value">${money(account.CASHBALANCE)}</div>
      </div>

      <div class="stat-card">
        <div class="label">Realized P&L</div>
        <div class="value ${account.REALIZEDPNL >= 0 ? "positive" : "negative"}">
          ${money(account.REALIZEDPNL)}
        </div>
      </div>

      <div class="stat-card">
        <div class="label">Filled Orders</div>
        <div class="value">${chargeSummary.filledCount}</div>
      </div>

      <div class="stat-card">
        <div class="label">Estimated Charges</div>
        <div class="value">${money(chargeSummary.totalCharges)}</div>
      </div>
    `;
  } catch (err) {
    showToast(err.message, "error");
  }

  const addFundsButton = $("#addFunds");
  const resetAccountButton = $("#resetAccount");

  if (addFundsButton) {
    addFundsButton.onclick = () => {
      showToast("Add a backend endpoint before enabling virtual deposits.", "info");
    };
  }

  if (resetAccountButton) {
    resetAccountButton.onclick = () => {
      showToast("Add a backend reset endpoint before enabling account reset.", "info");
    };
  }
});