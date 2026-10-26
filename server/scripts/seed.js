// Resets the portal database and loads demo data:
//   users (the personas from the brief), domain configuration, SAP B1 master data (with realistic duplicates),
//   24 months of SYNTHETIC purchase orders / RFQs / enquiries for 5 countries x Products A-C,
//   MDM requests in every workflow state with back-dated, hash-chained audit history, and sample inbound emails.
// Usage: npm run seed
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "config.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/user-model");
const Domain = require("../models/domain-model");
const MasterRecord = require("../models/master-record-model");
const PurchaseDoc = require("../models/purchase-doc-model");
const Request = require("../models/request-model");
const Audit = require("../models/audit-model");
const Notification = require("../models/notification-model");
const InboundMessage = require("../models/inbound-message-model");
const domainsConfig = require("../data/domains");
const workflow = require("../services/workflow");
const audit = require("../utils/audit");
const counters = require("../utils/counters");
const { classify } = require("../utils/classifier");
const { monthRange } = require("../services/analytics");

const DEMO_PASSWORD = "Demo123!";
const END_MONTH = "2026-10"; // data runs Nov 2024 - Oct 2026
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ---------- deterministic randomness, so every seed gives the same numbers ----------
let seed = 20261028;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + (b - a) * rand();
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
function normal() {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
function poisson(lambda) {
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

// ---------- people ----------
const USERS = [
  { key: "amy", name: "Amy Tan", title: "Product Manager", role: "requestor", entities: ["SPD"], country: "SG" },
  { key: "marcus", name: "Marcus Lim", title: "Regional Sales (new QTG unit)", role: "requestor", entities: ["QTG"], country: "MY" },
  { key: "ravi", name: "Ravi Kumar", title: "Regional Sales Manager", role: "requestor", entities: ["SPD"], country: "TH" },
  { key: "siti", name: "Siti Rahman", title: "Procurement Officer", role: "requestor", entities: ["QTS"], country: "ID" },
  { key: "weijie", name: "Wei Jie Ong", title: "Finance Manager", role: "approver", functions: ["FINANCE"], entities: ["SPD", "QTS", "QTG"], country: "SG" },
  { key: "nok", name: "Dr. Nok Srisai", title: "Quality & Regulatory Affairs Lead", role: "approver", functions: ["QRA"], entities: ["SPD", "QTS", "QTG"], country: "TH" },
  { key: "daniel", name: "Daniel Koh", title: "Business Unit Head – SPD", role: "approver", functions: ["BU_HEAD"], entities: ["SPD"], country: "SG" },
  { key: "grace", name: "Grace Ng", title: "Business Unit Head – QTS", role: "approver", functions: ["BU_HEAD"], entities: ["QTS"], country: "SG" },
  { key: "hendra", name: "Hendra Wijaya", title: "Business Unit Head – QTG", role: "approver", functions: ["BU_HEAD"], entities: ["QTG"], country: "ID" },
  { key: "linh", name: "Linh Nguyen", title: "Business Support Executive", role: "approver", functions: ["BUSINESS_SUPPORT"], entities: ["SPD", "QTS", "QTG"], country: "VN" },
  { key: "priya", name: "Priya Nair", title: "MDM Analyst", role: "mdm", entities: ["SPD", "QTS", "QTG"], country: "SG" },
  { key: "admin", name: "Portal Admin", title: "MDM Lead / Portal owner", role: "admin", entities: ["SPD", "QTS", "QTG"], country: "SG" },
];

// ---------- customers (SAP B1 business partners) ----------
// productMix: which products the customer buys. trendOverride / churn shape their history.
const CUSTOMERS = [
  // Singapore
  { name: "National University Hospital", country: "SG", segment: "Hospital", mix: "ABC", size: 1.6 },
  { name: "Tan Tock Seng Hospital", country: "SG", segment: "Hospital", mix: "ABC", size: 1.4 },
  { name: "Changi General Hospital", country: "SG", segment: "Hospital", mix: "AB", size: 1.0 },
  { name: "Singapore General Hospital", country: "SG", segment: "Hospital", mix: "ABC", size: 1.8 },
  { name: "KK Women's and Children's Hospital", country: "SG", segment: "Hospital", mix: "AB", size: 0.9 },
  { name: "Mount Elizabeth Hospital", country: "SG", segment: "Hospital", mix: "ABC", size: 0.8 },
  { name: "Quest Laboratories Pte Ltd", country: "SG", segment: "Laboratory", mix: "AB", size: 1.2 },
  { name: "Parkway Laboratory Services", country: "SG", segment: "Laboratory", mix: "A", size: 1.1 },
  { name: "Raffles Medical Clinic Raffles Place", country: "SG", segment: "Clinic", mix: "AB", size: 1.0 },
  // Malaysia
  { name: "Hospital Kuala Lumpur", country: "MY", segment: "Hospital", mix: "ABC", size: 1.5 },
  { name: "Gleneagles Hospital Kuala Lumpur", country: "MY", segment: "Hospital", mix: "ABC", size: 0.9 },
  { name: "Sunway Medical Centre", country: "MY", segment: "Hospital", mix: "AB", size: 1.0, churn: { from: 8, level: 0.25 } },
  { name: "Pantai Hospital Penang", country: "MY", segment: "Hospital", mix: "AB", size: 0.7 },
  { name: "KPJ Johor Specialist Hospital", country: "MY", segment: "Hospital", mix: "ABC", size: 0.8 },
  { name: "Pathlab Diagnostics Sdn Bhd", country: "MY", segment: "Laboratory", mix: "AB", size: 1.0 },
  { name: "Lablink (M) Sdn Bhd", country: "MY", segment: "Laboratory", mix: "A", size: 0.9 },
  // Indonesia
  { name: "RSUP Dr. Cipto Mangunkusumo", country: "ID", segment: "Hospital", mix: "ABC", size: 1.7 },
  { name: "Rumah Sakit Pondok Indah", country: "ID", segment: "Hospital", mix: "AB", size: 1.0 },
  { name: "Siloam Hospitals Kebon Jeruk", country: "ID", segment: "Hospital", mix: "ABC", size: 1.1 },
  { name: "RS Premier Bintaro", country: "ID", segment: "Hospital", mix: "AB", size: 0.7 },
  { name: "Mayapada Hospital Jakarta Selatan", country: "ID", segment: "Hospital", mix: "AB", size: 0.8, churn: { from: 10, level: 0 } },
  { name: "Prodia Clinical Laboratory", country: "ID", segment: "Laboratory", mix: "AB", size: 1.6 },
  { name: "Laboratorium Klinik Pramita", country: "ID", segment: "Laboratory", mix: "A", size: 0.9 },
  // Thailand
  { name: "Siriraj Hospital", country: "TH", segment: "Hospital", mix: "ABC", size: 1.7 },
  { name: "Ramathibodi Hospital", country: "TH", segment: "Hospital", mix: "ABC", size: 1.3 },
  { name: "Bumrungrad International Hospital", country: "TH", segment: "Hospital", mix: "AB", size: 1.2 },
  { name: "Bangkok Hospital Headquarters", country: "TH", segment: "Hospital", mix: "ABC", size: 1.1 },
  { name: "Samitivej Sukhumvit Hospital", country: "TH", segment: "Hospital", mix: "AB", size: 0.9, churn: { from: 9, level: 0.35 } },
  { name: "N Health Pathology Laboratory", country: "TH", segment: "Laboratory", mix: "AB", size: 1.0 },
  { name: "Chulalongkorn Memorial Hospital", country: "TH", segment: "Hospital", mix: "AB", size: 1.4 },
  // Vietnam
  { name: "Bệnh viện Chợ Rẫy", country: "VN", segment: "Hospital", mix: "ABC", size: 1.5 },
  { name: "Bệnh viện Bạch Mai", country: "VN", segment: "Hospital", mix: "AB", size: 1.4 },
  { name: "Vinmec Times City International Hospital", country: "VN", segment: "Hospital", mix: "ABC", size: 1.0, startsAt: 7 },
  { name: "FV Hospital", country: "VN", segment: "Hospital", mix: "AB", size: 0.8 },
  { name: "Hoan My Saigon Hospital", country: "VN", segment: "Hospital", mix: "ABC", size: 0.7 },
  { name: "Medlatec Laboratory", country: "VN", segment: "Laboratory", mix: "AB", size: 1.1 },
  { name: "Diag Laboratories", country: "VN", segment: "Laboratory", mix: "A", size: 0.8, startsAt: 4 },
];

// The same customer keyed in again by another entity under a slightly different name.
// merged: MDM has already confirmed and merged it. Unmerged ones show up in the duplicate scan.
const DUPLICATES = [
  { of: "National University Hospital", name: "National Univ. Hospital (S) Pte Ltd", entity: "QTS", takes: "B", merged: false },
  { of: "Tan Tock Seng Hospital", name: "Tan Tock Seng Hosp", entity: "QTG", takes: "C", merged: true },
  { of: "Gleneagles Hospital Kuala Lumpur", name: "Gleneagles Hospital KL", entity: "QTS", takes: "B", merged: false },
  { of: "Prodia Clinical Laboratory", name: "Prodia Clinical Lab", entity: "QTS", takes: "B", merged: true },
  { of: "Bumrungrad International Hospital", name: "Bumrungrad Intl Hospital", entity: "QTS", takes: "B", merged: false },
  { of: "Bệnh viện Chợ Rẫy", name: "Benh Vien Cho Ray", entity: "QTG", takes: "C", merged: true },
];

const ENTITY_FOR_PRODUCT = { A: "SPD", B: "QTS", C: "QTG" };
const UNIT_PRICE = { A: 38, B: 4.2, C: 9500 }; // USD per unit
const BASE_UNITS = {
  Hospital: { A: 110, B: 320, C: 2.4 },
  Laboratory: { A: 210, B: 380, C: 1.2 },
  Clinic: { A: 25, B: 70, C: 0.3 },
};
// Monthly compound growth by country x product (the "story" in the data)
const TREND = {
  SG: { A: 0.004, B: 0.002, C: -0.006 },
  MY: { A: 0.012, B: 0.009, C: 0.015 },
  ID: { A: 0.02, B: 0.017, C: 0.01 },
  TH: { A: 0.007, B: -0.016, C: 0.004 },
  VN: { A: 0.019, B: 0.022, C: 0.016 },
};
// Calendar seasonality: Lunar New Year / Tet dip, year-end budget flush for equipment
const SEASON = { 1: 0.95, 2: 0.86, 3: 1.0, 4: 0.97, 5: 1.0, 6: 1.02, 7: 1.03, 8: 1.0, 9: 1.05, 10: 1.06, 11: 1.08, 12: 0.98 };
const SEASON_C = { 1: 0.7, 2: 0.6, 3: 1.35, 4: 0.8, 5: 0.85, 6: 1.0, 7: 0.9, 8: 0.9, 9: 1.0, 10: 1.0, 11: 1.5, 12: 1.75 };
const COUNTRY_SEASON = { VN: { 2: 0.78 }, ID: { 3: 0.86, 4: 0.92 }, TH: { 4: 0.88 } };

const fakeId = (country) =>
  ({
    SG: () => `${Math.floor(between(190000000, 202599999))}${pick("ABCDEKMNRZ")}`,
    MY: () => `${Math.floor(between(190001000000, 202501999999))}`,
    ID: () => `0${Math.floor(between(10000000, 99999999))}${Math.floor(between(1000000, 9999999))}`,
    TH: () => `0${Math.floor(between(100000000000, 999999999999))}`,
    VN: () => `0${Math.floor(between(300000000, 399999999))}`,
  })[country]();
const domainOf = (name) =>
  name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 2).slice(0, 2).join("") +
  ".example";

async function main() {
  await mongoose.connect(process.env.DB, { dbName: process.env.DB_NAME || "lives_mdm" });
  console.log(`Seeding database "${mongoose.connection.name}"...`);
  for (const name of ["users", "domains", "master_records", "purchase_docs", "requests", "audit_log", "notifications", "inbound_messages", "counters", "sessions"]) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
  await Promise.all([User, Domain, MasterRecord, PurchaseDoc, Request, Audit, Notification, InboundMessage].map((m) => m.syncIndexes()));

  // ---- users ----
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = {};
  for (const u of USERS) {
    users[u.key] = await User.create({ ...u, email: `${u.key}@demo.livesgroup.test`, password: hash, functions: u.functions || [] });
  }
  console.log(`  ${USERS.length} users (password ${DEMO_PASSWORD})`);

  // ---- domains ----
  const domains = {};
  for (const d of domainsConfig) domains[d.key] = (await Domain.create({ ...d, updatedBy: users.admin._id })).toObject();
  console.log(`  ${domainsConfig.length} request types`);

  // ---- master data ----
  let cNo = 0;
  const custRecords = [];
  for (const c of CUSTOMERS) {
    const code = `C${String(++cNo).padStart(5, "0")}`;
    const dom = domainOf(c.name);
    custRecords.push({
      domainKey: "customer",
      code,
      name: c.name,
      entity: ENTITY_FOR_PRODUCT[c.mix[0]],
      country: c.country,
      segment: c.segment,
      data: {
        registrationNo: fakeId(c.country),
        customerType: c.segment,
        country: c.country,
        contactEmail: `procurement@${dom}`,
        contactPhone: `+${{ SG: 65, MY: 60, ID: 62, TH: 66, VN: 84 }[c.country]} ${Math.floor(between(60000000, 99999999))}`,
      },
    });
    c.code = code;
  }
  for (const d of DUPLICATES) {
    const orig = CUSTOMERS.find((c) => c.name === d.of);
    const code = `C${String(++cNo).padStart(5, "0")}`;
    const base = custRecords.find((r) => r.code === orig.code);
    custRecords.push({
      domainKey: "customer",
      code,
      name: d.name,
      entity: d.entity,
      country: orig.country,
      segment: orig.segment,
      data: { ...base.data, registrationNo: fakeId(orig.country) }, // keyed with a different (wrong) reg. no.
      mergedInto: d.merged ? orig.code : undefined,
    });
    d.code = code;
  }

  const vendors = [
    ["Sysmex Asia Pacific Pte Ltd", "SG", "Manufacturer / Principal"],
    ["Roche Diagnostics Asia Pacific", "SG", "Manufacturer / Principal"],
    ["Eppendorf Asia Pacific Sdn Bhd", "MY", "Manufacturer / Principal"],
    ["Thermo Fisher Scientific (Thailand)", "TH", "Distributor"],
    ["PT Kalbe Medika Distribusi", "ID", "Distributor"],
    ["DHL Supply Chain Singapore", "SG", "Logistics"],
    ["Sarstedt Vietnam Co Ltd", "VN", "Consumables"],
    ["Greiner Bio-One Thailand", "TH", "Consumables"],
  ].map(([name, country, cat], i) => ({
    domainKey: "vendor",
    code: `V${String(i + 1).padStart(5, "0")}`,
    name,
    country,
    entity: pick(["SPD", "QTS", "QTG"]),
    data: { registrationNo: fakeId(country), vendorCategory: cat, country, contactEmail: `ap@${domainOf(name)}` },
  }));

  const items = [
    ["Sysmex HbA1c Reagent Kit 100 tests", "SYS-HBA-100", "A", "Reagent"],
    ["Troponin I High Sensitivity Assay 200T", "RCH-TNI-200", "A", "Reagent"],
    ["CRP Latex Test Kit 50 tests", "RCH-CRP-050", "A", "Reagent"],
    ["Blood Glucose Control Level 1-3", "SYS-GLC-CTL", "A", "Reagent"],
    ["Pipette Tips 200 µL Filtered (rack of 96)", "EPP-TIP-200F", "B", "Consumable"],
    ["Vacuette EDTA Tube 4 mL (pack of 50)", "GRE-EDTA-4", "B", "Consumable"],
    ["Microcentrifuge Tube 1.5 mL (pack of 500)", "EPP-MCT-15", "B", "Consumable"],
    ["Nitrile Exam Gloves M (box of 100)", "GEN-NIT-M", "B", "Consumable"],
    ["Hematology Analyzer XN-550", "SYS-XN550", "C", "Equipment"],
    ["Benchtop Centrifuge 5425", "EPP-5425", "C", "Equipment"],
    ["Biosafety Cabinet Class II 4ft", "THM-BSC-4", "C", "Equipment"],
    ["Chemistry Analyzer cobas c 111", "RCH-C111", "C", "Equipment"],
  ].map(([name, part, line, group], i) => ({
    domainKey: "item",
    code: `I${String(i + 1).padStart(5, "0")}`,
    name,
    entity: ENTITY_FOR_PRODUCT[line],
    data: { manufacturerPartNo: part, productLine: line, itemGroup: group },
  }));

  const costCenters = [
    ["SG Sales – Diagnostics", "SG"],
    ["MY Sales – Equipment", "MY"],
    ["ID Service & Installation", "ID"],
    ["TH Regulatory Affairs", "TH"],
    ["VN Sales – Consumables", "VN"],
  ].map(([name, country], i) => ({
    domainKey: "costcenter",
    code: `CC${String(i + 1).padStart(5, "0")}`,
    name,
    country,
    entity: pick(["SPD", "QTS", "QTG"]),
    data: { country, ownerEmail: `owner${i + 1}@demo.livesgroup.test` },
  }));

  await MasterRecord.insertMany([...custRecords, ...vendors, ...items, ...costCenters]);
  await counters.set("sap:customer", cNo);
  await counters.set("sap:vendor", vendors.length);
  await counters.set("sap:item", items.length);
  await counters.set("sap:costcenter", costCenters.length);
  console.log(`  ${custRecords.length} customers (${DUPLICATES.length} duplicates), ${vendors.length} vendors, ${items.length} items, ${costCenters.length} cost centers`);

  // ---- purchase documents (synthetic) ----
  const months = monthRange(END_MONTH, 24);
  const docs = [];
  let so = 0;
  for (const c of CUSTOMERS) {
    const dupFor = DUPLICATES.filter((d) => d.of === c.name);
    for (const p of c.mix) {
      const base = BASE_UNITS[c.segment][p] * c.size * between(0.8, 1.2);
      months.forEach((month, t) => {
        if (c.startsAt && t < 12 + c.startsAt) return; // new customer, starts mid-period
        const mo = Number(month.slice(5));
        let mult = Math.pow(1 + TREND[c.country][p], t) * (p === "C" ? SEASON_C[mo] : SEASON[mo]) * (COUNTRY_SEASON[c.country]?.[mo] || 1);
        if (c.churn && t >= 12 + c.churn.from) mult *= c.churn.level;
        const lambda = base * mult * Math.max(0.3, 1 + 0.09 * normal());
        const qty = p === "C" ? poisson(lambda) : Math.round(lambda);
        if (qty <= 0) return;
        // orders for the duplicated entity's product line were booked against the duplicate code
        const dup = dupFor.find((d) => d.takes === p);
        const day = Math.floor(between(1, 28));
        docs.push({
          docNo: `SO-${c.country}-${String(++so).padStart(6, "0")}`,
          docType: "order",
          country: c.country,
          entity: ENTITY_FOR_PRODUCT[p],
          customerCode: dup && t >= 6 ? dup.code : c.code,
          product: p,
          month,
          date: new Date(`${month}-${String(day).padStart(2, "0")}T03:00:00Z`),
          qty,
          valueUsd: Math.round(qty * UNIT_PRICE[p] * between(0.92, 1.05)),
        });
      });
    }
  }
  // RFQs and enquiries: activity that is NOT demand yet
  let rq = 0;
  for (const month of months) {
    for (const country of ["SG", "MY", "ID", "TH", "VN"]) {
      const local = CUSTOMERS.filter((c) => c.country === country);
      const nReq = Math.floor(between(2, 7));
      for (let i = 0; i < nReq; i++) {
        const c = pick(local);
        const p = pick(["A", "B", "C"]);
        const qty = p === "C" ? Math.ceil(between(1, 3)) : Math.round(between(50, 900));
        docs.push({ docNo: `RFQ-${country}-${String(++rq).padStart(6, "0")}`, docType: "purchase_request", country, entity: ENTITY_FOR_PRODUCT[p], customerCode: c.code, product: p, month, qty, valueUsd: Math.round(qty * UNIT_PRICE[p]) });
      }
      const nEnq = Math.floor(between(5, 14));
      for (let i = 0; i < nEnq; i++) {
        const c = pick(local);
        docs.push({ docNo: `ENQ-${country}-${String(++rq).padStart(6, "0")}`, docType: "enquiry", country, customerCode: c.code, product: pick(["A", "B", "C"]), month, qty: 0, valueUsd: 0 });
      }
    }
  }
  await PurchaseDoc.insertMany(docs);
  console.log(`  ${docs.length} purchase documents (${months[0]} to ${months.at(-1)})`);

  // ---- MDM requests in every state ----
  const now = Date.now();
  let refNo = 0;
  const year = new Date().getFullYear();

  async function seedRequest({ domainKey, by, entity, data, ageDays, approveStages = 0, outcome = "pending", decisions = {}, override, returned }) {
    const domain = domains[domainKey];
    const r = new Request({
      refNo: `MDM-${year}-${String(++refNo).padStart(4, "0")}`,
      domainKey,
      domainVersion: 1,
      requester: users[by]._id,
      entity,
      country: data.country,
      title: data[domain.fields.find((f) => f.dedupe === "name").key],
    });
    const { plain, secure } = workflow.splitData(domain, data);
    r.data = plain;
    r.secure = secure;
    const t0 = now - ageDays * DAY;
    const events = [];
    if (outcome === "draft") {
      r.status = "draft";
      events.push(["draft_saved", users[by], null, t0]);
    } else {
      r.submittedAt = new Date(t0);
      r.approvals = workflow.buildApprovals(domain, data, entity);
      events.push(["submitted", users[by], { approvals: r.approvals.map((a) => `${a.stage}. ${a.label}`), duplicateOverride: override }, t0]);
      if (override) r.duplicateOverride = { reason: override, by: users[by]._id, at: new Date(t0) };
      if (returned) r.returnedCount = 1;
      const stages = [...new Set(r.approvals.map((a) => a.stage))];
      let tStage = t0;
      for (const [stageIndex, stage] of stages.entries()) {
        const inStage = r.approvals.filter((a) => a.stage === stage);
        let stageEnd = tStage;
        for (const a of inStage) {
          a.startedAt = new Date(tStage);
          a.dueAt = new Date(tStage + workflow.slaFor(domain, a) * HOUR);
          const decided = decisions[a.key];
          if (stageIndex < approveStages || decided) {
            const took = (decided?.hours ?? between(4, 40)) * HOUR;
            const approver = users[decided?.by || defaultApprover(a, entity)];
            a.status = decided?.status || "approved";
            a.actedAt = new Date(Math.min(now - HOUR, tStage + took));
            a.actedBy = approver._id;
            a.comment = decided?.comment;
            stageEnd = Math.max(stageEnd, a.actedAt.getTime());
            events.push([`step_${a.status}`, approver, { step: a.label, comment: a.comment }, a.actedAt.getTime()]);
          }
        }
        // the first stage that is not fully decided is where the request now waits
        const open = inStage.filter((a) => !a.actedAt);
        const blocked = inStage.some((a) => ["rejected", "changes_requested"].includes(a.status));
        if (open.length || blocked) {
          if (!blocked) open.forEach((a) => (a.status = "pending"));
          break;
        }
        tStage = stageEnd;
      }
      const anyBlocked = r.approvals.find((a) => ["rejected", "changes_requested"].includes(a.status));
      if (anyBlocked) {
        r.status = anyBlocked.status;
        r.approvals.forEach((a) => a.status === "pending" && (a.status = "waiting"));
      } else if (workflow.allApproved(r)) {
        r.status = "approved";
        r.approvedAt = new Date(Math.max(...r.approvals.map((a) => a.actedAt.getTime())));
        events.push(["fully_approved", null, null, r.approvedAt.getTime() + 1000]);
      } else {
        r.status = "pending";
      }
      if (outcome === "completed") {
        const code = `${domain.codePrefix}${String(await counters.next(`sap:${domainKey}`)).padStart(5, "0")}`;
        r.status = "completed";
        r.sapCode = code;
        r.completedAt = new Date(r.approvedAt.getTime() + between(2, 20) * HOUR);
        events.push(["created_in_sap", users.priya, { sapCode: code, endpoint: `/b1s/v1/${domain.sapObject}` }, r.completedAt.getTime()]);
        await MasterRecord.create({ domainKey, code, name: r.title, entity, country: data.country, segment: data.customerType, data: plain, createdFromRequest: r.refNo });
      }
    }
    r.createdAt = new Date(t0);
    r.updatedAt = new Date(Math.max(...events.map((e) => e[3])));
    await r.save({ timestamps: false });
    for (const [action, actor, details, at] of events.sort((a, b) => a[3] - b[3])) await audit.log(r, action, actor, details, new Date(at));
    // notifications for whoever the request is waiting on
    for (const a of r.approvals.filter((x) => x.status === "pending")) {
      const people = await workflow.assignees(a);
      await Notification.insertMany(
        people.map((p) => ({
          user: p._id,
          kind: a.dueAt < new Date() ? "reminder" : "action",
          message: `${r.refNo} "${r.title}" needs your ${a.label} approval`,
          link: `/requests/${r._id}`,
          createdAt: a.startedAt,
        })),
      );
    }
    if (r.status === "approved") {
      await Notification.create({ user: users.priya._id, kind: "action", message: `${r.refNo} "${r.title}" is fully approved - ready to create in SAP B1`, link: `/requests/${r._id}` });
    }
    if (["changes_requested", "rejected"].includes(r.status)) {
      const a = r.approvals.find((x) => x.status === r.status);
      await Notification.create({ user: users[by]._id, kind: "action", message: `${a.label} ${r.status === "rejected" ? "rejected" : "asked for changes on"} ${r.refNo}: "${a.comment}"`, link: `/requests/${r._id}` });
    }
    return r;
  }

  function defaultApprover(a, entity) {
    return { FINANCE: "weijie", QRA: "nok", BUSINESS_SUPPORT: "linh", BU_HEAD: { SPD: "daniel", QTS: "grace", QTG: "hendra" }[a.entity || entity] }[a.function];
  }

  const cust = (name, country, extra = {}) => ({
    customerName: name, registrationNo: fakeId(country), customerType: "Hospital", country,
    billingAddress: "1 Example Road, " + { SG: "Singapore 119074", MY: "50450 Kuala Lumpur", ID: "Jakarta 12950", TH: "Bangkok 10330", VN: "Ho Chi Minh City" }[country],
    shippingSame: true, contactPerson: "Head of Procurement", contactEmail: `procurement@${domainOf(name)}`,
    contactPhone: `+65 6${Math.floor(between(1000000, 9999999))}`, currency: { SG: "SGD", MY: "MYR", ID: "IDR", TH: "THB", VN: "VND" }[country],
    creditTermsDays: "30", creditLimit: 80000, ...extra,
  });
  const item = (name, part, line, extra = {}) => ({
    itemName: name, manufacturerPartNo: part, productLine: line, itemGroup: { A: "Reagent", B: "Consumable", C: "Equipment" }[line],
    uom: line === "C" ? "Each" : "Box", packSize: line === "C" ? 1 : 100, isMedicalDevice: line !== "B", riskClass: "B",
    deviceLicenseNo: line !== "B" ? `DE${Math.floor(between(1000000, 9999999))}` : undefined, storage: line === "A" ? "2–8 °C" : "Ambient",
    shelfLifeMonths: line === "A" ? 18 : 60, standardCost: line === "C" ? 14500 : 21, listPrice: line === "C" ? 21000 : 38, ...extra,
  });
  const vend = (name, country, extra = {}) => ({
    vendorName: name, registrationNo: fakeId(country), vendorCategory: "Distributor", regulatedSupplier: false, country,
    address: "Business Park, " + country, contactEmail: `sales@${domainOf(name)}`, currency: "USD", bankName: "DBS Bank",
    bankAccountNo: `0${Math.floor(between(100000000, 999999999))}`, swiftCode: "DBSSSGSG", paymentTermsDays: "30", ...extra,
  });

  // completed history (gives the cycle-time numbers on the dashboard)
  const done = [
    ["customer", "marcus", "QTG", cust("Columbia Asia Hospital Cheras", "MY"), 58],
    ["item", "amy", "SPD", item("Procalcitonin Rapid Test 25T", "RCH-PCT-025", "A"), 52],
    ["customer", "ravi", "SPD", cust("Phyathai 2 Hospital", "TH"), 47],
    ["vendor", "siti", "QTS", vend("PT Indolab Utama", "ID"), 41],
    ["item", "amy", "SPD", item("D-Dimer Assay 100T", "SYS-DDM-100", "A"), 36, true],
    ["customer", "ravi", "SPD", cust("Bangkok Hospital Pattaya", "TH"), 29],
    ["costcenter", "marcus", "QTG", { costCenterName: "MY Service – Equipment", department: "Service", country: "MY", ownerEmail: "marcus@demo.livesgroup.test", effectiveFrom: "2026-09-01", annualBudget: 120000 }, 24],
    ["item", "siti", "QTS", item("Sterile Swab Applicator (pack of 100)", "SAR-SWB-100", "B"), 19],
    ["customer", "marcus", "QTG", cust("Thomson Hospital Kota Damansara", "MY"), 15, true],
    ["vendor", "siti", "QTS", vend("Bio-Rad Laboratories (Singapore)", "SG", { regulatedSupplier: true, isoCertificate: "ISO13485-SG-22871", vendorCategory: "Manufacturer / Principal" }), 11],
    ["item", "amy", "SPD", item("Ferritin Assay 100T", "RCH-FER-100", "A"), 8],
  ];
  for (const [domainKey, by, entity, data, ageDays, returned] of done) {
    await seedRequest({ domainKey, by, entity, data, ageDays, approveStages: 9, outcome: "completed", returned });
  }

  // live requests for the demo
  await seedRequest({ // Amy's lab consumable from Appendix C - QRA now added automatically, BU Head done, QRA pending
    domainKey: "item", by: "amy", entity: "SPD", ageDays: 1.2,
    data: item("Sysmex HbA1c Reagent Kit 200 tests", "SYS-HBA-200", "A"),
    decisions: { bu: { by: "daniel", hours: 3 } },
  });
  await seedRequest({ // Marcus' customer - overdue on Finance and the QTG BU Head
    domainKey: "customer", by: "marcus", entity: "QTG", ageDays: 3.5,
    data: cust("KPJ Damansara Specialist Hospital", "MY", { creditTermsDays: "60", creditLimit: 150000 }),
  });
  await seedRequest({ // Vendor with bank details waiting on Finance
    domainKey: "vendor", by: "siti", entity: "QTS", ageDays: 1.6,
    data: vend("PT Medika Logistik Nusantara", "ID", { vendorCategory: "Logistics", bankName: "Bank Mandiri", swiftCode: "BMRIIDJA" }),
    decisions: { bu: { by: "grace", hours: 5 } },
  });
  await seedRequest({ // approved, waiting for Priya to create in SAP B1
    domainKey: "customer", by: "ravi", entity: "SPD", ageDays: 2.4, approveStages: 9,
    data: cust("Mount Alvernia Hospital", "SG"),
  });
  await seedRequest({ // sent back for changes
    domainKey: "item", by: "amy", entity: "SPD", ageDays: 4,
    data: item("Pipette Tips 1000 µL Filtered", "EPP-TIP-1000F", "B", { packSize: 1 }),
    decisions: {
      bu: { by: "daniel", hours: 6 },
      support: { by: "linh", hours: 20, status: "changes_requested", comment: "Pack size says 1 - tips are sold in racks of 96. Please correct units per pack." },
    },
    returned: true,
  });
  await seedRequest({ // rejected duplicate vendor
    domainKey: "vendor", by: "siti", entity: "QTS", ageDays: 6,
    data: vend("Eppendorf Asia Pacific", "MY", { vendorCategory: "Manufacturer / Principal" }),
    override: "Different bank account from the existing one",
    decisions: {
      bu: { by: "grace", hours: 4 },
      finance: { by: "weijie", hours: 9, status: "rejected", comment: "Vendor already exists as V00003. Update the bank details on V00003 instead of creating a new vendor." },
    },
  });
  await seedRequest({ // high credit limit adds the 2nd Finance step
    domainKey: "customer", by: "ravi", entity: "SPD", ageDays: 0.6,
    data: cust("Vejthani Hospital", "TH", { creditTermsDays: "90", creditLimit: 350000 }),
  });
  await seedRequest({ // cost center for a new business unit
    domainKey: "costcenter", by: "marcus", entity: "QTG", ageDays: 0.3,
    data: { costCenterName: "VN Sales – Equipment", department: "Sales", country: "VN", ownerEmail: "marcus@demo.livesgroup.test", effectiveFrom: "2026-11-01", annualBudget: 250000 },
  });
  await seedRequest({ domainKey: "customer", by: "ravi", entity: "SPD", ageDays: 0.1, outcome: "draft", data: cust("Bangkok Hospital Phuket", "TH") });
  await counters.set(`ref:${year}`, refNo);
  console.log(`  ${refNo} MDM requests`);

  // ---- inbound emails ----
  const pool = custRecords.filter((c) => !c.mergedInto).map((c) => ({ code: c.code, name: c.name, country: c.country }));
  const emails = [
    { fromName: "Procurement – National University Hospital", from: "procurement@nuh.example.sg", subject: "Purchase Order PO No: NUH-PO-88123", body: "Dear Lives team,\n\nPlease supply 200 boxes of HbA1c reagent kits under PO No: NUH-PO-88123.\nDelivery by 15 Nov 2026 to Main Lab, Level 3.\n\nRegards,\nJessica Lee\nNational University Hospital" },
    { fromName: "Thomson Medical Centre", from: "purchasing@thomsonmedical.example.sg", subject: "Attached is our purchase order TMC-2291", body: "Hi,\n\nAttached is our purchase order PO#TMC-2291 for 40 kits of Product A troponin assays. Please deliver to our Novena lab.\n\nThank you,\nThomson Medical Centre\nSingapore" },
    { fromName: "Siriraj Hospital Supplies Division", from: "supply@siriraj.example.th", subject: "Request for quotation – annual supply of pipette tips", body: "Dear Sir/Madam,\n\nRequest for quotation: annual supply of 50,000 pcs filtered pipette tips 200 uL for FY2027.\nPlease quote by 10 November.\n\nSiriraj Hospital\nBangkok, Thailand" },
    { fromName: "Vinmec Times City", from: "lab@vinmec.example.vn", subject: "Centrifuge information", body: "Hello,\n\nCould you share the price list and lead time for your benchtop centrifuges? We are interested in a demo next month.\n\nVinmec Times City International Hospital\nHanoi, Vietnam" },
    { fromName: "Prodia Clinical Laboratory", from: "purchasing@prodia.example.id", subject: "Following up – delivery status", body: "Dear team,\n\nFollowing up on our previous email - any update on the delivery status of last week's order?\n\nProdia Clinical Laboratory\nJakarta" },
    { fromName: "Marcus Lim", from: "marcus@demo.livesgroup.test", subject: "New customer setup – Klinik Mediviron Setapak", body: "Hi MDM,\n\nPlease set up a new customer account for Klinik Mediviron Setapak, Kuala Lumpur, Malaysia. They want credit terms of 30 days.\n\nThanks,\nMarcus" },
    { fromName: "Hoan My Saigon Hospital", from: "procurement@hoanmy.example.vn", subject: "Order confirmation – hematology analyzer", body: "Dear Lives Vietnam,\n\nWe confirm our order: 1 unit hematology analyzer XN-550 with installation. PO number: HM-2026-0412. Please deliver to Ho Chi Minh City.\n\nHoan My Saigon Hospital" },
    { fromName: "Bio Diagnostics Supplies Co", from: "sales@biodiag.example.th", subject: "Vendor registration", body: "Dear Procurement,\n\nWe would like to onboard as a new supplier of IVD controls. Our bank details and company registration are attached for vendor registration.\n\nBio Diagnostics Supplies Co., Ltd\nBangkok" },
  ];
  for (const [i, e] of emails.entries()) {
    await InboundMessage.create({ ...e, receivedAt: new Date(now - (emails.length - i) * 5 * HOUR), classification: classify(e, pool) });
  }
  console.log(`  ${emails.length} inbound emails`);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
