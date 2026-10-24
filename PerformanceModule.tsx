import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'

type Unit = { id: string; name: string; is_active: boolean; unit_type: 'group' | 'operational'; parent_unit_id: string | null }
type Employee = { id: string; full_name: string; employment_status: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: string; start_date: string; end_date: string | null }
type Position = { id: string; name: string }
type Access = { unit_id: string; access_role: string }
type Indicator = { id: string; code: string; name: string; description: string | null; scope: 'global' | 'unit' | 'position'; unit_id: string | null; position_id: string | null; weight: number; is_active: boolean }
type Review = { id: string; employee_id: string; assignment_id: string; unit_id: string; period_type: 'monthly' | 'quarterly' | 'semester' | 'annual'; period_start: string; period_end: string; reviewer_user_id: string; status: 'draft' | 'final'; overall_score: number | null; comments: string | null; finalized_at: string | null; created_at: string }
type ScoreInput = { score: string; comments: string; evidence_url: string }
type ReviewScore = { indicator_id: string; score: number; comments: string | null; evidence_url: string | null }
type Props = { units: Unit[]; employees: Employee[]; assignments: Assignment[]; positions: Position[]; accesses: Access[]; isHrAdmin: boolean; isPimpinan: boolean }
type Tab = 'new' | 'history' | 'indicators'

