export function createLocalDateKey(timeZone: string): (time: number) => string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (time) => {
    const parts = formatter.formatToParts(time);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
}

// Calendar arithmetic avoids assuming every local day lasts 24 hours (DST).
export function completedWeekdays(now: number, timeZone: string): string[] {
  const cursor = new Date(`${createLocalDateKey(timeZone)(now)}T00:00:00Z`);
  const dates: string[] = [];
  while (dates.length < 5) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
  }
  return dates.reverse();
}
