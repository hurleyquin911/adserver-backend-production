const { isSuperadminName } = require('../constant/roles');

function hideAdRequests(metrics, user) {
  if (isSuperadminName(user?.role?.name)) return metrics;
  return Object.fromEntries(Object.entries(metrics).filter(([key]) => key !== 'request'));
}

function visibleEventRows(rows, user) {
  return isSuperadminName(user?.role?.name)
    ? rows
    : rows.filter((row) => row.type !== 'request');
}

module.exports = { hideAdRequests, visibleEventRows };
