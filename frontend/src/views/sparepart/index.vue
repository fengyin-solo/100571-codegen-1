<template>
  <section class="page" data-module="sparepart">
    <header class="page-head">
      <div>
        <h2>备品备件与保护插件库存台账</h2>
        <p class="page-desc">按库位登记保护插件型号、库存数量与最低储备；低于储备下限的单独归到最先一组，库存是否可用按先入先出判定。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">登记库存条目</button>
        <button class="btn" type="button" @click="exportRows">导出库存台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form v-if="showForm" class="form-panel" @submit.prevent="saveEntry">
      <label class="form-item">
        <span>库位</span>
        <input v-model="form.库位" placeholder="如 A区-01柜" />
      </label>
      <label class="form-item">
        <span>插件型号</span>
        <input v-model="form.插件型号" list="model-options" placeholder="如 PCS-9611D 线路保护插件" />
        <datalist id="model-options">
          <option v-for="model in models" :key="model" :value="model" />
        </datalist>
      </label>
      <label class="form-item">
        <span>批次号</span>
        <input v-model="form.批次号" placeholder="如 PC2026-10" />
      </label>
      <label class="form-item">
        <span>入库日期</span>
        <input v-model="form.入库日期" type="date" />
      </label>
      <label class="form-item">
        <span>库存数量</span>
        <input v-model.number="form.库存数量" type="number" min="0" step="1" />
      </label>
      <label class="form-item">
        <span>最低储备</span>
        <input v-model.number="form.最低储备" type="number" min="0" step="1" />
      </label>
      <button class="btn primary" type="submit">保存条目</button>
      <span class="form-hint">压到储备线以下的不允许保存成可领用</span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>库位</span>
        <input v-model="filters.库位" placeholder="按库位检索" />
      </label>
      <label class="filter-item">
        <span>插件型号</span>
        <input v-model="filters.插件型号" placeholder="按插件型号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>储备状态</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in groups" :key="group.key">
          <tr v-if="group.rows.length" :class="['group-row', group.key]">
            <td :colspan="columns.length + 3">{{ group.label }}（{{ group.rows.length }} 项）</td>
          </tr>
          <tr v-for="row in group.rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : row[column] }}</td>
            <td>
              <span v-if="isBelowReserve(row)" class="badge warn">低于下限</span>
              <span v-else class="badge ok">达标</span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="stocktake(row)">登记盘点</button>
              <button v-if="row.status !== '冻结'" class="link" type="button" @click="freeze(row, true)">冻结批次</button>
              <button v-else class="link" type="button" @click="freeze(row, false)">解除冻结</button>
            </td>
          </tr>
        </template>
        <tr v-if="!total">
          <td :colspan="columns.length + 3" class="empty-state">暂无库存条目，可先登记库存条目</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条库存条目 · 账实冲突时按最近一次盘点的那份入账</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  SPAREPART_KEY,
  createLedgerEntry,
  isBelowReserve,
  ledgerModels,
  listLedgerGroups,
  registerStocktake,
  setEntryFrozen,
  usableStock,
} from '@/api/sparepart-service'
import type { LedgerGroup } from '@/api/sparepart-service'
import type { EntryRow } from '@/data/types'

const columns = ["库位", "插件型号", "批次号", "入库日期", "库存数量", "最低储备", "最近盘点日", "盘点数量"]

const groups = ref<LedgerGroup[]>([])
const models = ref<string[]>([])
const filters = ref<Record<string, string>>({})
const showForm = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')

const blankForm = () => ({
  库位: '',
  插件型号: '',
  批次号: '',
  入库日期: new Date().toISOString().slice(0, 10),
  库存数量: 0,
  最低储备: 1,
})
const form = ref(blankForm())

const total = computed(() => groups.value.reduce((sum, group) => sum + group.rows.length, 0))
const stats = computed(() => {
  const rows = groups.value.flatMap((group) => group.rows)
  return [
    { label: '在册条目', value: rows.length },
    { label: '可领用条目', value: rows.filter((row) => row.status === '可领用').length },
    { label: '低于储备条目', value: rows.filter(isBelowReserve).length },
    { label: '可领用总件数', value: [...new Set(rows.map((row) => String(row['插件型号'])))].reduce((sum, model) => sum + usableStock(model), 0) },
  ]
})

function saveEntry() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createLedgerEntry(form.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  form.value = blankForm()
  showForm.value = false
  reload()
}

function stocktake(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const input = window.prompt(`登记盘点：${row['库位']} ${row['插件型号']}（账面${row['库存数量']}件），请输入实盘数量`, String(row['库存数量']))
  if (input === null) {
    return
  }
  const counted = Number(input)
  const result = registerStocktake(Number(row.id), counted)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function freeze(row: EntryRow, frozen: boolean) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = setEntryFrozen(Number(row.id), frozen)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function exportRows() {
  downloadEntries(SPAREPART_KEY)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  groups.value = listLedgerGroups(filters.value)
  models.value = ledgerModels()
}

onMounted(reload)
</script>
