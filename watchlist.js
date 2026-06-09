const host = "44.195.136.91";
const base_url = `https://${host}:7239`;
const token = localStorage.getItem("token");
const refreshToken = localStorage.getItem("refreshToken");
const ws_url = `wss://${host}:7239/ws?token=${token}`;
const useCookie = true;
let wsdata = null;
let selectedsymbol = "";
let currentLotSize = 0;
let selectedtimeframe= 1;
let candleBuckets = {};
let smaVisible = true;
let filledOrderVisible = false;
let crosshairActive = false;
let allOrders = [];
let pendingLines = [];
let triggerLines = [];
let currentOrderId = "";
const watchlistTable = document.getElementById("watchlisttable");
const container = document.getElementById('chart');
document.getElementById('buyBtn').addEventListener('click',()=>placeOrder("BUY"));
document.getElementById('sellBtn').addEventListener('click',()=>placeOrder("SELL"));
const chart = LightweightCharts.createChart(container,{
  width: container.clientWidth,
  height: container.clientHeight ,
  layout: {
    background: { color: '#000000'},
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: '#232323'},
    horzLines: { color: '#252525'},
  },
});
const tooltip =  document.getElementById('chartTooltip');
const smaTooltip = document.createElement('div');
smaTooltip.className = 'sma-tooltip';
container.appendChild(smaTooltip);
const legend = document.getElementById('chartLegend');
container.addEventListener('dblclick', () => {
  resetChartView(); // your function that calls timeScale().fitContent() and priceScale().reset()
});
const candleSeries = chart.addCandlestickSeries({
  priceScaleId: 'right',
});
const volumeSeries = chart.addHistogramSeries({
  color: 'rgba(38,166,154,0.5)',
  priceFormat: {type: 'volume'},
  priceScaleId: 'volume',
});
const smaSeries = chart.addLineSeries({
  color: 'rgba(245,166,35,0.9)',
  lineWidth: 1,
  crossHairMarkerVisible: false,
});
const executionsSeries = chart.addLineSeries({
    color: '#4db6ff',
    markerType: 'circle',
    markerSize: 8,
    priceLineVisible: false,
    lastValueVisible: false,
    priceScaleId: "right"
});
// Convert to local Time 
chart.applyOptions({
  localization: {
    timeFormatter: (timestamp) => {
      const date = new Date(timestamp * 1000); // convert seconds → ms
      return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: (time, tickMarkType, locale) => {
      // time is in seconds (Unix)
      const date = new Date(time * 1000);

      // Format to local time (IST in your case)
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
  },
  crosshair: {
    horzLine: {
      color: '#888',
      style: LightweightCharts.LineStyle.Dashed,
      width: 1,
      labelVisible: true,
    },
    vertLine: {
      color: '#888',
      style: LightweightCharts.LineStyle.Dashed,
      width: 1,
      labelVisible: true,
    },
    mode: LightweightCharts.CrosshairMode.Normal
  }
});
chart.priceScale('right').applyOptions({
    scaleMargins: {
        top: 0.1,
        bottom: 0.3,
    },
});
chart.priceScale('volume').applyOptions({
    scaleMargins: {
        top: 0.8,
        bottom: 0,
    },
});
chart.subscribeCrosshairMove(param => {
  if (!param.point || !param.time) {
    crosshairActive = false;
    tooltip.style.display = 'none';
    smaTooltip.style.display = 'none';
    return;
  }
  crosshairActive = true;

  // Use seriesData Map instead of seriesPrices
  const candleData = param.seriesData.get(candleSeries);
  const volumeData = param.seriesData.get(volumeSeries);
  const smaData = param.seriesData.get(smaSeries);
  // Convert price to chart coordinates
  const priceCoordinate = candleSeries.priceToCoordinate(candleData.high);
  const timeCoordinate = chart.timeScale().timeToCoordinate(candleData.time);

  if (candleData) {
    tooltip.style.display = 'block';
    tooltip.style.left = timeCoordinate + 10 + 'px';
    tooltip.style.top = priceCoordinate - 30 + 'px'; // place above candle

    const pctChange = ((candleData.close - candleData.open) / candleData.open) * 100;
    const formattedPct = (pctChange > 0 ? '+' : '') + pctChange.toFixed(2) + '%';

    tooltip.innerHTML = `
      ${formattedPct}
    `;
    tooltip.style.color = pctChange >= 0 ? '#26a69a' : '#ef5350';
    legend.innerHTML = `
      <div><strong>${selectedsymbol}</strong><br>Time: ${new Date(candleData.time * 1000).toLocaleTimeString()}</div>
      <div>O: ${candleData.open.toFixed(2)} H: ${candleData.high.toFixed(2)} L: ${candleData.low.toFixed(2)} C: ${candleData.close.toFixed(2)}</div>
      <div>Vol: ${volumeData ? volumeData.value.toFixed(0) : '-'}</div>
    `;
  } else {
    tooltip.style.display = 'none';
  }
  if (smaData) {
    // Convert SMA value + time into chart coordinates
    const smaY = smaSeries.priceToCoordinate(smaData.value);
    const smaX = chart.timeScale().timeToCoordinate(smaData.time);

    if (smaY !== null && smaX !== null) {
      smaTooltip.innerText = `SMA: ${smaData.value.toFixed(2)}`;
      smaTooltip.style.left = smaX + 25 +'px';   // place near SMA point
      smaTooltip.style.top = smaY - 15 + 'px';    // slightly above the line
      smaTooltip.style.display = 'block';
    } else {
      smaTooltip.style.display = 'none';
    }
  } else {
    smaTooltip.style.display = 'none';
  }
});
const ws = new WebSocket(ws_url);
ws.onopen = () => {
    showToast("WebSocket connection established","success");
  console.log("WebSocket connection established");
};
ws.onmessage = (event) => {
  wsdata = JSON.parse(event.data);
  console.log(wsdata);
  if(wsdata.TYPE === "HeartBeat"){
    const headerBar = document.querySelector(".headerBar");
    headerBar.classList.add("heartbeat");
    setTimeout(()=> headerBar.classList.remove("heartbeat"),2000);
  }
  if(wsdata.TYPE === "system")
  {
    showToast(wsdata.MESSAGE);
  }
  if(wsdata.TYPE === "trade_execution"){
    showToast(`${wsdata.DATA.ACTION} ${wsdata.DATA.STATUS} : ${wsdata.DATA.SYMBOL}`);
    loadUserData();
  }
  if(wsdata.TYPE === "order_trigger"){
    showToast(`${wsdata.DATA.Action} ${wsdata.DATA.MESSAGE} for ${wsdata.DATA.SYMBOL}`);
    loadUserData();
  }
  if(wsdata.TYPE === "live_feed" && selectedsymbol !== ""){
    console.log(wsdata);
    updateWatchlist(wsdata.DATA,watchlistTable);
    wsdata.DATA.forEach(processTick);
    updateEstimatedAmount(wsdata.DATA.find(t=>t.SYMBOL === selectedsymbol));
  }
};
ws.onclose = () => {
  showToast("WebSocket connection closed", "error");
  console.log("WebSocket connection closed");
}
document.addEventListener("DOMContentLoaded", async () => {
  if (!token) {
    window.location.href = "/login";
    return;
  }
  loadUserData();
  fetchOrderBook();
  const orderTypeSelect = document.getElementById("orderType");
  const limitPriceInput = document.getElementById("limitPrice");
  const triggerPriceInput = document.getElementById("triggerPrice");

  orderTypeSelect.addEventListener("change", (e) => {
    const orderType = (e.target.value || "").toLowerCase();

    // Reset
    limitPriceInput.disabled = true;
    limitPriceInput.value = "";
    triggerPriceInput.disabled = true;
    triggerPriceInput.value = "";

    if (orderType === "limit") {
      limitPriceInput.disabled = false;
      triggerPriceInput.value = "";
    } else if (orderType === "stoploss") {
      triggerPriceInput.disabled = false;
      limitPriceInput.value = "";
    } else if (orderType === "stoplimit") {
      limitPriceInput.disabled = false;
      triggerPriceInput.disabled = false;
    }
  });

  // Initialize state on page load
  const initialType = (orderTypeSelect.value || "").toLowerCase();
  limitPriceInput.disabled = initialType !== "limit" && initialType !== "stoplimit";
  triggerPriceInput.disabled = initialType !== "stoploss" && initialType !== "stoplimit";

  const availabletimeframes = await getAvailableTimeFrames();
  console.log(availabletimeframes);
  document.querySelectorAll('#timeframeSelector button').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      selectedtimeframe = parseInt(e.target.dataset.tf, 10);
      clearBuckets();
      await getCandleData();
      // toggle active class
      document.querySelectorAll('#timeframeSelector button')
        .forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    });
  });
  document.getElementById('toggleSMA').addEventListener('click', () => {
    smaVisible = !smaVisible;

    if (smaVisible) {
      const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time);
      const smaData = calculateSMA(candles, 3);
      smaSeries.setData(smaData);
      document.getElementById('toggleSMA').classList.add('active');
    } else {
      smaSeries.setData([]); // hide SMA
      document.getElementById('toggleSMA').classList.remove('active');
    }
  });
  document.getElementById('toggleFilledOrders').addEventListener('click', () => {
    filledOrderVisible = !filledOrderVisible;

  if(filledOrderVisible){
      plotFilledOrders();
      document.getElementById("toggleFilledOrders").classList.add('active');
    }else{
      candleSeries.setMarkers([]);
      document.getElementById("toggleFilledOrders").classList.remove('active');
    }
  });
  const addBtn = document.getElementById("addtowatchlistbtn");
  const removeFromWachlistbtns = document.querySelectorAll(".removefromwatchlistbtn");

  addBtn.addEventListener("click", async () => {
    const stocks = await fetch(`${base_url}/api/stocks`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    }).then(res => {
      if(!res.ok){
        throw new Error(`HTTP ${res.status} - ${res.statusText}`)
      }
      return res.json()
    }).catch(err => {
    console.error(err);
    showToast(err,"error");
    return [];
  });
  plotOrderLines();

  console.log(stocks);
    showStockListModal(stocks, (selectedStock) => {
        addToWatchlist(selectedStock, watchlistTable);
    });
  });

  removeFromWachlistbtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      // td with the ×
      const closeCell = e.target;

      // row containing the symbol
      const row = closeCell.parentElement;

      // first cell in the row (symbol)
      const symbol = row.firstElementChild.innerText;

      // now you can unsubscribe and remove the row
      ws.send(JSON.stringify({ action: "UNSUBSCRIBE", symbols: [symbol] }));
      if (symbol===selectedsymbol)
      {
        selectedsymbol = "";
        currentLotSize = 0;
      }
      row.remove();
    });
  });
});
function showStockListModal(stocks, onSelect) {
  const modal = document.createElement("div");
  modal.className = "modal";

  const content = document.createElement("div");
  content.className = "modal-content";

  const closeBtn = document.createElement("span");
  closeBtn.className = "close";
  closeBtn.innerHTML = "&times;";
  closeBtn.onclick = () => modal.remove();

  const title = document.createElement("h2");
  title.innerText = "Select Stock to Add";

  const stockList = document.createElement("ul");
  stockList.className = "stock-list";

  stocks.forEach(stock => {
    const item = document.createElement("li");
    item.innerText = stock;
    item.style.cursor = "pointer";
    item.onclick = () => {
      onSelect(stock);
    };
    stockList.appendChild(item);
  });

  content.appendChild(closeBtn);
  content.appendChild(title);
  content.appendChild(stockList);
  modal.appendChild(content);
  document.body.appendChild(modal);
}
function addToWatchlist(symbol, table) {
    const exists = Array.from(table.querySelectorAll("td"))
                      .some(cell => cell.innerText === symbol);
  if (exists) {
    showToast(`${symbol} already in watchlist`, "error");
    return;
  }
  ws.send(JSON.stringify({
    action: "SUBSCRIBE",
    symbols: [symbol] 
  }));

  const row = document.createElement("tr");
  row.className = "watchlistrow";
  const namecell = document.createElement("td");
  namecell.className = "watchlistsymbol";
  namecell.innerText = symbol;
  namecell.addEventListener("click",(e)=>{
    selectedsymbol = symbol;
    setLotsize(selectedsymbol);
    hightlightSelectedSymbol();
    clearBuckets();
    getCandleData();
    plotFilledOrders();
    plotOrderLines();
  });
  row.appendChild(namecell);
  const ltpcell = document.createElement("td");
  ltpcell.innerText = "";
  row.appendChild(ltpcell);
  const volatilitycell = document.createElement("td");
  volatilitycell.innerText = "";
  row.appendChild(volatilitycell);
  const closecell = document.createElement("td");
  const closeBtn = document.createElement("span");
  closecell.className = "watchlistrowclosecell"
  closeBtn.className = "removefromwatchlistbtn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", (e) => {
    const row = e.target.closest("tr"); // the whole row
    const symbol = row.firstElementChild.innerText; // first cell = symbol

    ws.send(JSON.stringify({ action: "UNSUBSCRIBE", symbols: [symbol] }));
    row.remove();
    showToast(`${symbol} removed from watchlist`, "info");
    if (selectedsymbol === symbol) {
      selectedsymbol = "";
      currentLotSize = 0;
      document.getElementById("lotinfo").innerHTML = "";
      clearBuckets(); // clears chart
    }
  });
  closecell.appendChild(closeBtn);
  row.appendChild(closecell);
  table.appendChild(row);
  showToast(`${symbol} added to watchlist`, "success");
  if(!selectedsymbol){
    selectedsymbol = symbol;
    setLotsize(selectedsymbol);
    hightlightSelectedSymbol();
    clearBuckets();
    getCandleData();
    plotFilledOrders();
    plotOrderLines();
  }
}
function hightlightSelectedSymbol(){
  document.querySelectorAll(".watchlistsymbol").forEach(el=>{
    if(el.innerText === selectedsymbol){
      el.classList.add("selected");
    }else{
      el.classList.remove("selected");
    }
  });
}
function showToast(message, type = "success") {
  // Create toast element
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = message;

  // Add to body
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 50);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
function updateWatchlist(data,table){
  const rows = Array.from(table.querySelectorAll("tr"));
  data.forEach(tick=>{
    const row = rows.find(r=>r.firstElementChild.innerText === tick.SYMBOL);
    if(row){
      row.children[1].innerText = tick.LTP.toFixed(2);
      row.children[2].innerText = tick.VOLATILITY.toFixed(2);
    }
  });
}
async function getCandleData(){
  const candleData = await fetch(`${base_url}/api/historicdata/${selectedsymbol}?timeFrameMinutes=${selectedtimeframe}`,{
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  }).then(res=>{
      if(!res.ok){
        throw new Error(`HTTP ${res.status} - ${res.statusText}`)
      }
      return res.json()
    }).catch(err=>{
    console.log(err);
    showToast(`Failed To Fetch Candle Data For ${selectedsymbol}?timeFrameMinutes=${selectedtimeframe}`,"error");
  });
  const formatted = candleData.map(c => ({
      time: Math.floor(c.TIMESTAMP / 1000), // convert ms → seconds
      open: c.OPEN,
      high: c.HIGH,
      low: c.LOW,
      close: c.CLOSE,
      volume: c.VOLUME,
    }));

  const formattedVolume = formatted.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? '#26a69933' : '#ef53502c', // green/red bars
  }));
  const smaData = calculateSMA(formatted, 3);
  candleSeries.setData(formatted);
  volumeSeries.setData(formattedVolume);
  if(smaVisible){
    smaSeries.setData(smaData);
  }
  else{
    smaSeries.setData([]);
  }
  const N = 30;
  const lastIndex = formatted.length - 1;
  const firstIndex = Math.max(0, lastIndex - (N - 1));

  chart.timeScale().setVisibleRange({
    from: formatted[firstIndex].time,
    to: formatted[lastIndex].time,
  });
  chart.timeScale().applyOptions({
    rightOffset: 5,   // number of empty bars to leave on the right
    timeVisible: true,   // show hours/minutes if available
    secondsVisible: true // show seconds if your data has them
  });
  candleBuckets = {};
  formatted.forEach(c=>{
    candleBuckets[c.time] = {...c};
  });
}
function getCandleTime(timestampMs){
  const seconds = Math.floor(timestampMs / 1000);
  const interval = selectedtimeframe * 60; // timeframe in seconds
  return Math.floor(seconds / interval) * interval;
}
function clearBuckets() {
  candleBuckets = {};
  candleSeries.setData([]); // clear chart
  volumeSeries.setData([]); // clear volume
  smaSeries.setData([]); // clear sma
}
function processTick(tick) {
  updateHoldingsPnL(tick);
  if (tick.SYMBOL !== selectedsymbol) return;

  const candleTime = getCandleTime(tick.LTT); // round to minute
  let bucket = candleBuckets[candleTime];

  if (!bucket) {
    // Start new candle
    bucket = {
      time: candleTime,
      open: tick.LTP,
      high: tick.LTP,
      low: tick.LTP,
      close: tick.LTP,
      volume: tick.LTQ,
    };
    candleBuckets[candleTime] = bucket;
  } else {
    // Update existing candle
    bucket.high = Math.max(bucket.high, tick.LTP);
    bucket.low = Math.min(bucket.low, tick.LTP);
    bucket.close = tick.LTP;
    bucket.volume = (bucket.volume||0) + tick.LTQ;
  }

  candleSeries.update(bucket);
  volumeSeries.update({
    time: bucket.time,
    value: bucket.volume,
    color: bucket.close >= bucket.open ? '#26a69933' : '#ef53502c',
  });
  const candles = Object.values(candleBuckets).sort((a,b)=>a.time - b.time);
  const smaData = calculateSMA(candles,3);
  const latestSMA = smaData[smaData.length - 1];
  if(latestSMA.value !== null && smaVisible){
    smaSeries.update(latestSMA);
  }
  if (!crosshairActive) {
    const candles = Object.values(candleBuckets).sort((a, b) => a.time - b.time);
    const latest = candles[candles.length - 1];
    if (latest) {
      legend.innerHTML = `
        <div><strong>${selectedsymbol}</strong><br>Time: ${new Date(latest.time * 1000).toLocaleTimeString()}</div>
        <div>O: ${latest.open.toFixed(2)} H: ${latest.high.toFixed(2)} L: ${latest.low.toFixed(2)} C: ${latest.close.toFixed(2)}</div>
        <div>Vol: ${latest.volume ? latest.volume.toFixed(0) : '-'}</div>
      `;
    }
  }
  updateHoldingsPnL(tick);
}
async function getAvailableTimeFrames() {
  const timeframeresponse = await fetch(`${base_url}/api/historicdata/timeframes`,{
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  }).then(res=>{
      if(!res.ok){
        throw new Error(`HTTP ${res.status} - ${res.statusText}`)
      }
      return res.json()
    }).catch(err=>{
    console.log(err);
    showToast(`Failed To Fetch Timeframes ${selectedsymbol}`,"error");
  });
  return timeframeresponse;
}
function getActiveCandleTimestamps(){
  return Object.values(candleBuckets).map(bucket=>bucket.time).sort((a,b)=>a-b);
}
function calculateSMA(data, period){
  return data.map((candle,index,arr)=>{
    if(index < period) return { time: candle.time, value: undefined };
    const slice = arr.slice(index - period, index);
    const avg = slice.reduce((sum, c)=> sum + c.close, 0) / period;
    return {time: candle.time, value: avg};
  });
}
function setLotsize(symbol) {
  fetch(`${base_url}/api/stocks/lot-size/${symbol}`,{
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  })
  .then(res =>{
    if(!res.ok){
      throw new Error(`HTTP ${res.status} - ${res.statusText}`);
    }
    return res.text();
    }).then(data=>{
    currentLotSize = parseInt(data,10);
    document.getElementById("lotinfo").innerHTML = ` (${currentLotSize} per lot)`;
  }).catch(err => showToast(err,"error"));
}
function placeOrder(action) {
  const lots = parseInt(document.getElementById('orderLot').value,10);
  if(isNaN(lots)||lots<=0){
    showToast("Please Enter Valid Lot Count","error");
    return;
  }
  const quantity = lots * currentLotSize;
  const orderType = document.getElementById("orderType").value;
  const limitPrice = parseFloat(document.getElementById("limitPrice").value) || 0.0;
  const triggerPrice = parseFloat(document.getElementById("triggerPrice").value) || 0.0;
  const orderPayload ={
    "ACTION": action,
    "SYMBOL": selectedsymbol,
    "QUANTITY": quantity,
    "ORDERTYPE": orderType,
    "PRICE": limitPrice,
    "TRIGGERPRICE": triggerPrice,
    "VALIDITY": "day",
    "TAG": "",
    "TIMESTAMP": Date.now()
  };
  fetch(`${base_url}/api/trade/place-order`,{
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(orderPayload)
  }).then(async res=>{
    const data = await res.json();
    if(!res.ok) {
      const errorMsg = `${data.MESSAGE}\n${(data.ERRORS || []).join(", ")}`;
      throw new Error(errorMsg);
    }
    return data;
  }).then(result=>{
    showToast(`${action} order ${result.STATUS}`, "success");
    loadUserData();
    clearOrderForm();
  }).catch(err =>{
    console.error("Error placing order:",err);
    showToast(err.message,"error");
  })
}
async function loadUserData(){
  try {
    const res = await fetch(`${base_url}/api/account/details`,{
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    if(!res.ok){
      throw new Error(`HTTP ${res.status} - ${res.statusText}`);
    }
    const userData = await res.json();
    document.querySelector(".userName").textContent = userData.NAME;
    document.querySelector(".userId").textContent = `ID: ${userData.USERID}`;
    // Realized PnL with conditional coloring
    const pnlSpan = document.querySelector(".pnl");
    pnlSpan.textContent = `Realized PnL: ₹${userData.REALIZEDPNL.toFixed(2)}`;
    pnlSpan.classList.toggle("positive", userData.REALIZEDPNL >= 0);
    pnlSpan.classList.toggle("negative", userData.REALIZEDPNL < 0);
    // Cash Balance
    document.querySelector(".cashBalance").textContent =
      `Cash Balance: ₹${userData.CASHBALANCE.toFixed(2)}`;
    // Margin Status
    document.querySelector(".marginStatus").textContent =
      `Margin: ${userData.MARGINENABLED ? "Enabled" : "Disabled"}`;
    // Verfied Badge
    if (userData.EMAILVERIFIED) {
      document.querySelector(".userName").insertAdjacentHTML(
        "beforeend",
        ' <i class="fa-solid fa-envelope-circle-check verified"></i>'
      );
    }
    // Holdings Section
    const holdingsPanel = document.querySelector("#holdingsPanel");
    holdingsPanel.innerHTML = ""; // reset

    Object.values(userData.HOLDINGS).forEach(holding => {
      const row = document.createElement("div");
      row.classList.add("holdingRow");
      row.classList.add(holding.ISACTIVE ? "active" : "closed");
      row.classList.add(holding.POSITIONTYPE.toLowerCase());

      row.innerHTML = `
        <div class="holdingLeft">
          <div class="holdingHeader">
            <span class="symbol">${holding.SYMBOL}</span>
            <span class="statusDot"></span>
          </div>
          <div class="holdingDetails">
            <span class="quantity">Qty: ${holding.QUANTITY}</span><br>
            <span class="avgPrice">Avg: ₹${holding.AVERAGEPRICE.toFixed(2)}</span>
          </div>
        </div>
        <div class="holdingRight">
          <div class="pnl">PnL: --</div>
          ${holding.ISACTIVE 
            ? `<button class="squareOffBtn" onclick="squareOff('${holding.SYMBOL}','${holding.QUANTITY}','${holding.POSITIONTYPE}')">Square Off</button>` 
            : `<button class="squareOffBtn" disabled>Square Off</button>`}
        </div>
      `;
      holdingsPanel.appendChild(row);
    });
  }catch(err){
    console.error("Error loading user data:", err);
    showToast("Failed to load account info", "error");
  }
  sortHoldings();
  fetchOrderBook();
  closeModifyDropdown();
  updateExitAllButtonState();
}
function updateHoldingsPnL(tick){
  const rows = document.querySelectorAll(".holdingRow.active");
  rows.forEach(row=>{
    const symbolEl = row.querySelector(".symbol");
    if(!symbolEl) return;

    if(symbolEl.textContent === tick.SYMBOL){
      const qty = parseFloat(row.querySelector(".quantity").textContent.replace("Qty: ", ""));
      const avg = parseFloat(row.querySelector(".avgPrice").textContent.replace("Avg: ₹", ""));
      const pnlEl = row.querySelector(".pnl");
      let pnlValue = 0;
      if (row.classList.contains("long")) {
        pnlValue = (tick.LTP - avg) * qty;
      } else if (row.classList.contains("short")) {
        pnlValue = (avg - tick.LTP) * qty;
      }
      pnlEl.textContent = `₹${pnlValue.toFixed(2)}`;
      pnlEl.classList.toggle("positive", pnlValue >= 0);
      pnlEl.classList.toggle("negative", pnlValue < 0);
    }
  });
  updateTotalPnL();
}
function updateTotalPnL() {
  let total = 0;
  document.querySelectorAll(".holdingRow.active").forEach(row => {
    const pnlEl = row.querySelector(".pnl");
    if (pnlEl) {
      const value = parseFloat(pnlEl.textContent.replace("₹", "")) || 0;
      total += value;
    }
  });

  const totalEl = document.querySelector(".totalPnL");
  totalEl.textContent = `Total PnL: ₹${total.toFixed(2)}`;
  totalEl.classList.toggle("positive", total >= 0);
  totalEl.classList.toggle("negative", total < 0);
}
function squareOff(symbol,quantity,positionType){
  const action = (positionType === "LONG") ? "SELL" : (positionType === "SHORT") ? "BUY" : "";
  const orderPayload ={
    "ACTION": action,
    "SYMBOL": symbol,
    "QUANTITY": quantity,
    "ORDERTYPE": "MARKET",
    "PRICE": 0.0,
    "TRIGGERPRICE": 0.0,
    "VALIDITY": "day",
    "TAG": "",
    "TIMESTAMP": Date.now()
  };
  fetch(`${base_url}/api/trade/place-order`,{
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(orderPayload)
  }).then(async res=>{
    const data = await res.json();
    if(!res.ok) {
      const errorMsg = `${data.MESSAGE}\n${(data.ERRORS || []).join(", ")}`;
      throw new Error(errorMsg);
    }
    return data;
  }).then(result=>{
    showToast(`${action} order ${result.STATUS}`, "success");
    loadUserData();
  }).catch(err =>{
    console.error("Error placing order:",err);
    showToast(err.message,"error");
  })
}
function exitAll(){
  const btn = document.querySelector(".exitAllBtn");
  if (btn) btn.disabled = true;
  // Find all active rows
  const rows = document.querySelectorAll(".holdingRow.active");
  rows.forEach(row => {
    const symbolEl = row.querySelector(".symbol");
    const qtyEl = row.querySelector(".quantity");
    const positionTypeEl = row.classList.contains("long") ? "LONG" : 
                           row.classList.contains("short") ? "SHORT" : null;

    if (symbolEl && qtyEl && positionTypeEl) {
      const symbol = symbolEl.textContent;
      const quantity = parseFloat(qtyEl.textContent.replace("Qty: ", ""));

      // Call your existing squareOff function
      squareOff(symbol, quantity, positionTypeEl);
    }
  });
  loadUserData().then(() => {
    if (btn) btn.disabled = false;
    clearOrderForm();
  });
}
function updateExitAllButtonState() {
  const btn = document.querySelector(".exitAllBtn");
  const activeRows = document.querySelectorAll(".holdingRow.active");
  if (btn) {
    btn.disabled = activeRows.length === 0;
  }
}
function sortHoldings() {
  const container = document.querySelector("#holdingsPanel");
  if (!container) return;

  const rows = Array.from(container.querySelectorAll(".holdingRow"));

  // Separate active vs inactive
  const activeRows = rows.filter(r => r.classList.contains("active"));
  const inactiveRows = rows.filter(r => !r.classList.contains("active"));

  // Clear container and re‑append
  container.innerHTML = "";
  activeRows.forEach(r => container.appendChild(r));
  inactiveRows.forEach(r => container.appendChild(r));
}
async function logOut(){
  try{
    const res = await fetch(`${base_url}/api/account/signout?useCookie=${useCookie}`,{
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: useCookie ? null : JSON.stringify(refreshToken)
    });
    const message = await res.text();
    if(!res.ok){
      throw new Error(message || `Logout Failed: ${res.status}`);
    }
    // Clear local storage/session
    localStorage.removeItem("token");
    sessionStorage.clear();
    // UI feedback
    showToast(message, "success");
    // Redirect to login page
    setTimeout(()=>{window.location.href = "/signin.html";},1000)
  }catch (err) {
    console.error("Error logging out:", err);
    showToast(err.message, "error");
  }
}
async function fetchOrderBook(){
  try{
    const res = await fetch(`${base_url}/api/orderbook`,{
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    if (!res.ok){
      throw new Error(`Failed to fetch Orderbook: ${res.status}`);
    }
    const orders = await res.json();
    allOrders = orders;
    console.log(orders);
    applyFilterAndSort();
    plotFilledOrders();
    plotOrderLines();
  }catch(err){
    console.error("Error fetching order book:", err);
    showToast("Unable to load order book", "error");
  }
}
function renderOrderBook(orders) {
  const container = document.querySelector(".orderBookContainer");
  container.innerHTML = "";

  orders.forEach(order => {
    const row = document.createElement("div");
    row.classList.add("orderRow", order.STATUS.toLowerCase());

    // Decide which price to show
    let displayPrice = "--";
    let triggerInfo = "--";
    if (order.ORDERTYPE === "MARKET") {
      displayPrice = "--";
    }else if(order.ORDERTYPE === "STOPLIMIT" || order.ORDERTYPE == "STOPLOSS"){
      displayPrice = order.PRICE != null ? order.PRICE.toFixed(2) : "--";
      triggerInfo = order.TRIGGERPRICE != null ? order.TRIGGERPRICE.toFixed(2) : "--";
    }    
    else {
      displayPrice = order.PRICE != null ? order.PRICE.toFixed(2) : "--";
    }

    // Executed price (only meaningful if filled)
    const execPrice = order.EXECUTEDPRICE != null ? order.EXECUTEDPRICE.toFixed(2) : "--";

    row.innerHTML = `
      <div class="orderInfo">
        <span class="symbol">${order.SYMBOL}</span>
        <span class="action">${order.ACTION}</span>
        <span class="qty">Qty: ${order.QUANTITY}</span>
        <span class="price">Price: ₹${displayPrice}</span>
        <span class="triggerprice">Trigger: ₹${triggerInfo}</span>
        <span class="execPrice">Executed: ₹${execPrice}</span>
        <span class="status">${order.STATUS}</span>
      </div>
    `;
    const modifyBtn = document.createElement("button");
    modifyBtn.classList.add("modifyBtn");
    modifyBtn.title = "Modify this order";
    modifyBtn.textContent = "Modify";
    modifyBtn.addEventListener("click", () => openModifyDropdown(order));

    const cancelBtn = document.createElement("button");
    cancelBtn.classList.add("cancelBtn");
    cancelBtn.title = "Cancel this order";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => cancelOrder(order.ORDERID));

    const actions = document.createElement("div");
    actions.classList.add("orderActions");
    if (order.STATUS === "Pending" || order.STATUS === "TriggerPending") {
      actions.appendChild(modifyBtn);
      actions.appendChild(cancelBtn);
    }
    row.appendChild(actions);
    container.appendChild(row);
  });
}
function applyFilterAndSort(){
  const filter = document.getElementById("statusFilter").value;
  const sortBy = document.getElementById("sortBy").value;
  let filtered = allOrders;
  if (filter !== "all") {
    filtered = allOrders.filter(o => o.STATUS.toLowerCase() === filter);
  }
  let sorted = [...filtered];
  switch (sortBy) {
    case "symbol":
      sorted.sort((a, b) => a.SYMBOL.localeCompare(b.SYMBOL));
      break;
    case "price":
      sorted.sort((a, b) => {
        const priceA = a.PRICE ?? a.EXECUTEDPRICE ?? a.TRIGGERPRICE ?? 0;
        const priceB = b.PRICE ?? b.EXECUTEDPRICE ?? b.TRIGGERPRICE ?? 0;
        return priceA - priceB;
      });
      break;
    case "time":
      sorted.sort((a, b) => (b.TIMESTAMP || 0) - (a.TIMESTAMP || 0));
      break;
    case "status":
      const statusOrder = {
        "Pending": 1,
        "TriggerPending": 2,
        "Filled": 3,
        "Cancelled": 4,
        "Rejected": 5
      };
      sorted.sort((a, b) => {
        const rankA = statusOrder[a.STATUS] ?? 99;
        const rankB = statusOrder[b.STATUS] ?? 99;
        return rankA - rankB;
      });
      break;
  }

  renderOrderBook(sorted);
}
async function cancelOrder(orderId) {
  try {
    const res = await fetch(`${base_url}/api/trade/cancel-order/${orderId}`,{
      method: "DELETE",
      headers: { 'Authorization': `Bearer ${token}`}
    });
    if(!res.ok){
      const err = await res.text();
      showToast(err || "Cancel failed","error");
      return;
    }
    const result = await res.json();
    showToast(result.MESSAGE,"success");
    loadUserData();
  }catch(err){
    console.error("Cancel error:", err);
    showToast("Cancel request failed","error");
  }
}
async function modifyOrder() {
  const newQty = document.getElementById("modifyQty").value;
  const newPrice = document.getElementById("modifyPrice").value;
  const newTrigger = document.getElementById("modifyTrigger").value;
  const newValidity = document.getElementById("modifyValidity").value;

  const payload = {
    ORDERID: currentOrderId,
    QUANTITY: parseInt(newQty),
    PRICE: newPrice ? parseFloat(newPrice) : null,
    TRIGGERPRICE: newTrigger ? parseFloat(newTrigger) : null,
    VALIDITY: newValidity || "day",
    TIMESTAMP: Date.now()
  };

  try {
    const res = await fetch(`${base_url}/api/trade/modify-order`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,   // ensure you have a valid JWT
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.MESSAGE || "Modify failed", "error");
      console.error("Modify error:", err.ERRORS);
      return;
    }

    const result = await res.json();
    showToast(result.MESSAGE, "success");

    // Refresh order book so changes are visible
    fetchOrderBook();
    closeModifyDropdown();
  } catch (err) {
    console.error("Modify request failed:", err);
    showToast("Modify request failed", "error");
  }
}
function openModifyDropdown(order){
  currentOrderId = order.ORDERID;
  document.getElementById("modifySymbol").innerText = `Modify Order — ${order.SYMBOL}`;
  document.getElementById("modifyQty").value = order.QUANTITY;
  document.getElementById("modifyPrice").value = order.PRICE ?? "";
  document.getElementById("modifyTrigger").value = order.TRIGGERPRICE ?? "";
  document.getElementById("modifyValidity").value = order.VALIDITY ?? "day";
  document.getElementById('modifyDropdown').classList.add("visible");
}
function closeModifyDropdown(){
  document.getElementById('modifyDropdown').classList.remove("visible");
}
function clearOrderForm() {
  document.getElementById("orderLot").value = "";
  document.getElementById("limitPrice").value = "";
  document.getElementById("triggerPrice").value = "";
  document.getElementById("estimatedAmount").innerText = "";
  document.getElementById("orderType").value = "market"; // reset dropdown
}
function updateEstimatedAmount(tick) {
  const lots = parseInt(document.getElementById("orderLot").value, 10) || 0;
  const lotSize = currentLotSize;
  let price =0;
  const orderType = document.getElementById("orderType").value;
  if(orderType === "market"){
    price = tick.LTP;
  }else if (orderType === "limit"){
    price = parseFloat(document.getElementById("limitPrice").value,10);
  }

  const quantity = lots * lotSize;
  const estimated = quantity * price;

  document.getElementById("estimatedAmount").innerText = 
    estimated > 0 ? `  ₹${estimated.toFixed(2)}` : "";
}
function getFilledOrders() {
  return allOrders.filter(
    o => o.STATUS.toLowerCase() === "filled" && o.SYMBOL === selectedsymbol
  );
}
function plotFilledOrders() {
    if (!selectedsymbol) return;
    const filledOrders = getFilledOrders();
    const groupedByCandle = new Map();
    const activeTimestamps = getActiveCandleTimestamps();
    if(activeTimestamps.length === 0) return;
    filledOrders.forEach(order => {
        const orderSeconds = Math.floor(order.EXECUTEDTIMESTAMP/1000);
        const exactChartTime = activeTimestamps.reduce((prev, curr)=> curr <= orderSeconds ? curr : prev, activeTimestamps[0]);
        if (!groupedByCandle.has(exactChartTime)) {
            groupedByCandle.set(exactChartTime, { buy: [], sell: [] });
        }
        
        if (order.ACTION === "BUY") {
            groupedByCandle.get(exactChartTime).buy.push(order);
        } else {
            groupedByCandle.get(exactChartTime).sell.push(order);
        }
    });
    const markers = [];
    for (const [candleTime, orders] of groupedByCandle) {
        if (orders.buy.length > 0) {
            const totalQty = orders.buy.reduce((sum, o) => sum + o.QUANTITY, 0);
            markers.push({
                time: candleTime,
                position: 'belowBar',
                color: '#2da54d',
                shape: 'arrowUp',
                text: `${totalQty}`
            });
        }
        if (orders.sell.length > 0) {
            const totalQty = orders.sell.reduce((sum, o) => sum + o.QUANTITY, 0);
            markers.push({
                time: candleTime,
                position: 'aboveBar',
                color: '#ff9800',
                shape: 'arrowDown',
                text: `${totalQty}`
            });
        }
    }
    markers.sort((a,b) => a.time - b.time);
    candleSeries.setMarkers(markers);
}
function getPendingOrders() {
  return allOrders.filter(
    o => o.STATUS.toLowerCase() === "pending" && o.SYMBOL === selectedsymbol
  );
}
function getTriggerPendingOrders() {
  return allOrders.filter(
    o => o.STATUS.toLowerCase() === "triggerpending" && o.SYMBOL === selectedsymbol
  );
}
function plotOrderLines() {
  // Clear all existing price lines
  pendingLines.forEach(line => candleSeries.removePriceLine(line));
  triggerLines.forEach(line => candleSeries.removePriceLine(line));
  pendingLines = [];
  triggerLines = [];
  
  // Plot pending orders
  const pendingOrders = getPendingOrders();
  pendingOrders.forEach(o =>{
    const line = candleSeries.createPriceLine({
      price: o.PRICE,
      color: '#005ed8',
      lineStyle: LightweightCharts.LineStyle.Dashed,
      lineWidth: 1,
      axisLabelVisible: true,
      title: `Pending ${o.ACTION} ${o.QUANTITY}`
    });
    pendingLines.push(line);
  });
  
  // Plot trigger pending orders
  const triggerOrders = getTriggerPendingOrders();
  triggerOrders.forEach(o => {
    if (o.TRIGGERPRICE) {
      const line = candleSeries.createPriceLine({
        price: o.TRIGGERPRICE,
        color: '#ff9800',
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `Trigger ${o.ACTION} ${o.QUANTITY}`
      });
      triggerLines.push(line);
    }
  });
}
function resetChartView(){
  getCandleData();
  plotFilledOrders();
  plotPendingOrders();
  plotTriggerOrders();
}
