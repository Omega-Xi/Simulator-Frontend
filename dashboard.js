const host = "localhost";
const base_url = window.TELOTRADE_API_BASE_URL || (location.port === "7239" ? location.origin : `https://${host}:7239`);
const TRADE_CHARGE_CONFIG = window.TELOTRADE_CHARGES;
const PRESET_STORAGE_KEY = "tt_presetOrderSettings";
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 10_000;
const PRICE_ALERT_STORAGE_KEY = "tt_priceAlerts";
const PRICE_ALERT_COOLDOWN_MS = 20000;
const ALERT_SOUND_VOLUME = 0.85;
const ORDER_LINE_DRAG_TOLERANCE_PX = 9;
const CHART_STYLE_STORAGE_KEY = "tt_chartStyle";
const INDICATOR_STORAGE_KEY = "tt_indicatorSettings";

let activeChartStyle = localStorage.getItem(CHART_STYLE_STORAGE_KEY) || "candles";
let rawCandleData = [];

let indicatorSettings = {
  ema9: true,
  ema21: true,
  ema50: false,
  vwap: true,
  bollinger: false
};
let indicatorSeries = {};
let activeOrderLineDrag = null;
let orderLineDragBound = false;
let chartOrderMode = false;
let chartOrderPreviewLine = null;
let chartOrderPopup = null;
let hoveredOrderLineItem = null;
let orderLineCancelPopup = null;
let alertAudioContext = null;
let alertMasterGain = null;
let priceAlerts = [];
let priceAlertLines = [];
let chartStrategyPreviewLines = [];
let chartAlertMode = false;
let accessRefreshTimer = null;
let token = sessionStorage.getItem("token"), refreshPromise = null, ws = null, wsReconnectTimer = null;
let selectedsymbol = localStorage.getItem("tt_selectedSymbol") || "", currentLotSize = 0, selectedtimeframe = Number(localStorage.getItem("tt_timeframe") || 1),
  candleBuckets = {}, smaVisible = JSON.parse(localStorage.getItem("tt_smaVisible") ?? "true"), filledOrderVisible = JSON.parse(localStorage.getItem("tt_filledOrdersVisible") ?? "false"),
  crosshairActive = false, allOrders = [], pendingLines = [], triggerLines = [], avgPositionLines = [],
  pnlPositionLines = [], allHoldings = [], currentOrderId = "", currentModifyOrder = null, totalCashMargin = 0, selectedOrderSide = "BUY";
const allLTP = {}, allLTPPrevious = {}, watchlistStorageKey = "tt_watchlist", orderFilterState = {
  status: "all", search: "", sortBy: "time"
};
let currentLTP = 0, chart, candleSeries, volumeSeries, smaSeries, tooltip, smaTooltip, legend;
let isChartFullscreen = false, compactMode = JSON.parse(localStorage.getItem("tt_compactMode") ?? "false");
let presetSettings = {
  budgetEnabled: false,
  budgetAmount: 0,

  riskEnabled: false,
  riskAmount: 0,

  stopMode: "percent", 
  // percent | atr | fixed

  stopPercent: 1,
  fixedStopAmount: 5,

  atrPeriod: 14,
  atrMultiplier: 1.5,

  targetEnabled: true,
  targetMode: "rr",
  // rr | percent | fixed

  riskRewardRatio: 2,
  targetPercent: 2,
  fixedTargetAmount: 10,

  placeStopLoss: false,
  placeTarget: false,

  applyToChartStrategies: true,
  confirmBeforeSend: true
};
const els = {};
document.addEventListener("DOMContentLoaded", async () => {
  cacheDom();
  loadPresetSettings();
  loadPriceAlerts();
  loadIndicatorSettings();
  setupAlertAudioUnlock();
  if (!token) {
    try {
      token = await refreshAccessToken()
    }
    catch {
      location.href = "signin.html"; return
    }
  }
  else if (isTokenExpiringSoon(token, 30_000)) {
    try {
      token = await refreshAccessToken();
    } catch {
      location.href = "signin.html";
      return;
    }
  } else {
    scheduleAccessTokenRefresh(token);
  }
  setupChart();
  setupEventHandlers();
  syncChartStyleInput();
  syncIndicatorInputs();
  setupKeyboardShortcuts();
  restoreUiPreferences();
  setCompactMode(compactMode, false);
  setOrderSide("BUY");
  syncOrderProductUi(true);
  updateMarketStatus();
  setInterval(updateMarketStatus, 3e4);
  await loadUserData();
  await fetchOrderBook();
  restoreWatchlist();
  connectWebSocket();
}
);
window.addEventListener("resize", () => {
  resizeChartToContainer(true)
}
);
function cacheDom() {
  ["watchlistTable",
    "watchlistBody",
    "watchlistEmpty",
    "chart",
    "buyBtn",
    "sellBtn",
    "orderLot",
    "orderType",
    "orderProduct",
    "orderTypeLabel",
    "limitPriceLabel",
    "triggerPriceLabel",
    "targetPriceField",
    "targetPriceLabel",
    "targetPrice",
    "coverOrderHelp",
    "limitPrice",
    "triggerPrice",
    "lotInfo",
    "estimateBox",
    "ticketMeta",
    "ticketSymbol",
    "logoutBtn",
    "addToWatchlistBtn",
    "stockModal",
    "closeStockModal",
    "stockList",
    "stockSearch",
    "shortcutModal",
    "shortcutHelpBtn",
    "closeShortcutModal",
    "sortBy",
    "orderSearch",
    "orderTabs",
    "submitOrderBtn",
    "chartStyleSelect",
    "indicatorMenuBtn",
    "indicatorMenu",
    "toggleFullscreenChart",
    "toggleChartAlertMode",
    "toggleChartOrderMode",
    "presetSettingsBtn",
    "presetModal",
    "closePresetModal",
    "presetBudgetEnabled",
    "presetBudgetAmount",
    "presetRiskEnabled",
    "presetRiskAmount",
    "presetStopMode",
    "presetStopPercent",
    "presetFixedStopAmount",
    "presetTargetMode",
    "presetTargetPercent",
    "presetFixedTargetAmount",
    "presetApplyToChartStrategies",
    "presetAtrPeriod",
    "presetAtrMultiplier",
    "presetTargetEnabled",
    "presetRiskRewardRatio",
    "presetPlaceStopLoss",
    "presetPlaceTarget",
    "presetConfirm",
    "presetValidation",
    "resetPresetSettings",
    "savePresetSettings"].forEach(id => els[id] = document.getElementById(id));
  tooltip = document.getElementById("chartTooltip");
  legend = document.getElementById("chartLegend")
}
function setupEventHandlers() {
  els.buyBtn.onclick = () => setOrderSide("BUY");
  els.sellBtn.onclick = () => setOrderSide("SELL");
  els.submitOrderBtn.onclick = () => submitSelectedOrder();
  if (els.toggleFullscreenChart) els.toggleFullscreenChart.onclick = toggleChartFullscreen;
  if (els.presetSettingsBtn) els.presetSettingsBtn.onclick = openPresetModal;
  if (els.closePresetModal) els.closePresetModal.onclick = closePresetModal;
  if (els.savePresetSettings) els.savePresetSettings.onclick = savePresetSettingsFromModal;
  if (els.resetPresetSettings) els.resetPresetSettings.onclick = resetPresetSettings;
  if (els.toggleChartAlertMode) els.toggleChartAlertMode.onclick = toggleChartAlertMode;
  if (els.toggleChartOrderMode) els.toggleChartOrderMode.onclick = toggleChartOrderMode;
  if (els.chartStyleSelect) {
    els.chartStyleSelect.onchange = () => {
      changeChartStyle(els.chartStyleSelect.value);
    };
  }
  if (els.indicatorMenuBtn) {
    els.indicatorMenuBtn.onclick = () => {
      els.indicatorMenu?.classList.toggle("hidden");
    };
  }
  document.addEventListener("click", event => {
    if (!els.indicatorMenu || !els.indicatorMenuBtn) return;

    const clickedMenu = els.indicatorMenu.contains(event.target);
    const clickedButton = els.indicatorMenuBtn.contains(event.target);

    if (!clickedMenu && !clickedButton) {
      els.indicatorMenu.classList.add("hidden");
    }
  });
  document.querySelectorAll("[data-indicator]").forEach(input => {
    input.addEventListener("change", () => {
      const key = input.dataset.indicator;

      indicatorSettings[key] = input.checked;

      saveIndicatorSettings();
      applyIndicators();
    });
  });
  [
    els.presetBudgetEnabled,
    els.presetRiskEnabled,
    els.presetTargetEnabled,
    els.presetStopMode,
    els.presetTargetMode,
    els.presetPlaceStopLoss,
    els.presetPlaceTarget,
    els.presetApplyToChartStrategies
  ].forEach(input => {
    if (input) {
      input.addEventListener("change", updatePresetFieldStates);
    }
  });
  if (els.presetModal) {
    els.presetModal.addEventListener("click", event => {
      if (event.target === els.presetModal) {
        closePresetModal();
      }
    })
  }
  if (els.orderLot) {
    els.orderLot.addEventListener("input", () => {
      updateEstimatedAmount({ LTP: currentLTP });
    });
  }

  if (els.limitPrice) {
    els.limitPrice.addEventListener("input", () => {
      if (isStrategyOrderMode() && els.orderType.value === "limit") {
        refreshStrategyTicketDefaultsFromEntry();
        return;
      }

      updateEstimatedAmount({ LTP: currentLTP });
    });
  }

  if (els.triggerPrice) {
    els.triggerPrice.addEventListener("input", () => {
      if (isBracketOrderMode() && els.targetPrice && presetSettings.targetMode === "rr") {
        const entryPrice = getStrategyEntryPrice();
        const stopPrice = parseFloat(els.triggerPrice.value) || 0;

        const targetPrice = getDefaultBracketTarget(
          selectedOrderSide,
          entryPrice,
          stopPrice
        );

        if (targetPrice) {
          els.targetPrice.value = targetPrice;
        }
      }

      updateEstimatedAmount({ LTP: currentLTP });
    });
  }

  if (els.targetPrice) {
    els.targetPrice.addEventListener("input", () => {
      updateEstimatedAmount({ LTP: currentLTP });
    });
  }
  if (els.orderProduct) {
    els.orderProduct.onchange = () => {
      syncOrderProductUi(true);
    };
  }

  els.orderType.onchange = () => {
    fillOrderForm(els.orderType.value, true);
    updateEstimatedAmount({
      LTP: currentLTP
    });
  };
  document.querySelectorAll("#timeframeSelector button").forEach(btn => btn.onclick = async () => {
    selectedtimeframe = Number(btn.dataset.tf); localStorage.setItem("tt_timeframe", selectedtimeframe); document.querySelectorAll("#timeframeSelector button").forEach(b => b.classList.remove("active")); btn.classList.add("active"); clearBuckets(); if (selectedsymbol) {
      await getCandleData(); plotFilledOrders(); plotOrderLines(); plotPositionLines()
    }
  }
  );
  document.getElementById("toggleSMA").onclick = () => {
    smaVisible = !smaVisible;
    localStorage.setItem("tt_smaVisible", JSON.stringify(smaVisible));
    if (smaVisible) {
      const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time);
      smaSeries.setData(calculateSMA(candles, 3));
      document.getElementById("toggleSMA").classList.add("active")
    }
    else {
      smaSeries.setData([]);
      document.getElementById("toggleSMA").classList.remove("active")
    }
  };
  document.getElementById("toggleFilledOrders").onclick = () => {
    filledOrderVisible = !filledOrderVisible;
    localStorage.setItem("tt_filledOrdersVisible", JSON.stringify(filledOrderVisible));
    if (filledOrderVisible) {
      plotFilledOrders();
      document.getElementById("toggleFilledOrders").classList.add("active")
    }
    else {
      candleSeries.setMarkers([]);
      document.getElementById("toggleFilledOrders").classList.remove("active")
    }
  };
  els.addToWatchlistBtn.onclick = openStockListModal;
  els.closeStockModal.onclick = () => els.stockModal.classList.add("hidden");
  els.stockSearch.oninput = filterStockList;
  els.shortcutHelpBtn.onclick = openShortcutHelp;
  els.closeShortcutModal.onclick = closeShortcutHelp;
  els.shortcutModal.onclick = e => {
    if (e.target === els.shortcutModal) closeShortcutHelp()
  };
  els.orderTabs.onclick = e => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;
    orderFilterState.status = btn.dataset.status;
    document.querySelectorAll("#orderTabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    applyFilterAndSort()
  };
  els.orderSearch.oninput = () => {
    orderFilterState.search = els.orderSearch.value.trim().toLowerCase();
    applyFilterAndSort()
  };
  els.sortBy.onchange = () => {
    orderFilterState.sortBy = els.sortBy.value;
    applyFilterAndSort()
  };
  els.logoutBtn.onclick = logOut;
  document.getElementById("modifyDropdown").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault(); modifyOrder()
    }
  }
  )
}
function restoreUiPreferences() {
  document.querySelectorAll("#timeframeSelector button").forEach(btn => btn.classList.toggle("active", Number(btn.dataset.tf) === selectedtimeframe));
  document.getElementById("toggleSMA").classList.toggle("active", smaVisible);
  document.getElementById("toggleFilledOrders").classList.toggle("active", filledOrderVisible)
}
function decodeJwtPayload(jwt) {
  try {
    const payload = jwt.split(".")[1];

    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const json = decodeURIComponent(
      atob(normalized)
        .split("")
        .map(char => {
          return "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2);
        })
        .join("")
    );

    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getJwtExpiryMs(jwt) {
  const payload = decodeJwtPayload(jwt);

  if (!payload?.exp) {
    return null;
  }

  return Number(payload.exp) * 1000;
}

function isTokenExpiringSoon(jwt, skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS) {
  const expiryMs = getJwtExpiryMs(jwt);

  if (!expiryMs) {
    return true;
  }

  return Date.now() >= expiryMs - skewMs;
}
function scheduleAccessTokenRefresh(jwt = token) {
  clearTimeout(accessRefreshTimer);

  const expiryMs = getJwtExpiryMs(jwt);

  if (!expiryMs) {
    return;
  }

  const delay = Math.max(
    MIN_REFRESH_DELAY_MS,
    expiryMs - Date.now() - ACCESS_TOKEN_REFRESH_SKEW_MS
  );

  accessRefreshTimer = setTimeout(async () => {
    try {
      await refreshAccessToken();

      reconnectWebSocketAfterTokenRefresh();
    } catch {
      sessionStorage.removeItem("token");
      location.href = "signin.html";
    }
  }, delay);
}

function reconnectWebSocketAfterTokenRefresh() {
  if (!ws) {
    connectWebSocket();
    return;
  }

  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    ws.onclose = null;

    try {
      ws.close(1000, "Refreshing access token");
    } catch { }
  }

  ws = null;
  connectWebSocket();
}
async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${base_url}/api/account/refresh?useCookie=true`, {
      method: "POST",
      credentials: "include"
    })
      .then(async res => {
        if (!res.ok) {
          throw new Error("Session expired");
        }

        return res.json();
      })
      .then(data => {
        token = data.TOKEN || data.token;

        if (!token) {
          throw new Error("No token returned");
        }

        sessionStorage.setItem("token", token);
        scheduleAccessTokenRefresh(token);

        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}
async function apiFetch(url, options = {}, retry = true) {
  if (!token || isTokenExpiringSoon(token, 15_000)) {
    token = await refreshAccessToken();
  }
  const headers = {
    ...(options.headers || {}), Authorization: `Bearer ${token}`
  };
  const res = await fetch(url, {
    ...options, headers, credentials: "include"
  }
  );
  if (res.status === 401 && retry) {
    try {
      const newToken = await refreshAccessToken();
      return apiFetch(url, {
        ...options, headers: {
          ...(options.headers || {}), Authorization: `Bearer ${newToken}`
        }
      }, false)
    }
    catch {
      sessionStorage.removeItem("token");
      location.href = "signin.html";
      throw new Error("Session expired")
    }
  }
  return res
}
async function readResponseError(res) {
  const type = res.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const data = await res.json();
      return data.MESSAGE || data.message || data.ERROR || data.error || (data.ERRORS || []).join(", ") || JSON.stringify(data)
    }
    return await res.text()
  }
  catch {
    return `HTTP ${res.status} - ${res.statusText}`
  }
}
function getWsUrl() {
  const api = new URL(base_url);
  const scheme = api.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${api.host}/ws?token=${encodeURIComponent(token)}`
}
async function connectWebSocket() {
  clearTimeout(wsReconnectTimer);
  if (!token || isTokenExpiringSoon(token, 15_000)) {
    try {
      token = await refreshAccessToken()
    }
    catch {
      location.href = "signin.html";
      return
    }
  }
  updateFeedStatus("connecting");
  ws = new WebSocket(getWsUrl());
  ws.onopen = () => {
    updateFeedStatus("live");
    showToast("Market feed connected", "success");
    resubscribeWatchlist()
  };
  ws.onmessage = handleWebSocketMessage;
  ws.onclose = () => {
    updateFeedStatus("offline");
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(async () => {
      try {
        await refreshAccessToken(); connectWebSocket()
      }
      catch {
        location.href = "signin.html"
      }
    }, 1500)
  };
  ws.onerror = () => updateFeedStatus("offline")
}
function handleWebSocketMessage(event) {
  let data;
  try {
    data = JSON.parse(event.data)
  }
  catch {
    return
  }
  if (data.TYPE === "HeartBeat") {
    pulseHeader();
    return
  }
  if (data.TYPE === "system") {
    showToast(data.MESSAGE || "System message", "info");
    return
  }
  if (data.TYPE === "trade_execution") {
    showToast(`${data.DATA.ACTION} ${data.DATA.STATUS}: ${data.DATA.SYMBOL}`, "success");
    loadUserData();
    fetchOrderBook();
    return
  }
  if (data.TYPE === "order_trigger") {
    showToast(`${data.DATA.Action || data.DATA.ACTION} triggered for ${data.DATA.SYMBOL}`, "info");
    loadUserData();
    fetchOrderBook();
    return
  }
  if (data.TYPE === "live_feed") {
    const ticks = data.DATA || [];
    updateWatchlist(ticks);
    ticks.forEach(processTick);
    const selectedTick = ticks.find(t => t.SYMBOL === selectedsymbol);
    if (selectedTick) updateEstimatedAmount(selectedTick);
    if (allLTP[selectedsymbol] !== undefined) {
      currentLTP = allLTP[selectedsymbol];
      updateSelectedSymbolSummary()
    }
  }
}
function resubscribeWatchlist() {
  const symbols = getStoredWatchlist();
  if (symbols.length && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
    action: "SUBSCRIBE", symbols
  }
  ))
}
function updateFeedStatus(state) {
  const chip = document.getElementById("feedStatus"), dot = chip.querySelector(".statusDot");
  dot.className = `statusDot ${state === "live" ? "live" : state === "connecting" ? "connecting" : "offline"}`;
  chip.querySelector("span:last-child").textContent = state === "live" ? "Feed Live" : state === "connecting" ? "Connecting" : "Feed Offline"
}
function pulseHeader() {
  document.querySelector(".topBar")?.animate([{
    boxShadow: "0 0 0 rgba(201,169,110,0)"
  }, {
    boxShadow: "0 0 28px rgba(181, 150, 92, 0.37)"
  }, {
    boxShadow: "0 0 0 rgba(201,169,110,0)"
  }
  ], {
    duration: 1e3, easing: "ease-out"
  }
  )
}
function setupChart() {
  chart = LightweightCharts.createChart(els.chart, {
    width: els.chart.clientWidth, height: els.chart.clientHeight, layout: {
      background: {
        color: "#090b0f"
      }, textColor: "#95a0b3"
    }, grid: {
      vertLines: {
        color: "rgba(255,255,255,0.04)"
      }, horzLines: {
        color: "rgba(255,255,255,0.04)"
      }
    }, rightPriceScale: {
      borderColor: "rgba(255,255,255,0.08)"
    }, timeScale: {
      borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false
    }, crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal, horzLine: {
        color: "#8b949e", style: LightweightCharts.LineStyle.Dashed, width: 1, labelVisible: true
      }, vertLine: {
        color: "#8b949e", style: LightweightCharts.LineStyle.Dashed, width: 1, labelVisible: true
      }
    }
  }
  );
  candleSeries = createPriceSeries(activeChartStyle);
  volumeSeries = chart.addHistogramSeries({
    priceFormat: {
      type: "volume"
    }, priceScaleId: "volume"
  }
  );
  smaSeries = chart.addLineSeries({
    color: "#c9a96e", lineWidth: 1, crossHairMarkerVisible: false
  }
  );
  chart.priceScale("right").applyOptions({
    scaleMargins: {
      top: .12, bottom: .28
    }
  }
  );
  chart.priceScale("volume").applyOptions({
    scaleMargins: {
      top: .82, bottom: 0
    }
  }
  );
  chart.applyOptions({
    localization: {
      timeFormatter: t => new Date(t * 1e3).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
      }
      )
    }
  }
  );
  smaTooltip = document.createElement("div");
  smaTooltip.className = "sma-tooltip";
  els.chart.appendChild(smaTooltip);
  chart.subscribeCrosshairMove(onCrosshairMove);
  chart.subscribeClick(handleChartAlertClick);
  chart.subscribeClick(handleChartOrderClick);
  setupDraggableOrderLines();
  els.chart.addEventListener("dblclick", resetChartView)
}
function createPriceSeries(style) {
  if (style === "bars") {
    return chart.addBarSeries({
      priceScaleId: "right",
      upColor: "#00c076",
      downColor: "#ff4d5a"
    });
  }

  if (style === "line") {
    return chart.addLineSeries({
      priceScaleId: "right",
      color: "#d9b87a",
      lineWidth: 2,
      crossHairMarkerVisible: true
    });
  }

  if (style === "area") {
    return chart.addAreaSeries({
      priceScaleId: "right",
      lineColor: "#d9b87a",
      topColor: "rgba(201, 169, 110, 0.26)",
      bottomColor: "rgba(201, 169, 110, 0.02)",
      lineWidth: 2
    });
  }

  if (style === "hollow") {
    return chart.addCandlestickSeries({
      priceScaleId: "right",
      upColor: "rgba(0, 192, 118, 0.04)",
      downColor: "#ff4d5a",
      borderVisible: true,
      borderUpColor: "#00c076",
      borderDownColor: "#ff4d5a",
      wickUpColor: "#00c076",
      wickDownColor: "#ff4d5a"
    });
  }

  if (style === "heikinashi") {
    return chart.addCandlestickSeries({
      priceScaleId: "right",
      upColor: "#00c076",
      downColor: "#ff4d5a",
      wickUpColor: "#00c076",
      wickDownColor: "#ff4d5a",
      borderVisible: false
    });
  }

  return chart.addCandlestickSeries({
    priceScaleId: "right",
    upColor: "#00c076",
    downColor: "#ff4d5a",
    wickUpColor: "#00c076",
    wickDownColor: "#ff4d5a",
    borderVisible: false
  });
}
function syncChartStyleInput() {
  if (els.chartStyleSelect) {
    els.chartStyleSelect.value = activeChartStyle;
  }
}
function isLineBasedChartStyle(style = activeChartStyle) {
  return style === "line" || style === "area";
}
function getDisplayedCandles() {
  if (activeChartStyle === "heikinashi") {
    return calculateHeikinAshiCandles(rawCandleData);
  }

  return rawCandleData;
}
function toPriceSeriesPoint(candle) {
  if (isLineBasedChartStyle()) {
    return {
      time: candle.time,
      value: Number(candle.close)
    };
  }

  return {
    time: candle.time,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  };
}
function getPriceSeriesData() {
  return getDisplayedCandles().map(toPriceSeriesPoint);
}
function renderPriceSeries() {
  if (!candleSeries) return;
  candleSeries.setData(getPriceSeriesData());
}
function changeChartStyle(nextStyle) {
  if (!nextStyle || nextStyle === activeChartStyle) return;
  if (activeOrderLineDrag){
    cancelOrderLineDrag();
  }
  activeChartStyle = nextStyle;
  localStorage.setItem(CHART_STYLE_STORAGE_KEY, activeChartStyle);
  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  clearChartOrderPreview();
  try {
    chart.removeSeries(candleSeries);
  } catch { }

  pendingLines = [];
  triggerLines = [];
  avgPositionLines = [];
  pnlPositionLines = [];
  priceAlertLines = [];
  candleSeries = createPriceSeries(activeChartStyle);

  renderPriceSeries();
  applyIndicators();
  plotFilledOrders();
  plotOrderLines();
  plotPositionLines();
  syncPriceAlertLines();

  if (visibleRange) {
    chart.timeScale().setVisibleLogicalRange(visibleRange);
  }

  if (activeChartStyle === "heikinashi") {
    showToast("Heikin Ashi uses synthetic candles. Orders still use real prices.", "info");
  } else {
    showToast(`Chart style changed to ${getChartStyleLabel(activeChartStyle)}`, "info");
  }
}
function getChartStyleLabel(style) {
  const labels = {
    candles: "Candles",
    hollow: "Hollow candles",
    bars: "Bars",
    line: "Line",
    area: "Area",
    heikinashi: "Heikin Ashi"
  };

  return labels[style] || style;
}
function calculateHeikinAshiCandles(candles) {
  const result = [];

  candles.forEach((candle, index) => {
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);

    const haClose = (open + high + low + close) / 4;

    const previous = result[index - 1];

    const haOpen = previous
      ? (previous.open + previous.close) / 2
      : (open + close) / 2;

    const haHigh = Math.max(high, haOpen, haClose);
    const haLow = Math.min(low, haOpen, haClose);

    result.push({
      time: candle.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: Number(candle.volume || 0)
    });
  });

  return result;
}
function onCrosshairMove(param) {
  if (!param.point || !param.time) {
    crosshairActive = false;
    tooltip.style.display = "none";
    smaTooltip.style.display = "none";
    return
  }
  const candleData = getRawCandleByTime(param.time);
  const volumeData = param.seriesData.get(volumeSeries);
  const smaData = param.seriesData.get(smaSeries);
  if (!candleData) {
    tooltip.style.display = "none";
    return
  }
  crosshairActive = true;
  const priceCoordinate = candleSeries.priceToCoordinate(candleData.high), timeCoordinate = chart.timeScale().timeToCoordinate(candleData.time);
  if (priceCoordinate === null || timeCoordinate === null) {
    tooltip.style.display = "none";
    return
  }
  const pct = ((candleData.close - candleData.open) / candleData.open) * 100;
  tooltip.style.display = "block";
  tooltip.style.left = `${timeCoordinate + 10}px`;
  tooltip.style.top = `${priceCoordinate - 32}px`;
  tooltip.textContent = `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
  tooltip.style.color = pct >= 0 ? "#00c076" : "#ff4d5a";
  legend.innerHTML = `<div><strong>${selectedsymbol || "--"}</strong><br>Time: ${new Date(candleData.time * 1e3).toLocaleTimeString("en-IN")}</div><div>O: ${fmtNum(candleData.open)} H: ${fmtNum(candleData.high)} L: ${fmtNum(candleData.low)} C: ${fmtNum(candleData.close)}</div><div>Vol: ${volumeData ? Number(volumeData.value).toLocaleString("en-IN") : "-"}</div>`;
  if (smaData) {
    const y = smaSeries.priceToCoordinate(smaData.value), x = chart.timeScale().timeToCoordinate(smaData.time);
    if (y !== null && x !== null) {
      smaTooltip.textContent = `SMA: ${fmtNum(smaData.value)}`;
      smaTooltip.style.left = `${x + 24}px`;
      smaTooltip.style.top = `${y - 16}px`;
      smaTooltip.style.display = "block"
    }
    else smaTooltip.style.display = "none"
  }
  else smaTooltip.style.display = "none"
}
function getRawCandleByTime(time) {
  const numericTime = Number(time);

  return rawCandleData.find(candle => Number(candle.time) === numericTime)
    || candleBuckets[numericTime]
    || null;
}

function loadPriceAlerts() {
  try {
    priceAlerts = JSON.parse(localStorage.getItem(PRICE_ALERT_STORAGE_KEY) || "[]");
  } catch {
    priceAlerts = [];
    localStorage.removeItem(PRICE_ALERT_STORAGE_KEY);
  }
}
function savePriceAlerts() {
  localStorage.setItem(PRICE_ALERT_STORAGE_KEY, JSON.stringify(priceAlerts));
}
function createPriceAlertId() {
  return `ALERT_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
function toggleChartAlertMode() {
  chartAlertMode = !chartAlertMode;

  if (chartAlertMode && typeof chartOrderMode !== "undefined") {
    chartOrderMode = false;
    els.toggleChartOrderMode?.classList.remove("active");
    els.chart?.classList.remove("orderMode");
    clearChartOrderPreview();
  }

  els.toggleChartAlertMode?.classList.toggle("active", chartAlertMode);
  els.chart?.classList.toggle("alertMode", chartAlertMode);

  showToast(
    chartAlertMode
      ? "Alert mode enabled. Click a price level on the chart."
      : "Alert mode disabled.",
    "info"
  );
}
function handleChartAlertClick(param) {
  if (!chartAlertMode) return;

  if (!selectedsymbol) {
    showToast("Select a symbol before setting an alert", "error");
    return;
  }

  if (!param.point || !candleSeries) {
    return;
  }

  const clickedPrice = candleSeries.coordinateToPrice(param.point.y);

  if (!clickedPrice || clickedPrice <= 0) {
    return;
  }

  const alertPrice = roundToTick(clickedPrice);
  const existingAlert = findNearbyPriceAlert(selectedsymbol, alertPrice);

  if (existingAlert) {
    const ok = confirm(
      `Remove alert for ${existingAlert.symbol} at ${formatMoney(existingAlert.targetPrice)}?`
    );

    if (!ok) return;

    removePriceAlert(existingAlert.id);
    showToast("Price alert removed", "info");
    return;
  }

  const ltp = Number(currentLTP || allLTP[selectedsymbol] || 0);

  const condition = ltp && alertPrice >= ltp
    ? "above"
    : "below";

  const conditionText = condition === "above"
    ? "at or above"
    : "at or below";

  const ok = confirm(
    `Create alert?\n\n${selectedsymbol} ${conditionText} ${formatMoney(alertPrice)}`
  );

  if (!ok) return;

  const alert = {
    id: createPriceAlertId(),
    symbol: selectedsymbol,
    condition,
    targetPrice: alertPrice,
    repeat: false,
    enabled: true,
    createdAt: Date.now(),
    lastTriggeredAt: 0,
    lastPrice: ltp || null
  };

  priceAlerts.push(alert);
  savePriceAlerts();
  syncPriceAlertLines();

  showToast(
    `${selectedsymbol} alert set ${conditionText} ${formatMoney(alertPrice)}`,
    "success"
  );
}
function findNearbyPriceAlert(symbol, price) {
  const tolerance = Math.max(Number(price) * 0.001, 0.05);

  return priceAlerts.find(alert =>
    alert.enabled &&
    alert.symbol === symbol &&
    Math.abs(Number(alert.targetPrice) - Number(price)) <= tolerance
  );
}
function removePriceAlert(alertId) {
  priceAlerts = priceAlerts.filter(alert => alert.id !== alertId);
  savePriceAlerts();
  syncPriceAlertLines();
}
function syncPriceAlertLines() {
  if (!candleSeries) return;

  priceAlertLines.forEach(line => {
    try {
      candleSeries.removePriceLine(line);
    } catch { }
  });

  priceAlertLines = [];

  if (!selectedsymbol) return;

  const symbolAlerts = priceAlerts.filter(alert =>
    alert.enabled &&
    alert.symbol === selectedsymbol
  );

  symbolAlerts.forEach(alert => {
    const title = alert.condition === "above"
      ? `Alert ≥ ${fmtNum(alert.targetPrice)}`
      : `Alert ≤ ${fmtNum(alert.targetPrice)}`;

    const line = candleSeries.createPriceLine({
      price: Number(alert.targetPrice),
      color: "#4da3ff",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title
    });

    priceAlertLines.push(line);
  });
}
function evaluatePriceAlerts(tick) {
  const symbol = String(tick.SYMBOL || "").toUpperCase();
  const ltp = Number(tick.LTP);

  if (!symbol || !Number.isFinite(ltp)) return;

  let changed = false;

  priceAlerts.forEach(alert => {
    if (!alert.enabled) return;
    if (alert.symbol !== symbol) return;

    const targetPrice = Number(alert.targetPrice);
    const previousPrice = Number(alert.lastPrice);
    const now = Date.now();

    if (!targetPrice || targetPrice <= 0) {
      alert.enabled = false;
      changed = true;
      return;
    }

    if (now - Number(alert.lastTriggeredAt || 0) < PRICE_ALERT_COOLDOWN_MS) {
      alert.lastPrice = ltp;
      changed = true;
      return;
    }

    let triggered = false;

    if (alert.condition === "above") {
      triggered = previousPrice
        ? previousPrice < targetPrice && ltp >= targetPrice
        : ltp >= targetPrice;
    }

    if (alert.condition === "below") {
      triggered = previousPrice
        ? previousPrice > targetPrice && ltp <= targetPrice
        : ltp <= targetPrice;
    }

    alert.lastPrice = ltp;

    if (!triggered) {
      changed = true;
      return;
    }

    alert.lastTriggeredAt = now;

    playPriceAlertSound(alert.condition);

    showToast(
      `${alert.symbol} ${alert.condition === "above" ? "reached" : "fell to"} ${formatMoney(targetPrice)} · LTP ${formatMoney(ltp)}`,
      "info"
    );

    if (!alert.repeat) {
      alert.enabled = false;
    }

    changed = true;
  });

  if (changed) {
    savePriceAlerts();

    if (symbol === selectedsymbol) {
      syncPriceAlertLines();
    }
  }
}
function setupAlertAudioUnlock() {
  const unlock = async () => {
    await ensureAlertAudioContext();
  };

  document.addEventListener("click", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}
async function ensureAlertAudioContext() {
  if (!alertAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      showToast("Audio alerts are not supported in this browser", "error");
      return null;
    }

    alertAudioContext = new AudioContextClass();

    alertMasterGain = alertAudioContext.createGain();
    alertMasterGain.gain.value = ALERT_SOUND_VOLUME;
    alertMasterGain.connect(alertAudioContext.destination);
  }

  if (alertAudioContext.state === "suspended") {
    await alertAudioContext.resume();
  }

  return alertAudioContext;
}
async function playPriceAlertSound(type = "above") {
  const ctx = await ensureAlertAudioContext();

  if (!ctx || !alertMasterGain) return;

  const now = ctx.currentTime;

  const pattern = type === "below"
    ? [740, 520, 360, 260]
    : [520, 720, 920, 1120];

  pattern.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    const start = now + index * 0.16;
    const peak = start + 0.025;
    const end = start + 0.14;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.55, peak);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(alertMasterGain);

    oscillator.start(start);
    oscillator.stop(end);
  });
}

