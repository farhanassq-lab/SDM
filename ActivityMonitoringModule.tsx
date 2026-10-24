import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'
import './ActivityMonitoringModule.css'

type Unit = { id: string; name: string; code?: string }
type Employee = { id: string; full_name: string; employment_status?: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: string; start_date: string; end_date: string | null }
type Position = { id: string; name: string }
type Access = { unit_id: string; access_role: 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' }
type ProgramStatus = 'planned' | 'in_progress' | 'completed' | 'blocked'
type ActivityProgram = {
  id: string; unit_id: string; title: string; category: string; description: string | null;
  start_date: string; target_date: string | null; status: ProgramStatus; progress: number;
  responsible_employee_id: string | null; created_by: string | null; created_at: string; updated_at: string
}
type ActivityUpdate = {
  id: string; program_id: string; unit_id: string; report_date: string; summary: string;
  result: string | null; challenges: string | null; next_steps: string | null; evidence_url: string | null;
  created_by: string | null; created_at: string
}
type Props = { units: Unit[]; employees: Employee[]; assignments: Assignment[]; positions: Position[]; accesses: Access[]; isHrAdmin: boolean; isPimpinan: boolean }
type ProgramForm = { unit_id: string; title: string; category: string; description: string; start_date: string; target_date: string; responsible_employee_id: string; status: ProgramStatus; progress: number }
type UpdateForm = { report_date: string; summary: string; result: string; challenges: string; next_steps: string }

const today = new Date().toLocaleDateString('en-CA')
const emptyProgram = (unitId = ''): ProgramForm => ({ unit_id: unitId, title: '', category: 'Program kerja', description: '', start_date: today, target_date: '', responsible_employee_id: '', status: 'planned', progress: 0 })
const emptyUpdate = (): UpdateForm => ({ report_date: today, summary: '', result: '', challenges: '', next_steps: '' })
const statusLabel: Record<ProgramStatus, string> = { planned: 'Direncanakan', in_progress: 'Berjalan', completed: 'Selesai', blocked: 'Terkendala' }
const statusClass: Record<ProgramStatus, string> = { planned: 'planned', in_progress: 'in-progress', completed: 'completed', blocked: 'blocked' }
const categories = ['Program kerja', 'Pembinaan', 'Pembelajaran', 'Operasional', 'Keamanan', 'Kebersihan', 'Layanan', 'Ekstrakurikuler', 'Lainnya']
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '—'

export default function ActivityMonitoringModule({ units, employees, assignments, positions, accesses, isHrAdmin, isPimpinan }: Props) {
  const [programs, setPrograms] = useState<ActivityProgram[]>([])
  const [updates, setUpdates] = useState<ActivityUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showProgramForm, setShowProgramForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [programForm, setProgramForm] = useState<ProgramForm>(emptyProgram(units[0]?.id || ''))
  const [updateFor, setUpdateFor] = useState<ActivityProgram | null>(null)
  const [updateForm, setUpdateForm] = useState<UpdateForm>(emptyUpdate())
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const manageableUnitIds = useMemo(() => new Set(units.filter(u => isHrAdmin || accesses.some(a => a.unit_id === u.id && ['kepala_unit', 'operator_sdm'].includes(a.access_role))).map(u => u.id)), [units, accesses, isHrAdmin])
  const unitMap = useMemo(() => Object.fromEntries(units.map(u => [u.id, u.name])) as Record<string, string>, [units])
  const employeeMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.full_name])) as Record<string, string>, [employees])
  const positionMap = useMemo(() => Object.fromEntries(positions.map(p => [p.id, p.name])) as Record<string, string>, [positions])
  const assignmentLabel = useCallback((employeeId: string | null, unitId: string) => {
    if (!employeeId) return 'Belum ditentukan'
    const assignment = assignments.find(a => a.employee_id === employeeId && a.unit_id === unitId && a.status === 'active')
    if (!assignment) return employeeMap[employeeId] || 'SDM'
    return `${employeeMap[employeeId] || 'SDM'} · ${positionMap[assignment.position_id || ''] || assignment.assignment_title || 'Penugasan'}`
  }, [assignments, employeeMap, positionMap])

  const load = useCallback(async () => {
    if (!supabase) { setError('Konfigurasi Supabase belum tersedia.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      if (!units.length) { setPrograms([]); setUpdates([]); setLoading(false); return }
      const unitIds = units.map(u => u.id)
      const [programRes, updateRes] = await Promise.all([
        supabase.from('unit_activity_programs').select('*').in('unit_id', unitIds).order('created_at', { ascending: false }),
        supabase.from('unit_activity_updates').select('*').in('unit_id', unitIds).order('report_date', { ascending: false }),
      ])
      if (programRes.error) throw programRes.error
      if (updateRes.error) throw updateRes.error
      setPrograms((programRes.data || []) as ActivityProgram[])
      setUpdates((updateRes.data || []) as ActivityUpdate[])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.includes('unit_activity_programs') || message.includes('unit_activity_updates') ? 'Tabel Monitoring Aktivitas belum tersedia. Jalankan migrasi 13_unit_activity_monitoring.sql di Supabase SQL Editor.' : `Data aktivitas gagal dimuat: ${message}`)
    } finally { setLoading(false) }
  }, [units])

  useEffect(() => { void load() }, [load])

  const filteredPrograms = useMemo(() => programs.filter(p => {
    const q = search.trim().toLocaleLowerCase('id')
    const matchesSearch = !q || [p.title, p.category, p.description || '', unitMap[p.unit_id] || ''].some(v => v.toLocaleLowerCase('id').includes(q))
    const matchesUnit = unitFilter === 'all' || p.unit_id === unitFilter
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter
    return matchesSearch && matchesUnit && matchesStatus
  }), [programs, search, unitFilter, statusFilter, unitMap])
  const counts = useMemo(() => ({ total: programs.length, planned: programs.filter(p => p.status === 'planned').length, active: programs.filter(p => p.status === 'in_progress').length, completed: programs.filter(p => p.status === 'completed').length, blocked: programs.filter(p => p.status === 'blocked').length }), [programs])
  const readOnly = isPimpinan && !isHrAdmin

  function startCreate() { setEditingId(null); setProgramForm(emptyProgram(units[0]?.id || '')); setShowProgramForm(true); setError(''); setNotice('') }
  function startEdit(program: ActivityProgram) { setEditingId(program.id); setProgramForm({ unit_id: program.unit_id, title: program.title, category: program.category, description: program.description || '', start_date: program.start_date, target_date: program.target_date || '', responsible_employee_id: program.responsible_employee_id || '', status: program.status, progress: program.progress }); setShowProgramForm(true); setError(''); setNotice('') }

  async function saveProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    if (!manageableUnitIds.has(programForm.unit_id)) { setError('Akun ini tidak memiliki kewenangan mengelola unit tersebut.'); return }
    if (programForm.target_date && programForm.target_date < programForm.start_date) { setError('Tanggal target tidak boleh sebelum tanggal mulai.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const payload = {
        unit_id: programForm.unit_id, title: programForm.title.trim(), category: programForm.category,
        description: programForm.description.trim() || null, start_date: programForm.start_date,
        target_date: programForm.target_date || null, responsible_employee_id: programForm.responsible_employee_id || null,
        status: programForm.status, progress: programForm.status === 'completed' ? 100 : Number(programForm.progress),
        updated_by: userData.user?.id || null,
      }
      if (editingId) {
        const { error: updateError } = await supabase.from('unit_activity_programs').update(payload).eq('id', editingId)
        if (updateError) throw updateError
        setNotice('Program kerja berhasil diperbarui.')
      } else {
        const { error: insertError } = await supabase.from('unit_activity_programs').insert(payload)
        if (insertError) throw insertError
        setNotice('Program kerja berhasil ditambahkan.')
      }
      setShowProgramForm(false); setEditingId(null); await load()
    } catch (cause) { setError(`Program gagal disimpan: ${cause instanceof Error ? cause.message : String(cause)}`) }
    finally { setSaving(false) }
  }

  async function changeStatus(program: ActivityProgram, status: ProgramStatus) {
    if (!supabase || !manageableUnitIds.has(program.unit_id)) return
    setSaving(true); setError(''); setNotice('')
    const progress = status === 'completed' ? 100 : status === 'planned' ? 0 : Math.max(program.progress, status === 'in_progress' ? 10 : program.progress)
    const { data: userData } = await supabase.auth.getUser()
    const { error: e } = await supabase.from('unit_activity_programs').update({ status, progress, updated_by: userData.user?.id || null }).eq('id', program.id)
    if (e) setError(`Status tidak dapat diperbarui: ${e.message}`)
    else { setNotice(`Status program diperbarui menjadi “${statusLabel[status]}”.`); await load() }
    setSaving(false)
  }

  async function saveUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !updateFor) return
    if (!manageableUnitIds.has(updateFor.unit_id)) { setError('Akun ini tidak berwenang mencatat perkembangan unit tersebut.'); return }
    if (evidenceFile) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
      if (!allowedTypes.includes(evidenceFile.type)) { setError('Bukti kegiatan harus berupa JPG, PNG, WEBP, atau PDF.'); return }
      if (evidenceFile.size > 10 * 1024 * 1024) { setError('Ukuran bukti kegiatan maksimal 10 MB.'); return }
    }
    setSaving(true); setError(''); setNotice('')
    let uploadedPath: string | null = null
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (evidenceFile) {
        const safeName = evidenceFile.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-100) || 'bukti-kegiatan'
        uploadedPath = `${updateFor.unit_id}/${updateFor.id}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('rq-activity-evidence').upload(uploadedPath, evidenceFile, {
          cacheControl: '3600', upsert: false, contentType: evidenceFile.type,
        })
        if (uploadError) throw new Error(`Unggah bukti gagal: ${uploadError.message}. Pastikan migrasi 14_activity_evidence_storage.sql sudah dijalankan.`)
      }
      const { error: insertError } = await supabase.from('unit_activity_updates').insert({
        program_id: updateFor.id, unit_id: updateFor.unit_id, report_date: updateForm.report_date,
        summary: updateForm.summary.trim(), result: updateForm.result.trim() || null,
        challenges: updateForm.challenges.trim() || null, next_steps: updateForm.next_steps.trim() || null,
        evidence_url: uploadedPath, created_by: userData.user?.id || null,
      })
      if (insertError) {
        if (uploadedPath) await supabase.storage.from('rq-activity-evidence').remove([uploadedPath])
        throw insertError
      }
      setUpdateFor(null); setUpdateForm(emptyUpdate()); setEvidenceFile(null); setExpandedId(updateFor.id); setNotice('Catatan perkembangan dan bukti kegiatan berhasil disimpan.'); await load()
    } catch (cause) { setError(`Catatan perkembangan gagal disimpan: ${cause instanceof Error ? cause.message : String(cause)}`) }
    finally { setSaving(false) }
  }

  async function openEvidence(value: string) {
    if (!supabase) return
    if (/^https?:\/\//i.test(value)) { window.open(value, '_blank', 'noopener,noreferrer'); return }
    const previewWindow = window.open('about:blank', '_blank')
    if (!previewWindow) { setError('Browser memblokir tab baru. Izinkan pop-up untuk membuka bukti kegiatan.'); return }
    setError('')
    const { data, error: signedError } = await supabase.storage.from('rq-activity-evidence').createSignedUrl(value, 300)
    if (signedError || !data?.signedUrl) {
      previewWindow.close()
      setError(`Bukti kegiatan tidak dapat dibuka: ${signedError?.message || 'Tautan sementara gagal dibuat.'}`)
      return
    }
    previewWindow.location.href = data.signedUrl
  }

  async function removeProgram(program: ActivityProgram) {
    if (!supabase || !isHrAdmin) return
    if (!window.confirm(`Arsipkan/hapus program “${program.title}”? Riwayat perkembangan yang terhubung juga akan dihapus. Lanjutkan hanya jika program ini benar-benar data uji.`)) return
    setSaving(true); setError(''); setNotice('')
    const { error: e } = await supabase.from('unit_activity_programs').delete().eq('id', program.id)
    if (e) setError(`Program tidak dapat dihapus: ${e.message}`)
    else { setNotice('Program berhasil dihapus.'); await load() }
    setSaving(false)
  }

  return <section className="activity-module">
    <div className="activity-page-intro"><div><p className="activity-eyebrow">ADMINISTRASI UNIT</p><h2>Monitoring Aktivitas Unit</h2><p>Pantau program kerja, progres pelaksanaan, kendala, dan hasil kegiatan dalam satu tempat.</p></div>{!readOnly && <button className="activity-primary-btn" onClick={startCreate}>＋ Tambah Program Kerja</button>}</div>
    {error && <div className="activity-alert error">{error}</div>}{notice && <div className="activity-alert success">{notice}</div>}
    <div className="activity-stat-grid"><article><span className="activity-stat-icon">▤</span><div><span>Total program</span><strong>{counts.total}</strong></div></article><article><span className="activity-stat-icon blue">◷</span><div><span>Sedang berjalan</span><strong>{counts.active}</strong></div></article><article><span className="activity-stat-icon green">✓</span><div><span>Selesai</span><strong>{counts.completed}</strong></div></article><article><span className="activity-stat-icon amber">!</span><div><span>Terkendala</span><strong>{counts.blocked}</strong></div></article></div>

    {showProgramForm && <div className="activity-modal-backdrop" role="presentation"><section className="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-form-title"><div className="activity-modal-head"><div><p className="activity-eyebrow">FORMULIR PROGRAM</p><h3 id="activity-form-title">{editingId ? 'Ubah Program Kerja' : 'Tambah Program Kerja'}</h3><p>Isi informasi utama. Perkembangan kegiatan dapat dicatat setelah program disimpan.</p></div><button type="button" className="activity-close-btn" onClick={() => setShowProgramForm(false)} aria-label="Tutup">×</button></div><form onSubmit={saveProgram} className="activity-form"><label>Unit penanggung jawab *<select value={programForm.unit_id} onChange={e => setProgramForm(f => ({ ...f, unit_id: e.target.value }))} required><option value="">Pilih unit</option>{units.filter(u => manageableUnitIds.has(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>Nama program atau kegiatan *<input value={programForm.title} onChange={e => setProgramForm(f => ({ ...f, title: e.target.value }))} placeholder="Contoh: Evaluasi program halaqah bulanan" minLength={3} maxLength={180} required /></label><div className="activity-form-grid"><label>Kategori<select value={programForm.category} onChange={e => setProgramForm(f => ({ ...f, category: e.target.value }))}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>Penanggung jawab<select value={programForm.responsible_employee_id} onChange={e => setProgramForm(f => ({ ...f, responsible_employee_id: e.target.value }))}><option value="">Belum ditentukan</option>{employees.filter(e => e.employment_status !== 'inactive' && assignments.some(a => a.employee_id === e.id && a.unit_id === programForm.unit_id && a.status === 'active')).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label></div><label>Uraian program *<textarea value={programForm.description} onChange={e => setProgramForm(f => ({ ...f, description: e.target.value }))} placeholder="Tujuan atau ruang lingkup kegiatan secara singkat" rows={3} maxLength={2000} required /></label><div className="activity-form-grid"><label>Tanggal mulai *<input type="date" value={programForm.start_date} onChange={e => setProgramForm(f => ({ ...f, start_date: e.target.value }))} required /></label><label>Tanggal target selesai<input type="date" value={programForm.target_date} min={programForm.start_date} onChange={e => setProgramForm(f => ({ ...f, target_date: e.target.value }))} /></label></div>{editingId && <div className="activity-form-grid"><label>Status<select value={programForm.status} onChange={e => setProgramForm(f => ({ ...f, status: e.target.value as ProgramStatus, progress: e.target.value === 'completed' ? 100 : f.progress }))}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Progres (%)<input type="number" min={0} max={100} value={programForm.progress} onChange={e => setProgramForm(f => ({ ...f, progress: Number(e.target.value) }))} /></label></div>}<div className="activity-modal-actions"><button type="button" className="activity-secondary-btn" onClick={() => setShowProgramForm(false)}>Batal</button><button className="activity-primary-btn" disabled={saving}>{saving ? 'Menyimpan…' : editingId ? 'Simpan Perubahan' : 'Simpan Program'}</button></div></form></section></div>}

    {updateFor && <div className="activity-modal-backdrop" role="presentation"><section className="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-update-title"><div className="activity-modal-head"><div><p className="activity-eyebrow">LAPORAN PERKEMBANGAN</p><h3 id="activity-update-title">Catat Perkembangan</h3><p>{updateFor.title} · {unitMap[updateFor.unit_id]}</p></div><button type="button" className="activity-close-btn" onClick={() => setUpdateFor(null)} aria-label="Tutup">×</button></div><form onSubmit={saveUpdate} className="activity-form"><label>Tanggal laporan *<input type="date" value={updateForm.report_date} onChange={e => setUpdateForm(f => ({ ...f, report_date: e.target.value }))} required /></label><label>Ringkasan aktivitas *<textarea value={updateForm.summary} onChange={e => setUpdateForm(f => ({ ...f, summary: e.target.value }))} rows={3} minLength={5} maxLength={2000} placeholder="Apa yang telah dilaksanakan?" required /></label><label>Hasil kegiatan<textarea value={updateForm.result} onChange={e => setUpdateForm(f => ({ ...f, result: e.target.value }))} rows={2} maxLength={2000} placeholder="Hasil atau capaian (opsional)" /></label><label>Kendala yang dihadapi<textarea value={updateForm.challenges} onChange={e => setUpdateForm(f => ({ ...f, challenges: e.target.value }))} rows={2} maxLength={1500} placeholder="Tuliskan kendala jika ada" /></label><label>Tindak lanjut<textarea value={updateForm.next_steps} onChange={e => setUpdateForm(f => ({ ...f, next_steps: e.target.value }))} rows={2} maxLength={1500} placeholder="Langkah berikutnya (opsional)" /></label><label>Bukti kegiatan (opsional)<input className="activity-file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setEvidenceFile(e.target.files?.[0] || null)} /><span className="activity-file-help">Pilih foto JPG, PNG, WEBP atau dokumen PDF. Maksimal 10 MB.{evidenceFile ? ` File dipilih: ${evidenceFile.name} (${(evidenceFile.size / 1024 / 1024).toFixed(2)} MB)` : ''}</span></label><div className="activity-modal-actions"><button type="button" className="activity-secondary-btn" onClick={() => setUpdateFor(null)}>Batal</button><button className="activity-primary-btn" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan Perkembangan'}</button></div></form></section></div>}

    <section className="activity-panel"><div className="activity-panel-head"><div><p className="activity-eyebrow">DAFTAR KEGIATAN</p><h3>Program dan Aktivitas Unit</h3><p>Gunakan filter untuk menemukan program dan memeriksa riwayat perkembangannya.</p></div><button className="activity-secondary-btn" onClick={() => void load()} disabled={loading}>↻ Perbarui</button></div><div className="activity-filters"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari program atau uraian…" aria-label="Cari program"/><select value={unitFilter} onChange={e => setUnitFilter(e.target.value)}><option value="all">Semua unit</option>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Semua status</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {loading ? <div className="activity-empty"><span className="activity-spinner"/>Memuat data aktivitas…</div> : filteredPrograms.length === 0 ? <div className="activity-empty"><strong>Belum ada program kerja</strong><span>{readOnly ? 'Belum ada kegiatan yang dilaporkan oleh unit.' : 'Tambahkan program pertama untuk mulai memantau aktivitas unit.'}</span>{!readOnly && <button className="activity-primary-btn" onClick={startCreate}>＋ Tambah Program Kerja</button>}</div> : <div className="activity-program-list">{filteredPrograms.map(program => {
        const programUpdates = updates.filter(u => u.program_id === program.id)
        const canManage = manageableUnitIds.has(program.unit_id) && !readOnly
        return <article className="activity-program-card" key={program.id}><div className="activity-program-main"><div className="activity-program-title-row"><div><span className="activity-category">{program.category}</span><h4>{program.title}</h4><p className="activity-program-meta">{unitMap[program.unit_id] || 'Unit'} · Mulai {dateLabel(program.start_date)} · Target {dateLabel(program.target_date)}</p></div><span className={`activity-status ${statusClass[program.status]}`}>{statusLabel[program.status]}</span></div>{program.description && <p className="activity-description">{program.description}</p>}<div className="activity-progress-line"><div className="activity-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, program.progress))}%` }} /></div><strong>{program.progress}%</strong></div><div className="activity-program-footer"><span>Penanggung jawab: <strong>{assignmentLabel(program.responsible_employee_id, program.unit_id)}</strong></span><span>{programUpdates.length} catatan perkembangan</span></div></div><div className="activity-program-actions"><button className="activity-secondary-btn" onClick={() => setExpandedId(expandedId === program.id ? null : program.id)}>{expandedId === program.id ? 'Tutup Riwayat' : 'Lihat Riwayat'}</button>{canManage && <><button className="activity-secondary-btn" onClick={() => { setUpdateFor(program); setUpdateForm(emptyUpdate()); setEvidenceFile(null) }}>＋ Catat Perkembangan</button><button className="activity-secondary-btn" onClick={() => startEdit(program)}>Ubah</button><select aria-label={`Ubah status ${program.title}`} value={program.status} onChange={e => void changeStatus(program, e.target.value as ProgramStatus)} disabled={saving}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{isHrAdmin && <button className="activity-danger-btn" onClick={() => void removeProgram(program)} disabled={saving}>Hapus</button>}</>}</div>{expandedId === program.id && <div className="activity-history"><h5>Riwayat Perkembangan</h5>{programUpdates.length === 0 ? <p className="activity-muted">Belum ada catatan perkembangan.</p> : programUpdates.map(item => <div className="activity-update-item" key={item.id}><div className="activity-update-date">{dateLabel(item.report_date)}</div><div className="activity-update-content"><strong>{item.summary}</strong>{item.result && <p><b>Hasil:</b> {item.result}</p>}{item.challenges && <p><b>Kendala:</b> {item.challenges}</p>}{item.next_steps && <p><b>Tindak lanjut:</b> {item.next_steps}</p>}{item.evidence_url && (/^https?:\/\//i.test(item.evidence_url) ? <a href={item.evidence_url} target="_blank" rel="noreferrer">Buka bukti kegiatan ↗</a> : <button type="button" className="activity-evidence-link" onClick={() => void openEvidence(item.evidence_url!)}>Buka bukti kegiatan ↗</button>)}</div></div>)}</div>}</article>
      })}</div>}
    </section>
    <p className="activity-footnote">Data ditampilkan sesuai hak akses akun. Catatan kegiatan menjadi bahan evaluasi program, bukan pengganti pencatatan absensi.</p>
  </section>
}
