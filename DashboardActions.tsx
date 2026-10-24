import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { fetchAllRows } from './lib/fetchAll'
import { currentMonthWib, monthBounds } from './lib/dates'

type Unit = { id: string; name: string }
type Assignment = { id: string; unit_id: string; status: string; start_date: string; end_date: string | null }
type View = 'dashboard' | 'people' | 'submit' | 'attendance' | 'performance' | 'reports' | 'users' | 'requests' | 'activities'
type Summary = { assignment_id: string; work_days: number; present_days: number; late_days: number; status: 'draft' | 'final' }
type Props = {
  units: Unit[]
  assignments: Assignment[]
  canSeeRequests: boolean
  canSeeAttendance: boolean
  canSeePerformance: boolean
  onNavigate: (view: View) => void
}

const monthName = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

// Ringkasan "perlu tindakan" untuk beranda: hanya hal yang menunggu keputusan atau input.
export default function DashboardActions({ units, assignments, canSeeRequests, canSeeAttendance, canSeePerformance, onNavigate }: Props) {
  const month = currentMonthWib()
  const { first, last } = monthBounds(month)
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [pending, setPending] = useState<{ total: number; overdue: number } | null>(null)
  const [draftReviews, setDraftReviews] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true); setError('')
    const problems: string[] = []
    if (canSeeAttendance) {
      const result = await fetchAllRows<Summary>((from, to) => client.from('attendance_monthly_summaries').select('assignment_id, work_days, present_days, late_days, status').eq('period_month', first).order('assignment_id').range(from, to))
      if (result.error) problems.push('rekap absensi')
      else setSummaries(result.data)
    }
    if (canSeeRequests) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [all, old] = await Promise.all([
        client.from('absence_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        client.from('absence_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', cutoff),
      ])
      if (all.error || old.error) problems.push('pengajuan izin')
      else setPending({ total: all.count ?? 0, overdue: old.count ?? 0 })
    }
    if (canSeePerformance) {
      const drafts = await client.from('performance_reviews').select('id', { count: 'exact', head: true }).eq('status', 'draft')
      if (drafts.error) problems.push('penilaian kinerja')
      else setDraftReviews(drafts.count ?? 0)
    }
    if (problems.length) setError(`Sebagian ringkasan belum dapat dimuat: ${problems.join(', ')}.`)
    setLoading(false)
  }, [canSeeAttendance, canSeeRequests, canSeePerformance, first])

  useEffect(() => { void load() }, [load])

  const unitRows = useMemo(() => units.map((unit) => {
    const ids = assignments.filter((a) => a.unit_id === unit.id && a.status === 'active' && a.start_date <= last && (!a.end_date || a.end_date >= first)).map((a) => a.id)
    const idSet = new Set(ids)
    const rows = summaries.filter((s) => idSet.has(s.assignment_id))
    return { id: unit.id, name: unit.name, total: ids.length, filled: rows.length, final: rows.filter((s) => s.status === 'final').length }
  }).filter((u) => u.total > 0).sort((a, b) => (a.filled / a.total) - (b.filled / b.total) || a.name.localeCompare(b.name, 'id')), [units, assignments, summaries, first, last])

  const totals = useMemo(() => {
    const visible = new Set(unitRows.length ? assignments.filter((a) => unitRows.some((u) => u.id === a.unit_id)).map((a) => a.id) : [])
    const rows = summaries.filter((s) => visible.has(s.assignment_id))
    const workDays = rows.reduce((sum, s) => sum + s.work_days, 0)
    const attended = rows.reduce((sum, s) => sum + s.present_days + s.late_days, 0)
    return { workDays, percent: workDays ? Math.round((attended / workDays) * 1000) / 10 : null }
  }, [unitRows, assignments, summaries])

  const incompleteUnits = unitRows.filter((u) => u.filled < u.total)
  const totalAssignments = unitRows.reduce((s, u) => s + u.total, 0)
  const totalFilled = unitRows.reduce((s, u) => s + u.filled, 0)

  const cards: { key: string; tag: string; tone: 'amber' | 'red' | 'blue' | 'green'; value: number; title: string; hint: string; action: string; view: View }[] = []
  if (canSeeRequests && pending) cards.push({ key: 'req', tag: 'Menunggu', tone: 'amber', value: pending.total, title: 'Pengajuan izin', hint: pending.overdue ? `${pending.overdue} sudah lebih dari 24 jam belum diputuskan.` : 'Tidak ada yang lewat 24 jam.', action: 'Tinjau', view: 'requests' })
  if (canSeeAttendance) cards.push({ key: 'att', tag: 'Bulan ini', tone: incompleteUnits.length ? 'red' : 'green', value: incompleteUnits.length, title: `Unit belum lengkap rekap ${monthName(month)}`, hint: incompleteUnits.length ? incompleteUnits.slice(0, 3).map((u) => u.name).join(', ') + (incompleteUnits.length > 3 ? ', …' : '.') : 'Semua unit sudah lengkap.', action: 'Isi rekap', view: 'attendance' })
  if (canSeePerformance && draftReviews !== null) cards.push({ key: 'perf', tag: 'Draft', tone: 'blue', value: draftReviews, title: 'Penilaian kinerja belum final', hint: 'Finalkan agar masuk laporan.', action: 'Lihat draft', view: 'performance' })

  if (!canSeeRequests && !canSeeAttendance && !canSeePerformance) return null

  return <section className="dash-actions" aria-label="Perlu tindakan">
    {error && <div className="alert warning">{error}</div>}
    <div className="dash-action-grid">
      {loading && !cards.length ? <div className="empty-state">Memuat ringkasan…</div> : cards.map((c) => <button type="button" key={c.key} className={`dash-action-card tone-${c.tone}`} onClick={() => onNavigate(c.view)}>
        <span className="dash-action-tag">{c.tag}</span>
        <strong className="dash-action-value">{c.value.toLocaleString('id-ID')}</strong>
        <span className="dash-action-title">{c.title}</span>
        <span className="dash-action-hint">{c.hint}</span>
        <span className="dash-action-go">{c.action} →</span>
      </button>)}
    </div>
    {canSeeAttendance && unitRows.length > 0 && <div className="content-card dash-recap">
      <div className="section-head"><div><p className="eyebrow">REKAP BULANAN</p><h2>Rekap absensi {monthName(month)}</h2><p className="muted">{totalFilled} dari {totalAssignments} penugasan sudah diinput{totals.workDays ? ` · dihitung dari ${totals.workDays.toLocaleString('id-ID')} hari wajib` : ''}.</p></div><div className="dash-recap-percent"><strong>{totals.percent === null ? '—' : `${totals.percent.toLocaleString('id-ID')}%`}</strong><span>hadir termasuk terlambat</span></div></div>
      <div className="dash-recap-list">
        {unitRows.slice(0, 8).map((u) => {
          const complete = u.filled === u.total
          return <div className="dash-recap-row" key={u.id}>
            <span className="dash-recap-name">{u.name}</span>
            <span className="dash-recap-track" aria-hidden="true"><span className={complete ? 'ok' : 'warn'} style={{ width: `${Math.round((u.filled / u.total) * 100)}%` }}/></span>
            <span className="dash-recap-count">{u.filled}/{u.total}</span>
            <span className={`dash-recap-pill ${complete ? 'ok' : 'warn'}`}>{complete ? (u.final === u.total ? 'Final' : 'Lengkap') : 'Belum lengkap'}</span>
          </div>
        })}
      </div>
      {unitRows.length > 8 && <p className="footnote">Menampilkan 8 dari {unitRows.length} unit, yang paling belum lengkap lebih dulu.</p>}
    </div>}
  </section>
}