function toggleChartOrderMode() {
  chartOrderMode = !chartOrderMode;

  if (chartOrderMode && typeof chartAlertMode !== "undefined") {
    chartAlertMode = false;
    els.toggleChartAlertMode?.classList.remove("active");
    els.chart?.classList.remove("alertMode");
  }

  els.toggleChartOrderMode?.classList.toggle("active", chartOrderMode);
  els.chart?.classList.toggle("orderMode", chartOrderMode);

  clearChartOrderPreview();

  showToast(
    chartOrderMode
      ? `Chart ${getOrderProduct()} order mode enabled. Click entry price.`
      : "Chart order mode disabled.",
    "info"
  );
}
function handleChartOrderClick(param) {
  if (!chartOrderMode) return;

  if (!selectedsymbol) {
    showToast("Select a symbol before placing chart order", "error");
    return;
  }

  if (!param.point || !candleSeries) return;

  const clickedPrice = candleSeries.coordinateToPrice(param.point.y);

  if (!clickedPrice || clickedPrice <= 0) return;

  const price = roundToTick(clickedPrice);
  showChartOrderPreview(price, param.point);
}
function getChartOrderType(action, price) {
  const ltp = Number(currentLTP || allLTP[selectedsymbol] || 0);

  if (!ltp || ltp <= 0) {
    throw new Error("Live price unavailable.");
  }

  action = String(action || "").toUpperCase();

  if (action === "BUY") {
    return price < ltp
      ? { orderType: "limit", price, triggerPrice: 0, label: "BUY LIMIT" }
      : { orderType: "stoploss", price: 0, triggerPrice: price, label: "BUY STOP" };
  }

  if (action === "SELL") {
    return price > ltp
      ? { orderType: "limit", price, triggerPrice: 0, label: "SELL LIMIT" }
      : { orderType: "stoploss", price: 0, triggerPrice: price, label: "SELL STOP" };
  }

  throw new Error("Invalid order side.");
}
function showChartOrderPreview(price, point) {
  const product = getOrderProduct();

  if (product === "cover" || product === "bracket") {
    showChartStrategyOrderPreview(product, price, point);
    return;
  }

  showRegularChartOrderPreview(price, point);
}
function showChartStrategyOrderPreview(product, entryPrice, point) {
  clearChartOrderPreview();

  if (!selectedsymbol) {
    showToast("Select a symbol before placing chart order", "error");
    return;
  }

  const action = selectedOrderSide;
  const lots = parseInt(els.orderLot.value, 10) || 0;
  const quantity = lots * (currentLotSize || 1);

  if (quantity <= 0) {
    showToast("Enter lot count before placing chart order", "error");
    return;
  }

  const activeHolding = getActiveHoldings();

  if (product === "bracket" && activeHolding) {
    showToast("Bracket orders are allowed only when there is no active position.", "error");
    return;
  }

  const entryType = getDefaultChartEntryType();
  const initial = getChartStrategyInitialPrices(product, action, entryPrice);

  const entryLine = createStrategyPreviewLine(entryPrice, {
    color: action === "BUY" ? "#00c076" : "#ff4d5a",
    lineWidth: 2,
    title: `${getChartStrategyEntryLabel(product)} ${action} ${quantity} @ ${fmtNum(entryPrice)}`
  });

  const stopLine = createStrategyPreviewLine(initial.stopLossPrice, {
    color: "#ff4d5a",
    lineWidth: 2,
    title: `SL ${fmtNum(initial.stopLossPrice)}`
  });

  let targetLine = null;

  if (product === "bracket") {
    targetLine = createStrategyPreviewLine(initial.targetPrice, {
      color: "#00c076",
      lineWidth: 2,
      title: `Target ${fmtNum(initial.targetPrice)}`
    });
  }

  chartOrderPopup = document.createElement("div");
  chartOrderPopup.className = `chartStrategyPopup ${product} ${action.toLowerCase()}`;

  const metrics = calculateStrategyPreviewMetrics(
    action,
    quantity,
    entryPrice,
    initial.stopLossPrice,
    initial.targetPrice
  );

  chartOrderPopup.innerHTML = `
    <div class="chartOrderHead">
      <strong>${getChartStrategyTitle(product, action)}</strong>
      <button type="button" data-chart-order-close>&times;</button>
    </div>

    <div class="chartStrategySummary">
      <div><span>Symbol</span><b>${selectedsymbol}</b></div>
      <div><span>Qty</span><b>${quantity.toLocaleString("en-IN")}</b></div>
      <div><span>Entry</span><b>${formatMoney(entryPrice)}</b></div>
      <div><span>Required</span><b>${formatMoney(metrics.required)}</b></div>
    </div>

    <div class="chartStrategyGrid">
      <label>
        <span>Stop-loss</span>
        <input type="number" data-chart-stop step="0.05" value="${initial.stopLossPrice}">
      </label>

      ${
        product === "bracket"
          ? `<label>
              <span>Target</span>
              <input type="number" data-chart-target step="0.05" value="${initial.targetPrice}">
            </label>`
          : ""
      }
    </div>

    <div class="chartStrategyRisk" data-chart-risk>
      Risk: ${formatMoney(metrics.risk)}
      ${
        product === "bracket"
          ? ` · Reward: ${formatMoney(metrics.reward)}`
          : ""
      }
    </div>

    <button type="button" class="chartOrderPlace">
      Place ${product === "bracket" ? "Bracket" : "Cover"} Order
    </button>
  `;

  els.chart.appendChild(chartOrderPopup);

  const chartRect = els.chart.getBoundingClientRect();
  const popupWidth = product === "bracket" ? 280 : 250;

  const left = Math.min(
    Math.max(12, point.x + 14),
    chartRect.width - popupWidth - 12
  );

  const top = Math.min(
    Math.max(12, point.y - 90),
    chartRect.height - 210
  );

  chartOrderPopup.style.left = `${left}px`;
  chartOrderPopup.style.top = `${top}px`;

  const stopInput = chartOrderPopup.querySelector("[data-chart-stop]");
  const targetInput = chartOrderPopup.querySelector("[data-chart-target]");
  const riskBox = chartOrderPopup.querySelector("[data-chart-risk]");

  function refreshStrategyPreview() {
    const stopPrice = roundToTick(parseFloat(stopInput.value) || 0);
    const targetPrice = product === "bracket"
      ? roundToTick(parseFloat(targetInput.value) || 0)
      : 0;

    if (stopPrice > 0) {
      stopLine.applyOptions({
        price: stopPrice,
        title: `SL ${fmtNum(stopPrice)}`
      });
    }

    if (product === "bracket" && targetLine && targetPrice > 0) {
      targetLine.applyOptions({
        price: targetPrice,
        title: `Target ${fmtNum(targetPrice)}`
      });
    }

    const nextMetrics = calculateStrategyPreviewMetrics(
      action,
      quantity,
      entryPrice,
      stopPrice,
      targetPrice
    );

    const validationError = product === "bracket"
      ? validateBracketOrderInput(
          action,
          quantity,
          entryType,
          entryPrice,
          stopPrice,
          targetPrice
        )
      : validateCoverOrderInput(
          action,
          quantity,
          entryType,
          entryPrice,
          stopPrice
        );

    riskBox.classList.toggle("danger", !!validationError);

    riskBox.textContent = validationError
      ? validationError
      : product === "bracket"
        ? `Risk: ${formatMoney(nextMetrics.risk)} · Reward: ${formatMoney(nextMetrics.reward)}`
        : `Risk: ${formatMoney(nextMetrics.risk)}`;
  }

  let targetManuallyEdited = false;

if (targetInput) {
  targetInput.addEventListener("input", () => {
    targetManuallyEdited = true;
    refreshStrategyPreview();
  });
}

stopInput.addEventListener("input", () => {
    if (
      product === "bracket" &&
      targetInput &&
      !targetManuallyEdited &&
      presetSettings.applyToChartStrategies &&
      presetSettings.targetMode === "rr"
    ) {
      const stopPrice = roundToTick(parseFloat(stopInput.value) || 0);

      const recalculatedTarget = getPresetBasedTarget(
        action,
        entryPrice,
        stopPrice
      );

      if (recalculatedTarget) {
        targetInput.value = recalculatedTarget;
      }
    }

    refreshStrategyPreview();
  });

  chartOrderPopup.querySelector("[data-chart-order-close]").onclick = clearChartOrderPreview;

  chartOrderPopup.querySelector(".chartOrderPlace").onclick = async event => {
    const btn = event.currentTarget;

    const stopPrice = roundToTick(parseFloat(stopInput.value) || 0);
    const targetPrice = product === "bracket"
      ? roundToTick(parseFloat(targetInput.value) || 0)
      : 0;

    const validationError = product === "bracket"
      ? validateBracketOrderInput(
          action,
          quantity,
          entryType,
          entryPrice,
          stopPrice,
          targetPrice
        )
      : validateCoverOrderInput(
          action,
          quantity,
          entryType,
          entryPrice,
          stopPrice
        );

    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Placing...";

    try {
      await placeChartStrategyOrder({
        product,
        action,
        quantity,
        entryType,
        entryPrice,
        stopLossTriggerPrice: stopPrice,
        targetPrice
      });
    } catch (err) {
      console.error("Chart strategy order failed:", err);
      showToast(
        err.message || `${product === "bracket" ? "Bracket" : "Cover"} order failed`,
        "error"
      );
    } finally {
      btn.disabled = false;
      btn.textContent = `Place ${product === "bracket" ? "Bracket" : "Cover"} Order`;
    }
  };

  refreshStrategyPreview();
}
function refreshStrategyTicketDefaultsFromEntry() {
  if (!isStrategyOrderMode()) return;

  const entryPrice = getStrategyEntryPrice();

  if (!entryPrice || entryPrice <= 0) return;

  const stopLossPrice = getDefaultStrategyStopLoss(
    selectedOrderSide,
    entryPrice
  );

  if (stopLossPrice) {
    els.triggerPrice.value = stopLossPrice;
  }

  if (isBracketOrderMode() && els.targetPrice) {
    const targetPrice = getDefaultBracketTarget(
      selectedOrderSide,
      entryPrice,
      Number(stopLossPrice)
    );

    if (targetPrice) {
      els.targetPrice.value = targetPrice;
    }
  }

  updateEstimatedAmount({
    LTP: currentLTP
  });
}
async function placeChartStrategyOrder(plan) {
  const isBracket = plan.product === "bracket";

  const endpoint = isBracket
    ? `${base_url}/api/trade/place-bracket-order`
    : `${base_url}/api/trade/place-cover-order`;

  const payload = {
    Action: plan.action,
    Symbol: selectedsymbol,
    Quantity: plan.quantity,
    EntryType: plan.entryType,
    EntryPrice: plan.entryType === "LIMIT" ? plan.entryPrice : null,
    StopLossTriggerPrice: plan.stopLossTriggerPrice,
    Validity: "DAY",
    TimeStamp: Date.now()
  };

  if (isBracket) {
    payload.TargetPrice = plan.targetPrice;
  }

  const confirmLines = [
    `Place ${isBracket ? "bracket" : "cover"} order?`,
    "",
    `${plan.action} ${selectedsymbol}`,
    `Qty: ${plan.quantity.toLocaleString("en-IN")}`,
    `Entry: ${plan.entryType} ${formatMoney(plan.entryPrice)}`,
    `Stop-loss: ${formatMoney(plan.stopLossTriggerPrice)}`
  ];

  if (isBracket) {
    confirmLines.push(`Target: ${formatMoney(plan.targetPrice)}`);
  }

  const ok = confirm(confirmLines.join("\n"));
  if (!ok) return;

  const res = await apiFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.MESSAGE ||
      data.Message ||
      data.message ||
      data.ERROR ||
      data.Error ||
      data.error ||
      (data.ERRORS || data.Errors || []).join(", ") ||
      `${isBracket ? "Bracket" : "Cover"} order failed`
    );
  }

  showToast(
    data.MESSAGE ||
    data.Message ||
    `${isBracket ? "Bracket" : "Cover"} order placed`,
    "success"
  );

  clearChartOrderPreview();

  await loadUserData();
  await fetchOrderBook();
  plotOrderLines();
}
function showRegularChartOrderPreview(price, point) {
  clearChartOrderPreview();

  const action = selectedOrderSide;
  const lots = parseInt(els.orderLot.value, 10) || 0;
  const quantity = lots * (currentLotSize || 1);

  if (quantity <= 0) {
    showToast("Enter lot count before placing chart order", "error");
    return;
  }

  let plan;

  try {
    plan = getChartOrderType(action, price);
    validateChartOrderPositionCompatibility(action, quantity);
  } catch (err) {
    showToast(err.message || "Invalid chart order", "error");
    return;
  }

  const estimate = calculateOrderCost(action, quantity, price);
  const required = action === "BUY"
    ? estimate.grossBuyCost
    : estimate.totalCharges;

  chartOrderPreviewLine = candleSeries.createPriceLine({
    price,
    color: action === "BUY" ? "#00c076" : "#ff4d5a",
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${plan.label} ${quantity}`
  });

  chartOrderPopup = document.createElement("div");
  chartOrderPopup.className = `chartOrderPopup ${action.toLowerCase()}`;

  chartOrderPopup.innerHTML = `
    <div class="chartOrderHead">
      <strong>${plan.label}</strong>
      <button type="button" data-chart-order-close>&times;</button>
    </div>

    <div class="chartOrderBody">
      <div><span>Symbol</span><b>${selectedsymbol}</b></div>
      <div><span>Price</span><b>${formatMoney(price)}</b></div>
      <div><span>Qty</span><b>${quantity.toLocaleString("en-IN")}</b></div>
      <div><span>${action === "BUY" ? "Required" : "Charges"}</span><b>${formatMoney(required)}</b></div>
    </div>

    <button type="button" class="chartOrderPlace">
      Place ${plan.label}
    </button>
  `;

  els.chart.appendChild(chartOrderPopup);

  const chartRect = els.chart.getBoundingClientRect();
  const popupWidth = 220;

  const left = Math.min(
    Math.max(12, point.x + 14),
    chartRect.width - popupWidth - 12
  );

  const top = Math.min(
    Math.max(12, point.y - 70),
    chartRect.height - 150
  );

  chartOrderPopup.style.left = `${left}px`;
  chartOrderPopup.style.top = `${top}px`;

  chartOrderPopup.querySelector("[data-chart-order-close]").onclick = clearChartOrderPreview;

  chartOrderPopup.querySelector(".chartOrderPlace").onclick = () => {
    placeChartOrder({
      action,
      quantity,
      orderType: plan.orderType,
      price: plan.price,
      triggerPrice: plan.triggerPrice
    });
  };
}
function clearChartOrderPreview() {
  if (chartOrderPreviewLine) {
    try {
      candleSeries.removePriceLine(chartOrderPreviewLine);
    } catch { }

    chartOrderPreviewLine = null;
  }

  chartStrategyPreviewLines.forEach(line => {
    try {
      candleSeries.removePriceLine(line);
    } catch { }
  });

  chartStrategyPreviewLines = [];

  chartOrderPopup?.remove();
  chartOrderPopup = null;
}
function createStrategyPreviewLine(price, options) {
  const line = candleSeries.createPriceLine({
    price,
    color: options.color,
    lineWidth: options.lineWidth || 2,
    lineStyle: options.lineStyle || LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: options.title
  });

  chartStrategyPreviewLines.push(line);

  return line;
}

function getChartStrategyEntryLabel(product) {
  return product === "bracket" ? "BRACKET ENTRY" : "COVER ENTRY";
}

function getChartStrategyTitle(product, action) {
  return `${action} ${product === "bracket" ? "Bracket" : "Cover"} Order`;
}

function getDefaultChartEntryType() {
  // Chart click means user picked a specific entry level.
  // So use LIMIT for cover/bracket chart orders.
  return "LIMIT";
}

function getChartStrategyInitialPrices(product, action, entryPrice) {
  const stopLossPrice = Number(
    getDefaultStrategyStopLoss
      ? getDefaultStrategyStopLoss(action, entryPrice)
      : getDefaultCoverStopLoss(action, entryPrice)
  );

  let targetPrice = 0;

  if (product === "bracket") {
    targetPrice = Number(getDefaultBracketTarget(action, entryPrice, stopLossPrice));
  }

  return {
    stopLossPrice,
    targetPrice
  };
}

function calculateStrategyPreviewMetrics(action, quantity, entryPrice, stopLossPrice, targetPrice = 0) {
  const required = getOrderCashRequirement(action, quantity, entryPrice);

  let risk = 0;
  let reward = 0;

  if (stopLossPrice > 0) {
    const pnlAtStop = calculateTradePnlFromEntryToExit(
      action,
      quantity,
      entryPrice,
      stopLossPrice
    );

    risk = Math.abs(Math.min(0, pnlAtStop));
  }

  if (targetPrice > 0) {
    const pnlAtTarget = calculateTradePnlFromEntryToExit(
      action,
      quantity,
      entryPrice,
      targetPrice
    );

    reward = Math.max(0, pnlAtTarget);
  }

  return {
    required,
    risk,
    reward
  };
}
function validateChartOrderPositionCompatibility(action, quantity) {
  const activeHolding = getActiveHoldings();

  if (!activeHolding) return;

  const activeQty = Number(activeHolding.QUANTITY || 0);
  const activeType = String(activeHolding.POSITIONTYPE || "").toUpperCase();

  if (activeType === "LONG" && action === "SELL" && quantity > activeQty) {
    throw new Error("Cannot sell more than current long quantity. Square off first.");
  }

  if (activeType === "SHORT" && action === "BUY" && quantity > activeQty) {
    throw new Error("Cannot cover more than current short quantity. Square off first.");
  }
}
async function placeChartOrder(plan) {
  if (!selectedsymbol) {
    showToast("Select a symbol first", "error");
    return;
  }

  const payload = {
    ACTION: plan.action,
    SYMBOL: selectedsymbol,
    QUANTITY: plan.quantity,
    ORDERTYPE: plan.orderType,
    PRICE: plan.price,
    TRIGGERPRICE: plan.triggerPrice,
    VALIDITY: "day",
    TAG: "CHART_ORDER",
    TIMESTAMP: Date.now()
  };

  try {
    const data = await sendTradePayload(payload);

    showToast(
      `${plan.action} chart order ${data.STATUS || data.status || "sent"}`,
      "success"
    );

    clearChartOrderPreview();

    await loadUserData();
    await fetchOrderBook();
    plotOrderLines();
  } catch (err) {
    showToast(err.message || "Chart order failed", "error");
  }
}
function loadIndicatorSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(INDICATOR_STORAGE_KEY));

    if (saved) {
      indicatorSettings = {
        ...indicatorSettings,
        ...saved
      };
    }
  } catch {
    localStorage.removeItem(INDICATOR_STORAGE_KEY);
  }
}
function saveIndicatorSettings() {
  localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(indicatorSettings));
}
function syncIndicatorInputs() {
  document.querySelectorAll("[data-indicator]").forEach(input => {
    input.checked = !!indicatorSettings[input.dataset.indicator];
  });
}
function ensureIndicatorSeries(key, options) {
  if (indicatorSeries[key]) {
    return indicatorSeries[key];
  }

  indicatorSeries[key] = chart.addLineSeries({
    priceScaleId: "right",
    lineWidth: 1,
    crossHairMarkerVisible: false,
    ...options
  });

  return indicatorSeries[key];
}
function removeIndicatorSeries(key) {
  if (!indicatorSeries[key]) return;

  try {
    chart.removeSeries(indicatorSeries[key]);
  } catch {}

  delete indicatorSeries[key];
}
function applyIndicators() {
  const candles = rawCandleData;

  if (!chart) return;
  if (!candles.length) {
    removeAllIndicatorSeries();
    return;
  }

  if (indicatorSettings.ema9) {
    ensureIndicatorSeries("ema9", { color: "#4db6ff" })
      .setData(calculateEMA(candles, 9));
  } else {
    removeIndicatorSeries("ema9");
  }

  if (indicatorSettings.ema21) {
    ensureIndicatorSeries("ema21", { color: "#d9b87a" })
      .setData(calculateEMA(candles, 21));
  } else {
    removeIndicatorSeries("ema21");
  }

  if (indicatorSettings.ema50) {
    ensureIndicatorSeries("ema50", { color: "#b56cff" })
      .setData(calculateEMA(candles, 50));
  } else {
    removeIndicatorSeries("ema50");
  }

  if (indicatorSettings.vwap) {
    ensureIndicatorSeries("vwap", {
      color: "#f5c542",
      lineStyle: LightweightCharts.LineStyle.Dashed
    }).setData(calculateVWAP(candles));
  } else {
    removeIndicatorSeries("vwap");
  }

  if (indicatorSettings.bollinger) {
    const bands = calculateBollingerBands(candles, 20, 2);

    ensureIndicatorSeries("bbUpper", { color: "rgba(77, 182, 255, 0.85)" })
      .setData(bands.upper);

    ensureIndicatorSeries("bbMiddle", {
      color: "rgba(149, 160, 179, 0.85)",
      lineStyle: LightweightCharts.LineStyle.Dashed
    }).setData(bands.middle);

    ensureIndicatorSeries("bbLower", { color: "rgba(77, 182, 255, 0.85)" })
      .setData(bands.lower);
  } else {
    removeIndicatorSeries("bbUpper");
    removeIndicatorSeries("bbMiddle");
    removeIndicatorSeries("bbLower");
  }
}
function updateIndicatorsOnTick(candles) {
  if (!candles.length) return;

  // With only 100 candles, full recalculation is acceptable and simpler.
  // Later, if your feed becomes very fast, throttle this to once every 250ms.
  applyIndicators();
}

function getStoredWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(watchlistStorageKey) || "[]")
  }
  catch {
    return []
  }
}
function setStoredWatchlist(symbols) {
  localStorage.setItem(watchlistStorageKey, JSON.stringify([...new Set(symbols)]))
}
function restoreWatchlist() {
  const symbols = getStoredWatchlist();
  symbols.forEach(s => addToWatchlistRow(s, false));
  updateWatchlistEmptyState();
  if (selectedsymbol && symbols.includes(selectedsymbol)) selectSymbol(selectedsymbol);
  else if (symbols[0]) selectSymbol(symbols[0]);
  resubscribeWatchlist()
}
async function openStockListModal() {
  try {
    const res = await apiFetch(`${base_url}/api/stocks`, {
      method: "GET"
    }
    );
    if (!res.ok) throw new Error(await readResponseError(res));
    const stocks = await res.json();
    latestStockList = stocks || [];
    renderStockList(latestStockList);
    els.stockModal.classList.remove("hidden");
    els.stockSearch.value = "";
    setTimeout(() => els.stockSearch.focus(), 60)
  }
  catch (err) {
    console.error(err);
    showToast("Unable to load stocks", "error")
  }
}
let latestStockList = [];
function renderStockList(stocks) {
  els.stockList.innerHTML = "";
  if (!stocks.length) {
    els.stockList.innerHTML = "<li>No stocks available</li>";
    return
  }
  stocks.forEach(stock => {
    const item = document.createElement("li"); item.textContent = stock; item.onclick = () => {
      addToWatchlist(stock); els.stockModal.classList.add("hidden")
    }; els.stockList.appendChild(item)
  }
  )
}
function filterStockList() {
  const q = els.stockSearch.value.trim().toLowerCase();
  renderStockList(latestStockList.filter(s => String(s).toLowerCase().includes(q)))
}
function addToWatchlist(symbol) {
  const symbols = getStoredWatchlist();
  if (symbols.includes(symbol)) {
    showToast(`${symbol} already in watchlist`, "info");
    return
  }
  symbols.push(symbol);
  setStoredWatchlist(symbols);
  addToWatchlistRow(symbol, true);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
    action: "SUBSCRIBE", symbols: [symbol]
  }
  ));
  showToast(`${symbol} added to watchlist`, "success");
  if (!selectedsymbol) selectSymbol(symbol);
  updateWatchlistEmptyState()
}
function addToWatchlistRow(symbol) {
  if (document.querySelector(`.watchlistrow[data-symbol="${cssEscape(symbol)}"]`)) return;
  const row = document.createElement("tr");
  row.className = "watchlistrow";
  row.draggable = true;
  row.dataset.symbol = symbol;
  row.innerHTML = `<td><div class="watchlistsymbol">${symbol}</div><div class="positionSlot"></div></td><td class="ltpCell">--</td><td class="volCell">--</td><td><span class="removeWatchlistBtn">&times;</span></td>`;
  row.querySelector(".watchlistsymbol").onclick = () => selectSymbol(symbol);
  row.querySelector(".removeWatchlistBtn").onclick = e => {
    e.stopPropagation();
    removeFromWatchlist(symbol)
  };
  els.watchlistBody.appendChild(row);
  setupWatchlistDrag();
  renderPositionBadges()
}
function removeFromWatchlist(symbol) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
    action: "UNSUBSCRIBE", symbols: [symbol]
  }
  ));
  document.querySelector(`.watchlistrow[data-symbol="${cssEscape(symbol)}"]`)?.remove();
  setStoredWatchlist(getStoredWatchlist().filter(s => s !== symbol));
  if (selectedsymbol === symbol) {
    selectedsymbol = "";
    localStorage.removeItem("tt_selectedSymbol");
    clearBuckets();
    updateSelectedSymbolSummary();
    const symbols = getStoredWatchlist();
    if (symbols[0]) selectSymbol(symbols[0])
  }
  updateWatchlistEmptyState();
  showToast(`${symbol} removed from watchlist`, "info")
}
async function selectSymbol(symbol) {
  selectedsymbol = symbol;
  localStorage.setItem("tt_selectedSymbol", symbol);
  highlightSelectedSymbol();
  updateSelectedSymbolSummary();
  await setLotsize(symbol);
  clearBuckets();
  await getCandleData();
  await fetchOrderBook();
  plotOrderLines();
  plotPositionLines();
  plotFilledOrders();
  syncPriceAlertLines();
  fillOrderForm(els.orderType.value, true);
  updateEstimatedAmount({ LTP: currentLTP });
}
function highlightSelectedSymbol() {
  document.querySelectorAll(".watchlistsymbol").forEach(el => {
    const row = el.closest(".watchlistrow"); el.classList.toggle("selected", row?.dataset.symbol === selectedsymbol)
  }
  )
}
function updateWatchlist(ticks) {
  ticks.forEach(tick => {
    const row = document.querySelector(`.watchlistrow[data-symbol="${cssEscape(tick.SYMBOL)}"]`); if (!row) return; const ltpCell = row.querySelector(".ltpCell"), volCell = row.querySelector(".volCell"), old = allLTPPrevious[tick.SYMBOL], next = Number(tick.LTP); if (old !== undefined && next !== old) {
      ltpCell.classList.remove("price-up", "price-down"); void ltpCell.offsetWidth; ltpCell.classList.add(next > old ? "price-up" : "price-down")
    }
    allLTPPrevious[tick.SYMBOL] = next; ltpCell.textContent = fmtNum(next); volCell.textContent = tick.VOLATILITY != null ? fmtNum(tick.VOLATILITY) : "--"
  }
  )
}
function updateWatchlistEmptyState() {
  els.watchlistEmpty.style.display = els.watchlistBody.querySelector(".watchlistrow") ? "none" : "grid"
}
let dragBound = false;
function setupWatchlistDrag() {
  if (dragBound) return;
  dragBound = true;
  let draggedRow = null;
  els.watchlistBody.addEventListener("dragstart", e => draggedRow = e.target.closest("tr"));
  els.watchlistBody.addEventListener("dragover", e => {
    e.preventDefault(); const targetRow = e.target.closest("tr"); if (!targetRow || targetRow === draggedRow) return; const rect = targetRow.getBoundingClientRect(), half = rect.top + rect.height / 2; els.watchlistBody.insertBefore(draggedRow, e.clientY < half ? targetRow : targetRow.nextSibling)
  }
  );
  els.watchlistBody.addEventListener("dragend", () => {
    setStoredWatchlist([...els.watchlistBody.querySelectorAll(".watchlistrow")].map(r => r.dataset.symbol)); draggedRow = null
  }
  )
}
function selectWatchlistSymbol(index) {
  const rows = [...document.querySelectorAll(".watchlistrow")];
  if (!rows.length) return;
  index = Math.max(0, Math.min(index, rows.length - 1));
  const symbol = rows[index].dataset.symbol;
  if (symbol) selectSymbol(symbol)
}
function moveWatchlistSelection(direction) {
  const rows = [...document.querySelectorAll(".watchlistrow")];
  if (!rows.length) return;
  const current = rows.findIndex(r => r.dataset.symbol === selectedsymbol);
  selectWatchlistSymbol(current === - 1 ? 0 : current + direction)
}
async function getCandleData() {
  if (!selectedsymbol) return;
  try {
    const res = await apiFetch(`${base_url}/api/historicdata/${encodeURIComponent(selectedsymbol)}?timeFrameMinutes=${selectedtimeframe}`, {
      method: "GET"
    }
    );
    if (!res.ok) throw new Error(await readResponseError(res));
    const data = await res.json();
    const formatted = (data || []).map(c => ({
      time: Math.floor(c.TIMESTAMP / 1e3), open: Number(c.OPEN), high: Number(c.HIGH), low: Number(c.LOW), close: Number(c.CLOSE), volume: Number(c.VOLUME)
    }
    ));
    rawCandleData = formatted;
    const vol = formatted.map(c => ({
      time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(0,192,118,.28)" : "rgba(255,77,90,.24)"
    }
    ));
    renderPriceSeries();
    volumeSeries.setData(vol);
    smaSeries.setData(smaVisible ? calculateSMA(formatted, 3) : []);
    applyIndicators();
    candleBuckets = {};
    formatted.forEach(c => candleBuckets[c.time] = {
      ...c
    }
    );
    if (formatted.length) {
      const N = 30, last = formatted.length - 1, first = Math.max(0, last - (N - 1));
      chart.timeScale().setVisibleRange({
        from: formatted[first].time, to: formatted[last].time
      }
      );
      chart.timeScale().applyOptions({
        rightOffset: 5, timeVisible: true, secondsVisible: selectedtimeframe === 1
      }
      )
    }
  }
  catch (err) {
    console.error(err);
    showToast(`Failed to fetch candle data for ${selectedsymbol}`, "error")
  }
}
function processTick(tick) {
  allLTP[tick.SYMBOL] = Number(tick.LTP);
  evaluatePriceAlerts(tick);
  updateHoldingsPnL(tick);
  if (tick.SYMBOL === selectedsymbol) {
    currentLTP = Number(tick.LTP);
    updateSelectedSymbolSummary();
    plotPositionLines()
  }
  if (tick.SYMBOL !== selectedsymbol) return;
  const candleTime = getCandleTime(tick.LTT);
  let bucket = candleBuckets[candleTime];
  if (!bucket) {
    bucket = {
      time: candleTime, open: Number(tick.LTP), high: Number(tick.LTP), low: Number(tick.LTP), close: Number(tick.LTP),
      volume: Number(tick.LTQ) || 0
    };
    candleBuckets[candleTime] = bucket
  }
  else {
    bucket.high = Math.max(bucket.high, Number(tick.LTP));
    bucket.low = Math.min(bucket.low, Number(tick.LTP));
    bucket.close = Number(tick.LTP);
    bucket.volume = (bucket.volume || 0) + (Number(tick.LTQ) || 0)
  }
  rawCandleData = Object.values(candleBuckets).sort((a, b) => a.time - b.time);

  if (activeChartStyle === "heikinashi") {
    renderPriceSeries();
  } else {
    candleSeries.update(toPriceSeriesPoint(bucket));
  }
  volumeSeries.update({
    time: bucket.time, value: bucket.volume, color: bucket.close >= bucket.open ? "rgba(0,192,118,.28)" : "rgba(255,77,90,.24)"
  }
  );
  const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time), smaData = calculateSMA(candles, 3),
    latest = smaData[smaData.length - 1];
  if (latest && latest.value !== undefined && smaVisible) smaSeries.update(latest);
  updateIndicatorsOnTick(rawCandleData);
  if (!crosshairActive) {
    const l = candles[candles.length - 1];
    if (l) legend.innerHTML = `<div><strong>${selectedsymbol}</strong><br>Time: ${new Date(l.time * 1e3).toLocaleTimeString("en-IN")}</div><div>O: ${fmtNum(l.open)} H: ${fmtNum(l.high)} L: ${fmtNum(l.low)} C: ${fmtNum(l.close)}</div><div>Vol: ${l.volume ? Number(l.volume).toLocaleString("en-IN") : "-"}</div>`
  }
}
async function setLotsize(symbol) {
  try {
    const res = await apiFetch(`${base_url}/api/stocks/lot-size/${encodeURIComponent(symbol)}`, {
      method: "GET"
    }
    );
    if (!res.ok) throw new Error(await readResponseError(res));
    currentLotSize = parseInt(await res.text(), 10) || 1;
    els.lotInfo.textContent = ` (${currentLotSize}/lot)`;
    updateEstimatedAmount({
      LTP: currentLTP
    }
    );
    return currentLotSize
  }
  catch {
    currentLotSize = 1;
    els.lotInfo.textContent = " (1/lot)";
    return 1
  }
}
async function loadUserData() {
  try {
    const res = await apiFetch(`${base_url}/api/account/details`, {
      method: "GET", headers: {
        "Content-Type": "application/json"
      }
    }
    );
    if (!res.ok) throw new Error(await readResponseError(res));
    const userData = await res.json();
    allHoldings = Object.values(userData.HOLDINGS || {});
    totalCashMargin = Number(userData.CASHBALANCE || 0);
    document.querySelector(".cashBalance").textContent = formatMoney(totalCashMargin);
    const realized = Number(userData.REALIZEDPNL || 0), realizedEl = document.querySelector(".realizedPnL");
    realizedEl.textContent = formatMoney(realized);
    realizedEl.classList.toggle("positive", realized >= 0);
    realizedEl.classList.toggle("negative", realized < 0);
    renderHoldings(userData.HOLDINGS || {});
    renderPositionBadges();
    updateTotalPnL();
    updateSelectedSymbolSummary();
    updateExitAllButtonState()
  }
  catch (err) {
    console.error(err);
    showToast("Failed to load account info", "error")
  }
}
async function fetchOrderBook() {
  try {
    const res = await apiFetch(`${base_url}/api/orderbook`, {
      method: "GET"
    }
    );
    if (!res.ok) throw new Error(await readResponseError(res));
    allOrders = await res.json();
    applyFilterAndSort();
    plotFilledOrders();
    plotOrderLines();
    plotPositionLines();
    syncPriceAlertLines();
  }
  catch (err) {
    console.error(err);
    showToast("Unable to load order book", "error")
  }
}
function setOrderSide(side) {
  selectedOrderSide = side;
  els.buyBtn.classList.toggle("active-side", side === "BUY");
  els.sellBtn.classList.toggle("active-side", side === "SELL");
  document.querySelector(".orderTicket").dataset.side = side.toLowerCase();
  if (isStrategyOrderMode()) {
    fillOrderForm(els.orderType.value, true);
  }
  updateEstimatedAmount({
    LTP: currentLTP
  });
}
function submitSelectedOrder() {
  const product = getOrderProduct();

  if (product === "cover") {
    placeCoverOrder(selectedOrderSide);
    return;
  }

  if (product === "bracket") {
    placeBracketOrder(selectedOrderSide);
    return;
  }

  placeOrder(selectedOrderSide);
}

function getOrderCashRequirement(action, quantity, price) {
  const estimate = calculateOrderCost(action, quantity, price);

  if (String(action).toUpperCase() === "BUY") {
    return estimate.grossBuyCost;
  }

  // For opening/adding short, your backend only debits charges.
  return estimate.totalCharges;
}
function getOrderExposureCost(action, quantity, price) {
  const estimate = calculateOrderCost(action, quantity, price);

  // For preset budget cap, treat budget as maximum trade exposure.
  // This prevents a small budget from opening a huge short.
  return estimate.turnover + estimate.totalCharges;
}
function calculatePositionExitPnl(positionType, quantity, averagePrice, ltp) {
  const qty = Number(quantity || 0);
  const avg = Number(averagePrice || 0);
  const price = Number(ltp || 0);

  if (qty <= 0 || avg <= 0 || price <= 0) return 0;

  if (positionType === "LONG") {
    const exitEstimate = calculateOrderCost("SELL", qty, price);
    const netExitValue = exitEstimate.netSellValue;
    const costBasis = avg * qty;

    return netExitValue - costBasis;
  }

  if (positionType === "SHORT") {
    const coverEstimate = calculateOrderCost("BUY", qty, price);
    const coverCost = coverEstimate.grossBuyCost;
    const entryValue = avg * qty;

    return entryValue - coverCost;
  }

  return 0;
}
function calculateTradePnlFromEntryToExit(action, quantity, entryPrice, exitPrice) {
  action = String(action || "").toUpperCase();

  const qty = Number(quantity || 0);
  const entry = Number(entryPrice || 0);
  const exit = Number(exitPrice || 0);

  if (qty <= 0 || entry <= 0 || exit <= 0) return 0;

  if (action === "BUY") {
    const entryEstimate = calculateOrderCost("BUY", qty, entry);
    const exitEstimate = calculateOrderCost("SELL", qty, exit);

    return exitEstimate.netSellValue - entryEstimate.grossBuyCost;
  }

  if (action === "SELL") {
    const entryEstimate = calculateOrderCost("SELL", qty, entry);
    const exitEstimate = calculateOrderCost("BUY", qty, exit);

    return entryEstimate.netSellValue - exitEstimate.grossBuyCost;
  }

  return 0;
}
function getOrderProduct() {
  return els.orderProduct?.value || "regular";
}

function isCoverOrderMode() {
  return getOrderProduct() === "cover";
}
function isBracketOrderMode() {
  return getOrderProduct() === "bracket";
}
function isStrategyOrderMode() {
  return isCoverOrderMode() || isBracketOrderMode();
}
function syncOrderProductUi(resetPrices = false) {
  const product = getOrderProduct();
  const isCover = product === "cover";
  const isBracket = product === "bracket";
  const isStrategy = isCover || isBracket;

  const ticket = document.querySelector(".orderTicket");

  ticket?.classList.toggle("coverMode", isCover);
  ticket?.classList.toggle("bracketMode", isBracket);

  if (els.ticketMeta) {
    els.ticketMeta.textContent = isBracket
      ? "Bracket order · entry + stop-loss + target"
      : isCover
        ? "Cover order · entry + mandatory stop-loss"
        : "Charges estimated · Short selling enabled";
  }

  if (els.orderTypeLabel) {
    els.orderTypeLabel.textContent = isStrategy ? "Entry Type" : "Order Type";
  }

  if (els.limitPriceLabel) {
    els.limitPriceLabel.textContent = isStrategy ? "Entry Price" : "Limit Price";
  }

  if (els.triggerPriceLabel) {
    els.triggerPriceLabel.textContent = isStrategy ? "Stop-loss Trigger" : "Trigger Price";
  }

  if (els.targetPriceField) {
    els.targetPriceField.classList.toggle("hidden", !isBracket);
  }

  if (els.targetPrice) {
    els.targetPrice.disabled = !isBracket;
    if (!isBracket) els.targetPrice.value = "";
  }

  if (els.coverOrderHelp) {
    els.coverOrderHelp.classList.add("hidden");
  }

  const stopOptions = els.orderType?.querySelectorAll(
    'option[value="stoploss"], option[value="stoplimit"]'
  );

  stopOptions?.forEach(option => {
    option.hidden = isStrategy;
    option.disabled = isStrategy;
  });

  if (isStrategy && !["market", "limit"].includes(els.orderType.value)) {
    els.orderType.value = "market";
  }

  fillOrderForm(els.orderType.value, resetPrices);

  updateEstimatedAmount({
    LTP: currentLTP
  });
}
function getStrategyEntryPrice() {
  const entryType = els.orderType.value;
  const ltp = Number(currentLTP || allLTP[selectedsymbol] || 0);
  const limit = parseFloat(els.limitPrice.value) || 0;

  if (entryType === "limit") {
    return limit || ltp;
  }

  return ltp;
}
function getCoverEntryPrice() {
  return getStrategyEntryPrice();
}
function getDefaultStrategyStopLoss(action, entryPrice) {
  if (presetSettings.applyToChartStrategies) {
    return getPresetBasedStopLoss(action, entryPrice);
  }

  return getFallbackStopLoss(action, entryPrice);
}
function getDefaultCoverStopLoss(action, entryPrice) {
  return getDefaultStrategyStopLoss(action, entryPrice);
}
function getDefaultBracketTarget(action, entryPrice, stopLossPrice) {
  if (presetSettings.applyToChartStrategies) {
    return getPresetBasedTarget(action, entryPrice, stopLossPrice);
  }

  return getFallbackBracketTarget(action, entryPrice, stopLossPrice);
}
function getFallbackStopLoss(action, entryPrice) {
  const price = Number(entryPrice || 0);

  if (!price || price <= 0) return "";

  const distance = Math.max(price * 0.01, 0.05);

  const stopPrice = String(action).toUpperCase() === "BUY"
    ? price - distance
    : price + distance;

  return roundToTick(Math.max(stopPrice, 0.05)).toFixed(2);
}

function getPresetStopDistance(entryPrice) {
  const price = Number(entryPrice || 0);

  if (!price || price <= 0) return 0;

  const mode = presetSettings.stopMode || "percent";

  let distance = 0;

  if (mode === "percent") {
    const percent = Number(presetSettings.stopPercent || 1);
    distance = price * (percent / 100);
  }

  else if (mode === "fixed") {
    distance = Number(presetSettings.fixedStopAmount || 0);
  }

  else if (mode === "atr") {
    try {
      const candles = getSortedCandles();
      const atr = calculateATR(candles, Number(presetSettings.atrPeriod || 14));
      distance = atr * Number(presetSettings.atrMultiplier || 1.5);
    } catch {
      // If ATR cannot be calculated yet, fallback to percent stop.
      distance = price * (Number(presetSettings.stopPercent || 1) / 100);
    }
  }

  if (!distance || distance <= 0) {
    distance = price * 0.01;
  }

  return Math.max(distance, 0.05);
}

function getPresetBasedStopLoss(action, entryPrice) {
  const price = Number(entryPrice || 0);

  if (!price || price <= 0) return "";

  const distance = getPresetStopDistance(price);

  const stopPrice = String(action).toUpperCase() === "BUY"
    ? price - distance
    : price + distance;

  if (!stopPrice || stopPrice <= 0) {
    return getFallbackStopLoss(action, entryPrice);
  }

  return roundToTick(stopPrice).toFixed(2);
}

function getFallbackBracketTarget(action, entryPrice, stopLossPrice) {
  const entry = Number(entryPrice || 0);
  const stop = Number(stopLossPrice || 0);

  if (!entry || entry <= 0 || !stop || stop <= 0) return "";

  const riskDistance = Math.abs(entry - stop);
  const rewardDistance = riskDistance * 2;

  const targetPrice = String(action).toUpperCase() === "BUY"
    ? entry + rewardDistance
    : entry - rewardDistance;

  if (!targetPrice || targetPrice <= 0) return "";

  return roundToTick(targetPrice).toFixed(2);
}

function getPresetBasedTarget(action, entryPrice, stopLossPrice) {
  const entry = Number(entryPrice || 0);
  const stop = Number(stopLossPrice || 0);

  if (!entry || entry <= 0 || !stop || stop <= 0) return "";

  const mode = presetSettings.targetMode || "rr";

  let rewardDistance = 0;

  if (!presetSettings.targetEnabled) {
    return getFallbackBracketTarget(action, entryPrice, stopLossPrice);
  }

  if (mode === "rr") {
    const riskDistance = Math.abs(entry - stop);
    rewardDistance = riskDistance * Number(presetSettings.riskRewardRatio || 2);
  }

  else if (mode === "percent") {
    rewardDistance = entry * (Number(presetSettings.targetPercent || 2) / 100);
  }

  else if (mode === "fixed") {
    rewardDistance = Number(presetSettings.fixedTargetAmount || 0);
  }

  if (!rewardDistance || rewardDistance <= 0) {
    return getFallbackBracketTarget(action, entryPrice, stopLossPrice);
  }

  const targetPrice = String(action).toUpperCase() === "BUY"
    ? entry + rewardDistance
    : entry - rewardDistance;

  if (!targetPrice || targetPrice <= 0) {
    return getFallbackBracketTarget(action, entryPrice, stopLossPrice);
  }

  return roundToTick(targetPrice).toFixed(2);
}
function validateCoverOrderInput(action, quantity, entryType, entryPrice, stopLossTriggerPrice) {
  if (!selectedsymbol) {
    return "Select a symbol before placing a cover order.";
  }

  if (quantity <= 0) {
    return "Enter a valid quantity.";
  }

  if (entryType !== "MARKET" && entryType !== "LIMIT") {
    return "Cover orders support only MARKET or LIMIT entry.";
  }

  if (entryType === "LIMIT" && (!entryPrice || entryPrice <= 0)) {
    return "Enter a valid cover entry price.";
  }

  if (!stopLossTriggerPrice || stopLossTriggerPrice <= 0) {
    return "Enter a valid stop-loss trigger price.";
  }

  const referencePrice = entryType === "LIMIT"
    ? entryPrice
    : Number(currentLTP || allLTP[selectedsymbol] || 0);

  if (!referencePrice || referencePrice <= 0) {
    return "Live price unavailable for cover order.";
  }

  if (action === "BUY" && stopLossTriggerPrice >= referencePrice) {
    return "For a BUY cover order, stop-loss trigger must be below entry price.";
  }

  if (action === "SELL" && stopLossTriggerPrice <= referencePrice) {
    return "For a SELL cover order, stop-loss trigger must be above entry price.";
  }

  return "";
}
function validateBracketOrderInput(
  action,
  quantity,
  entryType,
  entryPrice,
  stopLossTriggerPrice,
  targetPrice
) {
  if (!selectedsymbol) {
    return "Select a symbol before placing a bracket order.";
  }

  if (quantity <= 0) {
    return "Enter a valid quantity.";
  }

  if (entryType !== "MARKET" && entryType !== "LIMIT") {
    return "Bracket orders support only MARKET or LIMIT entry.";
  }

  if (entryType === "LIMIT" && (!entryPrice || entryPrice <= 0)) {
    return "Enter a valid bracket entry price.";
  }

  if (!stopLossTriggerPrice || stopLossTriggerPrice <= 0) {
    return "Enter a valid stop-loss trigger price.";
  }

  if (!targetPrice || targetPrice <= 0) {
    return "Enter a valid target price.";
  }

  const referencePrice = entryType === "LIMIT"
    ? entryPrice
    : Number(currentLTP || allLTP[selectedsymbol] || 0);

  if (!referencePrice || referencePrice <= 0) {
    return "Live price unavailable for bracket order.";
  }

  if (action === "BUY") {
    if (stopLossTriggerPrice >= referencePrice) {
      return "For a BUY bracket order, stop-loss must be below entry price.";
    }

    if (targetPrice <= referencePrice) {
      return "For a BUY bracket order, target must be above entry price.";
    }
  }

  if (action === "SELL") {
    if (stopLossTriggerPrice <= referencePrice) {
      return "For a SELL bracket order, stop-loss must be above entry price.";
    }

    if (targetPrice >= referencePrice) {
      return "For a SELL bracket order, target must be below entry price.";
    }
  }

  if (stopLossTriggerPrice === targetPrice) {
    return "Stop-loss and target cannot be the same price.";
  }

  return "";
}
async function placeOrder(action) {
  if (!selectedsymbol) {
    showToast("Select a symbol before placing an order", "error");
    return
  }
  const lots = parseInt(els.orderLot.value, 10);
  if (isNaN(lots) || lots <= 0) {
    showToast("Enter a valid lot count", "error");
    return
  }
  const quantity = lots * (currentLotSize || 1), orderType = els.orderType.value, limitPrice = parseFloat(els.limitPrice.value) || 0,
    triggerPrice = parseFloat(els.triggerPrice.value) || 0;
  if ((orderType === "limit" || orderType === "stoplimit") && limitPrice <= 0) {
    showToast("Enter a valid limit price", "error");
    els.limitPrice.focus();
    return
  }
  if ((orderType === "stoploss" || orderType === "stoplimit") && triggerPrice <= 0) {
    showToast("Enter a valid trigger price", "error");
    els.triggerPrice.focus();
    return
  }
  const activeHolding = getActiveHoldings();
  if (action === "SELL" && (!activeHolding || activeHolding.POSITIONTYPE !== "LONG")) {
    if (!confirm("This may open or add to a SHORT position.Continue?")) return
  }
  if (getOrderEstimateValue() > totalCashMargin * .8 && action === "BUY") {
    if (!confirm("This order uses more than 80% of available cash.Continue?")) return
  }
  const payload = {
    ACTION: action, SYMBOL: selectedsymbol, QUANTITY: quantity, ORDERTYPE: orderType, PRICE: limitPrice,
    TRIGGERPRICE: triggerPrice, VALIDITY: "day", TAG: "", TIMESTAMP: Date.now()
  };
  try {
    const res = await apiFetch(`${base_url}/api/trade/place-order`, {
      method: "POST", headers: {
        "Content-Type": "application/json"
      }, body: JSON.stringify(payload)
    }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.MESSAGE || data.message || (data.ERRORS || []).join(", ") || "Order failed");
    showToast(`${action} order ${data.STATUS || "placed"}`, "success");
    await loadUserData();
    await fetchOrderBook();
    clearOrderForm(false)
  }
  catch (err) {
    console.error("Error placing order:", err);
    showToast(err.message || "Order failed", "error")
  }
}
async function placeCoverOrder(action) {
  if (!selectedsymbol) {
    showToast("Select a symbol before placing a cover order", "error");
    return;
  }

  const lots = parseInt(els.orderLot.value, 10);

  if (isNaN(lots) || lots <= 0) {
    showToast("Enter a valid lot count", "error");
    return;
  }

  const quantity = lots * (currentLotSize || 1);
  const entryType = String(els.orderType.value || "").toUpperCase();
  const entryPrice = entryType === "LIMIT"
    ? parseFloat(els.limitPrice.value) || 0
    : null;

  const stopLossTriggerPrice = parseFloat(els.triggerPrice.value) || 0;

  const validationError = validateCoverOrderInput(
    action,
    quantity,
    entryType,
    entryPrice,
    stopLossTriggerPrice
  );

  if (validationError) {
    showToast(validationError, "error");
    return;
  }

  const payload = {
    Action: action,
    Symbol: selectedsymbol,
    Quantity: quantity,
    EntryType: entryType,
    EntryPrice: entryType === "LIMIT" ? entryPrice : null,
    StopLossTriggerPrice: stopLossTriggerPrice,
    Validity: "DAY",
    TimeStamp: Date.now()
  };

  const entryLabel = entryType === "LIMIT"
    ? `${entryType} ${formatMoney(entryPrice)}`
    : entryType;

  const ok = confirm(
    `Place cover order?\n\n` +
    `${action} ${selectedsymbol}\n` +
    `Qty: ${quantity.toLocaleString("en-IN")}\n` +
    `Entry: ${entryLabel}\n` +
    `Stop-loss: ${formatMoney(stopLossTriggerPrice)}`
  );

  if (!ok) return;

  try {
    const res = await apiFetch(`${base_url}/api/trade/place-cover-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        data.MESSAGE ||
        data.Message ||
        data.message ||
        data.ERROR ||
        data.Error ||
        data.error ||
        (data.ERRORS || data.Errors || []).join(", ") ||
        "Cover order failed"
      );
    }

    showToast(data.MESSAGE || data.Message || "Cover order placed", "success");

    await loadUserData();
    await fetchOrderBook();

    clearOrderForm(false);
  }
  catch (err) {
    console.error("Error placing cover order:", err);
    showToast(err.message || "Cover order failed", "error");
  }
}
async function placeBracketOrder(action) {
  if (!selectedsymbol) {
    showToast("Select a symbol before placing a bracket order", "error");
    return;
  }

  const lots = parseInt(els.orderLot.value, 10);

  if (isNaN(lots) || lots <= 0) {
    showToast("Enter a valid lot count", "error");
    return;
  }

  const quantity = lots * (currentLotSize || 1);
  const entryType = String(els.orderType.value || "").toUpperCase();

  const entryPrice = entryType === "LIMIT"
    ? parseFloat(els.limitPrice.value) || 0
    : null;

  const stopLossTriggerPrice = parseFloat(els.triggerPrice.value) || 0;
  const targetPrice = parseFloat(els.targetPrice?.value) || 0;

  const validationError = validateBracketOrderInput(
    action,
    quantity,
    entryType,
    entryPrice,
    stopLossTriggerPrice,
    targetPrice
  );

  if (validationError) {
    showToast(validationError, "error");
    return;
  }

  const payload = {
    Action: action,
    Symbol: selectedsymbol,
    Quantity: quantity,
    EntryType: entryType,
    EntryPrice: entryType === "LIMIT" ? entryPrice : null,
    StopLossTriggerPrice: stopLossTriggerPrice,
    TargetPrice: targetPrice,
    Validity: "DAY",
    TimeStamp: Date.now()
  };

  const entryLabel = entryType === "LIMIT"
    ? `${entryType} ${formatMoney(entryPrice)}`
    : entryType;

  const ok = confirm(
    `Place bracket order?\n\n` +
    `${action} ${selectedsymbol}\n` +
    `Qty: ${quantity.toLocaleString("en-IN")}\n` +
    `Entry: ${entryLabel}\n` +
    `Stop-loss: ${formatMoney(stopLossTriggerPrice)}\n` +
    `Target: ${formatMoney(targetPrice)}`
  );

  if (!ok) return;

  try {
    const res = await apiFetch(`${base_url}/api/trade/place-bracket-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        data.MESSAGE ||
        data.Message ||
        data.message ||
        data.ERROR ||
        data.Error ||
        data.error ||
        (data.ERRORS || data.Errors || []).join(", ") ||
        "Bracket order failed"
      );
    }

    showToast(data.MESSAGE || data.Message || "Bracket order placed", "success");

    await loadUserData();
    await fetchOrderBook();

    clearOrderForm(false);
  }
  catch (err) {
    console.error("Error placing bracket order:", err);
    showToast(err.message || "Bracket order failed", "error");
  }
}
function getOrderEstimateValue() {
  const lots = parseInt(els.orderLot.value, 10) || 0;
  const quantity = lots * (currentLotSize || 0);
  const price = getEffectiveOrderPrice();

  const estimate = calculateOrderCost(selectedOrderSide, quantity, price);

  if (selectedOrderSide === "BUY") {
    return estimate.grossBuyCost;
  }

  return estimate.totalCharges;
}
function getEffectiveOrderPrice() {
  const type = els.orderType.value;
  const ltp = Number(currentLTP || allLTP[selectedsymbol] || 0);
  const limit = parseFloat(els.limitPrice.value) || 0;
  const trigger = parseFloat(els.triggerPrice.value) || 0;

  if (type === "market") {
    return ltp;
  }

  if (type === "limit") {
    return limit || ltp;
  }

  if (type === "stoploss") {
    return trigger || ltp;
  }

  if (type === "stoplimit") {
    return limit || trigger || ltp;
  }

  return ltp;
}
function clearOrderForm(resetSide = false) {
  els.orderLot.value = "1";
  els.limitPrice.value = "";
  els.triggerPrice.value = "";

  if (els.targetPrice) {
    els.targetPrice.value = "";
  }

  els.orderType.value = "market";
  fillOrderForm("market", true);

  updateEstimatedAmount({
    LTP: currentLTP
  });

  if (resetSide) setOrderSide("BUY");
}
function fillOrderForm(orderType, resetPrices = false) {
  if (allLTP[selectedsymbol] !== undefined) {
    currentLTP = Number(allLTP[selectedsymbol]);
  }

  const isStrategy = isStrategyOrderMode();
  const isBracket = isBracketOrderMode();

  els.limitPrice.disabled = true;
  els.triggerPrice.disabled = true;

  if (els.targetPrice) {
    els.targetPrice.disabled = !isBracket;
  }

  if (isStrategy) {
    const ltp = Number(currentLTP || allLTP[selectedsymbol] || 0);

    if (orderType === "limit") {
      els.limitPrice.disabled = false;

      if (resetPrices || !els.limitPrice.value) {
        els.limitPrice.value = ltp ? ltp.toFixed(2) : "";
      }
    } else {
      els.limitPrice.value = "";
    }

    els.triggerPrice.disabled = false;

    const entryPrice = getStrategyEntryPrice();

    if (resetPrices || !els.triggerPrice.value) {
      els.triggerPrice.value = getDefaultStrategyStopLoss(selectedOrderSide, entryPrice);
    }

    if (isBracket && els.targetPrice) {
      const stopLossPrice = parseFloat(els.triggerPrice.value) || 0;

      if (resetPrices || !els.targetPrice.value) {
        els.targetPrice.value = getDefaultBracketTarget(
          selectedOrderSide,
          entryPrice,
          stopLossPrice
        );
      }
    }

    return;
  }

  if (els.targetPrice) {
    els.targetPrice.value = "";
  }

  if (orderType === "limit") {
    els.limitPrice.disabled = false;
    els.limitPrice.value = currentLTP ? currentLTP.toFixed(2) : "";
    els.triggerPrice.value = "";
  }
  else if (orderType === "stoploss") {
    els.triggerPrice.disabled = false;
    els.triggerPrice.value = currentLTP ? currentLTP.toFixed(2) : "";
    els.limitPrice.value = "";
  }
  else if (orderType === "stoplimit") {
    els.limitPrice.disabled = false;
    els.triggerPrice.disabled = false;
    els.limitPrice.value = currentLTP ? currentLTP.toFixed(2) : "";
    els.triggerPrice.value = currentLTP ? currentLTP.toFixed(2) : "";
  }
  else {
    els.limitPrice.value = "";
    els.triggerPrice.value = "";
  }
}
function updateEstimatedAmount(tick) {
  if (isCoverOrderMode()) {
    updateCoverEstimatedAmount(tick);
    return;
  }
  if (isBracketOrderMode()) {
    updateBracketEstimatedAmount(tick);
    return;
  }
  if (!selectedsymbol) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Select symbol and quantity to see estimate</div>';
    return
  }
  const lots = parseInt(els.orderLot.value, 10) || 0, qty = lots * (currentLotSize || 0), price = getEffectiveOrderPrice() || Number(tick?.LTP || currentLTP || 0);
  if (qty <= 0 || price <= 0) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Enter quantity and price</div>';
    return
  }
  const estimate = calculateOrderCost(selectedOrderSide, qty, price);
  const value = estimate.turnover;
  const charges = estimate.totalCharges;

  const active = getActiveHoldings();

  let cashImpact = 0;
  let cashLabel = "Required";

  if (selectedOrderSide === "BUY") {
    if (active && active.POSITIONTYPE === "SHORT") {
      const entryValue = Number(active.AVERAGEPRICE || 0) * qty;
      cashImpact = entryValue - estimate.grossBuyCost;
      cashLabel = "Cash Impact";
    } else {
      cashImpact = -estimate.grossBuyCost;
      cashLabel = "Required";
    }
  } else {
    if (active && active.POSITIONTYPE === "LONG") {
      cashImpact = estimate.netSellValue;
      cashLabel = "Net Credit";
    } else {
      cashImpact = -charges;
      cashLabel = "Charges";
    }
  }

  const after = totalCashMargin + cashImpact;
  const enough = after >= 0;
  let afterPosition = "";
  if (active) {
    const q = Number(active.QUANTITY || 0);
    afterPosition = selectedOrderSide === "BUY" ? (active.POSITIONTYPE === "SHORT" ? `After: SHORT ${Math.max(0, q - qty)}` : `After: LONG ${q + qty}`) : (active.POSITIONTYPE === "LONG" ? `After: LONG ${Math.max(0, q - qty)}` : `After: SHORT ${q + qty}`)
  }
  else afterPosition = selectedOrderSide === "BUY" ? `After: LONG ${qty}` : `After: SHORT ${qty}`;
  els.estimateBox.innerHTML = `
  <span class="estItem brand">
    <b>Qty</b>${qty.toLocaleString("en-IN")}
  </span>

  <span class="estItem">
    <b>Value</b>${formatMoney(value)}
  </span>

  <span class="estItem">
    <b>Charges</b>${formatMoney(charges)}
  </span>

  <span class="estItem ${!enough ? "danger" : "ok"}">
    <b>${cashLabel}</b>${formatMoney(Math.abs(cashImpact))}
  </span>

  <span class="estItem ${!enough ? "danger" : "ok"}">
    <b>After Cash</b>${formatMoney(after)}
  </span>

  <span class="estItem brand">
    <b>Position</b>${afterPosition}
  </span>
`;
}
function updateCoverEstimatedAmount(tick) {
  if (!selectedsymbol) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Select symbol and quantity to see estimate</div>';
    return;
  }

  const lots = parseInt(els.orderLot.value, 10) || 0;
  const qty = lots * (currentLotSize || 0);

  const entryPrice =
    getCoverEntryPrice() ||
    Number(tick?.LTP || currentLTP || 0);

  const stopPrice = parseFloat(els.triggerPrice.value) || 0;

  if (qty <= 0 || entryPrice <= 0) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Enter quantity and entry price</div>';
    return;
  }

  const estimate = calculateOrderCost(selectedOrderSide, qty, entryPrice);
  const required = getOrderCashRequirement(selectedOrderSide, qty, entryPrice);

  let estimatedRisk = 0;
  let riskClass = "ok";

  if (stopPrice > 0) {
    const pnlAtStop = calculateTradePnlFromEntryToExit(
      selectedOrderSide,
      qty,
      entryPrice,
      stopPrice
    );

    estimatedRisk = Math.abs(Math.min(0, pnlAtStop));

    const validation = validateCoverOrderInput(
      selectedOrderSide,
      qty,
      String(els.orderType.value || "").toUpperCase(),
      els.orderType.value === "limit" ? entryPrice : null,
      stopPrice
    );

    riskClass = validation ? "danger" : "ok";
  }

  els.estimateBox.innerHTML = `
    <span class="estItem brand">
      <b>Qty</b>${qty.toLocaleString("en-IN")}
    </span>

    <span class="estItem">
      <b>Entry</b>${formatMoney(entryPrice)}
    </span>

    <span class="estItem ${riskClass}">
      <b>Stop</b>${stopPrice ? formatMoney(stopPrice) : "₹--"}
    </span>

    <span class="estItem">
      <b>Charges</b>${formatMoney(estimate.totalCharges)}
    </span>

    <span class="estItem ${riskClass}">
      <b>Risk</b>${estimatedRisk ? formatMoney(estimatedRisk) : "₹--"}
    </span>

    <span class="estItem">
      <b>Required</b>${formatMoney(required)}
    </span>
  `;
}
function updateBracketEstimatedAmount(tick) {
  if (!selectedsymbol) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Select symbol and quantity to see estimate</div>';
    return;
  }

  const lots = parseInt(els.orderLot.value, 10) || 0;
  const qty = lots * (currentLotSize || 0);

  const entryPrice =
    getStrategyEntryPrice() ||
    Number(tick?.LTP || currentLTP || 0);

  const stopPrice = parseFloat(els.triggerPrice.value) || 0;
  const targetPrice = parseFloat(els.targetPrice?.value) || 0;

  if (qty <= 0 || entryPrice <= 0) {
    els.estimateBox.innerHTML = '<div class="emptyMini">Enter quantity and entry price</div>';
    return;
  }

  const required = getOrderCashRequirement(selectedOrderSide, qty, entryPrice);

  let estimatedRisk = 0;
  let estimatedReward = 0;
  let riskClass = "ok";

  if (stopPrice > 0) {
    const pnlAtStop = calculateTradePnlFromEntryToExit(
      selectedOrderSide,
      qty,
      entryPrice,
      stopPrice
    );

    estimatedRisk = Math.abs(Math.min(0, pnlAtStop));
  }

  if (targetPrice > 0) {
    const pnlAtTarget = calculateTradePnlFromEntryToExit(
      selectedOrderSide,
      qty,
      entryPrice,
      targetPrice
    );

    estimatedReward = Math.max(0, pnlAtTarget);
  }

  const validation = validateBracketOrderInput(
    selectedOrderSide,
    qty,
    String(els.orderType.value || "").toUpperCase(),
    els.orderType.value === "limit" ? entryPrice : null,
    stopPrice,
    targetPrice
  );

  riskClass = validation ? "danger" : "ok";

  els.estimateBox.innerHTML = `
    <span class="estItem brand">
      <b>Qty</b>${qty.toLocaleString("en-IN")}
    </span>

    <span class="estItem">
      <b>Entry</b>${formatMoney(entryPrice)}
    </span>

    <span class="estItem ${riskClass}">
      <b>Stop</b>${stopPrice ? formatMoney(stopPrice) : "₹--"}
    </span>

    <span class="estItem ${riskClass}">
      <b>Target</b>${targetPrice ? formatMoney(targetPrice) : "₹--"}
    </span>

    <span class="estItem ${riskClass}">
      <b>Risk / Reward</b>${estimatedRisk ? formatMoney(estimatedRisk) : "₹--"} / ${estimatedReward ? formatMoney(estimatedReward) : "₹--"}
    </span>

    <span class="estItem">
      <b>Required</b>${formatMoney(required)}
    </span>
  `;
}
function renderOrderBook(orders) {
  const container = document.querySelector(".orderBookContainer");
  container.innerHTML = "";
  if (!orders.length) {
    container.innerHTML = '<div class="emptyState"><i class="fa-regular fa-clipboard"></i><strong>No orders found</strong><span>Orders will appear here after placement</span></div>';
    return
  }
  orders.forEach(order => {
    const row = document.createElement("div");
    row.classList.add("orderRow", String(order.STATUS || "").toLowerCase());

    const orderType = getOrderStringField(order, "ORDERTYPE", "OrderType", "orderType").toUpperCase();
    const strategy = getOrderStringField(order, "STRATEGYTYPE", "StrategyType", "strategyType");
    const purpose = getOrderStringField(order, "PURPOSE", "Purpose", "purpose");
    const action = String(order.ACTION || "").toUpperCase();

    let displayPrice = "--";
    let triggerInfo = "--";

    if (orderType !== "MARKET") {
      displayPrice = getOrderNumberField(order, "PRICE", "Price", "price")
        ? fmtNum(getOrderNumberField(order, "PRICE", "Price", "price"))
        : "--";

      if (orderType === "STOPLIMIT" || orderType === "STOPLOSS") {
        const trigger = getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice");
        triggerInfo = trigger ? fmtNum(trigger) : "--";
      }

      if (strategy === "BRACKET" && purpose === "BRACKET_ENTRY") {
        const stop = getStrategyStopLossPrice(order);
        const target = getBracketTargetPrice(order);
        triggerInfo = `SL ${stop ? fmtNum(stop) : "--"} / TGT ${target ? fmtNum(target) : "--"}`;
      } else if (strategy === "COVER" && purpose === "COVER_ENTRY") {
        const stop = getStrategyStopLossPrice(order);
        triggerInfo = `SL ${stop ? fmtNum(stop) : "--"}`;
      }
    }

    const exec = order.EXECUTEDPRICE != null ? fmtNum(order.EXECUTEDPRICE) : "--";
    const strategyHtml = strategy || purpose
      ? `<span class="strategyChip">${strategy || "NORMAL"}${purpose ? ` · ${purpose}` : ""}</span>`
      : "";

    row.innerHTML = `
      <div class="orderInfo">
        <span class="symbol">${order.SYMBOL}</span>
        <span class="action ${action.toLowerCase()}">${action}</span>
        ${strategyHtml}
        <span>Qty: ${order.QUANTITY}</span>
        <span>Price: ₹${displayPrice}</span>
        <span>Trigger: ₹${triggerInfo}</span>
        <span>Executed: ₹${exec}</span>
        <span class="status">${order.STATUS}</span>
      </div>
    `;
    const actions = document.createElement("div"); 
    actions.className = "orderActions"; 
    if (order.STATUS === "Pending" || order.STATUS === "TriggerPending") 
    {
      const m = document.createElement("button"); 
      m.className = "modifyBtn"; 
      m.textContent = "Modify"; 
      m.onclick = () => openModifyDropdown(order); 
      const c = document.createElement("button"); 
      c.className = "cancelOrderBtn"; 
      c.textContent = "Cancel"; 
      c.onclick = () => {
        const purpose = getOrderStringField(order, "PURPOSE", "Purpose", "purpose");

        if ( purpose === "COVER_CHILD" || purpose === "BRACKET_STOP" || purpose === "BRACKET_TARGET" ) {
          const ok = confirm(
            "Cancel strategy child order?\n\nYour position may remain open without full protection."
          );

          if (!ok) return;
        }

        cancelOrder(getOrderId(order));
      };
      actions.append(m, c)
    }
    row.appendChild(actions); container.appendChild(row)
  }
  )
}
function applyFilterAndSort() {
  let filtered = [...allOrders];
  if (orderFilterState.status !== "all") filtered = filtered.filter(o => String(o.STATUS || "").toLowerCase() === orderFilterState.status);
  if (orderFilterState.search) filtered = filtered.filter(o => String(o.SYMBOL || "").toLowerCase().includes(orderFilterState.search) || String(o.ORDERID || "").toLowerCase().includes(orderFilterState.search));
  switch (orderFilterState.sortBy) {
    case "symbol": filtered.sort((a, b) => String(a.SYMBOL).localeCompare(String(b.SYMBOL)));
      break;
    case "price": filtered.sort((a, b) => (a.PRICE ?? a.EXECUTEDPRICE ?? a.TRIGGERPRICE ?? 0) - (b.PRICE ?? b.EXECUTEDPRICE ?? b.TRIGGERPRICE ?? 0));
      break;
    case "status": {
      const ranks = {
        Pending: 1, TriggerPending: 2, Filled: 3, Cancelled: 4, Rejected: 5
      };
      filtered.sort((a, b) => (ranks[a.STATUS] ?? 99) - (ranks[b.STATUS] ?? 99));
      break
    }
    default: filtered.sort((a, b) => (b.TIMESTAMP || b.EXECUTEDTIMESTAMP || 0) - (a.TIMESTAMP || a.EXECUTEDTIMESTAMP || 0))
  }
  renderOrderBook(filtered)
}
async function cancelOrder(orderId, { refresh = true, silent = false } = {}) {
  if (!orderId) return;
  closeOrderLineCancelPopup?.();
  hoveredOrderLineItem = null;
  els.chart?.classList.remove("orderLineHover");
  try {
    const res = await apiFetch(`${base_url}/api/trade/cancel-order/${encodeURIComponent(orderId)}`, {
      method: "DELETE"
    });

    if (!res.ok) throw new Error(await readResponseError(res));

    const result = await res.json().catch(() => ({}));

    if (!silent) {
      showToast(result.MESSAGE || "Order cancelled", "success");
    }

    if (refresh) {
      await fetchOrderBook();
    }
    closeOrderLineCancelPopup?.();
    hoveredOrderLineItem = null;
    els.chart?.classList.remove("orderLineHover");

    return result;
  }
  catch (err) {
    if (!silent) {
      showToast(err.message || "Cancel failed", "error");
    } else {
      throw err;
    }
  }
}
function openModifyDropdown(order) {
  currentModifyOrder = order;
  currentOrderId = getOrderId(order);

  const isBracketEntry = isPendingLimitBracketEntry(order);
  const isCoverEntry = isPendingLimitCoverEntry(order);
  const isStrategyEntry = isBracketEntry || isCoverEntry;
  const symbol = getOrderStringField(order, "SYMBOL", "Symbol", "symbol");

  const priceLabel = document.getElementById("modifyPriceLabel");
  const triggerLabel = document.getElementById("modifyTriggerLabel");
  const targetField = document.getElementById("modifyTargetField");
  const targetInput = document.getElementById("modifyTarget");
  const hint = document.getElementById("modifyHint");

  document.getElementById("modifySymbol").textContent = isBracketEntry
    ? `Modify Bracket — ${symbol}`
    : isCoverEntry
      ? `Modify Cover — ${symbol}`
      : `Modify — ${symbol}`;

  document.getElementById("modifyQty").value = getOrderNumberField(order, "QUANTITY", "Quantity", "quantity") || "";
  document.getElementById("modifyPrice").value = getOrderNumberField(order, "PRICE", "Price", "price") || "";
  document.getElementById("modifyValidity").value = getOrderStringField(order, "VALIDITY", "Validity", "validity") || "day";

  if (isStrategyEntry) {
    if (priceLabel) priceLabel.textContent = "Entry Price";
    if (triggerLabel) triggerLabel.textContent = "Stop-loss";
    if (targetField) targetField.classList.toggle("hidden", !isBracketEntry);
    if (targetInput) targetInput.value = isBracketEntry ? (getBracketTargetPrice(order) || "") : "";
    if (hint) {
      hint.textContent = isBracketEntry
        ? "This updates the pending entry plus the stop-loss and target that will be created after entry fill."
        : "This updates the pending cover entry plus the stop-loss that will be created after entry fill.";
    }

    document.getElementById("modifyTrigger").value = getStrategyStopLossPrice(order) || "";
  } else {
    if (priceLabel) priceLabel.textContent = "Price";
    if (triggerLabel) triggerLabel.textContent = "Trigger";
    if (targetField) targetField.classList.add("hidden");
    if (targetInput) targetInput.value = "";
    if (hint) hint.textContent = "";

    document.getElementById("modifyTrigger").value = getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice") || "";
  }

  document.getElementById("modifyDropdown").classList.add("visible");
  setTimeout(() => {
    const q = document.getElementById("modifyQty"); q.focus(); q.select()
  }, 60)
}
function closeModifyDropdown() {
  currentOrderId = "";
  currentModifyOrder = null;
  document.getElementById("modifyDropdown").classList.remove("visible")
}
function buildStandardModificationPayload(order) {
  return {
    ORDERID: getOrderId(order),
    QUANTITY: parseInt(document.getElementById("modifyQty").value, 10),
    PRICE: document.getElementById("modifyPrice").value ? parseFloat(document.getElementById("modifyPrice").value) : null,
    TRIGGERPRICE: document.getElementById("modifyTrigger").value ? parseFloat(document.getElementById("modifyTrigger").value) : null,
    VALIDITY: document.getElementById("modifyValidity").value || "day",
    TIMESTAMP: Date.now()
  };
}
function buildBracketModificationPayload(order, overrides = {}) {
  return {
    OrderId: getOrderId(order),
    Quantity: overrides.Quantity ?? parseInt(document.getElementById("modifyQty")?.value || getOrderNumberField(order, "QUANTITY", "Quantity", "quantity"), 10),
    Price: overrides.Price ?? readNumberInputOrFallback("modifyPrice", getOrderNumberField(order, "PRICE", "Price", "price")),
    StopLossPrice: overrides.StopLossPrice ?? readNumberInputOrFallback("modifyTrigger", getStrategyStopLossPrice(order)),
    TargetPrice: overrides.TargetPrice ?? readNumberInputOrFallback("modifyTarget", getBracketTargetPrice(order)),
    Validity: overrides.Validity ?? (document.getElementById("modifyValidity")?.value || getOrderStringField(order, "VALIDITY", "Validity", "validity") || "DAY"),
    TimeStamp: Date.now()
  };
}
function buildCoverModificationPayload(order, overrides = {}) {
  return {
    OrderId: getOrderId(order),
    Quantity: overrides.Quantity ?? parseInt(document.getElementById("modifyQty")?.value || getOrderNumberField(order, "QUANTITY", "Quantity", "quantity"), 10),
    Price: overrides.Price ?? readNumberInputOrFallback("modifyPrice", getOrderNumberField(order, "PRICE", "Price", "price")),
    StopLossPrice: overrides.StopLossPrice ?? readNumberInputOrFallback("modifyTrigger", getStrategyStopLossPrice(order)),
    Validity: overrides.Validity ?? (document.getElementById("modifyValidity")?.value || getOrderStringField(order, "VALIDITY", "Validity", "validity") || "DAY"),
    TimeStamp: Date.now()
  };
}
function readNumberInputOrFallback(inputId, fallback) {
  const input = document.getElementById(inputId);
  const value = input?.value;

  if (value !== undefined && value !== null && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}
function validateBracketModificationPayload(order, payload) {
  const action = getOrderStringField(order, "ACTION", "Action", "action").toUpperCase();

  if (!payload.Quantity || payload.Quantity <= 0) return "Enter a valid quantity.";
  if (!payload.Price || payload.Price <= 0) return "Enter a valid bracket entry price.";
  if (!payload.StopLossPrice || payload.StopLossPrice <= 0) return "Enter a valid stop-loss price.";
  if (!payload.TargetPrice || payload.TargetPrice <= 0) return "Enter a valid target price.";

  if (action === "BUY") {
    if (payload.StopLossPrice >= payload.Price) return "For a BUY bracket, stop-loss must be below entry price.";
    if (payload.TargetPrice <= payload.Price) return "For a BUY bracket, target must be above entry price.";
  }

  if (action === "SELL") {
    if (payload.StopLossPrice <= payload.Price) return "For a SELL bracket, stop-loss must be above entry price.";
    if (payload.TargetPrice >= payload.Price) return "For a SELL bracket, target must be below entry price.";
  }

  if (payload.StopLossPrice === payload.TargetPrice) return "Stop-loss and target cannot be the same price.";

  return "";
}
function validateCoverModificationPayload(order, payload) {
  const action = getOrderStringField(order, "ACTION", "Action", "action").toUpperCase();

  if (!payload.Quantity || payload.Quantity <= 0) return "Enter a valid quantity.";
  if (!payload.Price || payload.Price <= 0) return "Enter a valid cover entry price.";
  if (!payload.StopLossPrice || payload.StopLossPrice <= 0) return "Enter a valid stop-loss price.";

  if (action === "BUY" && payload.StopLossPrice >= payload.Price) {
    return "For a BUY cover order, stop-loss must be below entry price.";
  }

  if (action === "SELL" && payload.StopLossPrice <= payload.Price) {
    return "For a SELL cover order, stop-loss must be above entry price.";
  }

  return "";
}
function getModifyRequestConfig(order) {
  if (isPendingLimitBracketEntry(order)) {
    return {
      url: `${base_url}/api/trade/modify-bracket-order`,
      method: "PUT"
    };
  }

  if (isPendingLimitCoverEntry(order)) {
    return {
      url: `${base_url}/api/trade/modify-cover-order`,
      method: "PUT"
    };
  }

  return {
    url: `${base_url}/api/trade/modify-order`,
    method: "PUT"
  };
}
function buildChartModifyPayload(item, newPrice) {
  const order = item.order;

  if (isPendingLimitBracketEntry(order)) {
    const overrides = {};

    if (item.kind === "bracket-stop") {
      overrides.StopLossPrice = newPrice;
    } else if (item.kind === "bracket-target") {
      overrides.TargetPrice = newPrice;
    } else {
      overrides.Price = newPrice;
    }

    return buildBracketModificationPayload(order, overrides);
  }

  if (isPendingLimitCoverEntry(order)) {
    const overrides = {};

    if (item.kind === "cover-stop") {
      overrides.StopLossPrice = newPrice;
    } else {
      overrides.Price = newPrice;
    }

    return buildCoverModificationPayload(order, overrides);
  }

  const currentPrice = getOrderNumberField(order, "PRICE", "Price", "price");
  const currentTrigger = getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice");

  let nextPrice = currentPrice > 0 ? currentPrice : null;
  let nextTrigger = currentTrigger > 0 ? currentTrigger : null;

  if (item.kind === "trigger") {
    nextTrigger = newPrice;
  } else {
    nextPrice = newPrice;
  }

  return {
    ORDERID: item.orderId,
    QUANTITY: getOrderNumberField(order, "QUANTITY", "Quantity", "quantity"),
    PRICE: nextPrice,
    TRIGGERPRICE: nextTrigger,
    VALIDITY: getOrderStringField(order, "VALIDITY", "Validity", "validity") || "day",
    TIMESTAMP: Date.now()
  };
}
async function modifyOrderFromChartLine(item, newPrice) {
  const payload = buildChartModifyPayload(item, newPrice);
  const config = getModifyRequestConfig(item.order);

  if (isPendingLimitBracketEntry(item.order)) {
    const validationError = validateBracketModificationPayload(item.order, payload);
    if (validationError) throw new Error(validationError);
  }

  if (isPendingLimitCoverEntry(item.order)) {
    const validationError = validateCoverModificationPayload(item.order, payload);
    if (validationError) throw new Error(validationError);
  }

  const response = await apiFetch(config.url, {
    method: config.method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const result = await response.json().catch(() => ({}));

  showToast(result.MESSAGE || result.Message || result.message || "Order modified from chart", "success");

  await fetchOrderBook();
}
async function modifyOrder() {
  const order = currentModifyOrder || allOrders.find(o => getOrderId(o) === currentOrderId);

  if (!order) {
    showToast("Select an order to modify", "error");
    return;
  }

  const isBracketEntry = isPendingLimitBracketEntry(order);
  const isCoverEntry = isPendingLimitCoverEntry(order);
  const payload = isBracketEntry
    ? buildBracketModificationPayload(order)
    : isCoverEntry
      ? buildCoverModificationPayload(order)
      : buildStandardModificationPayload(order);

  if (isBracketEntry) {
    const validationError = validateBracketModificationPayload(order, payload);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
  }

  if (isCoverEntry) {
    const validationError = validateCoverModificationPayload(order, payload);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
  }

  const config = getModifyRequestConfig(order);

  try {
    const res = await apiFetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await readResponseError(res));
    const result = await res.json().catch(() => ({}));
    showToast(result.MESSAGE || result.Message || result.message || "Order modified", "success");
    closeModifyDropdown();
    await fetchOrderBook()
  }
  catch (err) {
    showToast(err.message || "Modify failed", "error")
  }
}
function renderHoldings(holdings) {
  const panel = document.getElementById("holdingsPanel");
  panel.innerHTML = "";
  const values = Object.values(holdings || {}).sort((a, b) => Number(b.ISACTIVE) - Number(a.ISACTIVE));
  if (!values.length) {
    panel.innerHTML = '<div class="emptyState"><i class="fa-solid fa-layer-group"></i><strong>No positions</strong><span>Open a long or short position to start tracking P&L</span></div>';
    return
  }
  values.forEach(h => {
    const row = document.createElement("div"), type = String(h.POSITIONTYPE || "FLAT").toLowerCase(); row.className = `holdingRow ${h.ISACTIVE ? "active" : "closed"} ${type}`; row.dataset.symbol = h.SYMBOL; row.dataset.quantity = h.QUANTITY; row.dataset.averagePrice = h.AVERAGEPRICE; row.dataset.positionType = h.POSITIONTYPE; row.innerHTML = `<div class="holdingLeft"><div class="holdingHeader"><span class="symbol">${h.SYMBOL}</span><span class="statusDotMini"></span></div><div class="holdingDetails"><span>Qty: ${Number(h.QUANTITY).toLocaleString("en-IN")}</span><br><span>Avg: ${formatMoney(h.AVERAGEPRICE)}</span></div></div><div class="holdingRight"><div class="pnl">₹--</div>${h.ISACTIVE ? ` <button class = "squareOffBtn" onclick = "squareOff('${h.SYMBOL}','${h.QUANTITY}','${h.POSITIONTYPE}')"> Square Off </button> ` : ` <button class = "squareOffBtn" disabled> Square Off </button> `}</div>`; row.onclick = async () => {
      await selectSymbol(h.SYMBOL); const lots = Math.max(1, Math.round(Number(h.QUANTITY || 1) / (currentLotSize || 1))); els.orderLot.value = lots; updateEstimatedAmount({
        LTP: currentLTP
      }
      )
    }; panel.appendChild(row)
  }
  )
}
function updateHoldingsPnL(tick) {
  document.querySelectorAll(".holdingRow.active").forEach(row => {
    if (row.dataset.symbol !== tick.SYMBOL)
      return;
    const qty = Number(row.dataset.quantity) || 0, avg = Number(row.dataset.averagePrice) || 0, type = row.dataset.positionType;
    let pnl = 0;

    if (type === "LONG") {
      const exitEstimate = calculateOrderCost("SELL", qty, Number(tick.LTP));
      const netExitValue = exitEstimate.netSellValue;
      const costBasis = avg * qty;

      pnl = netExitValue - costBasis;
    } else if (type === "SHORT") {
      const coverEstimate = calculateOrderCost("BUY", qty, Number(tick.LTP));
      const coverCost = coverEstimate.grossBuyCost;
      const entryValue = avg * qty;

      pnl = entryValue - coverCost;
    }
    row.dataset.pnl = pnl;
    const el = row.querySelector(".pnl");
    el.textContent = formatMoney(pnl);
    el.classList.toggle("positive", pnl >= 0);
    el.classList.toggle("negative", pnl < 0)
  }
  );
  updateTotalPnL();
  updateSelectedSymbolSummary()
}
function updateTotalPnL() {
  let total = 0;
  document.querySelectorAll(".holdingRow.active").forEach(row => total += Number(row.dataset.pnl || 0));
  const el = document.querySelector(".totalPnL");
  el.textContent = formatMoney(total);
  el.classList.toggle("positive", total >= 0);
  el.classList.toggle("negative", total < 0)
}
function getActiveHoldings() {
  return allHoldings.find(h => h.SYMBOL === selectedsymbol && h.ISACTIVE)
}
async function squareOff(symbol, quantity, positionType) {
  const action = positionType === "LONG" ? "SELL" : positionType === "SHORT" ? "BUY" : "";
  if (!action) return;
  const payload = {
    ACTION: action, SYMBOL: symbol, QUANTITY: Number(quantity), ORDERTYPE: "MARKET", PRICE: 0, TRIGGERPRICE: 0,
    VALIDITY: "day", TAG: "SQUARE_OFF", TIMESTAMP: Date.now()
  };
  try {
    const res = await apiFetch(`${base_url}/api/trade/place-order`, {
      method: "POST", headers: {
        "Content-Type": "application/json"
      }, body: JSON.stringify(payload)
    }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.MESSAGE || (data.ERRORS || []).join(", ") || "Square off failed");
    showToast(`${symbol} square off ${data.STATUS || "sent"}`, "success");
    await loadUserData();
    await fetchOrderBook()
  }
  catch (err) {
    showToast(err.message || "Square off failed", "error")
  }
}
function exitAll() {
  const active = [...document.querySelectorAll(".holdingRow.active")];
  if (!active.length) {
    showToast("No active positions", "info");
    return
  }
  if (!confirm(`Exit all ${active.length} active positions?`)) return;
  const btn = document.querySelector(".exitAllBtn");
  btn.disabled = true;
  Promise.all(active.map(row => squareOff(row.dataset.symbol, row.dataset.quantity, row.dataset.positionType))).finally(() => {
    btn.disabled = false; clearOrderForm()
  }
  )
}
function updateExitAllButtonState() {
  const btn = document.querySelector(".exitAllBtn");
  if (btn) btn.disabled = document.querySelectorAll(".holdingRow.active").length === 0
}
function renderPositionBadges() {
  document.querySelectorAll(".positionSlot").forEach(el => el.innerHTML = "");
  allHoldings.filter(h => h.ISACTIVE).forEach(h => {
    const row = document.querySelector(`.watchlistrow[data-symbol="${cssEscape(h.SYMBOL)}"]`), slot = row?.querySelector(".positionSlot"); if (slot) {
      const type = String(h.POSITIONTYPE || "").toLowerCase(); slot.innerHTML = `<span class="positionBadge ${type}">${h.POSITIONTYPE} ${h.QUANTITY}</span>`
    }
  }
  )
}
function getFilledOrders() {
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "filled" && o.SYMBOL === selectedsymbol)
}
function plotFilledOrders() {
  if (!selectedsymbol || !filledOrderVisible) {
    candleSeries.setMarkers([]);
    return
  }
  const orders = getFilledOrders(), activeTimestamps = getActiveCandleTimestamps();
  if (!orders.length || !activeTimestamps.length) {
    candleSeries.setMarkers([]);
    return
  }
  const grouped = new Map();
  orders.forEach(order => {
    const seconds = Math.floor(Number(order.EXECUTEDTIMESTAMP || order.TIMESTAMP) / 1e3), chartTime = activeTimestamps.reduce((p, c) => c <= seconds ? c : p, activeTimestamps[0]); if (!grouped.has(chartTime)) grouped.set(chartTime, {
      buy: [], sell: []
    }
    ); (order.ACTION === "BUY" ? grouped.get(chartTime).buy : grouped.get(chartTime).sell).push(order)
  }
  );
  const markers = [];
  for (const [t, orders] of grouped) {
    if (orders.buy.length) {
      const q = orders.buy.reduce((s, o) => s + Number(o.QUANTITY), 0), avg = orders.buy.reduce((s, o) => s + Number(o.EXECUTEDPRICE) * Number(o.QUANTITY), 0) / q;
      markers.push({
        time: t, position: "belowBar", color: "#00c076", shape: "arrowUp", text: `${q} @ ${fmtNum(avg)}`
      }
      )
    }
    if (orders.sell.length) {
      const q = orders.sell.reduce((s, o) => s + Number(o.QUANTITY), 0), avg = orders.sell.reduce((s, o) => s + Number(o.EXECUTEDPRICE) * Number(o.QUANTITY), 0) / q;
      markers.push({
        time: t, position: "aboveBar", color: "#ff4d5a", shape: "arrowDown", text: `${q} @ ${fmtNum(avg)}`
      }
      )
    }
  }
  markers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(markers)
}
function getPendingOrders() {
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "pending" && o.SYMBOL === selectedsymbol)
}
function getTriggerPendingOrders() {
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "triggerpending" && o.SYMBOL === selectedsymbol)
}
function removeOrderLineItems(items) {
  items.forEach(item => {
    const line = item.line || item;

    try {
      candleSeries.removePriceLine(line);
    } catch { }
  });
}
function getOrderNumberField(order, ...keys) {
  for (const key of keys) {
    const value = order?.[key];

    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value);

      if (Number.isFinite(n)) {
        return n;
      }
    }
  }

  return 0;
}
function getOrderStringField(order, ...keys) {
  for (const key of keys) {
    const value = order?.[key];

    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return "";
}
function getOrderId(order) {
  return getOrderStringField(order, "ORDERID", "OrderId", "orderId");
}
function getStrategyStopLossPrice(order) {
  return getOrderNumberField(
    order,
    "CHILDSTOPLOSSTRIGGERPRICE",
    "ChildStopLossTriggerPrice",
    "childStopLossTriggerPrice"
  );
}
function getBracketStopLossPrice(order) {
  return getStrategyStopLossPrice(order);
}
function getBracketTargetPrice(order) {
  return getOrderNumberField(
    order,
    "CHILDTARGETPRICE",
    "ChildTargetPrice",
    "childTargetPrice"
  );
}
function isPendingLimitBracketEntry(order) {
  return getOrderStringField(order, "STRATEGYTYPE", "StrategyType", "strategyType").toUpperCase() === "BRACKET" &&
    getOrderStringField(order, "PURPOSE", "Purpose", "purpose").toUpperCase() === "BRACKET_ENTRY" &&
    getOrderStringField(order, "ORDERTYPE", "OrderType", "orderType").toUpperCase() === "LIMIT" &&
    getOrderStringField(order, "STATUS", "Status", "status").toLowerCase() === "pending";
}
function isPendingLimitCoverEntry(order) {
  return getOrderStringField(order, "STRATEGYTYPE", "StrategyType", "strategyType").toUpperCase() === "COVER" &&
    getOrderStringField(order, "PURPOSE", "Purpose", "purpose").toUpperCase() === "COVER_ENTRY" &&
    getOrderStringField(order, "ORDERTYPE", "OrderType", "orderType").toUpperCase() === "LIMIT" &&
    getOrderStringField(order, "STATUS", "Status", "status").toLowerCase() === "pending";
}
function createOrderLineItem(order, kind, explicitPrice = null) {
  const action = getOrderStringField(order, "ACTION", "Action", "action").toUpperCase();
  const quantity = getOrderNumberField(order, "QUANTITY", "Quantity", "quantity");

  let price = explicitPrice;

  if (!price) {
    price = kind === "trigger" || kind === "bracket-stop" || kind === "cover-stop"
      ? getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice")
      : getOrderNumberField(order, "PRICE", "Price", "price");
  }

  if (!price || price <= 0) return null;

  const isTrigger = kind === "trigger" || kind === "bracket-stop" || kind === "cover-stop";
  const isBracketTarget = kind === "bracket-target";

  const color = isTrigger
    ? "#b56cff"
    : isBracketTarget
      ? "#c9a96e"
      : action === "BUY"
        ? "#00c076"
        : "#ff4d5a";

  let title = `↕ Pending ${action} ${quantity}`;

  if (kind === "trigger") title = `↕ Trigger ${action} ${quantity}`;
  if (kind === "bracket-entry") title = `↕ Bracket Entry ${action} ${quantity}`;
  if (kind === "bracket-stop") title = `↕ Bracket SL ${action} ${quantity}`;
  if (kind === "bracket-target") title = `↕ Bracket TGT ${action} ${quantity}`;
  if (kind === "cover-entry") title = `↕ Cover Entry ${action} ${quantity}`;
  if (kind === "cover-stop") title = `↕ Cover SL ${action} ${quantity}`;

  const line = candleSeries.createPriceLine({
    price,
    color,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    lineWidth: 2,
    axisLabelVisible: true,
    title
  });

  return {
    line,
    order,
    orderId: getOrderId(order),
    kind,
    price,
    originalPrice: price
  };
}
function plotOrderLines() {
  removeOrderLineItems(pendingLines);
  removeOrderLineItems(triggerLines);

  pendingLines = [];
  triggerLines = [];

  getPendingOrders().forEach(order => {
    const orderType = getOrderStringField(order, "ORDERTYPE", "OrderType", "orderType").toUpperCase();

    if (orderType === "MARKET") return;

    if (isPendingLimitBracketEntry(order)) {
      const entry = createOrderLineItem(order, "bracket-entry", getOrderNumberField(order, "PRICE", "Price", "price"));
      const stop = createOrderLineItem(order, "bracket-stop", getStrategyStopLossPrice(order));
      const target = createOrderLineItem(order, "bracket-target", getBracketTargetPrice(order));

      [entry, stop, target].forEach(item => {
        if (item) pendingLines.push(item);
      });

      return;
    }

    if (isPendingLimitCoverEntry(order)) {
      const entry = createOrderLineItem(order, "cover-entry", getOrderNumberField(order, "PRICE", "Price", "price"));
      const stop = createOrderLineItem(order, "cover-stop", getStrategyStopLossPrice(order));

      [entry, stop].forEach(item => {
        if (item) pendingLines.push(item);
      });

      return;
    }

    const price = getOrderNumberField(order, "PRICE", "Price", "price");
    const trigger = getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice");

    let item = null;

    if (price > 0) {
      item = createOrderLineItem(order, "price");
    } else if (trigger > 0) {
      item = createOrderLineItem(order, "trigger");
    }

    if (item) {
      pendingLines.push(item);
    }
  });

  getTriggerPendingOrders().forEach(order => {
    const trigger = getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice");

    if (trigger <= 0) return;

    const item = createOrderLineItem(order, "trigger");

    if (item) {
      triggerLines.push(item);
    }
  });
}
function getAllDraggableOrderLines() {
  return [...pendingLines, ...triggerLines].filter(item =>
    item &&
    item.line &&
    item.orderId &&
    item.price > 0
  );
}
function getChartMousePoint(event) {
  const rect = els.chart.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}
function findNearestOrderLineByY(y) {
  let nearest = null;

  getAllDraggableOrderLines().forEach(item => {
    const coordinate = candleSeries.priceToCoordinate(item.price);

    if (coordinate === null || coordinate === undefined) return;

    const distance = Math.abs(coordinate - y);

    if (distance <= ORDER_LINE_DRAG_TOLERANCE_PX) {
      if (!nearest || distance < nearest.distance) {
        nearest = {
          item,
          distance
        };
      }
    }
  });

  return nearest?.item || null;
}
function setupDraggableOrderLines() {
  if (orderLineDragBound || !els.chart) return;

  orderLineDragBound = true;

  els.chart.addEventListener("mousedown", startOrderLineDrag);
  window.addEventListener("mousemove", moveOrderLineDrag);
  window.addEventListener("mouseup", finishOrderLineDrag);

  els.chart.addEventListener("mousemove", updateOrderLineHoverCursor);

  els.chart.addEventListener("contextmenu", openOrderLineCancelPopup);

  document.addEventListener("click", event => {
    if (orderLineCancelPopup && !orderLineCancelPopup.contains(event.target)) {
      closeOrderLineCancelPopup();
    }
  });

  els.chart.addEventListener("mouseleave", () => {
    if (!activeOrderLineDrag) {
      hoveredOrderLineItem = null;
      els.chart.classList.remove("orderLineHover");
    }
  });
}
function isCancellableOrder(order) {
  const status = String(order?.STATUS || "").toLowerCase();
  return status === "pending" || status === "triggerpending";
}
function describeOrder(order, kind = "") {
  const action = getOrderStringField(order, "ACTION", "Action", "action").toUpperCase();
  const symbol = getOrderStringField(order, "SYMBOL", "Symbol", "symbol");
  const qty = getOrderNumberField(order, "QUANTITY", "Quantity", "quantity");

  let price =
    getOrderNumberField(order, "PRICE", "Price", "price") ||
    getOrderNumberField(order, "TRIGGERPRICE", "TriggerPrice", "triggerPrice");

  let label = "Order";

  if (kind === "bracket-entry") {
    label = "Bracket entry";
  } else if (kind === "bracket-stop") {
    label = "Bracket stop-loss";
    price = getStrategyStopLossPrice(order);
  } else if (kind === "bracket-target") {
    label = "Bracket target";
    price = getBracketTargetPrice(order);
  } else if (kind === "cover-entry") {
    label = "Cover entry";
  } else if (kind === "cover-stop") {
    label = "Cover stop-loss";
    price = getStrategyStopLossPrice(order);
  }

  return `${label}: ${action} ${symbol} · Qty ${qty} · ${price ? formatMoney(price) : "Market"}`;
}
function closeOrderLineCancelPopup() {
  document.querySelectorAll(".orderLineCancelPopup").forEach(popup => {
    popup.remove();
  });

  orderLineCancelPopup = null;
}
function openOrderLineCancelPopup(event) {
  if (chartOrderMode || chartAlertMode) return;
  if (!selectedsymbol || !candleSeries) return;

  const point = getChartMousePoint(event);
  const item = findNearestOrderLineByY(point.y);

  if (!item || !item.orderId) return;

  event.preventDefault();
  event.stopPropagation();

  showOrderLineCancelPopup(item, point.x, point.y);
}

function showOrderLineCancelPopup(item, x, y) {
  closeOrderLineCancelPopup();

  const popup = document.createElement("div");
  popup.className = "orderLineCancelPopup";

  orderLineCancelPopup = popup;
  popup.innerHTML = `
    <div class="cancelPopupTitle">Order action</div>
    <div class="cancelPopupDesc">${describeOrder(item.order, item.kind)}</div>
    <div class="cancelPopupActions">
      <button type="button" class="softBtn" data-modify-order>Modify</button>
      <button type="button" class="dangerSoftBtn" data-cancel-order>Cancel</button>
    </div>
  `;

  popup.addEventListener("click", e => e.stopPropagation());

  els.chart.appendChild(popup);

  const left = Math.min(Math.max(x + 10, 8), els.chart.clientWidth - popup.offsetWidth - 8);
  const top = Math.min(Math.max(y + 10, 8), els.chart.clientHeight - popup.offsetHeight - 8);

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  popup.querySelector("[data-modify-order]").onclick = () => {
    closeOrderLineCancelPopup();
    openModifyDropdown(item.order);
  };

  popup.querySelector("[data-cancel-order]").onclick = async () => {
    closeOrderLineCancelPopup();
    await cancelOrder(item.orderId);
  };
}

async function cancelHoveredOrderLine() {
  const item = hoveredOrderLineItem;

  if (!item || !item.orderId) {
    showToast("Hover a pending order line, then press C", "info");
    return;
  }

  const ok = confirm(`Cancel this order?\n\n${describeOrder(item.order, item.kind)}`);
  if (!ok) return;

  await cancelOrder(item.orderId);
}

function getCancellableOrdersForSelectedSymbol() {
  if (!selectedsymbol) return [];

  return allOrders.filter(order =>
    String(order.SYMBOL || "") === selectedsymbol &&
    isCancellableOrder(order) &&
    getOrderId(order)
  );
}

async function cancelAllPendingForSelectedSymbol() {
  const orders = getCancellableOrdersForSelectedSymbol();

  if (!orders.length) {
    showToast(`No pending orders for ${selectedsymbol || "selected symbol"}`, "info");
    return;
  }

  const ok = confirm(`Cancel ${orders.length} pending order(s) for ${selectedsymbol}?`);
  if (!ok) return;

  let success = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      await cancelOrder(getOrderId(order), {
        refresh: false,
        silent: true
      });
      success++;
    } catch {
      failed++;
    }
  }

  await fetchOrderBook();

  showToast(
    failed
      ? `${success} cancelled, ${failed} failed`
      : `${success} pending order(s) cancelled`,
    failed ? "error" : "success"
  );
}
function updateOrderLineHoverCursor(event) {
  if (activeOrderLineDrag) return;

  if (chartOrderMode || chartAlertMode) {
    hoveredOrderLineItem = null;
    els.chart.classList.remove("orderLineHover");
    return;
  }

  const point = getChartMousePoint(event);
  const lineItem = findNearestOrderLineByY(point.y);

  hoveredOrderLineItem = lineItem;

  els.chart.classList.toggle("orderLineHover", !!lineItem);
}

function startOrderLineDrag(event) {
  if (chartOrderMode || chartAlertMode) return;
  if (!selectedsymbol || !candleSeries) return;

  const point = getChartMousePoint(event);
  const lineItem = findNearestOrderLineByY(point.y);

  if (!lineItem) return;

  event.preventDefault();
  event.stopPropagation();

  activeOrderLineDrag = {
    item: lineItem,
    startY: point.y,
    originalPrice: lineItem.price,
    currentPrice: lineItem.price,
    moved: false
  };

  els.chart.classList.add("draggingOrderLine");

  try {
    chart.applyOptions({
      handleScroll: false,
      handleScale: false
    });
  } catch { }

  showToast("Drag order line to modify price", "info");
}

function moveOrderLineDrag(event) {
  if (!activeOrderLineDrag) return;

  event.preventDefault();

  const point = getChartMousePoint(event);
  const rawPrice = candleSeries.coordinateToPrice(point.y);

  if (!rawPrice || rawPrice <= 0) return;

  const nextPrice = roundToTick(rawPrice);

  if (!nextPrice || nextPrice <= 0) return;

  activeOrderLineDrag.currentPrice = nextPrice;
  activeOrderLineDrag.moved =
    Math.abs(point.y - activeOrderLineDrag.startY) > 2;

  const item = activeOrderLineDrag.item;
  item.price = nextPrice;

  const title = buildDraggedOrderLineTitle(item, nextPrice);

  item.line.applyOptions({
    price: nextPrice,
    title
  });
}

async function finishOrderLineDrag(event) {
  if (!activeOrderLineDrag) return;

  event.preventDefault();

  const drag = activeOrderLineDrag;
  activeOrderLineDrag = null;

  els.chart.classList.remove("draggingOrderLine");
  els.chart.classList.remove("orderLineHover");

  try {
    chart.applyOptions({
      handleScroll: true,
      handleScale: true
    });
  } catch { }

  const item = drag.item;
  const oldPrice = drag.originalPrice;
  const newPrice = drag.currentPrice;

  if (!drag.moved || oldPrice === newPrice) {
    item.price = oldPrice;
    item.line.applyOptions({
      price: oldPrice,
      title: buildDraggedOrderLineTitle(item, oldPrice)
    });
    return;
  }

  const ok = confirm(
    `Modify order?\n\n${selectedsymbol}\n${formatMoney(oldPrice)} → ${formatMoney(newPrice)}`
  );

  if (!ok) {
    item.price = oldPrice;
    item.line.applyOptions({
      price: oldPrice,
      title: buildDraggedOrderLineTitle(item, oldPrice)
    });
    return;
  }

  try {
    await modifyOrderFromChartLine(item, newPrice);
  } catch (err) {
    item.price = oldPrice;
    item.line.applyOptions({
      price: oldPrice,
      title: buildDraggedOrderLineTitle(item, oldPrice)
    });

    showToast(err.message || "Chart modify failed", "error");
  }
}

function buildDraggedOrderLineTitle(item, price) {
  const order = item.order;

  const action = getOrderStringField(order, "ACTION", "Action", "action").toUpperCase();
  const qty = getOrderNumberField(order, "QUANTITY", "Quantity", "quantity");

  if (item.kind === "trigger") {
    return `↕ Trigger ${action} ${qty} @ ${fmtNum(price)}`;
  }

  if (item.kind === "bracket-entry") {
    return `↕ Bracket Entry ${action} ${qty} @ ${fmtNum(price)}`;
  }

  if (item.kind === "bracket-stop") {
    return `↕ Bracket SL ${action} ${qty} @ ${fmtNum(price)}`;
  }

  if (item.kind === "bracket-target") {
    return `↕ Bracket TGT ${action} ${qty} @ ${fmtNum(price)}`;
  }

  if (item.kind === "cover-entry") {
    return `↕ Cover Entry ${action} ${qty} @ ${fmtNum(price)}`;
  }

  if (item.kind === "cover-stop") {
    return `↕ Cover SL ${action} ${qty} @ ${fmtNum(price)}`;
  }

  return `↕ Pending ${action} ${qty} @ ${fmtNum(price)}`;
}
function plotPositionLines() {
  avgPositionLines.forEach(line => candleSeries.removePriceLine(line));
  pnlPositionLines.forEach(line => candleSeries.removePriceLine(line));
  avgPositionLines = [];
  pnlPositionLines = [];
  const h = getActiveHoldings();
  if (!h || !h.ISACTIVE) return;
  const ltp = allLTP[selectedsymbol] || currentLTP;
  if (!ltp) return;
  const avg = Number(h.AVERAGEPRICE);
  const qty = Number(h.QUANTITY);

  const pnl = calculatePositionExitPnl(
    h.POSITIONTYPE,
    qty,
    avg,
    ltp
  );
  avgPositionLines.push(candleSeries.createPriceLine({
    price: avg, color: "#c9a96e", lineWidth: 2, axisLabelVisible: true, title: `AVG ${qty}`
  }
  ));
  pnlPositionLines.push(candleSeries.createPriceLine({
    price: ltp, color: pnl >= 0 ? "#00c076" : "#ff4d5a", lineWidth: 2, axisLabelVisible: true, title: `${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}`
  }
  ))
}
function getSortedCandles() {
  return Object.values(candleBuckets)
    .filter(c =>
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close))
    )
    .sort((a, b) => a.time - b.time);
}

function getPresetEntryPrice() {
  const candles = getSortedCandles();
  const latestCandle = candles[candles.length - 1];

  return Number(
    currentLTP ||
    allLTP[selectedsymbol] ||
    latestCandle?.close ||
    0
  );
}

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    throw new Error(`Need at least ${period + 1} candles to calculate ATR.`);
  }

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const high = Number(current.high);
    const low = Number(current.low);
    const previousClose = Number(previous.close);

    const highLow = high - low;
    const highPrevClose = Math.abs(high - previousClose);
    const lowPrevClose = Math.abs(low - previousClose);

    trueRanges.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }

  const recentRanges = trueRanges.slice(-period);

  return recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length;
}

function roundToTick(price, tickSize = 0.05) {
  return Number((Math.round(Number(price) / tickSize) * tickSize).toFixed(2));
}

function floorQuantityToLot(rawQuantity) {
  const lotSize = currentLotSize || 1;
  const lots = Math.floor(Number(rawQuantity) / lotSize);

  return {
    lots,
    quantity: lots * lotSize
  };
}

function calculatePresetOrderPlan(action) {
  action = String(action || "").toUpperCase();

  if (action !== "BUY" && action !== "SELL") {
    throw new Error("Preset action must be BUY or SELL.");
  }

  if (!selectedsymbol) {
    throw new Error("Select a symbol before using preset order.");
  }

  const entryPrice = getPresetEntryPrice();

  if (!entryPrice || entryPrice <= 0) {
    throw new Error("Live price unavailable for preset order.");
  }

  if (!presetSettings.budgetEnabled && !presetSettings.riskEnabled) {
    throw new Error("Enable Budget cap or Risk sizing first.");
  }

  const candidates = [];

  let atr = null;
  let stopDistance = null;
  let stopLossPrice = null;
  let targetPrice = null;

  if (
    presetSettings.riskEnabled ||
    presetSettings.placeStopLoss ||
    presetSettings.placeTarget
  ) {
    stopLossPrice = Number(getPresetBasedStopLoss(action, entryPrice));
    stopDistance = Math.abs(entryPrice - stopLossPrice);

    if (presetSettings.stopMode === "atr") {
      try {
        atr = calculateATR(getSortedCandles(), Number(presetSettings.atrPeriod || 14));
      } catch {
        atr = null;
      }
    }

    if (!stopLossPrice || stopLossPrice <= 0 || !stopDistance || stopDistance <= 0) {
      throw new Error("Could not calculate preset stop-loss.");
    }
  }

  if (presetSettings.budgetEnabled) {
    const budget = Number(presetSettings.budgetAmount);

    if (!budget || budget <= 0) {
      throw new Error("Budget amount is required.");
    }

    const budgetQty = getMaxQuantityWithinBudget(
      budget,
      entryPrice,
      action,
      currentLotSize || 1
    );

    candidates.push(budgetQty);
  }

  if (presetSettings.riskEnabled) {
    const riskAmount = Number(presetSettings.riskAmount);

    if (!riskAmount || riskAmount <= 0) {
      throw new Error("Risk amount is required.");
    }

    if (!stopLossPrice || !stopDistance) {
      throw new Error("Stop-loss is required for risk-based sizing.");
    }

    const riskQty = getMaxQuantityWithinRisk(
      riskAmount,
      entryPrice,
      stopLossPrice,
      action,
      currentLotSize || 1
    );

    candidates.push(riskQty);
  }

  if (presetSettings.targetEnabled && presetSettings.placeTarget) {
    if (!stopLossPrice) {
      throw new Error("Target calculation requires a valid stop-loss.");
    }

    targetPrice = Number(getPresetBasedTarget(action, entryPrice, stopLossPrice));

    if (!targetPrice || targetPrice <= 0) {
      throw new Error("Calculated target price is invalid.");
    }
  }

  const maxCashQty = getMaxQuantityWithinAvailableCash(
    totalCashMargin,
    entryPrice,
    action,
    currentLotSize || 1
  );

  candidates.push(maxCashQty);

  const rawFinalQty = Math.min(...candidates);
  const lotResult = floorQuantityToLot(rawFinalQty);

  if (lotResult.quantity <= 0 || lotResult.lots <= 0) {
    throw new Error("Preset rules calculated less than one valid lot.");
  }

  const entryEstimate = calculateOrderCost(action, lotResult.quantity, entryPrice);

  const tradeValue = entryEstimate.turnover;
  const requiredCash = getOrderCashRequirement(
    action,
    lotResult.quantity,
    entryPrice
  );

  let estimatedRisk = 0;
  let estimatedReward = 0;

  if (stopLossPrice) {
    const stopPnl = calculateTradePnlFromEntryToExit(
      action,
      lotResult.quantity,
      entryPrice,
      stopLossPrice
    );

    estimatedRisk = Math.abs(Math.min(0, stopPnl));
  }

  if (targetPrice) {
    const targetPnl = calculateTradePnlFromEntryToExit(
      action,
      lotResult.quantity,
      entryPrice,
      targetPrice
    );

    estimatedReward = Math.max(0, targetPnl);
  }

  if (presetSettings.budgetEnabled) {
    const exposureCost = getOrderExposureCost(
      action,
      lotResult.quantity,
      entryPrice
    );

    if (exposureCost > Number(presetSettings.budgetAmount)) {
      throw new Error("Calculated order exceeds preset budget.");
    }
  }

  if (requiredCash > totalCashMargin) {
    throw new Error("Preset order exceeds available cash.");
  }

  return {
    action,
    symbol: selectedsymbol,
    entryPrice,
    quantity: lotResult.quantity,
    lots: lotResult.lots,
    tradeValue,
    requiredCash,

    charges: entryEstimate.charges,
    totalCharges: entryEstimate.totalCharges,

    atr,
    stopDistance,
    stopLossPrice,
    targetPrice,

    estimatedRisk,
    estimatedReward
  };
}
function buildPresetEntryPayload(plan, groupTag) {
  return {
    ACTION: plan.action,
    SYMBOL: plan.symbol,
    QUANTITY: plan.quantity,
    ORDERTYPE: "market",
    PRICE: 0,
    TRIGGERPRICE: 0,
    VALIDITY: "day",
    TAG: groupTag,
    TIMESTAMP: Date.now()
  };
}

async function sendTradePayload(payload) {
  const res = await apiFetch(`${base_url}/api/trade/place-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.MESSAGE ||
      data.message ||
      data.ERROR ||
      data.error ||
      (data.ERRORS || []).join(", ") ||
      "Order failed"
    );
  }

  return data;
}

