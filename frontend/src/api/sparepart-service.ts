import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 备品备件台账与插件领用单的领域规则都收在这里：
// 先入先出判定、储备下限、盘点入账、领用幂等与缺陷同步，页面只负责渲染。
export const SPAREPART_KEY = 'sparepart'
export const REQUISITION_KEY = 'requisition'
const DEFECT_KEY = 'defect'

const STATUS_USABLE = '可领用'
const STATUS_LOW = '低于储备'
const STATUS_FROZEN = '冻结'

export type LedgerGroup = {
  key: string
  label: string
  rows: EntryRow[]
}

export type LedgerInput = {
  库位: string
  插件型号: string
  批次号: string
  入库日期: string
  库存数量: number
  最低储备: number
}

export type RequisitionInput = {
  领用单号: string
  插件型号: string
  领用数量: number
  去向变电站: string
  关联检修单: string
  领用人: string
  领用日期: string
}

export type RequisitionResult = ActionResult & {
  duplicated: boolean
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function isBelowReserve(row: EntryRow): boolean {
  return num(row['库存数量']) < num(row['最低储备'])
}

function byLocationThenDate(a: EntryRow, b: EntryRow): number {
  return (
    String(a['库位']).localeCompare(String(b['库位']), 'zh') ||
    String(a['入库日期']).localeCompare(String(b['入库日期'])) ||
    Number(a.id) - Number(b.id)
  )
}

// 台账按库位排开，低于储备下限的单独归到最先一组。
export function listLedgerGroups(filters: Record<string, string> = {}): LedgerGroup[] {
  const matched = filterRows(listRows(SPAREPART_KEY), filters)
  const low = matched.filter(isBelowReserve).sort(byLocationThenDate)
  const normal = matched.filter((row) => !isBelowReserve(row)).sort(byLocationThenDate)
  return [
    { key: 'low', label: '低于储备下限（优先补库）', rows: low },
    { key: 'normal', label: '正常储备', rows: normal },
  ]
}

// 可领用批次按入库日期升序排，领用时从最早入库的开始扣，即先入先出。
function usableBatches(model: string): EntryRow[] {
  return listRows(SPAREPART_KEY)
    .filter(
      (row) =>
        row['插件型号'] === model && row.status === STATUS_USABLE && num(row['库存数量']) > 0,
    )
    .sort(
      (a, b) =>
        String(a['入库日期']).localeCompare(String(b['入库日期'])) || Number(a.id) - Number(b.id),
    )
}

// 台账与领用单看的是同一份库存：可用量永远从台账实时算，不在领用单上另存一份。
export function usableStock(model: string): number {
  return usableBatches(model).reduce((sum, row) => sum + num(row['库存数量']), 0)
}

export function ledgerModels(): string[] {
  const models = listRows(SPAREPART_KEY).map((row) => String(row['插件型号']))
  return [...new Set(models)]
}

export function createLedgerEntry(input: LedgerInput): ActionResult {
  if (!input.库位.trim() || !input.插件型号.trim() || !input.批次号.trim() || !input.入库日期) {
    return { ok: false, message: '库位、插件型号、批次号、入库日期都要填' }
  }
  if (!Number.isInteger(input.库存数量) || input.库存数量 < 0) {
    return { ok: false, message: '库存数量要是非负整数' }
  }
  if (!Number.isInteger(input.最低储备) || input.最低储备 < 0) {
    return { ok: false, message: '最低储备要是非负整数' }
  }
  const rows = listRows(SPAREPART_KEY)
  const duplicated = rows.some(
    (row) =>
      row['库位'] === input.库位.trim() &&
      row['插件型号'] === input.插件型号.trim() &&
      row['批次号'] === input.批次号.trim(),
  )
  if (duplicated) {
    return { ok: false, message: `${input.库位}已有该型号 ${input.批次号} 批次的条目，不要重复登记` }
  }
  const below = input.库存数量 < input.最低储备
  const row: EntryRow = {
    id: nextId(rows),
    status: below ? STATUS_LOW : STATUS_USABLE,
    pending: below,
    abnormal: below,
    库位: input.库位.trim(),
    插件型号: input.插件型号.trim(),
    批次号: input.批次号.trim(),
    入库日期: input.入库日期,
    库存数量: input.库存数量,
    最低储备: input.最低储备,
    最近盘点日: '',
    盘点数量: '',
  }
  saveRows(SPAREPART_KEY, [...rows, row])
  if (below) {
    return {
      ok: true,
      message: `库存数量${input.库存数量}件已压到储备线（${input.最低储备}件）以下，不允许保存成可领用，已按「低于储备」登记`,
    }
  }
  return { ok: true, message: `已登记到${input.库位}，当前状态「可领用」` }
}

// 盘点：账实冲突时按最近一次盘点的那份定，账面数直接以实盘数入账。
export function registerStocktake(id: number, counted: number): ActionResult {
  const rows = listRows(SPAREPART_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的库存条目` }
  }
  if (!Number.isInteger(counted) || counted < 0) {
    return { ok: false, message: '实盘数量要是非负整数' }
  }
  const row = rows[index]
  const book = num(row['库存数量'])
  const conflict = counted !== book
  const quantity = conflict ? counted : book
  let status = String(row.status)
  if (status !== STATUS_FROZEN) {
    status = quantity < num(row['最低储备']) ? STATUS_LOW : STATUS_USABLE
  }
  const updated: EntryRow = {
    ...row,
    库存数量: quantity,
    盘点数量: counted,
    最近盘点日: today(),
    status,
    pending: status !== STATUS_USABLE,
    abnormal: status === STATUS_LOW,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(SPAREPART_KEY, next)
  if (conflict) {
    return {
      ok: true,
      message: `账实不符：账面${book}件、实盘${counted}件，已按最近一次盘点入账（${book}→${counted}），当前状态「${status}」`,
    }
  }
  return { ok: true, message: `盘点一致，账面${book}件，盘点日${today()}已登记` }
}

export function setEntryFrozen(id: number, frozen: boolean): ActionResult {
  const rows = listRows(SPAREPART_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的库存条目` }
  }
  const row = rows[index]
  const status = frozen
    ? STATUS_FROZEN
    : isBelowReserve(row)
      ? STATUS_LOW
      : STATUS_USABLE
  const next = [...rows]
  next[index] = {
    ...row,
    status,
    pending: status !== STATUS_USABLE,
    abnormal: status === STATUS_LOW,
  }
  saveRows(SPAREPART_KEY, next)
  return { ok: true, message: frozen ? '批次已冻结，冻结期间不参与领用' : `已解除冻结，当前状态「${status}」` }
}

