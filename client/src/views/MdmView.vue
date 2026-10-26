<script setup>
import { ref, onMounted, watch } from "vue";
import { api } from "../api";
import { toast, countryName } from "../store";
import RequestTable from "../components/RequestTable.vue";
import Icon from "../components/Icon.vue";

const ready = ref([]);
const open = ref([]);
const pairs = ref([]);
const records = ref([]);
const domain = ref("customer");
const q = ref("");
const reminderResult = ref(null);

async function load() {
  const [a, p, s] = await Promise.all([
    api.get("/requests?scope=mdm&status=approved"),
    api.get("/requests?scope=mdm&status=pending,changes_requested"),
    api.get("/master/scan?domain=customer"),
  ]);
  ready.value = a;
  open.value = p.sort((x, y) => Number(y.overdue) - Number(x.overdue));
  pairs.value = s;
  loadRecords();
}
async function loadRecords() {
  const params = new URLSearchParams({ domain: domain.value });
  if (q.value) params.set("q", q.value);
  records.value = await api.get(`/master?${params}`);
}
let t;
watch(domain, loadRecords);
watch(q, () => {
  clearTimeout(t);
  t = setTimeout(loadRecords, 250);
});
onMounted(load);

async function runReminders() {
  reminderResult.value = await api.post("/requests/reminders/run");
  toast(`${reminderResult.value.reminders} reminders, ${reminderResult.value.escalations} escalations sent`);
  load();
}

async function merge(from, into) {
  await api.post("/master/merge", { from: from.code, into: into.code });
  toast(`${from.code} merged into ${into.code}; regional reporting now counts them as one customer`);
  load();
}
async function unmerge(code) {
  await api.post("/master/unmerge", { code });
  loadRecords();
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>MDM workbench</h1>
      <p>Priya's view: what is ready for SAP B1, what is stuck, and where the master data itself needs cleaning.</p>
    </div>
    <button class="btn" @click="runReminders"><Icon name="bell" :size="16" />Run SLA reminders now</button>
  </div>

  <div class="stack">
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Ready to create in SAP B1 ({{ ready.length }})</h2>
          <p>All approvals complete. Open one to check the payload and post it.</p>
        </div>
      </div>
      <RequestTable :rows="ready" show-requester empty="Nothing waiting. Nice." />
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>SLA watch ({{ open.filter((r) => r.overdue).length }} overdue)</h2>
          <p>Approvers get a reminder at 50% of the SLA; at 100% the MDM team and admins are alerted. This runs automatically every 10 minutes.</p>
        </div>
      </div>
      <RequestTable :rows="open" show-requester empty="No open approvals" />
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>Data health: possible duplicate customers already in SAP B1</h2>
          <p>Found by fuzzy name matching across SPD, QTS and QTG. Each pair splits one customer's purchase history and distorts the regional view until it is merged.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Match</th><th>Record A</th><th>Record B</th><th>Country</th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in pairs" :key="p.a.code + p.b.code">
              <td><span class="badge plain" :class="p.score >= 0.92 ? 't-bad' : 't-warn'">{{ Math.round(p.score * 100) }}%</span></td>
              <td><strong>{{ p.a.name }}</strong><div class="small muted">{{ p.a.code }} · {{ p.a.entity }}</div></td>
              <td><strong>{{ p.b.name }}</strong><div class="small muted">{{ p.b.code }} · {{ p.b.entity }}</div></td>
              <td>{{ countryName(p.a.country) }}</td>
              <td class="right nowrap">
                <button class="btn sm" @click="merge(p.b, p.a)"><Icon name="merge" :size="14" />Merge B into A</button>
              </td>
            </tr>
            <tr v-if="!pairs.length"><td colspan="5" class="empty">No suspected duplicates</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head" style="flex-wrap: wrap">
        <h2>Master records</h2>
        <div class="row">
          <input v-model="q" class="input" style="width: 220px" placeholder="Search name" />
          <select v-model="domain" class="input" style="width: 160px">
            <option value="customer">Customers</option>
            <option value="vendor">Vendors</option>
            <option value="item">Items</option>
            <option value="costcenter">Cost centers</option>
          </select>
        </div>
      </div>
      <div class="table-wrap" style="max-height: 420px; overflow: auto">
        <table>
          <thead><tr><th>SAP code</th><th>Name</th><th>Entity</th><th>Country</th><th>Origin</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in records" :key="m._id">
              <td><code>{{ m.code }}</code></td>
              <td>{{ m.name }} <span v-if="m.mergedInto" class="badge plain t-muted">merged → {{ m.mergedInto }}</span></td>
              <td>{{ m.entity }}</td>
              <td>{{ countryName(m.country) }}</td>
              <td class="small muted">{{ m.createdFromRequest ? `Portal ${m.createdFromRequest}` : "Legacy (email era)" }}</td>
              <td class="right"><button v-if="m.mergedInto" class="btn ghost sm" @click="unmerge(m.code)">Undo merge</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
