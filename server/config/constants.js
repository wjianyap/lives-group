// Reference data shared by the API, the seed script and the analytics.
// ASSUMPTION: the brief says "five country locations" without naming them; these five are our stated assumption.

const COUNTRIES = [
  { code: "SG", name: "Singapore", currency: "SGD" },
  { code: "MY", name: "Malaysia", currency: "MYR" },
  { code: "ID", name: "Indonesia", currency: "IDR" },
  { code: "TH", name: "Thailand", currency: "THB" },
  { code: "VN", name: "Vietnam", currency: "VND" },
];

const ENTITIES = [
  { code: "SPD", name: "SPD – Specialty Diagnostics" },
  { code: "QTS", name: "QTS – Laboratory Solutions" },
  { code: "QTG", name: "QTG – Medical Equipment" },
];

const PRODUCTS = [
  { code: "A", name: "Product A", description: "IVD reagents & test kits" },
  { code: "B", name: "Product B", description: "Lab consumables" },
  { code: "C", name: "Product C", description: "Medical & lab equipment" },
];

// What a person may do in the portal
const ROLES = ["requestor", "approver", "mdm", "admin"];

// Which part of a request an approver is responsible for
const APPROVER_FUNCTIONS = [
  { code: "BU_HEAD", name: "Business Unit Head" },
  { code: "FINANCE", name: "Finance" },
  { code: "QRA", name: "Quality / Regulatory Affairs" },
  { code: "BUSINESS_SUPPORT", name: "Business Support" },
];

// Only these people can see sensitive fields (bank details, credit terms) unmasked
const SENSITIVE_VIEWERS = { roles: ["mdm", "admin"], functions: ["FINANCE"] };

const REQUEST_STATUSES = ["draft", "pending", "changes_requested", "approved", "rejected", "completed"];

module.exports = {
  COUNTRIES,
  ENTITIES,
  PRODUCTS,
  ROLES,
  APPROVER_FUNCTIONS,
  SENSITIVE_VIEWERS,
  REQUEST_STATUSES,
};