// 先入先出扣减：从入库最早的批次开始扣；扣完压到储备线以下的批次随即转为不可领用。
function deductFifo(model: string, quantity: number): string {
  const rows = listRows(SPAREPART_KEY)
  const batches = usableBatches(model)
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  let remaining = quantity
  const used: string[] = []
  const dropped: string[] = []
  for (const batch of batches) {
    if (remaining <= 0) {
      break
    }
    const take = Math.min(num(batch['库存数量']), remaining)
    const left = num(batch['库存数量']) - take
    remaining -= take
    used.push(`${batch['批次号']}×${take}`)
    const status = left < num(batch['最低储备']) ? STATUS_LOW : STATUS_USABLE
    if (status === STATUS_LOW) {
      dropped.push(String(batch['批次号']))
    }
    byId.set(Number(batch.id), {
      ...batch,
      库存数量: left,
      status,
      pending: true,
      abnormal: status === STATUS_LOW,
    })
  }
  saveRows(SPAREPART_KEY, rows.map((row) => byId.get(Number(row.id)) ?? row))
  const detail = `按先入先出扣减：${used.join('、')}`
  return dropped.length
    ? `${detail}；批次${dropped.join('、')}已压到储备线以下，转为不可领用`
    : detail
}

// 领用通过的结论同步到缺陷处置待处理清单；同一领用单号只同步一次。
function syncDefectToPending(req: EntryRow): void {
  const defects = listRows(DEFECT_KEY)
  const orderNo = String(req['领用单号'])
  if (defects.some((row) => String(row['来源单号'] ?? '') === orderNo)) {
    return
  }
  const id = nextId(defects)
  const row: EntryRow = {
    id,
    status: '待处理',
    pending: true,
    abnormal: false,
    缺陷编号: `DEFE-${String(id).padStart(4, '0')}`,
    缺陷设备: `${req['去向变电站']}·${req['插件型号']}`,
    缺陷等级: '一般',
    缺陷描述: `领用单${orderNo}已通过：${req['插件型号']}×${req['领用数量']}件发往${req['去向变电站']}，关联检修单${req['关联检修单']}`,
    发现人: req['领用人'],
    处理期限: plusDays(7),
    处理人: '检修班',
    缺陷状态: '待处理',
    来源单号: orderNo,
  }
  saveRows(DEFECT_KEY, [...defects, row])
}

