const Request = require("../models/request-model");
const Domain = require("../models/domain-model");
const User = require("../models/user-model");
const MasterRecord = require("../models/master-record-model");
const workflow = require("../services/workflow");
const duplicates = require("../services/duplicates");
const sap = require("../services/sap");
const audit = require("../utils/audit");
const counters = require("../utils/counters");
const fieldCrypto = require("../utils/field-crypto");

const DAY = 24 * 60 * 60 * 1000;

async function loadDomain(key) {
  const d = await Domain.findOne({ key }).lean();
  if (!d) {
    const err = new Error(`Unknown request type "${key}"`);
    err.status = 400;
    throw err;
  }
  return d;
}

// Fire-and-forget for notifications so the user's click returns quickly
function background(fn) {
  Promise.resolve()
    .then(fn)
    .catch((e) => console.error("background task failed:", e.message));
}

function notFound(res) {
  return res.status(404).json({ message: "Request not found." });
}

// Short version of a request for lists and dashboards
async function summarise(r, user, domains) {
  const pending = r.approvals.filter((a) => a.status === "pending");
  const overdue = pending.some((a) => a.dueAt && a.dueAt < new Date());
  return {
    _id: r._id,
    refNo: r.refNo,
    title: r.title,
    domainKey: r.domainKey,
    domainName: domains[r.domainKey]?.name || r.domainKey,
    entity: r.entity,
    country: r.country,
    status: r.status,
    requester: r.requester?.name ? { _id: r.requester._id, name: r.requester.name } : r.requester,
    waitingOn: r.status === "pending" ? pending.map((a) => a.label) : r.status === "approved" ? ["MDM team (create in SAP B1)"] : [],
    progress: { done: r.approvals.filter((a) => a.status === "approved").length, total: r.approvals.length },
    overdue,
    myAction: pending.some((a) => workflow.userCanAct(user, a)),
    duplicateFlag: (r.duplicates || []).some((d) => d.level === "likely"),
    submittedAt: r.submittedAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt,
    sapCode: r.sapCode,
    ageDays: r.submittedAt ? Math.floor(((r.completedAt || new Date()) - r.submittedAt) / DAY) : null,
  };
}

async function domainMap() {
  const all = await Domain.find().lean();
  return Object.fromEntries(all.map((d) => [d.key, d]));
}

// GET /api/requests?scope=mine|awaiting|mdm|all&status=&domain=&q=
exports.list = async (req, res) => {
  const { scope = "mine", status, domain, q } = req.query;
  const user = req.user;
  const filter = {};
  if (status) filter.status = { $in: String(status).split(",") };
  if (domain) filter.domainKey = domain;
  if (q) filter.$or = [{ title: new RegExp(escapeRe(q), "i") }, { refNo: new RegExp(escapeRe(q), "i") }];

  if (scope === "mine") filter.requester = user._id;
  if (scope === "awaiting") filter.status = "pending";
  if (scope === "mdm") filter.status = filter.status || { $in: ["approved", "pending", "changes_requested"] };
  if ((scope === "all" || scope === "mdm") && !["mdm", "admin"].includes(user.role) && user.role !== "approver") {
    filter.requester = user._id;
  }

  let rows = await Request.find(filter).populate("requester", "name").sort({ updatedAt: -1 }).limit(300).lean();
  if (scope === "awaiting") rows = rows.filter((r) => r.approvals.some((a) => workflow.userCanAct(user, a)));
  const domains = await domainMap();
  res.json(await Promise.all(rows.map((r) => summarise(r, user, domains))));
};

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/requests/:id?reveal=1
exports.get = async (req, res) => {
  const r = await Request.findById(req.params.id)
    .populate("requester", "name email title")
    .populate("approvals.actedBy", "name title")
    .populate("comments.by", "name title")
    .lean();
  if (!r) return notFound(res);
  const domain = await loadDomain(r.domainKey);
  const user = req.user;
  const isRequester = String(r.requester._id) === String(user._id);
  const mayReveal = workflow.canSeeSensitive(user, r);
  const reveal = req.query.reveal === "1" && mayReveal;
  if (reveal) background(() => audit.log(r, "sensitive_viewed", user, { fields: domain.fields.filter((f) => f.sensitive).map((f) => f.label) }));

  // who is it waiting on, by name, so nobody has to ask
  const approvals = await Promise.all(
    r.approvals.map(async (a) => {
      const people = a.status === "pending" ? await workflow.assignees(a) : [];
      return {
        ...a,
        assignees: people.map((p) => ({ name: p.name, title: p.title })),
        canAct: workflow.userCanAct(user, a),
        overdue: a.status === "pending" && a.dueAt && new Date(a.dueAt) < new Date(),
      };
    }),
  );
  const values = workflow.values(domain, r, reveal);
  res.json({
    ...r,
    secure: undefined,
    values,
    approvals,
    domain,
    permissions: {
      canEdit: isRequester && ["draft", "changes_requested"].includes(r.status),
      canComplete: ["mdm", "admin"].includes(user.role) && r.status === "approved",
      canSeeSensitive: mayReveal,
      revealed: reveal,
    },
    sapPayload: sap.buildPayload(domain, r, values, r.sapCode),
  });
};

