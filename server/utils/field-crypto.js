// Encrypts sensitive fields (bank account, credit terms...) before they are stored, so they never sit in the
// database - or in an email - as plain text. AES-256-GCM also detects tampering (decrypt fails).
const crypto = require("crypto");

let cachedKey = null;
function key() {
  if (!cachedKey) {
    const secret = process.env.FIELD_KEY || process.env.SECRET || "dev-only-secret-change-me";
    cachedKey = crypto.scryptSync(secret, "lives-mdm-field-encryption", 32);
  }
  return cachedKey;
}

exports.encrypt = function (value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
};

exports.decrypt = function (box) {
  if (!box || !box.ct) return undefined;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
};

// "DBS 0012345678" -> "•••• 5678"
exports.mask = function (value) {
  if (value === undefined || value === null || value === "") return "";
  const s = String(value);
  return s.length <= 4 ? "••••" : `•••• ${s.slice(-4)}`;
};
