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

async function readFundsResponseError(response) {
  try {
    const type = response.headers.get("content-type") || "";

    if (type.includes("application/json")) {
      const data = await response.json();

      return (
        data.MESSAGE ||
        data.message ||
        data.ERROR ||
        data.error ||
        JSON.stringify(data)
      );
    }

    return await response.text();
  } catch {
    return `HTTP ${response.status} - ${response.statusText}`;
  }
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

async function loadFundsDashboard() {
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
    // Keep the page usable even if orderbook fails.
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
}

async function addVirtualFunds(amount) {
  const response = await apiFetch(`${base_url}/api/Funds/add`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount
    })
  });

  const message = await response.text();

  if (!response.ok) {
    throw new Error(message || "Failed to add funds");
  }

  return message;
}

async function resetTradingAccount() {
  const response = await apiFetch(`${base_url}/api/Funds/reset`, {
    method: "PUT"
  });

  const message = await response.text();

  if (!response.ok) {
    throw new Error(message || "Failed to reset account");
  }

  return message;
}

function openModal(modal) {
  modal?.classList.remove("hidden");
}

function closeModal(modal) {
  modal?.classList.add("hidden");
}

function bindFundsActions() {
  const addFundsButton = $("#addFunds");
  const resetAccountButton = $("#resetAccount");

  const addFundsModal = $("#addFundsModal");
  const resetAccountModal = $("#resetAccountModal");

  const addFundsAmount = $("#addFundsAmount");
  const confirmAddFunds = $("#confirmAddFunds");

  const resetConfirmText = $("#resetConfirmText");
  const confirmResetAccount = $("#confirmResetAccount");

  if (addFundsButton) {
    addFundsButton.onclick = () => {
      addFundsAmount.value = "50000";
      openModal(addFundsModal);
      setTimeout(() => addFundsAmount.focus(), 60);
    };
  }

  $("#closeAddFundsModal").onclick = () => closeModal(addFundsModal);
  $("#cancelAddFunds").onclick = () => closeModal(addFundsModal);

  document.querySelectorAll("[data-amount]").forEach(button => {
    button.onclick = () => {
      addFundsAmount.value = button.dataset.amount;
      addFundsAmount.focus();
    };
  });

  confirmAddFunds.onclick = async () => {
    const amount = Number(addFundsAmount.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid amount greater than zero.", "error");
      return;
    }

    if (amount > 1000000) {
      showToast("Maximum virtual deposit is ₹10,00,000 per request.", "error");
      return;
    }

    confirmAddFunds.disabled = true;

    try {
      const message = await addVirtualFunds(amount);

      showToast(message || "Funds added", "success");
      closeModal(addFundsModal);

      await loadFundsDashboard();
    } catch (err) {
      showToast(err.message || "Failed to add funds", "error");
    } finally {
      confirmAddFunds.disabled = false;
    }
  };

  if (resetAccountButton) {
    resetAccountButton.onclick = () => {
      resetConfirmText.value = "";
      confirmResetAccount.disabled = true;
      openModal(resetAccountModal);
      setTimeout(() => resetConfirmText.focus(), 60);
    };
  }

  $("#closeResetAccountModal").onclick = () => closeModal(resetAccountModal);
  $("#cancelResetAccount").onclick = () => closeModal(resetAccountModal);

  resetConfirmText.oninput = () => {
    confirmResetAccount.disabled = resetConfirmText.value !== "RESET";
  };

  confirmResetAccount.onclick = async () => {
    if (resetConfirmText.value !== "RESET") {
      showToast("Type RESET to confirm.", "error");
      return;
    }

    confirmResetAccount.disabled = true;

    try {
      const message = await resetTradingAccount();

      showToast(message || "Account reset", "success");
      closeModal(resetAccountModal);

      await loadFundsDashboard();
    } catch (err) {
      showToast(err.message || "Failed to reset account", "error");
    } finally {
      confirmResetAccount.disabled = false;
    }
  };

  [addFundsModal, resetAccountModal].forEach(modal => {
    modal?.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    closeModal(addFundsModal);
    closeModal(resetAccountModal);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindLogout();
  activeNav("funds.html");

  const authenticated = await ensureAuthenticated();

  if (!authenticated) {
    return;
  }

  try {
    await loadFundsDashboard();
    bindFundsActions();
  } catch (err) {
    showToast(err.message || "Failed to load funds page", "error");
  }
});