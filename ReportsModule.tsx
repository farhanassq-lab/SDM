import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { fetchAllRows } from './lib/fetchAll'
import { currentMonthWib, monthBounds } from './lib/dates'
import ReportPrintView from './ReportPrintView'

type Unit = { id: string; name: string; code?: string; parent_unit_id?: string | null }
type Employee = { id: string; full_name: string; employment_status: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: string; start_date: string; end_date: string | null }
type Position = { id: string; name: string }
type Access = { unit_id: string; access_role: string }
type MonthlySummary = { id: string; assignment_id: string; work_days: number; present_days: number; late_days: number; late_minutes: number; excused_days: number; sick_days: number; leave_days: number; alpha_days: number; status: 'draft' | 'final'; notes: string | null }
type Review = { id: string; employee_id: string; assignment_id: string; unit_id: string; period_start: string; period_end: string; status: string; overall_score: number | null; finalized_at: string | null; created_at: string }
type Props = { units: Unit[]; employees: Employee[]; assignments: Assignment[]; positions: Position[]; accesses: Access[]; isHrAdmin: boolean; isPimpinan: boolean }
type ReportTab = 'summary' | 'attendance' | 'performance' | 'print'

const dateLabel = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '—'
const monthLabel = (value: string) => {
  const [y, m] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}
const percent = (attended: number, workDays: number) => workDays > 0 ? Math.round((attended / workDays) * 1000) / 10 : null
const percentText = (value: number | null) => value === null ? '—' : `${value.toLocaleString('id-ID')}%`

