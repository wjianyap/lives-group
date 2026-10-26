<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { countryName, productName } from "../store";
import { num, pct, usdK, usdM, monthLabel } from "../utils";
import LineChart from "../components/LineChart.vue";
import Icon from "../components/Icon.vue";

const regional = ref(null);
const fc = ref(null);
const ins = ref(null);
const pipeline = ref([]);
const recs = ref([]);
const metric = ref("growthYoY");
const sel = ref({ country: null, product: null }); // null = all

onMounted(async () => {
  const [a, b, c, d, e] = await Promise.all([
    api.get("/analytics/regional"),
    api.get("/analytics/forecasts"),
    api.get("/analytics/insights"),
    api.get("/analytics/pipeline"),
    api.get("/analytics/recommendations"),
  ]);
  regional.value = a;
  fc.value = b;
  ins.value = c;
  pipeline.value = d;
  recs.value = e;
});

const cell = (c, p) => regional.value.matrix.find((r) => r.country === c && r.product === p);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function heat(v) {
  if (v === null || v === undefined) return {};
  const a = Math.min(1, Math.abs(v) / 40);
  return v >= 0 ? { background: `rgba(21,128,61,${0.08 + a * 0.32})` } : { background: `rgba(180,35,24,${0.08 + a * 0.32})` };
}
function show(r) {
  if (metric.value === "units") return num(r.units);
  if (metric.value === "valueUsd") return usdK(r.valueUsd);
  return pct(r[metric.value]);
}

// ----- selected series for the chart -----
const selected = computed(() => {
  if (!fc.value) return null;
  const rows = fc.value.series.filter((s) => (!sel.value.country || s.country === sel.value.country) && (!sel.value.product || s.product === sel.value.product));
  const add = (key) => rows[0][key].map((_, i) => sum(rows.map((r) => r[key][i])));
  const single = rows.length === 1 ? rows[0] : null;
  return {
    title: `${sel.value.country ? countryName(sel.value.country) : "All five countries"} · ${sel.value.product ? productName(sel.value.product) : "Products A–C"}`,
    history: add("history"),
    forecast: add("forecast"),
    baseline: add("baselineForecast"),
    band: rows[0].band.map((_, i) => [sum(rows.map((r) => r.band[i][0])), sum(rows.map((r) => r.band[i][1]))]),
    single,
    rows,
  };
});

const chart = computed(() => {
  const s = selected.value;
  if (!s) return null;
  const n = s.history.length;
  const labels = [...fc.value.months, ...fc.value.future].map(monthLabel);
  const pad = (arr, before, after) => [...Array(before).fill(null), ...arr, ...Array(after).fill(null)];
  const last = s.history[n - 1];
  return {
    labels,
    marker: n - 1,
    series: [
      { label: "Actual orders (units)", color: "#0f766e", values: pad(s.history, 0, 6) },
      { label: "Seasonal AI forecast", color: "#6d28d9", values: [...Array(n - 1).fill(null), last, ...s.forecast], band: [...Array(n).fill(null), ...s.band] },
      { label: "6-month average (today's method)", color: "#94a3b8", dashed: true, values: [...Array(n - 1).fill(null), last, ...s.baseline] },
    ],
  };
});

const backtest = computed(() => {
  const s = selected.value;
  if (!s?.single) return null;
  const f = s.single;
  const months = fc.value.holdoutMonths.map(monthLabel);
  return { f, months };
});

const winners = computed(() => {
  if (!fc.value) return {};
  const out = { hw: 0, ma6: 0, ma12: 0 };
  for (const s of fc.value.series) out[s.best]++;
  return out;
});

