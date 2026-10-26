<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { store, toast } from "../store";
import { describeRule } from "../utils";
import Icon from "../components/Icon.vue";

const domains = ref([]);
const current = ref(null); // working copy being edited
const isNew = ref(false);
const saving = ref(false);
const problems = ref([]);

const FIELD_TYPES = ["text", "textarea", "number", "select", "email", "date", "checkbox", "country"];
const OPS = [
  ["eq", "is"],
  ["neq", "is not"],
  ["gt", ">"],
  ["lt", "<"],
  ["truthy", "is filled in"],
];

async function load(keep) {
  domains.value = await api.get("/domains?all=1");
  if (keep) edit(domains.value.find((d) => d.key === keep));
}
onMounted(() => load());

function edit(d) {
  isNew.value = false;
  problems.value = [];
  current.value = JSON.parse(JSON.stringify(d));
  for (const f of current.value.fields) f.optionsText = (f.options || []).join(", ");
}

function startNew() {
  isNew.value = true;
  problems.value = [];
  current.value = {
    key: "",
    name: "",
    description: "",
    icon: "box",
    sapObject: "",
    codePrefix: "X",
    active: true,
    fields: [{ key: "recordName", label: "Name", type: "text", section: "Details", required: true, dedupe: "name", optionsText: "" }],
    steps: [{ key: "bu", label: "Business Unit Head", function: "BU_HEAD", stage: 1, entityScoped: true, slaHours: 24 }],
  };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w, i) => (i ? w[0]?.toUpperCase() + w.slice(1) : w)).join("");

function addField() {
  current.value.fields.push({ key: "", label: "", type: "text", section: current.value.fields.at(-1)?.section || "Details", required: false, optionsText: "" });
}
function addStep() {
  const maxStage = Math.max(1, ...current.value.steps.map((s) => s.stage || 1));
  current.value.steps.push({ key: `step${current.value.steps.length + 1}`, label: "", function: "FINANCE", stage: maxStage + 1, slaHours: 48 });
}
function move(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
function toggleRule(obj, prop) {
  obj[prop] = obj[prop]?.field ? null : { field: current.value.fields[0]?.key, op: "eq", value: true };
}

const stages = computed(() => {
  if (!current.value) return [];
  const by = {};
  for (const s of current.value.steps) (by[s.stage || 1] ||= []).push(s);
  return Object.entries(by).sort((a, b) => a[0] - b[0]);
});

function cleanValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  return v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
}

