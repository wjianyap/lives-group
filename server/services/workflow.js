// The approval engine. Approval chains come from the domain config, so changing a chain needs no code.
// Steps that share a "stage" run in parallel: Finance and the BU Head review at the same time instead of
// one after the other, which is where most of the 2-3 week wait came from.
const User = require("../models/user-model");
const Notification = require("../models/notification-model");
const { isTrue } = require("../utils/conditions");
const crypto = require("../utils/field-crypto");
const { SENSITIVE_VIEWERS } = require("../config/constants");

const HOUR = 60 * 60 * 1000;

// ---------- form rules ----------

exports.visibleFields = function (domain, data) {
  return domain.fields.filter((f) => isTrue(f.showWhen, data));
};

// Server-side check of the dynamic form. The browser runs the same rules, but we never trust it alone.
exports.validate = function (domain, data, { entity } = {}) {
  const errors = {};
  if (!entity) errors.entity = "Choose the business entity";
  for (const f of exports.visibleFields(domain, data)) {
    const v = data[f.key];
    const empty = v === undefined || v === null || v === "" || (f.type === "checkbox" && f.required && v !== true);
    if (f.required && empty) {
      errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (empty) continue;
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors[f.key] = "Enter a valid email";
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isNaN(n)) errors[f.key] = "Must be a number";
      else if (f.min !== undefined && f.min !== null && n < f.min) errors[f.key] = `Must be at least ${f.min}`;
      else if (f.max !== undefined && f.max !== null && n > f.max) errors[f.key] = `Must be at most ${f.max}`;
    }
    if (f.type === "select" && f.options?.length && !f.options.includes(String(v))) errors[f.key] = "Pick one of the options";
    if (f.pattern && !new RegExp(f.pattern).test(String(v))) errors[f.key] = f.help || "Format is not valid";
  }
  return errors;
};

// Keep only known, visible fields; sensitive ones are encrypted
exports.splitData = function (domain, data) {
  const plain = {};
  const secure = {};
  for (const f of exports.visibleFields(domain, data)) {
    let v = data[f.key];
    if (v === undefined || v === "") continue;
    if (f.type === "number") v = Number(v);
    if (f.type === "checkbox") v = v === true || v === "true";
    if (f.sensitive) secure[f.key] = crypto.encrypt(v);
    else plain[f.key] = v;
  }
  return { plain, secure };
};

exports.canSeeSensitive = function (user, request) {
  if (!user) return false;
  if (SENSITIVE_VIEWERS.roles.includes(user.role)) return true;
  if ((user.functions || []).some((f) => SENSITIVE_VIEWERS.functions.includes(f))) return true;
  return request && String(request.requester?._id || request.requester) === String(user._id);
};

// All values for display; sensitive ones decrypted only if the viewer may see them
exports.values = function (domain, request, reveal) {
  const out = { ...(request.data || {}) };
  for (const f of domain.fields.filter((x) => x.sensitive)) {
    const box = request.secure?.[f.key];
    if (!box) continue;
    out[f.key] = reveal ? crypto.decrypt(box) : crypto.mask(crypto.decrypt(box));
  }
  return out;
};

// ---------- approval chain ----------

exports.buildApprovals = function (domain, data, entity) {
  const steps = domain.steps.filter((s) => isTrue(s.when, data));
  // renumber stages 1..n so a skipped stage does not leave a gap
  const stages = [...new Set(steps.map((s) => s.stage || 1))].sort((a, b) => a - b);
  return steps.map((s) => ({
    key: s.key,
    label: s.label,
    function: s.function,
    stage: stages.indexOf(s.stage || 1) + 1,
    entity: s.entityScoped ? entity : undefined,
    checks: s.checks,
    status: "waiting",
    slaHours: s.slaHours,
  }));
};

exports.slaFor = function (domain, approval) {
  return domain.steps.find((s) => s.key === approval.key)?.slaHours || 48;
};

