// Tabs the owner can hand to one employee on top of their role, and the role whose
// write access each one carries (null: the tab only reads). Owner-only tabs are not here.
const EXTRA_TABS = {
  '/materials': 'STORE',
  '/raw-materials': 'STORE',
  '/orders': 'STORE',
  '/production': 'PRODUCTION',
  '/planning': null,
  '/qc': 'QC',
  '/waste': null,
  '/dispatch': 'DISPATCH',
};

// Every role a user acts with: their own, plus what their extra tabs need.
const rolesOf = (user) => [...new Set([user.role, ...user.extraTabs.map((t) => EXTRA_TABS[t]).filter(Boolean)])];

module.exports = { EXTRA_TABS, rolesOf };
