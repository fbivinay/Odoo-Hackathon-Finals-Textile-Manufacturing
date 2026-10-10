// One month's pay for a floor worker, from the attendance register. Shared by the data generator
// and the wages screen so a payslip always matches the register.
//
// PROJECT RULES (synthetic, documented): basic = days worked x daily wage (half day = half);
// night-shift allowance of Rs 40 per night worked; overtime and deductions are recorded fields but
// the dataset has none (no statutory PF/ESI modelled). Net = gross - deductions.
const NIGHT_ALLOWANCE = 40;

function payslip({ present, halfDays, nightDays = 0, dailyWage, overtime = 0, deductions = 0 }) {
  const paise = (x) => Math.round(x * 100);
  const daysWorked = present + halfDays * 0.5;
  const basic = paise(daysWorked * Number(dailyWage));
  const allowances = paise(nightDays * NIGHT_ALLOWANCE);
  const gross = basic + allowances + paise(overtime);
  const net = gross - paise(deductions);
  return {
    daysWorked,
    basic: basic / 100,
    allowances: allowances / 100,
    overtime: Number(overtime),
    deductions: Number(deductions),
    gross: gross / 100,
    net: net / 100,
  };
}

module.exports = { NIGHT_ALLOWANCE, payslip };
