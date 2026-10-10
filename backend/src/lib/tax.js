// GST rules for the synthetic Everest dataset and the live app. Used by the data generator and the
// server, so a purchase, sale or expense is taxed the same way however it was entered.
//
// PROJECT ASSUMPTIONS (documented, not legal advice):
// - The mill is in Gujarat. A party in Gujarat is intra-state (CGST + SGST, half each); any other
//   state is inter-state (IGST). No GSTINs are stored or invented.
// - Raw yarn is taken as NIL-rated for this project (the rule given for the dataset). In real life
//   cotton and man-made yarn attract GST (5% after 22 Sep 2025), so this rule is configurable here.
// - Rates follow the GST rate change of 22 Sep 2025 (56th GST Council). A rate is chosen by the
//   transaction date, so old bills keep the rate they were raised at.
// - `confidence`: HIGH = consistent across sources; REPORTED = from secondary sources, check the
//   CBIC notification before filing; UNVERIFIED = sources conflict or none found, flagged on screen.
//   Sources: PIB 56th GST Council release, CBIC rate notifications 9/2025-CT(R) as summarised by
//   cleartax.in, taxguru.in, busy.in and tallysolutions.com (checked Oct 2026).

const HOME_STATE = 'Gujarat';
const CHANGE = '2025-09-22'; // GST 2.0 rates in force from this date

