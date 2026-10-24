import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { fetchAllRows } from './lib/fetchAll'
import { todayWib } from './lib/dates'
import ForcePasswordChange from './ForcePasswordChange'
import DashboardActions from './DashboardActions'
import AttendanceModule from './AttendanceModule'
import PerformanceModule from './PerformanceModule'
import ReportsModule from './ReportsModule'
import UserManagementModule from './UserManagementModule'
import AbsenceRequestsModule from './AbsenceRequestsModule'
import ActivityMonitoringModule from './ActivityMonitoringModule'
import PublicAbsenceForm from './PublicAbsenceForm'
import './App.css'

type Role = 'super_admin' | 'sekjen' | 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' | 'pimpinan'
type Unit = { id: string; code: string; name: string; parent_unit_id: string | null; is_active: boolean; unit_type: 'group' | 'operational' }
type Position = { id: string; code: string; name: string; is_active: boolean }
type Access = { unit_id: string; access_role: 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' }
type Employee = { id: string; full_name: string; employment_status: 'active' | 'inactive' | 'on_leave'; start_date: string | null; end_date: string | null; created_at: string }
type Assignment = { id: string; employee_id: string; unit_id: string; position_id: string | null; assignment_title: string | null; status: 'active' | 'inactive'; start_date: string; end_date: string | null; work_arrangement: 'monthly' | 'hourly' | 'session' | 'shift' | 'other' }
type Bio = { employee_id: string; nik: string; gender: 'L' | 'P'; place_of_birth: string; date_of_birth: string; religion: string | null; marital_status: string; education_level: string; address: string; phone: string; email: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null }
type View = 'dashboard' | 'people' | 'submit' | 'attendance' | 'performance' | 'reports' | 'users' | 'requests' | 'activities'
type AssignmentForm = { unit_id: string; nik: string; full_name: string; gender: string; place_of_birth: string; date_of_birth: string; religion: string; marital_status: string; education_level: string; address: string; phone: string; email: string; emergency_contact_name: string; emergency_contact_phone: string; position_id: string; assignment_title: string; work_arrangement: string; start_date: string; notes: string }

const today = todayWib()
const emptyForm: AssignmentForm = { unit_id: '', nik: '', full_name: '', gender: '', place_of_birth: '', date_of_birth: '', religion: '', marital_status: '', education_level: '', address: '', phone: '', email: '', emergency_contact_name: '', emergency_contact_phone: '', position_id: '', assignment_title: '', work_arrangement: 'monthly', start_date: today, notes: '' }
const roleNames: Record<Role, string> = { super_admin: 'Super Admin', sekjen: 'Sekjen / Admin SDM', kepala_unit: 'Kepala Unit', petugas_absensi: 'Petugas Absensi', operator_sdm: 'Operator SDM Unit', pimpinan: 'Pimpinan' }
const unitRoleNames: Record<Access['access_role'], string> = { kepala_unit: 'Kepala Unit', petugas_absensi: 'Petugas Absensi', operator_sdm: 'Operator SDM Unit' }
const dateFmt = (s?: string | null) => s ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${s.slice(0, 10)}T00:00:00`)) : '—'

function App() {
  const isPublicAbsenceForm = typeof window !== 'undefined' && (window.location.pathname.replace(/\/+$/, '') === '/form-izin' || new URLSearchParams(window.location.search).get('form') === 'izin')
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [displayName, setDisplayName] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [accesses, setAccesses] = useState<Access[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [biodata, setBiodata] = useState<Record<string, Bio>>({})
  const [view, setView] = useState<View>('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [showInactiveEmployees, setShowInactiveEmployees] = useState(false)
  const [form, setForm] = useState<AssignmentForm>(emptyForm)
  const [nikCheckedFor, setNikCheckedFor] = useState('')
  const [nikExists, setNikExists] = useState<boolean | null>(null)

  const isHrAdmin = roles.includes('sekjen') || roles.includes('super_admin')
  const canSubmitAny = isHrAdmin || accesses.some((a) => ['kepala_unit', 'operator_sdm'].includes(a.access_role))
  const isPimpinan = roles.includes('pimpinan')
  const operationalUnits = useMemo(() => units.filter((u) => u.is_active && u.unit_type === 'operational'), [units])
  const canAccessAttendance = isHrAdmin || isPimpinan || accesses.some((a) => ['kepala_unit', 'petugas_absensi'].includes(a.access_role))
  const canAccessPerformance = isHrAdmin || isPimpinan || accesses.some((a) => a.access_role === 'kepala_unit')
  const canAccessReports = isHrAdmin || isPimpinan || accesses.some((a) => ['kepala_unit', 'petugas_absensi', 'operator_sdm'].includes(a.access_role))
  const canAccessRequests = isHrAdmin || accesses.some((a) => a.access_role === 'kepala_unit')
  const canAccessActivities = isHrAdmin || isPimpinan || accesses.some((a) => ['kepala_unit', 'operator_sdm', 'petugas_absensi'].includes(a.access_role))
  const attendanceUnits = useMemo(() => isHrAdmin || isPimpinan ? operationalUnits : operationalUnits.filter((u) => accesses.some((a) => a.unit_id === u.id && ['kepala_unit', 'petugas_absensi'].includes(a.access_role))), [isHrAdmin, isPimpinan, operationalUnits, accesses])
  const allowedUnits = useMemo(() => isHrAdmin ? operationalUnits : operationalUnits.filter((u) => accesses.some((a) => a.unit_id === u.id && ['kepala_unit', 'operator_sdm'].includes(a.access_role))), [isHrAdmin, operationalUnits, accesses])
  const reportUnits = useMemo(() => isHrAdmin || isPimpinan ? operationalUnits : operationalUnits.filter((u) => accesses.some((a) => a.unit_id === u.id)), [isHrAdmin, isPimpinan, operationalUnits, accesses])
  const unitMap = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.name])) as Record<string, string>, [units])
  const positionMap = useMemo(() => Object.fromEntries(positions.map((p) => [p.id, p.name])) as Record<string, string>, [positions])
  const accountRoleLabel = useMemo(() => {
    const labels = [
      ...roles.map((role) => roleNames[role] || role),
      ...accesses.map((access) => unitRoleNames[access.access_role]),
    ]
    return [...new Set(labels)].join(' · ') || 'Belum diberi peran'
  }, [roles, accesses])

  const loadData = useCallback(async (userId: string) => {
    if (!supabase) return
    setDataLoading(true)
    setError('')
    const roleRes = await supabase.from('user_roles').select('role').eq('user_id', userId)
    const loadedRoles = (roleRes.data ?? []).map((r) => r.role as Role)
    setRoles(loadedRoles)
    const [unitRes, profileRes, positionRes, accessRes, employeeRes, assignmentRes] = await Promise.all([
      supabase.from('units').select('id, code, name, parent_unit_id, is_active, unit_type').eq('is_active', true).order('name'),
      supabase.from('user_profiles').select('display_name, is_active').eq('id', userId).maybeSingle(),
      supabase.from('positions').select('id, code, name, is_active').eq('is_active', true).order('name'),
      supabase.from('user_unit_access').select('unit_id, access_role').eq('user_id', userId),
      // Dibaca per halaman agar tidak terpotong diam-diam pada batas 1000 baris PostgREST.
      fetchAllRows<Employee>((from, to) => supabase!.from('employees').select('id, full_name, employment_status, start_date, end_date, created_at').order('full_name').order('id').range(from, to)),
      fetchAllRows<Assignment>((from, to) => supabase!.from('employee_assignments').select('id, employee_id, unit_id, position_id, assignment_title, status, start_date, end_date, work_arrangement').order('start_date', { ascending: false }).order('id').range(from, to)),
    ])
    const errors = [roleRes.error, unitRes.error, profileRes.error, positionRes.error, accessRes.error, employeeRes.error, assignmentRes.error].filter(Boolean)
    if (errors.length) setError(`Sebagian data tidak dapat dimuat: ${errors.map((e) => e?.message).join(' · ')}`)
    if (!unitRes.error) setUnits((unitRes.data ?? []) as Unit[])
    if (!profileRes.error) {
      setDisplayName(profileRes.data?.display_name || session?.user.email || 'Pengguna')
      if (profileRes.data && !profileRes.data.is_active) {
        // Akun nonaktif tidak boleh tetap login; sesi diakhiri dan pesan tetap tampil di halaman masuk.
        await supabase.auth.signOut()
        setError('Akun ini dinonaktifkan. Hubungi Sekjen.')
        setDataLoading(false)
        return
      }
    }
    if (!positionRes.error) setPositions((positionRes.data ?? []) as Position[])
    if (!accessRes.error) setAccesses((accessRes.data ?? []) as Access[])
    if (!employeeRes.error) setEmployees(employeeRes.data)
    if (!assignmentRes.error) setAssignments(assignmentRes.data)

    if (loadedRoles.includes('sekjen') || loadedRoles.includes('super_admin')) {
      const bioRes = await supabase.from('employee_biodata').select('employee_id, nik, gender, place_of_birth, date_of_birth, religion, marital_status, education_level, address, phone, email, emergency_contact_name, emergency_contact_phone')
      if (bioRes.error) setError((prev) => `${prev ? `${prev} · ` : ''}Biodata: ${bioRes.error.message}`)
      else { const m: Record<string, Bio> = {}; ((bioRes.data ?? []) as Bio[]).forEach((b) => { m[b.employee_id] = b }); setBiodata(m) }
    } else { setBiodata({}) }
    setDataLoading(false)
  }, [session?.user.email])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let mounted = true
    supabase.auth.getSession().then(({ data, error: e }) => { if (!mounted) return; if (e) setError(e.message); setSession(data.session); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false) })
    return () => { mounted = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (isPublicAbsenceForm) return
    if (!session) {
      setRoles([]); setUnits([]); setPositions([]); setAccesses([]); setEmployees([]); setAssignments([]); setBiodata({}); setDisplayName('')
      return
    }
    void loadData(session.user.id)
  }, [session, loadData, isPublicAbsenceForm])

  useEffect(() => {
    if (!form.unit_id && allowedUnits.length) setForm((f) => ({ ...f, unit_id: allowedUnits[0].id }))
  }, [allowedUnits, form.unit_id])

  // Reveal cards as they enter the viewport. This covers every internal module,
  // the login/setup pages, and the public absence form without changing module logic.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const revealSelector = [
      '.main-area > .topbar',
      '.main-area > .page-alert',
      '.main-area > .hero-card',
      '.main-area > .stat-grid > *',
      '.main-area > .dashboard-columns > *',
      '.main-area > .content-card',
      '.main-area > .attendance-module',
      '.main-area > .performance-module',
      '.main-area > .reports-module',
      '.main-area .content-card',
      '.main-area .stat-card',
      '.main-area .dashboard-widget',
      '.main-area .attendance-summary-card',
      '.main-area .attendance-grid-wrap',
      '.main-area .performance-hero',
      '.main-area .performance-stats > *',
      '.main-area .performance-form-card',
      '.main-area .reports-filter-card',
      '.main-area .reports-stats > *',
      '.main-area .rq-um-hero',
      '.main-area .rq-um-card',
      '.main-area .rq-um-stats > *',
      '.main-area .absence-admin-intro',
      '.main-area .absence-inbox-card',
      '.main-area .absence-stat',
      '.main-area .activity-page-intro',
      '.main-area .activity-panel',
      '.main-area .activity-program-card',
      '.main-area .request-card',
      '.main-area .table-wrap',
      '.public-absence-header',
      '.public-absence-form',
      '.public-absence-notice',
      '.public-absence-error',
      '.public-absence-success',
      '.login-hero',
      '.login-panel',
      '.login-card',
      '.setup-card'
    ].join(',')

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const observedElements = new WeakSet<Element>()
    const observer = 'IntersectionObserver' in window && !reducedMotion
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            entry.target.classList.add('rq-scroll-revealed')
            observer?.unobserve(entry.target)
          })
        }, { threshold: 0.08, rootMargin: '0px 0px -36px 0px' })
      : null

    const revealWithin = (root: ParentNode) => {
      const matches: Element[] = []
      if (root instanceof Element && root.matches(revealSelector)) matches.push(root)
      root.querySelectorAll(revealSelector).forEach((element) => matches.push(element))
      matches.forEach((element, index) => {
        if (observedElements.has(element)) return
        observedElements.add(element)
        element.classList.add('rq-scroll-reveal')
        element.classList.remove('rq-scroll-revealed');
        (element as HTMLElement).style.setProperty('--rq-reveal-delay', `${(index % 4) * 55}ms`)
        if (observer) observer.observe(element)
        else element.classList.add('rq-scroll-revealed')
      })
    }

    revealWithin(document.body)
    const mutations = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof Element) revealWithin(node)
      }))
    })
    mutations.observe(document.body, { childList: true, subtree: true })

    return () => {
      mutations.disconnect()
      observer?.disconnect()
    }
  }, [view, session, loading, isPublicAbsenceForm])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    const closeOnDesktop = () => {
      if (window.innerWidth > 760) setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnDesktop)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnDesktop)
    }
  }, [])

  useEffect(() => {
    if (!mobileMenuOpen || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [mobileMenuOpen])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    setBusy(true); setError(''); setNotice('')
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (e) setError('Login gagal. Periksa email, kata sandi, dan status akun Supabase Auth.')
    setBusy(false)
  }
  async function logout() { if (!supabase) return; setBusy(true); const { error: e } = await supabase.auth.signOut(); if (e) setError(e.message); setBusy(false) }

  function updateForm<K extends keyof AssignmentForm>(key: K, value: AssignmentForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'nik' || key === 'unit_id') { setNikCheckedFor(''); setNikExists(null) }
  }

  async function checkNik() {
    if (!supabase) return
    const nik = form.nik.trim()
    if (!/^\d{16}$/.test(nik)) { setError('NIK harus tepat 16 digit angka.'); return }
    if (!form.unit_id) { setError('Pilih unit kerja terlebih dahulu.'); return }
    setBusy(true); setError(''); setNotice('')
    const { data, error: e } = await supabase.rpc('employee_nik_exists_for_unit', { p_unit_id: form.unit_id, p_nik: nik })
    if (e) {
      setError(e.message.includes('employee_nik_exists_for_unit') ? 'Fungsi pemeriksaan NIK belum tersedia. Jalankan 07_direct_input_no_unit_requests.sql di Supabase SQL Editor.' : e.message)
      setNikExists(null); setNikCheckedFor('')
    } else {
      setNikExists(Boolean(data)); setNikCheckedFor(nik)
      setNotice(data ? 'NIK sudah terdaftar. Biodata pribadi tidak ditampilkan; penugasan akan ditambahkan ke profil orang yang sama.' : 'NIK belum ditemukan. Lengkapi biodata untuk membuat satu profil baru dan penugasannya.')
    }
    setBusy(false)
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return
    if (!allowedUnits.some((u) => u.id === form.unit_id)) { setError('Unit tidak termasuk kewenangan akun ini.'); return }
    if (nikCheckedFor !== form.nik.trim() || nikExists === null) { setError('Periksa NIK terlebih dahulu sebelum menyimpan.'); return }
    if (!form.assignment_title.trim()) { setError('Jabatan atau rincian penugasan wajib diisi.'); return }
    if (nikExists === false) {
      if (!form.full_name.trim() || !form.gender || !form.place_of_birth.trim() || !form.date_of_birth || !form.marital_status || !form.education_level || !form.address.trim() || !form.phone.trim()) { setError('Lengkapi seluruh biodata wajib untuk SDM baru.'); return }
      if (form.date_of_birth > today) { setError('Tanggal lahir tidak boleh di masa depan.'); return }
    }
    setBusy(true); setError(''); setNotice('')
    const { data, error: e } = await supabase.rpc('register_employee_assignment_direct', {
      p_unit_id: form.unit_id,
      p_nik: form.nik.trim(),
      p_full_name: nikExists ? null : form.full_name.trim(),
      p_gender: nikExists ? null : form.gender,
      p_place_of_birth: nikExists ? null : form.place_of_birth.trim(),
      p_date_of_birth: nikExists ? null : form.date_of_birth,
      p_religion: nikExists ? null : (form.religion || null),
      p_marital_status: nikExists ? null : form.marital_status,
      p_education_level: nikExists ? null : form.education_level,
      p_address: nikExists ? null : form.address.trim(),
      p_phone: nikExists ? null : form.phone.trim(),
      p_email: nikExists ? null : (form.email.trim() || null),
      p_emergency_contact_name: nikExists ? null : (form.emergency_contact_name.trim() || null),
      p_emergency_contact_phone: nikExists ? null : (form.emergency_contact_phone.trim() || null),
      p_position_id: form.position_id || null,
      p_assignment_title: form.assignment_title.trim(),
      p_work_arrangement: form.work_arrangement,
      p_start_date: form.start_date || today,
      p_end_date: null,
      p_notes: form.notes.trim() || null,
    })
    if (e) setError(e.message)
    else {
      const result = data as { outcome?: string; message?: string } | null
      setNotice(result?.message || 'Data SDM dan penugasan berhasil disimpan.')
      setForm({ ...emptyForm, unit_id: allowedUnits[0]?.id ?? '' }); setNikExists(null); setNikCheckedFor(''); setView('people')
      if (session) await loadData(session.user.id)
    }
    setBusy(false)
  }

  async function removeEmployee(employee: Employee) {
    if (!supabase || !isHrAdmin) {
      setError('Hanya Sekjen atau Super Admin yang dapat menghapus atau mengarsipkan SDM.')
      return
    }
    const confirmation = window.confirm(
      `Hapus SDM "${employee.full_name}" dari daftar aktif?\n\n` +
      'Jika SDM memiliki riwayat absensi, jadwal, izin, tugas, atau penilaian, sistem akan mengarsipkan SDM dan mempertahankan riwayat tersebut. ' +
      'Jika belum memiliki riwayat, data SDM dan penugasannya dapat dihapus permanen.\n\nLanjutkan?'
    )
    if (!confirmation) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error: removeError } = await supabase.rpc('remove_employee_safely', {
        p_employee_id: employee.id,
      })
      if (removeError) throw removeError
      const result = data as { mode?: string; message?: string } | null
      setNotice(result?.message || 'Permintaan penghapusan SDM berhasil diproses.')
      if (session) await loadData(session.user.id)
    } catch (cause) {
      setError(`SDM gagal dihapus: ${cause instanceof Error ? cause.message : String(cause)}. Pastikan migrasi 11_safe_employee_removal.sql sudah dijalankan.`)
    } finally {
      setBusy(false)
    }
  }

  const activeEmployees = employees.filter((e) => e.employment_status === 'active').length
  const activeAssignments = assignments.filter((a) => a.status === 'active' && (!a.end_date || a.end_date >= today)).length
  const activeAssignmentCount = useMemo(() => assignments.filter((a) => a.status === 'active' && (!a.end_date || a.end_date >= today)).reduce((m, a) => { m[a.employee_id] = (m[a.employee_id] || 0) + 1; return m }, {} as Record<string, number>), [assignments])
  const multiCount = Object.values(activeAssignmentCount as Record<string, number>).filter((n: number) => n > 1).length
  const dashboardDate = new Date()
  const dashboardMonthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(dashboardDate)
  const dashboardCalendarCells = useMemo(() => {
    const year = dashboardDate.getFullYear()
    const month = dashboardDate.getMonth()
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<number | null> = []
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [])
  const dashboardVisibleUnits = useMemo(() => isHrAdmin || isPimpinan ? operationalUnits : operationalUnits.filter((unit) => accesses.some((access) => access.unit_id === unit.id)), [isHrAdmin, isPimpinan, operationalUnits, accesses])
  const dashboardUnitStats = useMemo(() => dashboardVisibleUnits.map((unit) => ({
    id: unit.id,
    name: unit.name,
    count: assignments.filter((assignment) => assignment.unit_id === unit.id && assignment.status === 'active' && (!assignment.end_date || assignment.end_date >= today)).length,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'id')).slice(0, 6), [dashboardVisibleUnits, assignments])
  const maxDashboardUnitCount = Math.max(1, ...dashboardUnitStats.map((unit) => unit.count))
  const onLeaveEmployees = employees.filter((employee) => employee.employment_status === 'on_leave').length
  const inactiveEmployees = employees.filter((employee) => employee.employment_status === 'inactive').length
  const filteredEmployees = employees.filter((e) => {
    const b = biodata[e.id]
    const as = assignments.filter((a) => a.employee_id === e.id)
    const q = search.toLocaleLowerCase('id')
    const matchSearch = e.full_name.toLocaleLowerCase('id').includes(q) || (isHrAdmin && (b?.nik || '').includes(search.trim()))
    const matchUnit = unitFilter === 'all' || as.some((a) => a.unit_id === unitFilter)
    const matchStatus = isHrAdmin && showInactiveEmployees ? true : e.employment_status !== 'inactive'
    return matchSearch && matchUnit && matchStatus
  })
  const navItems: { id: View; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Ringkasan Sistem', icon: '▦' },
    { id: 'people', label: isHrAdmin ? 'Pusat Data SDM' : 'Data SDM Unit', icon: '♙' },
    ...(canSubmitAny ? [{ id: 'submit' as View, label: 'Pencatatan SDM', icon: '＋' }] : []),
    ...(canAccessAttendance ? [{ id: 'attendance' as View, label: 'Rekap Absensi Bulanan', icon: '▦' }] : []),
    ...(canAccessPerformance ? [{ id: 'performance' as View, label: 'Penilaian Kinerja', icon: '✓' }] : []),
    ...(canAccessActivities ? [{ id: 'activities' as View, label: 'Monitoring Aktivitas Unit', icon: '▤' }] : []),
    ...(canAccessRequests ? [{ id: 'requests' as View, label: 'Izin & Ketidakhadiran', icon: '▣' }] : []),
    ...(canAccessReports ? [{ id: 'reports' as View, label: 'Laporan Administrasi', icon: '▤' }] : []),
    ...(isHrAdmin ? [{ id: 'users' as View, label: 'Manajemen Pengguna', icon: '♙' }] : []),
  ]
  const itemsFor = (ids: View[]) => navItems.filter((item) => ids.includes(item.id))
  const navGroups = [
    { title: 'BERANDA', items: itemsFor(['dashboard']) },
    { title: 'ADMINISTRASI SDM', items: itemsFor(['people', 'submit', 'attendance']) },
    { title: 'KINERJA & AKTIVITAS', items: itemsFor(['performance', 'activities']) },
    { title: 'LAYANAN SDM', items: itemsFor(['requests']) },
    { title: 'PELAPORAN & TATA KELOLA', items: itemsFor(['reports', 'users']) },
  ].filter((group) => group.items.length > 0)

  const pageTitle = view === 'dashboard' ? 'Ringkasan Sistem SDM'
    : view === 'people' ? (isHrAdmin ? 'Pusat Data SDM' : 'Data SDM Unit')
    : view === 'submit' ? 'Pencatatan SDM dan Penugasan'
    : view === 'attendance' ? 'Rekap Absensi Bulanan'
    : view === 'performance' ? 'Penilaian Kinerja'
    : view === 'reports' ? 'Laporan Administrasi'
    : view === 'users' ? 'Manajemen Pengguna'
    : view === 'requests' ? 'Izin dan Ketidakhadiran SDM'
    : view === 'activities' ? 'Monitoring Aktivitas Unit'
    : 'Sistem Monitoring SDM'
  const pageDescription = view === 'dashboard' ? 'Ringkasan administrasi SDM, kehadiran, dan aktivitas seluruh unit sesuai kewenangan Anda.'
    : view === 'people' ? (isHrAdmin ? 'Pusat data pegawai dan seluruh penugasan dengan satu identitas untuk setiap SDM.' : 'Daftar SDM dan penugasan yang berada dalam kewenangan unit Anda.')
    : view === 'submit' ? 'Pencatatan biodata dan penugasan SDM secara terstruktur, tanpa menggandakan identitas.'
    : view === 'attendance' ? 'Input rekap kehadiran satu bulan untuk setiap penugasan. Absensi harian dikelola sistem lain.'
    : view === 'performance' ? 'Evaluasi pelaksanaan tugas berdasarkan penugasan, indikator, dan catatan penilaian.'
    : view === 'reports' ? 'Penyusunan dan pencetakan laporan administrasi SDM berdasarkan periode dan unit.'
    : view === 'users' ? 'Pengelolaan akun, peran, dan penugasan akses pengguna sistem.'
    : view === 'requests' ? 'Pemeriksaan pengajuan izin dan ketidakhadiran SDM sesuai unit kerja.'
    : view === 'activities' ? 'Perencanaan program, pencatatan perkembangan, dan evaluasi kegiatan setiap unit.'
    : 'Pengelolaan administrasi SDM Dayah Ruhul Qurani secara terintegrasi.'

  if (!isSupabaseConfigured) return <main className="setup-page"><section className="setup-card"><img src="/rq-logo.png" alt="Logo Dayah Ruhul Qurani"/><p className="eyebrow">DAYAH RUHUL QURANI</p><h1>Hubungkan Supabase</h1><p>Isi file <code>.env.local</code> di folder utama proyek.</p><pre>{'VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...'}</pre><small>Gunakan publishable/anon key saja. Jangan masukkan service-role key ke frontend.</small></section></main>
  if (isPublicAbsenceForm) return <PublicAbsenceForm />
  if (loading) return <main className="center-page"><div className="spinner"/><p>Memeriksa sesi login…</p></main>
  if (session && session.user.user_metadata?.must_change_password === true) return <ForcePasswordChange email={session.user.email || ''} onDone={async () => { await supabase?.auth.refreshSession() }} onLogout={logout} />
  if (!session) return <main className="login-page"><section className="login-hero"><div className="logo-lockup"><img src="/rq-logo.png" alt="Logo Dayah Ruhul Qurani"/><div><strong>RQ SDM</strong><span>DAYAH RUHUL QURANI</span></div></div><p className="eyebrow light">SISTEM MONITORING SUMBER DAYA MANUSIA</p><h1>Dari laut<br/><span>menuju langit.</span></h1><p className="hero-copy">Sistem informasi internal untuk mendukung tata kelola SDM, kehadiran, dan aktivitas unit secara tertib serta bertanggung jawab.</p><div className="login-verse"><p className="verse-reference">PENGGALAN QS. AT-TAUBAH [9]: 105</p><p className="verse-arabic" lang="ar" dir="rtl">وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ</p><p className="verse-translation">“Dan katakanlah, ‘Bekerjalah kamu, maka Allah akan melihat pekerjaanmu, begitu juga Rasul-Nya dan orang-orang mukmin.’”</p></div><div className="sea-sky"><span>LAUT · FONDASI</span><i/><span>LANGIT · CITA-CITA</span></div></section><section className="login-panel"><form className="login-card" onSubmit={login}><p className="eyebrow">PORTAL INTERNAL</p><h2>Selamat datang</h2><p className="muted">Masuk menggunakan akun resmi yang telah diberikan oleh administrator.</p><label>Email</label><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required/><label>Kata sandi</label><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required/>{error && <div className="alert error">{error}</div>}<button className="btn primary" disabled={busy}>{busy ? 'Memproses…' : 'Masuk ke RQ SDM'}</button><small>Hak akses ditetapkan berdasarkan peran dan unit kerja.</small></form></section></main>

  return <main className="app-shell">
    {mobileMenuOpen && <button type="button" className="sidebar-backdrop" aria-label="Tutup menu navigasi" onClick={() => setMobileMenuOpen(false)} />}
    <aside id="rq-sdm-sidebar" className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src="/rq-logo.png" alt="Logo RQ"/><div><strong>RQ SDM</strong><span>Dayah Ruhul Qurani</span></div><button type="button" className="sidebar-close" aria-label="Tutup menu" onClick={() => setMobileMenuOpen(false)}>×</button></div>
      <div className="side-caption">NAVIGASI SISTEM</div>
      <nav className="sidebar-nav" aria-label="Menu utama">
        {navGroups.map((group) => <section className="nav-group" key={group.title}>
          <div className="nav-group-title">{group.title}</div>
          {group.items.map((item) => <button key={item.id} type="button" className={`side-link ${view === item.id ? 'selected' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); setError(''); setNotice(''); setMobileMenuOpen(false) }}><span aria-hidden="true">{item.icon}</span><span className="side-link-label">{item.label}</span></button>)}
        </section>)}
      </nav>
      <div className="sidebar-photo" role="img" aria-label="Masjid Dayah Ruhul Qurani"><div className="sidebar-photo-caption"><strong>DAYAH RUHUL QURANI</strong><span>Berlandaskan nilai Al-Qur’an</span></div></div>
      <div className="sidebar-bottom"><span className="online-dot"/>Sistem terhubung<div className="user-mini"><div className="avatar">{(displayName || session.user.email || 'RQ').slice(0, 1).toUpperCase()}</div><div><strong>{displayName || 'Pengguna'}</strong><span>{accountRoleLabel}</span></div></div><button className="logout" onClick={logout} disabled={busy}>Keluar dari Sistem</button></div>
    </aside>
    <section className="main-area"><header className="topbar" aria-label="Header halaman">
      <div className="topbar-main">
        <button type="button" className="mobile-menu-trigger" aria-label="Buka menu navigasi" aria-controls="rq-sdm-sidebar" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}><span aria-hidden="true">☰</span><span>Menu</span></button>
        <div className="topbar-heading">
          <p className="eyebrow">DAYAH RUHUL QURANI · SISTEM INFORMASI INTERNAL</p>
          <h1>{pageTitle}</h1>
          <p className="topbar-description">{pageDescription}</p>
        </div>
        <div className="top-actions">
          <span className="role-chip">{accountRoleLabel}</span>
          <button className="refresh-btn" onClick={() => session && loadData(session.user.id)} disabled={dataLoading}>{dataLoading ? 'Memuat data…' : '↻ Perbarui Data'}</button>
        </div>
      </div>
      <div className="topbar-verse">
        <div className="verse-meta"><span>PENGGALAN QS. AT-TAUBAH [9]: 105</span><span className="verse-principle">AMANAH · IKHTIAR · TANGGUNG JAWAB</span></div>
        <p className="verse-arabic" lang="ar" dir="rtl">وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ</p>
        <p className="verse-translation">“Dan katakanlah, ‘Bekerjalah kamu, maka Allah akan melihat pekerjaanmu, begitu juga Rasul-Nya dan orang-orang mukmin.’”</p>
      </div>

    </header>
      {error && <div className="alert error page-alert">{error}</div>}{notice && <div className="alert success page-alert">{notice}</div>}
      {view === 'dashboard' && <>
        <section className="hero-card dashboard-welcome"><div><p className="eyebrow light">ASSALAMU’ALAIKUM · SISTEM INFORMASI SDM</p><h2>{isHrAdmin ? 'Selamat datang di Sistem Monitoring SDM.' : 'Selamat datang kembali.'}</h2><p>{isHrAdmin ? 'Sistem ini mendukung pengelolaan data SDM, administrasi kehadiran, dan evaluasi kinerja Dayah Ruhul Qurani secara terintegrasi.' : 'Silakan gunakan modul sesuai peran dan kewenangan yang telah ditetapkan.'}</p></div><div className="hero-watermark" aria-hidden="true">ر ق</div></section>
        <DashboardActions units={dashboardVisibleUnits} assignments={assignments} canSeeRequests={canAccessRequests} canSeeAttendance={canAccessAttendance} canSeePerformance={canAccessPerformance} onNavigate={(next) => { setView(next); setError(''); setNotice('') }} />
        <div className="stat-grid dashboard-stat-grid"><article className="stat-card"><span className="stat-icon">♙</span><p>{isHrAdmin ? 'SDM terdaftar' : 'SDM dalam cakupan'}</p><strong>{dataLoading ? '…' : employees.length.toLocaleString('id-ID')}</strong><small>{activeEmployees} SDM aktif</small></article><article className="stat-card"><span className="stat-icon cyan">⌘</span><p>Penugasan aktif</p><strong>{dataLoading ? '…' : activeAssignments.toLocaleString('id-ID')}</strong><small>Setiap penugasan dikelola secara terpisah</small></article><article className="stat-card"><span className="stat-icon gold">⇄</span><p>Multi-penugasan</p><strong>{dataLoading ? '…' : isHrAdmin ? multiCount.toLocaleString('id-ID') : '—'}</strong><small>{isHrAdmin ? 'SDM dengan lebih dari satu tugas aktif' : 'Ringkasan ini tersedia bagi Sekjen'}</small></article><article className="stat-card"><span className="stat-icon sky">⌂</span><p>Unit operasional</p><strong>{dataLoading ? '…' : (isHrAdmin || isPimpinan ? operationalUnits.length : dashboardVisibleUnits.length).toLocaleString('id-ID')}</strong><small>Unit dalam cakupan pemantauan</small></article></div>
        <div className="dashboard-columns">
          <div className="dashboard-column">
            <section className="content-card dashboard-widget dashboard-calendar-card"><div className="section-head dashboard-widget-head"><div><p className="eyebrow">KALENDER</p><h2>Kalender kerja</h2><p className="muted">{dashboardMonthLabel} · tanggal saat ini ditandai</p></div><span className="dashboard-month-badge">{new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(dashboardDate).toUpperCase()}</span></div><div className="dashboard-calendar-grid dashboard-calendar-weekdays">{['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map((day) => <span key={day}>{day}</span>)}</div><div className="dashboard-calendar-grid dashboard-calendar-days">{dashboardCalendarCells.map((day, index) => day === null ? <span className="calendar-empty" key={`empty-${index}`} aria-hidden="true"/> : <span key={day} className={`calendar-day ${day === dashboardDate.getDate() ? 'today' : ''}`}>{day}</span>)}</div><div className="calendar-legend"><span><i className="legend-today"/> Hari ini</span><small>Kalender ini menunjukkan tanggal, bukan catatan kehadiran.</small></div></section>
            <section className="content-card dashboard-widget"><div className="section-head dashboard-widget-head"><div><p className="eyebrow">RUANG KERJA</p><h2>Akses Modul</h2><p className="muted">Pilih modul administrasi yang akan diakses.</p></div></div><div className="dashboard-quick-list">{navItems.filter((item) => item.id !== 'dashboard').slice(0, 5).map((item) => { const descriptions: Record<string, string> = { people: 'Biodata dan seluruh penugasan yang dapat diakses', submit: 'Mencatat profil atau penugasan berdasarkan NIK', attendance: 'Input rekap kehadiran sekali sebulan', performance: 'Evaluasi kinerja berdasarkan penugasan', reports: 'Rekap administrasi dan ekspor laporan', users: 'Pengelolaan akun, peran, dan akses unit' }; return <button type="button" className="dashboard-quick-item" key={item.id} onClick={() => setView(item.id)}><span className="dashboard-quick-icon">{item.icon}</span><span className="dashboard-quick-copy"><strong>{item.label}</strong><small>{descriptions[item.id] || 'Buka modul ini'}</small></span><span className="dashboard-quick-arrow">↗</span></button> })}</div></section>
          </div>
          <div className="dashboard-column">
            <section className="content-card dashboard-widget dashboard-unit-chart"><div className="section-head dashboard-widget-head"><div><p className="eyebrow">DISTRIBUSI UNIT</p><h2>Penugasan per unit</h2><p className="muted">Jumlah penugasan aktif yang terlihat oleh akun ini.</p></div><span className="dashboard-chart-mark">▥</span></div>{dashboardUnitStats.length ? <div className="dashboard-bar-list">{dashboardUnitStats.map((unit, index) => <div className="dashboard-bar-row" key={unit.id}><div className="dashboard-bar-label"><strong>{unit.name}</strong><span>{unit.count} penugasan</span></div><div className="dashboard-bar-track"><span className={`dashboard-bar-fill bar-color-${index % 4}`} style={{ width: `${unit.count ? Math.max(5, unit.count / maxDashboardUnitCount * 100) : 0}%` }}/></div><strong className="dashboard-bar-value">{unit.count}</strong></div>)}</div> : <div className="empty-state">Belum ada unit dalam cakupan akun ini.</div>}<div className="dashboard-chart-foot"><span><i className="chart-dot navy"/> Penugasan aktif</span><small>Data ditampilkan sesuai kewenangan akun.</small></div></section>
            <section className="content-card dashboard-widget dashboard-overview-card"><div className="section-head dashboard-widget-head"><div><p className="eyebrow">RINGKASAN SDM</p><h2>Status pegawai</h2><p className="muted">Ringkasan dari data yang dapat diakses.</p></div></div><div className="dashboard-status-list"><div><span className="dashboard-status-icon status-green">✓</span><span><strong>SDM aktif</strong><small>Memiliki status kepegawaian aktif</small></span><b>{activeEmployees}</b></div><div><span className="dashboard-status-icon status-amber">◷</span><span><strong>Sedang cuti</strong><small>Status kepegawaian cuti</small></span><b>{onLeaveEmployees}</b></div><div><span className="dashboard-status-icon status-red">—</span><span><strong>Nonaktif</strong><small>Tidak aktif dalam sistem</small></span><b>{inactiveEmployees}</b></div></div><div className="dashboard-unit-footer"><span>Struktur Unit</span><strong>{dashboardVisibleUnits.length} unit tersedia</strong><button type="button" onClick={() => setView('people')}>Lihat Data SDM <span>→</span></button></div></section>
          </div>
        </div>
      </>}
      {view === 'people' && <section className="content-card"><div className="section-head"><div><p className="eyebrow">DIREKTORI PEGAWAI</p><h2>{isHrAdmin ? 'Pusat Data SDM' : 'Daftar SDM unit'}</h2><p className="muted">{isHrAdmin ? 'Data induk terpusat; NIK digunakan untuk mencocokkan identitas.' : 'Daftar hanya mencakup pegawai yang dapat diakses oleh unitmu.'}</p></div>{isHrAdmin && <span className="count-badge">{employees.length} orang</span>}</div><div className="filters"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isHrAdmin ? 'Cari nama atau NIK…' : 'Cari nama SDM…'}/><select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}><option value="all">Semua unit yang dapat dilihat</option>{operationalUnits.filter((u) => isHrAdmin || accesses.some((a) => a.unit_id === u.id)).map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select>{isHrAdmin && <label className="filter-toggle"><input type="checkbox" checked={showInactiveEmployees} onChange={(e) => setShowInactiveEmployees(e.target.checked)}/> Tampilkan SDM nonaktif</label>}</div><div className="table-wrap"><table><thead><tr><th>Nama SDM</th>{isHrAdmin && <th>NIK</th>}<th>Penugasan / unit</th><th>Status</th>{isHrAdmin && <th>Kontak</th>}{isHrAdmin && <th>Tindakan</th>}</tr></thead><tbody>{filteredEmployees.map((e) => { const bio = biodata[e.id]; const as = assignments.filter((a) => a.employee_id === e.id); return <tr key={e.id}><td><strong>{e.full_name}</strong><small>Mulai {dateFmt(e.start_date)}</small>{isHrAdmin && (activeAssignmentCount[e.id] || 0) > 1 && <span className="pill blue-pill">Multi-penugasan · {activeAssignmentCount[e.id]}</span>}</td>{isHrAdmin && <td className="nik-cell">{bio?.nik || '—'}</td>}<td><div className="assignment-list">{as.length ? as.map((a) => <span className="assignment-chip" key={a.id}>{positionMap[a.position_id || ''] || a.assignment_title || 'Penugasan'} · {unitMap[a.unit_id] || 'Unit'}</span>) : <span className="muted">Belum ada penugasan yang dapat ditampilkan</span>}</div></td><td><span className={`status ${e.employment_status}`}>{e.employment_status === 'active' ? 'Aktif' : e.employment_status === 'on_leave' ? 'Cuti' : 'Nonaktif'}</span></td>{isHrAdmin && <td>{bio?.phone || '—'}<small>{bio?.email || ''}</small></td>}{isHrAdmin && <td className="employee-actions">{e.employment_status !== 'inactive' ? <button type="button" className="btn danger-outline" onClick={() => void removeEmployee(e)} disabled={busy}>Hapus SDM</button> : <span className="status inactive">Diarsipkan</span>}</td>}</tr> })}</tbody></table>{!filteredEmployees.length && <div className="empty-state">Belum ada data SDM yang cocok. Tambahkan SDM melalui menu Tambah SDM.</div>}</div><p className="footnote">Tidak ada kode nomor SDM. Setiap orang memiliki satu ID internal dan dapat memiliki beberapa penugasan setara.</p></section>}
      {view === 'attendance' && <AttendanceModule units={attendanceUnits} employees={employees} assignments={assignments} positions={positions} accesses={accesses} isHrAdmin={isHrAdmin} isPimpinan={isPimpinan} />}
      {view === 'performance' && <PerformanceModule units={operationalUnits} employees={employees} assignments={assignments} positions={positions} accesses={accesses} isHrAdmin={isHrAdmin} isPimpinan={isPimpinan} />}
      {view === 'reports' && <ReportsModule units={reportUnits} employees={employees} assignments={assignments} positions={positions} accesses={accesses} isHrAdmin={isHrAdmin} isPimpinan={isPimpinan} />}
      {view === 'users' && isHrAdmin && <UserManagementModule units={operationalUnits} currentUserId={session.user.id} isHrAdmin={isHrAdmin} isSuperAdmin={roles.includes('super_admin')} />}
      {view === 'requests' && canAccessRequests && <AbsenceRequestsModule units={operationalUnits} employees={employees} assignments={assignments} positions={positions} accesses={accesses} isHrAdmin={isHrAdmin} />}
      {view === 'activities' && canAccessActivities && <ActivityMonitoringModule units={(isHrAdmin || isPimpinan) ? operationalUnits : operationalUnits.filter((u) => accesses.some((a) => a.unit_id === u.id && ['kepala_unit', 'operator_sdm', 'petugas_absensi'].includes(a.access_role)))} employees={employees} assignments={assignments} positions={positions} accesses={accesses} isHrAdmin={isHrAdmin} isPimpinan={isPimpinan} />}
      {view === 'submit' && <section className="content-card"><div className="section-head"><div><p className="eyebrow">INPUT LANGSUNG SDM</p><h2>Pencatatan SDM dan Penugasan</h2><p className="muted">Ikuti tiga langkah sederhana. NIK menjadi identitas utama agar satu orang tidak tercatat dua kali.</p></div></div><div className="entry-steps"><span className="entry-step active"><b>1</b><span>Periksa identitas</span></span><span className={`entry-step ${nikCheckedFor === form.nik && nikExists !== null ? 'active' : ''}`}><b>2</b><span>Rincian penugasan</span></span><span className={`entry-step ${nikExists === false && nikCheckedFor === form.nik ? 'active' : ''}`}><b>3</b><span>Biodata baru bila diperlukan</span></span></div><form className="request-form" onSubmit={saveAssignment}><div className="form-section">Langkah 1 — Unit dan identitas</div><div className="form-grid"><label>Unit kerja *<select value={form.unit_id} onChange={(e) => updateForm('unit_id', e.target.value)} required><option value="">Pilih unit</option>{allowedUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>NIK 16 digit *<div className="nik-check-row"><input inputMode="numeric" autoComplete="off" maxLength={16} value={form.nik} onChange={(e) => updateForm('nik', e.target.value.replace(/\D/g, '').slice(0, 16))} placeholder="Masukkan NIK" required/><button type="button" className="btn secondary check-btn" onClick={checkNik} disabled={busy || form.nik.length !== 16 || !form.unit_id}>Periksa NIK</button></div></label></div>{nikCheckedFor === form.nik && nikExists !== null && <div className={`nik-result ${nikExists ? 'found' : 'new'}`}>{nikExists ? 'NIK sudah tercatat. Biodata pribadi tidak ditampilkan; penugasan akan menggunakan profil yang sama.' : 'NIK belum ditemukan. Isi biodata lengkap untuk membuat profil baru.'}</div>}<div className="form-section">Langkah 2 — Rincian penugasan</div><div className="form-grid"><label>Jabatan / nama tugas *<input value={form.assignment_title} onChange={(e) => updateForm('assignment_title', e.target.value)} placeholder="Contoh: Guru Tahfidz, Musyrif, Pelatih Futsal" required/></label><label>Kategori jabatan<select value={form.position_id} onChange={(e) => updateForm('position_id', e.target.value)}><option value="">Pilih bila tersedia</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><div className="form-grid"><label>Pola kerja<select value={form.work_arrangement} onChange={(e) => updateForm('work_arrangement', e.target.value)}><option value="monthly">Terjadwal bulanan</option><option value="hourly">Per jam</option><option value="session">Per sesi</option><option value="shift">Shift</option><option value="other">Lainnya</option></select></label><label>Tanggal mulai *<input type="date" value={form.start_date} onChange={(e) => updateForm('start_date', e.target.value)} required/></label></div>{nikExists === false && nikCheckedFor === form.nik && <><div className="form-section">Langkah 3 — Biodata SDM baru</div><p className="muted">Biodata akan langsung tersimpan. Akses biodata lengkap tetap dibatasi untuk Sekjen/Super Admin.</p><div className="form-grid"><label>Nama lengkap sesuai identitas *<input value={form.full_name} onChange={(e) => updateForm('full_name', e.target.value)} required/></label><label>Jenis kelamin *<select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} required><option value="">Pilih</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></label></div><div className="form-grid"><label>Tempat lahir *<input value={form.place_of_birth} onChange={(e) => updateForm('place_of_birth', e.target.value)} required/></label><label>Tanggal lahir *<input type="date" max={today} value={form.date_of_birth} onChange={(e) => updateForm('date_of_birth', e.target.value)} required/></label></div><div className="form-grid"><label>Status perkawinan *<select value={form.marital_status} onChange={(e) => updateForm('marital_status', e.target.value)} required><option value="">Pilih</option><option value="belum_menikah">Belum menikah</option><option value="menikah">Menikah</option><option value="cerai_hidup">Cerai hidup</option><option value="cerai_mati">Cerai mati</option></select></label><label>Pendidikan terakhir *<select value={form.education_level} onChange={(e) => updateForm('education_level', e.target.value)} required><option value="">Pilih</option>{['SD/MI','SMP/MTs','SMA/MA','SMK','D1','D2','D3','D4','S1','S2','S3','Pondok Pesantren','Lainnya'].map((v) => <option key={v} value={v}>{v}</option>)}</select></label></div><label>Alamat lengkap *<textarea rows={3} value={form.address} onChange={(e) => updateForm('address', e.target.value)} required/></label><div className="form-grid"><label>Nomor HP aktif *<input type="tel" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} required/></label></div></>}
      {nikExists === false && nikCheckedFor === form.nik && <details className="optional-fields"><summary>Data pribadi tambahan (opsional)</summary><div className="form-grid"><label>Agama<select value={form.religion} onChange={(e) => updateForm('religion', e.target.value)}><option value="">Pilih</option><option>Islam</option><option>Kristen</option><option>Katolik</option><option>Hindu</option><option>Buddha</option><option>Konghucu</option><option>Lainnya</option></select></label><label>Email pribadi<input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)}/></label></div><div className="form-grid"><label>Nama kontak darurat<input value={form.emergency_contact_name} onChange={(e) => updateForm('emergency_contact_name', e.target.value)}/></label><label>Nomor kontak darurat<input type="tel" value={form.emergency_contact_phone} onChange={(e) => updateForm('emergency_contact_phone', e.target.value)}/></label></div></details>}<details className="optional-fields"><summary>Catatan penugasan (opsional)</summary><label>Catatan<textarea rows={2} value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Masukkan catatan tambahan bila diperlukan"/></label></details><div className="form-actions"><button type="button" className="btn secondary" onClick={() => { setForm({ ...emptyForm, unit_id: allowedUnits[0]?.id ?? '' }); setNikExists(null); setNikCheckedFor('') }}>Reset formulir</button><button className="btn primary" disabled={busy || nikCheckedFor !== form.nik || nikExists === null || !form.assignment_title.trim()}>{busy ? 'Menyimpan…' : (nikExists ? 'Simpan penugasan' : 'Simpan SDM dan penugasan')}</button></div></form></section>}
      <footer className="app-footer">RQ SDM · Dari laut menuju langit · Satu identitas, banyak penugasan setara.</footer>
    </section>
  </main>
}

export default App
