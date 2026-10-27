const { dayInTz } = require('./reportTz');

function defaultFromTo(query = {}) {
  const to = query.to || dayInTz(new Date());
  if (query.from) return { from: query.from, to };
  const d = new Date(`${to}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return { from: d.toISOString().slice(0, 10), to };
}

function emptyTotals() {
  return {
    request: 0,
    no_fill: 0,
    impression: 0,
    viewable_impression: 0,
    click: 0,
    interaction: 0,
    interaction_unique: 0,
  };
}

function addRow(totals, type, count) {
  const key = type;
  if (totals[key] == null) totals[key] = 0;
  totals[key] += Number(count) || 0;
}

function withRates(totals) {
  const t = { ...emptyTotals(), ...totals };
  const request = t.request;
  const impression = t.impression;
  const fill_rate = request ? (request - t.no_fill) / request : 0;
  const viewability_rate = impression ? t.viewable_impression / impression : 0;
  const ctr = impression ? t.click / impression : 0;
  const interaction_rate = impression ? t.interaction_unique / impression : 0;
  return {
    ...t,
    fill_rate: Number(fill_rate.toFixed(4)),
    viewability_rate: Number(viewability_rate.toFixed(4)),
    ctr: Number(ctr.toFixed(4)),
    interaction_rate: Number(interaction_rate.toFixed(4)),
    fill_rate_pct: Number((fill_rate * 100).toFixed(2)),
    viewability_rate_pct: Number((viewability_rate * 100).toFixed(2)),
    ctr_pct: Number((ctr * 100).toFixed(2)),
    interaction_rate_pct: Number((interaction_rate * 100).toFixed(2)),
  };
}

/** Kompatibel endpoint lama: ctr/interaction_rate dalam persen 2 desimal. */
function legacySummary(rows) {
  const totals = {
    impression: 0,
    viewable_impression: 0,
    click: 0,
    interaction: 0,
  };
  for (const r of rows) {
    if (totals[r.type] == null) continue;
    totals[r.type] += Number(r.total || r.count || 0);
  }
  const ctr = totals.impression ? (totals.click / totals.impression) * 100 : 0;
  const interaction_rate = totals.impression
    ? (totals.interaction / totals.impression) * 100
    : 0;
  return {
    impression: totals.impression,
    viewable_impression: totals.viewable_impression,
    click: totals.click,
    interaction: totals.interaction,
    ctr: Number(ctr.toFixed(2)),
    interaction_rate: Number(interaction_rate.toFixed(2)),
  };
}

module.exports = { defaultFromTo, emptyTotals, addRow, withRates, legacySummary };