export default function ReportsModule({ units, employees, assignments, positions, accesses, isHrAdmin, isPimpinan }: Props) {
  const reportUnits = useMemo(() => isHrAdmin || isPimpinan ? units : units.filter((u) => accesses.some((a) => a.unit_id === u.id)), [units, accesses, isHrAdmin, isPimpinan])
  const [month, setMonth] = useState(currentMonthWib())
  const [unitId, setUnitId] = useState('all')
  const [tab, setTab] = useState<ReportTab>('summary')
  const [summaries, setSummaries] = useState<MonthlySummary[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const { first: firstDay, last: lastDay } = monthBounds(month)
  const selectedUnitIds = useMemo(() => reportUnits.filter((u) => unitId === 'all' || u.id === unitId).map((u) => u.id), [reportUnits, unitId])
  const selectedUnitIdsKey = selectedUnitIds.join('|')
  // Nilai kinerja hanya untuk Sekjen, Pimpinan, dan Kepala Unit pada unitnya.
  const performanceUnitIds = useMemo(() => selectedUnitIds.filter((id) => isHrAdmin || isPimpinan || accesses.some((a) => a.unit_id === id && a.access_role === 'kepala_unit')), [selectedUnitIds, accesses, isHrAdmin, isPimpinan])
  const performanceUnitIdsKey = performanceUnitIds.join('|')
  const canSeePerformance = isHrAdmin || isPimpinan || accesses.some((a) => a.access_role === 'kepala_unit')
  const selectedAssignments = useMemo(() => assignments.filter((a) => selectedUnitIds.includes(a.unit_id) && a.status === 'active' && a.start_date <= lastDay && (!a.end_date || a.end_date >= firstDay)), [assignments, selectedUnitIds, firstDay, lastDay])
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])) as Record<string, Employee>, [employees])
  const unitMap = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.name])) as Record<string, string>, [units])
  const positionMap = useMemo(() => Object.fromEntries(positions.map((p) => [p.id, p.name])) as Record<string, string>, [positions])
  const assignmentMap = useMemo(() => Object.fromEntries(assignments.map((a) => [a.id, a])) as Record<string, Assignment>, [assignments])
  const summaryMap = useMemo(() => Object.fromEntries(summaries.map((s) => [s.assignment_id, s])) as Record<string, MonthlySummary>, [summaries])
  const assignmentTitle = useCallback((a: Assignment) => positionMap[a.position_id || ''] || a.assignment_title || 'Penugasan', [positionMap])

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Supabase belum dikonfigurasi. Periksa file .env.local.'); return }
    setLoading(true); setError(''); setNotice('')
    const errors: string[] = []
    // RLS sudah membatasi baris sesuai akses akun; pembagian halaman menghindari batas 1000 baris.
    const summaryResult = await fetchAllRows<MonthlySummary>((from, to) => supabase!.from('attendance_monthly_summaries')
      .select('id, assignment_id, work_days, present_days, late_days, late_minutes, excused_days, sick_days, leave_days, alpha_days, status, notes')
      .eq('period_month', firstDay).order('assignment_id').range(from, to))
    if (summaryResult.error) errors.push(`Rekap absensi: ${summaryResult.error.message}`)
    else setSummaries(summaryResult.data)

    const reviewUnits = performanceUnitIdsKey ? performanceUnitIdsKey.split('|') : []
    if (reviewUnits.length) {
      const reviewResult = await fetchAllRows<Review>((from, to) => supabase!.from('performance_reviews')
        .select('id, employee_id, assignment_id, unit_id, period_start, period_end, status, overall_score, finalized_at, created_at')
        .in('unit_id', reviewUnits).lte('period_start', lastDay).gte('period_end', firstDay)
        .order('period_start', { ascending: false }).order('id').range(from, to))
      if (reviewResult.error) errors.push(`Penilaian: ${reviewResult.error.message}`)
      else setReviews(reviewResult.data)
    } else setReviews([])
    if (errors.length) setError(`Sebagian laporan belum dapat dimuat: ${errors.join(' · ')}`)
    setLoading(false)
  }, [performanceUnitIdsKey, firstDay, lastDay])

  useEffect(() => { void refresh() }, [refresh, selectedUnitIdsKey])
  useEffect(() => { if (unitId !== 'all' && !reportUnits.some((u) => u.id === unitId)) setUnitId('all') }, [reportUnits, unitId])
  useEffect(() => { if (tab === 'performance' && !canSeePerformance) setTab('summary') }, [tab, canSeePerformance])

  const summaryRows = useMemo(() => reportUnits.filter((u) => selectedUnitIds.includes(u.id)).map((u) => {
    const unitAssignments = selectedAssignments.filter((a) => a.unit_id === u.id)
    const rows = unitAssignments.map((a) => summaryMap[a.id]).filter(Boolean)
    const unitReviews = reviews.filter((r) => r.unit_id === u.id)
    const finalReviews = unitReviews.filter((r) => r.status === 'final' && r.overall_score !== null)
    const sum = (pick: (s: MonthlySummary) => number) => rows.reduce((total, s) => total + pick(s), 0)
    return {
      unit: u.name,
      unitId: u.id,
      activeAssignments: unitAssignments.length,
      filledAssignments: rows.length,
      finalAssignments: rows.filter((s) => s.status === 'final').length,
      workDays: sum((s) => s.work_days),
      hadir: sum((s) => s.present_days + s.late_days),
      terlambat: sum((s) => s.late_days),
      sakit: sum((s) => s.sick_days),
      cuti: sum((s) => s.leave_days),
      izin: sum((s) => s.excused_days),
      alpa: sum((s) => s.alpha_days),
      totalLateMinutes: sum((s) => s.late_minutes),
      finalReviews: finalReviews.length,
      draftReviews: unitReviews.filter((r) => r.status === 'draft').length,
      averageScore: finalReviews.length ? finalReviews.reduce((total, r) => total + Number(r.overall_score || 0), 0) / finalReviews.length : null,
    }
  }), [reportUnits, selectedUnitIds, selectedAssignments, summaryMap, reviews])

  const attendanceRows = useMemo(() => selectedAssignments.map((a) => {
    const s = summaryMap[a.id]
    const attended = s ? s.present_days + s.late_days : 0
    return {
      Unit: unitMap[a.unit_id] || '—',
      Nama: employeeMap[a.employee_id]?.full_name || '—',
      Penugasan: assignmentTitle(a),
      'Hari wajib': s ? s.work_days : null,
      Hadir: s ? s.present_days : null,
      'Hadir terlambat': s ? s.late_days : null,
      Izin: s ? s.excused_days : null,
      Sakit: s ? s.sick_days : null,
      Cuti: s ? s.leave_days : null,
      Alpa: s ? s.alpha_days : null,
      'Menit terlambat': s ? s.late_minutes : null,
      'Persentase hadir': s ? percent(attended, s.work_days) : null,
      Status: s ? (s.status === 'final' ? 'Final' : 'Draft') : 'Belum diinput',
      Catatan: s?.notes || '',
    }
  }).sort((a, b) => a.Unit.localeCompare(b.Unit, 'id') || a.Nama.localeCompare(b.Nama, 'id')), [selectedAssignments, summaryMap, unitMap, employeeMap, assignmentTitle])

  const performanceRows = useMemo(() => reviews.map((r) => {
    const a = assignmentMap[r.assignment_id]
    return {
      Unit: unitMap[r.unit_id] || '—',
      Nama: employeeMap[r.employee_id]?.full_name || (a ? employeeMap[a.employee_id]?.full_name : '') || '—',
      Penugasan: a ? assignmentTitle(a) : '—',
      'Periode mulai': r.period_start,
      'Periode akhir': r.period_end,
      Status: r.status === 'final' ? 'Final' : r.status === 'draft' ? 'Draft' : r.status,
      'Nilai akhir': r.overall_score == null ? '' : Number(r.overall_score),
      'Tanggal finalisasi': r.finalized_at ? dateLabel(r.finalized_at) : '',
    }
  }).sort((a, b) => b['Periode mulai'].localeCompare(a['Periode mulai']) || a.Unit.localeCompare(b.Unit, 'id')), [reviews, assignmentMap, unitMap, employeeMap, assignmentTitle])

  const printAttendanceRows = useMemo(() => attendanceRows.map((r) => ({
    employeeName: r.Nama, unitName: r.Unit, assignmentTitle: r.Penugasan, workDays: r['Hari wajib'], present: r.Hadir, late: r['Hadir terlambat'], excused: r.Izin, sick: r.Sakit, leave: r.Cuti, alpha: r.Alpa, lateMinutes: r['Menit terlambat'], percentText: percentText(r['Persentase hadir']), status: r.Status,
  })), [attendanceRows])

  const printPerformanceRows = useMemo(() => reviews.map((r) => {
    const a = assignmentMap[r.assignment_id]
    return {
      employeeName: employeeMap[r.employee_id]?.full_name || (a ? employeeMap[a.employee_id]?.full_name : '') || '—',
      unitName: unitMap[r.unit_id] || '—',
      assignmentTitle: a ? assignmentTitle(a) : '—',
      periodLabel: `${dateLabel(r.period_start)} – ${dateLabel(r.period_end)}`,
      score: r.overall_score == null ? null : Number(r.overall_score).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      status: r.status === 'final' ? 'Final' : r.status === 'draft' ? 'Draft' : r.status,
      notes: '',
    }
  }), [reviews, assignmentMap, employeeMap, unitMap, assignmentTitle])

  const totalFinal = summaryRows.reduce((sum, row) => sum + row.finalReviews, 0)
  const finalizedScoredReviews = reviews.filter((r) => r.status === 'final' && r.overall_score !== null)
  const allAvg = finalizedScoredReviews.length ? finalizedScoredReviews.reduce((sum, r) => sum + Number(r.overall_score || 0), 0) / finalizedScoredReviews.length : null
  const totalWorkDays = summaryRows.reduce((sum, r) => sum + r.workDays, 0)
  const totalAttended = summaryRows.reduce((sum, r) => sum + r.hadir, 0)
  const attendancePercent = percent(totalAttended, totalWorkDays)
  const totalAssignments = summaryRows.reduce((sum, r) => sum + r.activeAssignments, 0)
  const totalFilled = summaryRows.reduce((sum, r) => sum + r.filledAssignments, 0)
  const draftCount = summaryRows.reduce((sum, r) => sum + (r.filledAssignments - r.finalAssignments), 0)

  function exportWorkbook() {
    const workbook = XLSX.utils.book_new()
    const summaryExport = summaryRows.map((r) => ({
      Unit: r.unit,
      'Penugasan aktif': r.activeAssignments,
      'Rekap terisi': r.filledAssignments,
      'Rekap final': r.finalAssignments,
      'Hari wajib': r.workDays,
      Hadir: r.hadir,
      'Hadir terlambat': r.terlambat,
      Sakit: r.sakit,
      Cuti: r.cuti,
      Izin: r.izin,
      Alpa: r.alpa,
      'Persentase hadir': percent(r.hadir, r.workDays) ?? '',
      'Total menit terlambat': r.totalLateMinutes,
      ...(canSeePerformance ? { 'Penilaian final': r.finalReviews, 'Penilaian draft': r.draftReviews, 'Rata-rata nilai final': r.averageScore == null ? '' : Number(r.averageScore.toFixed(2)) } : {}),
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryExport.length ? summaryExport : [{ Keterangan: 'Belum ada data pada filter ini' }]), 'Ringkasan Unit')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceRows.length ? attendanceRows : [{ Keterangan: 'Belum ada data absensi pada periode ini' }]), 'Rekap Absensi')
    if (canSeePerformance) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(performanceRows.length ? performanceRows : [{ Keterangan: 'Belum ada data penilaian pada periode ini' }]), 'Detail Kinerja')
    XLSX.writeFile(workbook, `Laporan_RQ_SDM_${month}${unitId === 'all' ? '_SemuaUnit' : ''}.xlsx`)
    setNotice('File Excel berhasil disiapkan untuk diunduh.')
  }

  return <div className="reports-module">
    <section className="content-card reports-filter-card">
      <div className="section-head"><div><p className="eyebrow">LAPORAN ADMINISTRASI HR</p><h2>Rekap SDM lintas unit</h2><p className="muted">Pilih periode dan unit. Laporan mengikuti akses akun yang sedang login.</p></div><div className="reports-action-row"><button className="btn secondary" onClick={() => setTab('print')} disabled={loading}>▧ Pratinjau PDF</button><button className="btn primary" onClick={exportWorkbook} disabled={loading}><span>⇩</span> Ekspor Excel</button></div></div>
      <div className="reports-filters"><label>Periode laporan<input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonthWib())} /></label><label>Unit kerja<select value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="all">Semua unit dalam akses</option>{reportUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><button className="btn secondary" onClick={() => void refresh()} disabled={loading}>{loading ? 'Memuat…' : '↻ Perbarui'}</button></div>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {draftCount > 0 && <div className="alert warning">{draftCount} rekap absensi pada periode ini masih berstatus Draft. Angka dapat berubah sampai Kepala Unit atau Sekjen memfinalkannya.</div>}
      <div className="reports-tabs" role="tablist" aria-label="Jenis laporan"><button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Ringkasan unit</button><button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>Rekap absensi</button>{canSeePerformance && <button className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}>Detail kinerja</button>}<button className={tab === 'print' ? 'active' : ''} onClick={() => setTab('print')}>Pratinjau PDF</button></div>
    </section>
    {tab !== 'print' && <div className="stat-grid reports-stats"><article className="stat-card"><span className="stat-icon">⌂</span><p>Unit dilaporkan</p><strong>{summaryRows.length}</strong><small>{monthLabel(month)}</small></article><article className="stat-card"><span className="stat-icon cyan">▦</span><p>Rekap terisi</p><strong>{totalFilled}/{totalAssignments}</strong><small>Penugasan yang sudah diinput bulan ini</small></article><article className="stat-card"><span className="stat-icon sky">✓</span><p>Persentase hadir</p><strong>{percentText(attendancePercent)}</strong><small>Hari hadir (termasuk terlambat) ÷ total hari wajib pada rekap terisi</small></article>{canSeePerformance && <article className="stat-card"><span className="stat-icon gold">★</span><p>Rata-rata nilai final</p><strong>{allAvg === null ? '—' : allAvg.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</strong><small>{totalFinal} penilaian final</small></article>}</div>}
    {tab === 'summary' && <section className="content-card"><div className="section-head"><div><h2>Ringkasan per unit</h2><p className="muted">Dijumlahkan dari rekap bulanan setiap penugasan. Satu orang dengan dua penugasan dihitung dua kali.</p></div><span className="count-badge">{summaryRows.length} unit</span></div><div className="table-wrap"><table><thead><tr><th>Unit</th><th>Rekap terisi</th><th>Hari wajib</th><th>Hadir</th><th>% Hadir</th><th>Terlambat</th><th>Sakit</th><th>Izin/Cuti</th><th>Alpa</th><th>Menit terlambat</th>{canSeePerformance && <><th>Review final</th><th>Rata-rata nilai</th></>}</tr></thead><tbody>{summaryRows.map((r) => <tr key={r.unitId}><td><strong>{r.unit}</strong></td><td>{r.filledAssignments}/{r.activeAssignments}</td><td>{r.workDays}</td><td>{r.hadir}</td><td>{percentText(percent(r.hadir, r.workDays))}</td><td>{r.terlambat}</td><td>{r.sakit}</td><td>{r.izin + r.cuti}</td><td>{r.alpa}</td><td>{r.totalLateMinutes}</td>{canSeePerformance && <><td>{r.finalReviews}</td><td>{r.averageScore === null ? '—' : r.averageScore.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></>}</tr>)}</tbody></table>{!summaryRows.length && <div className="empty-state">Tidak ada unit yang tersedia untuk akun ini.</div>}</div><p className="footnote">Penugasan yang belum diinput tidak ikut dihitung dalam persentase; lihat kolom Rekap terisi. Satu bulan penuh sebaiknya terisi 100% sebelum laporan dicetak.</p></section>}
    {tab === 'attendance' && <section className="content-card"><div className="section-head"><div><h2>Rekap absensi per penugasan</h2><p className="muted">Satu baris untuk satu penugasan pada {monthLabel(month)}. Penugasan yang belum diinput tetap ditampilkan.</p></div><span className="count-badge">{attendanceRows.length} penugasan</span></div><div className="table-wrap"><table><thead><tr><th>Nama</th><th>Unit</th><th>Penugasan</th><th>Wajib</th><th>Hadir</th><th>Telat</th><th>Izin</th><th>Sakit</th><th>Cuti</th><th>Alpa</th><th>% Hadir</th><th>Status</th></tr></thead><tbody>{attendanceRows.slice(0, 500).map((r, i) => <tr key={`${r.Nama}-${r.Unit}-${i}`}><td><strong>{r.Nama}</strong></td><td>{r.Unit}</td><td>{r.Penugasan}</td><td>{r['Hari wajib'] ?? '—'}</td><td>{r.Hadir ?? '—'}</td><td>{r['Hadir terlambat'] ?? '—'}</td><td>{r.Izin ?? '—'}</td><td>{r.Sakit ?? '—'}</td><td>{r.Cuti ?? '—'}</td><td>{r.Alpa ?? '—'}</td><td>{percentText(r['Persentase hadir'])}</td><td><span className={`status ${r.Status === 'Final' ? 'active' : r.Status === 'Draft' ? 'on_leave' : 'inactive'}`}>{r.Status}</span></td></tr>)}</tbody></table>{!attendanceRows.length && <div className="empty-state">Belum ada penugasan aktif untuk periode dan unit ini.</div>}{attendanceRows.length > 500 && <p className="footnote">Menampilkan 500 baris pertama. Ekspor Excel memuat seluruh baris.</p>}</div></section>}
    {tab === 'performance' && canSeePerformance && <section className="content-card"><div className="section-head"><div><h2>Detail penilaian kinerja</h2><p className="muted">Hanya unit yang berada dalam kewenangan akun. Rata-rata dihitung dari penilaian final; draft ditampilkan terpisah.</p></div><span className="count-badge">{performanceRows.length} penilaian</span></div><div className="table-wrap"><table><thead><tr><th>Nama</th><th>Unit</th><th>Penugasan</th><th>Periode</th><th>Status</th><th>Nilai akhir</th></tr></thead><tbody>{performanceRows.slice(0, 500).map((r, i) => <tr key={`${r.Nama}-${r.Unit}-${r['Periode mulai']}-${i}`}><td><strong>{r.Nama}</strong></td><td>{r.Unit}</td><td>{r.Penugasan}</td><td>{dateLabel(r['Periode mulai'])} – {dateLabel(r['Periode akhir'])}</td><td><span className={`status ${r.Status === 'Final' ? 'active' : 'on_leave'}`}>{r.Status}</span></td><td>{r['Nilai akhir'] === '' ? '—' : Number(r['Nilai akhir']).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}</tbody></table>{!performanceRows.length && <div className="empty-state">Belum ada penilaian pada periode dan unit ini.</div>}{performanceRows.length > 500 && <p className="footnote">Menampilkan 500 penilaian pertama. Ekspor Excel memuat seluruh data.</p>}</div></section>}
    {tab === 'print' && <ReportPrintView
      title="Laporan Administrasi HR"
      periodLabel={monthLabel(month)}
      unitName={unitId === 'all' ? 'Semua unit dalam akses' : (unitMap[unitId] || 'Unit terpilih')}
      summaryStats={[
        { label: 'Unit dilaporkan', value: summaryRows.length },
        { label: 'Rekap terisi', value: `${totalFilled}/${totalAssignments}` },
        { label: 'Persentase hadir', value: percentText(attendancePercent) },
        ...(canSeePerformance ? [{ label: 'Rata-rata nilai final', value: allAvg === null ? '—' : allAvg.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) }] : []),
      ]}
      showPerformanceColumns={canSeePerformance}
      unitSummaryRows={summaryRows}
      attendanceRows={printAttendanceRows}
      performanceRows={canSeePerformance ? printPerformanceRows : []}
    />}
    {tab !== 'print' && <p className="footnote reports-disclaimer">Laporan ini membaca rekap absensi bulanan dan penilaian yang sudah tersimpan. Laporan bukan payroll dan tidak menghitung gaji. Hak akses tetap mengikuti kebijakan RLS Supabase.</p>}
  </div>
}
