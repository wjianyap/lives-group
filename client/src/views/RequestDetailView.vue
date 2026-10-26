<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { store, toast, countryName, entityName } from "../store";
import { fmtDate } from "../utils";
import { refreshNotifications } from "../session";
import StatusBadge from "../components/StatusBadge.vue";
import ApprovalTracker from "../components/ApprovalTracker.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const r = ref(null);
const auditData = ref(null);
const tab = ref("details");
const comment = ref("");
const decisionNote = ref("");
const busy = ref(false);
const sapCode = ref("");

async function load(reveal = false) {
  r.value = await api.get(`/requests/${route.params.id}${reveal ? "?reveal=1" : ""}`);
  if (tab.value === "audit") loadAudit();
}
async function loadAudit() {
  auditData.value = await api.get(`/requests/${route.params.id}/audit`);
}
onMounted(() => load());

const sections = computed(() => {
  if (!r.value) return [];
  const out = [];
  for (const f of r.value.domain.fields) {
    const v = r.value.values[f.key];
    if (v === undefined || v === "" || v === null) continue;
    let s = out.find((x) => x.name === f.section);
    if (!s) out.push((s = { name: f.section, rows: [] }));
    s.rows.push({ f, v: f.type === "checkbox" ? (v ? "Yes" : "No") : f.type === "country" ? countryName(v) : v });
  }
  return out;
});
const myStep = computed(() => r.value?.approvals.find((a) => a.canAct));
const waitingOn = computed(() => {
  if (!r.value) return "";
  if (r.value.status === "pending")
    return r.value.approvals
      .filter((a) => a.status === "pending")
      .map((a) => `${a.label} (${a.assignees.map((p) => p.name).join(", ")})`)
      .join(" and ");
  return { approved: "MDM team: create the record in SAP B1", changes_requested: `${r.value.requester.name}: update and resubmit`, draft: `${r.value.requester.name}: finish and submit` }[r.value.status] || "";
});

async function decide(decision) {
  if (decision !== "approve" && !decisionNote.value.trim()) return toast("Add a comment so the requester knows what to fix", "bad");
  busy.value = true;
  try {
    await api.post(`/requests/${r.value._id}/approvals/${myStep.value.key}`, { decision, comment: decisionNote.value || undefined });
    toast(decision === "approve" ? "Approved; the next step has been notified" : decision === "reject" ? "Rejected; requester notified" : "Sent back to the requester");
    decisionNote.value = "";
    await load();
    refreshNotifications();
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    busy.value = false;
  }
}

async function addComment() {
  if (!comment.value.trim()) return;
  await api.post(`/requests/${r.value._id}/comments`, { text: comment.value });
  comment.value = "";
  load();
}

async function complete() {
  busy.value = true;
  try {
    const res = await api.post(`/requests/${r.value._id}/complete`, { sapCode: sapCode.value || undefined });
    toast(`Created in SAP B1 as ${res.sapCode}; requester notified`);
    load();
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    busy.value = false;
  }
}

function openTab(t) {
  tab.value = t;
  if (t === "audit") loadAudit();
}

const actionLabel = (a) =>
  ({
    submitted: "Submitted",
    resubmitted: "Resubmitted after changes",
    draft_saved: "Draft saved",
    draft_from_email: "Draft created from an email",
    step_approved: "Approved",
    step_rejected: "Rejected",
    step_changes_requested: "Asked for changes",
    fully_approved: "All approvals complete",
    created_in_sap: "Created in SAP B1",
    commented: "Commented",
    reminder_sent: "SLA reminder sent",
    sla_escalated: "Escalated: SLA breached",
    sensitive_viewed: "Viewed sensitive fields",
  })[a] || a;
</script>