function buildRequisitionRow(input: RequisitionInput, status: string, conclusion: string): EntryRow {
  return {
    id: nextId(listRows(REQUISITION_KEY)),
    status,
    pending: status !== '已通过',
    abnormal: status === '已挡回',
    领用单号: input.领用单号.trim(),
    插件型号: input.插件型号,
    领用数量: input.领用数量,
    去向变电站: input.去向变电站.trim(),
    关联检修单: input.关联检修单.trim(),
    领用人: input.领用人.trim(),
    领用日期: input.领用日期,
    审核结论: conclusion,
  }
}

// 提交领用单：同一单号重复提交只入账一笔；库存够就按先入先出扣减并同步缺陷清单，不够就挡回并说明还差几件。
export function submitRequisition(input: RequisitionInput): RequisitionResult {
  const orderNo = input.领用单号.trim()
  if (!orderNo || !input.插件型号 || !input.去向变电站.trim() || !input.关联检修单.trim() || !input.领用人.trim() || !input.领用日期) {
    return { ok: false, duplicated: false, message: '领用单号、插件型号、去向变电站、关联检修单、领用人、领用日期都要填' }
  }
  if (!Number.isInteger(input.领用数量) || input.领用数量 <= 0) {
    return { ok: false, duplicated: false, message: '领用数量要是正整数' }
  }
  const rows = listRows(REQUISITION_KEY)
  const existing = rows.find((row) => String(row['领用单号']) === orderNo)
  if (existing) {
    return {
      ok: true,
      duplicated: true,
      message: `领用单${orderNo}此前已入账（${existing.status}），重复提交只记一笔，库存不再变动`,
    }
  }
  const usable = usableStock(input.插件型号)
  const shortage = input.领用数量 - usable
  if (shortage > 0) {
    const conclusion = `库存不够，还差${shortage}件（可领用${usable}件）`
    saveRows(REQUISITION_KEY, [...rows, buildRequisitionRow(input, '已挡回', conclusion)])
    return { ok: false, duplicated: false, message: `领用被挡回：${input.插件型号}可领用库存${usable}件，还差${shortage}件` }
  }
  const detail = deductFifo(input.插件型号, input.领用数量)
  const row = buildRequisitionRow(input, '已通过', `${detail}，结论已同步缺陷处置待处理清单`)
  saveRows(REQUISITION_KEY, [...listRows(REQUISITION_KEY), row])
  syncDefectToPending(row)
  return { ok: true, duplicated: false, message: `领用通过：${detail}，结论已同步缺陷处置待处理清单` }
}

export function listRequisitions(filters: Record<string, string> = {}): EntryRow[] {
  return filterRows(listRows(REQUISITION_KEY), filters)
}

export function suggestOrderNo(): string {
  const stamp = today().replace(/-/g, '')
  const count = listRows(REQUISITION_KEY).filter((row) =>
    String(row['领用单号']).includes(stamp),
  ).length
  return `LY-${stamp}-${String(count + 1).padStart(3, '0')}`
}
