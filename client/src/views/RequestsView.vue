<script setup>
import { ref, watch, onMounted } from "vue";
import { api } from "../api";
import { store } from "../store";
import { STATUS } from "../utils";
import RequestTable from "../components/RequestTable.vue";

const props = defineProps({ initialScope: { type: String, default: "" } });
const canSeeAll = ["approver", "mdm", "admin"].includes(store.user.role);
const scope = ref(props.initialScope || (canSeeAll ? "all" : "mine"));
const status = ref("");
const domain = ref("");
const q = ref("");
const rows = ref([]);
const domains = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  const params = new URLSearchParams({ scope: scope.value });
  if (status.value) params.set("status", status.value);
  if (domain.value) params.set("domain", domain.value);
  if (q.value) params.set("q", q.value);
  rows.value = await api.get(`/requests?${params}`);
  loading.value = false;
}

let t;
watch([scope, status, domain], load);
watch(q, () => {
  clearTimeout(t);
  t = setTimeout(load, 250);
});
onMounted(async () => {
  domains.value = await api.get("/domains");
  load();
});
</script>

<template>
  <div class="page-head">
    <div>
      <h1>{{ scope === "awaiting" ? "Waiting on me" : "Requests" }}</h1>
      <p>Every request shows its status, the step it is on and who that step is waiting on.</p>
    </div>
    <router-link class="btn primary" to="/requests/new">New request</router-link>
  </div>
  <div class="card">
    <div class="card-head" style="flex-wrap: wrap">
      <div class="seg">
        <button :class="{ active: scope === 'mine' }" @click="scope = 'mine'">Mine</button>
        <button v-if="['approver', 'admin'].includes(store.user.role)" :class="{ active: scope === 'awaiting' }" @click="scope = 'awaiting'">Waiting on me</button>
        <button v-if="canSeeAll" :class="{ active: scope === 'all' }" @click="scope = 'all'">All</button>
      </div>
      <div class="row">
        <input v-model="q" class="input" style="width: 220px" placeholder="Search name or reference" />
        <select v-model="domain" class="input" style="width: 150px">
          <option value="">All types</option>
          <option v-for="d in domains" :key="d.key" :value="d.key">{{ d.name }}</option>
        </select>
        <select v-model="status" class="input" style="width: 200px" :disabled="scope === 'awaiting'">
          <option value="">Any status</option>
          <option v-for="(s, k) in STATUS" v-show="k !== 'waiting'" :key="k" :value="k">{{ s.label }}</option>
        </select>
      </div>
    </div>
    <RequestTable :rows="rows" :show-requester="scope !== 'mine'" :empty="loading ? 'Loading…' : 'No requests match'" />
  </div>
</template>