function buildPresetConfirmMessage(plan,product = "normal") {
  const lines = [
    `${plan.action} ${plan.symbol}`,
    "",
    `Product: ${product.toUpperCase()}`,
    `Quantity: ${plan.quantity.toLocaleString("en-IN")}`,
    `Lots: ${plan.lots}`,
    `Entry: ${formatMoney(plan.entryPrice)}`,
    `Trade value: ${formatMoney(plan.tradeValue)}`,
    `Charges: ${formatMoney(plan.totalCharges)}`,
    `Required: ${formatMoney(plan.requiredCash)}`
  ];

  if (plan.atr) {
    lines.push("");
    lines.push(`ATR: ${formatMoney(plan.atr)}`);
    lines.push(`Stop distance: ${formatMoney(plan.stopDistance)}`);
  }

  if (plan.stopLossPrice && presetSettings.placeStopLoss) {
    lines.push(`Stop-loss: ${formatMoney(plan.stopLossPrice)}`);
    lines.push(`Estimated risk: ${formatMoney(plan.estimatedRisk)}`);
  }

  if (plan.targetPrice && presetSettings.placeTarget) {
    lines.push(`Target: ${formatMoney(plan.targetPrice)}`);
    lines.push(`Estimated reward: ${formatMoney(plan.estimatedReward)}`);
  }

  lines.push("");
  lines.push("Send preset order?");

  return lines.join("\n");
}

