import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 备品备件模块的三本账：库存台账（批次）、领用单、盘点记录。
// 库存数量只有 sparepart 这一份，领用单扣减的就是它，页面两处看到的自然是同一个数。
export const SPAREPART_KEY = 'sparepart'
export const SPAREISSUE_KEY = 'spareissue'
export const SPARECOUNT_KEY = 'sparecount'
const DEFECT_KEY = 'defect'

export type IssueInput = {
  领用单号: string
  库位: string
  插件型号: string
  领用数量: number
  去向变电站: string
  检修单号: string
  领用人: string
  申请日期: string
}

export type StocktakeInput = {
  盘点单号: string
  库位: string
  插件型号: string
  实盘数量: number
  盘点人: string
  盘点日期: string
}

export type BatchInput = {
  库位: string
  插件型号: string
  批次号: string
  入库日期: string
  库存数量: number
  最低储备: number
}

export type LedgerGroups = {
  belowMin: EntryRow[]
  locations: { location: string; rows: EntryRow[] }[]
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** 库存数量压到最低储备线以下（严格小于）即为低于下限。 */
export function isBelowMin(row: EntryRow): boolean {
  return Number(row['库存数量']) < Number(row['最低储备'])
}

/** 低于下限的批次不允许保存成「可领用」：每次落库前统一过这道闸。 */
function withReserveStatus(row: EntryRow): EntryRow {
  if (row.status === '已冻结') {
    return { ...row, 储备状态: '已冻结', pending: isBelowMin(row) }
  }
  const status = isBelowMin(row) ? '储备不足' : '可领用'
  return { ...row, status, 储备状态: status, pending: isBelowMin(row) }
}

/** 同一库位同一型号的全部批次，按入库日期升序排——这就是先入先出的取用顺序。 */
export function batchesOf(location: string, model: string): EntryRow[] {
  return listRows(SPAREPART_KEY)
    .filter((row) => row['库位'] === location && row['插件型号'] === model)
    .sort((a, b) => String(a['入库日期']).localeCompare(String(b['入库日期'])) || Number(a.id) - Number(b.id))
}

/** 可领用库存：只有状态为「可领用」的批次计入，台账和领用单共用这一份数。 */
export function issuableQuantity(location: string, model: string): number {
  return batchesOf(location, model)
    .filter((row) => row.status === '可领用')
    .reduce((sum, row) => sum + Number(row['库存数量']), 0)
}

/** 台账分组：低于储备下限的批次单独归到最先一组，其余按库位排开。 */
export function groupedLedger(): LedgerGroups {
  const rows = listRows(SPAREPART_KEY)
  const belowMin = rows
    .filter(isBelowMin)
    .sort((a, b) => String(a['库位']).localeCompare(String(b['库位']), 'zh') || Number(a.id) - Number(b.id))
  const rest = rows.filter((row) => !isBelowMin(row))
  const byLocation = new Map<string, EntryRow[]>()
  for (const row of rest) {
    const location = String(row['库位'])
    const bucket = byLocation.get(location) ?? []
    bucket.push(row)
    byLocation.set(location, bucket)
  }
  const locations = [...byLocation.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh'))
    .map(([location, groupRows]) => ({
      location,
      rows: groupRows.sort(
        (a, b) => String(a['入库日期']).localeCompare(String(b['入库日期'])) || Number(a.id) - Number(b.id),
      ),
    }))
  return { belowMin, locations }
}

export function listIssues(): EntryRow[] {
  return [...listRows(SPAREISSUE_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

export function listStocktakes(): EntryRow[] {
  return [...listRows(SPARECOUNT_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

/** 登记入库：新批次落台账，低于下限的按规则落不成「可领用」。 */
export function addBatch(input: BatchInput): ActionResult {
  const location = input.库位.trim()
  const model = input.插件型号.trim()
  const batchNo = input.批次号.trim()
  if (!location || !model || !batchNo || !input.入库日期) {
    return { ok: false, message: '库位、插件型号、批次号、入库日期都要填' }
  }
  if (!isPositiveInt(input.库存数量) || !Number.isInteger(input.最低储备) || input.最低储备 < 0) {
    return { ok: false, message: '库存数量要是正整数，最低储备不能是负数' }
  }
  const rows = listRows(SPAREPART_KEY)
  const duplicated = rows.some(
    (row) => row['库位'] === location && row['插件型号'] === model && row['批次号'] === batchNo,
  )
  if (duplicated) {
    return { ok: false, message: `批次${batchNo}在${location}已经登记过，同一批次不重复入库` }
  }
  const row = withReserveStatus({
    id: nextId(rows),
    status: '可领用',
    pending: false,
    abnormal: false,
    库位: location,
    插件型号: model,
    批次号: batchNo,
    入库日期: input.入库日期,
    库存数量: input.库存数量,
    最低储备: input.最低储备,
    储备状态: '可领用',
  })
  saveRows(SPAREPART_KEY, [...rows, row])
  if (row.status === '储备不足') {
    return { ok: true, message: `批次${batchNo}已登记，但库存数量压到储备线以下，按规则不能保存为可领用，当前状态「储备不足」` }
  }
  return { ok: true, message: `批次${batchNo}已登记入库，当前状态「可领用」` }
}

/** 冻结/解冻批次：解冻要过储备下限这道闸。 */
export function setBatchFrozen(id: number, frozen: boolean): ActionResult {
  const rows = listRows(SPAREPART_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的备品批次` }
  }
  const row = rows[index]
  if (frozen) {
    if (row.status === '已冻结') {
      return { ok: false, message: `批次${row['批次号']}已经是「已冻结」` }
    }
    const next = [...rows]
    next[index] = { ...row, status: '已冻结', 储备状态: '已冻结', pending: isBelowMin(row) }
    saveRows(SPAREPART_KEY, next)
    return { ok: true, message: `批次${row['批次号']}已冻结，冻结期间不参与领用` }
  }
  if (row.status !== '已冻结') {
    return { ok: false, message: `批次${row['批次号']}不在冻结状态` }
  }
  if (isBelowMin(row)) {
    return { ok: false, message: `批次${row['批次号']}库存压到储备线以下，按规则不允许恢复为可领用` }
  }
  const next = [...rows]
  next[index] = withReserveStatus({ ...row, status: '可领用' })
  saveRows(SPAREPART_KEY, next)
  return { ok: true, message: `批次${row['批次号']}已解冻，恢复「可领用」` }
}

/** 领用通过的结论同步到缺陷处置的待处理清单。 */
function syncDefect(slip: IssueInput): void {
  const rows = listRows(DEFECT_KEY)
  const maxNo = rows.reduce((max, row) => {
    const matched = /^DEFE-(\d+)$/.exec(String(row['缺陷编号'] ?? ''))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0)
  const deadline = new Date()
  deadline.setDate(deadline.getDate() + 7)
  const defect: EntryRow = {
    id: nextId(rows),
    status: '待处理',
    pending: true,
    abnormal: false,
    缺陷编号: `DEFE-${String(maxNo + 1).padStart(4, '0')}`,
    缺陷设备: `${slip.去向变电站} ${slip.插件型号}`,
    缺陷等级: '一般',
    缺陷描述: `领用单${slip.领用单号}已通过：${slip.插件型号}×${slip.领用数量}发往${slip.去向变电站}（检修单${slip.检修单号}），待现场更换与消缺确认`,
    发现人: slip.领用人,
    处理期限: deadline.toISOString().slice(0, 10),
    处理人: slip.领用人,
    缺陷状态: '待处理',
  }
  saveRows(DEFECT_KEY, [...rows, defect])
}

/**
 * 提交领用单。
 * 顺序固定：先校验去向与检修单 → 单号查重（同一张单只入账一笔）→ 看库存 → 先入先出扣减 → 同步缺陷待处理。
 */
export function submitIssue(input: IssueInput): ActionResult {
  const slip: IssueInput = {
    ...input,
    领用单号: input.领用单号.trim(),
    库位: input.库位.trim(),
    插件型号: input.插件型号.trim(),
    去向变电站: input.去向变电站.trim(),
    检修单号: input.检修单号.trim(),
    领用人: input.领用人.trim(),
  }
  if (!slip.领用单号 || !slip.库位 || !slip.插件型号) {
    return { ok: false, message: '领用单号、库位、插件型号都要填' }
  }
  if (!slip.去向变电站 || !slip.检修单号) {
    return { ok: false, message: '领用必须写明去向变电站与检修单，两样都不能空' }
  }
  if (!slip.领用人) {
    return { ok: false, message: '领用人不能空' }
  }
  if (!isPositiveInt(slip.领用数量)) {
    return { ok: false, message: '领用数量要是正整数' }
  }

  const issues = listRows(SPAREISSUE_KEY)
  const existing = issues.find((row) => row['领用单号'] === slip.领用单号)
  if (existing) {
    return {
      ok: false,
      message: `领用单${slip.领用单号}已入账（${existing.status}），同一张领用单只入账一笔，本次未重复记账`,
    }
  }

  const batches = batchesOf(slip.库位, slip.插件型号)
  const issuable = batches
    .filter((row) => row.status === '可领用')
    .reduce((sum, row) => sum + Number(row['库存数量']), 0)
  const recordSlip = (status: string, note: string, pending: boolean, abnormal: boolean) => {
    const row: EntryRow = {
      id: nextId(listRows(SPAREISSUE_KEY)),
      status,
      pending,
      abnormal,
      领用单号: slip.领用单号,
      申请日期: slip.申请日期 || today(),
      库位: slip.库位,
      插件型号: slip.插件型号,
      领用数量: slip.领用数量,
      去向变电站: slip.去向变电站,
      检修单号: slip.检修单号,
      领用人: slip.领用人,
      处理说明: note,
      结余库存: issuableQuantity(slip.库位, slip.插件型号),
    }
    saveRows(SPAREISSUE_KEY, [...listRows(SPAREISSUE_KEY), row])
  }

  if (batches.length === 0) {
    const note = `台账中没有${slip.库位}的「${slip.插件型号}」，可领用0件，还差${slip.领用数量}件`
    recordSlip('已挡回', note, true, true)
    return { ok: false, message: `${note}，领用单已挡回` }
  }
  if (issuable < slip.领用数量) {
    const shortage = slip.领用数量 - issuable
    const locked = batches
      .filter((row) => row.status !== '可领用')
      .reduce((sum, row) => sum + Number(row['库存数量']), 0)
    const lockedNote = locked > 0 ? `（另有${locked}件压到储备下限，不可领用）` : ''
    const note = `库存不足：可领用${issuable}件，申请${slip.领用数量}件，还差${shortage}件${lockedNote}`
    recordSlip('已挡回', note, true, true)
    return { ok: false, message: `${note}，领用单已挡回` }
  }

  // 先入先出：入库日期最早的批次先出，扣完一个再扣下一个。
  let remaining = slip.领用数量
  const deducted: string[] = []
  const allRows = listRows(SPAREPART_KEY)
  const deductedIds = new Map<number, number>()
  for (const batch of batches) {
    if (remaining === 0) {
      break
    }
    if (batch.status !== '可领用') {
      continue
    }
    const take = Math.min(Number(batch['库存数量']), remaining)
    remaining -= take
    deducted.push(`${batch['批次号']}×${take}`)
    deductedIds.set(Number(batch.id), Number(batch['库存数量']) - take)
  }
  const nextRows = allRows.map((row) =>
    deductedIds.has(Number(row.id))
      ? withReserveStatus({ ...row, 库存数量: deductedIds.get(Number(row.id)) as number })
      : row,
  )
  saveRows(SPAREPART_KEY, nextRows)

  const note = `已按先入先出扣减：${deducted.join('、')}`
  recordSlip('已领用', note, false, false)
  syncDefect(slip)
  return { ok: true, message: `领用单${slip.领用单号}已通过，${note}，结论已同步缺陷处置待处理清单` }
}

/**
 * 提交盘点：账实冲突时按最近一次盘点的那份定。
 * 盘点日期早于该物资已入账的最近一次盘点的，记录为「未采用」，不动台账。
 */
export function submitStocktake(input: StocktakeInput): ActionResult {
  const entry: StocktakeInput = {
    ...input,
    盘点单号: input.盘点单号.trim(),
    库位: input.库位.trim(),
    插件型号: input.插件型号.trim(),
    盘点人: input.盘点人.trim(),
  }
  if (!entry.盘点单号 || !entry.库位 || !entry.插件型号 || !entry.盘点日期 || !entry.盘点人) {
    return { ok: false, message: '盘点单号、库位、插件型号、盘点日期、盘点人都要填' }
  }
  if (!Number.isInteger(entry.实盘数量) || entry.实盘数量 < 0) {
    return { ok: false, message: '实盘数量要是大于等于0的整数' }
  }

  const counts = listRows(SPARECOUNT_KEY)
  if (counts.some((row) => row['盘点单号'] === entry.盘点单号)) {
    return { ok: false, message: `盘点单${entry.盘点单号}已入账，同一张盘点单只记一笔` }
  }

  const batches = batchesOf(entry.库位, entry.插件型号)
  if (batches.length === 0) {
    return { ok: false, message: `台账中没有${entry.库位}的「${entry.插件型号}」，请先在台账登记入库再盘点` }
  }

  const book = batches.reduce((sum, row) => sum + Number(row['库存数量']), 0)
  const lastApplied = counts
    .filter(
      (row) => row.status === '已入账' && row['库位'] === entry.库位 && row['插件型号'] === entry.插件型号,
    )
    .reduce((latest, row) => {
      const date = String(row['盘点日期'])
      return date > latest ? date : latest
    }, '')

  const recordCount = (status: string, note: string, abnormal: boolean) => {
    const row: EntryRow = {
      id: nextId(listRows(SPARECOUNT_KEY)),
      status,
      pending: false,
      abnormal,
      盘点单号: entry.盘点单号,
      盘点日期: entry.盘点日期,
      库位: entry.库位,
      插件型号: entry.插件型号,
      账面数量: book,
      实盘数量: entry.实盘数量,
      盈亏: entry.实盘数量 - book,
      盘点人: entry.盘点人,
      处理说明: note,
    }
    saveRows(SPARECOUNT_KEY, [...listRows(SPARECOUNT_KEY), row])
  }

  if (lastApplied && entry.盘点日期 < lastApplied) {
    const note = `该物资已于${lastApplied}完成更新的盘点，账实以最近一次盘点为准，本次未采用`
    recordCount('未采用', note, false)
    return { ok: false, message: note }
  }

  // 账实不符就把差额调到账上：从最新入库的批次往回冲，数量不为负。
  let delta = entry.实盘数量 - book
  if (delta !== 0) {
    const adjustments = new Map<number, number>()
    const newestFirst = [...batches].sort(
      (a, b) => String(b['入库日期']).localeCompare(String(a['入库日期'])) || Number(b.id) - Number(a.id),
    )
    for (const batch of newestFirst) {
      if (delta === 0) {
        break
      }
      const current = Number(batch['库存数量'])
      const adjusted = Math.max(0, current + delta)
      delta -= adjusted - current
      adjustments.set(Number(batch.id), adjusted)
    }
    const nextRows = listRows(SPAREPART_KEY).map((row) =>
      adjustments.has(Number(row.id))
        ? withReserveStatus({ ...row, 库存数量: adjustments.get(Number(row.id)) as number })
        : row,
    )
    saveRows(SPAREPART_KEY, nextRows)
  }

  const diff = entry.实盘数量 - book
  const note = diff === 0 ? '账实相符' : `账实不符，按本次盘点调整台账（${diff > 0 ? '+' : ''}${diff}件）`
  recordCount('已入账', note, diff !== 0)
  return { ok: true, message: `盘点单${entry.盘点单号}已入账：${note}` }
}
