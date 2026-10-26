<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { store, isStaff } from "../store";
import { timeAgo } from "../utils";
import RequestTable from "../components/RequestTable.vue";
import Icon from "../components/Icon.vue";

const stats = ref(null);
const mine = ref([]);
const awaiting = ref([]);
const queue = ref([]);
const domains = ref([]);

const role = computed(() => store.user.role);
const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
});

onMounted(async () => {
  const jobs = [api.get("/requests/stats"), api.get("/requests?scope=mine"), api.get("/domains")];
  if (["approver", "admin"].includes(role.value)) jobs.push(api.get("/requests?scope=awaiting"));
  if (isStaff()) jobs.push(api.get("/requests?scope=mdm&status=approved"));
  const [s, m, d, a, q] = await Promise.all(jobs);
  stats.value = s;
  mine.value = m;
  domains.value = d;
  if (["approver", "admin"].includes(role.value)) awaiting.value = a || [];
  if (isStaff()) queue.value = (["approver", "admin"].includes(role.value) ? q : a) || [];
});

const speedup = computed(() => (stats.value?.avgCycleDays ? Math.round(stats.value.baselineCycleDays / stats.value.avgCycleDays) : null));
</script>

<template>
  <div class="page-head">
    <div>
      <h1>{{ greeting }}, {{ store.user.name.split(" ")[0] }}</h1>
      <p v-if="role === 'requestor'">Raise a request, then follow it here. No need to chase anyone by email.</p>
      <p v-else-if="role === 'approver'">Everything waiting on you is below, oldest first. Most approvals take under a minute.</p>
      <p v-else>The MDM queue, SLA watch and data health in one place.</p>
    </div>
    <router-link class="btn primary" to="/requests/new"><Icon name="plus" :size="16" />New request</router-link>
  </div>

  <div v-if="stats" class="grid g5">
    <div class="card kpi">
      <div class="label">Average request-to-SAP time</div>
      <div class="value">{{ stats.avgCycleDays ?? "—" }} days</div>
      <div class="sub good">was ~{{ stats.baselineCycleDays }} days by email<span v-if="speedup"> · {{ speedup }}× faster</span></div>
    </div>
    <div class="card kpi">
      <div class="label">Average time per approval</div>
      <div class="value">{{ stats.avgApprovalHours ?? "—" }} h</div>
      <div class="sub">SLA 24–48 h, reminders at 50%</div>
    </div>
    <div class="card kpi">
      <div class="label">First-time-right</div>
      <div class="value">{{ stats.firstTimeRight ?? "—" }}%</div>
      <div class="sub">completed without being sent back</div>
    </div>
    <div class="card kpi">
      <div class="label">Open requests</div>
      <div class="value">{{ stats.open }}</div>
      <div class="sub" :class="{ bad: stats.overdue }">{{ stats.overdue }} past SLA</div>
    </div>
    <div class="card kpi">
      <div class="label">Duplicates stopped at intake</div>
      <div class="value">{{ stats.duplicatesBlocked }}</div>
      <div class="sub">before reaching an approver</div>
    </div>
  </div>

  <div class="stack mt16">
    <div v-if="['approver', 'admin'].includes(role)" class="card">
      <div class="card-head">
        <div>
          <h2>Waiting on you</h2>
          <p>Steps you can approve right now</p>
        </div>
        <router-link to="/approvals" class="btn sm">Open all</router-link>
      </div>
      <RequestTable :rows="awaiting.slice(0, 8)" show-requester empty="Nothing is waiting on you 🎉" />
    </div>

    <div v-if="isStaff()" class="card">
      <div class="card-head">
        <div>
          <h2>Ready to create in SAP B1</h2>
          <p>Fully approved; the final check and post to SAP is yours</p>
        </div>
        <router-link to="/mdm" class="btn sm">MDM workbench</router-link>
      </div>
      <RequestTable :rows="queue" show-requester empty="Queue is empty" />
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>My requests</h2>
          <p>Live status. You'll also get a notification at every step.</p>
        </div>
        <router-link to="/requests" class="btn sm">All requests</router-link>
      </div>
      <RequestTable :rows="mine.slice(0, 8)" empty="You have not raised any requests yet" />
    </div>

    <div class="grid g2">
      <div class="card">
        <div class="card-head"><h2>Start a request</h2></div>
        <div class="card-body grid g2">
          <router-link v-for="d in domains" :key="d.key" :to="`/requests/new/${d.key}`" class="domain-tile">
            <Icon :name="d.icon" :size="22" />
            <div>
              <strong>{{ d.name }}</strong>
              <div class="muted small">{{ d.description }}</div>
            </div>
          </router-link>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent activity</h2></div>
        <div v-if="!store.notifications.items.length" class="empty">No activity yet</div>
        <router-link v-for="n in store.notifications.items.slice(0, 7)" :key="n._id" :to="n.link || '/'" class="activity">
          <span>{{ n.message }}</span>
          <span class="muted small nowrap">{{ timeAgo(n.createdAt) }}</span>
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.domain-tile { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); align-items: flex-start; }
.domain-tile:hover { border-color: var(--brand); background: var(--brand-50); text-decoration: none; }
.domain-tile svg { color: var(--brand); margin-top: 2px; }
.activity { display: flex; justify-content: space-between; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--line-2); color: var(--ink); font-size: 13px; }
.activity:hover { background: #f8fafb; text-decoration: none; }
</style>
