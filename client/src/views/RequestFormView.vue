<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { store, toast, functionName } from "../store";
import { isTrue, describeRule } from "../utils";
import FieldInput from "../components/FieldInput.vue";
import StatusBadge from "../components/StatusBadge.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const domains = ref([]);
const domain = ref(null);
const existing = ref(null); // when editing
const data = ref({});
const masks = ref({});
const entity = ref(store.user.entities?.[0] || "");
const touched = ref({});
const tried = ref(false);
const serverErrors = ref({});
const busy = ref(false);
const dupes = ref([]);
const checking = ref(false);
const dupModal = ref(null);
const overrideReason = ref("");

onMounted(async () => {
  domains.value = await api.get("/domains");
  if (route.params.id) {
    const r = await api.get(`/requests/${route.params.id}`);
    existing.value = r;
    domain.value = r.domain;
    entity.value = r.entity;
    const values = { ...r.values };
    for (const f of r.domain.fields.filter((x) => x.sensitive)) {
      if (values[f.key]) masks.value[f.key] = values[f.key];
      values[f.key] = "";
    }
    data.value = values;
    checkDuplicates();
  } else if (route.params.domain) {
    pick(domains.value.find((d) => d.key === route.params.domain));
  }
});

function pick(d) {
  if (!d) return;
  domain.value = d;
  data.value = {};
  touched.value = {};
  tried.value = false;
  dupes.value = [];
  if (route.params.domain !== d.key) router.replace(`/requests/new/${d.key}`);
}

const visible = computed(() => (domain.value ? domain.value.fields.filter((f) => isTrue(f.showWhen, data.value)) : []));
const sections = computed(() => {
  const out = [];
  for (const f of visible.value) {
    let s = out.find((x) => x.name === f.section);
    if (!s) out.push((s = { name: f.section || "Details", fields: [] }));
    s.fields.push(f);
  }
  return out;
});

const filled = (f) => {
  const v = data.value[f.key];
  if (f.type === "checkbox") return v === true;
  return (v !== undefined && v !== null && v !== "") || !!masks.value[f.key];
};

function errorFor(f) {
  if (serverErrors.value[f.key]) return serverErrors.value[f.key];
  if (!tried.value && !touched.value[f.key]) return "";
  const v = data.value[f.key];
  if (f.required && !filled(f)) return `${f.label} is required`;
  if (v === undefined || v === "" || v === null) return "";
  if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) return "Enter a valid email";
  if (f.type === "number" && f.min !== undefined && f.min !== null && Number(v) < f.min) return `Must be at least ${f.min}`;
  if (f.pattern && !new RegExp(f.pattern).test(String(v))) return f.help || "Format is not valid";
  return "";
}

const required = computed(() => visible.value.filter((f) => f.required));
const completeness = computed(() => (required.value.length ? required.value.filter(filled).length / required.value.length : 1));
const errorCount = computed(() => visible.value.filter((f) => errorFor(f)).length);

// ---- approval route preview (same rules the server will apply) ----
const route_ = computed(() => {
  if (!domain.value) return [];
  const steps = domain.value.steps.filter((s) => isTrue(s.when, data.value));
  const stages = [...new Set(steps.map((s) => s.stage || 1))].sort((a, b) => a - b);
  return stages.map((st, i) => ({ n: i + 1, steps: steps.filter((s) => (s.stage || 1) === st) }));
});
const skipped = computed(() => (domain.value ? domain.value.steps.filter((s) => !isTrue(s.when, data.value)) : []));
const parallelHours = computed(() => route_.value.reduce((t, st) => t + Math.max(...st.steps.map((s) => s.slaHours || 48)), 0));
const serialHours = computed(() => route_.value.reduce((t, st) => t + st.steps.reduce((a, s) => a + (s.slaHours || 48), 0), 0));

// ---- live duplicate check ----
let timer;
const dedupeKeys = computed(() => (domain.value ? domain.value.fields.filter((f) => f.dedupe).map((f) => f.key) : []));
watch(
  () => dedupeKeys.value.map((k) => data.value[k]).join("|"),
  () => {
    clearTimeout(timer);
    timer = setTimeout(checkDuplicates, 400);
  },
);
async function checkDuplicates() {
  if (!domain.value) return;
  const probe = Object.fromEntries(dedupeKeys.value.map((k) => [k, data.value[k]]));
  if (!Object.values(probe).some((v) => v && String(v).length >= 3)) return (dupes.value = []);
  checking.value = true;
  try {
    dupes.value = await api.post("/duplicates/check", { domainKey: domain.value.key, data: probe, excludeRequestId: existing.value?._id });
  } finally {
    checking.value = false;
  }
}

