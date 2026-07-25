const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sessionStartFromId(session: string) {
  const match = session.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return undefined;

  const [, year, month, day, hour, minute] = match;
  const parts = {
    year: 2000 + Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  const isValid = candidate.getUTCFullYear() === parts.year
    && candidate.getUTCMonth() === parts.month - 1
    && candidate.getUTCDate() === parts.day
    && candidate.getUTCHours() === parts.hour
    && candidate.getUTCMinutes() === parts.minute;
  if (!isValid) return undefined;

  return `${day} ${MONTH_LABELS[parts.month - 1]} ${parts.year} · ${hour}:${minute}`;
}
