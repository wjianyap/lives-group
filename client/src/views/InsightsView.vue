<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { countryName, productName } from "../store";
import { num, pct, usdK, usdM, monthLabel } from "../utils";
import LineChart from "../components/LineChart.vue";
import Icon from "../components/Icon.vue";

const regional = ref(null);
const ai = ref(null); // forecast + AI commentary from the Python pipeline
const aiError = ref("");
const ins = ref(null);
const pipeline = ref([]);
const recs = ref([]);
const metric = ref("growthYoY");
const sel = ref({ country: null, product: null }); // null = all

onMounted(async () => {
  const [a, b, c, d, e] = await Promise.all([
    api.get("/analytics/regional"),
    api.get("/analytics/ai-forecast").catch((err) => {
      aiError.value = err.message;
      return null;
    }),
    api.get("/analytics/insights"),
    api.get("/analytics/pipeline"),
    api.get("/analytics/recommendations"),
  ]);
  regional.value = a;
  ai.value = b;
  ins.value = c;
  pipeline.value = d;
  recs.value = e;
});

// tiny-volume series (e.g. equipment): percentages are noise, so no colour and an explicit tag
const lowVol = (c, p) => ai.value?.series.find((r) => r.country === c && r.product === p)?.indicativeOnly === true;
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
const FLAT_BAND = 3; // +/- % we call "flat" (same rule the pipeline uses)
const direction = (r) => (r.changePct === null || Math.abs(r.changePct) < FLAT_BAND ? "flat" : r.changePct > 0 ? "up" : "down");
const arrow = { up: "▲ up", down: "▼ down", flat: "● flat" };
const tone = { up: "t-good", down: "t-bad", flat: "t-muted" };
const confTone = { high: "t-good", medium: "t-warn", low: "t-bad" };

const selected = computed(() => {
  if (!ai.value) return null;
  const rows = ai.value.series.filter((s) => (!sel.value.country || s.country === sel.value.country) && (!sel.value.product || s.product === sel.value.product));
  if (!rows.length) return null;
  const months = [...new Set(rows.flatMap((r) => r.historyMonths))].sort();
  const at = (r, i) => r.historyMonths.indexOf(months[i]);
  return {
    title: `${sel.value.country ? countryName(sel.value.country) : "All five countries"} · ${sel.value.product ? productName(sel.value.product) : "Products A–C"}`,
    months,
    future: rows[0].forecastMonths,
    history: months.map((_, i) => sum(rows.map((r) => (at(r, i) >= 0 ? r.history[at(r, i)] : 0)))),
    forecast: rows[0].forecast.map((_, i) => sum(rows.map((r) => r.forecast[i]))),
    baseline: rows[0].baseline.map((_, i) => sum(rows.map((r) => r.baseline[i]))),
    // adding the ranges of several series overstates the width a little (it assumes they all miss together)
    band: rows[0].forecast.map((_, i) => [sum(rows.map((r) => r.low80[i])), sum(rows.map((r) => r.high80[i]))]),
    single: rows.length === 1 ? rows[0] : null,
    rows,
  };
});

const chart = computed(() => {
  const s = selected.value;
  if (!s) return null;
  const n = s.history.length;
  const labels = [...s.months, ...s.future].map(monthLabel);
  const last = s.history[n - 1];
  return {
    labels,
    marker: n - 1,
    series: [
      { label: "Actual orders (units)", color: "#0f766e", values: [...s.history, ...Array(s.future.length).fill(null)] },
      { label: "Self-checking forecast", color: "#6d28d9", values: [...Array(n - 1).fill(null), last, ...s.forecast], band: [...Array(n).fill(null), ...s.band] },
      { label: "6-month average (today's method)", color: "#94a3b8", dashed: true, values: [...Array(n - 1).fill(null), last, ...s.baseline] },
    ],
  };
});

const allSeries = computed(() => ai.value?.series ?? []);
const overall = computed(() => ai.value?.scorecard?.find((r) => r.group === "All series") ?? null);
const sourceLabel = computed(
  () => ({ "claude-pregenerated": "Written by Claude ahead of time", claude: "Live Claude", template: "Template (no AI)" })[ai.value?.commentary?.source] || "Commentary",
);

