'use strict';

const ZONE = 'Africa/Cairo';

function cairoParts(ms) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms)).forEach(function (part) { parts[part.type] = part.value; });
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

// The UTC instant at which Cairo shows the given date and HH:MM. Handles Egypt's daylight saving time.
function cairoInstant(dateString, hhmm) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dateMatch || !timeMatch) return null;
  const base = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]));
  for (const offsetHours of [2, 3]) {
    const candidate = base - offsetHours * 3600 * 1000;
    const parts = cairoParts(candidate);
    if (parts.date === dateString && parts.hour === Number(timeMatch[1]) && parts.minute === Number(timeMatch[2])) {
      return candidate;
    }
  }
  return null;
}

function addDays(dateString, days) {
  const parts = dateString.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days)).toISOString().slice(0, 10);
}

module.exports = { ZONE, cairoParts, cairoInstant, addDays };
