import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { chunk, fetchAllRows } from './lib/fetchAll'
import { countWorkingDays, currentMonthWib, monthBounds } from './lib/dates'

type Unit = { id: string; code: string; name: string; parent_unit_id: string | null; is_active: boolean; unit_type: 'group' | 'operational' }
type Position = { id: string; code: string; name: string; is_active: boolean }
type Employee = { id: string; full_name: string; employment_status: 'active' | 'inactive' | 'on_leave'; start_date: string | null; end_date: string | null; created_at: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: 'active' | 'inactive'; start_date: string; end_date: string | null; work_arrangement: 'monthly' | 'hourly' | 'session' | 'shift' | 'other' }
type Access = { unit_id: string; access_role: 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' }
type Props = { units: Unit[]; employees: Employee[]; assignments: Assignment[]; positions: Position[]; accesses: Access[]; isHrAdmin: boolean; isPimpinan: boolean }

type Summary = {
  id: string; assignment_id: string; period_month: string; work_days: number; present_days: number; late_days: number; late_minutes: number
  excused_days: number; sick_days: number; leave_days: number; alpha_days: number; notes: string | null; status: 'draft' | 'final'; source: 'manual' | 'import'
}
type Draft = { workDays: string; present: string; late: string; lateMinutes: string; excused: string; sick: string; leave: string; alpha: string; notes: string; source: 'manual' | 'import' }
type Hint = { assignment_id: string; sick_days: number; leave_days: number; excused_days: number }
type ImportRow = { excelRow: number; name: string; title: string; assignmentId: string; draft: Draft; errors: string[] }
type Mode = 'input' | 'import'

const summaryColumns = 'id, assignment_id, period_month, work_days, present_days, late_days, late_minutes, excused_days, sick_days, leave_days, alpha_days, notes, status, source'
const dayFields = ['present', 'late', 'excused', 'sick', 'leave', 'alpha'] as const
type DayField = typeof dayFields[number]
const columnDefs: { key: DayField; label: string; hint: string }[] = [
  { key: 'present', label: 'Hadir', hint: 'Hari hadir tepat waktu' },
  { key: 'late', label: 'Hadir terlambat', hint: 'Hari hadir tetapi terlambat' },
  { key: 'excused', label: 'Izin', hint: 'Hari izin' },
  { key: 'sick', label: 'Sakit', hint: 'Hari sakit' },
  { key: 'leave', label: 'Cuti', hint: 'Hari cuti' },
  { key: 'alpha', label: 'Alpa', hint: 'Hari tidak hadir tanpa keterangan' },
]

const normalize = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('id-ID').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const blankDraft = (workDays: string): Draft => ({ workDays, present: '', late: '', lateMinutes: '', excused: '', sick: '', leave: '', alpha: '', notes: '', source: 'manual' })
const show = (n: number) => (n ? String(n) : '')
const draftFromSummary = (s: Summary): Draft => ({ workDays: String(s.work_days), present: show(s.present_days), late: show(s.late_days), lateMinutes: show(s.late_minutes), excused: show(s.excused_days), sick: show(s.sick_days), leave: show(s.leave_days), alpha: show(s.alpha_days), notes: s.notes || '', source: s.source })
const toNumber = (v: string) => (v.trim() === '' ? 0 : Number(v))
const isWholeNumber = (v: string, max: number) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) <= max)
const totalDays = (d: Draft) => dayFields.reduce((sum, key) => sum + toNumber(d[key]), 0)
const hasEntry = (d: Draft) => dayFields.some((key) => d[key].trim() !== '') || d.lateMinutes.trim() !== '' || d.notes.trim() !== ''
const signature = (d: Draft) => [toNumber(d.workDays), ...dayFields.map((key) => toNumber(d[key])), toNumber(d.lateMinutes), d.notes.trim()].join('|')

function validateDraft(d: Draft): string {
  if (!/^\d+$/.test(d.workDays.trim()) || Number(d.workDays) > 31) return 'Hari wajib harus angka 0–31.'
  for (const key of dayFields) if (!isWholeNumber(d[key], 31)) return 'Jumlah hari harus angka bulat 0–31.'
  if (!isWholeNumber(d.lateMinutes, 99999)) return 'Menit terlambat harus angka bulat.'
  const total = totalDays(d)
  if (total > Number(d.workDays)) return `Total ${total} hari melebihi hari wajib ${d.workDays}.`
  if (toNumber(d.lateMinutes) > 0 && toNumber(d.late) === 0) return 'Menit terlambat diisi, tetapi hari terlambat masih 0.'
  if (d.notes.length > 500) return 'Catatan maksimal 500 karakter.'
  return ''
}

