const env = require('../config/env');

function mysqlOffset(timeZone = env.REPORT_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return '+00:00';
  return `${m[1]}${String(m[2]).padStart(2, '0')}:${(m[3] || '00').padStart(2, '0')}`;
}

function nodeOffset() {
  const min = -new Date().getTimezoneOffset();
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function rangeStart(fromYmd, timeZone = env.REPORT_TZ) {
  return new Date(`${fromYmd}T00:00:00${mysqlOffset(timeZone)}`);
}

function rangeEnd(toYmd, timeZone = env.REPORT_TZ) {
  return new Date(`${toYmd}T23:59:59${mysqlOffset(timeZone)}`);
}

function formatInTz(value, timeZone = env.REPORT_TZ) {
  if (!value) return '';
  const d = new Date(value);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function dayInTz(value, timeZone = env.REPORT_TZ) {
  const d = new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

module.exports = {
  mysqlOffset,
  nodeOffset,
  rangeStart,
  rangeEnd,
  formatInTz,
  dayInTz,
};