async function placePresetOrder(action) {
  let plan;

  try {
    plan = calculatePresetOrderPlan(action);
  } catch (err) {
    showToast(err.message || "Invalid preset settings", "error");
    openPresetModal();
    return;
  }

  const product = getPresetOrderProduct(plan);

  if (product === "bracket" && getActiveHoldings()) {
    showToast("Bracket preset orders are allowed only when there is no active position.", "error");
    return;
  }

  if (presetSettings.confirmBeforeSend) {
    const ok = confirm(buildPresetConfirmMessage(plan, product));
    if (!ok) return;
  }

  try {
    let response;

    if (product === "bracket") {
      response = await sendPresetBracketOrder(plan);
    } else if (product === "cover") {
      response = await sendPresetCoverOrder(plan);
    } else {
      response = await sendTradePayload(buildPresetEntryPayload(plan, ""));
    }

    showToast(
      response.MESSAGE ||
      response.Message ||
      `${plan.action} ${product} preset order sent`,
      "success"
    );

    await loadUserData();
    await fetchOrderBook();
    plotOrderLines();
    clearOrderForm(false);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Preset order failed", "error");
  }
}
function getPresetOrderProduct(plan) {
  const hasStopLoss =
    !!presetSettings.placeStopLoss &&
    !!plan.stopLossPrice &&
    Number(plan.stopLossPrice) > 0;

  const hasTarget =
    !!presetSettings.placeTarget &&
    !!presetSettings.targetEnabled &&
    !!plan.targetPrice &&
    Number(plan.targetPrice) > 0;

  if (hasStopLoss && hasTarget) {
    return "bracket";
  }

  if (hasStopLoss) {
    return "cover";
  }

  return "normal";
}
async function sendPresetBracketOrder(plan) {
  const payload = {
    Action: plan.action,
    Symbol: plan.symbol,
    Quantity: plan.quantity,
    EntryType: "MARKET",
    EntryPrice: null,
    StopLossTriggerPrice: plan.stopLossPrice,
    TargetPrice: plan.targetPrice,
    Validity: "DAY",
    TimeStamp: Date.now()
  };

  const res = await apiFetch(`${base_url}/api/trade/place-bracket-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.MESSAGE ||
      data.Message ||
      data.message ||
      data.ERROR ||
      data.Error ||
      data.error ||
      (data.ERRORS || data.Errors || []).join(", ") ||
      "Bracket preset order failed"
    );
  }

  return data;
}
async function sendPresetCoverOrder(plan) {
  const payload = {
    Action: plan.action,
    Symbol: plan.symbol,
    Quantity: plan.quantity,
    EntryType: "MARKET",
    EntryPrice: null,
    StopLossTriggerPrice: plan.stopLossPrice,
    Validity: "DAY",
    TimeStamp: Date.now()
  };

  const res = await apiFetch(`${base_url}/api/trade/place-cover-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.MESSAGE ||
      data.Message ||
      data.message ||
      data.ERROR ||
      data.Error ||
      data.error ||
      (data.ERRORS || data.Errors || []).join(", ") ||
      "Cover preset order failed"
    );
  }

  return data;
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    const tag = e.target.tagName, isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT", key = e.key.toLowerCase(), ctrlOrCmd = e.ctrlKey || e.metaKey; if (e.repeat) return; if (key === "?" && !isTyping) {
      e.preventDefault();
      openShortcutHelp();
      return
    }
    if (ctrlOrCmd && e.key === "Enter") {
      e.preventDefault(); submitSelectedOrder();
      return
    }
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault(); adjustLots(1);
      return
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault(); adjustLots(- 1);
      return
    }
    if (e.altKey && key === "b") {
      e.preventDefault();
      placePresetOrder("BUY");
      return;
    }
    if (e.altKey && key === "s") {
      e.preventDefault();
      placePresetOrder("SELL");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (activeOrderLineDrag) {
        cancelOrderLineDrag();
        return;
      }
      if (isChartFullscreen) {
        setChartFullscreen(false);
        return;
      }
      closeModifyDropdown();
      closeShortcutHelp();
      closePresetModal();
      els.stockModal.classList.add("hidden");
      document.activeElement?.blur();
      return;
    }
    if (isTyping) return;
    if (e.shiftKey && key === "c") {
      e.preventDefault();
      cancelAllPendingForSelectedSymbol();
      return;
    }

    if (key === "c") {
      e.preventDefault();
      cancelHoveredOrderLine();
      return;
    }
    if (e.altKey && key === "q") {
      e.preventDefault();
      toggleChartOrderMode();
      return;
    }
    if (e.altKey && key === "a") {
      e.preventDefault();
      toggleChartAlertMode();
      return;
    }
    if (e.altKey && key === "d") {
      e.preventDefault();
      toggleCompactMode();
      return
    }
    if (key === "+" || key === "=") {
      e.preventDefault();
      zoomChart("in");
      return;
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      zoomChart("out");
      return;
    }
    if (key === "f") {
      e.preventDefault(); toggleChartFullscreen(); return
    }
    if (key === "b") {
      e.preventDefault(); setOrderSide("BUY"); return
    }
    if (key === "s") {
      e.preventDefault(); setOrderSide("SELL"); return
    }
    if (key === "r") {
      e.preventDefault(); resetChartView(); return
    }
    if (key === "i") {
      e.preventDefault(); document.getElementById("toggleSMA").click(); return
    }
    if (key === "o") {
      e.preventDefault(); document.getElementById("toggleFilledOrders").click(); return
    }
    if (key === "x" && e.shiftKey) {
      e.preventDefault(); exitAll(); return
    }
    if (key === "x") {
      e.preventDefault(); const h = getActiveHoldings(); if (h) squareOff(h.SYMBOL, h.QUANTITY, h.POSITIONTYPE); return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault(); moveWatchlistSelection(1); return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault(); moveWatchlistSelection(- 1); return
    }
    const map = {
      1: "1", 2: "5", 3: "15", 4: "30", 5: "60"
    }; if (map[key]) {
      e.preventDefault(); document.querySelector(`#timeframeSelector button[data-tf="${map[key]}"]`)?.click(); return
    }
    if (e.altKey && key === "m") {
      e.preventDefault(); setOrderType("market"); return
    }
    if (e.altKey && key === "l") {
      e.preventDefault(); setOrderType("limit"); return
    }
    if (e.altKey && key === "t") {
      e.preventDefault(); setOrderType("stoploss")
    }
  }
  )
}
function adjustLots(delta) {
  const current = parseInt(els.orderLot.value, 10) || 1;
  els.orderLot.value = Math.max(1, current + delta);
  updateEstimatedAmount({
    LTP: currentLTP
  }
  )
}
function setOrderType(type) {
  els.orderType.value = type;
  fillOrderForm(type);
  updateEstimatedAmount({
    LTP: currentLTP
  }
  )
}
function openShortcutHelp() {
  els.shortcutModal.classList.remove("hidden")
}
function closeShortcutHelp() {
  els.shortcutModal.classList.add("hidden")
}
function toggleChartFullscreen() {
  setChartFullscreen(!isChartFullscreen)
}
function setChartFullscreen(enabled) {
  isChartFullscreen = enabled;
  document.body.classList.toggle("chartFullscreen", enabled);
  if (els.toggleFullscreenChart) {
    els.toggleFullscreenChart.classList.toggle("active", enabled);
    const icon = els.toggleFullscreenChart.querySelector("i");
    if (icon) icon.className = enabled ? "fa-solid fa-compress" : "fa-solid fa-expand"
  }
  resizeChartToContainer(true)
}
function resizeChartToContainer(preserveRange = false) {
  if (!chart || !els.chart) return;
  const visibleRange = preserveRange ? chart.timeScale().getVisibleLogicalRange() : null;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chart.applyOptions({
        width: els.chart.clientWidth, height: els.chart.clientHeight
      }
      ); if (visibleRange) chart.timeScale().setVisibleLogicalRange(visibleRange)
    }
    )
  }
  )
}
function toggleCompactMode() {
  setCompactMode(!compactMode, true)
}
function setCompactMode(enabled, notify = true) {
  compactMode = enabled;
  document.body.classList.toggle("compactMode", enabled);
  localStorage.setItem("tt_compactMode", JSON.stringify(enabled));
  resizeChartToContainer(true);
  if (notify) showToast(enabled ? "Compact layout enabled" : "Comfortable layout enabled", "info")
}
function getCandleTime(ms) {
  const sec = Math.floor(Number(ms) / 1e3), interval = selectedtimeframe * 60;
  return Math.floor(sec / interval) * interval
}
function clearBuckets() {
  clearChartOrderPreview();

  rawCandleData = [];
  candleBuckets = {};

  removePriceLinesFromSeries(pendingLines);
  removePriceLinesFromSeries(triggerLines);
  removePriceLinesFromSeries(avgPositionLines);
  removePriceLinesFromSeries(pnlPositionLines);
  removePriceLinesFromSeries(priceAlertLines);

  pendingLines = [];
  triggerLines = [];
  avgPositionLines = [];
  pnlPositionLines = [];
  priceAlertLines = [];

  if (candleSeries) {
    candleSeries.setData([]);
    candleSeries.setMarkers([]);
  }

  if (volumeSeries) {
    volumeSeries.setData([]);
  }

  if (smaSeries) {
    smaSeries.setData([]);
  }

  removeAllIndicatorSeries();

  if (legend) {
    legend.innerHTML = "";
  }
}
function removePriceLinesFromSeries(lines) {
  lines.forEach(item => {
    const line = item?.line || item;

    try {
      candleSeries.removePriceLine(line);
    } catch {}
  });
}