function choose(c, p) {
  sel.value = { country: c, product: p };
  document.getElementById("trend")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const recIcon = { grow: "trend", fix: "alert", retain: "users", "cross-sell": "sparkle", forecast: "chart", data: "db" };
</script>

<template>
  <div v-if="!regional || !fc || !ins" class="empty">Crunching the numbers…</div>
  <template v-else>
    <div class="page-head">
      <div>
        <h1>Regional business view</h1>
        <p>
          Customer purchase orders for Products A, B and C across five countries,
          <strong>{{ monthLabel(regional.period.from) }} {{ regional.period.from.slice(0, 4) }} – {{ monthLabel(regional.period.to) }} {{ regional.period.to.slice(0, 4) }}</strong> (12 months), with a 6-month forecast.
        </p>
      </div>
      <span class="badge t-muted plain">Synthetic demo data</span>
    </div>

    <div class="card card-pad defs">
      <div><strong>Volume</strong> – {{ regional.measure.volume }}</div>
      <div><strong>Growth</strong> – {{ regional.measure.growth }}</div>
      <div><strong>Momentum</strong> – {{ regional.measure.momentum }}</div>
      <div><strong>Customers</strong> – duplicate customer records that MDM has merged are counted once ({{ ins.totals.rawCustomerRecords }} records → {{ ins.totals.activeCustomers }} active customers).</div>
    </div>

    <div class="grid g5 mt16">
      <div class="card kpi">
        <div class="label">Order value, 12 months</div>
        <div class="value">{{ usdM(regional.regionTotal.valueUsd) }}</div>
        <div class="sub">{{ num(regional.regionTotal.units) }} units</div>
      </div>
      <div class="card kpi">
        <div class="label">Regional growth (YoY units)</div>
        <div class="value">{{ pct(regional.regionTotal.growthYoY) }}</div>
        <div class="sub" :class="regional.regionTotal.growthRecent >= 0 ? 'good' : 'bad'">last 6 months {{ pct(regional.regionTotal.growthRecent) }}</div>
      </div>
      <div class="card kpi">
        <div class="label">Forecast error (back-test)</div>
        <div class="value">{{ fc.summary.modelMape }}%</div>
        <div class="sub good">vs {{ fc.summary.baselineMape }}% with the 6-month average</div>
      </div>
      <div class="card kpi">
        <div class="label">Annual value at risk</div>
        <div class="value">{{ usdK(ins.totals.churnValueAtRisk) }}</div>
        <div class="sub">{{ ins.churn.length }} customers dropping off</div>
      </div>
      <div class="card kpi">
        <div class="label">Cross-sell opportunity</div>
        <div class="value">{{ usdK(ins.totals.crossSellValue) }}</div>
        <div class="sub">per year, conservative</div>
      </div>
    </div>

    <!-- country x product -->
    <div class="card mt16">
      <div class="card-head" style="flex-wrap: wrap">
        <div>
          <h2>Country × product</h2>
          <p>Click a cell to see its trend and forecast.</p>
        </div>
        <div class="seg">
          <button :class="{ active: metric === 'growthYoY' }" @click="metric = 'growthYoY'">YoY growth</button>
          <button :class="{ active: metric === 'growthRecent' }" @click="metric = 'growthRecent'">Last 6 months</button>
          <button :class="{ active: metric === 'units' }" @click="metric = 'units'">Units</button>
          <button :class="{ active: metric === 'valueUsd' }" @click="metric = 'valueUsd'">Value</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th>Country</th>
              <th v-for="p in regional.products" :key="p.code" class="num">{{ p.name }}<div class="muted small" style="font-weight: 400">{{ p.description }}</div></th>
              <th class="num">All products</th>
              <th style="width: 180px">Monthly units</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in regional.countries" :key="c.code">
              <td class="strong">{{ c.name }}</td>
              <td
                v-for="p in regional.products"
                :key="p.code"
                class="num cellbtn"
                :style="metric.startsWith('growth') ? heat(cell(c.code, p.code)[metric]) : {}"
                :class="{ on: sel.country === c.code && sel.product === p.code }"
                @click="choose(c.code, p.code)"
              >
                <strong>{{ show(cell(c.code, p.code)) }}</strong>
                <div class="small muted">{{ metric.startsWith("growth") ? `${num(cell(c.code, p.code).units)} u` : pct(cell(c.code, p.code).growthYoY) }}</div>
              </td>
              <td class="num cellbtn" :style="metric.startsWith('growth') ? heat(regional.byCountry[c.code][metric]) : {}" @click="choose(c.code, null)">
                <strong>{{ show(regional.byCountry[c.code]) }}</strong>
              </td>
              <td>
                <svg viewBox="0 0 120 28" class="spark">
                  <polyline
                    fill="none"
                    stroke="#0f766e"
                    stroke-width="1.6"
                    :points="regional.byCountry[c.code].monthly.map((v, i, a) => `${(i / (a.length - 1)) * 118 + 1},${27 - (v / Math.max(...a)) * 25}`).join(' ')"
                  />
                </svg>
              </td>
            </tr>
            <tr class="total">
              <td class="strong">Region</td>
              <td v-for="p in regional.products" :key="p.code" class="num cellbtn" :style="metric.startsWith('growth') ? heat(regional.byProduct[p.code][metric]) : {}" @click="choose(null, p.code)">
                <strong>{{ show(regional.byProduct[p.code]) }}</strong>
              </td>
              <td class="num cellbtn" @click="choose(null, null)"><strong>{{ show(regional.regionTotal) }}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- trend + forecast -->
    <div id="trend" class="split mt16">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>{{ selected.title }}</h2>
            <p>24 months of orders, then the next 6 months. The shaded area is the ~80% range.</p>
          </div>
          <button v-if="sel.country || sel.product" class="btn sm" @click="sel = { country: null, product: null }">Show all</button>
        </div>
        <div class="card-body"><LineChart v-bind="chart" :height="280" /></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>How the forecast is chosen</h3></div>
        <div class="card-body stack small">
          <p>
            For every country × product, three methods are trained on months 1–18 and tested on the last 6 months they never saw.
            The most accurate one is used for the real forecast, and this re-runs every month as SAP B1 order history comes in.
          </p>
          <div v-if="backtest" class="table-wrap">
            <table>
              <thead><tr><th>Method</th><th class="num">Error (MAPE)</th></tr></thead>
              <tbody>
                <tr v-for="(m, k) in backtest.f.methods" :key="k" :class="{ best: k === backtest.f.best }">
                  <td>{{ m.label }} <span v-if="k === backtest.f.best" class="badge plain t-good">chosen</span></td>
                  <td class="num">{{ m.mape }}%</td>
                </tr>
              </tbody>
            </table>
            <p class="muted mt8">
              Next 6 months: <strong>{{ num(backtest.f.nextHalfUnits) }} units</strong> ({{ pct(backtest.f.outlookPct) }} vs the last 6).
              <span v-if="backtest.f.product === 'C'"> Equipment orders are few and lumpy, so for Product C the RFQ pipeline is the better lead indicator.</span>
            </p>
          </div>
          <div v-else>
            <p>Across all 15 country × product series:</p>
            <ul style="margin: 6px 0; padding-left: 18px">
              <li>Seasonal model (Holt-Winters) chosen for <strong>{{ winners.hw }}</strong></li>
              <li>6-month average for <strong>{{ winners.ma6 }}</strong>, 12-month average for <strong>{{ winners.ma12 }}</strong> (flat, stable demand)</li>
            </ul>
            <p>Volume-weighted error falls from <strong>{{ fc.summary.baselineMape }}%</strong> to <strong>{{ fc.summary.modelMape }}%</strong>. Click a cell to see one series.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- recommendations -->
    <div class="card mt16">
      <div class="card-head">
        <div>
          <h2>Recommended actions</h2>
          <p>Generated from the numbers on this page</p>
        </div>
      </div>
      <div class="card-body grid g2">
        <div v-for="r in recs" :key="r.title" class="rec">
          <Icon :name="recIcon[r.kind] || 'sparkle'" :size="20" />
          <div>
            <strong>{{ r.title }}</strong>
            <p class="small muted mt8">{{ r.detail }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid g2 mt16">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Customers dropping off</h2>
            <p>Reagent and consumable orders in the last 3 months vs the 6 before</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th class="num">Drop</th><th class="num">Value at risk / yr</th><th>Suggested action</th></tr></thead>
            <tbody>
              <tr v-for="c in ins.churn" :key="c.code">
                <td><strong>{{ c.name }}</strong><div class="small muted">{{ countryName(c.country) }} · {{ c.segment }} · {{ c.code }}</div></td>
                <td class="num"><span class="badge plain t-bad">−{{ c.dropPct }}%</span><div v-if="c.monthsSinceLastOrder >= 2" class="small muted">no order {{ c.monthsSinceLastOrder }} mo</div></td>
                <td class="num strong">{{ usdK(c.annualValueAtRisk) }}</td>
                <td class="small">{{ c.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Cross-sell: next product to offer</h2>
            <p>Peers in the same segment that buy the same products already buy this</p>
          </div>
        </div>
        <div class="table-wrap" style="max-height: 420px; overflow: auto">
          <table>
            <thead><tr><th>Customer</th><th>Buys</th><th>Offer</th><th class="num">Peers</th><th class="num">Est. / yr</th></tr></thead>
            <tbody>
              <tr v-for="c in ins.crossSell" :key="c.code + c.suggest">
                <td>
                  <strong>{{ c.name }}</strong>
                  <div class="small muted">{{ countryName(c.country) }} · {{ c.segment }}</div>
                  <div v-if="c.possibleDuplicateOf" class="small" style="color: var(--warn)">⚠ may be a duplicate of {{ c.possibleDuplicateOf.name }}: merge first</div>
                </td>
                <td><span v-for="p in c.has" :key="p" class="chip" style="margin-right: 3px">{{ p }}</span></td>
                <td><span class="badge t-accent">Product {{ c.suggest }}</span></td>
                <td class="num">{{ c.peerAdoptionPct }}% of {{ c.peers }}</td>
                <td class="num strong">{{ usdK(c.estAnnualValue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head">
        <div>
          <h2>Demand vs. everything else (last 12 months)</h2>
          <p>Only confirmed orders count as demand. RFQs are pipeline, enquiries are noise, and MDM setup requests are tracked separately in the portal.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Country</th>
              <th class="num">Customer orders</th>
              <th class="num">Order value</th>
              <th class="num">Purchase requests / RFQs</th>
              <th class="num">RFQ value (pipeline)</th>
              <th class="num">General enquiries</th>
              <th class="num">MDM requests open / done</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pipeline" :key="p.country">
              <td class="strong">{{ countryName(p.country) }}</td>
              <td class="num">{{ num(p.orders.count) }}</td>
              <td class="num">{{ usdK(p.orders.valueUsd) }}</td>
              <td class="num">{{ num(p.purchaseRequests.count) }}</td>
              <td class="num">{{ usdK(p.purchaseRequests.valueUsd) }}</td>
              <td class="num muted">{{ num(p.enquiries.count) }}</td>
              <td class="num">{{ p.mdmOpen }} / {{ p.mdmDone }} <span v-if="p.openCustomerSetups" class="badge plain t-warn">{{ p.openCustomerSetups }} new customer pending</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
.defs { display: grid; gap: 6px; font-size: 13px; color: var(--ink-2); }
.matrix td.cellbtn { cursor: pointer; transition: outline 0.1s; }
.matrix td.cellbtn:hover { outline: 2px solid var(--brand-100); outline-offset: -2px; }
.matrix td.on { outline: 2px solid var(--brand); outline-offset: -2px; }
.matrix tr.total td { background: #fafbfc; border-top: 1px solid var(--line); }
.spark { width: 160px; height: 28px; display: block; }
.rec { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; }
.rec svg { color: var(--brand); flex: none; margin-top: 2px; }
tr.best td { background: var(--good-bg); }
</style>
