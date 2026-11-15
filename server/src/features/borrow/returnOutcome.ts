/**
 * How a finished borrow is recorded in Usage History.
 *
 *   returned after the window ended            → COMPLETED_LATE
 *   returned in the last 10 min of the window  → COMPLETED
 *   returned earlier than that                 → COMPLETED_EARLY
 *   (a damaged article always wins             → COMPLETED_DAMAGED)
 *
 * Example: window 3:00–4:00 pm. Back at 3:30 → Completed — Early.
 * Back at 3:55 → Completed. Back at 4:05 → Completed — Late.
 */
export const ON_TIME_BAND_MINUTES = 10;

export type ReturnOutcome = 'COMPLETED' | 'COMPLETED_EARLY' | 'COMPLETED_LATE' | 'COMPLETED_DAMAGED';

export function returnOutcome(returnedAt: Date, agreedReturnAt: Date | string, damaged = false): ReturnOutcome {
  if (damaged) return 'COMPLETED_DAMAGED';
  const end = new Date(agreedReturnAt).getTime();
  const t = returnedAt.getTime();
  if (t > end) return 'COMPLETED_LATE';
  if (t < end - ON_TIME_BAND_MINUTES * 60_000) return 'COMPLETED_EARLY';
  return 'COMPLETED';
}

// ── Borrow-window rules shared by requests and lending ──
const TZ = 'Asia/Karachi';

/** Saturday / Sunday in Karachi — the sports office doesn't lend on weekends. */
export function isWeekendKarachi(d: Date): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  return wd === 'Sat' || wd === 'Sun';
}
