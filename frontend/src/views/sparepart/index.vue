<template>
  <section class="page" data-module="sparepart">
    <header class="page-head">
      <div>
        <h2>备品备件与保护插件库存台账</h2>
        <p class="page-desc">
          按库位登记保护插件批次、库存数量与最低储备，低于储备下限的单独归到最前一组；领用按先入先出扣减，库存不够的挡回并说明差几件。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <p v-if="feedback" class="feedback" :class="feedback.ok ? 'ok-text' : 'error-text'">
      {{ feedback.text }}
    </p>

    <section v-show="activeTab === 'ledger'">
      <form class="filter-bar" @submit.prevent="submitBatch">
        <label class="filter-item">
          <span>库位</span>
          <input v-model="batchForm.库位" placeholder="如 中心库房-A区-01架" list="location-options" />
        </label>
        <label class="filter-item">
          <span>插件型号</span>
          <input v-model="batchForm.插件型号" placeholder="如 PCS-9611D 线路保护插件" />
        </label>
        <label class="filter-item">
          <span>批次号</span>
          <input v-model="batchForm.批次号" placeholder="如 PC-2026-052" />
        </label>
        <label class="filter-item">
          <span>入库日期</span>
          <input v-model="batchForm.入库日期" type="date" />
        </label>
        <label class="filter-item">
          <span>库存数量</span>
          <input v-model.number="batchForm.库存数量" type="number" min="1" />
        </label>
        <label class="filter-item">
          <span>最低储备</span>
          <input v-model.number="batchForm.最低储备" type="number" min="0" />
        </label>
        <button class="btn primary" type="submit">登记入库</button>
      </form>

      <h3 class="group-title warning">低于储备下限（{{ ledger.belowMin.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ledger.belowMin" :key="String(row.id)" class="row-warning">
            <td>{{ row['库位'] }}</td>
            <td>{{ row['插件型号'] }}</td>
            <td>{{ row['批次号'] }}</td>
            <td>{{ row['入库日期'] }}</td>
            <td>{{ row['库存数量'] }}</td>
            <td>{{ row['最低储备'] }}</td>
            <td>{{ gapOf(row) }}</td>
            <td>{{ row['储备状态'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleFreeze(row)">
                {{ row.status === '已冻结' ? '解冻批次' : '冻结批次' }}
              </button>
            </td>
          </tr>
          <tr v-if="!ledger.belowMin.length">
            <td :colspan="ledgerColumns.length + 1" class="empty-state">没有压到储备下限的批次</td>
          </tr>
        </tbody>
      </table>

      <template v-for="group in ledger.locations" :key="group.location">
        <h3 class="group-title">库位：{{ group.location }}（{{ group.rows.length }}个批次）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="String(row.id)">
              <td>{{ row['库位'] }}</td>
              <td>{{ row['插件型号'] }}</td>
              <td>{{ row['批次号'] }}</td>
              <td>{{ row['入库日期'] }}</td>
              <td>{{ row['库存数量'] }}</td>
              <td>{{ row['最低储备'] }}</td>
              <td>{{ gapOf(row) }}</td>
              <td>{{ row['储备状态'] }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="toggleFreeze(row)">
                  {{ row.status === '已冻结' ? '解冻批次' : '冻结批次' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-if="!ledger.locations.length && !ledger.belowMin.length" class="empty-state">
        台账还没有数据，先用上方表单登记入库
      </p>
    </section>

    <section v-show="activeTab === 'issue'">
      <form class="filter-bar" @submit.prevent="submitIssueForm">
        <label class="filter-item">
          <span>领用单号</span>
          <input v-model="issueForm.领用单号" />
        </label>
        <button class="btn ghost" type="button" @click="refreshIssueNo">换下一张</button>
        <label class="filter-item">
          <span>库位</span>
          <select v-model="issueForm.库位">
            <option value="" disabled>选择库位</option>
            <option v-for="location in locations" :key="location" :value="location">{{ location }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>插件型号</span>
          <select v-model="issueForm.插件型号">
            <option value="" disabled>选择型号</option>
            <option v-for="model in modelsAt(issueForm.库位)" :key="model" :value="model">{{ model }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>当前可领用</span>
          <input :value="issuableNow" readonly />
        </label>
        <label class="filter-item">
          <span>领用数量</span>
          <input v-model.number="issueForm.领用数量" type="number" min="1" />
        </label>
        <label class="filter-item">
          <span>去向变电站</span>
          <input v-model="issueForm.去向变电站" list="substation-options" placeholder="必填" />
        </label>
        <label class="filter-item">
          <span>检修单号</span>
          <input v-model="issueForm.检修单号" placeholder="必填，如 JX-2026-1001-02" />
        </label>
        <label class="filter-item">
          <span>领用人</span>
          <input v-model="issueForm.领用人" />
        </label>
        <label class="filter-item">
          <span>申请日期</span>
          <input v-model="issueForm.申请日期" type="date" />
        </label>
        <button class="btn primary" type="submit">提交领用</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in issueColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in issues" :key="String(row.id)" :class="{ 'row-warning': row.status === '已挡回' }">
            <td>{{ row['领用单号'] }}</td>
            <td>{{ row['申请日期'] }}</td>
            <td>{{ row['库位'] }}</td>
            <td>{{ row['插件型号'] }}</td>
            <td>{{ row['领用数量'] }}</td>
            <td>{{ row['去向变电站'] }}</td>
            <td>{{ row['检修单号'] }}</td>
            <td>{{ row['领用人'] }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row['处理说明'] }}</td>
            <td>{{ row['结余库存'] }}</td>
          </tr>
          <tr v-if="!issues.length">
            <td :colspan="issueColumns.length" class="empty-state">暂无领用单</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-show="activeTab === 'count'">
      <form class="filter-bar" @submit.prevent="submitCountForm">
        <label class="filter-item">
          <span>盘点单号</span>
          <input v-model="countForm.盘点单号" />
        </label>
        <button class="btn ghost" type="button" @click="refreshCountNo">换下一张</button>
        <label class="filter-item">
          <span>库位</span>
          <select v-model="countForm.库位">
            <option value="" disabled>选择库位</option>
            <option v-for="location in locations" :key="location" :value="location">{{ location }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>插件型号</span>
          <select v-model="countForm.插件型号">
            <option value="" disabled>选择型号</option>
            <option v-for="model in modelsAt(countForm.库位)" :key="model" :value="model">{{ model }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>账面数量</span>
          <input :value="bookNow" readonly />
        </label>
        <label class="filter-item">
          <span>实盘数量</span>
          <input v-model.number="countForm.实盘数量" type="number" min="0" />
        </label>
        <label class="filter-item">
          <span>盘点日期</span>
          <input v-model="countForm.盘点日期" type="date" />
        </label>
        <label class="filter-item">
          <span>盘点人</span>
          <input v-model="countForm.盘点人" />
        </label>
        <button class="btn primary" type="submit">提交盘点</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in countColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in counts" :key="String(row.id)">
            <td>{{ row['盘点单号'] }}</td>
            <td>{{ row['盘点日期'] }}</td>
            <td>{{ row['库位'] }}</td>
            <td>{{ row['插件型号'] }}</td>
            <td>{{ row['账面数量'] }}</td>
            <td>{{ row['实盘数量'] }}</td>
            <td>{{ row['盈亏'] }}</td>
            <td>{{ row['盘点人'] }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row['处理说明'] }}</td>
          </tr>
          <tr v-if="!counts.length">
            <td :colspan="countColumns.length" class="empty-state">暂无盘点记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <datalist id="location-options">
      <option v-for="location in locations" :key="location" :value="location" />
    </datalist>
    <datalist id="substation-options">
      <option v-for="station in substationOptions" :key="station" :value="station" />
    </datalist>

    <footer class="page-foot">
      <span>库存台账与领用单共用同一份库存数量；账实冲突时以最近一次盘点为准</span>
      <span>共 {{ allBatches.length }} 个批次 · {{ issues.length }} 张领用单 · {{ counts.length }} 张盘点单</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  addBatch,
  groupedLedger,
  issuableQuantity,
  isBelowMin,
  listIssues,
  listStocktakes,
  batchesOf,
  setBatchFrozen,
  submitIssue,
  submitStocktake,
  SPAREPART_KEY,
} from '@/api/sparepart-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const ledgerColumns = ['库位', '插件型号', '批次号', '入库日期', '库存数量', '最低储备', '缺口', '储备状态']
const issueColumns = ['领用单号', '申请日期', '库位', '插件型号', '领用数量', '去向变电站', '检修单号', '领用人', '状态', '处理说明', '结余库存']
const countColumns = ['盘点单号', '盘点日期', '库位', '插件型号', '账面数量', '实盘数量', '盈亏', '盘点人', '状态', '处理说明']
const tabs = [
  { key: 'ledger', label: '库存台账' },
  { key: 'issue', label: '领用登记' },
  { key: 'count', label: '盘点记录' },
] as const
const substationOptions = ['东湖110kV变电站', '西郊220kV变电站', '北塔110kV变电站', '南苑35kV变电站', '滨江220kV变电站']

type TabKey = (typeof tabs)[number]['key']

const activeTab = ref<TabKey>('ledger')
const allBatches = ref<EntryRow[]>([])
const ledger = ref(groupedLedger())
const issues = ref<EntryRow[]>([])
const counts = ref<EntryRow[]>([])
const feedback = ref<{ ok: boolean; text: string } | null>(null)

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextSlipNo(prefix: string, rows: EntryRow[], dateField: string): string {
  const day = today().replace(/-/g, '')
  const seq = rows.filter((row) => row[dateField] === today()).length + 1
  return `${prefix}-${day}-${String(seq).padStart(3, '0')}`
}

const batchForm = ref({ 库位: '', 插件型号: '', 批次号: '', 入库日期: today(), 库存数量: 1, 最低储备: 1 })
const issueForm = ref({
  领用单号: '',
  库位: '',
  插件型号: '',
  领用数量: 1,
  去向变电站: '',
  检修单号: '',
  领用人: store.operator,
  申请日期: today(),
})
const countForm = ref({ 盘点单号: '', 库位: '', 插件型号: '', 实盘数量: 0, 盘点人: store.operator, 盘点日期: today() })

const locations = computed(() => [...new Set(allBatches.value.map((row) => String(row['库位'])))].sort())

const issuableNow = computed(() =>
  issueForm.value.库位 && issueForm.value.插件型号
    ? issuableQuantity(issueForm.value.库位, issueForm.value.插件型号)
    : 0,
)

const bookNow = computed(() =>
  countForm.value.库位 && countForm.value.插件型号
    ? batchesOf(countForm.value.库位, countForm.value.插件型号).reduce(
        (sum, row) => sum + Number(row['库存数量']),
        0,
      )
    : 0,
)

const stats = computed(() => [
  { label: '在库批次', value: allBatches.value.length },
  { label: '可领用批次', value: allBatches.value.filter((row) => row.status === '可领用').length },
  { label: '储备不足批次', value: allBatches.value.filter(isBelowMin).length },
  { label: '已冻结批次', value: allBatches.value.filter((row) => row.status === '已冻结').length },
])

function modelsAt(location: string): string[] {
  if (!location) {
    return []
  }
  return [
    ...new Set(
      allBatches.value.filter((row) => row['库位'] === location).map((row) => String(row['插件型号'])),
    ),
  ].sort()
}

function gapOf(row: EntryRow): string {
  const gap = Number(row['最低储备']) - Number(row['库存数量'])
  return gap > 0 ? `差${gap}件` : '—'
}

function exportRows() {
  downloadEntries(SPAREPART_KEY)
}

function refreshIssueNo() {
  issueForm.value.领用单号 = nextSlipNo('LY', listIssues(), '申请日期')
}

function refreshCountNo() {
  countForm.value.盘点单号 = nextSlipNo('PD', listStocktakes(), '盘点日期')
}

function submitBatch() {
  const result = addBatch(batchForm.value)
  feedback.value = { ok: result.ok, text: result.message }
  if (result.ok) {
    batchForm.value = { ...batchForm.value, 批次号: '', 库存数量: 1 }
  }
  reload()
}

function toggleFreeze(row: EntryRow) {
  const result = setBatchFrozen(Number(row.id), row.status !== '已冻结')
  feedback.value = { ok: result.ok, text: result.message }
  reload()
}

function submitIssueForm() {
  const result = submitIssue(issueForm.value)
  feedback.value = { ok: result.ok, text: result.message }
  reload()
}

function submitCountForm() {
  const result = submitStocktake(countForm.value)
  feedback.value = { ok: result.ok, text: result.message }
  reload()
}

function reload() {
  allBatches.value = [...listRows(SPAREPART_KEY)]
  ledger.value = groupedLedger()
  issues.value = listIssues()
  counts.value = listStocktakes()
}

onMounted(() => {
  reload()
  refreshIssueNo()
  refreshCountNo()
})
</script>

<style scoped>
.tab-bar { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
.tab-item { border: none; background: none; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; }
.tab-item.active { color: var(--brand); border-bottom-color: var(--brand); font-weight: 600; }
.group-title { font-size: 14px; margin: 16px 0 8px; }
.group-title.warning { color: #b42318; }
.row-warning td { background: #fef3f2; }
.feedback { margin: 0 0 10px; font-size: 13px; }
.ok-text { color: #067647; }
.filter-item select, .filter-item input { min-width: 150px; padding: 5px 6px; border: 1px solid var(--border); border-radius: 6px; }
</style>
