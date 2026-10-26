<script setup>
import { useRouter } from "vue-router";
import StatusBadge from "./StatusBadge.vue";
import { timeAgo, fmtDate } from "../utils";
import { countryName } from "../store";

defineProps({ rows: { type: Array, default: () => [] }, showRequester: Boolean, empty: { type: String, default: "No requests" } });
const router = useRouter();
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Record</th>
          <th v-if="showRequester">Requested by</th>
          <th>Status</th>
          <th>Waiting on</th>
          <th>Progress</th>
          <th class="num">Age</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r._id" class="clickable" @click="router.push(`/requests/${r._id}`)">
          <td class="nowrap"><strong>{{ r.refNo }}</strong><div class="muted small">{{ r.domainName }} · {{ r.entity }}</div></td>
          <td>
            {{ r.title }}
            <span v-if="r.duplicateFlag" class="badge plain t-warn" title="A likely duplicate was overridden with a reason">dup. override</span>
            <div v-if="r.country" class="muted small">{{ countryName(r.country) }}</div>
          </td>
          <td v-if="showRequester">{{ r.requester?.name }}</td>
          <td><StatusBadge :status="r.status" /></td>
          <td>
            <span v-if="r.myAction" class="badge t-info">You</span>
            <span v-for="w in r.myAction ? [] : r.waitingOn" :key="w" class="chip" style="margin: 1px 4px 1px 0">{{ w }}</span>
            <span v-if="r.overdue" class="badge plain t-bad">overdue</span>
            <span v-if="r.status === 'completed'" class="muted small">SAP {{ r.sapCode }} · {{ fmtDate(r.completedAt) }}</span>
          </td>
          <td>
            <div class="progress" :title="`${r.progress.done} of ${r.progress.total} approvals`">
              <span :style="{ width: `${r.progress.total ? (r.progress.done / r.progress.total) * 100 : 0}%` }"></span>
            </div>
          </td>
          <td class="num muted nowrap">{{ r.submittedAt ? `${r.ageDays} d` : timeAgo(r.updatedAt) }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="showRequester ? 7 : 6" class="empty">{{ empty }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