function parseStatusNumber(value: unknown): string {
  if (value === '' || value === null || value === undefined) return ''
  const n = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(n) ? String(n) : String(value)
}
function valueByAliases(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row)
  for (const alias of aliases) {
    const found = entries.find(([key]) => normalize(key) === normalize(alias))
    if (found) return found[1]
  }
  return ''
}

export default function AttendanceModule({ units, employees, assignments, positions, accesses, isHrAdmin, isPimpinan }: Props) {
  const allowedUnits = useMemo(() => isHrAdmin || isPimpinan ? units : units.filter((u) => accesses.some((a) => a.unit_id === u.id && ['kepala_unit', 'petugas_absensi'].includes(a.access_role))), [units, accesses, isHrAdmin, isPimpinan])
  const [unitId, setUnitId] = useState('')
  const [month, setMonth] = useState(currentMonthWib())
  const [mode, setMode] = useState<Mode>('input')
  const [defaultWorkDays, setDefaultWorkDays] = useState(String(countWorkingDays(currentMonthWib())))
  const [saved, setSaved] = useState<Summary[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [hints, setHints] = useState<Record<string, Hint>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importRows, setImportRows] = useState<ImportRow[]>([])

  const { first: firstDay, last: lastDay } = monthBounds(month)
  const unitAssignments = useMemo(() => assignments.filter((a) => a.unit_id === unitId && a.status === 'active' && a.start_date <= lastDay && (!a.end_date || a.end_date >= firstDay) && employees.some((e) => e.id === a.employee_id && e.employment_status !== 'inactive')), [assignments, unitId, firstDay, lastDay, employees])
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])) as Record<string, Employee>, [employees])
  const positionMap = useMemo(() => Object.fromEntries(positions.map((p) => [p.id, p.name])) as Record<string, string>, [positions])
  const assignmentTitle = useCallback((a: Assignment) => a.assignment_title || positionMap[a.position_id || ''] || 'Penugasan', [positionMap])
  const sortedAssignments = useMemo(() => [...unitAssignments].sort((a, b) => (employeeMap[a.employee_id]?.full_name || '').localeCompare(employeeMap[b.employee_id]?.full_name || '', 'id')), [unitAssignments, employeeMap])
  const savedMap = useMemo(() => Object.fromEntries(saved.map((s) => [s.assignment_id, s])) as Record<string, Summary>, [saved])
  const selectedUnit = allowedUnits.find((u) => u.id === unitId)
  const canManage = isHrAdmin || accesses.some((a) => a.unit_id === unitId && ['kepala_unit', 'petugas_absensi'].includes(a.access_role))
  const canFinalize = isHrAdmin || accesses.some((a) => a.unit_id === unitId && a.access_role === 'kepala_unit')
  const assignmentKey = sortedAssignments.map((a) => a.id).join(',')

  useEffect(() => { if (!unitId && allowedUnits.length) setUnitId(allowedUnits[0].id) }, [allowedUnits, unitId])
  useEffect(() => { setDefaultWorkDays(String(countWorkingDays(month))) }, [month])

  const refresh = useCallback(async () => {
    if (!supabase || !unitId) { setSaved([]); setHints({}); return }
    const ids = assignmentKey ? assignmentKey.split(',') : []
    if (!ids.length) { setSaved([]); setHints({}); return }
    setLoading(true); setError('')
    const idSet = new Set(ids)
    const result = await fetchAllRows<Summary>((from, to) => supabase!.from('attendance_monthly_summaries').select(summaryColumns).eq('period_month', firstDay).order('assignment_id').range(from, to))
    if (result.error) setError(`Rekap absensi belum dapat dimuat: ${result.error.message}. Pastikan 15_attendance_monthly_summary.sql sudah dijalankan.`)
    else setSaved(result.data.filter((s) => idSet.has(s.assignment_id)))
    const hintRes = await supabase.rpc('attendance_absence_hints', { p_unit_id: unitId, p_period: firstDay })
    if (!hintRes.error) setHints(Object.fromEntries(((hintRes.data ?? []) as Hint[]).map((h) => [h.assignment_id, h])))
    else setHints({})
    setLoading(false)
  }, [unitId, assignmentKey, firstDay])

  useEffect(() => { void refresh() }, [refresh])

  // Bangun ulang isian tabel setiap data tersimpan berubah atau unit/bulan berganti.
  useEffect(() => {
    const next: Record<string, Draft> = {}
    for (const a of sortedAssignments) next[a.id] = savedMap[a.id] ? draftFromSummary(savedMap[a.id]) : blankDraft(defaultWorkDays)
    setDrafts(next)
    // defaultWorkDays sengaja tidak menjadi dependensi: perubahan manual tidak boleh menimpa isian.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, assignmentKey, month])

  const isFinal = (id: string) => savedMap[id]?.status === 'final'
  const isDirty = (id: string) => {
    const d = drafts[id]
    if (!d) return false
    const s = savedMap[id]
    return s ? signature(d) !== signature(draftFromSummary(s)) : hasEntry(d)
  }
  const rowStatus = (id: string) => isFinal(id) ? 'final' : isDirty(id) ? 'dirty' : savedMap[id] ? 'saved' : 'empty'
  const dirtyIds = sortedAssignments.filter((a) => !isFinal(a.id) && isDirty(a.id)).map((a) => a.id)
  const savedCount = sortedAssignments.filter((a) => savedMap[a.id]).length
  const finalCount = sortedAssignments.filter((a) => isFinal(a.id)).length

  const totals = useMemo(() => {
    let workDays = 0, attended = 0
    for (const a of sortedAssignments) {
      const s = savedMap[a.id]
      if (!s) continue
      workDays += s.work_days
      attended += s.present_days + s.late_days
    }
    return { workDays, attended, percent: workDays ? Math.round((attended / workDays) * 1000) / 10 : null }
  }, [sortedAssignments, savedMap])

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || blankDraft(defaultWorkDays)), ...patch } }))
    setMessage('')
  }
  function applyDefaultWorkDays() {
    if (!/^\d+$/.test(defaultWorkDays) || Number(defaultWorkDays) > 31) { setError('Hari kerja bulan ini harus angka 0–31.'); return }
    setError('')
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, isFinal(id) ? d : { ...d, workDays: defaultWorkDays }])))
  }
  function fillRemainingAsPresent() {
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).map(([id, d]) => {
      if (isFinal(id) || !/^\d+$/.test(d.workDays.trim())) return [id, d]
      const remaining = Number(d.workDays) - totalDays(d)
      return [id, remaining > 0 ? { ...d, present: String(toNumber(d.present) + remaining) } : d]
    })))
    setMessage('Sisa hari di semua baris diisi sebagai Hadir. Periksa lalu klik Simpan.')
  }
  function applyHint(id: string) {
    const h = hints[id]
    if (!h) return
    updateDraft(id, { sick: show(h.sick_days), leave: show(h.leave_days), excused: show(h.excused_days) })
  }

  async function saveAll() {
    if (!supabase || !canManage || !dirtyIds.length) return
    const problems: string[] = []
    for (const id of dirtyIds) {
      const problem = validateDraft(drafts[id])
      if (problem) {
        const a = sortedAssignments.find((x) => x.id === id)
        problems.push(`${employeeMap[a?.employee_id || '']?.full_name || 'SDM'}: ${problem}`)
      }
    }
    if (problems.length) { setError(`Perbaiki dulu ${problems.length} baris. ${problems.slice(0, 3).join(' · ')}${problems.length > 3 ? ' · …' : ''}`); return }
    setBusy(true); setError(''); setMessage('')
    const payload = dirtyIds.map((id) => {
      const d = drafts[id]
      return { assignment_id: id, period_month: firstDay, work_days: toNumber(d.workDays), present_days: toNumber(d.present), late_days: toNumber(d.late), late_minutes: toNumber(d.lateMinutes), excused_days: toNumber(d.excused), sick_days: toNumber(d.sick), leave_days: toNumber(d.leave), alpha_days: toNumber(d.alpha), notes: d.notes.trim() || null, source: d.source }
    })
    const { error: saveError } = await supabase.from('attendance_monthly_summaries').upsert(payload, { onConflict: 'assignment_id,period_month' })
    if (saveError) setError(`Gagal menyimpan: ${saveError.message}`)
    else { setMessage(`${payload.length} rekap berhasil disimpan sebagai draft.`); await refresh() }
    setBusy(false)
  }

  async function setStatusForUnit(next: 'final' | 'draft') {
    if (!supabase || !canFinalize) return
    const ids = sortedAssignments.filter((a) => savedMap[a.id] && savedMap[a.id].status !== next).map((a) => savedMap[a.id].id)
    if (!ids.length) return
    if (next === 'final') {
      if (dirtyIds.length) { setError('Simpan dulu perubahan yang belum disimpan sebelum memfinalkan.'); return }
      const missing = sortedAssignments.length - savedCount
      const incomplete = sortedAssignments.filter((a) => savedMap[a.id] && totalDays(draftFromSummary(savedMap[a.id])) < savedMap[a.id].work_days).length
      const notes = [missing ? `${missing} SDM belum diinput` : '', incomplete ? `${incomplete} SDM hari wajibnya belum terisi penuh` : ''].filter(Boolean).join(' dan ')
      const text = `Finalkan rekap ${selectedUnit?.name || 'unit'} bulan ${month}?${notes ? `\n\nPerhatian: ${notes}.` : ''}\n\nRekap final terkunci untuk petugas absensi dan masuk ke laporan.`
      if (!window.confirm(text)) return
    } else if (!window.confirm('Buka kembali rekap final agar bisa diubah? Perubahan ini tercatat di jejak audit.')) return
    setBusy(true); setError(''); setMessage('')
    for (const part of chunk(ids)) {
      const { error: updateError } = await supabase.from('attendance_monthly_summaries').update({ status: next }).in('id', part)
      if (updateError) { setError(`Gagal mengubah status rekap: ${updateError.message}`); setBusy(false); await refresh(); return }
    }
    setMessage(next === 'final' ? `${ids.length} rekap difinalkan.` : `${ids.length} rekap dibuka kembali sebagai draft.`)
    await refresh()
    setBusy(false)
  }

  function downloadTemplate() {
    const data = sortedAssignments.map((a) => {
      const d = drafts[a.id] || blankDraft(defaultWorkDays)
      return { nama_lengkap: employeeMap[a.employee_id]?.full_name || '', jabatan: assignmentTitle(a), hari_wajib: toNumber(d.workDays), hadir: toNumber(d.present), hadir_terlambat: toNumber(d.late), menit_terlambat: toNumber(d.lateMinutes), izin: toNumber(d.excused), sakit: toNumber(d.sick), cuti: toNumber(d.leave), alpa: toNumber(d.alpha), catatan: d.notes }
    })
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ nama_lengkap: '', jabatan: '', hari_wajib: '', hadir: '', hadir_terlambat: '', menit_terlambat: '', izin: '', sakit: '', cuti: '', alpa: '', catatan: '' }])
    ws['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 11 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 30 }]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rekap Bulanan')
    XLSX.writeFile(wb, `Rekap_Absensi_${(selectedUnit?.name || 'Unit').replace(/[^a-z0-9]/gi, '_')}_${month}.xlsx`)
  }

  async function readImportFile(file?: File) {
    if (!file) return
    setImportFileName(file.name); setImportRows([]); setError(''); setMessage('')
    if (file.size > 5 * 1024 * 1024) { setError('Ukuran file maksimal 5 MB.'); return }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) throw new Error('Sheet pertama tidak ditemukan.')
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (!raw.length) throw new Error('File tidak memiliki baris data.')
      if (raw.length > 2000) throw new Error('File maksimal 2000 baris.')
      const seen = new Set<string>()
      const parsed: ImportRow[] = raw.map((r, idx) => {
        const name = String(valueByAliases(r, ['nama_lengkap', 'nama lengkap', 'nama', 'full_name'])).trim()
        const title = String(valueByAliases(r, ['jabatan', 'nama_tugas', 'assignment_title', 'tugas'])).trim()
        const draft: Draft = {
          workDays: parseStatusNumber(valueByAliases(r, ['hari_wajib', 'hari wajib', 'hari_kerja', 'work_days'])) || defaultWorkDays,
          present: parseStatusNumber(valueByAliases(r, ['hadir', 'present'])),
          late: parseStatusNumber(valueByAliases(r, ['hadir_terlambat', 'terlambat', 'terlambat_hari', 'late'])),
          lateMinutes: parseStatusNumber(valueByAliases(r, ['menit_terlambat', 'late_minutes'])),
          excused: parseStatusNumber(valueByAliases(r, ['izin', 'excused'])),
          sick: parseStatusNumber(valueByAliases(r, ['sakit', 'sick'])),
          leave: parseStatusNumber(valueByAliases(r, ['cuti', 'leave'])),
          alpha: parseStatusNumber(valueByAliases(r, ['alpa', 'alpha'])),
          notes: String(valueByAliases(r, ['catatan', 'keterangan', 'notes']) || '').trim(),
          source: 'import',
        }
        const errors: string[] = []
        if (!name) errors.push('Nama kosong.')
        if (!title) errors.push('Jabatan kosong.')
        const matched = sortedAssignments.filter((a) => normalize(employeeMap[a.employee_id]?.full_name) === normalize(name) && normalize(assignmentTitle(a)) === normalize(title))
        if (matched.length !== 1) errors.push(matched.length ? 'Nama dan jabatan cocok ke lebih dari satu penugasan.' : 'Nama dan jabatan tidak ditemukan pada unit terpilih.')
        else {
          if (seen.has(matched[0].id)) errors.push('Duplikat penugasan dalam file.')
          seen.add(matched[0].id)
          if (isFinal(matched[0].id)) errors.push('Rekap bulan ini sudah final.')
        }
        const problem = validateDraft(draft)
        if (problem) errors.push(problem)
        return { excelRow: idx + 2, name, title, assignmentId: matched.length === 1 ? matched[0].id : '', draft, errors }
      })
      setImportRows(parsed)
      const bad = parsed.filter((r) => r.errors.length).length
      if (bad) setError(`${bad} baris perlu diperbaiki sebelum diterapkan.`)
      else setMessage(`${parsed.length} baris valid. Klik Terapkan ke tabel, lalu Simpan.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'File tidak dapat dibaca.') }
  }

  function applyImport() {
    if (importRows.some((r) => r.errors.length)) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of importRows) next[r.assignmentId] = r.draft
      return next
    })
    setImportRows([]); setImportFileName(''); setMode('input')
    setMessage('Data Excel sudah masuk ke tabel. Periksa, lalu klik Simpan semua.')
  }

  if (!allowedUnits.length) return <section className="content-card"><div className="section-head"><div><p className="eyebrow">REKAP ABSENSI BULANAN</p><h2>Belum ada unit dalam akses akun</h2><p className="muted">Minta Sekjen menetapkan peran Kepala Unit atau Petugas Absensi pada unit yang sesuai.</p></div></div></section>

  const badge = (id: string) => {
    const s = rowStatus(id)
    const map = { final: ['Final', 'status active'], dirty: ['Belum disimpan', 'status on_leave'], saved: ['Draft tersimpan', 'status'], empty: ['Belum diinput', 'status inactive'] } as const
    return <span className={map[s][1]}>{map[s][0]}</span>
  }

  return <section className="attendance-module">
    <div className="content-card">
      <div className="section-head"><div><p className="eyebrow">REKAP ABSENSI BULANAN</p><h2>Input sekali sebulan</h2><p className="muted">Absensi harian dikelola sistem lain. Di sini cukup isi ringkasan satu bulan untuk setiap penugasan.</p></div><button className="btn secondary" onClick={() => void refresh()} disabled={loading}>↻ Segarkan</button></div>
      <div className="attendance-toolbar">
        <label>Unit operasional<select value={unitId} onChange={(e) => { setUnitId(e.target.value); setImportRows([]); setMessage(''); setError('') }}>{allowedUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label>Bulan rekap<input type="month" value={month} onChange={(e) => { setMonth(e.target.value || currentMonthWib()); setImportRows([]); setMessage(''); setError('') }}/></label>
        <label>Hari kerja bulan ini<div className="monthly-days-row"><input type="number" min="0" max="31" inputMode="numeric" value={defaultWorkDays} onChange={(e) => setDefaultWorkDays(e.target.value)} disabled={!canManage}/><button type="button" className="btn secondary" onClick={applyDefaultWorkDays} disabled={!canManage}>Terapkan ke semua</button></div></label>
      </div>
      <div className="attendance-subtabs" role="tablist" aria-label="Menu rekap"><button className={mode === 'input' ? 'active' : ''} onClick={() => setMode('input')}>Isi di tabel</button><button className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}>Impor Excel</button></div>
      {error && <div className="alert error attendance-alert" role="alert">{error}</div>}{message && <div className="alert success attendance-alert" role="status">{message}</div>}
      <div className="attendance-summary">
        <div className="attendance-summary-card"><span>SDM dalam unit</span><strong>{sortedAssignments.length}</strong></div>
        <div className="attendance-summary-card"><span>Sudah diinput</span><strong>{savedCount}</strong></div>
        <div className="attendance-summary-card"><span>Belum diinput</span><strong>{sortedAssignments.length - savedCount}</strong></div>
        <div className="attendance-summary-card"><span>Final</span><strong>{finalCount}</strong></div>
        <div className="attendance-summary-card"><span>Persentase hadir</span><strong>{totals.percent === null ? '—' : `${totals.percent.toLocaleString('id-ID')}%`}</strong></div>
      </div>

      {mode === 'input' && <>
        <div className="monthly-actions">
          <button type="button" className="btn secondary" onClick={fillRemainingAsPresent} disabled={!canManage || !sortedAssignments.length}>Isi sisa hari sebagai Hadir</button>
          <button type="button" className="btn secondary" onClick={downloadTemplate} disabled={!sortedAssignments.length}>Unduh Excel</button>
          <span className="monthly-spacer"/>
          {canFinalize && finalCount < savedCount && <button type="button" className="btn secondary" onClick={() => void setStatusForUnit('final')} disabled={busy || !savedCount}>Finalkan bulan ini</button>}
          {canFinalize && finalCount > 0 && <button type="button" className="btn secondary" onClick={() => void setStatusForUnit('draft')} disabled={busy}>Buka kembali</button>}
          <button type="button" className="btn primary" onClick={() => void saveAll()} disabled={!canManage || busy || !dirtyIds.length}>{busy ? 'Menyimpan…' : dirtyIds.length ? `Simpan ${dirtyIds.length} baris` : 'Tidak ada perubahan'}</button>
        </div>
        {loading ? <div className="empty-state">Memuat rekap…</div> : <div className="attendance-grid-wrap"><table className="attendance-grid monthly-grid"><thead><tr><th className="sticky-employee">SDM / Penugasan</th><th>Hari wajib</th>{columnDefs.map((c) => <th key={c.key} title={c.hint}>{c.label}</th>)}<th title="Total menit keterlambatan sebulan">Menit telat</th><th>Sisa</th><th>Catatan</th><th>Status</th></tr></thead><tbody>{sortedAssignments.map((a) => {
          const d = drafts[a.id] || blankDraft(defaultWorkDays)
          const locked = !canManage || isFinal(a.id) || busy
          const problem = hasEntry(d) ? validateDraft(d) : ''
          const remaining = /^\d+$/.test(d.workDays.trim()) ? Number(d.workDays) - totalDays(d) : 0
          const h = hints[a.id]
          const hasHint = h && (h.sick_days || h.leave_days || h.excused_days)
          const name = employeeMap[a.employee_id]?.full_name || 'SDM'
          return <tr key={a.id} className={problem ? 'monthly-row-error' : ''}>
            <td className="sticky-employee"><strong>{name}</strong><small>{assignmentTitle(a)}</small>{hasHint && !isFinal(a.id) && <button type="button" className="monthly-hint" disabled={!canManage} onClick={() => applyHint(a.id)} title="Isi Izin, Sakit, dan Cuti dari pengajuan yang disetujui">Pengajuan disetujui: {[h.sick_days ? `Sakit ${h.sick_days}` : '', h.excused_days ? `Izin ${h.excused_days}` : '', h.leave_days ? `Cuti ${h.leave_days}` : ''].filter(Boolean).join(' · ')} — pakai</button>}</td>
            <td><input className="monthly-num" inputMode="numeric" aria-label={`Hari wajib ${name}`} value={d.workDays} disabled={locked} onChange={(e) => updateDraft(a.id, { workDays: e.target.value })}/></td>
            {columnDefs.map((c) => <td key={c.key}><input className="monthly-num" inputMode="numeric" placeholder="0" aria-label={`${c.label} ${name}`} value={d[c.key]} disabled={locked} onChange={(e) => updateDraft(a.id, { [c.key]: e.target.value } as Partial<Draft>)}/></td>)}
            <td><input className="monthly-num wide" inputMode="numeric" placeholder="0" aria-label={`Menit terlambat ${name}`} value={d.lateMinutes} disabled={locked || toNumber(d.late) === 0} onChange={(e) => updateDraft(a.id, { lateMinutes: e.target.value })}/></td>
            <td className="monthly-remaining">{problem ? <span className="text-danger" title={problem}>⚠ {problem}</span> : !hasEntry(d) && !savedMap[a.id] ? <span className="muted">—</span> : remaining === 0 ? <span className="text-success">Lengkap</span> : <span className="monthly-warn">Sisa {remaining} hari</span>}</td>
            <td><input className="monthly-notes" aria-label={`Catatan ${name}`} value={d.notes} maxLength={500} disabled={locked} onChange={(e) => updateDraft(a.id, { notes: e.target.value })}/></td>
            <td>{badge(a.id)}</td>
          </tr>
        })}</tbody></table>{!sortedAssignments.length && <div className="empty-state">Belum ada penugasan aktif pada unit dan bulan ini.</div>}</div>}
        <p className="footnote">Hadir tepat waktu dan Hadir terlambat sama-sama dihitung hadir. Jumlah semua kolom hari tidak boleh melebihi Hari wajib; hari yang belum terisi ditampilkan sebagai Sisa. Rekap yang sudah Final hanya dapat dibuka kembali oleh Kepala Unit atau Sekjen.</p>
        {!canManage && <div className="alert warning">Akun ini hanya dapat melihat rekap. Input hanya untuk Sekjen, Kepala Unit, atau Petugas Absensi unit terkait.</div>}
      </>}

      {mode === 'import' && <>
        <div className="import-instructions"><h3>Format file Excel</h3><p>Klik <strong>Unduh Excel</strong> di tab Isi di tabel untuk mendapatkan template yang sudah berisi nama dan jabatan. Isi kolom <code>hari_wajib</code>, <code>hadir</code>, <code>hadir_terlambat</code>, <code>menit_terlambat</code>, <code>izin</code>, <code>sakit</code>, <code>cuti</code>, <code>alpa</code>. Satu baris sama dengan satu penugasan untuk satu bulan. Nama dan jabatan harus cocok dengan penugasan unit yang dipilih.</p></div>
        <label className="file-picker">Pilih file Excel (.xlsx, .xls) atau CSV<input type="file" accept=".xlsx,.xls,.csv" disabled={!canManage} onChange={(e) => void readImportFile(e.target.files?.[0])}/></label>
        {importFileName && <p className="muted">File: {importFileName} · {importRows.length} baris diperiksa.</p>}
        {importRows.length > 0 && <><div className="import-result"><strong>{importRows.filter((r) => !r.errors.length).length} valid</strong><strong className={importRows.some((r) => r.errors.length) ? 'text-danger' : ''}>{importRows.filter((r) => r.errors.length).length} bermasalah</strong></div><div className="table-wrap import-preview"><table><thead><tr><th>Baris</th><th>Nama</th><th>Jabatan</th><th>Wajib</th><th>Hadir</th><th>Telat</th><th>Izin</th><th>Sakit</th><th>Cuti</th><th>Alpa</th><th>Hasil</th></tr></thead><tbody>{importRows.map((r) => <tr key={r.excelRow}><td>{r.excelRow}</td><td>{r.name || '—'}</td><td>{r.title || '—'}</td><td>{r.draft.workDays}</td><td>{r.draft.present || 0}</td><td>{r.draft.late || 0}</td><td>{r.draft.excused || 0}</td><td>{r.draft.sick || 0}</td><td>{r.draft.leave || 0}</td><td>{r.draft.alpha || 0}</td><td>{r.errors.length ? <span className="text-danger">{r.errors.join(' ')}</span> : <span className="text-success">Valid</span>}</td></tr>)}</tbody></table></div><div className="form-actions"><button className="btn secondary" onClick={() => { setImportRows([]); setImportFileName('') }}>Bersihkan</button><button className="btn primary" disabled={!canManage || importRows.some((r) => r.errors.length)} onClick={applyImport}>Terapkan ke tabel</button></div></>}
      </>}
    </div>
  </section>
}
