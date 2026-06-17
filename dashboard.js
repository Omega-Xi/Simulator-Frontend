const host = "localhost";
const base_url = window.TELOTRADE_API_BASE_URL || (location.port === "7239"?location.origin: `https://${host}:7239`);
const FLAT_ORDER_FEE = 20;
const PRESET_STORAGE_KEY = "tt_presetOrderSettings";
let token = sessionStorage.getItem("token"), refreshPromise = null, ws = null, wsReconnectTimer = null;
let selectedsymbol = localStorage.getItem("tt_selectedSymbol") || "", currentLotSize = 0, selectedtimeframe = Number(localStorage.getItem("tt_timeframe") || 1),
candleBuckets = {}, smaVisible = JSON.parse(localStorage.getItem("tt_smaVisible") ?? "true"), filledOrderVisible = JSON.parse(localStorage.getItem("tt_filledOrdersVisible") ?? "false"),
crosshairActive = false, allOrders = [], pendingLines = [], triggerLines = [], avgPositionLines = [],
pnlPositionLines = [], allHoldings = [], currentOrderId = "", totalCashMargin = 0, selectedOrderSide = "BUY";
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
  atrPeriod: 14,
  atrMultiplier: 1.5,

  targetEnabled: false,
  riskRewardRatio: 2,

  placeStopLoss: false,
  placeTarget: false,
  confirmBeforeSend: true
};
const els = {};
document.addEventListener("DOMContentLoaded", async() => {
  cacheDom();
  loadPresetSettings();
  if(!token){
    try{
      token = await refreshAccessToken()
    }
    catch{
      location.href = "signin.html"; return
    }
  }
  setupChart(); 
  setupEventHandlers(); 
  setupKeyboardShortcuts(); 
  restoreUiPreferences(); 
  setCompactMode(compactMode, false); 
  setOrderSide("BUY"); 
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
function cacheDom(){
  ["watchlistTable", 
    "watchlistBody", 
    "watchlistEmpty", 
    "chart", 
    "buyBtn", 
    "sellBtn", 
    "orderLot", 
    "orderType", 
    "limitPrice", 
    "triggerPrice", 
    "lotInfo", 
    "estimateBox", 
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
    "toggleFullscreenChart",
    "presetSettingsBtn",
    "presetModal",
    "closePresetModal",
    "presetBudgetEnabled",
    "presetBudgetAmount",
    "presetRiskEnabled",
    "presetRiskAmount",
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
function setupEventHandlers(){
  els.buyBtn.onclick = () => setOrderSide("BUY");
  els.sellBtn.onclick = () => setOrderSide("SELL");
  els.submitOrderBtn.onclick = () => submitSelectedOrder();
  if(els.toggleFullscreenChart)els.toggleFullscreenChart.onclick = toggleChartFullscreen;
  if(els.presetSettingsBtn)els.presetSettingsBtn.onclick = openPresetModal;
  if(els.closePresetModal)els.closePresetModal.onclick = closePresetModal;
  if(els.savePresetSettings)els.savePresetSettings.onclick = savePresetSettingsFromModal;
  if(els.resetPresetSettings)els.resetPresetSettings.onclick = resetPresetSettings;
  [
    els.presetBudgetEnabled,
    els.presetRiskEnabled,
    els.presetTargetEnabled
  ].forEach(input => {
    if(input){
      input.addEventListener("change",updatePresetFieldStates);
    }
  });
  if(els.presetModal){
    els.presetModal.addEventListener("click", event => {
      if(event.target === els.presetModal){
        closePresetModal();
      }
    })
  }
  [
    els.orderLot,
    els.limitPrice, 
    els.triggerPrice
  ].forEach(x => x.addEventListener("input", () => updateEstimatedAmount({
    LTP: currentLTP
  }
)));
  els.orderType.onchange = () => {
    fillOrderForm(els.orderType.value);
    updateEstimatedAmount({
      LTP: currentLTP
    }
)
  };
  document.querySelectorAll("#timeframeSelector button").forEach(btn => btn.onclick = async() => {
    selectedtimeframe = Number(btn.dataset.tf); localStorage.setItem("tt_timeframe", selectedtimeframe); document.querySelectorAll("#timeframeSelector button").forEach(b => b.classList.remove("active")); btn.classList.add("active"); clearBuckets(); if(selectedsymbol){
      await getCandleData(); plotFilledOrders(); plotOrderLines(); plotPositionLines()
    }
  }
);
  document.getElementById("toggleSMA").onclick = () => {
    smaVisible = !smaVisible;
    localStorage.setItem("tt_smaVisible", JSON.stringify(smaVisible));
    if(smaVisible){
      const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time);
      smaSeries.setData(calculateSMA(candles, 3));
      document.getElementById("toggleSMA").classList.add("active")
    }
    else{
      smaSeries.setData([]);
      document.getElementById("toggleSMA").classList.remove("active")
    }
  };
  document.getElementById("toggleFilledOrders").onclick = () => {
    filledOrderVisible = !filledOrderVisible;
    localStorage.setItem("tt_filledOrdersVisible", JSON.stringify(filledOrderVisible));
    if(filledOrderVisible){
      plotFilledOrders();
      document.getElementById("toggleFilledOrders").classList.add("active")
    }
    else{
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
    if(e.target === els.shortcutModal)closeShortcutHelp()
  };
  els.orderTabs.onclick = e => {
    const btn = e.target.closest("button[data-status]");
    if(!btn)return;
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
    if(e.key === "Enter"){
      e.preventDefault(); modifyOrder()
    }
  }
)
}
function restoreUiPreferences(){
  document.querySelectorAll("#timeframeSelector button").forEach(btn => btn.classList.toggle("active", Number(btn.dataset.tf) === selectedtimeframe));
  document.getElementById("toggleSMA").classList.toggle("active", smaVisible);
  document.getElementById("toggleFilledOrders").classList.toggle("active", filledOrderVisible)
}
async function refreshAccessToken(){
  if(!refreshPromise){
    refreshPromise = fetch(`${base_url}/api/account/refresh?useCookie=true`, {
      method: "POST", credentials: "include"
    }
).then(async res => {
      if(!res.ok)throw new Error("Session expired"); return res.json()
    }
).then(data => {
      token = data.TOKEN || data.token; if(!token)throw new Error("No token returned"); sessionStorage.setItem("token", token); return token
    }
).finally(() => refreshPromise = null)
  }
  return refreshPromise
}
async function apiFetch(url, options = {}, retry = true){
  if(!token)token = await refreshAccessToken();
  const headers = {
...(options.headers || {}), Authorization: `Bearer ${token}`
  };
  const res = await fetch(url, {
...options, headers, credentials: "include"
  }
);
  if(res.status === 401 && retry){
    try{
      const newToken = await refreshAccessToken();
      return apiFetch(url, {
...options, headers: {
...(options.headers || {}), Authorization: `Bearer ${newToken}`
        }
      }, false)
    }
    catch{
      sessionStorage.removeItem("token");
      location.href = "signin.html";
      throw new Error("Session expired")
    }
  }
  return res
}
async function readResponseError(res){
  const type = res.headers.get("content-type") || "";
  try{
    if(type.includes("application/json")){
      const data = await res.json();
      return data.MESSAGE || data.message || data.ERROR || data.error || (data.ERRORS || []).join(", ") || JSON.stringify(data)
    }
    return await res.text()
  }
  catch{
    return`HTTP ${res.status} - ${res.statusText}`
  }
}
function getWsUrl(){
  const api = new URL(base_url);
  const scheme = api.protocol === "https:"?"wss:": "ws:";
  return`${scheme}//${api.host}/ws?token=${encodeURIComponent(token)}`
}
async function connectWebSocket(){
  clearTimeout(wsReconnectTimer);
  if(!token){
    try{
      token = await refreshAccessToken()
    }
    catch{
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
    wsReconnectTimer = setTimeout(async() => {
      try{
        await refreshAccessToken(); connectWebSocket()
      }
      catch{
        location.href = "signin.html"
      }
    }, 1500)
  };
  ws.onerror = () => updateFeedStatus("offline")
}
function handleWebSocketMessage(event){
  let data;
  try{
    data = JSON.parse(event.data)
  }
  catch{
    return
  }
  if(data.TYPE === "HeartBeat"){
    pulseHeader();
    return
  }
  if(data.TYPE === "system"){
    showToast(data.MESSAGE || "System message", "info");
    return
  }
  if(data.TYPE === "trade_execution"){
    showToast(`${data.DATA.ACTION} ${data.DATA.STATUS}: ${data.DATA.SYMBOL}`, "success");
    loadUserData();
    fetchOrderBook();
    return
  }
  if(data.TYPE === "order_trigger"){
    showToast(`${data.DATA.Action||data.DATA.ACTION} triggered for ${data.DATA.SYMBOL}`, "info");
    loadUserData();
    fetchOrderBook();
    return
  }
  if(data.TYPE === "live_feed"){
    const ticks = data.DATA || [];
    updateWatchlist(ticks);
    ticks.forEach(processTick);
    const selectedTick = ticks.find(t => t.SYMBOL === selectedsymbol);
    if(selectedTick)updateEstimatedAmount(selectedTick);
    if(allLTP[selectedsymbol] !== undefined){
      currentLTP = allLTP[selectedsymbol];
      updateSelectedSymbolSummary()
    }
  }
}
function resubscribeWatchlist(){
  const symbols = getStoredWatchlist();
  if(symbols.length && ws?.readyState === WebSocket.OPEN)ws.send(JSON.stringify({
    action: "SUBSCRIBE", symbols
  }
))
}
function updateFeedStatus(state){
  const chip = document.getElementById("feedStatus"), dot = chip.querySelector(".statusDot");
  dot.className = `statusDot ${state==="live"?"live":state==="connecting"?"connecting":"offline"}`;
  chip.querySelector("span:last-child").textContent = state === "live"?"Feed Live": state === "connecting"?"Connecting": "Feed Offline"
}
function pulseHeader(){
  document.querySelector(".topBar")?.animate([{
    boxShadow: "0 0 0 rgba(201,169,110,0)"
  }, {
    boxShadow: "0 0 28px rgba(201,169,110,.18)"
  }, {
    boxShadow: "0 0 0 rgba(201,169,110,0)"
  }
], {
    duration: 1e3, easing: "ease-out"
  }
)
}
function setupChart(){
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
  candleSeries = chart.addCandlestickSeries({
    priceScaleId: "right", upColor: "#00c076", downColor: "#ff4d5a", wickUpColor: "#00c076", wickDownColor: "#ff4d5a", borderVisible: false
  }
);
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
      top:.12, bottom:.28
    }
  }
);
  chart.priceScale("volume").applyOptions({
    scaleMargins: {
      top:.82, bottom: 0
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
  els.chart.addEventListener("dblclick", resetChartView)
}
function onCrosshairMove(param){
  if(!param.point || !param.time){
    crosshairActive = false;
    tooltip.style.display = "none";
    smaTooltip.style.display = "none";
    return
  }
  const candleData = param.seriesData.get(candleSeries), volumeData = param.seriesData.get(volumeSeries),
  smaData = param.seriesData.get(smaSeries);
  if(!candleData){
    tooltip.style.display = "none";
    return
  }
  crosshairActive = true;
  const priceCoordinate = candleSeries.priceToCoordinate(candleData.high), timeCoordinate = chart.timeScale().timeToCoordinate(candleData.time);
  if(priceCoordinate === null || timeCoordinate === null){
    tooltip.style.display = "none";
    return
  }
  const pct = ((candleData.close - candleData.open) / candleData.open) * 100;
  tooltip.style.display = "block";
  tooltip.style.left = `${timeCoordinate+10}px`;
  tooltip.style.top = `${priceCoordinate-32}px`;
  tooltip.textContent = `${pct>0?"+":""}${pct.toFixed(2)}%`;
  tooltip.style.color = pct >= 0?"#00c076": "#ff4d5a";
  legend.innerHTML = `<div><strong>${selectedsymbol||"--"}</strong><br>Time: ${new Date(candleData.time*1e3).toLocaleTimeString("en-IN")}</div><div>O: ${fmtNum(candleData.open)} H: ${fmtNum(candleData.high)} L: ${fmtNum(candleData.low)} C: ${fmtNum(candleData.close)}</div><div>Vol: ${volumeData?Number(volumeData.value).toLocaleString("en-IN"):"-"}</div>`;
  if(smaData){
    const y = smaSeries.priceToCoordinate(smaData.value), x = chart.timeScale().timeToCoordinate(smaData.time);
    if(y !== null && x !== null){
      smaTooltip.textContent = `SMA: ${fmtNum(smaData.value)}`;
      smaTooltip.style.left = `${x+24}px`;
      smaTooltip.style.top = `${y-16}px`;
      smaTooltip.style.display = "block"
    }
    else smaTooltip.style.display = "none"
  }
  else smaTooltip.style.display = "none"
}
function getStoredWatchlist(){
  try{
    return JSON.parse(localStorage.getItem(watchlistStorageKey) || "[]")
  }
  catch{
    return[]
  }
}
function setStoredWatchlist(symbols){
  localStorage.setItem(watchlistStorageKey, JSON.stringify([...new Set(symbols)]))
}
function restoreWatchlist(){
  const symbols = getStoredWatchlist();
  symbols.forEach(s => addToWatchlistRow(s, false));
  updateWatchlistEmptyState();
  if(selectedsymbol && symbols.includes(selectedsymbol))selectSymbol(selectedsymbol);
  else if(symbols[0])selectSymbol(symbols[0]);
  resubscribeWatchlist()
}
async function openStockListModal(){
  try{
    const res = await apiFetch(`${base_url}/api/stocks`, {
      method: "GET"
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    const stocks = await res.json();
    latestStockList = stocks || [];
    renderStockList(latestStockList);
    els.stockModal.classList.remove("hidden");
    els.stockSearch.value = "";
    setTimeout(() => els.stockSearch.focus(), 60)
  }
  catch(err){
    console.error(err);
    showToast("Unable to load stocks", "error")
  }
}
let latestStockList = [];
function renderStockList(stocks){
  els.stockList.innerHTML = "";
  if(!stocks.length){
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
function filterStockList(){
  const q = els.stockSearch.value.trim().toLowerCase();
  renderStockList(latestStockList.filter(s => String(s).toLowerCase().includes(q)))
}
function addToWatchlist(symbol){
  const symbols = getStoredWatchlist();
  if(symbols.includes(symbol)){
    showToast(`${symbol} already in watchlist`, "info");
    return
  }
  symbols.push(symbol);
  setStoredWatchlist(symbols);
  addToWatchlistRow(symbol, true);
  if(ws?.readyState === WebSocket.OPEN)ws.send(JSON.stringify({
    action: "SUBSCRIBE", symbols: [symbol]
  }
));
  showToast(`${symbol} added to watchlist`, "success");
  if(!selectedsymbol)selectSymbol(symbol);
  updateWatchlistEmptyState()
}
function addToWatchlistRow(symbol){
  if(document.querySelector(`.watchlistrow[data-symbol="${cssEscape(symbol)}"]`))return;
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
function removeFromWatchlist(symbol){
  if(ws?.readyState === WebSocket.OPEN)ws.send(JSON.stringify({
    action: "UNSUBSCRIBE", symbols: [symbol]
  }
));
  document.querySelector(`.watchlistrow[data-symbol="${cssEscape(symbol)}"]`)?.remove();
  setStoredWatchlist(getStoredWatchlist().filter(s => s !== symbol));
  if(selectedsymbol === symbol){
    selectedsymbol = "";
    localStorage.removeItem("tt_selectedSymbol");
    clearBuckets();
    updateSelectedSymbolSummary();
    const symbols = getStoredWatchlist();
    if(symbols[0])selectSymbol(symbols[0])
  }
  updateWatchlistEmptyState();
  showToast(`${symbol} removed from watchlist`, "info")
}
async function selectSymbol(symbol){
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
  fillOrderForm(els.orderType.value)
}
function highlightSelectedSymbol(){
  document.querySelectorAll(".watchlistsymbol").forEach(el => {
    const row = el.closest(".watchlistrow"); el.classList.toggle("selected", row?.dataset.symbol === selectedsymbol)
  }
)
}
function updateWatchlist(ticks){
  ticks.forEach(tick => {
    const row = document.querySelector(`.watchlistrow[data-symbol="${cssEscape(tick.SYMBOL)}"]`); if(!row)return; const ltpCell = row.querySelector(".ltpCell"), volCell = row.querySelector(".volCell"), old = allLTPPrevious[tick.SYMBOL], next = Number(tick.LTP); if(old !== undefined && next !== old){
      ltpCell.classList.remove("price-up", "price-down"); void ltpCell.offsetWidth; ltpCell.classList.add(next > old?"price-up": "price-down")
    }
    allLTPPrevious[tick.SYMBOL] = next; ltpCell.textContent = fmtNum(next); volCell.textContent = tick.VOLATILITY != null?fmtNum(tick.VOLATILITY): "--"
  }
)
}
function updateWatchlistEmptyState(){
  els.watchlistEmpty.style.display = els.watchlistBody.querySelector(".watchlistrow")?"none": "grid"
}
let dragBound = false;
function setupWatchlistDrag(){
  if(dragBound)return;
  dragBound = true;
  let draggedRow = null;
  els.watchlistBody.addEventListener("dragstart", e => draggedRow = e.target.closest("tr"));
  els.watchlistBody.addEventListener("dragover", e => {
    e.preventDefault(); const targetRow = e.target.closest("tr"); if(!targetRow || targetRow === draggedRow)return; const rect = targetRow.getBoundingClientRect(), half = rect.top + rect.height / 2; els.watchlistBody.insertBefore(draggedRow, e.clientY < half?targetRow: targetRow.nextSibling)
  }
);
  els.watchlistBody.addEventListener("dragend", () => {
    setStoredWatchlist([...els.watchlistBody.querySelectorAll(".watchlistrow")].map(r => r.dataset.symbol)); draggedRow = null
  }
)
}
function selectWatchlistSymbol(index){
  const rows = [...document.querySelectorAll(".watchlistrow")];
  if(!rows.length)return;
  index = Math.max(0, Math.min(index, rows.length - 1));
  const symbol = rows[index].dataset.symbol;
  if(symbol)selectSymbol(symbol)
}
function moveWatchlistSelection(direction){
  const rows = [...document.querySelectorAll(".watchlistrow")];
  if(!rows.length)return;
  const current = rows.findIndex(r => r.dataset.symbol === selectedsymbol);
  selectWatchlistSymbol(current === - 1?0: current + direction)
}
async function getCandleData(){
  if(!selectedsymbol)return;
  try{
    const res = await apiFetch(`${base_url}/api/historicdata/${encodeURIComponent(selectedsymbol)}?timeFrameMinutes=${selectedtimeframe}`, {
      method: "GET"
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    const data = await res.json();
    const formatted = (data || []).map(c => ({
      time: Math.floor(c.TIMESTAMP / 1e3), open: Number(c.OPEN), high: Number(c.HIGH), low: Number(c.LOW), close: Number(c.CLOSE), volume: Number(c.VOLUME)
    }
));
    const vol = formatted.map(c => ({
      time: c.time, value: c.volume, color: c.close >= c.open?"rgba(0,192,118,.28)": "rgba(255,77,90,.24)"
    }
));
    candleSeries.setData(formatted);
    volumeSeries.setData(vol);
    smaSeries.setData(smaVisible?calculateSMA(formatted, 3): []);
    candleBuckets = {};
    formatted.forEach(c => candleBuckets[c.time] = {
...c
    }
);
    if(formatted.length){
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
  catch(err){
    console.error(err);
    showToast(`Failed to fetch candle data for ${selectedsymbol}`, "error")
  }
}
function processTick(tick){
  allLTP[tick.SYMBOL] = Number(tick.LTP);
  updateHoldingsPnL(tick);
  if(tick.SYMBOL === selectedsymbol){
    currentLTP = Number(tick.LTP);
    updateSelectedSymbolSummary();
    plotPositionLines()
  }
  if(tick.SYMBOL !== selectedsymbol)return;
  const candleTime = getCandleTime(tick.LTT);
  let bucket = candleBuckets[candleTime];
  if(!bucket){
    bucket = {
      time: candleTime, open: Number(tick.LTP), high: Number(tick.LTP), low: Number(tick.LTP), close: Number(tick.LTP),
      volume: Number(tick.LTQ) || 0
    };
    candleBuckets[candleTime] = bucket
  }
  else{
    bucket.high = Math.max(bucket.high, Number(tick.LTP));
    bucket.low = Math.min(bucket.low, Number(tick.LTP));
    bucket.close = Number(tick.LTP);
    bucket.volume = (bucket.volume || 0) + (Number(tick.LTQ) || 0)
  }
  candleSeries.update(bucket);
  volumeSeries.update({
    time: bucket.time, value: bucket.volume, color: bucket.close >= bucket.open?"rgba(0,192,118,.28)": "rgba(255,77,90,.24)"
  }
);
  const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time), smaData = calculateSMA(candles, 3),
  latest = smaData[smaData.length - 1];
  if(latest && latest.value !== undefined && smaVisible)smaSeries.update(latest);
  if(!crosshairActive){
    const l = candles[candles.length - 1];
    if(l)legend.innerHTML = `<div><strong>${selectedsymbol}</strong><br>Time: ${new Date(l.time*1e3).toLocaleTimeString("en-IN")}</div><div>O: ${fmtNum(l.open)} H: ${fmtNum(l.high)} L: ${fmtNum(l.low)} C: ${fmtNum(l.close)}</div><div>Vol: ${l.volume?Number(l.volume).toLocaleString("en-IN"):"-"}</div>`
  }
}
async function setLotsize(symbol){
  try{
    const res = await apiFetch(`${base_url}/api/stocks/lot-size/${encodeURIComponent(symbol)}`, {
      method: "GET"
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    currentLotSize = parseInt(await res.text(), 10) || 1;
    els.lotInfo.textContent = ` (${currentLotSize}/lot)`;
    updateEstimatedAmount({
      LTP: currentLTP
    }
);
    return currentLotSize
  }
  catch{
    currentLotSize = 1;
    els.lotInfo.textContent = " (1/lot)";
    return 1
  }
}
async function loadUserData(){
  try{
    const res = await apiFetch(`${base_url}/api/account/details`, {
      method: "GET", headers: {
        "Content-Type": "application/json"
      }
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
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
  catch(err){
    console.error(err);
    showToast("Failed to load account info", "error")
  }
}
async function fetchOrderBook(){
  try{
    const res = await apiFetch(`${base_url}/api/orderbook`, {
      method: "GET"
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    allOrders = await res.json();
    applyFilterAndSort();
    plotFilledOrders();
    plotOrderLines();
    plotPositionLines()
  }
  catch(err){
    console.error(err);
    showToast("Unable to load order book", "error")
  }
}
function setOrderSide(side){
  selectedOrderSide = side;
  els.buyBtn.classList.toggle("active-side", side === "BUY");
  els.sellBtn.classList.toggle("active-side", side === "SELL");
  document.querySelector(".orderTicket").dataset.side = side.toLowerCase();
  updateEstimatedAmount({
    LTP: currentLTP
  }
)
}
function submitSelectedOrder(){
  placeOrder(selectedOrderSide)
}
async function placeOrder(action){
  if(!selectedsymbol){
    showToast("Select a symbol before placing an order", "error");
    return
  }
  const lots = parseInt(els.orderLot.value, 10);
  if(isNaN(lots) || lots <= 0){
    showToast("Enter a valid lot count", "error");
    return
  }
  const quantity = lots * (currentLotSize || 1), orderType = els.orderType.value, limitPrice = parseFloat(els.limitPrice.value) || 0,
  triggerPrice = parseFloat(els.triggerPrice.value) || 0;
  if((orderType === "limit" || orderType === "stoplimit") && limitPrice <= 0){
    showToast("Enter a valid limit price", "error");
    els.limitPrice.focus();
    return
  }
  if((orderType === "stoploss" || orderType === "stoplimit") && triggerPrice <= 0){
    showToast("Enter a valid trigger price", "error");
    els.triggerPrice.focus();
    return
  }
  const activeHolding = getActiveHoldings();
  if(action === "SELL" && (!activeHolding || activeHolding.POSITIONTYPE !== "LONG")){
    if(!confirm("This may open or add to a SHORT position.Continue?"))return
  }
  if(getOrderEstimateValue() > totalCashMargin *.8 && action === "BUY"){
    if(!confirm("This order uses more than 80% of available cash.Continue?"))return
  }
  const payload = {
    ACTION: action, SYMBOL: selectedsymbol, QUANTITY: quantity, ORDERTYPE: orderType, PRICE: limitPrice,
    TRIGGERPRICE: triggerPrice, VALIDITY: "day", TAG: "", TIMESTAMP: Date.now()
  };
  try{
    const res = await apiFetch(`${base_url}/api/trade/place-order`, {
      method: "POST", headers: {
        "Content-Type": "application/json"
      }, body: JSON.stringify(payload)
    }
);
    const data = await res.json().catch(() => ({}));
    if(!res.ok)throw new Error(data.MESSAGE || data.message || (data.ERRORS || []).join(", ") || "Order failed");
    showToast(`${action} order ${data.STATUS||"placed"}`, "success");
    await loadUserData();
    await fetchOrderBook();
    clearOrderForm(false)
  }
  catch(err){
    console.error("Error placing order:", err);
    showToast(err.message || "Order failed", "error")
  }
}
function getOrderEstimateValue(){
  return (parseInt(els.orderLot.value, 10) || 0) * (currentLotSize || 0) * getEffectiveOrderPrice() + FLAT_ORDER_FEE
}
function getEffectiveOrderPrice(){
  const type = els.orderType.value;
  if(type === "market" || type === "stoploss")return Number(currentLTP || allLTP[selectedsymbol] || 0);
  return parseFloat(els.limitPrice.value) || 0
}
function clearOrderForm(resetSide = false){
  els.orderLot.value = "1";
  els.limitPrice.value = "";
  els.triggerPrice.value = "";
  els.orderType.value = "market";
  fillOrderForm("market");
  updateEstimatedAmount({
    LTP: currentLTP
  }
);
  if(resetSide)setOrderSide("BUY")
}
function fillOrderForm(orderType){
  if(allLTP[selectedsymbol] !== undefined)currentLTP = Number(allLTP[selectedsymbol]);
  els.limitPrice.disabled = true;
  els.triggerPrice.disabled = true;
  if(orderType === "limit"){
    els.limitPrice.disabled = false;
    els.limitPrice.value = currentLTP?currentLTP.toFixed(2): "";
    els.triggerPrice.value = ""
  }
  else if(orderType === "stoploss"){
    els.triggerPrice.disabled = false;
    els.triggerPrice.value = currentLTP?currentLTP.toFixed(2): "";
    els.limitPrice.value = ""
  }
  else if(orderType === "stoplimit"){
    els.limitPrice.disabled = false;
    els.triggerPrice.disabled = false;
    els.limitPrice.value = currentLTP?currentLTP.toFixed(2): "";
    els.triggerPrice.value = currentLTP?currentLTP.toFixed(2): ""
  }
  else{
    els.limitPrice.value = "";
    els.triggerPrice.value = ""
  }
}
function updateEstimatedAmount(tick){
  if(!selectedsymbol){
    els.estimateBox.innerHTML = '<div class="emptyMini">Select symbol and quantity to see estimate</div>';
    return
  }
  const lots = parseInt(els.orderLot.value, 10) || 0, qty = lots * (currentLotSize || 0), price = getEffectiveOrderPrice() || Number(tick?.LTP || currentLTP || 0);
  if(qty <= 0 || price <= 0){
    els.estimateBox.innerHTML = '<div class="emptyMini">Enter quantity and price</div>';
    return
  }
  const value = qty * price, required = value + FLAT_ORDER_FEE, after = totalCashMargin - required, enough = after >= 0,
  active = getActiveHoldings();
  let afterPosition = "";
  if(active){
    const q = Number(active.QUANTITY || 0);
    afterPosition = selectedOrderSide === "BUY"?(active.POSITIONTYPE === "SHORT"?`After: SHORT ${Math.max(0,q-qty)}`: `After: LONG ${q+qty}`): (active.POSITIONTYPE === "LONG"?`After: LONG ${Math.max(0,q-qty)}`: `After: SHORT ${q+qty}`)
  }
  else afterPosition = selectedOrderSide === "BUY"?`After: LONG ${qty}`: `After: SHORT ${qty}`;
  els.estimateBox.innerHTML = `<span class="estItem brand"><b>Qty</b>${qty.toLocaleString("en-IN")}</span><span class="estItem"><b>Value</b>${formatMoney(value)}</span><span class="estItem"><b>Fee</b>${formatMoney(FLAT_ORDER_FEE)}</span><span class="estItem ${selectedOrderSide==="BUY"&&!enough?"danger":"ok"}"><b>Required</b>${formatMoney(required)}</span><span class="estItem ${selectedOrderSide==="BUY"&&!enough?"danger":"ok"}"><b>After Cash</b>${formatMoney(after)}</span><span class="estItem brand"><b>Position</b>${afterPosition}</span>`
}
function renderOrderBook(orders){
  const container = document.querySelector(".orderBookContainer");
  container.innerHTML = "";
  if(!orders.length){
    container.innerHTML = '<div class="emptyState"><i class="fa-regular fa-clipboard"></i><strong>No orders found</strong><span>Orders will appear here after placement</span></div>';
    return
  }
  orders.forEach(order => {
    const row = document.createElement("div"); row.classList.add("orderRow", String(order.STATUS || "").toLowerCase()); let displayPrice = "--", triggerInfo = "--"; if(order.ORDERTYPE !== "MARKET"){
      displayPrice = order.PRICE != null?fmtNum(order.PRICE): "--"; if(order.ORDERTYPE === "STOPLIMIT" || order.ORDERTYPE === "STOPLOSS")triggerInfo = order.TRIGGERPRICE != null?fmtNum(order.TRIGGERPRICE): "--"
    }
    const exec = order.EXECUTEDPRICE != null?fmtNum(order.EXECUTEDPRICE): "--", action = String(order.ACTION || "").toUpperCase(); row.innerHTML = `<div class="orderInfo"><span class="symbol">${order.SYMBOL}</span><span class="action ${action.toLowerCase()}">${action}</span><span>Qty: ${order.QUANTITY}</span><span>Price: ₹${displayPrice}</span><span>Trigger: ₹${triggerInfo}</span><span>Executed: ₹${exec}</span><span class="status">${order.STATUS}</span></div>`; const actions = document.createElement("div"); actions.className = "orderActions"; if(order.STATUS === "Pending" || order.STATUS === "TriggerPending"){
      const m = document.createElement("button"); m.className = "modifyBtn"; m.textContent = "Modify"; m.onclick = () => openModifyDropdown(order); const c = document.createElement("button"); c.className = "cancelOrderBtn"; c.textContent = "Cancel"; c.onclick = () => cancelOrder(order.ORDERID); actions.append(m, c)
    }
    row.appendChild(actions); container.appendChild(row)
  }
)
}
function applyFilterAndSort(){
  let filtered = [...allOrders];
  if(orderFilterState.status !== "all")filtered = filtered.filter(o => String(o.STATUS || "").toLowerCase() === orderFilterState.status);
  if(orderFilterState.search)filtered = filtered.filter(o => String(o.SYMBOL || "").toLowerCase().includes(orderFilterState.search) || String(o.ORDERID || "").toLowerCase().includes(orderFilterState.search));
  switch(orderFilterState.sortBy){
    case"symbol": filtered.sort((a, b) => String(a.SYMBOL).localeCompare(String(b.SYMBOL)));
    break;
    case"price": filtered.sort((a, b) => (a.PRICE ?? a.EXECUTEDPRICE ?? a.TRIGGERPRICE ?? 0) - (b.PRICE ?? b.EXECUTEDPRICE ?? b.TRIGGERPRICE ?? 0));
    break;
    case"status": {
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
async function cancelOrder(orderId){
  if(!orderId)return;
  try{
    const res = await apiFetch(`${base_url}/api/trade/cancel-order/${encodeURIComponent(orderId)}`, {
      method: "DELETE"
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    const result = await res.json().catch(() => ({}));
    showToast(result.MESSAGE || "Order cancelled", "success");
    await fetchOrderBook()
  }
  catch(err){
    showToast(err.message || "Cancel failed", "error")
  }
}
function openModifyDropdown(order){
  currentOrderId = order.ORDERID;
  document.getElementById("modifySymbol").textContent = `Modify — ${order.SYMBOL}`;
  document.getElementById("modifyQty").value = order.QUANTITY || "";
  document.getElementById("modifyPrice").value = order.PRICE ?? "";
  document.getElementById("modifyTrigger").value = order.TRIGGERPRICE ?? "";
  document.getElementById("modifyValidity").value = order.VALIDITY ?? "day";
  document.getElementById("modifyDropdown").classList.add("visible");
  setTimeout(() => {
    const q = document.getElementById("modifyQty"); q.focus(); q.select()
  }, 60)
}
function closeModifyDropdown(){
  currentOrderId = "";
  document.getElementById("modifyDropdown").classList.remove("visible")
}
async function modifyOrder(){
  const payload = {
    ORDERID: currentOrderId, QUANTITY: parseInt(document.getElementById("modifyQty").value, 10), PRICE: document.getElementById("modifyPrice").value?parseFloat(document.getElementById("modifyPrice").value): null,
    TRIGGERPRICE: document.getElementById("modifyTrigger").value?parseFloat(document.getElementById("modifyTrigger").value): null,
    VALIDITY: document.getElementById("modifyValidity").value || "day", TIMESTAMP: Date.now()
  };
  try{
    const res = await apiFetch(`${base_url}/api/trade/modify-order`, {
      method: "PUT", headers: {
        "Content-Type": "application/json"
      }, body: JSON.stringify(payload)
    }
);
    if(!res.ok)throw new Error(await readResponseError(res));
    const result = await res.json();
    showToast(result.MESSAGE || "Order modified", "success");
    closeModifyDropdown();
    await fetchOrderBook()
  }
  catch(err){
    showToast(err.message || "Modify failed", "error")
  }
}
function renderHoldings(holdings){
  const panel = document.getElementById("holdingsPanel");
  panel.innerHTML = "";
  const values = Object.values(holdings || {}).sort((a, b) => Number(b.ISACTIVE) - Number(a.ISACTIVE));
  if(!values.length){
    panel.innerHTML = '<div class="emptyState"><i class="fa-solid fa-layer-group"></i><strong>No positions</strong><span>Open a long or short position to start tracking P&L</span></div>';
    return
  }
  values.forEach(h => {
    const row = document.createElement("div"), type = String(h.POSITIONTYPE || "FLAT").toLowerCase(); row.className = `holdingRow ${h.ISACTIVE?"active":"closed"} ${type}`; row.dataset.symbol = h.SYMBOL; row.dataset.quantity = h.QUANTITY; row.dataset.averagePrice = h.AVERAGEPRICE; row.dataset.positionType = h.POSITIONTYPE; row.innerHTML = `<div class="holdingLeft"><div class="holdingHeader"><span class="symbol">${h.SYMBOL}</span><span class="statusDotMini"></span></div><div class="holdingDetails"><span>Qty: ${Number(h.QUANTITY).toLocaleString("en-IN")}</span><br><span>Avg: ${formatMoney(h.AVERAGEPRICE)}</span></div></div><div class="holdingRight"><div class="pnl">₹--</div>${h.ISACTIVE?` <button class = "squareOffBtn" onclick = "squareOff('${h.SYMBOL}','${h.QUANTITY}','${h.POSITIONTYPE}')"> Square Off </button> `:` <button class = "squareOffBtn" disabled> Square Off </button> `}</div>`; row.onclick = async() => {
      await selectSymbol(h.SYMBOL); const lots = Math.max(1, Math.round(Number(h.QUANTITY || 1) / (currentLotSize || 1))); els.orderLot.value = lots; updateEstimatedAmount({
        LTP: currentLTP
      }
)
    }; panel.appendChild(row)
  }
)
}
function updateHoldingsPnL(tick){
  document.querySelectorAll(".holdingRow.active").forEach(row => {
    if(row.dataset.symbol !== tick.SYMBOL)return; const qty = Number(row.dataset.quantity) || 0, avg = Number(row.dataset.averagePrice) || 0, type = row.dataset.positionType; let pnl = 0; if(type === "LONG")pnl = (Number(tick.LTP) - avg) * qty; else if(type === "SHORT")pnl = (avg - Number(tick.LTP)) * qty; row.dataset.pnl = pnl; const el = row.querySelector(".pnl"); el.textContent = formatMoney(pnl); el.classList.toggle("positive", pnl >= 0); el.classList.toggle("negative", pnl < 0)
  }
);
  updateTotalPnL();
  updateSelectedSymbolSummary()
}
function updateTotalPnL(){
  let total = 0;
  document.querySelectorAll(".holdingRow.active").forEach(row => total += Number(row.dataset.pnl || 0));
  const el = document.querySelector(".totalPnL");
  el.textContent = formatMoney(total);
  el.classList.toggle("positive", total >= 0);
  el.classList.toggle("negative", total < 0)
}
function getActiveHoldings(){
  return allHoldings.find(h => h.SYMBOL === selectedsymbol && h.ISACTIVE)
}
async function squareOff(symbol, quantity, positionType){
  const action = positionType === "LONG"?"SELL": positionType === "SHORT"?"BUY": "";
  if(!action)return;
  const payload = {
    ACTION: action, SYMBOL: symbol, QUANTITY: Number(quantity), ORDERTYPE: "MARKET", PRICE: 0, TRIGGERPRICE: 0,
    VALIDITY: "day", TAG: "SQUARE_OFF", TIMESTAMP: Date.now()
  };
  try{
    const res = await apiFetch(`${base_url}/api/trade/place-order`, {
      method: "POST", headers: {
        "Content-Type": "application/json"
      }, body: JSON.stringify(payload)
    }
);
    const data = await res.json().catch(() => ({}));
    if(!res.ok)throw new Error(data.MESSAGE || (data.ERRORS || []).join(", ") || "Square off failed");
    showToast(`${symbol} square off ${data.STATUS||"sent"}`, "success");
    await loadUserData();
    await fetchOrderBook()
  }
  catch(err){
    showToast(err.message || "Square off failed", "error")
  }
}
function exitAll(){
  const active = [...document.querySelectorAll(".holdingRow.active")];
  if(!active.length){
    showToast("No active positions", "info");
    return
  }
  if(!confirm(`Exit all ${active.length} active positions?`))return;
  const btn = document.querySelector(".exitAllBtn");
  btn.disabled = true;
  Promise.all(active.map(row => squareOff(row.dataset.symbol, row.dataset.quantity, row.dataset.positionType))).finally(() => {
    btn.disabled = false; clearOrderForm()
  }
)
}
function updateExitAllButtonState(){
  const btn = document.querySelector(".exitAllBtn");
  if(btn)btn.disabled = document.querySelectorAll(".holdingRow.active").length === 0
}
function renderPositionBadges(){
  document.querySelectorAll(".positionSlot").forEach(el => el.innerHTML = "");
  allHoldings.filter(h => h.ISACTIVE).forEach(h => {
    const row = document.querySelector(`.watchlistrow[data-symbol="${cssEscape(h.SYMBOL)}"]`), slot = row?.querySelector(".positionSlot"); if(slot){
      const type = String(h.POSITIONTYPE || "").toLowerCase(); slot.innerHTML = `<span class="positionBadge ${type}">${h.POSITIONTYPE} ${h.QUANTITY}</span>`
    }
  }
)
}
function getFilledOrders(){
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "filled" && o.SYMBOL === selectedsymbol)
}
function plotFilledOrders(){
  if(!selectedsymbol || !filledOrderVisible){
    candleSeries.setMarkers([]);
    return
  }
  const orders = getFilledOrders(), activeTimestamps = getActiveCandleTimestamps();
  if(!orders.length || !activeTimestamps.length){
    candleSeries.setMarkers([]);
    return
  }
  const grouped = new Map();
  orders.forEach(order => {
    const seconds = Math.floor(Number(order.EXECUTEDTIMESTAMP || order.TIMESTAMP) / 1e3), chartTime = activeTimestamps.reduce((p, c) => c <= seconds?c: p, activeTimestamps[0]); if(!grouped.has(chartTime))grouped.set(chartTime, {
      buy: [], sell: []
    }
); (order.ACTION === "BUY"?grouped.get(chartTime).buy: grouped.get(chartTime).sell).push(order)
  }
);
  const markers = [];
  for(const[t, orders]of grouped){
    if(orders.buy.length){
      const q = orders.buy.reduce((s, o) => s + Number(o.QUANTITY), 0), avg = orders.buy.reduce((s, o) => s + Number(o.EXECUTEDPRICE) * Number(o.QUANTITY), 0) / q;
      markers.push({
        time: t, position: "belowBar", color: "#00c076", shape: "arrowUp", text: `${q} @ ${fmtNum(avg)}`
      }
)
    }
    if(orders.sell.length){
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
function getPendingOrders(){
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "pending" && o.SYMBOL === selectedsymbol)
}
function getTriggerPendingOrders(){
  return allOrders.filter(o => String(o.STATUS).toLowerCase() === "triggerpending" && o.SYMBOL === selectedsymbol)
}
function plotOrderLines(){
  pendingLines.forEach(line => candleSeries.removePriceLine(line));
  triggerLines.forEach(line => candleSeries.removePriceLine(line));
  pendingLines = [];
  triggerLines = [];
  getPendingOrders().forEach(o => {
    const price = o.PRICE ?? o.TRIGGERPRICE; if(!price)return; pendingLines.push(candleSeries.createPriceLine({
      price, color: "#f5c542", lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `Pending ${o.ACTION} ${o.QUANTITY}`
    }
))
  }
);
  getTriggerPendingOrders().forEach(o => {
    if(!o.TRIGGERPRICE)return; triggerLines.push(candleSeries.createPriceLine({
      price: o.TRIGGERPRICE, color: "#b56cff", lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `Trigger ${o.ACTION} ${o.QUANTITY}`
    }
))
  }
)
}
function plotPositionLines(){
  avgPositionLines.forEach(line => candleSeries.removePriceLine(line));
  pnlPositionLines.forEach(line => candleSeries.removePriceLine(line));
  avgPositionLines = [];
  pnlPositionLines = [];
  const h = getActiveHoldings();
  if(!h || !h.ISACTIVE)return;
  const ltp = allLTP[selectedsymbol] || currentLTP;
  if(!ltp)return;
  const avg = Number(h.AVERAGEPRICE), qty = Number(h.QUANTITY), pnl = h.POSITIONTYPE === "LONG"?(ltp - avg) * qty: (avg - ltp) * qty;
  avgPositionLines.push(candleSeries.createPriceLine({
    price: avg, color: "#c9a96e", lineWidth: 2, axisLabelVisible: true, title: `AVG ${qty}`
  }
));
  pnlPositionLines.push(candleSeries.createPriceLine({
    price: ltp, color: pnl >= 0?"#00c076": "#ff4d5a", lineWidth: 2, axisLabelVisible: true, title: `${pnl>=0?"+":""}${formatMoney(pnl)}`
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
    throw new Error("Enable Budget cap or ATR risk control first.");
  }

  const candidates = [];
  const candles = getSortedCandles();

  let atr = null;
  let stopDistance = null;
  let stopLossPrice = null;
  let targetPrice = null;

  if (presetSettings.budgetEnabled) {
    const budget = Number(presetSettings.budgetAmount);

    if (!budget || budget <= 0) {
      throw new Error("Budget amount is required.");
    }

    const usableBudget = Math.max(0, budget - FLAT_ORDER_FEE);
    const budgetQty = Math.floor(usableBudget / entryPrice);

    candidates.push(budgetQty);
  }

  if (presetSettings.riskEnabled) {
    const riskAmount = Number(presetSettings.riskAmount);
    const atrPeriod = Number(presetSettings.atrPeriod || 14);
    const atrMultiplier = Number(presetSettings.atrMultiplier || 1.5);

    if (!riskAmount || riskAmount <= 0) {
      throw new Error("Risk amount is required.");
    }

    if (atrPeriod < 2) {
      throw new Error("ATR period must be at least 2.");
    }

    if (!atrMultiplier || atrMultiplier <= 0) {
      throw new Error("ATR multiplier must be greater than zero.");
    }

    atr = calculateATR(candles, atrPeriod);
    stopDistance = atr * atrMultiplier;

    if (!stopDistance || stopDistance <= 0) {
      throw new Error("ATR stop distance could not be calculated.");
    }

    if (action === "BUY") {
      stopLossPrice = roundToTick(entryPrice - stopDistance);
    } else {
      stopLossPrice = roundToTick(entryPrice + stopDistance);
    }

    if (stopLossPrice <= 0) {
      throw new Error("Calculated stop-loss price is invalid.");
    }

    const riskQty = Math.floor(riskAmount / stopDistance);

    candidates.push(riskQty);
  }

  if (presetSettings.targetEnabled) {
    if (!presetSettings.riskEnabled) {
      throw new Error("Target by R:R requires ATR risk control.");
    }

    const riskRewardRatio = Number(presetSettings.riskRewardRatio || 2);

    if (!riskRewardRatio || riskRewardRatio <= 0) {
      throw new Error("Risk-reward ratio must be greater than zero.");
    }

    if (!stopDistance) {
      throw new Error("Stop distance unavailable for target calculation.");
    }

    if (action === "BUY") {
      targetPrice = roundToTick(entryPrice + stopDistance * riskRewardRatio);
    } else {
      targetPrice = roundToTick(entryPrice - stopDistance * riskRewardRatio);
    }

    if (targetPrice <= 0) {
      throw new Error("Calculated target price is invalid.");
    }
  }

  if (action === "BUY") {
    const maxCashQty = Math.floor(Math.max(0, totalCashMargin - FLAT_ORDER_FEE) / entryPrice);
    candidates.push(maxCashQty);
  }

  const rawFinalQty = Math.min(...candidates);
  const lotResult = floorQuantityToLot(rawFinalQty);

  if (lotResult.quantity <= 0 || lotResult.lots <= 0) {
    throw new Error("Preset rules calculated less than one valid lot.");
  }

  const tradeValue = lotResult.quantity * entryPrice;
  const requiredCash = tradeValue + FLAT_ORDER_FEE;
  const estimatedRisk = stopDistance ? lotResult.quantity * stopDistance : 0;
  const estimatedReward = targetPrice
    ? Math.abs(targetPrice - entryPrice) * lotResult.quantity
    : 0;

  if (presetSettings.budgetEnabled && requiredCash > Number(presetSettings.budgetAmount)) {
    throw new Error("Calculated order exceeds preset budget.");
  }

  if (action === "BUY" && requiredCash > totalCashMargin) {
    throw new Error("Preset buy exceeds available cash.");
  }

  return {
    action,
    symbol: selectedsymbol,
    entryPrice,
    quantity: lotResult.quantity,
    lots: lotResult.lots,
    tradeValue,
    requiredCash,
    fee: FLAT_ORDER_FEE,

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

function buildPresetExitPayloads(plan, groupTag) {
  const exitAction = plan.action === "BUY" ? "SELL" : "BUY";
  const payloads = [];

  if (presetSettings.placeStopLoss && plan.stopLossPrice) {
    payloads.push({
      ACTION: exitAction,
      SYMBOL: plan.symbol,
      QUANTITY: plan.quantity,
      ORDERTYPE: "stoploss",
      PRICE: 0,
      TRIGGERPRICE: plan.stopLossPrice,
      VALIDITY: "day",
      TAG: groupTag,
      TIMESTAMP: Date.now()
    });
  }

  if (presetSettings.placeTarget && plan.targetPrice) {
    payloads.push({
      ACTION: exitAction,
      SYMBOL: plan.symbol,
      QUANTITY: plan.quantity,
      ORDERTYPE: "limit",
      PRICE: plan.targetPrice,
      TRIGGERPRICE: 0,
      VALIDITY: "day",
      TAG: groupTag,
      TIMESTAMP: Date.now()
    });
  }

  return payloads;
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

function buildPresetConfirmMessage(plan) {
  const lines = [
    `${plan.action} ${plan.symbol}`,
    "",
    `Quantity: ${plan.quantity.toLocaleString("en-IN")}`,
    `Lots: ${plan.lots}`,
    `Entry: ${formatMoney(plan.entryPrice)}`,
    `Trade value: ${formatMoney(plan.tradeValue)}`,
    `Fee: ${formatMoney(plan.fee)}`,
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

  if (presetSettings.confirmBeforeSend) {
    const ok = confirm(buildPresetConfirmMessage(plan));
    if (!ok) return;
  }

  const groupTag = `PRESET_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const entryPayload = buildPresetEntryPayload(plan, groupTag);

  try {
    const entryResponse = await sendTradePayload(entryPayload);

    const status = String(
      entryResponse.STATUS ||
      entryResponse.status ||
      ""
    ).toLowerCase();

    showToast(`${plan.action} preset order ${status || "sent"}`, "success");

    await loadUserData();
    await fetchOrderBook();

    if (status === "filled") {
      await placePresetExitOrders(plan, groupTag);
    } else {
      showToast("Preset entry was not filled yet, exits were not placed.", "info");
    }

    clearOrderForm(false);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Preset order failed", "error");
  }
}

async function placePresetExitOrders(plan, groupTag) {
  const exitPayloads = buildPresetExitPayloads(plan, groupTag);

  if (!exitPayloads.length) return;

  let successCount = 0;

  for (const payload of exitPayloads) {
    try {
      await sendTradePayload(payload);
      successCount++;
    } catch (err) {
      console.error("Preset exit order failed:", err);
      showToast(err.message || "Preset exit order failed", "error");
    }
  }

  if (successCount > 0) {
    showToast(`${successCount} preset exit order(s) placed`, "success");
    await fetchOrderBook();
  }
}
function setupKeyboardShortcuts(){
  document.addEventListener("keydown", e => {
    const tag = e.target.tagName, isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT", key = e.key.toLowerCase(), ctrlOrCmd = e.ctrlKey || e.metaKey; if(e.repeat)return; if(key === "?" && !isTyping){
      e.preventDefault(); 
      openShortcutHelp(); 
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
    if(ctrlOrCmd && e.key === "Enter"){
      e.preventDefault(); submitSelectedOrder(); 
      return
    }
    if(e.altKey && e.key === "ArrowUp"){
      e.preventDefault(); adjustLots(1); 
      return
    }
    if(e.altKey && e.key === "ArrowDown"){
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
    if(e.key === "Escape"){
      e.preventDefault(); 
      if(isChartFullscreen){
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
    if(isTyping)return; if(e.altKey && key === "d"){
      e.preventDefault(); toggleCompactMode(); return
    }
    if(key === "f"){
      e.preventDefault(); toggleChartFullscreen(); return
    }
    if(key === "b"){
      e.preventDefault(); setOrderSide("BUY"); return
    }
    if(key === "s"){
      e.preventDefault(); setOrderSide("SELL"); return
    }
    if(key === "r"){
      e.preventDefault(); resetChartView(); return
    }
    if(key === "i"){
      e.preventDefault(); document.getElementById("toggleSMA").click(); return
    }
    if(key === "o"){
      e.preventDefault(); document.getElementById("toggleFilledOrders").click(); return
    }
    if(key === "x" && e.shiftKey){
      e.preventDefault(); exitAll(); return
    }
    if(key === "x"){
      e.preventDefault(); const h = getActiveHoldings(); if(h)squareOff(h.SYMBOL, h.QUANTITY, h.POSITIONTYPE); return
    }
    if(e.key === "ArrowDown"){
      e.preventDefault(); moveWatchlistSelection(1); return
    }
    if(e.key === "ArrowUp"){
      e.preventDefault(); moveWatchlistSelection(- 1); return
    }
    const map = {
      1: "1", 2: "5", 3: "15", 4: "30", 5: "60"
    }; if(map[key]){
      e.preventDefault(); document.querySelector(`#timeframeSelector button[data-tf="${map[key]}"]`)?.click(); return
    }
    if(e.altKey && key === "m"){
      e.preventDefault(); setOrderType("market"); return
    }
    if(e.altKey && key === "l"){
      e.preventDefault(); setOrderType("limit"); return
    }
    if(e.altKey && key === "t"){
      e.preventDefault(); setOrderType("stoploss")
    }
  }
)
}
function adjustLots(delta){
  const current = parseInt(els.orderLot.value, 10) || 1;
  els.orderLot.value = Math.max(1, current + delta);
  updateEstimatedAmount({
    LTP: currentLTP
  }
)
}
function setOrderType(type){
  els.orderType.value = type;
  fillOrderForm(type);
  updateEstimatedAmount({
    LTP: currentLTP
  }
)
}
function openShortcutHelp(){
  els.shortcutModal.classList.remove("hidden")
}
function closeShortcutHelp(){
  els.shortcutModal.classList.add("hidden")
}
function toggleChartFullscreen(){
  setChartFullscreen(!isChartFullscreen)
}
function setChartFullscreen(enabled){
  isChartFullscreen = enabled;
  document.body.classList.toggle("chartFullscreen", enabled);
  if(els.toggleFullscreenChart){
    els.toggleFullscreenChart.classList.toggle("active", enabled);
    const icon = els.toggleFullscreenChart.querySelector("i");
    if(icon)icon.className = enabled?"fa-solid fa-compress": "fa-solid fa-expand"
  }
  resizeChartToContainer(true)
}
function resizeChartToContainer(preserveRange = false){
  if(!chart || !els.chart)return;
  const visibleRange = preserveRange?chart.timeScale().getVisibleLogicalRange(): null;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chart.applyOptions({
        width: els.chart.clientWidth, height: els.chart.clientHeight
      }
); if(visibleRange)chart.timeScale().setVisibleLogicalRange(visibleRange)
    }
)
  }
)
}
function toggleCompactMode(){
  setCompactMode(!compactMode, true)
}
function setCompactMode(enabled, notify = true){
  compactMode = enabled;
  document.body.classList.toggle("compactMode", enabled);
  localStorage.setItem("tt_compactMode", JSON.stringify(enabled));
  resizeChartToContainer(true);
  if(notify)showToast(enabled?"Compact layout enabled": "Comfortable layout enabled", "info")
}
function getCandleTime(ms){
  const sec = Math.floor(Number(ms) / 1e3), interval = selectedtimeframe * 60;
  return Math.floor(sec / interval) * interval
}
function clearBuckets(){
  candleBuckets = {};
  candleSeries.setData([]);
  volumeSeries.setData([]);
  smaSeries.setData([]);
  candleSeries.setMarkers([]);
  legend.innerHTML = ""
}
function getActiveCandleTimestamps(){
  return Object.values(candleBuckets).map(b => b.time).sort((a, b) => a - b)
}
function calculateSMA(data, period){
  return data.map((c, i, arr) => {
    if(i < period)return{
      time: c.time, value: undefined
    }; const slice = arr.slice(i - period, i), avg = slice.reduce((s, x) => s + Number(x.close), 0) / period; return{
      time: c.time, value: avg
    }
  }
)
}
async function resetChartView(){
  if(!selectedsymbol)return;
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
function updateSelectedSymbolSummary(){
  const title = document.getElementById("selectedSymbolTitle"), sub = document.getElementById("selectedSymbolSub"),
  ltpEl = document.getElementById("symbolLtp"), posEl = document.getElementById("symbolPosition"), pnlEl = document.getElementById("symbolPnl");
  els.ticketSymbol.textContent = selectedsymbol || "--";
  if(!selectedsymbol){
    title.textContent = "Select a symbol";
    sub.textContent = "Use watchlist ↑ ↓ to navigate";
    ltpEl.textContent = "₹--";
    posEl.textContent = "--";
    pnlEl.textContent = "₹--";
    return
  }
  title.textContent = selectedsymbol;
  sub.textContent = `Timeframe ${selectedtimeframe}m · Flat fee ₹${FLAT_ORDER_FEE}`;
  const ltp = allLTP[selectedsymbol] || currentLTP;
  ltpEl.textContent = ltp?formatMoney(ltp): "₹--";
  const h = getActiveHoldings();
  if(h){
    posEl.textContent = `${h.POSITIONTYPE} ${h.QUANTITY}`;
    const pnl = h.POSITIONTYPE === "LONG"?(ltp - Number(h.AVERAGEPRICE)) * Number(h.QUANTITY): (Number(h.AVERAGEPRICE) - ltp) * Number(h.QUANTITY);
    pnlEl.textContent = ltp?formatMoney(pnl): "₹--";
    pnlEl.classList.toggle("positive", pnl >= 0);
    pnlEl.classList.toggle("negative", pnl < 0)
  }
  else{
    posEl.textContent = "--";
    pnlEl.textContent = "₹--";
    pnlEl.classList.remove("positive", "negative")
  }
  updateEstimatedAmount({
    LTP: ltp
  }
)
}
function updateMarketStatus(){
  const chip = document.getElementById("marketStatus"), dot = chip.querySelector(".statusDot"), label = chip.querySelector("span:last-child"),
  ist = new Date(new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata"
  }
)), mins = ist.getHours() * 60 + ist.getMinutes(), isWeekday = ist.getDay() >= 1 && ist.getDay() <= 5,
  isOpen = isWeekday && mins >= 555 && mins <= 930;
  dot.className = `statusDot ${isOpen?"open":"closed"}`;
  label.textContent = isOpen?"Market Open": "Market Closed"
}
function fmtNum(value){
  const n = Number(value);
  return Number.isFinite(n)?n.toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }
): "--"
}
function formatMoney(value){
  const n = Number(value);
  return Number.isFinite(n)?`₹${n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`: "₹--"
}
function cssEscape(value){
  return window.CSS && CSS.escape?CSS.escape(value): String(value).replace(/ ["\\]/g,"\\$&")
}
function showToast(message,type="success")
{
  const toast = document.createElement("div");
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
  toast.className=`toast ${type}`;
  toast.innerHTML=`<i class="fa-solid ${icon}"></i> ${message}`;
  document.getElementById("toastContainer").appendChild(toast);
  setTimeout(()=>toast.classList.add("show"),40);
  setTimeout(()=>{
    toast.classList.remove("show");
    setTimeout(()=>toast.remove(),250)
  },3200);
}
async function logOut()
{
  try
  {
    await apiFetch(`${base_url}/api/account/signout?useCookie=true`,
      {
        method:"POST"
      }
    )
  }catch{}finally
  {
    sessionStorage.removeItem("token");
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    location.href="signin.html"
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

  els.presetBudgetEnabled.checked = presetSettings.budgetEnabled;
  els.presetBudgetAmount.value = presetSettings.budgetAmount || "";

  els.presetRiskEnabled.checked = presetSettings.riskEnabled;
  els.presetRiskAmount.value = presetSettings.riskAmount || "";
  els.presetAtrPeriod.value = presetSettings.atrPeriod || 14;
  els.presetAtrMultiplier.value = presetSettings.atrMultiplier || 1.5;

  els.presetTargetEnabled.checked = presetSettings.targetEnabled;
  els.presetRiskRewardRatio.value = presetSettings.riskRewardRatio || 2;

  els.presetPlaceStopLoss.checked = presetSettings.placeStopLoss;
  els.presetPlaceTarget.checked = presetSettings.placeTarget;
  els.presetConfirm.checked = presetSettings.confirmBeforeSend;

  updatePresetFieldStates();
  setPresetValidation("");
}

function readPresetSettingsFromModal() {
  return {
    budgetEnabled: els.presetBudgetEnabled.checked,
    budgetAmount: Number(els.presetBudgetAmount.value || 0),

    riskEnabled: els.presetRiskEnabled.checked,
    riskAmount: Number(els.presetRiskAmount.value || 0),
    atrPeriod: Number(els.presetAtrPeriod.value || 14),
    atrMultiplier: Number(els.presetAtrMultiplier.value || 1.5),

    targetEnabled: els.presetTargetEnabled.checked,
    riskRewardRatio: Number(els.presetRiskRewardRatio.value || 2),

    placeStopLoss: els.presetPlaceStopLoss.checked,
    placeTarget: els.presetPlaceTarget.checked,
    confirmBeforeSend: els.presetConfirm.checked
  };
}

function validatePresetSettings(settings) {
  if (!settings.budgetEnabled && !settings.riskEnabled) {
    return "Enable Budget cap or ATR risk control before saving.";
  }

  if (settings.budgetEnabled && settings.budgetAmount <= 0) {
    return "Budget amount is required when Budget cap is enabled.";
  }

  if (settings.riskEnabled && settings.riskAmount <= 0) {
    return "Risk amount is required when ATR risk control is enabled.";
  }

  if (settings.riskEnabled && settings.atrPeriod < 2) {
    return "ATR period must be at least 2.";
  }

  if (settings.riskEnabled && settings.atrMultiplier <= 0) {
    return "ATR multiplier must be greater than zero.";
  }

  if (settings.targetEnabled && !settings.riskEnabled) {
    return "Target by R:R requires ATR risk control.";
  }

  if (settings.targetEnabled && settings.riskRewardRatio <= 0) {
    return "Risk-reward ratio must be greater than zero.";
  }

  if (settings.placeStopLoss && !settings.riskEnabled) {
    return "Stop-loss placement requires ATR risk control.";
  }

  if (settings.placeTarget && !settings.targetEnabled) {
    return "Target placement requires Target by R:R.";
  }

  return "";
}

function setPresetValidation(message, type = "error") {
  if (!els.presetValidation) return;

  els.presetValidation.textContent = message || "";
  els.presetValidation.classList.toggle("success", type === "success");
}

function updatePresetFieldStates() {
  const budgetEnabled = els.presetBudgetEnabled.checked;
  const riskEnabled = els.presetRiskEnabled.checked;
  const targetEnabled = els.presetTargetEnabled.checked;

  els.presetBudgetAmount.disabled = !budgetEnabled;

  els.presetRiskAmount.disabled = !riskEnabled;
  els.presetAtrPeriod.disabled = !riskEnabled;
  els.presetAtrMultiplier.disabled = !riskEnabled;

  els.presetTargetEnabled.disabled = !riskEnabled;
  els.presetRiskRewardRatio.disabled = !targetEnabled || !riskEnabled;

  els.presetPlaceStopLoss.disabled = !riskEnabled;
  els.presetPlaceTarget.disabled = !targetEnabled || !riskEnabled;

  if (!riskEnabled) {
    els.presetTargetEnabled.checked = false;
    els.presetPlaceStopLoss.checked = false;
    els.presetPlaceTarget.checked = false;
  }

  if (!targetEnabled) {
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
    atrPeriod: 14,
    atrMultiplier: 1.5,

    targetEnabled: false,
    riskRewardRatio: 2,

    placeStopLoss: false,
    placeTarget: false,
    confirmBeforeSend: true
  };

  savePresetSettingsToStorage();
  renderPresetSettingsToModal();
  showToast("Preset settings reset", "info");
}