// Opens the next stage. Returns the approvals that just landed on someone.
exports.advance = function (request, domain) {
  if (request.approvals.some((a) => a.status === "pending")) return [];
  const next = request.approvals.filter((a) => a.status === "waiting");
  if (!next.length) return [];
  const stage = Math.min(...next.map((a) => a.stage));
  const now = new Date();
  const opened = [];
  for (const a of request.approvals) {
    if (a.status === "waiting" && a.stage === stage) {
      a.status = "pending";
      a.startedAt = now;
      a.dueAt = new Date(now.getTime() + exports.slaFor(domain, a) * HOUR);
      opened.push(a);
    }
  }
  return opened;
};

exports.allApproved = (request) => request.approvals.length > 0 && request.approvals.every((a) => a.status === "approved");

// Who can act on an approval
exports.assignees = function (approval) {
  const q = { role: "approver", functions: approval.function };
  if (approval.entity) q.entities = approval.entity;
  return User.find(q).lean();
};

exports.userCanAct = function (user, approval) {
  if (!user || approval.status !== "pending") return false;
  if (user.role === "admin") return true;
  if (user.role !== "approver" || !(user.functions || []).includes(approval.function)) return false;
  return !approval.entity || (user.entities || []).includes(approval.entity);
};

// ---------- notifications ----------

// In-app notification. If TEAMS_WEBHOOK_URL is set, the same message is also posted to a Teams channel, which is
// how approvers who live in Outlook / Teams find out without opening the portal.
exports.notify = async function (userIds, { kind = "update", message, link }) {
  const ids = [...new Set(userIds.filter(Boolean).map((id) => String(id._id || id)))];
  if (!ids.length) return;
  await Notification.insertMany(ids.map((user) => ({ user, kind, message, link })));
  if (process.env.TEAMS_WEBHOOK_URL) {
    const base = process.env.PORTAL_URL || "http://localhost:5173";
    fetch(process.env.TEAMS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${message} — ${base}${link || ""}` }),
    }).catch((e) => console.warn("Teams webhook failed:", e.message));
  }
};

exports.notifyAssignees = async function (request, approvals, kind = "action") {
  for (const a of approvals) {
    const people = await exports.assignees(a);
    await exports.notify(
      people.map((p) => p._id),
      {
        kind,
        message:
          kind === "action"
            ? `${request.refNo} "${request.title}" needs your ${a.label} approval (due ${a.dueAt.toLocaleDateString("en-SG")})`
            : `Reminder: ${request.refNo} "${request.title}" is still waiting on your ${a.label} approval`,
        link: `/requests/${request._id}`,
      },
    );
  }
};

// ---------- SLA reminders ----------

// Runs every few minutes (and on demand from the MDM screen).
// Past half the SLA -> reminder to the approvers. Past the SLA -> escalate to MDM team and admins.
exports.runReminders = async function () {
  const Request = require("../models/request-model");
  const audit = require("../utils/audit");
  const now = Date.now();
  const open = await Request.find({ status: "pending" });
  let reminders = 0;
  let escalations = 0;

  for (const r of open) {
    let changed = false;
    for (const a of r.approvals.filter((x) => x.status === "pending" && x.startedAt && x.dueAt)) {
      const total = a.dueAt - a.startedAt;
      const elapsed = now - a.startedAt;
      if (elapsed >= total && !a.escalated) {
        const mdm = await User.find({ role: { $in: ["mdm", "admin"] } }).lean();
        await exports.notify(
          mdm.map((u) => u._id),
          { kind: "escalation", message: `${r.refNo}: ${a.label} approval is overdue`, link: `/requests/${r._id}` },
        );
        await exports.notifyAssignees(r, [a], "reminder");
        a.escalated = true;
        changed = true;
        escalations++;
        await audit.log(r, "sla_escalated", null, { step: a.label });
      } else if (elapsed >= total / 2 && a.remindersSent === 0) {
        await exports.notifyAssignees(r, [a], "reminder");
        a.remindersSent = 1;
        changed = true;
        reminders++;
        await audit.log(r, "reminder_sent", null, { step: a.label });
      }
    }
    if (changed) {
      r.markModified("approvals");
      await r.save();
    }
  }
  return { checked: open.length, reminders, escalations };
};
