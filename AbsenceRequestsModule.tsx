import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './AbsenceRequestsModule.css'

type Unit = { id: string; code: string; name: string; parent_unit_id: string | null; is_active: boolean; unit_type: 'group' | 'operational' }
type Position = { id: string; code: string; name: string; is_active: boolean }
type Employee = { id: string; full_name: string; employment_status: 'active' | 'inactive' | 'on_leave'; start_date: string | null; end_date: string | null; created_at: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: 'active' | 'inactive'; start_date: string; end_date: string | null; work_arrangement: 'monthly' | 'hourly' | 'session' | 'shift' | 'other' }
type Access = { unit_id: string; access_role: 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' }
type Submission = {
  id: string; request_code: string; submitter_name: string; phone: string; unit_id: string; assignment_title: string
  request_type: RequestType; start_date: string; end_date: string; shift_code: string; reason: string
  status: 'pending' | 'approved' | 'rejected'; linked_assignment_id: string | null; reviewed_by: string | null
  reviewed_at: string | null; review_note: string | null; created_at: string
}
type RequestType = 'tidak_hadir' | 'sakit' | 'izin' | 'cuti' | 'terlambat' | 'pulang_awal' | 'dinas_luar'
type Decision = 'approved' | 'rejected'
type Props = { units: Unit[]; employees: Employee[]; assignments: Assignment[]; positions: Position[]; accesses: Access[]; isHrAdmin: boolean }
type ReviewResult = { request_code?: string; status?: string; attendance_rows_created?: number; attendance_note?: string }

const requestLabels: Record<RequestType, string> = {
  tidak_hadir: 'Tidak dapat hadir', sakit: 'Sakit', izin: 'Izin', cuti: 'Cuti',
  terlambat: 'Izin terlambat', pulang_awal: 'Izin pulang lebih awal', dinas_luar: 'Tugas dinas di luar dayah',
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
const dateRange = (row: Submission) => row.start_date === row.end_date ? dateLabel(row.start_date) : `${dateLabel(row.start_date)} – ${dateLabel(row.end_date)}`
const normalize = (value: string) => value.toLocaleLowerCase('id-ID').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function whatsappNumber(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) digits = `62${digits}`
  return digits
}

function whatsappUrl(row: Submission & { unit_name_for_message?: string }, decision: Decision, reviewNote: string) {
  const number = whatsappNumber(row.phone)
  const decisionText = decision === 'approved' ? 'DISETUJUI' : 'BELUM DISETUJUI / DITOLAK'
  const lines = [
    `Assalamu'alaikum ${row.submitter_name},`,
    '',
    `Pengajuan Anda dengan nomor ${row.request_code} telah ${decisionText.toLocaleLowerCase('id-ID')}.`,
    `Jenis: ${requestLabels[row.request_type]}`,
    `Unit: ${row.unit_name_for_message || 'Dayah Ruhul Qurani'}`,
    `Penugasan: ${row.assignment_title}`,
    `Tanggal: ${dateRange(row)}`,
    `Alasan: ${row.reason}`,
    ...(reviewNote.trim() ? [`Catatan kepala unit: ${reviewNote.trim()}`] : []),
    '',
    'Pesan ini disampaikan melalui Sistem Monitoring SDM Dayah Ruhul Qurani.',
  ]
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`
}

export default function AbsenceRequestsModule({ units, employees, assignments, positions, accesses, isHrAdmin }: Props) {
  const allowedUnits = useMemo(() => isHrAdmin ? units : units.filter((unit) => accesses.some((access) => access.unit_id === unit.id && access.access_role === 'kepala_unit')), [units, accesses, isHrAdmin])
  const unitMap = useMemo(() => Object.fromEntries(units.map((unit) => [unit.id, unit.name])) as Record<string, string>, [units])
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((employee) => [employee.id, employee])) as Record<string, Employee>, [employees])
  const positionMap = useMemo(() => Object.fromEntries(positions.map((position) => [position.id, position.name])) as Record<string, string>, [positions])
  const [rows, setRows] = useState<Submission[]>([])
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [unitFilter, setUnitFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Submission | null>(null)
  const [linkedAssignmentId, setLinkedAssignmentId] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [stampDecision, setStampDecision] = useState<Decision | ''>('')
  const [fallbackWhatsAppUrl, setFallbackWhatsAppUrl] = useState('')

  const refresh = useCallback(async () => {
    if (!supabase) { setError('Koneksi Supabase belum tersedia.'); setLoading(false); return }
    setLoading(true); setError('')
    const { data, error: loadError } = await supabase.from('absence_submissions').select('*').order('created_at', { ascending: false }).limit(250)
    if (loadError) setError(`Data pengajuan belum dapat dimuat. Pastikan migrasi 12_absence_request_form.sql sudah dijalankan. Detail: ${loadError.message}`)
    else setRows((data ?? []) as Submission[])
    // Hitungan diambil dari server agar tidak ikut terpotong oleh batas 250 baris daftar.
    const statuses = ['pending', 'approved', 'rejected'] as const
    const countResults = await Promise.all(statuses.map((status) => supabase!.from('absence_submissions').select('id', { count: 'exact', head: true }).eq('status', status)))
    if (!countResults.some((r) => r.error)) setCounts({ pending: countResults[0].count ?? 0, approved: countResults[1].count ?? 0, rejected: countResults[2].count ?? 0 })
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client.channel('rq-sdm-absence-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_submissions' }, () => { void refresh() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [refresh])

  const pendingCount = counts.pending
  const approvedCount = counts.approved
  const rejectedCount = counts.rejected
  const filteredRows = rows.filter((row) => {
    const matchStatus = filter === 'all' || row.status === 'pending'
    const matchUnit = unitFilter === 'all' || row.unit_id === unitFilter
    const query = search.toLocaleLowerCase('id-ID').trim()
    const matchSearch = !query || `${row.submitter_name} ${row.request_code} ${row.assignment_title} ${row.reason}`.toLocaleLowerCase('id-ID').includes(query)
    return matchStatus && matchUnit && matchSearch
  })
  const availableAssignments = useMemo(() => {
    if (!selected) return []
    return assignments.filter((assignment) => assignment.unit_id === selected.unit_id && assignment.status === 'active'
      && assignment.start_date <= selected.end_date && (!assignment.end_date || assignment.end_date >= selected.start_date))
      .sort((a, b) => (employeeMap[a.employee_id]?.full_name || '').localeCompare(employeeMap[b.employee_id]?.full_name || '', 'id'))
  }, [selected, assignments, employeeMap])

  function openReview(row: Submission) {
    setSelected(row)
    setReviewNote(row.review_note || '')
    setStampDecision('')
    setFallbackWhatsAppUrl('')
    const name = normalize(row.submitter_name)
    const exactMatch = assignments.find((assignment) => assignment.unit_id === row.unit_id && assignment.status === 'active'
      && assignment.start_date <= row.end_date && (!assignment.end_date || assignment.end_date >= row.start_date)
      && normalize(employeeMap[assignment.employee_id]?.full_name || '') === name)
    setLinkedAssignmentId(row.linked_assignment_id || exactMatch?.id || '')
  }

  async function review(decision: Decision) {
    if (!supabase || !selected) return
    if (selected.status !== 'pending') { setError('Pengajuan ini sudah diproses.'); return }
    setBusy(true); setError(''); setMessage(''); setFallbackWhatsAppUrl('')
    // Open a blank tab synchronously from the user gesture so the browser does not block WhatsApp after the async save.
    const popup = window.open('about:blank', '_blank')
    const { data, error: reviewError } = await supabase.rpc('review_absence_submission', {
      p_request_id: selected.id,
      p_decision: decision,
      p_linked_assignment_id: linkedAssignmentId || null,
      p_review_note: reviewNote.trim() || null,
    })
    if (reviewError) {
      if (popup && !popup.closed) popup.close()
      setError(`Keputusan gagal disimpan: ${reviewError.message}`)
      setBusy(false)
      return
    }
    const result = (data || {}) as ReviewResult
    const rowForMessage = { ...selected, unit_name_for_message: unitMap[selected.unit_id] || 'Dayah Ruhul Qurani' } as Submission & { unit_name_for_message: string }
    const waUrl = whatsappUrl(rowForMessage, decision, reviewNote)
    setStampDecision(decision)
    setMessage(`${selected.request_code}: ${decision === 'approved' ? 'pengajuan disetujui' : 'pengajuan ditolak'}. ${result.attendance_note || ''}`.trim())
    setBusy(false)

    window.setTimeout(() => {
      if (popup && !popup.closed) {
        popup.location.href = waUrl
        setFallbackWhatsAppUrl('')
      } else {
        setFallbackWhatsAppUrl(waUrl)
      }
    }, 900)
    window.setTimeout(() => {
      setSelected(null)
      setStampDecision('')
      void refresh()
    }, 1550)
  }

  async function copyFormLink() {
    const url = `${window.location.origin}/form-izin`
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Tautan Form Izin / Ketidakhadiran berhasil disalin. Bagikan kepada SDM sesuai kebutuhan.')
    } catch {
      setMessage(`Tautan formulir: ${url}`)
    }
  }

  return <div className="absence-admin-module">
    <section className="content-card absence-admin-intro">
      <div className="absence-admin-intro-copy"><p className="eyebrow">ADMINISTRASI SDM</p><h2>Pengajuan Izin dan Ketidakhadiran</h2><p className="muted">SDM mengisi form tanpa akun. Pengajuan masuk ke kepala unit sesuai unit yang dipilih.</p></div>
      <div className="absence-admin-intro-actions"><button type="button" className="btn secondary" onClick={() => window.open('/form-izin', '_blank', 'noopener,noreferrer')}>Buka Form Publik</button><button type="button" className="btn primary" onClick={() => void copyFormLink()}>Salin Tautan Form</button></div>
    </section>

    {error && <div className="alert error absence-inline-alert">{error}</div>}
    {message && <div className="alert success absence-inline-alert">{message}{fallbackWhatsAppUrl && <a className="absence-fallback-wa" href={fallbackWhatsAppUrl} target="_blank" rel="noreferrer">Buka WhatsApp</a>}</div>}

    <div className="absence-stats-grid">
      <article className="absence-stat"><span>Menunggu keputusan</span><strong>{pendingCount}</strong><small>Perlu ditinjau kepala unit</small></article>
      <article className="absence-stat"><span>Disetujui</span><strong>{approvedCount}</strong><small>Keputusan disimpan</small></article>
      <article className="absence-stat"><span>Ditolak</span><strong>{rejectedCount}</strong><small>Riwayat tetap tersimpan</small></article>
    </div>

    <section className="content-card absence-inbox-card">
      <div className="section-head absence-inbox-head"><div><p className="eyebrow">KOTAK MASUK UNIT</p><h2>Daftar Pengajuan</h2><p className="muted">Tinjau alasan dan nomor WhatsApp, lalu kirim keputusan langsung dari sini.</p></div><button type="button" className="btn secondary" onClick={() => void refresh()} disabled={loading}>↻ Perbarui</button></div>
      <div className="absence-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, nomor pengajuan, atau alasan…"/><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="all">Semua unit yang berwenang</option>{allowedUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><div className="absence-filter-tabs"><button type="button" className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Menunggu</button><button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Semua riwayat</button></div></div>
      {loading ? <div className="absence-empty"><span className="absence-spinner"/>Memuat pengajuan…</div> : filteredRows.length === 0 ? <div className="absence-empty"><span className="absence-empty-icon">✓</span><strong>{filter === 'pending' ? 'Tidak ada pengajuan yang menunggu.' : 'Belum ada pengajuan yang sesuai.'}</strong><p>Pengajuan dari form publik akan muncul di bagian ini setelah dikirim.</p></div> : <div className="table-wrap absence-table-wrap"><table><thead><tr><th>Pengajuan</th><th>SDM / Penugasan</th><th>Periode</th><th>Unit</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.id}><td><strong>{row.request_code}</strong><small>{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(row.created_at))}</small></td><td><strong>{row.submitter_name}</strong><small>{requestLabels[row.request_type]} · {row.assignment_title}</small></td><td>{dateRange(row)}<small>{row.reason}</small></td><td>{unitMap[row.unit_id] || 'Unit'}</td><td><span className={`absence-status ${row.status}`}>{row.status === 'pending' ? 'Menunggu' : row.status === 'approved' ? 'Disetujui' : 'Ditolak'}</span></td><td><button type="button" className="btn secondary" onClick={() => openReview(row)}>{row.status === 'pending' ? 'Tinjau' : 'Lihat detail'}</button></td></tr>)}</tbody></table></div>}
      <p className="absence-footnote">Nomor WhatsApp hanya digunakan untuk menyampaikan keputusan. Pesan WhatsApp tidak dikirim otomatis; kepala unit dapat memeriksa pesan yang telah disiapkan sebelum mengirimkannya.</p>
    </section>

    {selected && <div className="absence-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null) }}>
      <section className="absence-review-modal" role="dialog" aria-modal="true" aria-labelledby="absence-review-title">
        <header className="absence-review-header"><div><p className="eyebrow">TINJAU PENGAJUAN</p><h2 id="absence-review-title">{selected.request_code}</h2></div><button type="button" className="absence-modal-close" onClick={() => setSelected(null)} disabled={busy} aria-label="Tutup">×</button></header>
        <div className="absence-review-details">
          <div><span>Nama SDM</span><strong>{selected.submitter_name}</strong></div>
          <div><span>Unit</span><strong>{unitMap[selected.unit_id] || 'Unit'}</strong></div>
          <div><span>Jenis pengajuan</span><strong>{requestLabels[selected.request_type]}</strong></div>
          <div><span>Tanggal</span><strong>{dateRange(selected)}</strong></div>
          <div><span>Penugasan yang dilaporkan</span><strong>{selected.assignment_title}</strong></div>
          <div><span>WhatsApp</span><strong>{selected.phone}</strong></div>
          <div className="absence-reason-block"><span>Alasan</span><p>{selected.reason}</p></div>
        </div>
        {selected.status === 'pending' ? <>
          <label className="absence-review-label">Cocokkan dengan penugasan terdaftar <span>(opsional)</span><select value={linkedAssignmentId} onChange={(event) => setLinkedAssignmentId(event.target.value)}><option value="">Belum dicocokkan</option>{availableAssignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{employeeMap[assignment.employee_id]?.full_name || 'SDM'} — {positionMap[assignment.position_id || ''] || assignment.assignment_title || 'Penugasan'}</option>)}</select></label>
          <div className="absence-attendance-hint">Pengajuan yang disetujui akan dicocokkan dengan jadwal aktif pada unit dan penugasan terkait. Catatan absensi yang sudah ada tidak ditimpa. Untuk izin terlambat atau pulang awal, waktu aktual tetap dicatat melalui modul Absensi.</div>
          <label className="absence-review-label">Catatan kepala unit (opsional)<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={600} rows={2} placeholder="Catatan singkat untuk SDM"/></label>
          <div className="absence-review-actions"><button type="button" className="btn danger-outline" disabled={busy} onClick={() => void review('rejected')}>{busy ? 'Memproses…' : 'Tolak & Kirim WhatsApp'}</button><button type="button" className="btn primary" disabled={busy} onClick={() => void review('approved')}>{busy ? 'Memproses…' : 'Setujui & Kirim WhatsApp'}</button></div>
        </> : <div className="absence-previous-decision"><strong>{selected.status === 'approved' ? 'Pengajuan telah disetujui.' : 'Pengajuan telah ditolak.'}</strong><p>{selected.review_note || 'Tidak ada catatan keputusan.'}</p><small>{selected.reviewed_at ? `Diproses ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selected.reviewed_at))}` : ''}</small><button type="button" className="btn secondary" onClick={() => setSelected(null)}>Tutup</button></div>}
        {stampDecision && <div className={`absence-stamp-layer ${stampDecision}`} aria-live="polite"><div className="absence-stamp"><span>{stampDecision === 'approved' ? '✓' : '×'}</span><strong>{stampDecision === 'approved' ? 'DISETUJUI' : 'DITOLAK'}</strong><small>DAYAH RUHUL QURANI</small></div></div>}
      </section>
    </div>}
  </div>
}