// Turns the request body into data + approvals; shared by create and update
async function applyBody(r, body, user, domain) {
  const data = { ...(body.data || {}) };
  // a masked value sent back ("•••• 1234") means "unchanged"
  for (const [k, v] of Object.entries(data)) if (typeof v === "string" && v.startsWith("••••")) delete data[k];
  body.data = data;
  r.entity = body.entity || r.entity;
  r.country = body.country || data.country || r.country;
  const titleField = domain.fields.find((f) => f.dedupe === "name") || domain.fields[0];
  r.title = String(data[titleField.key] || r.title || "Untitled").trim();
  const { plain, secure } = workflow.splitData(domain, data);
  // keep encrypted values the requester did not re-enter (they only ever see them masked)
  const kept = {};
  for (const f of domain.fields.filter((x) => x.sensitive)) {
    if (secure[f.key]) kept[f.key] = secure[f.key];
    else if (r.secure?.[f.key] && workflow.visibleFields(domain, data).some((x) => x.key === f.key)) kept[f.key] = r.secure[f.key];
  }
  r.data = plain;
  r.secure = kept;
  r.domainVersion = domain.version;
  r.markModified("data");
  r.markModified("secure");
}

// Full values for validation: masked sensitive values that were kept count as filled in
function valuesForValidation(domain, r, body) {
  const v = { ...(body.data || {}) };
  for (const f of domain.fields.filter((x) => x.sensitive)) {
    if ((v[f.key] === undefined || v[f.key] === "") && r.secure?.[f.key]) {
      try {
        v[f.key] = fieldCrypto.decrypt(r.secure[f.key]);
      } catch {
        v[f.key] = "(encrypted)"; // stored but unreadable here: still counts as filled in
      }
    }
  }
  return v;
}

// Reference numbers are only taken once a request is really saved, so there are no gaps in the sequence
async function assignRef(r) {
  if (r.refNo) return;
  const year = new Date().getFullYear();
  r.refNo = `MDM-${year}-${String(await counters.next(`ref:${year}`)).padStart(4, "0")}`;
}

async function submit(r, domain, user, body, res, { resubmit }) {
  const errors = workflow.validate(domain, valuesForValidation(domain, r, body), { entity: r.entity });
  if (Object.keys(errors).length) {
    res.status(422).json({ message: "Some required information is missing.", errors });
    return false;
  }
  const dupes = await duplicates.check(domain, body.data || {}, { excludeRequestId: r._id });
  r.duplicates = dupes;
  const likely = dupes.filter((d) => d.level === "likely");
  if (likely.length && !body.duplicateOverrideReason) {
    await counters.bump("metric:duplicates_blocked");
    res.status(409).json({
      message: "This looks like a record that already exists. Use the existing one, or explain why a new one is needed.",
      duplicates: dupes,
    });
    return false;
  }
  if (likely.length) r.duplicateOverride = { reason: body.duplicateOverrideReason, by: user._id, at: new Date() };

  const previous = r.approvals || [];
  const approvals = workflow.buildApprovals(domain, body.data || {}, r.entity);
  // on a resubmit, approvals already given stay given (except the step that asked for changes)
  for (const a of approvals) {
    const old = previous.find((p) => p.key === a.key && p.status === "approved");
    if (old && resubmit) Object.assign(a, { status: "approved", actedAt: old.actedAt, actedBy: old.actedBy, comment: old.comment });
  }
  r.approvals = approvals;
  r.status = "pending";
  r.submittedAt = r.submittedAt || new Date();
  await assignRef(r);
  const opened = workflow.advance(r, domain);
  if (workflow.allApproved(r)) {
    r.status = "approved";
    r.approvedAt = new Date();
  }
  await r.save();
  await audit.log(r, resubmit ? "resubmitted" : "submitted", user, {
    approvals: approvals.map((a) => `${a.stage}. ${a.label}`),
    duplicateOverride: r.duplicateOverride?.reason,
  });
  background(() => workflow.notifyAssignees(r, opened));
  return true;
}

