const test = require("node:test");
const assert = require("node:assert");
const { nameScore, findMatches } = require("../utils/similarity");
const { compareAndForecast } = require("../utils/forecast");
const { classify } = require("../utils/classifier");
const crypto = require("../utils/field-crypto");
const { isTrue } = require("../utils/conditions");

test("name matching catches abbreviations, suffixes and accents", () => {
  assert.ok(nameScore("National Univ. Hospital (S) Pte Ltd", "National University Hospital") >= 0.92);
  assert.ok(nameScore("Bệnh viện Chợ Rẫy", "Benh Vien Cho Ray") >= 0.92);
  assert.ok(nameScore("Changi General Hospital", "Sengkang General Hospital") < 0.6);
});

test("same registration number is a likely duplicate even with a different name", () => {
  const m = findMatches({ name: "ABC Lab", identifier: "201-234-567X" }, [{ name: "Totally Different", identifier: "201234567x" }]);
  assert.equal(m[0].level, "likely");
});

test("Holt-Winters beats the 6-month average on trending seasonal data", () => {
  const series = Array.from({ length: 24 }, (_, t) => 100 + 4 * t + 20 * Math.sin((2 * Math.PI * t) / 12));
  const r = compareAndForecast(series);
  assert.equal(r.best, "hw");
  assert.ok(r.methods.hw.mape < r.methods.ma6.mape);
  assert.equal(r.forecast.length, 6);
});

test("classifier separates orders, RFQs, enquiries and MDM setup", () => {
  assert.equal(classify({ subject: "Purchase Order PO No: 123AB", body: "Please supply 20 boxes" }).type, "order");
  assert.equal(classify({ subject: "Request for quotation", body: "annual supply of 500 pcs tips" }).type, "purchase_request");
  assert.equal(classify({ subject: "Question", body: "Could you share the price list and lead time?" }).type, "enquiry");
  assert.equal(classify({ subject: "Please set up a new customer", body: "account opening for X Clinic" }).type, "mdm_setup");
});

test("sensitive fields round-trip through encryption and are masked", () => {
  const box = crypto.encrypt("0123456789");
  assert.notEqual(box.ct, "0123456789");
  assert.equal(crypto.decrypt(box), "0123456789");
  assert.equal(crypto.mask("0123456789"), "•••• 6789");
});

test("conditions", () => {
  assert.ok(isTrue({ field: "isMedicalDevice", op: "eq", value: true }, { isMedicalDevice: true }));
  assert.ok(!isTrue({ field: "creditLimit", op: "gt", value: 200000 }, { creditLimit: 150000 }));
  assert.ok(isTrue(undefined, {}));
});