async function save(submit) {
  tried.value = submit;
  serverErrors.value = {};
  if (submit && errorCount.value) {
    toast("Please fix the highlighted fields", "bad");
    document.querySelector(".input.invalid")?.focus();
    return;
  }
  busy.value = true;
  const body = {
    domainKey: domain.value.key,
    entity: entity.value,
    country: data.value.country,
    data: data.value,
    submit,
    duplicateOverrideReason: overrideReason.value || undefined,
  };
  try {
    const res = existing.value ? await api.put(`/requests/${existing.value._id}`, body) : await api.post("/requests", body);
    dupModal.value = null;
    toast(submit ? `${res.refNo} submitted; approvers have been notified` : `Draft ${res.refNo} saved`);
    router.push(`/requests/${res._id}`);
  } catch (e) {
    if (e.status === 409 && e.data?.duplicates) {
      dupModal.value = e.data;
      dupes.value = e.data.duplicates;
    } else if (e.status === 422 && e.data?.errors) {
      serverErrors.value = e.data.errors;
      toast(e.message, "bad");
    } else toast(e.message, "bad");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- step 1: choose a type -->
  <template v-if="!domain">
    <div class="page-head">
      <div>
        <h1>New request</h1>
        <p>Pick what you need set up. The form changes to ask only for what that record needs, and the approval route is worked out for you.</p>
      </div>
    </div>
    <div class="grid g2">
      <button v-for="d in domains" :key="d.key" class="card pick" @click="pick(d)">
        <Icon :name="d.icon" :size="28" />
        <div>
          <h2>{{ d.name }}</h2>
          <p class="muted">{{ d.description }}</p>
          <p class="small mt8">{{ d.fields.length }} fields · {{ d.steps.length }} possible approvals</p>
        </div>
      </button>
    </div>
  </template>

  <!-- step 2: the form -->
  <template v-else>
    <div class="page-head">
      <div>
        <div class="row">
          <h1>{{ existing ? `Edit ${existing.refNo}` : `New ${domain.name.toLowerCase()} request` }}</h1>
          <StatusBadge v-if="existing" :status="existing.status" />
        </div>
        <p>{{ domain.description }}</p>
      </div>
      <button v-if="!existing" class="btn ghost" @click="domain = null; router.replace('/requests/new')">Change type</button>
    </div>

    <div v-if="existing?.status === 'changes_requested'" class="callout warn" style="margin-bottom: 16px">
      <Icon name="alert" />
      <div>
        <strong>Changes requested</strong>
        <div v-for="a in existing.approvals.filter((x) => x.status === 'changes_requested')" :key="a.key">{{ a.label }}: “{{ a.comment }}”</div>
        <div class="small">Approvals already given stay in place when you resubmit.</div>
      </div>
    </div>

    <div class="split">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Ownership</h2></div>
          <div class="card-body form-grid">
            <div class="field">
              <label>Business entity<span class="req">*</span></label>
              <select v-model="entity" class="input" :class="{ invalid: tried && !entity }">
                <option value="" disabled>Choose…</option>
                <option v-for="e in store.meta.entities" :key="e.code" :value="e.code">{{ e.name }}</option>
              </select>
              <span class="help">The Business Unit Head of this entity approves</span>
            </div>
            <div class="field">
              <label>Requested by</label>
              <input class="input" :value="`${store.user.name} – ${store.user.title}`" disabled />
            </div>
          </div>
        </div>

        <div v-for="s in sections" :key="s.name" class="card">
          <div class="card-head"><h2>{{ s.name }}</h2></div>
          <div class="card-body form-grid">
            <FieldInput
              v-for="f in s.fields"
              :key="f.key"
              v-model="data[f.key]"
              :field="f"
              :error="errorFor(f)"
              :saved-mask="masks[f.key]"
              @blur="touched[f.key] = true"
            />
          </div>
        </div>

        <div class="row" style="justify-content: flex-end">
          <button class="btn" :disabled="busy" @click="save(false)">Save draft</button>
          <button class="btn primary" :disabled="busy" @click="save(true)"><Icon name="send" :size="16" />{{ existing?.status === "changes_requested" ? "Resubmit" : "Submit for approval" }}</button>
        </div>
      </div>

      <aside class="stack sticky">
        <div class="card card-pad">
          <div class="row" style="justify-content: space-between">
            <h3>Completeness</h3>
            <span class="strong">{{ Math.round(completeness * 100) }}%</span>
          </div>
          <div class="progress mt8"><span :style="{ width: `${completeness * 100}%`, background: completeness === 1 ? 'var(--good)' : undefined }"></span></div>
          <p class="small muted mt8">{{ required.filter(filled).length }} of {{ required.length }} required fields. Incomplete requests can't be submitted, so nothing bounces back by email.</p>
        </div>

        <div class="card">
          <div class="card-head">
            <h3><Icon name="search" :size="15" /> Duplicate check</h3>
            <span v-if="checking" class="muted small">checking…</span>
          </div>
          <div class="card-body">
            <p v-if="!dupes.length" class="small muted">No similar {{ domain.name.toLowerCase() }} records in SAP B1 or in open requests.</p>
            <div v-for="d in dupes" :key="d.id" class="dupe" :class="d.level">
              <div class="row" style="justify-content: space-between">
                <strong>{{ d.name }}</strong>
                <span class="badge plain" :class="d.level === 'likely' ? 't-bad' : 't-warn'">{{ Math.round(d.score * 100) }}% {{ d.level }}</span>
              </div>
              <div class="small muted">{{ d.source === "master" ? `In SAP B1 as ${d.code}` : `Open request ${d.code}` }} · {{ d.entity }}</div>
              <ul class="small">
                <li v-for="r in d.reasons" :key="r">{{ r }}</li>
              </ul>
            </div>
            <p v-if="dupes.some((d) => d.level === 'likely')" class="small mt8">
              If it's the same organisation, use the existing record (ask MDM to extend it to your entity) instead of creating a new one.
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3><Icon name="shield" :size="15" /> Approval route</h3></div>
          <div class="card-body">
            <div v-for="st in route_" :key="st.n" class="route-stage">
              <div class="small strong muted">Stage {{ st.n }}<span v-if="st.steps.length > 1"> · in parallel</span></div>
              <div v-for="s in st.steps" :key="s.key" class="route-step">
                <div class="strong">{{ s.label }}</div>
                <div class="small muted">{{ functionName(s.function) }}<span v-if="s.entityScoped"> ({{ entity || "your entity" }})</span> · SLA {{ s.slaHours }} h</div>
                <div v-if="s.when" class="small" style="color: var(--accent)">Added because {{ describeRule(s.when, domain.fields) }}</div>
              </div>
            </div>
            <div class="route-step"><div class="strong">MDM team → SAP B1</div><div class="small muted">final check &amp; record creation</div></div>
            <p class="small mt8">
              Worst case <strong>{{ Math.ceil(parallelHours / 24) }} working days</strong> with parallel steps
              <span class="muted">(vs {{ Math.ceil(serialHours / 24) }} if one after another)</span>.
            </p>
            <p v-if="skipped.length" class="small muted mt8">Not needed for this request: {{ skipped.map((s) => s.label).join(", ") }}</p>
          </div>
        </div>
      </aside>
    </div>

    <!-- duplicate block -->
    <div v-if="dupModal" class="modal-bg" @click.self="dupModal = null">
      <div class="modal">
        <div class="card-head"><h2>This looks like an existing record</h2></div>
        <div class="card-body stack">
          <p>{{ dupModal.message }}</p>
          <div v-for="d in dupModal.duplicates.filter((x) => x.level === 'likely')" :key="d.id" class="dupe likely">
            <strong>{{ d.name }}</strong>
            <div class="small muted">{{ d.source === "master" ? `SAP B1 ${d.code}` : `Request ${d.code}` }} · {{ d.entity }} · {{ Math.round(d.score * 100) }}% match</div>
          </div>
          <div class="field">
            <label>Why is a new record needed? (goes to approvers and the audit trail)</label>
            <textarea v-model="overrideReason" class="input" placeholder="e.g. Different legal entity – separate registration number and billing address"></textarea>
          </div>
          <div class="row" style="justify-content: flex-end">
            <button class="btn" @click="dupModal = null; router.push('/requests')">Cancel – use the existing record</button>
            <button class="btn warn" :disabled="overrideReason.trim().length < 10 || busy" @click="save(true)">Submit anyway</button>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.pick { display: flex; gap: 16px; padding: 22px; text-align: left; cursor: pointer; font: inherit; color: inherit; align-items: flex-start; }
.pick:hover { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-50); }
.pick svg { color: var(--brand); }
.sticky { position: sticky; top: 76px; }
.dupe { border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.dupe.likely { border-color: #f2c6c2; background: #fffafa; }
.dupe.possible { border-color: #f1d4a6; background: #fffcf6; }
.dupe ul { margin: 6px 0 0; padding-left: 16px; }
.route-stage { margin-bottom: 10px; }
.route-step { border-left: 3px solid var(--brand-100); padding: 4px 0 4px 10px; margin: 6px 0; }
h3 :deep(svg) { vertical-align: -2px; }
@media (max-width: 1100px) { .sticky { position: static; } }
</style>