function removeAllIndicatorSeries() {
  Object.keys(indicatorSeries).forEach(key => {
    removeIndicatorSeries(key);
  });
}
function getActiveCandleTimestamps() {
  return Object.values(candleBuckets).map(b => b.time).sort((a, b) => a - b)
}
function calculateSMA(data, period) {
  const result = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((sum, candle) => sum + Number(candle.close), 0) / period;

    result.push({
      time: data[i].time,
      value: avg
    });
  }

  return result;
}
function calculateEMA(data, period) {
  const result = [];

  if (!data || data.length < period) {
    return result;
  }

  const multiplier = 2 / (period + 1);

  let ema =
    data
      .slice(0, period)
      .reduce((sum, candle) => sum + Number(candle.close), 0) / period;

  result.push({
    time: data[period - 1].time,
    value: ema
  });

  for (let i = period; i < data.length; i++) {
    const close = Number(data[i].close);

    ema = (close - ema) * multiplier + ema;

    result.push({
      time: data[i].time,
      value: ema
    });
  }

  return result;
}
function calculateVWAP(data) {
  const result = [];

  let cumulativePV = 0;
  let cumulativeVolume = 0;

  data.forEach(candle => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume || 0);

    const typicalPrice = (high + low + close) / 3;

    cumulativePV += typicalPrice * volume;
    cumulativeVolume += volume;

    if (cumulativeVolume > 0) {
      result.push({
        time: candle.time,
        value: cumulativePV / cumulativeVolume
      });
    }
  });

  return result;
}
function calculateBollingerBands(data, period = 20, multiplier = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  if (!data || data.length < period) {
    return { upper, middle, lower };
  }

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const closes = slice.map(candle => Number(candle.close));

    const avg = closes.reduce((sum, value) => sum + value, 0) / period;

    const variance =
      closes.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / period;

    const stdDev = Math.sqrt(variance);

    const time = data[i].time;

    middle.push({
      time,
      value: avg
    });

    upper.push({
      time,
      value: avg + stdDev * multiplier
    });

    lower.push({
      time,
      value: avg - stdDev * multiplier
    });
  }

  return {
    upper,
    middle,
    lower
  };
}
function cancelOrderLineDrag() {
  if (!activeOrderLineDrag) return;

  const drag = activeOrderLineDrag;
  activeOrderLineDrag = null;

  const item = drag.item;

  item.price = drag.originalPrice;

  try {
    item.line.applyOptions({
      price: drag.originalPrice,
      title: buildDraggedOrderLineTitle(item, drag.originalPrice)
    });
  } catch { }

  try {
    chart.applyOptions({
      handleScroll: true,
      handleScale: true
    });
  } catch { }

  els.chart.classList.remove("draggingOrderLine");
  els.chart.classList.remove("orderLineHover");

  showToast("Order line drag cancelled", "info");
}
async function resetChartView() {
  if (!selectedsymbol) return;
  await getCandleData();
  chart.priceScale("right").applyOptions({
    autoScale: true
  }
  );
  plotFilledOrders();
  plotOrderLines();
  plotPositionLines()
}
function zoomChart(direction) {
  if (!chart) return;

  const timeScale = chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();

  if (!range) {
    showToast("Chart range unavailable", "info");
    return;
  }

  const candles = getSortedCandles();

  if (!candles.length) return;

  const currentSize = range.to - range.from;
  const center = (range.from + range.to) / 2;

  const minBars = 8;
  const maxBars = Math.max(candles.length + 10, 40);

  const zoomFactor = direction === "in" ? 0.78 : 1.28;

  let newSize = currentSize * zoomFactor;
  newSize = Math.max(minBars, Math.min(maxBars, newSize));

  const newRange = {
    from: center - newSize / 2,
    to: center + newSize / 2
  };

  timeScale.setVisibleLogicalRange(newRange);
  flashChartZoom(direction);
}

