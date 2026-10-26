// Duplicate check against (1) records already in SAP B1 and (2) requests still in flight.
const MasterRecord = require("../models/master-record-model");
const Request = require("../models/request-model");
const { findMatches, nameScore } = require("../utils/similarity");

// Which values of a record are used for matching, according to the domain's field config
function keysFor(domain) {
  const by = (kind) => domain.fields.filter((f) => f.dedupe === kind).map((f) => f.key);
  return { name: by("name"), identifier: by("identifier"), email: by("email"), phone: by("phone") };
}

function probe(keys, data) {
  const first = (list) => list.map((k) => data?.[k]).find((v) => v !== undefined && v !== "");
  return {
    name: first(keys.name),
    identifier: first(keys.identifier),
    email: first(keys.email),
    phone: first(keys.phone),
  };
}

exports.check = async function (domain, data, { excludeRequestId } = {}) {
  const keys = keysFor(domain);
  const input = probe(keys, data);
  if (!input.name && !input.identifier && !input.email) return [];

  const [masters, open] = await Promise.all([
    MasterRecord.find({ domainKey: domain.key, mergedInto: { $in: [null, undefined] } }).lean(),
    Request.find({
      domainKey: domain.key,
      status: { $in: ["pending", "changes_requested", "approved"] },
      ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
    }).lean(),
  ]);

  const pool = [
    ...masters.map((m) => ({
      source: "master",
      id: String(m._id),
      code: m.code,
      entity: m.entity,
      ...probe(keys, { ...m.data, [keys.name[0]]: m.name }),
      name: m.name,
    })),
    ...open.map((r) => ({
      source: "request",
      id: String(r._id),
      code: r.refNo,
      entity: r.entity,
      ...probe(keys, r.data),
      name: r.title,
    })),
  ];

  return findMatches(input, pool)
    .slice(0, 5)
    .map(({ source, id, code, name, entity, score, level, reasons }) => ({
      source, id, code, name, entity, score, level, reasons,
    }));
};

// MDM data-health scan: near-duplicate pairs already inside master data (they distort regional reporting)
exports.scanMasterData = async function (domainKey = "customer") {
  const recs = await MasterRecord.find({ domainKey }).lean();
  const pairs = [];
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (a.mergedInto === b.code || b.mergedInto === a.code) continue;
      if (a.mergedInto || b.mergedInto) continue;
      const score = nameScore(a.name, b.name);
      if (score >= 0.85) {
        pairs.push({
          score: Number(score.toFixed(2)),
          a: { code: a.code, name: a.name, entity: a.entity, country: a.country },
          b: { code: b.code, name: b.name, entity: b.entity, country: b.country },
          sameCountry: a.country === b.country,
        });
      }
    }
  }
  return pairs.filter((p) => p.sameCountry).sort((x, y) => y.score - x.score);
};
