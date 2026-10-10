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

module.exports = { verifyFloor };
