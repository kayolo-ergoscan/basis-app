// Fee runway of a tracker's hot wallet (run your own). Pure, with no engine imports, so /tracker/run stays light.

/** Days a fee wallet lasts: commits per day and redemptions per day at 0.001 ERG each. */
export function runwayDays(balanceErg: number, commitsPerDay: number, redemptionsPerDay: number, feeErg = 0.001): number | null {
  const perDay = (commitsPerDay + redemptionsPerDay) * feeErg;
  if (!(balanceErg >= 0) || !(perDay > 0)) return null;
  return balanceErg / perDay;
}

/** Commits a day at a cadence of `intervalSeconds` (the reference default is 600 s → 144). */
export const commitsPerDay = (intervalSeconds = 600) => Math.floor(86_400 / intervalSeconds);
