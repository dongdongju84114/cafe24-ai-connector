export function parseCafe24TimestampMs(value) {
  if (!value || typeof value !== 'string') {
    return Number.NaN;
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return Date.parse(value);
  }

  return Date.parse(`${value}+09:00`);
}
