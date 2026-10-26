// Formatting helpers and the same field/step rule check the server uses

export function isTrue(cond, data) {
  if (!cond || !cond.field) return true;
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

export function describeRule(cond, fields = []) {
  if (!cond?.field) return "";
  const label = fields.find((f) => f.key === cond.field)?.label || cond.field;
  const ops = { eq: "is", neq: "is not", gt: ">", gte: "≥", lt: "<", in: "is one of", truthy: "is filled in" };
  const value = cond.value === true || cond.value === "true" ? "ticked" : cond.value === false ? "not ticked" : cond.value;
  return cond.op === "truthy" ? `${label} is filled in` : `${label} ${ops[cond.op || "eq"]} ${value}`;
}

export const STATUS = {
  draft: { label: "Draft", tone: "muted" },
  pending: { label: "In approval", tone: "info" },
  changes_requested: { label: "Changes requested", tone: "warn" },
  approved: { label: "Approved – awaiting SAP", tone: "accent" },
  rejected: { label: "Rejected", tone: "bad" },
  completed: { label: "Live in SAP B1", tone: "good" },
  waiting: { label: "Not started", tone: "muted" },
};

export function fmtDate(d, withTime = false) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
  });
}

export function timeAgo(d) {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// "due in 5 h" / "overdue by 1 d 3 h"
export function dueText(d) {
  if (!d) return "";
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms) / 3600000;
  const txt = abs >= 24 ? `${Math.floor(abs / 24)} d ${Math.round(abs % 24)} h` : `${Math.max(1, Math.round(abs))} h`;
  return ms < 0 ? `overdue by ${txt}` : `due in ${txt}`;
}

export const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US"));
export const usdK = (v) => (v === null || v === undefined ? "—" : `US$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: v >= 1e6 ? 0 : 1 })}k`);
export const usdM = (v) => `US$${(v / 1e6).toFixed(2)}M`;
export const pct = (v, signed = true) => (v === null || v === undefined ? "—" : `${signed && v > 0 ? "+" : ""}${v}%`);

export function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + (mo === 1 ? ` ’${String(y).slice(2)}` : "");
}
