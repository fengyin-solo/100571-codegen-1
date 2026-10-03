<template>
  <section class="page" data-module="requisition">
    <header class="page-head">
      <div>
        <h2>保护插件领用单</h2>
        <p class="page-desc">领用须写明去向变电站与检修单；库存按先入先出扣减，不够的挡回并说明还差几件，通过的结论同步缺陷处置待处理清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">填写领用单</button>
        <button class="btn" type="button" @click="exportRows">导出领用清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form v-if="showForm" class="form-panel" @submit.prevent="submit">
      <label class="form-item">
        <span>领用单号</span>
        <input v-model="form.领用单号" placeholder="如 LY-20261003-001" />
      </label>
      <label class="form-item">
        <span>插件型号</span>
        <select v-model="form.插件型号">
          <option value="" disabled>请选择插件型号</option>
          <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
        </select>
      </label>
      <label class="form-item">
        <span>领用数量</span>
        <input v-model.number="form.领用数量" type="number" min="1" step="1" />
      </label>
      <label class="form-item">
        <span>去向变电站</span>
        <input v-model="form.去向变电站" list="substation-options" placeholder="如 城东110kV变电站" />
        <datalist id="substation-options">
          <option v-for="name in substationNames" :key="name" :value="name" />
        </datalist>
      </label>
      <label class="form-item">
        <span>关联检修单</span>
        <input v-model="form.关联检修单" placeholder="如 JX-2026-1001" />
      </label>
      <label class="form-item">
        <span>领用人</span>
        <input v-model="form.领用人" placeholder="检修班领用人" />
      </label>
      <label class="form-item">
        <span>领用日期</span>
        <input v-model="form.领用日期" type="date" />
      </label>
      <button class="btn primary" type="submit">提交领用单</button>
      <span v-if="form.插件型号" class="form-hint">
        当前可领用库存 {{ usable }} 件（与库存台账同一份，按先入先出扣减）
      </span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>领用单号</span>
        <input v-model="filters.领用单号" placeholder="按领用单号检索" />
      </label>
      <label class="filter-item">
        <span>插件型号</span>
        <input v-model="filters.插件型号" placeholder="按插件型号检索" />
      </label>
      <label class="filter-item">
        <span>去向变电站</span>
        <input v-model="filters.去向变电站" placeholder="按去向变电站检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="['badge', row.status === '已通过' ? 'ok' : 'warn']">{{ row.status }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无领用单，可先填写领用单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 张领用单 · 重复提交同一领用单号只入账一笔</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  REQUISITION_KEY,
  ledgerModels,
  listRequisitions,
  submitRequisition,
  suggestOrderNo,
  usableStock,
} from '@/api/sparepart-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const columns = ["领用单号", "插件型号", "领用数量", "去向变电站", "关联检修单", "领用人", "领用日期", "审核结论"]

const rows = ref<EntryRow[]>([])
const models = ref<string[]>([])
const filters = ref<Record<string, string>>({})
const showForm = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const stockVersion = ref(0)

const blankForm = () => ({
  领用单号: suggestOrderNo(),
  插件型号: '',
  领用数量: 1,
  去向变电站: '',
  关联检修单: '',
  领用人: '',
  领用日期: new Date().toISOString().slice(0, 10),
})
const form = ref(blankForm())

const total = computed(() => rows.value.length)
// 可用量直接读台账那一份数据，领用单上不另存库存数。
const usable = computed(() => {
  stockVersion.value
  return form.value.插件型号 ? usableStock(form.value.插件型号) : 0
})
const substationNames = computed(() => [
  ...new Set(listRows('substation').map((row) => String(row['站名'])).filter((name) => name.trim() !== '')),
])
const stats = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return [
    { label: '已通过领用单', value: rows.value.filter((row) => row.status === '已通过').length },
    { label: '已挡回领用单', value: rows.value.filter((row) => row.status === '已挡回').length },
    {
      label: '今日通过件数',
      value: rows.value
        .filter((row) => row.status === '已通过' && row['领用日期'] === today)
        .reduce((sum, row) => sum + Number(row['领用数量'] || 0), 0),
    },
  ]
})

function submit() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = submitRequisition(form.value)
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  if (!result.duplicated) {
    form.value = { ...blankForm(), 插件型号: form.value.插件型号, 去向变电站: form.value.去向变电站, 领用人: form.value.领用人 }
    showForm.value = false
  }
  reload()
}

function exportRows() {
  downloadEntries(REQUISITION_KEY)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  rows.value = listRequisitions(filters.value)
  models.value = ledgerModels()
  stockVersion.value += 1
}

onMounted(reload)
</script>