function flashChartZoom(direction) {
  if (!els.chart) return;

  const badge = document.createElement("div");
  badge.className = "chartZoomBadge";
  badge.textContent = direction === "in" ? "Zoom +" : "Zoom −";

  els.chart.appendChild(badge);

  requestAnimationFrame(() => {
    badge.classList.add("visible");
  });

  setTimeout(() => {
    badge.classList.remove("visible");
    setTimeout(() => badge.remove(), 180);
  }, 420);
}
function updateSelectedSymbolSummary() {
  const title = document.getElementById("selectedSymbolTitle"), sub = document.getElementById("selectedSymbolSub"),
    ltpEl = document.getElementById("symbolLtp"), posEl = document.getElementById("symbolPosition"), pnlEl = document.getElementById("symbolPnl");
  els.ticketSymbol.textContent = selectedsymbol || "--";
  if (!selectedsymbol) {
    title.textContent = "Select a symbol";
    sub.textContent = "Use watchlist ↑ ↓ to navigate";
    ltpEl.textContent = "₹--";
    posEl.textContent = "--";
    pnlEl.textContent = "₹--";
    return
  }
  title.textContent = selectedsymbol;
  sub.textContent = `Timeframe ${selectedtimeframe}m`;
  const ltp = allLTP[selectedsymbol] || currentLTP;
  ltpEl.textContent = ltp ? formatMoney(ltp) : "₹--";
  const h = getActiveHoldings();
  if (h) {
    posEl.textContent = `${h.POSITIONTYPE} ${h.QUANTITY}`;
    const pnl = calculatePositionExitPnl(
      h.POSITIONTYPE,
      Number(h.QUANTITY),
      Number(h.AVERAGEPRICE),
      ltp
    );
    pnlEl.textContent = ltp ? formatMoney(pnl) : "₹--";
    pnlEl.classList.toggle("positive", pnl >= 0);
    pnlEl.classList.toggle("negative", pnl < 0)
  }
  else {
    posEl.textContent = "--";
    pnlEl.textContent = "₹--";
    pnlEl.classList.remove("positive", "negative")
  }
  updateEstimatedAmount({
    LTP: ltp
  }
  )
}
function updateMarketStatus() {
  const chip = document.getElementById("marketStatus"), dot = chip.querySelector(".statusDot"), label = chip.querySelector("span:last-child"),
    ist = new Date(new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata"
    }
    )), mins = ist.getHours() * 60 + ist.getMinutes(), isWeekday = ist.getDay() >= 1 && ist.getDay() <= 5,
    isOpen = isWeekday && mins >= 555 && mins <= 930;
  dot.className = `statusDot ${isOpen ? "open" : "closed"}`;
  label.textContent = isOpen ? "Market Open" : "Market Closed"
}
function fmtNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }
  ) : "--"
}
function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "₹--"
}
function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/ ["\\]/g, "\\$&")
}
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${message}`;
  document.getElementById("toastContainer").appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 40);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250)
  }, 3200);
}
async function logOut() {
  try {
    await apiFetch(`${base_url}/api/account/signout?useCookie=true`,
      {
        method: "POST"
      }
    )
  } catch { } finally {
    sessionStorage.removeItem("token");
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    location.href = "signin.html"
  }
}
function loadPresetSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY));

    if (saved) {
      presetSettings = {
        ...presetSettings,
        ...saved
      };
    }
  } catch {
    localStorage.removeItem(PRESET_STORAGE_KEY);
  }
}

function savePresetSettingsToStorage() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presetSettings));
}

function openPresetModal() {
  renderPresetSettingsToModal();
  els.presetModal?.classList.remove("hidden");
}

function closePresetModal() {
  els.presetModal?.classList.add("hidden");
}

function renderPresetSettingsToModal() {
  if (!els.presetModal) return;

  els.presetBudgetEnabled.checked = !!presetSettings.budgetEnabled;
  els.presetBudgetAmount.value = presetSettings.budgetAmount || "";

  if (els.presetRiskEnabled) {
    els.presetRiskEnabled.checked = !!presetSettings.riskEnabled;
  }

  if (els.presetRiskAmount) {
    els.presetRiskAmount.value = presetSettings.riskAmount || "";
  }

  if (els.presetStopMode) {
    els.presetStopMode.value = presetSettings.stopMode || "percent";
  }

  if (els.presetStopPercent) {
    els.presetStopPercent.value = presetSettings.stopPercent || 1;
  }

  if (els.presetFixedStopAmount) {
    els.presetFixedStopAmount.value = presetSettings.fixedStopAmount || 5;
  }

  els.presetAtrPeriod.value = presetSettings.atrPeriod || 14;
  els.presetAtrMultiplier.value = presetSettings.atrMultiplier || 1.5;

  els.presetTargetEnabled.checked = !!presetSettings.targetEnabled;

  if (els.presetTargetMode) {
    els.presetTargetMode.value = presetSettings.targetMode || "rr";
  }

  els.presetRiskRewardRatio.value = presetSettings.riskRewardRatio || 2;

  if (els.presetTargetPercent) {
    els.presetTargetPercent.value = presetSettings.targetPercent || 2;
  }

  if (els.presetFixedTargetAmount) {
    els.presetFixedTargetAmount.value = presetSettings.fixedTargetAmount || 10;
  }

  els.presetPlaceStopLoss.checked = !!presetSettings.placeStopLoss;
  els.presetPlaceTarget.checked = !!presetSettings.placeTarget;

  if (els.presetApplyToChartStrategies) {
    els.presetApplyToChartStrategies.checked = presetSettings.applyToChartStrategies !== false;
  }

  els.presetConfirm.checked = !!presetSettings.confirmBeforeSend;

  updatePresetFieldStates();
  setPresetValidation("");
}

function readPresetSettingsFromModal() {
  return {
    budgetEnabled: !!els.presetBudgetEnabled.checked,
    budgetAmount: Number(els.presetBudgetAmount.value || 0),

    riskEnabled: !!els.presetRiskEnabled?.checked,
    riskAmount: Number(els.presetRiskAmount?.value || 0),

    stopMode: els.presetStopMode?.value || "percent",
    stopPercent: Number(els.presetStopPercent?.value || 1),
    fixedStopAmount: Number(els.presetFixedStopAmount?.value || 5),

    atrPeriod: Number(els.presetAtrPeriod.value || 14),
    atrMultiplier: Number(els.presetAtrMultiplier.value || 1.5),

    targetEnabled: !!els.presetTargetEnabled.checked,
    targetMode: els.presetTargetMode?.value || "rr",

    riskRewardRatio: Number(els.presetRiskRewardRatio.value || 2),
    targetPercent: Number(els.presetTargetPercent?.value || 2),
    fixedTargetAmount: Number(els.presetFixedTargetAmount?.value || 10),

    placeStopLoss: !!els.presetPlaceStopLoss.checked,
    placeTarget: !!els.presetPlaceTarget.checked,

    applyToChartStrategies: els.presetApplyToChartStrategies
      ? !!els.presetApplyToChartStrategies.checked
      : true,

    confirmBeforeSend: !!els.presetConfirm.checked
  };
}

function validatePresetSettings(settings) {
  if (settings.budgetEnabled && settings.budgetAmount <= 0) {
    return "Budget amount is required when Budget cap is enabled.";
  }

  if (settings.riskEnabled && settings.riskAmount <= 0) {
    return "Risk amount is required when risk sizing is enabled.";
  }

  if (settings.stopMode === "percent" && settings.stopPercent <= 0) {
    return "Stop percent must be greater than zero.";
  }

  if (settings.stopMode === "fixed" && settings.fixedStopAmount <= 0) {
    return "Fixed stop amount must be greater than zero.";
  }

  if (settings.stopMode === "atr") {
    if (settings.atrPeriod < 2) {
      return "ATR period must be at least 2.";
    }

    if (settings.atrMultiplier <= 0) {
      return "ATR multiplier must be greater than zero.";
    }
  }

  if (settings.placeTarget && !settings.placeStopLoss) {
    return "Target order requires stop-loss. Enable Place stop-loss order to use bracket presets.";
  }

  if (settings.targetEnabled) {
    if (settings.targetMode === "rr" && settings.riskRewardRatio <= 0) {
      return "Risk-reward ratio must be greater than zero.";
    }

    if (settings.targetMode === "percent" && settings.targetPercent <= 0) {
      return "Target percent must be greater than zero.";
    }

    if (settings.targetMode === "fixed" && settings.fixedTargetAmount <= 0) {
      return "Fixed target amount must be greater than zero.";
    }
  }

  return "";
}
function setPresetValidation(message, type = "error") {
  if (!els.presetValidation) return;

  els.presetValidation.textContent = message || "";
  els.presetValidation.classList.toggle("success", type === "success");
}

function updatePresetFieldStates() {
  const budgetEnabled = !!els.presetBudgetEnabled?.checked;
  const riskEnabled = !!els.presetRiskEnabled?.checked;
  const targetEnabled = !!els.presetTargetEnabled?.checked;

  const stopMode = els.presetStopMode?.value || "percent";
  const targetMode = els.presetTargetMode?.value || "rr";

  if (els.presetBudgetAmount) {
    els.presetBudgetAmount.disabled = !budgetEnabled;
  }

  if (els.presetRiskAmount) {
    els.presetRiskAmount.disabled = !riskEnabled;
  }

  if (els.presetStopPercent) {
    els.presetStopPercent.disabled = stopMode !== "percent";
  }

  if (els.presetFixedStopAmount) {
    els.presetFixedStopAmount.disabled = stopMode !== "fixed";
  }

  if (els.presetAtrPeriod) {
    els.presetAtrPeriod.disabled = stopMode !== "atr";
  }

  if (els.presetAtrMultiplier) {
    els.presetAtrMultiplier.disabled = stopMode !== "atr";
  }

  if (els.presetTargetMode) {
    els.presetTargetMode.disabled = !targetEnabled;
  }

  if (els.presetRiskRewardRatio) {
    els.presetRiskRewardRatio.disabled = !targetEnabled || targetMode !== "rr";
  }

  if (els.presetTargetPercent) {
    els.presetTargetPercent.disabled = !targetEnabled || targetMode !== "percent";
  }

  if (els.presetFixedTargetAmount) {
    els.presetFixedTargetAmount.disabled = !targetEnabled || targetMode !== "fixed";
  }

  const placeStopLoss = !!els.presetPlaceStopLoss?.checked;

  if (els.presetPlaceTarget) {
    els.presetPlaceTarget.disabled = !targetEnabled || !placeStopLoss;
  }

  if ((!targetEnabled || !placeStopLoss) && els.presetPlaceTarget) {
    els.presetPlaceTarget.checked = false;
  }
}

function savePresetSettingsFromModal() {
  const nextSettings = readPresetSettingsFromModal();
  const error = validatePresetSettings(nextSettings);

  if (error) {
    setPresetValidation(error);
    return;
  }

  presetSettings = nextSettings;
  savePresetSettingsToStorage();

  setPresetValidation("Preset settings saved.", "success");
  showToast("Preset settings saved", "success");

  setTimeout(() => {
    closePresetModal();
  }, 350);
}

function resetPresetSettings() {
  presetSettings = {
    budgetEnabled: false,
    budgetAmount: 0,

    riskEnabled: false,
    riskAmount: 0,

    stopMode: "percent",
    stopPercent: 1,
    fixedStopAmount: 5,

    atrPeriod: 14,
    atrMultiplier: 1.5,

    targetEnabled: true,
    targetMode: "rr",

    riskRewardRatio: 2,
    targetPercent: 2,
    fixedTargetAmount: 10,

    placeStopLoss: false,
    placeTarget: false,

    applyToChartStrategies: true,
    confirmBeforeSend: true
  };

  savePresetSettingsToStorage();
  renderPresetSettingsToModal();
  showToast("Preset settings reset", "info");
}
function getMaxQuantityWithinBudget(budget, price, action, lotSize = 1) {
  budget = Number(budget) || 0;
  price = Number(price) || 0;
  lotSize = Number(lotSize) || 1;

  if (budget <= 0 || price <= 0) return 0;

  let low = 0;
  let high = Math.floor(budget / price);
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const roundedQty = Math.floor(mid / lotSize) * lotSize;

    const exposureCost = getOrderExposureCost(action, roundedQty, price);

    if (exposureCost <= budget) {
      best = roundedQty;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
function getMaxQuantityWithinRisk(riskAmount, entryPrice, stopLossPrice, action, lotSize = 1) {
  riskAmount = Number(riskAmount) || 0;
  entryPrice = Number(entryPrice) || 0;
  stopLossPrice = Number(stopLossPrice) || 0;
  lotSize = Number(lotSize) || 1;

  if (riskAmount <= 0 || entryPrice <= 0 || stopLossPrice <= 0) return 0;

  const exitAction = action === "BUY" ? "SELL" : "BUY";

  const stopDistance = Math.abs(entryPrice - stopLossPrice);

  if (stopDistance <= 0) return 0;

  let low = 0;
  let high = Math.floor(riskAmount / stopDistance) + lotSize * 10;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const roundedQty = Math.floor(mid / lotSize) * lotSize;

    const entryEstimate = calculateOrderCost(action, roundedQty, entryPrice);
    const exitEstimate = calculateOrderCost(exitAction, roundedQty, stopLossPrice);

    const priceRisk = stopDistance * roundedQty;

    const totalRisk =
      priceRisk +
      entryEstimate.totalCharges +
      exitEstimate.totalCharges;

    if (totalRisk <= riskAmount) {
      best = roundedQty;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
function getMaxQuantityWithinAvailableCash(cash, price, action, lotSize = 1) {
  cash = Number(cash) || 0;
  price = Number(price) || 0;
  lotSize = Number(lotSize) || 1;

  if (cash <= 0 || price <= 0) return 0;

  let low = 0;
  let high = action === "BUY"
    ? Math.floor(cash / price)
    : Math.floor((cash * 1000) / price); // broad upper bound for shorts

  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const roundedQty = Math.floor(mid / lotSize) * lotSize;

    const requiredCash = getOrderCashRequirement(action, roundedQty, price);

    if (requiredCash <= cash) {
      best = roundedQty;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}