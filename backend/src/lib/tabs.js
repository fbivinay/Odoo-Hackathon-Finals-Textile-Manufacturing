// Tabs the owner can hand to one employee on top of their role, and the role whose
// write access each one carries (null: the tab only reads). Owner-only tabs are not here.
const EXTRA_TABS = {
  '/materials': 'STORE',
  '/raw-materials': 'STORE',
  '/orders': 'STORE',
  '/production': 'PRODUCTION',
  '/qc': 'QC',
  '/waste': null,
  '/dispatch': 'DISPATCH',
  '/clients': null, // owner's screen by default, but it can be shared
};

// Which roles open which sidebar tab, mirroring NAV in web/src/components/AppShell.tsx.
const TAB_ROLES = {
  '/materials': ['STORE'],
  '/raw-materials': ['STORE', 'PRODUCTION'],
  '/orders': ['STORE', 'PRODUCTION', 'DISPATCH'],
  '/production': ['PRODUCTION'],
  '/qc': ['QC'],
  '/waste': ['PRODUCTION', 'QC'],
  '/dispatch': ['DISPATCH'],
  '/clients': [], // no role has it; owner or a grant only
};
const TAB_LABEL = {
  '/materials': 'Yarn Received',
  '/raw-materials': 'Raw Materials',
  '/orders': 'Orders',
  '/production': 'Production',
  '/qc': 'Quality check',
  '/waste': 'Waste',
  '/dispatch': 'Dispatch',
  '/clients': 'Clients',
};

// Role names as people read them, mirroring ROLE_LABEL in web/src/components/AppShell.tsx.
const ROLE_LABEL = { OWNER: 'Owner', STORE: 'Store Manager', PRODUCTION: 'Production Supervisor', QC: 'Quality Inspector', DISPATCH: 'Dispatch Manager' };

// Every tab a user can open: by role, plus the ones granted to them. The owner opens all.
const tabsOf = (user) =>
  Object.keys(TAB_ROLES).filter((t) => user.role === 'OWNER' || TAB_ROLES[t].includes(user.role) || user.extraTabs.includes(t));

// Every role a user acts with: their own, plus what their extra tabs need.
const rolesOf = (user) => [...new Set([user.role, ...user.extraTabs.map((t) => EXTRA_TABS[t]).filter(Boolean)])];

module.exports = { EXTRA_TABS, TAB_ROLES, TAB_LABEL, ROLE_LABEL, tabsOf, rolesOf };