<template>
  <div v-if="!r" class="empty">Loading…</div>
  <template v-else>
    <div class="page-head">
      <div>
        <div class="muted small">{{ r.domain.name }} request · {{ entityName(r.entity) }}<span v-if="r.country"> · {{ countryName(r.country) }}</span></div>
        <div class="row mt8">
          <h1>{{ r.title }}</h1>
          <StatusBadge :status="r.status" />
        </div>
        <p class="mt8"><strong>{{ r.refNo }}</strong> · raised by {{ r.requester.name }} ({{ r.requester.title }}) · {{ fmtDate(r.submittedAt || r.createdAt, true) }}</p>
      </div>
      <div class="row">
        <router-link v-if="r.permissions.canEdit" class="btn primary" :to="`/requests/${r._id}/edit`"><Icon name="edit" :size="16" />{{ r.status === "draft" ? "Continue editing" : "Update & resubmit" }}</router-link>
        <button class="btn" @click="router.back()">Back</button>
      </div>
    </div>

    <div v-if="waitingOn" class="callout info" style="margin-bottom: 16px">
      <Icon name="clock" />
      <div><strong>Now waiting on:</strong> {{ waitingOn }}</div>
    </div>
    <div v-if="r.status === 'completed'" class="callout good" style="margin-bottom: 16px">
      <Icon name="check" />
      <div><strong>Live in SAP B1 as {{ r.sapCode }}</strong>, created {{ fmtDate(r.completedAt, true) }}. You can transact with it now.</div>
    </div>

    <div class="card card-pad"><ApprovalTracker :request="r" /></div>

    <!-- approver action -->
    <div v-if="myStep" class="card mt16 action">
      <div class="card-head">
        <div>
          <h2>Your decision: {{ myStep.label }}</h2>
          <p>{{ myStep.checks }}</p>
        </div>
        <span class="badge" :class="myStep.overdue ? 't-bad' : 't-info'">{{ myStep.overdue ? "Overdue" : "Waiting on you" }}</span>
      </div>
      <div class="card-body stack">
        <textarea v-model="decisionNote" class="input" placeholder="Comment (required to reject or ask for changes)"></textarea>
        <div class="row">
          <button class="btn good" :disabled="busy" @click="decide('approve')"><Icon name="check" :size="16" />Approve</button>
          <button class="btn warn" :disabled="busy" @click="decide('changes')">Ask for changes</button>
          <button class="btn danger" :disabled="busy" @click="decide('reject')">Reject</button>
        </div>
      </div>
    </div>

    <!-- MDM: create in SAP -->
    <div v-if="r.permissions.canComplete" class="card mt16 action">
      <div class="card-head">
        <div>
          <h2>Create in SAP B1</h2>
          <p>All approvals are in. Check the payload, then post it. No re-keying.</p>
        </div>
      </div>
      <div class="card-body stack">
        <div class="row">
          <input v-model="sapCode" class="input" style="width: 220px" :placeholder="`Code (auto: ${r.domain.codePrefix}#####)`" />
          <button class="btn primary" :disabled="busy" @click="complete"><Icon name="db" :size="16" />Post to SAP B1 &amp; notify requester</button>
        </div>
      </div>
    </div>

    <div class="tabs mt16">
      <button class="tab" :class="{ active: tab === 'details' }" @click="openTab('details')">Details</button>
      <button class="tab" :class="{ active: tab === 'discussion' }" @click="openTab('discussion')">Discussion ({{ r.comments.length }})</button>
      <button class="tab" :class="{ active: tab === 'sap' }" @click="openTab('sap')">SAP B1 payload</button>
      <button class="tab" :class="{ active: tab === 'audit' }" @click="openTab('audit')">Audit trail</button>
    </div>

    <div v-if="tab === 'details'" class="grid" :class="r.duplicates.length || r.duplicateOverride ? 'split' : ''">
      <div class="stack">
        <div v-if="r.domain.fields.some((f) => f.sensitive)" class="row">
          <span class="small muted"><Icon name="lock" :size="13" /> Sensitive fields are encrypted and masked.</span>
          <button v-if="r.permissions.canSeeSensitive && !r.permissions.revealed" class="btn sm" @click="load(true)"><Icon name="eye" :size="14" />Reveal (logged)</button>
          <span v-else-if="r.permissions.revealed" class="badge t-accent">Revealed · this view was recorded in the audit trail</span>
          <span v-else class="small muted">Only Finance and MDM can reveal them.</span>
        </div>
        <div v-for="s in sections" :key="s.name" class="card">
          <div class="card-head"><h3>{{ s.name }}</h3></div>
          <table>
            <tr v-for="row in s.rows" :key="row.f.key">
              <td class="muted" style="width: 40%">{{ row.f.label }} <span v-if="row.f.sensitive" class="lock">sensitive</span></td>
              <td :class="{ strong: row.f.dedupe === 'name' }">{{ row.v }}</td>
            </tr>
          </table>
        </div>
      </div>
      <div v-if="r.duplicates.length || r.duplicateOverride" class="card">
        <div class="card-head"><h3>Duplicate check at submission</h3></div>
        <div class="card-body stack">
          <div v-if="r.duplicateOverride" class="callout warn small">
            <div><strong>Submitted despite a likely duplicate.</strong> Reason: “{{ r.duplicateOverride.reason }}”</div>
          </div>
          <div v-for="d in r.duplicates" :key="d.id">
            <div class="row" style="justify-content: space-between">
              <strong>{{ d.name }}</strong>
              <span class="badge plain" :class="d.level === 'likely' ? 't-bad' : 't-warn'">{{ Math.round(d.score * 100) }}%</span>
            </div>
            <div class="small muted">{{ d.source === "master" ? `SAP B1 ${d.code}` : `Request ${d.code}` }} · {{ d.entity }}</div>
            <div class="small">{{ d.reasons.join(" · ") }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tab === 'discussion'" class="card">
      <div class="card-body stack">
        <div v-if="!r.comments.length" class="muted">No comments. Questions go here instead of email, so they stay with the request.</div>
        <div v-for="c in r.comments" :key="c._id" class="comment">
          <div class="small"><strong>{{ c.by?.name }}</strong> <span class="muted">· {{ fmtDate(c.at, true) }}</span></div>
          <div>{{ c.text }}</div>
        </div>
        <div class="row">
          <input v-model="comment" class="input" style="flex: 1" placeholder="Ask a question or add context…" @keyup.enter="addComment" />
          <button class="btn primary" @click="addComment">Post</button>
        </div>
      </div>
    </div>

    <div v-if="tab === 'sap'" class="card">
      <div class="card-head">
        <div>
          <h3>{{ r.sapPayload.method }} {{ r.sapPayload.endpoint }}</h3>
          <p>SAP B1 Service Layer call made when MDM posts the record. Field mapping comes from the request-type configuration.</p>
        </div>
      </div>
      <div class="card-body"><pre class="json">{{ JSON.stringify(r.sapPayload.body, null, 2) }}</pre></div>
    </div>

    <div v-if="tab === 'audit'" class="card">
      <div class="card-head">
        <div>
          <h3>Audit trail</h3>
          <p>Append-only. Each entry is chained to the previous one with a SHA-256 hash, so any edit breaks the chain.</p>
        </div>
        <span v-if="auditData" class="badge" :class="auditData.verification.valid ? 't-good' : 't-bad'">
          {{ auditData.verification.valid ? `Chain verified · ${auditData.verification.count} entries` : `Chain broken at #${auditData.verification.brokenAt}` }}
        </span>
      </div>
      <div class="table-wrap">
        <table v-if="auditData">
          <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Details</th><th>Hash</th></tr></thead>
          <tbody>
            <tr v-for="e in auditData.entries" :key="e._id">
              <td class="muted">{{ e.seq }}</td>
              <td class="nowrap">{{ fmtDate(e.at, true) }}</td>
              <td class="nowrap">{{ e.actorName }}</td>
              <td class="nowrap strong">{{ actionLabel(e.action) }}</td>
              <td class="small">
                <template v-if="e.details">
                  <span v-if="e.details.step">{{ e.details.step }}</span>
                  <span v-if="e.details.comment"> – “{{ e.details.comment }}”</span>
                  <span v-if="e.details.approvals">Route: {{ e.details.approvals.join(" → ") }}</span>
                  <span v-if="e.details.duplicateOverride"> · duplicate override: “{{ e.details.duplicateOverride }}”</span>
                  <span v-if="e.details.sapCode">{{ e.details.sapCode }} via {{ e.details.endpoint }}</span>
                  <span v-if="e.details.fields">{{ e.details.fields.join(", ") }}</span>
                  <span v-if="e.details.text">“{{ e.details.text }}”</span>
                  <span v-if="e.details.subject">“{{ e.details.subject }}” ({{ e.details.classification }})</span>
                </template>
              </td>
              <td><code class="muted" :title="e.hash">{{ e.hash.slice(0, 10) }}…</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
.action { border-color: var(--brand-100); box-shadow: 0 0 0 3px var(--brand-50); }
.comment { background: var(--line-2); border-radius: 8px; padding: 10px 12px; }
.callout :deep(svg), .row :deep(svg) { vertical-align: -2px; }
</style>
