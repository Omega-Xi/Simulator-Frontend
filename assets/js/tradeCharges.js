window.TELOTRADE_CHARGES = {
  brokerageFlat: 20,
  sttPercent: 0.00025,
  exchangePercent: 0.0000325,
  sebiPerCrore: 10,
  gstPercent: 0.18,
  stampDutyPercent: 0.00003
};

function calculateTradeCharges(turnover, side) {
  turnover = Number(turnover) || 0;
  side = String(side || "").toUpperCase();

  const config = window.TELOTRADE_CHARGES;

  const brokerage = config.brokerageFlat;
  const stt = side === "SELL" ? turnover * config.sttPercent : 0;
  const exchangeCharges = turnover * config.exchangePercent;
  const sebiCharges = (turnover / 10000000) * config.sebiPerCrore;
  const gst = (brokerage + exchangeCharges) * config.gstPercent;
  const stampDuty = side === "BUY" ? turnover * config.stampDutyPercent : 0;

  const totalCharges =
    brokerage +
    stt +
    exchangeCharges +
    sebiCharges +
    gst +
    stampDuty;

  return {
    brokerage,
    stt,
    exchangeCharges,
    sebiCharges,
    gst,
    stampDuty,
    totalCharges
  };
}

function calculateOrderCost(action, quantity, price) {
  action = String(action || "").toUpperCase();

  const turnover = Number(quantity || 0) * Number(price || 0);
  const charges = calculateTradeCharges(turnover, action);

  return {
    turnover,
    charges,
    totalCharges: charges.totalCharges,
    grossBuyCost: turnover + charges.totalCharges,
    netSellValue: turnover - charges.totalCharges
  };
}