const today = new Date()
const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const monthStart = `${localToday.slice(0, 7)}-01`
const monthEnd = `${localToday.slice(0, 7)}-${String(new Date(Number(localToday.slice(0, 4)), Number(localToday.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
const periodNames: Record<Review['period_type'], string> = { monthly: 'Bulanan', quarterly: 'Triwulan', semester: 'Semester', annual: 'Tahunan' }
const dateFmt = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '—'
const scoreFmt = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PerformanceModule({ units, employees, assignments, positions, accesses, isHrAdmin, isPimpinan }: Props) {
  const operationalUnits = useMemo(() => units.filter((u) => u.is_active && u.unit_type === 'operational'), [units])
  const allowedUnits = useMemo(() => isHrAdmin || isPimpinan ? operationalUnits : operationalUnits.filter((u) => accesses.some((a) => a.unit_id === u.id && a.access_role === 'kepala_unit')), [isHrAdmin, isPimpinan, operationalUnits, accesses])
  const [tab, setTab] = useState<Tab>('new')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('')
  const [periodType, setPeriodType] = useState<Review['period_type']>('monthly')
  const [periodStart, setPeriodStart] = useState(monthStart)
  const [periodEnd, setPeriodEnd] = useState(monthEnd)
  const [reviewComments, setReviewComments] = useState('')
  const [scores, setScores] = useState<Record<string, ScoreInput>>({})
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
  const [viewingReview, setViewingReview] = useState<Review | null>(null)
  const [viewingScores, setViewingScores] = useState<ReviewScore[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [indicatorCode, setIndicatorCode] = useState('')
  const [indicatorName, setIndicatorName] = useState('')
  const [indicatorDescription, setIndicatorDescription] = useState('')
  const [indicatorScope, setIndicatorScope] = useState<'global' | 'unit' | 'position'>('global')
  const [indicatorUnitId, setIndicatorUnitId] = useState('')
  const [indicatorPositionId, setIndicatorPositionId] = useState('')
  const [indicatorWeight, setIndicatorWeight] = useState('20')

  const unitMap = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.name])) as Record<string, string>, [units])
  const employeeMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e.full_name])) as Record<string, string>, [employees])
  const positionMap = useMemo(() => Object.fromEntries(positions.map((p) => [p.id, p.name])) as Record<string, string>, [positions])
  const assignmentMap = useMemo(() => Object.fromEntries(assignments.map((a) => [a.id, a])) as Record<string, Assignment>, [assignments])
  const selectedAssignment = assignmentMap[selectedAssignmentId]
  const canManageSelectedUnit = isHrAdmin || accesses.some((a) => a.unit_id === selectedUnitId && a.access_role === 'kepala_unit')
  const eligibleAssignments = useMemo(() => assignments.filter((a) => {
    if (!selectedUnitId || a.unit_id !== selectedUnitId) return false
    const employee = employees.find((e) => e.id === a.employee_id)
    return a.status === 'active' && (!a.end_date || a.end_date >= localToday) && employee?.employment_status === 'active'
  }).sort((a, b) => (employeeMap[a.employee_id] || '').localeCompare(employeeMap[b.employee_id] || '', 'id')), [assignments, selectedUnitId, employees, employeeMap])
  const applicableIndicators = useMemo(() => indicators.filter((indicator) => {
    if (!indicator.is_active || !selectedAssignment || !selectedUnitId) return false
    if (indicator.scope === 'global') return true
    if (indicator.scope === 'unit') return indicator.unit_id === selectedUnitId
    return indicator.position_id === selectedAssignment.position_id && (!indicator.unit_id || indicator.unit_id === selectedUnitId)
  }).sort((a, b) => a.name.localeCompare(b.name, 'id')), [indicators, selectedAssignment, selectedUnitId])
  const reviewsForUnit = useMemo(() => reviews.filter((r) => !selectedUnitId || r.unit_id === selectedUnitId).sort((a, b) => b.period_start.localeCompare(a.period_start)), [reviews, selectedUnitId])
  const finalizedReviews = reviewsForUnit.filter((r) => r.status === 'final')
  const averageScore = finalizedReviews.length ? finalizedReviews.reduce((sum, r) => sum + Number(r.overall_score || 0), 0) / finalizedReviews.length : null
  const canManageUnit = useCallback((unitId: string) => isHrAdmin || accesses.some((a) => a.unit_id === unitId && a.access_role === 'kepala_unit'), [isHrAdmin, accesses])

  const loadData = useCallback(async () => {
    if (!supabase) { setLoading(false); setError('Supabase belum dikonfigurasi. Periksa .env.local.'); return }
    setLoading(true)
    setError('')
    const [indicatorResult, reviewResult] = await Promise.all([
      supabase.from('performance_indicators').select('id, code, name, description, scope, unit_id, position_id, weight, is_active').order('name'),
      supabase.from('performance_reviews').select('id, employee_id, assignment_id, unit_id, period_type, period_start, period_end, reviewer_user_id, status, overall_score, comments, finalized_at, created_at').order('period_start', { ascending: false }).limit(250),
    ])
    const messages = [indicatorResult.error?.message, reviewResult.error?.message].filter(Boolean)
    if (messages.length) setError(`Data penilaian belum dapat dimuat: ${messages.join(' · ')}`)
    if (!indicatorResult.error) setIndicators((indicatorResult.data || []) as Indicator[])
    if (!reviewResult.error) setReviews((reviewResult.data || []) as Review[])
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => {
    if (!selectedUnitId && allowedUnits.length) setSelectedUnitId(allowedUnits[0].id)
  }, [allowedUnits, selectedUnitId])
  useEffect(() => {
    if (!eligibleAssignments.some((a) => a.id === selectedAssignmentId)) setSelectedAssignmentId(eligibleAssignments[0]?.id || '')
  }, [eligibleAssignments, selectedAssignmentId])
  useEffect(() => {
    if (editingReviewId) return
    setScores(Object.fromEntries(applicableIndicators.map((i) => [i.id, { score: '', comments: '', evidence_url: '' }])) as Record<string, ScoreInput>)
  }, [applicableIndicators, editingReviewId])

  function resetForm() {
    setEditingReviewId(null)
    setSelectedAssignmentId(eligibleAssignments[0]?.id || '')
    setPeriodType('monthly')
    setPeriodStart(monthStart)
    setPeriodEnd(monthEnd)
    setReviewComments('')
    setTab('new')
  }

  async function saveReview(finalize: boolean) {
    if (!supabase) return
    if (!selectedAssignment || !selectedUnitId) { setError('Pilih unit dan penugasan terlebih dahulu.'); return }
    if (!canManageSelectedUnit) { setError('Akun ini hanya dapat melihat penilaian, bukan membuat atau mengubahnya.'); return }
    if (!periodStart || !periodEnd || periodEnd < periodStart) { setError('Rentang tanggal penilaian tidak valid.'); return }
    if (!applicableIndicators.length) { setError('Belum ada indikator aktif yang sesuai. Minta Sekjen menambahkan indikator.'); return }
    const payload = applicableIndicators.map((indicator) => {
      const input = scores[indicator.id]
      return { indicator_id: indicator.id, score: Number(input?.score), comments: input?.comments.trim() || null, evidence_url: input?.evidence_url.trim() || null }
    })
    if (payload.some((item) => !Number.isFinite(item.score) || item.score < 1 || item.score > 5)) { setError('Semua indikator harus diberi nilai 1 sampai 5.'); return }
    if (finalize && !window.confirm('Finalisasi penilaian ini? Penilaian final akan terkunci untuk kepala unit.')) return
    setBusy(true); setError(''); setNotice('')
    const { error: rpcError } = await supabase.rpc('save_performance_review', {
      p_review_id: editingReviewId,
      p_assignment_id: selectedAssignment.id,
      p_period_type: periodType,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_comments: reviewComments.trim() || null,
      p_finalize: finalize,
      p_scores: payload,
    })
    if (rpcError) {
      setError(`Gagal menyimpan penilaian: ${rpcError.message}`)
    } else {
      setNotice(finalize ? 'Penilaian berhasil difinalisasi.' : 'Draft penilaian berhasil disimpan.')
      setEditingReviewId(null)
      setReviewComments('')
      await loadData()
      setTab('history')
    }
    setBusy(false)
  }

  async function editDraft(review: Review) {
    if (!supabase) return
    if (review.status !== 'draft' || !canManageUnit(review.unit_id)) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: scoreError } = await supabase.from('performance_review_scores').select('indicator_id, score, comments, evidence_url').eq('review_id', review.id)
    if (scoreError) { setError(`Draft tidak dapat dibuka: ${scoreError.message}`); setBusy(false); return }
    setEditingReviewId(review.id)
    setSelectedUnitId(review.unit_id)
    setSelectedAssignmentId(review.assignment_id)
    setPeriodType(review.period_type)
    setPeriodStart(review.period_start)
    setPeriodEnd(review.period_end)
    setReviewComments(review.comments || '')
    setScores(Object.fromEntries(((data || []) as ReviewScore[]).map((s) => [s.indicator_id, { score: String(s.score), comments: s.comments || '', evidence_url: s.evidence_url || '' }])) as Record<string, ScoreInput>)
    setTab('new')
    setBusy(false)
  }

  async function viewReview(review: Review) {
    if (!supabase) return
    setDetailLoading(true); setError('')
    const { data, error: scoreError } = await supabase.from('performance_review_scores').select('indicator_id, score, comments, evidence_url').eq('review_id', review.id)
    if (scoreError) setError(`Rincian nilai tidak dapat dimuat: ${scoreError.message}`)
    else { setViewingReview(review); setViewingScores((data || []) as ReviewScore[]) }
    setDetailLoading(false)
  }


  async function saveIndicator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !isHrAdmin) return
    if (!indicatorCode.trim() || !indicatorName.trim()) { setError('Kode dan nama indikator wajib diisi.'); return }
    if (indicatorScope === 'unit' && !indicatorUnitId) { setError('Pilih unit untuk indikator lingkup unit.'); return }
    if (indicatorScope === 'position' && !indicatorPositionId) { setError('Pilih jabatan untuk indikator lingkup jabatan.'); return }
    const weight = Number(indicatorWeight)
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) { setError('Bobot harus berada di antara 0 sampai 100.'); return }
    setBusy(true); setError(''); setNotice('')
    const { error: insertError } = await supabase.from('performance_indicators').insert({
      code: indicatorCode.trim().toUpperCase().replace(/\s+/g, '_'),
      name: indicatorName.trim(),
      description: indicatorDescription.trim() || null,
      scope: indicatorScope,
      unit_id: indicatorScope === 'unit' ? indicatorUnitId : null,
      position_id: indicatorScope === 'position' ? indicatorPositionId : null,
      weight,
      is_active: true,
    })
    if (insertError) setError(`Indikator tidak dapat disimpan: ${insertError.message}`)
    else {
      setNotice('Indikator berhasil ditambahkan.')
      setIndicatorCode(''); setIndicatorName(''); setIndicatorDescription(''); setIndicatorScope('global'); setIndicatorUnitId(''); setIndicatorPositionId(''); setIndicatorWeight('20')
      await loadData()
    }
    setBusy(false)
  }

  async function toggleIndicator(indicator: Indicator) {
    if (!supabase || !isHrAdmin) return
    setBusy(true); setError(''); setNotice('')
    const { error: updateError } = await supabase.from('performance_indicators').update({ is_active: !indicator.is_active }).eq('id', indicator.id)
    if (updateError) setError(`Status indikator tidak dapat diubah: ${updateError.message}`)
    else { setNotice(`Indikator “${indicator.name}” ${indicator.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`); await loadData() }
    setBusy(false)
  }

  function updateScore(indicatorId: string, key: keyof ScoreInput, value: string) {
    setScores((prev) => ({ ...prev, [indicatorId]: { ...(prev[indicatorId] || { score: '', comments: '', evidence_url: '' }), [key]: value } }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void saveReview(false) }

  return <div className="performance-module">
    <div className="performance-hero"><div><p className="eyebrow light">PENGEMBANGAN SDM</p><h2>Penilaian Kinerja</h2><p>Menilai amanah dan kualitas kerja berdasarkan penugasan, bukan semata-mata kehadiran.</p></div><div className="performance-hero-mark">RQ</div></div>
    {error && <div className="alert error performance-alert">{error}</div>}
    {notice && <div className="alert success performance-alert">{notice}</div>}
    <div className="performance-toolbar"><label>Unit kerja<select value={selectedUnitId} onChange={(e) => { setSelectedUnitId(e.target.value); setSelectedAssignmentId(''); setError(''); setNotice('') }} disabled={Boolean(editingReviewId)}><option value="">Pilih unit</option>{allowedUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><button className="btn secondary" onClick={() => void loadData()} disabled={loading}>↻ Segarkan</button></div>
    <div className="performance-stats"><article><span>Penilaian tercatat</span><strong>{loading ? '…' : reviewsForUnit.length}</strong><small>Draft dan final pada unit terpilih</small></article><article><span>Rata-rata nilai final</span><strong>{scoreFmt(averageScore)}</strong><small>Skala 1–5, penilaian final</small></article><article><span>Draft belum final</span><strong>{reviewsForUnit.filter((r) => r.status === 'draft').length}</strong><small>Masih dapat diperbarui oleh penilai berwenang</small></article></div>
    <div className="performance-subtabs"><button className={tab === 'new' ? 'active' : ''} onClick={() => { setTab('new'); setError(''); setNotice('') }}>{editingReviewId ? 'Edit Draft' : 'Penilaian Baru'}</button><button className={tab === 'history' ? 'active' : ''} onClick={() => { setTab('history'); setError(''); setNotice('') }}>Riwayat Penilaian</button>{isHrAdmin && <button className={tab === 'indicators' ? 'active' : ''} onClick={() => { setTab('indicators'); setError(''); setNotice('') }}>Atur Indikator</button>}</div>
    {tab === 'new' && <section className="content-card performance-form-card"><div className="section-head"><div><p className="eyebrow">FORMULIR EVALUASI</p><h2>{editingReviewId ? 'Perbarui draft penilaian' : 'Buat penilaian baru'}</h2><p className="muted">Setiap penilaian melekat pada satu penugasan dan satu periode.</p></div>{editingReviewId && <span className="count-badge">Draft</span>}</div>
      {!canManageSelectedUnit && <div className="performance-readonly">Akun ini memiliki akses baca. Kepala unit yang berwenang atau Sekjen dapat membuat penilaian.</div>}
      <form className="request-form" onSubmit={handleSubmit}>
        <div className="form-grid"><label>Penugasan yang dinilai *<select value={selectedAssignmentId} onChange={(e) => setSelectedAssignmentId(e.target.value)} required disabled={!canManageSelectedUnit || Boolean(editingReviewId)}><option value="">Pilih SDM / penugasan</option>{eligibleAssignments.map((a) => <option key={a.id} value={a.id}>{employeeMap[a.employee_id] || 'SDM'} — {a.assignment_title || positionMap[a.position_id || ''] || 'Penugasan'}</option>)}</select></label><label>Periode penilaian *<select value={periodType} onChange={(e) => setPeriodType(e.target.value as Review['period_type'])} disabled={!canManageSelectedUnit}><option value="monthly">Bulanan</option><option value="quarterly">Triwulan</option><option value="semester">Semester</option><option value="annual">Tahunan</option></select></label></div>
        <div className="form-grid"><label>Tanggal awal periode *<input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required disabled={!canManageSelectedUnit}/></label><label>Tanggal akhir periode *<input type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} required disabled={!canManageSelectedUnit}/></label></div>
        <div className="performance-indicator-heading"><div><h3>Indikator penilaian</h3><p>Skala 1–5: 1 perlu perbaikan, 3 memenuhi harapan, 5 sangat baik.</p></div><span>{applicableIndicators.length} indikator</span></div>
        {!selectedAssignment && <div className="empty-state">Pilih unit yang dapat dikelola dan penugasan aktif terlebih dahulu.</div>}
        {selectedAssignment && applicableIndicators.length === 0 && <div className="empty-state">Belum ada indikator yang sesuai untuk penugasan ini. Jalankan SQL Tahap 8 atau minta Sekjen mengaktifkan indikator.</div>}
        {applicableIndicators.map((indicator, index) => <article className="performance-indicator" key={indicator.id}><div className="performance-indicator-top"><div><span className="indicator-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{indicator.name}</strong><small>{indicator.description || (indicator.scope === 'global' ? 'Berlaku untuk seluruh unit' : indicator.scope === 'unit' ? `Indikator unit · ${unitMap[indicator.unit_id || ''] || ''}` : `Indikator jabatan · ${positionMap[indicator.position_id || ''] || ''}`)}</small></div></div><span className="weight-pill">Bobot {Number(indicator.weight)}%</span></div><div className="performance-score-row"><label>Nilai<select value={scores[indicator.id]?.score ?? ''} onChange={(e) => updateScore(indicator.id, 'score', e.target.value)} disabled={!canManageSelectedUnit}><option value="" disabled>Pilih nilai…</option><option value="1">1 · Perlu perbaikan</option><option value="2">2 · Di bawah harapan</option><option value="3">3 · Memenuhi harapan</option><option value="4">4 · Baik</option><option value="5">5 · Sangat baik</option></select></label><label>Catatan indikator<input value={scores[indicator.id]?.comments ?? ''} onChange={(e) => updateScore(indicator.id, 'comments', e.target.value)} placeholder="Contoh bukti atau catatan singkat" disabled={!canManageSelectedUnit}/></label><label>Bukti / tautan (opsional)<input type="url" value={scores[indicator.id]?.evidence_url ?? ''} onChange={(e) => updateScore(indicator.id, 'evidence_url', e.target.value)} placeholder="https://…" disabled={!canManageSelectedUnit}/></label></div></article>)}
        <label>Catatan umum penilaian<textarea rows={3} value={reviewComments} onChange={(e) => setReviewComments(e.target.value)} placeholder="Kekuatan, hal yang perlu ditingkatkan, dan tindak lanjut…" disabled={!canManageSelectedUnit}/></label>
        <div className="performance-form-actions">{editingReviewId && <button type="button" className="btn secondary" onClick={resetForm} disabled={busy}>Batal edit</button>}<button type="button" className="btn secondary" onClick={() => void saveReview(false)} disabled={busy || !canManageSelectedUnit || !selectedAssignment || !applicableIndicators.length}>{busy ? 'Menyimpan…' : 'Simpan Draft'}</button><button type="button" className="btn primary" onClick={() => void saveReview(true)} disabled={busy || !canManageSelectedUnit || !selectedAssignment || !applicableIndicators.length}>{busy ? 'Memproses…' : 'Finalisasi Penilaian'}</button></div>
      </form>
    </section>}
    {tab === 'history' && <section className="content-card"><div className="section-head"><div><p className="eyebrow">ARSIP KINERJA</p><h2>Riwayat penilaian</h2><p className="muted">Penilaian ditampilkan berdasarkan akses unit akun yang sedang login.</p></div><span className="count-badge">{reviewsForUnit.length} catatan</span></div>{loading ? <div className="empty-state">Memuat riwayat…</div> : reviewsForUnit.length === 0 ? <div className="empty-state">Belum ada penilaian untuk unit ini.</div> : <div className="table-wrap"><table><thead><tr><th>Nama SDM</th><th>Penugasan</th><th>Periode</th><th>Nilai</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{reviewsForUnit.map((review) => { const assignment = assignmentMap[review.assignment_id]; return <tr key={review.id}><td><strong>{employeeMap[review.employee_id] || 'SDM'}</strong><small>{unitMap[review.unit_id] || ''}</small></td><td>{assignment?.assignment_title || positionMap[assignment?.position_id || ''] || 'Penugasan'}</td><td>{periodNames[review.period_type]}<small>{dateFmt(review.period_start)} – {dateFmt(review.period_end)}</small></td><td><strong>{scoreFmt(review.overall_score)}</strong><small>/ 5,00</small></td><td><span className={`status ${review.status === 'final' ? 'approved' : 'pending'}`}>{review.status === 'final' ? 'Final' : 'Draft'}</span></td><td><div className="performance-row-actions"><button className="btn secondary" onClick={() => void viewReview(review)} disabled={detailLoading}>{detailLoading ? 'Memuat…' : 'Lihat'}</button>{review.status === 'draft' && canManageUnit(review.unit_id) && <button className="btn secondary" onClick={() => void editDraft(review)} disabled={busy}>Edit Draft</button>}</div></td></tr> })}</tbody></table></div>}</section>}
    {tab === 'indicators' && isHrAdmin && <section className="content-card"><div className="section-head"><div><p className="eyebrow">KONFIGURASI EVALUASI</p><h2>Atur indikator kinerja</h2><p className="muted">Indikator dapat berlaku global, untuk unit tertentu, atau untuk kategori jabatan tertentu.</p></div><span className="count-badge">{indicators.length} indikator</span></div><form className="request-form indicator-admin-form" onSubmit={saveIndicator}><div className="form-grid"><label>Kode indikator *<input value={indicatorCode} onChange={(e) => setIndicatorCode(e.target.value)} placeholder="CONTOH: KEDISIPLINAN" required /></label><label>Nama indikator *<input value={indicatorName} onChange={(e) => setIndicatorName(e.target.value)} placeholder="Kedisiplinan dan ketepatan waktu" required /></label></div><label>Deskripsi / kriteria penilaian<textarea rows={2} value={indicatorDescription} onChange={(e) => setIndicatorDescription(e.target.value)} placeholder="Jelaskan perilaku atau hasil kerja yang dinilai." /></label><div className="form-grid"><label>Lingkup indikator<select value={indicatorScope} onChange={(e) => setIndicatorScope(e.target.value as 'global' | 'unit' | 'position')}><option value="global">Global — semua unit</option><option value="unit">Unit tertentu</option><option value="position">Jabatan tertentu</option></select></label><label>Bobot relatif (0–100) *<input type="number" min="0" max="100" step="0.5" value={indicatorWeight} onChange={(e) => setIndicatorWeight(e.target.value)} required /></label></div>{indicatorScope === 'unit' && <label>Unit *<select value={indicatorUnitId} onChange={(e) => setIndicatorUnitId(e.target.value)} required><option value="">Pilih unit</option>{operationalUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}{indicatorScope === 'position' && <label>Jabatan *<select value={indicatorPositionId} onChange={(e) => setIndicatorPositionId(e.target.value)} required><option value="">Pilih jabatan</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Tambah Indikator'}</button></div></form><div className="table-wrap indicator-table"><table><thead><tr><th>Indikator</th><th>Lingkup</th><th>Bobot</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{indicators.map((indicator) => <tr key={indicator.id}><td><strong>{indicator.name}</strong><small>{indicator.code}</small>{indicator.description && <small>{indicator.description}</small>}</td><td>{indicator.scope === 'global' ? 'Global' : indicator.scope === 'unit' ? unitMap[indicator.unit_id || ''] || 'Unit' : positionMap[indicator.position_id || ''] || 'Jabatan'}</td><td>{Number(indicator.weight)}%</td><td><span className={`status ${indicator.is_active ? 'approved' : 'inactive'}`}>{indicator.is_active ? 'Aktif' : 'Nonaktif'}</span></td><td><button className="btn secondary" onClick={() => void toggleIndicator(indicator)} disabled={busy}>{indicator.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>)}</tbody></table></div><p className="footnote">Bobot adalah nilai relatif. Nilai akhir dihitung dengan menormalkan jumlah bobot indikator yang berlaku untuk penugasan tersebut. Indikator yang sudah dipakai pada penilaian lama tidak dihapus; nonaktifkan jika tidak ingin dipakai pada penilaian baru.</p></section>}
    {viewingReview && <div className="performance-modal-backdrop" role="presentation" onClick={() => setViewingReview(null)}><section className="performance-modal" role="dialog" aria-modal="true" aria-label="Detail penilaian" onClick={(e) => e.stopPropagation()}><div className="section-head"><div><p className="eyebrow">DETAIL PENILAIAN</p><h2>{employeeMap[viewingReview.employee_id] || 'SDM'}</h2><p className="muted">{unitMap[viewingReview.unit_id] || ''} · {dateFmt(viewingReview.period_start)} – {dateFmt(viewingReview.period_end)}</p></div><button className="btn secondary" onClick={() => setViewingReview(null)}>Tutup</button></div><div className="detail-score-total"><span>Nilai akhir tertimbang</span><strong>{scoreFmt(viewingReview.overall_score)} / 5,00</strong></div><div className="table-wrap"><table><thead><tr><th>Indikator</th><th>Nilai</th><th>Catatan</th></tr></thead><tbody>{viewingScores.map((score) => { const indicator = indicators.find((i) => i.id === score.indicator_id); return <tr key={score.indicator_id}><td>{indicator?.name || 'Indikator'}</td><td><strong>{score.score}</strong></td><td>{score.comments || '—'}{score.evidence_url && <small><a href={score.evidence_url} target="_blank" rel="noreferrer">Buka bukti</a></small>}</td></tr> })}</tbody></table></div>{viewingReview.comments && <div className="performance-general-comment"><strong>Catatan umum</strong><p>{viewingReview.comments}</p></div>}</section></div>}
    <p className="footnote">Nilai akhir dihitung dari rata-rata tertimbang indikator aktif yang sesuai dengan penugasan. Penilaian final terkunci untuk kepala unit; perubahan final hanya dapat dilakukan Sekjen/Super Admin sesuai kebijakan database.</p>
  </div>
}
