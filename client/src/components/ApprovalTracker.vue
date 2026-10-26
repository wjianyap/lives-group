<script setup>
// Shows the whole approval route: stages left to right, parallel steps stacked inside a stage
import { computed } from "vue";
import { fmtDate, dueText } from "../utils";
import Icon from "./Icon.vue";

const props = defineProps({
  request: { type: Object, required: true },
});

const stages = computed(() => {
  const by = {};
  for (const a of props.request.approvals) (by[a.stage] ||= []).push(a);
  return Object.entries(by)
    .sort((a, b) => a[0] - b[0])
    .map(([stage, steps]) => ({ stage: Number(stage), steps }));
});

const submitted = computed(() => !!props.request.submittedAt);
const done = computed(() => props.request.status === "completed");
const STEP_LABEL = { pending: "Waiting", approved: "Approved", rejected: "Rejected", changes_requested: "Changes requested", waiting: "Not started" };
const tone = (s) => ({ approved: "good", pending: "info", rejected: "bad", changes_requested: "warn", waiting: "muted" })[s] || "muted";
</script>

<template>
  <div class="tracker">
    <div class="node" :class="submitted ? 'good' : 'muted'">
      <div class="title"><Icon name="send" :size="15" /> Submitted</div>
      <div class="muted small">{{ submitted ? fmtDate(request.submittedAt, true) : "Draft" }}</div>
      <div class="muted small">{{ request.requester?.name }}</div>
    </div>
    <div v-for="s in stages" :key="s.stage" class="stage">
      <div class="stage-label">Stage {{ s.stage }}<span v-if="s.steps.length > 1"> · in parallel</span></div>
      <div v-for="a in s.steps" :key="a.key" class="node" :class="[tone(a.status), { overdue: a.overdue }]">
        <div class="title">{{ a.label }}</div>
        <span class="badge" :class="`t-${tone(a.status)}`">{{ STEP_LABEL[a.status] }}</span>
        <template v-if="a.status === 'pending'">
          <div class="small mt8"><Icon name="users" :size="13" /> {{ a.assignees.map((p) => p.name).join(", ") || "No approver configured!" }}</div>
          <div class="small" :class="a.overdue ? 'bad' : 'muted'"><Icon name="clock" :size="13" /> {{ dueText(a.dueAt) }}</div>
        </template>
        <template v-else-if="a.actedAt">
          <div class="small mt8">{{ a.actedBy?.name }}</div>
          <div class="muted small">{{ fmtDate(a.actedAt, true) }}</div>
          <div v-if="a.comment" class="comment">“{{ a.comment }}”</div>
        </template>
        <div v-else class="muted small mt8">Starts when stage {{ s.stage - 1 || 1 }} is done</div>
      </div>
    </div>
    <div class="node" :class="done ? 'good' : request.status === 'approved' ? 'info' : 'muted'">
      <div class="title"><Icon name="db" :size="15" /> Created in SAP B1</div>
      <div v-if="done" class="small"><strong>{{ request.sapCode }}</strong> · {{ fmtDate(request.completedAt, true) }}</div>
      <div v-else-if="request.status === 'approved'" class="small">Waiting on MDM team</div>
      <div v-else class="muted small">After all approvals</div>
    </div>
  </div>
</template>

<style scoped>
.tracker { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; align-items: stretch; }
.stage { display: flex; flex-direction: column; gap: 8px; min-width: 210px; }
.stage-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }
.node { border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: 8px; padding: 10px 12px; min-width: 170px; background: #fff; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.node.good { border-left-color: var(--good); }
.node.info { border-left-color: var(--info); background: #f8fbff; }
.node.warn { border-left-color: var(--warn); }
.node.bad { border-left-color: var(--bad); }
.node.overdue { background: #fff8f7; }
.title { font-weight: 600; display: flex; gap: 6px; align-items: center; }
.bad { color: var(--bad); font-weight: 600; }
.comment { font-size: 12px; color: var(--ink-2); background: var(--line-2); border-radius: 6px; padding: 4px 8px; margin-top: 4px; }
.small :deep(svg) { vertical-align: -2px; }
</style>
