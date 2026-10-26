// Intake classifier for the shared sales / MDM mailboxes.
// Sorts each email into: order | purchase_request | enquiry | mdm_setup, pulls out product, quantity, country
// and customer, and checks the customer against master data - so a purchase order from a customer that does not
// exist in SAP B1 yet turns straight into a pre-filled Customer setup request instead of sitting in an inbox.
// It is a transparent weighted-keyword model: every decision lists the signals that produced it.
const { nameScore } = require("./similarity");

const RULES = {
  order: [
    [/\bpurchase order\b/i, 3, "mentions a purchase order"],
    [/\bP\.?O\.?\s*(no\.?|number|#)\s*[:#]?\s*[A-Z0-9-]{3,}/i, 3, "has a PO number"],
    [/\battached (is |please find )?(our )?(po|purchase order)\b/i, 2, "PO attached"],
    [/\bplease (supply|deliver|ship|dispatch)\b/i, 2, "asks to supply / deliver"],
    [/\b(confirm(ed)?|place|placing) (our |an |the )?order\b/i, 2, "confirms / places an order"],
    [/\bdeliver(y)? (by|to|date|address)\b/i, 1, "gives delivery details"],
  ],
  purchase_request: [
    [/\b(rfq|request for quotation|tender|please quote|quotation for|quote for|formal quote)\b/i, 3, "requests a quotation"],
    [/\bbudget(ary)? (quote|approval|planning)\b/i, 2, "budgetary request"],
    [/\bwe (plan|intend|would like) to (purchase|order|buy|procure)\b/i, 2, "intends to purchase"],
    [/\b(annual|yearly) (supply|contract|requirement)\b/i, 2, "annual supply requirement"],
  ],
  enquiry: [
    [/\b(price list|brochure|catalog(ue)?|spec(ification)? sheet|datasheet)\b/i, 1.5, "asks for product information"],
    [/\b(availability|lead time|in stock)\b/i, 1.5, "asks about availability"],
    [/\b(more information|interested in|could you (tell|share|advise)|would like to know)\b/i, 1.5, "general interest"],
    [/\b(follow(ing)? up|any update|status of|chasing)\b/i, 2, "follow-up / chaser"],
    [/\b(demo|demonstration|webinar|training)\b/i, 1, "asks for demo or training"],
  ],
  mdm_setup: [
    [/\bnew (customer|vendor|supplier|item|account|business partner)\b/i, 3, "asks for a new master record"],
    [/\bset ?up (a |an |the )?(new )?(customer|vendor|supplier|account|item)\b/i, 3, "asks to set up a record"],
    [/\b(account opening|item code|vendor registration|supplier registration|onboard(ing)?|cost cent(er|re))\b/i, 3, "MDM setup keywords"],
    [/\b(bank (details|account)|credit (terms|application))\b/i, 1.5, "includes banking / credit details"],
  ],
};

const PRODUCT_WORDS = {
  A: /\b(product a|reagents?|test kits?|ivd|assays?|controls?|calibrators?)\b/i,
  B: /\b(product b|consumables?|pipettes?|tips|tubes?|slides|gloves|swabs?|cuvettes?)\b/i,
  C: /\b(product c|analy[sz]ers?|equipment|centrifuges?|machines?|instruments?|incubators?|microscopes?)\b/i,
};

const COUNTRY_WORDS = {
  SG: /\b(singapore|sgd)\b|\.sg\b/i,
  MY: /\b(malaysia|kuala lumpur|penang|johor|myr|ringgit)\b|\.my\b/i,
  ID: /\b(indonesia|jakarta|surabaya|bandung|idr|rupiah)\b|\.id\b/i,
  TH: /\b(thailand|bangkok|chiang mai|thb|baht)\b|\.th\b/i,
  VN: /\b(vietnam|viet nam|hanoi|ho chi minh|saigon|da nang|vnd)\b|\.vn\b/i,
};

const LABELS = {
  order: "Customer purchase order",
  purchase_request: "Purchase request / RFQ",
  enquiry: "General enquiry / follow-up",
  mdm_setup: "MDM setup request",
};

function classify({ subject = "", body = "", from = "", fromName = "" }, customers = []) {
  const text = `${subject}\n${body}`;
  const scores = { order: 0, purchase_request: 0, enquiry: 0, mdm_setup: 0 };
  const signals = [];

  for (const [type, rules] of Object.entries(RULES)) {
    for (const [re, w, why] of rules) {
      if (re.test(text)) {
        scores[type] += w;
        signals.push({ type, why, weight: w });
      }
    }
  }
  const questions = Math.min(2, (text.match(/\?/g) || []).length * 0.5);
  if (questions) {
    scores.enquiry += questions;
    signals.push({ type: "enquiry", why: "asks questions", weight: questions });
  }

  // Quantities make an email more likely to be actionable
  const qtyMatch = text.match(/(\d[\d,]*)\s*(units?|pcs|pieces|boxes|kits|packs|cartons|sets|nos|tests|bottles)\b/i);
  const qty = qtyMatch ? Number(qtyMatch[1].replace(/,/g, "")) : null;
  if (qty) {
    scores.order += 1;
    scores.purchase_request += 1;
    signals.push({ type: "order", why: `quantity stated (${qty})`, weight: 1 });
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const type = ranked[0][1] > 0 ? ranked[0][0] : "enquiry";
  const confidence = total ? ranked[0][1] / total : 0.4;

  const product = Object.keys(PRODUCT_WORDS).find((p) => PRODUCT_WORDS[p].test(text)) || null;
  const country = Object.keys(COUNTRY_WORDS).find((c) => COUNTRY_WORDS[c].test(`${text}\n${from}`)) || null;
  const poNumber = (text.match(/\bP\.?O\.?\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9-]{3,})/i) || [])[1] || null;

  // Which customer is this? Compare the sender name and short lines (signature block) against master data.
  const candidates = [fromName, ...body.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 70)];
  let customerMatch = null;
  for (const cand of candidates) {
    for (const c of customers) {
      const score = nameScore(cand, c.name);
      if (score >= 0.8 && (!customerMatch || score > customerMatch.score)) {
        customerMatch = { code: c.code, name: c.name, country: c.country, score: Number(score.toFixed(2)) };
      }
    }
  }
  // The organisation name the sender used - the best line that looks like a company / hospital
  const orgLine =
    candidates.find((l) => /\b(hospital|clinic|lab|laborator|medical|centre|center|pte|sdn|bhd|pt\b|co\.|ltd|university|institute|benh vien|rumah sakit)/i.test(l)) || null;

  let domainKey = null;
  if (type === "mdm_setup") {
    domainKey = /\b(vendor|supplier)\b/i.test(text)
      ? "vendor"
      : /\bitem\b/i.test(text)
        ? "item"
        : /\bcost cent(er|re)\b/i.test(text)
          ? "costcenter"
          : "customer";
  }

  let nextAction;
  if (type === "order" || type === "purchase_request") {
    nextAction = customerMatch
      ? {
          kind: type === "order" ? "create_sales_order" : "prepare_quote",
          text: `${type === "order" ? "Create sales order" : "Prepare quotation"} in SAP B1 for ${customerMatch.code} (${customerMatch.name})`,
        }
      : {
          kind: "raise_customer_request",
          text: "Customer is not in master data yet - raise a Customer setup request (pre-filled) before the order can be booked",
        };
  } else if (type === "mdm_setup") {
    nextAction = { kind: "raise_request", text: `Convert into a ${domainKey} setup request` };
  } else {
    nextAction = { kind: "reply", text: "Route to the sales owner to reply - not counted as demand" };
  }

  return {
    type,
    label: LABELS[type],
    confidence: Number(confidence.toFixed(2)),
    scores,
    signals,
    extracted: { product, qty, country, poNumber, organisation: orgLine, customerMatch, domainKey },
    nextAction,
  };
}

module.exports = { classify, LABELS };
