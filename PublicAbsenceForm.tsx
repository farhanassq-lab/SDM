import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { todayWib } from './lib/dates'
import './PublicAbsenceForm.css'

type RequestType = 'tidak_hadir' | 'sakit' | 'izin' | 'cuti' | 'terlambat' | 'pulang_awal' | 'dinas_luar'
type StaffSuggestion = { id: string; full_name: string; assignment_summary: string }
type StaffAssignment = { id: string; unit_id: string; unit_name: string; assignment_title: string }
type SelectedStaff = { id: string; full_name: string; assignments: StaffAssignment[] }
type FormState = {
  employee_id: string
  linked_assignment_id: string
  submitter_name: string
  phone: string
  unit_id: string
  assignment_title: string
  request_type: RequestType
  start_date: string
  end_date: string
  reason: string
  website: string
}

const localDate = () => todayWib()
const initialForm = (): FormState => ({
  employee_id: '', linked_assignment_id: '', submitter_name: '', phone: '', unit_id: '', assignment_title: '',
  request_type: 'tidak_hadir', start_date: localDate(), end_date: localDate(), reason: '', website: '',
})

const requestTypeLabels: Record<RequestType, string> = {
  tidak_hadir: 'Tidak dapat hadir',
  sakit: 'Sakit',
  izin: 'Izin',
  cuti: 'Cuti',
  terlambat: 'Izin terlambat',
  pulang_awal: 'Izin pulang lebih awal',
  dinas_luar: 'Tugas dinas di luar dayah',
}

