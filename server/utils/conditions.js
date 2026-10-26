// Evaluates the small rule objects used by the domain configuration:
//   { field: "isMedicalDevice", op: "eq", value: true }
// Used for "show this field when..." and "this approval step applies when...".
function isTrue(cond, data) {
  if (!cond || !cond.field) return true; // no rule = always applies
  const v = data ? data[cond.field] : undefined;
  switch (cond.op || "eq") {
    case "truthy":
      return Boolean(v) && v !== "false";
    case "eq":
      return String(v) === String(cond.value);
    case "neq":
      return String(v) !== String(cond.value);
    case "in":
      return (Array.isArray(cond.value) ? cond.value : String(cond.value).split(",")).map(String).includes(String(v));
    case "gt":
      return Number(v) > Number(cond.value);
    case "gte":
      return Number(v) >= Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
    default:
      return true;
  }
}

module.exports = { isTrue };
