<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { login } from "../session";

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
const personas = ref([]);

const groups = computed(() => [
  { title: "Requestors", hint: "raise new customers, items, vendors", users: personas.value.filter((u) => u.role === "requestor") },
  { title: "Approvers", hint: "Finance, QRA, BU Heads, Business Support", users: personas.value.filter((u) => u.role === "approver") },
  { title: "MDM team", hint: "final check, create in SAP B1, configure", users: personas.value.filter((u) => ["mdm", "admin"].includes(u.role)) },
]);

onMounted(async () => {
  personas.value = await api.get("/auth/demo-users").catch(() => []);
});

async function signIn(e = email.value, p = password.value) {
  busy.value = true;
  error.value = "";
  try {
    await login(e, p);
    router.push(route.query.redirect || "/");
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <section class="hero">
      <div class="brand-row">
        <div class="mark">L</div>
        <strong>Lives Group</strong>
      </div>
      <h1>One place to request, approve and track master data, and to see where the region is growing.</h1>
      <ul>
        <li>Guided forms that only ask for what each record type needs</li>
        <li>Duplicate check before anything reaches an approver</li>
        <li>Parallel approvals with SLA reminders, so every step shows who it is waiting on</li>
        <li>Tamper-evident audit trail and encrypted bank &amp; credit fields</li>
        <li>Regional view: Products A–C across five countries, with forecasts</li>
      </ul>
      <p class="foot">Prototype for the SMU DSA Data Case Competition 2026 · all data is synthetic</p>
    </section>

    <section class="panel">
      <h2>Sign in</h2>
      <form class="stack mt16" @submit.prevent="signIn()">
        <div class="field"><label>Email</label><input v-model="email" class="input" type="email" autocomplete="username" /></div>
        <div class="field"><label>Password</label><input v-model="password" class="input" type="password" autocomplete="current-password" /></div>
        <div v-if="error" class="callout bad">{{ error }}</div>
        <button class="btn primary" :disabled="busy">Sign in</button>
      </form>

      <template v-if="personas.length">
        <div class="divider mt16"></div>
        <h3>Or try a demo persona</h3>
        <p class="muted small">Password for all: <code>Demo123!</code></p>
        <div v-for="g in groups" :key="g.title" class="mt16">
          <div class="small strong">{{ g.title }} <span class="muted">– {{ g.hint }}</span></div>
          <div class="personas">
            <button v-for="u in g.users" :key="u._id" class="persona" :disabled="busy" @click="signIn(u.email, 'Demo123!')">
              <span class="pa">{{ u.name.split(" ").map((w) => w[0]).slice(0, 2).join("") }}</span>
              <span>
                <strong>{{ u.name }}</strong>
                <span class="muted small">{{ u.title }}</span>
              </span>
            </button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; }
.hero { background: linear-gradient(160deg, #0b2a33, #0f766e); color: #e3f1ef; padding: 56px; display: flex; flex-direction: column; gap: 22px; }
.hero h1 { color: #fff; font-size: 30px; max-width: 520px; line-height: 1.2; }
.hero ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; max-width: 520px; }
.hero .foot { margin-top: auto; font-size: 12px; opacity: 0.7; }
.brand-row { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 16px; }
.mark { width: 36px; height: 36px; border-radius: 9px; background: rgba(255, 255, 255, 0.15); display: grid; place-items: center; font-weight: 700; }
.panel { padding: 48px 56px; max-width: 620px; width: 100%; background: var(--surface); overflow-y: auto; }
.personas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.persona { display: flex; align-items: center; gap: 10px; text-align: left; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; cursor: pointer; font: inherit; }
.persona:hover { border-color: var(--brand); background: var(--brand-50); }
.persona > span:last-child { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
.pa { width: 30px; height: 30px; flex: none; border-radius: 99px; background: var(--brand-50); color: var(--brand); display: grid; place-items: center; font-weight: 700; font-size: 12px; }
@media (max-width: 900px) {
  .login { grid-template-columns: 1fr; }
  .hero { padding: 28px 16px; }
  .hero h1 { font-size: 22px; }
  .panel { padding: 24px 16px; }
  .personas { grid-template-columns: 1fr; }
}
</style>