function formatDate(value: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

export default function PublicAbsenceForm() {
  const [form, setForm] = useState<FormState>(initialForm)
  const [staffQuery, setStaffQuery] = useState('')
  const [staffResults, setStaffResults] = useState<StaffSuggestion[]>([])
  const [selectedStaff, setSelectedStaff] = useState<SelectedStaff | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchingStaff, setSearchingStaff] = useState(false)
  const [loadingStaffAssignments, setLoadingStaffAssignments] = useState(false)
  const [staffSearchError, setStaffSearchError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successCode, setSuccessCode] = useState('')
  const [flightAnimation, setFlightAnimation] = useState(false)

  useEffect(() => {
    const client = supabase
    if (!client || selectedStaff || staffQuery.trim().length < 2) {
      setStaffResults([])
      setSearchingStaff(false)
      setStaffSearchError('')
      return
    }

    let active = true
    const timer = window.setTimeout(async () => {
      setSearchingStaff(true)
      setStaffSearchError('')
      const { data, error: searchError } = await client.functions.invoke('public-absence-submission', {
        body: { action: 'search_staff', query: staffQuery.trim() },
      })
      if (!active) return
      if (searchError || data?.error) {
        setStaffResults([])
        setStaffSearchError(data?.error || 'Pencarian nama belum berhasil. Periksa koneksi lalu coba kembali.')
      } else {
        setStaffResults((data?.staff ?? []) as StaffSuggestion[])
      }
      setSearchingStaff(false)
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [staffQuery, selectedStaff])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'start_date' && current.request_type !== 'cuti') next.end_date = value as string
      if (key === 'start_date' && current.request_type === 'cuti' && next.end_date < String(value)) next.end_date = value as string
      if (key === 'request_type' && value !== 'cuti') next.end_date = current.start_date
      return next
    })
  }

  function changeStaffQuery(value: string) {
    setStaffQuery(value)
    setShowSuggestions(true)
    setSelectedStaff(null)
    setStaffResults([])
    setStaffSearchError('')
    setError('')
    setForm((current) => ({
      ...current,
      employee_id: '', linked_assignment_id: '', submitter_name: '', phone: '', unit_id: '', assignment_title: '',
    }))
  }

  async function chooseStaff(suggestion: StaffSuggestion) {
    if (!supabase) return
    setLoadingStaffAssignments(true)
    setStaffSearchError('')
    setError('')
    const { data, error: assignmentError } = await supabase.functions.invoke('public-absence-submission', {
      body: { action: 'get_staff_assignments', employee_id: suggestion.id },
    })
    setLoadingStaffAssignments(false)
    if (assignmentError || data?.error) {
      setStaffSearchError(data?.error || 'Penugasan SDM belum dapat dimuat. Coba pilih nama kembali.')
      return
    }

    const employee = data?.employee as { id: string; full_name: string } | undefined
    const assignments = (data?.assignments ?? []) as StaffAssignment[]
    if (!employee || assignments.length === 0) {
      setStaffSearchError('Belum ada penugasan aktif untuk nama ini. Hubungi Sekjen.')
      return
    }

    const selected: SelectedStaff = { id: employee.id, full_name: employee.full_name, assignments }
    setSelectedStaff(selected)
    setStaffQuery(employee.full_name)
    setStaffResults([])
    setShowSuggestions(false)

    const singleAssignment = assignments.length === 1 ? assignments[0] : null
    setForm((current) => ({
      ...current,
      employee_id: employee.id,
      submitter_name: employee.full_name,
      linked_assignment_id: singleAssignment?.id ?? '',
      unit_id: singleAssignment?.unit_id ?? '',
      assignment_title: singleAssignment?.assignment_title ?? '',
      phone: '',
    }))
  }

  function chooseAssignment(assignmentId: string) {
    const assignment = selectedStaff?.assignments.find((item) => item.id === assignmentId)
    setForm((current) => ({
      ...current,
      linked_assignment_id: assignment?.id ?? '',
      unit_id: assignment?.unit_id ?? '',
      assignment_title: assignment?.assignment_title ?? '',
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) { setError('Koneksi sistem belum tersedia.'); return }
    if (!form.employee_id) { setError('Pilih nama SDM dari daftar saran terlebih dahulu.'); return }
    if (!form.linked_assignment_id || !form.unit_id) { setError('Pilih unit/penugasan yang akan diajukan.'); return }
    if (form.request_type === 'cuti' && form.end_date < form.start_date) { setError('Tanggal akhir cuti tidak boleh sebelum tanggal awal.'); return }

    setSubmitting(true)
    setError('')
    const { data, error: submitError } = await supabase.functions.invoke('public-absence-submission', {
      body: {
        action: 'submit',
        employee_id: form.employee_id,
        linked_assignment_id: form.linked_assignment_id,
        phone: form.phone.trim(),
        request_type: form.request_type,
        start_date: form.start_date,
        end_date: form.request_type === 'cuti' ? form.end_date : form.start_date,
        reason: form.reason.trim(),
        website: form.website,
      },
    })

    if (submitError || data?.error) {
      setError(data?.error || 'Pengajuan gagal dikirim. Periksa koneksi, lalu coba kembali.')
      setSubmitting(false)
      return
    }
    if (data?.success) {
      setSuccessCode(String(data.request_code || 'Terkirim'))
      setFlightAnimation(true)
      window.setTimeout(() => setFlightAnimation(false), 1750)
    } else {
      setError('Respons layanan tidak dikenali. Silakan coba kembali.')
    }
    setSubmitting(false)
  }

  function newRequest() {
    setForm(initialForm())
    setStaffQuery('')
    setStaffResults([])
    setSelectedStaff(null)
    setShowSuggestions(false)
    setSuccessCode('')
    setFlightAnimation(false)
    setError('')
    setStaffSearchError('')
  }

  if (!isSupabaseConfigured) return <main className="public-absence-page"><section className="public-absence-card"><h1>Form Izin / Ketidakhadiran</h1><p>Koneksi sistem belum dikonfigurasi. Hubungi administrator Dayah Ruhul Qurani.</p></section></main>

  return <main className="public-absence-page">
    <section className={`public-absence-card${flightAnimation ? ' is-launching' : ''}`}>
      <div className="public-absence-banner" role="img" aria-label="Masjid Dayah Ruhul Qurani saat senja" />
      <header className="public-absence-header">
        <img src="/rq-logo.png" alt="Logo Dayah Ruhul Qurani" />
        <div><p className="public-absence-eyebrow">DAYAH RUHUL QURANI</p><h1>Form Izin / Ketidakhadiran SDM</h1><p>Isi formulir singkat ini. Pengajuan akan diteruskan kepada kepala unit sesuai penugasan yang dipilih.</p></div>
      </header>

      {flightAnimation ? <div className="public-absence-flight-overlay" role="status" aria-live="polite">
        <div className="public-absence-flight-sheet" aria-hidden="true">
          <div className="public-absence-sheet-brand"><img src="/rq-logo.png" alt=""/><span>RQ SDM · FORM PENGAJUAN</span></div>
          <div className="public-absence-sheet-title" />
          <div className="public-absence-sheet-line long" />
          <div className="public-absence-sheet-line" />
          <div className="public-absence-sheet-fields"><i/><i/></div>
          <div className="public-absence-sheet-line long" />
          <div className="public-absence-sheet-line short" />
          <div className="public-absence-sheet-submit" />
        </div>
        <div className="public-absence-flight-trail" />
        <div className="public-absence-paper-plane" aria-hidden="true">
          <svg viewBox="0 0 72 72" role="img"><path d="M5 32.5 65 5 44.2 66 32.5 42.5 5 32.5Z" fill="currentColor"/><path d="m32.5 42.5 32.5-37.5-19.2 61-13.3-23.5Z" fill="#FFFFFF" opacity=".28"/><path d="m5 32.5 41.5-1.2L32.5 42.5" fill="#FFFFFF" opacity=".55"/></svg>
        </div>
        <p className="public-absence-flight-caption">Pengajuan Anda sedang meluncur ke kepala unit…</p>
      </div> : successCode ? <section className="public-absence-success" role="status">
        <div className="public-absence-success-icon">✓</div>
        <p className="public-absence-eyebrow">PENGAJUAN BERHASIL DIKIRIM</p>
        <h2>Pengajuan sudah sampai ke sistem.</h2>
        <p>Pengajuan akan diperiksa oleh kepala unit terkait. Simpan nomor pengajuan berikut untuk referensi.</p>
        <div className="public-absence-code">{successCode}</div>
        <button type="button" className="public-absence-primary" onClick={newRequest}>Buat pengajuan lain</button>
      </section> : <>
        <div className="public-absence-notice"><strong>Tidak perlu masuk akun.</strong> Ketik nama lalu pilih nama yang sesuai. Unit dan penugasan akan terisi otomatis jika hanya ada satu penugasan aktif.</div>
        {error && <div className="public-absence-error" role="alert">{error}</div>}
        <form className="public-absence-form" onSubmit={submit}>
          <div className="public-absence-name-search">
            <label htmlFor="public-absence-staff-name">Nama lengkap <span>*</span><input
              id="public-absence-staff-name"
              autoComplete="off"
              value={selectedStaff ? selectedStaff.full_name : staffQuery}
              onChange={(event) => changeStaffQuery(event.target.value)}
              onFocus={() => { if (!selectedStaff) setShowSuggestions(true) }}
              maxLength={120}
              placeholder="Ketik minimal 2 huruf nama Anda"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions && !selectedStaff}
              aria-controls="public-absence-staff-options"
              required
            /></label>
            {searchingStaff && <div className="public-absence-search-status"><span className="public-absence-mini-spinner"/> Mencari nama SDM…</div>}
            {loadingStaffAssignments && <div className="public-absence-search-status"><span className="public-absence-mini-spinner"/> Memuat penugasan…</div>}
            {showSuggestions && !selectedStaff && staffQuery.trim().length >= 2 && !searchingStaff && !loadingStaffAssignments && <div className="public-absence-suggestions" id="public-absence-staff-options" role="listbox">
              {staffSearchError ? <p className="public-absence-suggestion-message error">{staffSearchError}</p> : staffResults.length ? staffResults.map((staff) => <button type="button" key={staff.id} role="option" className="public-absence-suggestion" onClick={() => void chooseStaff(staff)}>
                <span className="public-absence-suggestion-avatar">{staff.full_name.trim().charAt(0).toLocaleUpperCase('id-ID')}</span>
                <span className="public-absence-suggestion-copy"><strong>{staff.full_name}</strong><small>{staff.assignment_summary}</small></span>
                <span className="public-absence-suggestion-arrow">›</span>
              </button>) : <p className="public-absence-suggestion-message">Nama belum ditemukan. Coba ketik nama yang lebih lengkap atau hubungi Sekjen untuk memeriksa data SDM.</p>}
            </div>}
            {selectedStaff && <button type="button" className="public-absence-change-staff" onClick={() => { setSelectedStaff(null); setStaffQuery(''); setForm((current) => ({ ...current, employee_id: '', linked_assignment_id: '', submitter_name: '', phone: '', unit_id: '', assignment_title: '' })); setShowSuggestions(true) }}>Ganti nama</button>}
          </div>

          {selectedStaff && selectedStaff.assignments.length === 1 && <div className="public-absence-assignment-selected">
            <span className="public-absence-assignment-icon">✓</span><div><small>Unit dan penugasan terdeteksi otomatis</small><strong>{selectedStaff.assignments[0].unit_name} · {selectedStaff.assignments[0].assignment_title}</strong><p>Pengajuan akan masuk kepada kepala unit ini.</p></div>
          </div>}

          {selectedStaff && selectedStaff.assignments.length > 1 && <label>Unit / penugasan yang diajukan <span>*</span><select value={form.linked_assignment_id} onChange={(event) => chooseAssignment(event.target.value)} required><option value="">Pilih unit tugas Anda</option>{selectedStaff.assignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.unit_name} — {assignment.assignment_title}</option>)}</select><small>Anda memiliki beberapa penugasan. Pilih tugas yang tidak dapat Anda hadiri.</small></label>}

          <div className="public-absence-grid">
            <label>Jenis pengajuan <span>*</span><select value={form.request_type} onChange={(event) => update('request_type', event.target.value as RequestType)}>{Object.entries(requestTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Nomor WhatsApp aktif <span>*</span><input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} maxLength={24} placeholder="08xxxxxxxxxx" required/><small>Untuk menerima keputusan dari kepala unit.</small></label>
          </div>

          <div className={`public-absence-grid${form.request_type === 'cuti' ? ' leave-period-grid' : ''}`}>
            <label>{form.request_type === 'cuti' ? 'Mulai tanggal' : 'Tanggal ketidakhadiran'} <span>*</span><input type="date" value={form.start_date} onChange={(event) => update('start_date', event.target.value)} required/></label>
            {form.request_type === 'cuti' && <label>Sampai tanggal <span>*</span><input type="date" min={form.start_date} value={form.end_date} onChange={(event) => update('end_date', event.target.value)} required/><small>Isi rentang tanggal hanya untuk pengajuan cuti.</small></label>}
          </div>
          {form.request_type !== 'cuti' && <div className="public-absence-single-date-note"><span className="public-absence-calendar-icon">▦</span><span>Pengajuan berlaku untuk satu hari: <strong>{formatDate(form.start_date)}</strong></span></div>}

          <label>Alasan singkat <span>*</span><textarea value={form.reason} onChange={(event) => update('reason', event.target.value)} maxLength={600} rows={3} placeholder="Contoh: Hujan lebat dan akses jalan tidak memungkinkan." required/></label>
          <label className="public-absence-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update('website', event.target.value)}/></label>
          <button type="submit" className="public-absence-primary" disabled={submitting || loadingStaffAssignments || !selectedStaff || !form.linked_assignment_id}>{submitting ? 'Mengirim pengajuan…' : 'Kirim Pengajuan'}</button>
          <p className="public-absence-privacy">Data pengajuan diteruskan kepada kepala unit yang dipilih. Mengirim formulir belum berarti pengajuan disetujui.</p>
        </form>
      </>}
      <footer className="public-absence-footer">RQ SDM · Sistem Informasi Internal Dayah Ruhul Qurani</footer>
    </section>
  </main>
}
