import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'
import './UserManagementModule.css'

type UnitOption = { id: string; name: string; code?: string; is_active?: boolean }
type UserProfile = {
  id: string
  display_name: string
  email: string | null
  is_active: boolean
  employee_id: string | null
  last_sign_in_at: string | null
  created_at: string
}
type UserRoleRow = { user_id: string; role: string }
type UnitAccessRow = { user_id: string; unit_id: string; access_role: 'kepala_unit' | 'petugas_absensi' | 'operator_sdm' }

type Props = {
  units: UnitOption[]
  currentUserId: string
  isHrAdmin: boolean
  isSuperAdmin: boolean
}

const GLOBAL_ROLES = ['super_admin', 'sekjen', 'pimpinan'] as const
type GlobalRole = typeof GLOBAL_ROLES[number]
const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  super_admin: 'Super Admin',
  sekjen: 'Sekjen / Admin SDM',
  pimpinan: 'Pimpinan',
}
const dateTime = (value: string | null) => {
  if (!value) return 'Belum pernah login'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function UserManagementModule({ units, currentUserId, isHrAdmin, isSuperAdmin }: Props) {
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [roleRows, setRoleRows] = useState<UserRoleRow[]>([])
  const [accessRows, setAccessRows] = useState<UnitAccessRow[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [roleDraft, setRoleDraft] = useState<GlobalRole[]>([])
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createGlobalRoles, setCreateGlobalRoles] = useState<GlobalRole[]>([])
  const [createUnitAccesses, setCreateUnitAccesses] = useState<Array<{ unit_id: string; access_role: UnitAccessRow['access_role'] }>>([{ unit_id: '', access_role: 'operator_sdm' }])
  const [createdCredentials, setCreatedCredentials] = useState<{ display_name: string; email: string; temporary_password: string } | null>(null)

  const selectedUser = profiles.find((profile) => profile.id === selectedUserId) ?? null
  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return profiles
    return profiles.filter((profile) =>
      profile.display_name.toLowerCase().includes(term) ||
      (profile.email ?? '').toLowerCase().includes(term) ||
      profile.id.toLowerCase().includes(term)
    )
  }, [profiles, search])

  const load = useCallback(async () => {
    const client = supabase
    if (!client || !isHrAdmin) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const [profileResult, roleResult, accessResult] = await Promise.all([
      client.from('user_profiles')
        .select('id, display_name, email, is_active, employee_id, last_sign_in_at, created_at')
        .order('display_name', { ascending: true }),
      client.from('user_roles').select('user_id, role'),
      client.from('user_unit_access').select('user_id, unit_id, access_role'),
    ])
    const failures = [profileResult.error, roleResult.error, accessResult.error].filter(Boolean)
    if (failures.length) {
      setError(`Data pengguna tidak lengkap: ${failures.map((failure) => failure?.message).join(' · ')}. Pastikan migrasi Tahap 11 sudah dijalankan.`)
    }
    if (!profileResult.error) {
      const nextProfiles = (profileResult.data ?? []) as UserProfile[]
      setProfiles(nextProfiles)
      setSelectedUserId((previous) => nextProfiles.some((item) => item.id === previous) ? previous : (nextProfiles[0]?.id ?? ''))
    }
    if (!roleResult.error) setRoleRows((roleResult.data ?? []) as UserRoleRow[])
    if (!accessResult.error) setAccessRows((accessResult.data ?? []) as UnitAccessRow[])
    setLoading(false)
  }, [isHrAdmin])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (selectedUser) {
      setDisplayNameDraft(selectedUser.display_name)
      const roles = roleRows
        .filter((row) => row.user_id === selectedUser.id && (GLOBAL_ROLES as readonly string[]).includes(row.role))
        .map((row) => row.role as GlobalRole)
      setRoleDraft(roles)
    } else {
      setDisplayNameDraft('')
      setRoleDraft([])
    }
  }, [selectedUserId, profiles, roleRows]) // selectedUser is derived from these values.

  if (!isHrAdmin) {
    return <section className="rq-um-card"><h2>Akses tidak diizinkan</h2><p>Manajemen Pengguna hanya tersedia bagi Sekjen atau Super Admin.</p></section>
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    if (!client) return

    const normalizedEmail = createEmail.trim().toLowerCase()
    const unitAccesses = createUnitAccesses.filter((row) => row.unit_id)
    if (!createName.trim()) {
      setError('Nama lengkap wajib diisi.')
      return
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Masukkan email yang valid. Email hanya digunakan sebagai ID login; sistem tidak mengirim email.')
      return
    }
    if (!createGlobalRoles.length && !unitAccesses.length) {
      setError('Pilih minimal satu peran atau satu akses unit.')
      return
    }
    if (createGlobalRoles.includes('super_admin') && !isSuperAdmin) {
      setError('Hanya Super Admin yang dapat memberikan peran Super Admin.')
      return
    }
    const assignmentKeys = unitAccesses.map((row) => `${row.unit_id}:${row.access_role}`)
    if (new Set(assignmentKeys).size !== assignmentKeys.length) {
      setError('Ada akses unit dan peran yang sama lebih dari sekali. Hapus duplikat sebelum melanjutkan.')
      return
    }

    setBusy(true); setError(''); setNotice('')
    try {
      const { data, error: createError } = await client.functions.invoke('admin-create-user', {
        body: {
          email: normalizedEmail,
          display_name: createName.trim(),
          global_roles: createGlobalRoles,
          unit_accesses: unitAccesses,
        },
      })
      if (createError) throw createError
      if (data?.error || data?.ok === false) throw new Error(data.error || 'Pembuatan akun gagal.')
      if (!data?.temporary_password || !data?.user_id) {
        throw new Error('Akun mungkin sudah dibuat, tetapi kata sandi awal tidak diterima. Segarkan daftar pengguna sebelum mencoba lagi.')
      }

      setCreatedCredentials({
        display_name: createName.trim(),
        email: normalizedEmail,
        temporary_password: data.temporary_password,
      })
      setCreateName('')
      setCreateEmail('')
      setCreateGlobalRoles([])
      setCreateUnitAccesses([{ unit_id: '', access_role: 'operator_sdm' }])
      setCreateOpen(false)
      setNotice(data?.message || 'Akun berhasil dibuat. Tidak ada email undangan yang dikirim. Simpan kata sandi awal dari jendela yang muncul.')
      await load()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(`Akun gagal dibuat: ${message}. Pastikan Edge Function admin-create-user sudah di-deploy.`)
    } finally {
      setBusy(false)
    }
  }

  async function copyCreatedCredentials() {
    if (!createdCredentials) return
    const credentials = `RQ SDM\nNama: ${createdCredentials.display_name}\nID login: ${createdCredentials.email}\nKata sandi awal: ${createdCredentials.temporary_password}`
    try {
      await navigator.clipboard.writeText(credentials)
      setNotice('Kredensial berhasil disalin. Bagikan secara pribadi kepada pemilik akun.')
    } catch {
      setError('Browser tidak mengizinkan penyalinan otomatis. Salin ID login dan kata sandi yang tampil secara manual.')
    }
  }

  async function saveDisplayName() {
    const client = supabase
    if (!client || !selectedUser) return
    if (!displayNameDraft.trim()) { setError('Nama tampilan tidak boleh kosong.'); return }
    setBusy(true); setError(''); setNotice('')
    const { error: updateError } = await client.from('user_profiles')
      .update({ display_name: displayNameDraft.trim() })
      .eq('id', selectedUser.id)
    if (updateError) setError(`Nama pengguna gagal diperbarui: ${updateError.message}`)
    else { setNotice('Nama tampilan berhasil diperbarui.'); await load() }
    setBusy(false)
  }

  async function toggleActive() {
    const client = supabase
    if (!client || !selectedUser) return
    if (selectedUser.id === currentUserId) {
      setError('Akun yang sedang digunakan tidak dapat dinonaktifkan dari sesi ini.')
      return
    }
    const nextState = !selectedUser.is_active
    const confirmation = nextState
      ? `Aktifkan kembali akun ${selectedUser.display_name}?`
      : `Nonaktifkan akses aplikasi untuk ${selectedUser.display_name}?`
    if (!window.confirm(confirmation)) return
    setBusy(true); setError(''); setNotice('')
    const { error: updateError } = await client.from('user_profiles')
      .update({ is_active: nextState })
      .eq('id', selectedUser.id)
    if (updateError) setError(`Status akun gagal diubah: ${updateError.message}`)
    else { setNotice(nextState ? 'Akun diaktifkan kembali.' : 'Akun dinonaktifkan. Akses data melalui RLS ikut dibatasi.'); await load() }
    setBusy(false)
  }

  async function saveGlobalRoles() {
    const client = supabase
    if (!client || !selectedUser) return
    if (selectedUser.id === currentUserId) {
      setError('Untuk mencegah terkunci dari sistem, peran akun yang sedang digunakan tidak dapat diubah dari sesi ini.')
      return
    }
    const currentlyHasSuperAdmin = roleRows.some((row) => row.user_id === selectedUser.id && row.role === 'super_admin')
    if (!isSuperAdmin && (roleDraft.includes('super_admin') && !currentlyHasSuperAdmin)) {
      setError('Hanya Super Admin yang dapat memberikan peran Super Admin.')
      return
    }
    setBusy(true); setError(''); setNotice('')
    const current = roleRows
      .filter((row) => row.user_id === selectedUser.id && (GLOBAL_ROLES as readonly string[]).includes(row.role))
      .map((row) => row.role as GlobalRole)
    const toRemove = current.filter((role) => !roleDraft.includes(role))
    const toAdd = roleDraft.filter((role) => !current.includes(role))
    try {
      for (const role of toRemove) {
        const { error: removeError } = await client.from('user_roles').delete().eq('user_id', selectedUser.id).eq('role', role)
        if (removeError) throw removeError
      }
      if (toAdd.length) {
        const { error: addError } = await client.from('user_roles')
          .insert(toAdd.map((role) => ({ user_id: selectedUser.id, role })))
        if (addError) throw addError
      }
      setNotice('Peran global berhasil diperbarui.')
      await load()
    } catch (cause) {
      setError(`Peran gagal diperbarui: ${cause instanceof Error ? cause.message : String(cause)}`)
      await load()
    } finally { setBusy(false) }
  }

  const selectedRoleRows = selectedUser ? roleRows.filter((row) => row.user_id === selectedUser.id) : []
  const activeCount = profiles.filter((profile) => profile.is_active).length
  const inactiveCount = profiles.length - activeCount
  const usersWithUnitAccess = new Set(accessRows.map((row) => row.user_id)).size

  return (
    <div className="rq-um">
      <section className="rq-um-hero">
        <div>
          <p className="rq-um-eyebrow">ADMINISTRASI AKUN & KEAMANAN</p>
          <h2>Manajemen Pengguna</h2>
          <p>Atur akun dan peran global. Penugasan unit ditetapkan saat akun dibuat dan dilindungi oleh Supabase RLS.</p>
        </div>
        <button type="button" className="rq-um-btn rq-um-btn-light" onClick={() => void load()} disabled={loading || busy}>↻ Segarkan</button>
      </section>

      {error && <div className="rq-um-alert rq-um-alert-error">{error}</div>}
      {notice && <div className="rq-um-alert rq-um-alert-success">{notice}</div>}

      <section className="rq-um-stats">
        <article><span>Total akun</span><strong>{loading ? '…' : profiles.length}</strong></article>
        <article><span>Akun aktif</span><strong>{loading ? '…' : activeCount}</strong></article>
        <article><span>Akun nonaktif</span><strong>{loading ? '…' : inactiveCount}</strong></article>
        <article><span>Pengguna dengan penugasan unit</span><strong>{loading ? '…' : usersWithUnitAccess}</strong></article>
      </section>

      <section className="rq-um-card rq-um-invite-card">
        <div className="rq-um-invite-copy"><span className="rq-um-invite-icon">＋</span><div><p className="rq-um-eyebrow">AKUN & PENUGASAN</p><h3>Tambah akun sekaligus atur tugas</h3><p>Buat akun tanpa mengirim email. Pilih peran tingkat dayah dan tetapkan satu atau beberapa penugasan unit dalam satu formulir.</p></div></div>
        <button type="button" className="rq-um-btn rq-um-btn-primary rq-um-open-invite" onClick={() => { setCreateOpen(true); setError(''); setNotice('') }}>＋ Tambah akun</button>
      </section>
      {createOpen && <div className="rq-um-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false) }}>
        <section className="rq-um-invite-modal rq-um-create-modal" role="dialog" aria-modal="true" aria-labelledby="rq-um-create-title">
          <div className="rq-um-modal-heading"><span className="rq-um-invite-icon">♙</span><button type="button" className="rq-um-modal-close" aria-label="Tutup formulir" onClick={() => setCreateOpen(false)} disabled={busy}>×</button><p className="rq-um-eyebrow">PENDAFTARAN AKUN INTERNAL</p><h3 id="rq-um-create-title">Buat akun dan tetapkan tugas</h3><p>Isi identitas, lalu pilih peran dan unit yang boleh diakses. Sistem membuat kata sandi awal dan menampilkannya setelah akun berhasil dibuat.</p></div>
          <form className="rq-um-modal-form rq-um-create-form" onSubmit={createUser}>
            {error && <div className="rq-um-alert rq-um-alert-error">{error}</div>}
            <div className="rq-um-create-fields">
              <label>Nama lengkap<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} required maxLength={120} placeholder="Contoh: Ahmad Fauzi"/></label>
              <label>Email untuk login<input type="email" autoComplete="off" value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} required maxLength={254} placeholder="nama@contoh.com"/><small>Email hanya menjadi ID login. Tidak ada undangan atau notifikasi email yang dikirim.</small></label>
            </div>

            <div className="rq-um-create-section">
              <div className="rq-um-create-section-title"><div><h4>Peran tingkat dayah</h4><p>Pilih bila akun memerlukan akses lintas unit.</p></div></div>
              <div className="rq-um-create-global-grid">
                {(['sekjen', 'pimpinan', ...(isSuperAdmin ? ['super_admin'] : [])] as GlobalRole[]).map((role) => (
                  <label className="rq-um-create-check" key={role}>
                    <input type="checkbox" checked={createGlobalRoles.includes(role)} onChange={(event) => setCreateGlobalRoles((previous) => event.target.checked ? [...previous, role] : previous.filter((item) => item !== role))}/>
                    <span><strong>{GLOBAL_ROLE_LABELS[role]}</strong><small>{role === 'sekjen' ? 'Administrasi SDM dan pengelolaan lintas unit.' : role === 'pimpinan' ? 'Melihat ringkasan dan laporan dayah.' : 'Akses penuh administrasi sistem.'}</small></span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rq-um-create-section">
              <div className="rq-um-create-section-title"><div><h4>Penugasan unit</h4><p>Satu akun dapat memiliki beberapa tugas, misalnya Kepala Unit sekaligus Petugas Absensi.</p></div><button type="button" className="rq-um-btn rq-um-btn-secondary" onClick={() => setCreateUnitAccesses((previous) => previous.length >= 12 ? previous : [...previous, { unit_id: '', access_role: 'operator_sdm' }])} disabled={busy || createUnitAccesses.length >= 12}>＋ Tambah tugas</button></div>
              <div className="rq-um-create-assignment-list">
                {createUnitAccesses.map((assignment, index) => (
                  <div className="rq-um-create-assignment" key={`create-access-${index}`}>
                    <label>Unit<select value={assignment.unit_id} onChange={(event) => setCreateUnitAccesses((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, unit_id: event.target.value } : row))}><option value="">Pilih unit</option>{units.filter((unit) => unit.is_active !== false).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                    <label>Tugas / peran unit<select value={assignment.access_role} onChange={(event) => setCreateUnitAccesses((previous) => previous.map((row, rowIndex) => rowIndex === index ? { ...row, access_role: event.target.value as UnitAccessRow['access_role'] } : row))}><option value="kepala_unit">Kepala Unit</option><option value="operator_sdm">Operator SDM</option><option value="petugas_absensi">Petugas Absensi</option></select></label>
                    <button type="button" className="rq-um-btn rq-um-btn-danger rq-um-remove-assignment" onClick={() => setCreateUnitAccesses((previous) => previous.length === 1 ? [{ unit_id: '', access_role: 'operator_sdm' }] : previous.filter((_, rowIndex) => rowIndex !== index))} disabled={busy} aria-label={`Hapus tugas ${index + 1}`}>Hapus</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rq-um-modal-note"><span>ⓘ</span><p>Setelah akun dibuat, kata sandi awal hanya ditampilkan pada layar ini satu kali. Catat dan bagikan secara pribadi kepada pemilik akun. Jangan membagikannya di grup.</p></div>
            <div className="rq-um-modal-actions"><button type="button" className="rq-um-btn rq-um-btn-secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Batal</button><button className="rq-um-btn rq-um-btn-primary" disabled={busy}>{busy ? 'Membuat akun…' : 'Buat akun dan simpan akses'}</button></div>
          </form>
        </section>
      </div>}

      {createdCredentials && <div className="rq-um-modal-backdrop" role="presentation">
        <section className="rq-um-invite-modal rq-um-credentials-modal" role="dialog" aria-modal="true" aria-labelledby="rq-um-credentials-title">
          <div className="rq-um-credential-success"><span>✓</span></div>
          <div className="rq-um-modal-heading"><p className="rq-um-eyebrow">AKUN BERHASIL DIBUAT</p><h3 id="rq-um-credentials-title">Simpan kredensial awal</h3><p>Akun sudah dibuat dan akses unit telah disimpan. Sistem tidak mengirim email.</p></div>
          <div className="rq-um-credential-fields"><label>Nama pengguna<input value={createdCredentials.display_name} readOnly/></label><label>ID login / email<input value={createdCredentials.email} readOnly/></label><label>Kata sandi awal<input value={createdCredentials.temporary_password} readOnly/></label></div>
          <div className="rq-um-modal-note"><span>!</span><p>Kata sandi tidak dapat dilihat kembali setelah jendela ini ditutup. Bagikan secara pribadi dan minta pemilik akun menggantinya setelah masuk jika fitur ubah kata sandi tersedia.</p></div>
          <div className="rq-um-modal-actions"><button type="button" className="rq-um-btn rq-um-btn-secondary" onClick={() => setCreatedCredentials(null)}>Tutup</button><button type="button" className="rq-um-btn rq-um-btn-primary" onClick={() => void copyCreatedCredentials()}>Salin kredensial</button></div>
        </section>
      </div>}

      <div className="rq-um-layout">
        <section className="rq-um-card rq-um-user-list">
          <div className="rq-um-section-head"><div><p className="rq-um-eyebrow">DIREKTORI AKUN</p><h3>Daftar pengguna</h3></div><span className="rq-um-count">{filteredProfiles.length}</span></div>
          <input className="rq-um-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, email, atau ID akun…"/>
          {loading ? <p className="rq-um-empty">Memuat pengguna…</p> : (
            <div className="rq-um-user-items">
              {filteredProfiles.map((profile) => {
                const roles = roleRows.filter((row) => row.user_id === profile.id)
                const accesses = accessRows.filter((row) => row.user_id === profile.id)
                return (
                  <button type="button" key={profile.id} className={`rq-um-user-item ${selectedUserId === profile.id ? 'selected' : ''}`} onClick={() => setSelectedUserId(profile.id)}>
                    <span className="rq-um-avatar">{(profile.display_name || profile.email || '?').slice(0, 1).toUpperCase()}</span>
                    <span className="rq-um-user-main">
                      <strong>{profile.display_name}</strong>
                      <small>{profile.email || profile.id}</small>
                      <span className="rq-um-tag-line">
                        <i className={profile.is_active ? 'rq-um-dot active' : 'rq-um-dot inactive'}/>
                        {profile.is_active ? 'Aktif' : 'Nonaktif'} · {roles.length} peran · {accesses.length} penugasan
                      </span>
                    </span>
                  </button>
                )
              })}
              {!filteredProfiles.length && <p className="rq-um-empty">Tidak ada pengguna yang cocok.</p>}
            </div>
          )}
        </section>

        <section className="rq-um-card rq-um-user-detail">
          {!selectedUser ? <div className="rq-um-empty">Pilih pengguna untuk melihat rincian akun.</div> : <>
            <div className="rq-um-section-head">
              <div><p className="rq-um-eyebrow">DETAIL PENGGUNA</p><h3>{selectedUser.display_name}</h3><p>{selectedUser.email || 'Email belum tersedia'}</p></div>
              <span className={`rq-um-status ${selectedUser.is_active ? 'active' : 'inactive'}`}>{selectedUser.is_active ? 'Aktif' : 'Nonaktif'}</span>
            </div>
            <div className="rq-um-user-meta"><span>ID akun</span><code>{selectedUser.id}</code><span>Login terakhir</span><strong>{dateTime(selectedUser.last_sign_in_at)}</strong></div>
            <div className="rq-um-inline-form">
              <label>Nama tampilan<input value={displayNameDraft} onChange={(event) => setDisplayNameDraft(event.target.value)} maxLength={120}/></label>
              <button type="button" className="rq-um-btn rq-um-btn-secondary" onClick={() => void saveDisplayName()} disabled={busy || !displayNameDraft.trim()}>Simpan nama</button>
            </div>

            <div className="rq-um-divider"/>
            <div className="rq-um-section-head"><div><h4>Peran global</h4><p>Peran ini berlaku di seluruh aplikasi.</p></div></div>
            <div className="rq-um-role-options">
              {GLOBAL_ROLES.map((role) => (
                <label key={role} className="rq-um-role-option">
                  <input type="checkbox" checked={roleDraft.includes(role)} disabled={selectedUser.id === currentUserId || busy || (role === 'super_admin' && !isSuperAdmin)} onChange={(event) => setRoleDraft((previous) => event.target.checked ? [...previous, role] : previous.filter((item) => item !== role))}/>
                  <span><strong>{GLOBAL_ROLE_LABELS[role]}</strong><small>{role === 'super_admin' ? 'Administrasi sistem dan akses penuh.' : role === 'sekjen' ? 'Pusat data SDM dan administrasi lintas unit.' : 'Akses ringkasan dan laporan sesuai kebijakan.'}</small></span>
                </label>
              ))}
            </div>
            {selectedUser.id === currentUserId && <p className="rq-um-note">Peran akun yang sedang digunakan dikunci di halaman ini untuk mencegah terkunci dari sistem.</p>}
            <div className="rq-um-form-actions"><button type="button" className="rq-um-btn rq-um-btn-primary" onClick={() => void saveGlobalRoles()} disabled={busy || selectedUser.id === currentUserId}>Simpan peran global</button></div>

            <div className="rq-um-divider"/>
            <div className="rq-um-active-row">
              <div><h4>Status akun</h4><p>{selectedUser.is_active ? 'Akun dapat menggunakan aplikasi sesuai hak aksesnya.' : 'Akses data aplikasi diblokir melalui kebijakan database.'}</p></div>
              <button type="button" className={`rq-um-btn ${selectedUser.is_active ? 'rq-um-btn-danger' : 'rq-um-btn-primary'}`} onClick={() => void toggleActive()} disabled={busy || selectedUser.id === currentUserId}>{selectedUser.is_active ? 'Nonaktifkan akun' : 'Aktifkan akun'}</button>
            </div>
            {selectedUser.id === currentUserId && <p className="rq-um-note">Akun yang sedang login tidak dapat dinonaktifkan atau kehilangan akses unit dari sesi ini.</p>}
            <div className="rq-um-existing-roles">
              <strong>Semua peran tersimpan</strong>
              <div>{selectedRoleRows.length ? selectedRoleRows.map((row) => <span className="rq-um-role-pill" key={row.role}>{GLOBAL_ROLE_LABELS[row.role as GlobalRole] || row.role}</span>) : <span className="rq-um-muted">Belum ada peran global.</span>}</div>
            </div>
          </>}
        </section>
      </div>
    </div>
  )
}
