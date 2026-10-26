const Domain = require("../models/domain-model");
const { APPROVER_FUNCTIONS } = require("../config/constants");

// GET /api/domains          active domains (everyone - drives the New Request form)
// GET /api/domains?all=1    including inactive (admin / MDM)
exports.list = async (req, res) => {
  const all = req.query.all === "1" && ["admin", "mdm"].includes(req.user.role);
  res.json(await Domain.find(all ? {} : { active: true }).sort({ name: 1 }).lean());
};

exports.get = async (req, res) => {
  const d = await Domain.findOne({ key: req.params.key }).lean();
  if (!d) return res.status(404).json({ message: "Request type not found." });
  res.json(d);
};

function checkConfig(body) {
  const problems = [];
  const keys = new Set();
  for (const f of body.fields || []) {
    if (keys.has(f.key)) problems.push(`Field key "${f.key}" is used twice`);
    keys.add(f.key);
    if (f.type === "select" && !(f.options || []).length) problems.push(`"${f.label}" is a dropdown with no options`);
  }
  if (!(body.fields || []).length) problems.push("Add at least one field");
  if (!(body.fields || []).some((f) => f.dedupe === "name")) problems.push('Mark one field as the record name (duplicate check "name")');
  const fnCodes = APPROVER_FUNCTIONS.map((f) => f.code);
  const stepKeys = new Set();
  for (const s of body.steps || []) {
    if (stepKeys.has(s.key)) problems.push(`Approval step key "${s.key}" is used twice`);
    stepKeys.add(s.key);
    if (!fnCodes.includes(s.function)) problems.push(`Approval step "${s.label}" has an unknown approver group`);
  }
  for (const rule of [...(body.fields || []).map((f) => f.showWhen), ...(body.steps || []).map((s) => s.when)]) {
    if (rule?.field && !keys.has(rule.field)) problems.push(`A rule refers to a field "${rule.field}" that does not exist`);
  }
  return problems;
}

// POST /api/domains - add a brand-new data domain (no IT needed)
exports.create = async (req, res) => {
  const problems = checkConfig(req.body);
  if (problems.length) return res.status(422).json({ message: problems[0], problems });
  const d = await Domain.create({ ...req.body, version: 1, updatedBy: req.user._id });
  res.status(201).json(d);
};

// PUT /api/domains/:key - change fields / approval chain. Version goes up; requests in flight keep their own chain.
exports.update = async (req, res) => {
  const d = await Domain.findOne({ key: req.params.key });
  if (!d) return res.status(404).json({ message: "Request type not found." });
  const body = { ...req.body };
  delete body._id;
  delete body.key;
  delete body.version;
  const problems = checkConfig({ fields: d.fields, steps: d.steps, ...body });
  if (problems.length) return res.status(422).json({ message: problems[0], problems });
  Object.assign(d, body, { version: d.version + 1, updatedBy: req.user._id });
  await d.save();
  res.json(d);
};