// POST /api/requests  { domainKey, entity, country, data, submit, duplicateOverrideReason }
exports.create = async (req, res) => {
  const domain = await loadDomain(req.body.domainKey);
  const r = new Request({
    domainKey: domain.key,
    requester: req.user._id,
    status: "draft",
    source: req.body.source || "portal",
  });
  await applyBody(r, req.body, req.user, domain);
  if (req.body.submit) {
    if (!(await submit(r, domain, req.user, req.body, res, { resubmit: false }))) return;
  } else {
    await assignRef(r);
    await r.save();
    await audit.log(r, "draft_saved", req.user);
  }
  res.status(201).json({ _id: r._id, refNo: r.refNo, status: r.status });
};

// PUT /api/requests/:id - requester edits a draft or answers "changes requested"
exports.update = async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return notFound(res);
  if (String(r.requester) !== String(req.user._id)) return res.status(403).json({ message: "Only the requester can edit this." });
  if (!["draft", "changes_requested"].includes(r.status)) return res.status(409).json({ message: "This request can no longer be edited." });
  const domain = await loadDomain(r.domainKey);
  const resubmit = r.status === "changes_requested";
  await applyBody(r, req.body, req.user, domain);
  if (req.body.submit) {
    if (!(await submit(r, domain, req.user, req.body, res, { resubmit }))) return;
  } else {
    await r.save();
    await audit.log(r, "draft_saved", req.user);
  }
  res.json({ _id: r._id, refNo: r.refNo, status: r.status });
};

// POST /api/requests/:id/approvals/:key  { decision: approve|reject|changes, comment }
exports.decide = async (req, res) => {
  const { decision, comment } = req.body || {};
  if (!["approve", "reject", "changes"].includes(decision)) return res.status(400).json({ message: "Unknown decision." });
  if (decision !== "approve" && !String(comment || "").trim()) {
    return res.status(400).json({ message: "Please say why, so the requester knows what to fix." });
  }
  const r = await Request.findById(req.params.id);
  if (!r) return notFound(res);
  const a = r.approvals.find((x) => x.key === req.params.key);
  if (!a) return res.status(404).json({ message: "Approval step not found." });
  if (r.status !== "pending" || !workflow.userCanAct(req.user, a)) {
    return res.status(403).json({ message: "This step is not waiting on you." });
  }
  const domain = await loadDomain(r.domainKey);

  a.actedAt = new Date();
  a.actedBy = req.user._id;
  a.comment = comment;
  const link = `/requests/${r._id}`;
  let opened = [];

  if (decision === "approve") {
    a.status = "approved";
    opened = workflow.advance(r, domain);
    if (workflow.allApproved(r)) {
      r.status = "approved";
      r.approvedAt = new Date();
    }
  } else {
    a.status = decision === "reject" ? "rejected" : "changes_requested";
    r.status = decision === "reject" ? "rejected" : "changes_requested";
    if (decision === "changes") r.returnedCount = (r.returnedCount || 0) + 1;
    // pause the other open steps of this stage
    for (const other of r.approvals) if (other !== a && other.status === "pending") other.status = "waiting";
  }
  r.markModified("approvals");
  await r.save();
  await audit.log(r, `step_${a.status}`, req.user, { step: a.label, comment: comment || undefined });

  if (r.status === "approved") await audit.log(r, "fully_approved", null);
  // tell people in the background; the approver doesn't wait for it
  background(async () => {
    if (opened.length) await workflow.notifyAssignees(r, opened);
    if (r.status === "approved") {
      const mdm = await User.find({ role: "mdm" }).lean();
      await workflow.notify(mdm.map((u) => u._id), { kind: "action", message: `${r.refNo} "${r.title}" is fully approved - ready to create in SAP B1`, link });
      await workflow.notify([r.requester], { kind: "update", message: `${r.refNo} is fully approved; MDM is creating it in SAP B1`, link });
    } else if (decision === "approve") {
      await workflow.notify([r.requester], { kind: "update", message: `${a.label} approved ${r.refNo}`, link });
    } else {
      await workflow.notify([r.requester], {
        kind: "action",
        message: `${a.label} ${decision === "reject" ? "rejected" : "asked for changes on"} ${r.refNo}: "${comment}"`,
        link,
      });
    }
  });
  res.json({ status: r.status });
};

