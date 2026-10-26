<script setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { toast, countryName, productName } from "../store";
import { timeAgo } from "../utils";
import Icon from "../components/Icon.vue";

const router = useRouter();
const messages = ref([]);
const selected = ref(null);
const filter = ref("all");
const compose = ref(false);
const draft = ref({ fromName: "", from: "", subject: "", body: "" });
const preview = ref(null);

const TONE = { order: "t-good", purchase_request: "t-info", enquiry: "t-muted", mdm_setup: "t-accent" };
const SHORT = { order: "Order", purchase_request: "RFQ", enquiry: "Enquiry", mdm_setup: "MDM setup" };

async function load() {
  messages.value = await api.get("/intake/messages");
  if (!selected.value && messages.value.length) selected.value = messages.value[0];
  else if (selected.value) selected.value = messages.value.find((m) => m._id === selected.value._id) || messages.value[0];
}
onMounted(load);

const shown = computed(() => messages.value.filter((m) => filter.value === "all" || m.classification?.type === filter.value));
const counts = computed(() => {
  const c = { all: messages.value.length };
  for (const m of messages.value) c[m.classification?.type] = (c[m.classification?.type] || 0) + 1;
  return c;
});

let t;
function onDraft() {
  clearTimeout(t);
  t = setTimeout(async () => {
    if (!draft.value.subject && !draft.value.body) return (preview.value = null);
    preview.value = await api.post("/intake/classify", draft.value);
  }, 300);
}
async function saveDraft() {
  const m = await api.post("/intake/messages", draft.value);
  compose.value = false;
  draft.value = { fromName: "", from: "", subject: "", body: "" };
  preview.value = null;
  selected.value = m;
  load();
}