function choose(c, p) {
  sel.value = { country: c, product: p };
  document.getElementById("trend")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const recIcon = { grow: "trend", fix: "alert", retain: "users", "cross-sell": "sparkle", forecast: "chart", data: "db" };
</script>

<template>
  <div v-if="aiError" class="empty">{{ aiError }}</div>
  <div v-else-if="!regional || !ai || !ins" class="empty">Crunching the numbers…</div>
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
        <div class="value">{{ overall ? overall.oursPct + "%" : "–" }}</div>
        <div class="sub">vs {{ overall ? overall.currentPracticePct + "%" : "–" }} with the 6-month average · last 6 months, unseen when the method was chosen</div>
      </div>
      <div class="card kpi">
        <div class="label">Annual value at risk</div>
        <div class="value">{{ usdK(ins.totals.churnValueAtRisk) }}</div>
        <div class="sub">{{ ins.churn.length }} customers dropping off</div>
      </div>
      <div class="card kpi">
        <div class="label">Cross-sell opportunity (all products)</div>
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
                :style="metric.startsWith('growth') && !lowVol(c.code, p.code) ? heat(cell(c.code, p.code)[metric]) : lowVol(c.code, p.code) ? { opacity: 0.6 } : {}"
                :class="{ on: sel.country === c.code && sel.product === p.code }"
                @click="choose(c.code, p.code)"
              >
                <strong>{{ show(cell(c.code, p.code)) }}</strong>
                <div class="small muted">{{ metric.startsWith("growth") ? `${num(cell(c.code, p.code).units)} u` : pct(cell(c.code, p.code).growthYoY) }}</div>
                <div v-if="lowVol(c.code, p.code)" class="small" style="color: var(--warn)">low volume: indicative</div>
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
            <p>Orders to date, then the next 6 months. The shaded area is the ~80% range{{ selected.single ? '' : ' (summed across series, so slightly wider than the true range)' }}.</p>
          </div>
          <button v-if="sel.country || sel.product" class="btn sm" @click="sel = { country: null, product: null }">Show all</button>
        </div>
        <div class="card-body"><LineChart v-bind="chart" :height="280" /></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>How this forecast was chosen</h3></div>
        <div class="card-body stack small">
          <template v-if="selected.single">
            <div>
              <span class="badge plain" :class="tone[direction(selected.single)]">{{ arrow[direction(selected.single)] }}</span>
              <span class="badge plain" :class="confTone[selected.single.confidence]" style="margin-left: 6px">{{ selected.single.confidence }} confidence</span>
              <span v-if="selected.single.indicativeOnly" class="badge plain t-warn" style="margin-left: 6px">low volume: indicative only</span>
            </div>
            <p>{{ selected.single.reason }}</p>
            <p class="muted">
              Next 6 months: <strong>{{ num(selected.single.unitsNext6) }} units</strong> ({{ pct(selected.single.changePct) }} vs the last 6).
              Today's 6-month average would say {{ num(selected.single.unitsCurrentPractice) }}.
              <span v-if="selected.single.product === 'C'"> Equipment orders are few and lumpy, so the RFQ pipeline is the better lead indicator for Product C.</span>
            </p>
          </template>
          <template v-else>
            <p>
              Every series is tested by replaying history: forecast the next 3 months from many past dates, then compare with what really happened.
              A smarter model is used only if it beats the 6-month average by at least 10% in those tests; otherwise the average is kept.
              The scores below are on the last 6 months, which were hidden when the method was chosen.
            </p>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Group</th><th class="num">6-month avg</th><th class="num">Ours</th><th class="num">No worse</th></tr></thead>
                <tbody>
                  <tr v-for="r in ai.scorecard" :key="r.group">
                    <td>{{ r.group }}</td>
                    <td class="num">{{ r.currentPracticePct }}%</td>
                    <td class="num strong">{{ r.oursPct }}%</td>
                    <td class="num muted">{{ r.noWorse }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="muted">Error = total miss as a share of total units (lower is better). Click a cell or a row to see one series.</p>
          </template>
        </div>
      </div>
    </div>


    <!-- AI outlook: numbers from the statistical forecast, words from Claude, checked in code -->
    <div class="card mt16">
      <div class="card-head" style="flex-wrap: wrap">
        <div>
          <h2>AI outlook &amp; actions</h2>
          <p>{{ ai.commentary.note }}</p>
        </div>
        <span class="badge plain t-accent">{{ sourceLabel }}<template v-if="ai.commentary.generated_on"> · {{ ai.commentary.generated_on }}</template></span>
      </div>
      <div class="card-body stack">
        <p class="strong" style="font-size: 15px">{{ ai.commentary.content.headline }}</p>
        <div class="grid g2">
          <div v-for="a in ai.commentary.content.actions" :key="a.action" class="rec">
            <Icon name="sparkle" :size="20" />
            <div>
              <strong>{{ a.action }}</strong>
              <p class="small muted mt8">{{ a.rationale }}</p>
            </div>
          </div>
        </div>
        <div>
          <h3>Supply checks (precautions, not forecasts)</h3>
          <ul class="small" style="margin: 6px 0; padding-left: 18px">
            <li v-for="n in ai.commentary.content.supply_notes" :key="n">{{ n }}</li>
          </ul>
        </div>
        <p class="small muted">{{ ai.commentary.content.caveats.join(" ") }}</p>
      </div>
    </div>

    <!-- every series with direction, method and confidence -->
    <div class="card mt16">
      <div class="card-head">
        <div>
          <h2>Forecast by country × product</h2>
          <p>Next 6 months vs the last 6 ({{ monthLabel(ai.series[0].forecastMonths[0]) }} – {{ monthLabel(ai.series[0].forecastMonths.at(-1)) }}). Low-volume series are greyed out: their percentages are noise.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Country</th><th>Product</th><th class="num">Last 6 months</th><th class="num">Next 6 months</th><th class="num">Change</th><th>Method</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in allSeries" :key="r.country + r.product" class="cellbtn" :style="r.indicativeOnly ? { opacity: 0.6 } : {}" @click="choose(r.country, r.product)">
              <td class="strong">{{ countryName(r.country) }}</td>
              <td>{{ productName(r.product) }}</td>
              <td class="num">{{ num(r.unitsLast6) }}</td>
              <td class="num strong">{{ num(r.unitsNext6) }}</td>
              <td class="num">
                <span class="badge plain" :class="r.indicativeOnly ? 't-muted' : tone[direction(r)]">{{ r.indicativeOnly ? "indicative" : arrow[direction(r)] }}</span>
                <span class="small muted"> {{ pct(r.changePct) }}</span>
              </td>
              <td class="small">{{ r.method.replace(" (current practice)", "") }}</td>
              <td><span class="badge plain" :class="confTone[r.confidence]">{{ r.confidence }}</span></td>
            </tr>
          </tbody>
        </table>
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
            <p>Peers in the same segment that buy the same products already buy this. The estimate is half of a typical peer's annual spend on it, so customers in one segment share a figure.</p>
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
tr.cellbtn { cursor: pointer; }
tr.cellbtn:hover td { background: var(--brand-50, #f0fdfa); }
</style>