// POST /api/requests/:id/comments { text }
exports.comment = async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ message: "Write a comment first." });
  const r = await Request.findById(req.params.id);
  if (!r) return notFound(res);
  r.comments.push({ by: req.user._id, text });
  await r.save();
  await audit.log(r, "commented", req.user, { text });
  // tell everyone involved except the author
  const involved = [r.requester, ...r.approvals.map((a) => a.actedBy).filter(Boolean)].filter((id) => String(id) !== String(req.user._id));
  await workflow.notify(involved, { kind: "update", message: `${req.user.name} commented on ${r.refNo}`, link: `/requests/${r._id}` });
  res.status(201).json({ ok: true });
};

// POST /api/requests/:id/complete  { sapCode? } - MDM creates the record in SAP B1
exports.complete = async (req, res) => {
  const r = await Request.findById(req.params.id);
  if (!r) return notFound(res);
  if (r.status !== "approved") return res.status(409).json({ message: "Only fully approved requests can be created in SAP B1." });
  const domain = await loadDomain(r.domainKey);
  const code = String(req.body?.sapCode || "").trim() || `${domain.codePrefix}${String(await counters.next(`sap:${domain.key}`)).padStart(5, "0")}`;
  if (await MasterRecord.exists({ code })) return res.status(409).json({ message: `SAP code ${code} is already used.` });

  // The master copy keeps only non-sensitive data; bank details stay encrypted on the request
  await MasterRecord.create({
    domainKey: r.domainKey,
    code,
    name: r.title,
    entity: r.entity,
    country: r.country,
    segment: r.data.customerType,
    data: r.data,
    createdFromRequest: r.refNo,
  });
  r.sapCode = code;
  r.status = "completed";
  r.completedAt = new Date();
  await r.save();
  const payload = sap.buildPayload(domain, r, workflow.values(domain, r, false), code);
  await audit.log(r, "created_in_sap", req.user, { sapCode: code, endpoint: payload.endpoint });
  await workflow.notify([r.requester], {
    kind: "completed",
    message: `${r.refNo} is live in SAP B1 as ${code} - you can transact now`,
    link: `/requests/${r._id}`,
  });
  res.json({ status: r.status, sapCode: code });
};

// GET /api/requests/:id/audit
exports.audit = async (req, res) => {
  const r = await Request.findById(req.params.id).lean();
  if (!r) return notFound(res);
  const [entries, check] = await Promise.all([audit.list(r._id), audit.verify(r._id)]);
  res.json({ entries, verification: check });
};

// POST /api/requests/reminders/run
exports.runReminders = async (req, res) => res.json(await workflow.runReminders());

// GET /api/requests/stats - the numbers on the dashboard
exports.stats = async (req, res) => {
  const all = await Request.find({ status: { $ne: "draft" } }).lean();
  const byStatus = {};
  for (const r of all) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const done = all.filter((r) => r.completedAt && r.submittedAt);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const cycleDays = avg(done.map((r) => (r.completedAt - r.submittedAt) / DAY));
  const approvalHours = avg(
    all.flatMap((r) => r.approvals.filter((a) => a.actedAt && a.startedAt).map((a) => (new Date(a.actedAt) - new Date(a.startedAt)) / 3600000)),
  );
  const firstTimeRight = done.length ? done.filter((r) => !r.returnedCount).length / done.length : null;
  const overdue = all.filter((r) => r.status === "pending" && r.approvals.some((a) => a.status === "pending" && a.dueAt && a.dueAt < new Date())).length;

  res.json({
    byStatus,
    total: all.length,
    open: (byStatus.pending || 0) + (byStatus.changes_requested || 0) + (byStatus.approved || 0),
    overdue,
    avgCycleDays: cycleDays === null ? null : Number(cycleDays.toFixed(1)),
    avgApprovalHours: approvalHours === null ? null : Number(approvalHours.toFixed(1)),
    firstTimeRight: firstTimeRight === null ? null : Number((firstTimeRight * 100).toFixed(0)),
    duplicatesBlocked: await counters.get("metric:duplicates_blocked"),
    baselineCycleDays: 18, // Appendix C: Amy's request took 18 days by email
  });
};
