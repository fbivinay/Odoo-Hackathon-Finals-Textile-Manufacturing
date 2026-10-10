// Extra realism checks on top of `npm run data:check` (which covers the import rules).
// Run by build.js after writing; throws if a dataset breaks one.
const IST = 5.5 * 3600 * 1000;
const H = 3600 * 1000;

function verifyFloor(data, label) {
  const holidays = new Set(require('./generate').HOLIDAYS);
  // Attendance date of the shift a job starts in: night shifts belong to the day they start.
  const rosterDay = (iso) => {
    const t = Date.parse(iso) + IST;
    return new Date(new Date(t).getUTCHours() < 6 ? t - 24 * H : t).toISOString().slice(0, 10);
  };
  const atWork = new Set(data.Attendance.filter((a) => a.status !== 'ABSENT').map((a) => `${a.workerId}|${a.date}|${a.shift}`));
  const problems = [];
  for (const j of data.ProductionJob) {
    const day = rosterDay(j.startedAt);
    if (!atWork.has(`${j.workerId}|${day}|${j.shift}`)) problems.push(`${j.id}: worker not on the ${day} ${j.shift} register`);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0 || holidays.has(day)) problems.push(`${j.id}: runs on closed day ${day}`);
    const end = j.completedAt ? Date.parse(j.completedAt) : null;
    if (end && end - Date.parse(j.startedAt) > 8 * H) problems.push(`${j.id}: longer than one shift`);
  }
  if (problems.length) throw new Error(`${label}: ${problems.length} floor problem(s)\n${problems.slice(0, 10).join('\n')}`);
}

// No month from January 2023 to the as-of month may lose money on the owner's P&L
// (invoiced − yarn bills − wages earned, the same sum /reports/pnl makes).
function verifyMonths(data, label, asOf) {
  const wage = new Map(data.Worker.map((w) => [w.id, w.dailyWage]));
  const sum = (rows, f) => rows.reduce((t, x) => t + f(x), 0);
  const problems = [];
  for (let d = new Date('2023-01-01T00:00:00Z'); d.toISOString().slice(0, 7) <= asOf.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    const m = d.toISOString().slice(0, 7);
    const invoiced = sum(data.Invoice.filter((i) => i.issuedAt.startsWith(m)), (i) => i.amount);
    const bills = sum(data.MaterialInward.filter((i) => i.receivedAt.startsWith(m)), (i) => i.billAmount);
    const wages = sum(data.Attendance.filter((a) => a.date.startsWith(m)), (a) => (a.status === 'PRESENT' ? 1 : a.status === 'HALF_DAY' ? 0.5 : 0) * wage.get(a.workerId));
    if (invoiced <= 0 || invoiced - bills - wages <= 0) problems.push(`${m}: invoiced ${Math.round(invoiced)}, bills ${Math.round(bills)}, wages ${Math.round(wages)}`);
  }
  if (problems.length) throw new Error(`${label}: ${problems.length} loss month(s)\n${problems.join('\n')}`);
}

module.exports = { verifyFloor, verifyMonths };