async function convert(m) {
  const r = await api.post(`/intake/messages/${m._id}/convert`);
  toast(`Draft ${r.refNo} created from the email; check and submit it`);
  router.push(`/requests/${r._id}/edit`);
}
async function setStatus(m, status) {
  await api.patch(`/intake/messages/${m._id}`, { status });
  load();
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Email intake</h1>
      <p>
        Emails to the shared sales and MDM mailboxes are sorted automatically into <strong>orders</strong>, <strong>purchase requests</strong>,
        <strong>enquiries</strong> and <strong>MDM setup requests</strong>, and matched to the customer master. An order from a customer who isn't in SAP B1 yet becomes a pre-filled setup request.
      </p>
    </div>
    <button class="btn primary" @click="compose = true"><Icon name="plus" :size="16" />Paste an email</button>
  </div>

  <div class="seg" style="margin-bottom: 12px">
    <button v-for="k in ['all', 'order', 'purchase_request', 'enquiry', 'mdm_setup']" :key="k" :class="{ active: filter === k }" @click="filter = k">
      {{ k === "all" ? "All" : SHORT[k] }} ({{ counts[k] || 0 }})
    </button>
  </div>

  <div class="inbox">
    <div class="card list">
      <button v-for="m in shown" :key="m._id" class="msg" :class="{ on: selected?._id === m._id, done: m.status !== 'new' }" @click="selected = m">
        <div class="row" style="justify-content: space-between">
          <strong class="ellipsis">{{ m.fromName }}</strong>
          <span class="muted small">{{ timeAgo(m.receivedAt) }}</span>
        </div>
        <div class="ellipsis">{{ m.subject }}</div>
        <div class="row" style="gap: 6px">
          <span class="badge plain" :class="TONE[m.classification.type]">{{ SHORT[m.classification.type] }}</span>
          <span class="small muted">{{ Math.round(m.classification.confidence * 100) }}%</span>
          <span v-if="m.status !== 'new'" class="small muted">· {{ m.status }}</span>
        </div>
      </button>
    </div>

    <div v-if="selected" class="card">
      <div class="card-head">
        <div>
          <h2>{{ selected.subject }}</h2>
          <p>{{ selected.fromName }} &lt;{{ selected.from }}&gt;</p>
        </div>
        <span class="badge" :class="TONE[selected.classification.type]">{{ selected.classification.label }}</span>
      </div>
      <div class="card-body stack">
        <pre class="mail">{{ selected.body }}</pre>

        <div class="grid g2">
          <div>
            <h3>What was extracted</h3>
            <table class="mt8 kv">
              <tr><td class="muted">Customer in SAP B1</td><td>
                <template v-if="selected.classification.extracted.customerMatch">
                  <strong>{{ selected.classification.extracted.customerMatch.code }}</strong> {{ selected.classification.extracted.customerMatch.name }}
                </template>
                <span v-else class="badge plain t-warn">Not found{{ selected.classification.extracted.organisation ? `: “${selected.classification.extracted.organisation}”` : "" }}</span>
              </td></tr>
              <tr><td class="muted">Product</td><td>{{ selected.classification.extracted.product ? productName(selected.classification.extracted.product) : "—" }}</td></tr>
              <tr><td class="muted">Quantity</td><td>{{ selected.classification.extracted.qty ?? "—" }}</td></tr>
              <tr><td class="muted">PO number</td><td>{{ selected.classification.extracted.poNumber || "—" }}</td></tr>
              <tr><td class="muted">Country</td><td>{{ countryName(selected.classification.extracted.country) }}</td></tr>
            </table>
          </div>
          <div>
            <h3>Why it was classified this way</h3>
            <ul class="small signals">
              <li v-for="s in selected.classification.signals" :key="s.why + s.type"><span class="badge plain" :class="TONE[s.type]">{{ SHORT[s.type] }}</span> {{ s.why }} <span class="muted">(+{{ s.weight }})</span></li>
            </ul>
          </div>
        </div>

        <div class="callout" :class="selected.classification.nextAction.kind === 'raise_customer_request' ? 'warn' : 'info'">
          <Icon name="arrow" />
          <div>
            <strong>Next step:</strong> {{ selected.classification.nextAction.text }}
            <div v-if="selected.linkedRequest" class="small mt8"><router-link :to="`/requests/${selected.linkedRequest}`">Open the linked request →</router-link></div>
          </div>
        </div>
        <div class="row">
          <button
            v-if="['raise_customer_request', 'raise_request'].includes(selected.classification.nextAction.kind) && !selected.linkedRequest"
            class="btn primary"
            @click="convert(selected)"
          >
            <Icon name="plus" :size="16" />Create pre-filled MDM request
          </button>
          <button v-if="selected.status === 'new'" class="btn" @click="setStatus(selected, 'actioned')">Mark actioned</button>
          <button v-if="selected.status === 'new'" class="btn ghost" @click="setStatus(selected, 'dismissed')">Dismiss</button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="compose" class="modal-bg" @click.self="compose = false">
    <div class="modal" style="width: min(720px, 100%)">
      <div class="card-head"><h2>Paste an email to classify</h2><button class="btn ghost sm" @click="compose = false"><Icon name="x" :size="16" /></button></div>
      <div class="card-body stack">
        <div class="form-grid">
          <div class="field"><label>Sender name</label><input v-model="draft.fromName" class="input" @input="onDraft" /></div>
          <div class="field"><label>Sender email</label><input v-model="draft.from" class="input" @input="onDraft" /></div>
          <div class="field wide"><label>Subject</label><input v-model="draft.subject" class="input" @input="onDraft" /></div>
          <div class="field wide"><label>Body</label><textarea v-model="draft.body" class="input" rows="7" @input="onDraft"></textarea></div>
        </div>
        <div v-if="preview" class="callout info">
          <div>
            <strong>{{ preview.label }}</strong> ({{ Math.round(preview.confidence * 100) }}% confidence) – {{ preview.nextAction.text }}
          </div>
        </div>
        <div class="row" style="justify-content: flex-end">
          <button class="btn primary" :disabled="!draft.subject && !draft.body" @click="saveDraft">Add to inbox</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inbox { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
.list { overflow: hidden; }
.msg { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; border: none; border-bottom: 1px solid var(--line-2); background: #fff; padding: 12px 14px; font: inherit; cursor: pointer; }
.msg:hover { background: #f8fafb; }
.msg.on { background: var(--brand-50); box-shadow: inset 3px 0 0 var(--brand); }
.msg.done { opacity: 0.65; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.mail { white-space: pre-wrap; font-family: inherit; font-size: 13px; background: #fafbfc; border: 1px solid var(--line-2); border-radius: 8px; padding: 12px 14px; margin: 0; }
.kv td { padding: 6px 8px 6px 0; border: none; }
.signals { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
@media (max-width: 900px) { .inbox { grid-template-columns: 1fr; } }
</style>