async function save() {
  saving.value = true;
  problems.value = [];
  const body = JSON.parse(JSON.stringify(current.value));
  for (const f of body.fields) {
    if (!f.key) f.key = slug(f.label || "field");
    f.options = f.type === "select" ? String(f.optionsText || "").split(",").map((s) => s.trim()).filter(Boolean) : [];
    delete f.optionsText;
    if (f.showWhen?.field) f.showWhen.value = cleanValue(f.showWhen.value);
    else delete f.showWhen;
    if (!f.dedupe) f.dedupe = null;
  }
  for (const s of body.steps) {
    s.stage = Number(s.stage) || 1;
    s.slaHours = Number(s.slaHours) || 48;
    if (s.when?.field) s.when.value = cleanValue(s.when.value);
    else delete s.when;
  }
  try {
    if (isNew.value) {
      body.key = body.key || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await api.post("/domains", body);
      toast(`“${body.name}” is live: requestors can use it now`);
    } else {
      const saved = await api.put(`/domains/${body.key}`, body);
      toast(`Saved as version ${saved.version}. Requests already in flight keep their original route.`);
    }
    await load(body.key);
  } catch (e) {
    problems.value = e.data?.problems || [e.message];
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Request types</h1>
      <p>
        Forms, required fields and approval chains are configuration, not code. The MDM team can add a business unit's approval step,
        a new regulatory field, or a whole new data domain here, with no IT ticket.
      </p>
    </div>
    <button class="btn primary" @click="startNew"><Icon name="plus" :size="16" />New request type</button>
  </div>

  <div class="layout">
    <div class="card list">
      <button v-for="d in domains" :key="d.key" class="item" :class="{ on: current?.key === d.key && !isNew }" @click="edit(d)">
        <Icon :name="d.icon" />
        <div>
          <strong>{{ d.name }}</strong>
          <div class="small muted">{{ d.fields.length }} fields · {{ d.steps.length }} steps · v{{ d.version }}</div>
        </div>
        <span v-if="!d.active" class="badge plain t-muted">off</span>
      </button>
    </div>

    <div v-if="!current" class="card empty">Pick a request type to edit, or create a new one.</div>
    <div v-else class="stack">
      <div class="card">
        <div class="card-head">
          <h2>{{ isNew ? "New request type" : current.name }}</h2>
          <div class="row">
            <label class="check"><input v-model="current.active" type="checkbox" /> Available to requestors</label>
            <button class="btn primary" :disabled="saving" @click="save">{{ isNew ? "Create" : "Save changes" }}</button>
          </div>
        </div>
        <div class="card-body form-grid">
          <div class="field"><label>Name</label><input v-model="current.name" class="input" placeholder="e.g. Service Contract" /></div>
          <div class="field"><label>SAP B1 object</label><input v-model="current.sapObject" class="input" placeholder="e.g. BusinessPartners, Items" /></div>
          <div class="field wide"><label>Description</label><input v-model="current.description" class="input" /></div>
          <div class="field"><label>SAP code prefix</label><input v-model="current.codePrefix" class="input" style="width: 100px" /></div>
          <div class="field">
            <label>Icon</label>
            <select v-model="current.icon" class="input">
              <option v-for="i in ['box', 'hospital', 'truck', 'calculator', 'shield', 'users', 'db']" :key="i" :value="i">{{ i }}</option>
            </select>
          </div>
        </div>
        <div v-if="problems.length" class="card-body" style="padding-top: 0">
          <div class="callout bad"><div><div v-for="p in problems" :key="p">{{ p }}</div></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h2>Form fields</h2>
            <p>Required fields are enforced in the browser and on the server. “Show when” fields are only asked (and only required) when relevant.</p>
          </div>
          <button class="btn sm" @click="addField"><Icon name="plus" :size="14" />Field</button>
        </div>
        <div class="table-wrap">
          <table class="cfg">
            <thead>
              <tr><th></th><th>Label</th><th>Type</th><th>Section</th><th>Req.</th><th>Sensitive</th><th>Duplicate check</th><th>Options / rule</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in current.fields" :key="i">
                <td class="nowrap">
                  <button class="btn ghost sm" title="Up" @click="move(current.fields, i, -1)"><Icon name="up" :size="14" /></button>
                  <button class="btn ghost sm" title="Down" @click="move(current.fields, i, 1)"><Icon name="down" :size="14" /></button>
                </td>
                <td>
                  <input v-model="f.label" class="input" placeholder="Label" @blur="!f.key && f.label && (f.key = slug(f.label))" />
                  <div class="small muted">key: {{ f.key || "(auto)" }}</div>
                </td>
                <td>
                  <select v-model="f.type" class="input"><option v-for="t in FIELD_TYPES" :key="t">{{ t }}</option></select>
                </td>
                <td><input v-model="f.section" class="input" /></td>
                <td class="center"><input v-model="f.required" type="checkbox" /></td>
                <td class="center"><input v-model="f.sensitive" type="checkbox" /></td>
                <td>
                  <select v-model="f.dedupe" class="input">
                    <option :value="null">—</option>
                    <option value="name">record name</option>
                    <option value="identifier">unique ID</option>
                    <option value="email">email</option>
                    <option value="phone">phone</option>
                  </select>
                </td>
                <td style="min-width: 260px">
                  <input v-if="f.type === 'select'" v-model="f.optionsText" class="input" placeholder="Option 1, Option 2" />
                  <div class="rule">
                    <button class="btn ghost sm" @click="toggleRule(f, 'showWhen')">{{ f.showWhen?.field ? "✕ rule" : "+ show when…" }}</button>
                    <template v-if="f.showWhen?.field">
                      <select v-model="f.showWhen.field" class="input"><option v-for="o in current.fields.filter((x) => x !== f)" :key="o.key" :value="o.key">{{ o.label }}</option></select>
                      <select v-model="f.showWhen.op" class="input"><option v-for="[v, l] in OPS" :key="v" :value="v">{{ l }}</option></select>
                      <input v-if="f.showWhen.op !== 'truthy'" v-model="f.showWhen.value" class="input" />
                    </template>
                  </div>
                </td>
                <td><button class="btn ghost sm" title="Remove" @click="current.fields.splice(i, 1)"><Icon name="trash" :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h2>Approval chain</h2>
            <p>Steps with the same stage number run in parallel. A condition adds a step only when it applies. Example: QRA only for medical devices.</p>
          </div>
          <button class="btn sm" @click="addStep"><Icon name="plus" :size="14" />Step</button>
        </div>
        <div class="table-wrap">
          <table class="cfg">
            <thead><tr><th>Stage</th><th>Step name</th><th>Approver group</th><th>Own entity only</th><th>SLA (h)</th><th>Only when</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in current.steps" :key="i">
                <td><input v-model.number="s.stage" type="number" min="1" class="input" style="width: 64px" /></td>
                <td><input v-model="s.label" class="input" /><input v-model="s.checks" class="input mt8 small" placeholder="What does this approver check?" /></td>
                <td>
                  <select v-model="s.function" class="input"><option v-for="f in store.meta.functions" :key="f.code" :value="f.code">{{ f.name }}</option></select>
                </td>
                <td class="center"><input v-model="s.entityScoped" type="checkbox" /></td>
                <td><input v-model.number="s.slaHours" type="number" min="1" class="input" style="width: 76px" /></td>
                <td style="min-width: 260px">
                  <div class="rule">
                    <button class="btn ghost sm" @click="toggleRule(s, 'when')">{{ s.when?.field ? "✕ condition" : "+ only when…" }}</button>
                    <template v-if="s.when?.field">
                      <select v-model="s.when.field" class="input"><option v-for="o in current.fields" :key="o.key" :value="o.key">{{ o.label }}</option></select>
                      <select v-model="s.when.op" class="input"><option v-for="[v, l] in OPS" :key="v" :value="v">{{ l }}</option></select>
                      <input v-if="s.when.op !== 'truthy'" v-model="s.when.value" class="input" />
                    </template>
                  </div>
                </td>
                <td><button class="btn ghost sm" title="Remove" @click="current.steps.splice(i, 1)"><Icon name="trash" :size="14" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body">
          <div class="small strong muted">Preview</div>
          <div class="flow mt8">
            <span class="chip">Requestor</span>
            <template v-for="[n, steps] in stages" :key="n">
              <Icon name="arrow" :size="14" />
              <div class="flow-stage">
                <span v-for="s in steps" :key="s.key" class="chip" :title="s.when ? `Only when ${describeRule(s.when, current.fields)}` : ''">{{ s.label || "?" }}{{ s.when?.field ? " *" : "" }}</span>
              </div>
            </template>
            <Icon name="arrow" :size="14" />
            <span class="chip">MDM → SAP B1</span>
          </div>
          <p class="small muted mt8">* conditional step</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
.item { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; border: none; border-bottom: 1px solid var(--line-2); padding: 12px 14px; background: #fff; font: inherit; cursor: pointer; }
.item:hover { background: #f8fafb; }
.item.on { background: var(--brand-50); box-shadow: inset 3px 0 0 var(--brand); }
.item svg { color: var(--brand); }
.cfg td { padding: 8px 8px; vertical-align: top; }
.cfg .input { height: 34px; }
.cfg .center { text-align: center; padding-top: 16px; }
.rule { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
.rule .input { width: auto; min-width: 90px; flex: 1; }
.flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.flow-stage { display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
