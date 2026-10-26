// Builds the SAP Business One Service Layer payload for an approved request.
// In production the MDM analyst presses "Post to SAP B1" and this JSON is sent to
//   POST https://<sap-host>:50000/b1s/v1/<sapObject>
// For the prototype we show the exact payload and record the code SAP returns, so nothing is re-keyed by hand.

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  parts.slice(0, -1).forEach((p) => {
    const arr = p.match(/^(\w+)\[(\d+)\]$/);
    if (arr) {
      cur[arr[1]] = cur[arr[1]] || [];
      cur[arr[1]][arr[2]] = cur[arr[1]][arr[2]] || {};
      cur = cur[arr[1]][arr[2]];
    } else {
      cur[p] = cur[p] || {};
      cur = cur[p];
    }
  });
  cur[parts.at(-1)] = value;
}

// values: the full field values (sensitive ones already masked or decrypted, as the viewer is allowed)
exports.buildPayload = function (domain, request, values, code) {
  const payload = {};
  const fixed = {
    customer: { CardType: "cCustomer" },
    vendor: { CardType: "cSupplier" },
    item: { InventoryItem: "tYES", SalesItem: "tYES", PurchaseItem: "tYES" },
  }[domain.key];
  Object.assign(payload, fixed || {});

  const codeField = { BusinessPartners: "CardCode", Items: "ItemCode", ProfitCenters: "CenterCode" }[domain.sapObject] || "Code";
  payload[codeField] = code || `${domain.codePrefix}<assigned on post>`;

  for (const f of domain.fields) {
    const v = values[f.key];
    if (!f.sapField || v === undefined || v === "") continue;
    setPath(payload, f.sapField, f.type === "checkbox" ? (v ? "tYES" : "tNO") : v);
  }
  // User-defined fields that let SAP trace the record back to its approval trail
  payload.U_MDM_RequestRef = request.refNo;
  payload.U_BusinessEntity = request.entity;

  return {
    method: "POST",
    endpoint: `/b1s/v1/${domain.sapObject || "UDO_" + domain.key}`,
    body: payload,
  };
};