// code → description, HSN/SAC, rates [[from, ratePct]], ITC eligible, confidence, note
const RULES = {
  YARN_RAW: { label: 'Raw yarn', hsn: '5205/5509/5402', rates: [['2017-07-01', 0]], itc: false, confidence: 'PROJECT_RULE', note: 'Project rule: no GST on raw yarn. Real-world yarn is taxable; change here if needed.' },
  FABRIC: { label: 'Woven fabric (sales)', hsn: '5208/5407/5516', rates: [['2017-07-01', 5]], itc: true, confidence: 'HIGH', note: 'Cotton and man-made woven fabric at 5% before and after Sep 2025.' },
  STARCH: { label: 'Starch (sizing)', hsn: '1108', rates: [['2017-07-01', 12], [CHANGE, 5]], itc: true, confidence: 'REPORTED', note: 'Listed 12% to 5% in the 56th Council changes.' },
  PVA: { label: 'Polyvinyl alcohol (sizing)', hsn: '3905', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'No source found for 3905; 18% assumed as for most plastics in primary form.' },
  LUBRICANT: { label: 'Lubricating oil and grease', hsn: '2710/3403', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Lube oil and greases at 18% (oil company GST chart).' },
  DETERGENT: { label: 'Wetting agents, detergents, cleaners', hsn: '3402', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Detergents stayed at 18%; soaps (3401) moved to 5%.' },
  DYE: { label: 'Synthetic dyes', hsn: '3204', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Synthetic organic colouring matter at 18%, unchanged in Sep 2025.' },
  ENZYME: { label: 'Desizing enzymes', hsn: '3507', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'Rate not confirmed; 18% assumed.' },
  PEROXIDE: { label: 'Hydrogen peroxide', hsn: '2847', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'Sources show 12% and 18%; 18% assumed, check before filing.' },
  ALKALI: { label: 'Caustic soda, soda ash', hsn: '2815/2836', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Inorganic chemicals at 18%.' },
  SALT: { label: 'Industrial salt', hsn: '2501', rates: [['2017-07-01', 5]], itc: true, confidence: 'UNVERIFIED', note: 'Industrial salt assumed at 5%; common salt is exempt.' },
  SULPHATE: { label: 'Sodium sulphate', hsn: '2833', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: '18% assumed.' },
  ACID: { label: 'Acetic acid', hsn: '2915', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Organic chemicals at 18%.' },
  TEXTILE_AUX: { label: 'Softeners, fixing and finishing agents', hsn: '3809', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Textile finishing agents at 18%.' },
  REAGENT: { label: 'Testing reagents', hsn: '3822', rates: [['2017-07-01', 12], [CHANGE, 5]], itc: true, confidence: 'UNVERIFIED', note: '12% items generally moved to 5% in Sep 2025; not confirmed for 3822.' },
  LABEL: { label: 'Paper labels and tags', hsn: '4821', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'Most sources 18%, one says 12%.' },
  TUBE: { label: 'Paper tubes and cores', hsn: '4822', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'One source lists 18%.' },
  CARTON: { label: 'Corrugated cartons', hsn: '4819', rates: [['2017-07-01', 12], [CHANGE, 5]], itc: true, confidence: 'REPORTED', note: 'Corrugated boxes 12% to 5% from 22 Sep 2025.' },
  PLASTIC: { label: 'Plastic wrap, covers, straps', hsn: '3920/3923', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'Plastic packaging unchanged at 18%.' },
  BELT: { label: 'Transmission belts', hsn: '4010', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: '18% assumed.' },
  BEARING: { label: 'Ball bearings', hsn: '8482', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: '18%.' },
  MACHINE_SPARE: { label: 'Textile machinery parts', hsn: '8448', rates: [['2017-07-01', 12], [CHANGE, 5]], itc: true, confidence: 'UNVERIFIED', note: 'Assumed to follow 12% to 5%; not confirmed.' },
  // Expenses
  ELECTRICITY: { label: 'Electricity', hsn: '2716', rates: [['2017-07-01', 0]], itc: false, confidence: 'HIGH', note: 'Electrical energy is exempt from GST.', treatment: 'EXEMPT' },
  WATER: { label: 'Water and sewerage charges', hsn: '2201/9994', rates: [['2017-07-01', 0]], itc: false, confidence: 'REPORTED', note: 'Non-packaged water and municipal sewerage charges exempt.', treatment: 'EXEMPT' },
  FUEL: { label: 'Diesel and petrol', hsn: '2710', rates: [['2017-07-01', 0]], itc: false, confidence: 'HIGH', note: 'Motor spirit and diesel are outside GST (state VAT is in the price).', treatment: 'NON_GST' },
  COAL: { label: 'Boiler coal', hsn: '2701', rates: [['2017-07-01', 5], [CHANGE, 18]], itc: true, confidence: 'REPORTED', note: 'Coal 5% (+cess) to 18% from 22 Sep 2025; compensation cess not modelled.' },
  GTA: { label: 'Goods transport agency', hsn: '9965', rates: [['2017-07-01', 5]], itc: true, confidence: 'REPORTED', note: '5% under reverse charge: the mill pays the tax and claims it back.', treatment: 'RCM' },
  VEHICLE_HIRE: { label: 'Truck hire', hsn: '9966', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: '18% assumed for hiring a goods vehicle.' },
  REPAIRS: { label: 'Vehicle and machine repairs', hsn: '9987', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: '18%. ITC allowed for goods vehicles.' },
  INSURANCE: { label: 'Vehicle insurance', hsn: '9971', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: 'General insurance 18%; ITC allowed for goods vehicles.' },
  COURIER: { label: 'Courier', hsn: '9968', rates: [['2017-07-01', 18]], itc: true, confidence: 'REPORTED', note: '18%.' },
  ETP: { label: 'Effluent treatment contractor', hsn: '9994', rates: [['2017-07-01', 18]], itc: true, confidence: 'UNVERIFIED', note: 'Rate for effluent treatment services not confirmed; 18% assumed.' },
  TOLL: { label: 'Tolls and parking', hsn: '9967', rates: [['2017-07-01', 0]], itc: false, confidence: 'HIGH', note: 'Toll charges are exempt.', treatment: 'EXEMPT' },
  GOVT_FEE: { label: 'Permits and government fees', hsn: '-', rates: [['2017-07-01', 0]], itc: false, confidence: 'REPORTED', note: 'Government fees are not a taxable supply here.', treatment: 'NON_GST' },
  UNREGISTERED: { label: 'Casual labour / unregistered payee', hsn: '-', rates: [['2017-07-01', 0]], itc: false, confidence: 'HIGH', note: 'Payee not registered under GST; no tax charged.', treatment: 'NON_GST' },
  SALARY: { label: 'Salaries and allowances', hsn: '-', rates: [['2017-07-01', 0]], itc: false, confidence: 'HIGH', note: 'Employee pay is not a supply under GST.', treatment: 'NON_GST' },
};

const day = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

function rateOn(code, date) {
  const rule = RULES[code];
  if (!rule) throw new Error(`Unknown tax code ${code}`);
  const d = day(date);
  let rate = rule.rates[0][1];
  for (const [from, r] of rule.rates) if (d >= from) rate = r;
  return rate;
}

// Tax on a taxable value, in whole paise so totals add up exactly. Returns rupees with 2 decimals.
function taxFor(code, taxable, date, partyState) {
  const rule = RULES[code];
  const ratePct = rateOn(code, date);
  const paise = Math.round(Number(taxable) * 100);
  const intra = (partyState || HOME_STATE) === HOME_STATE;
  let treatment = rule.treatment || (ratePct === 0 ? 'NIL' : intra ? 'INTRA' : 'INTER');
  if (rule.treatment === 'RCM') treatment = intra ? 'RCM_INTRA' : 'RCM_INTER';
  const taxPaise = Math.round((paise * ratePct) / 100);
  const half = Math.floor(taxPaise / 2);
  const split = ratePct === 0 || ['EXEMPT', 'NON_GST'].includes(treatment)
    ? { cgst: 0, sgst: 0, igst: 0 }
    : intra ? { cgst: half, sgst: taxPaise - half, igst: 0 } : { cgst: 0, sgst: 0, igst: taxPaise };
  const tax = split.cgst + split.sgst + split.igst;
  // Under reverse charge the supplier's bill carries no tax; the mill pays it to the government.
  const payablePaise = treatment.startsWith('RCM') ? paise : paise + tax;
  return {
    taxCode: code,
    taxRatePct: ratePct,
    taxTreatment: treatment,
    cgst: split.cgst / 100,
    sgst: split.sgst / 100,
    igst: split.igst / 100,
    itcEligible: rule.itc && tax > 0,
    totalAmount: payablePaise / 100,
  };
}

module.exports = { HOME_STATE, RULES, rateOn, taxFor, CHANGE };
