import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './lib/supabase'

type Props = { email: string; onDone: () => Promise<void> | void; onLogout: () => void }

// Akun baru dibuat dengan kata sandi sementara (metadata must_change_password = true).
// Halaman ini memaksa pengguna menggantinya sebelum masuk ke aplikasi.
export default function ForcePasswordChange({ email, onDone, onLogout }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 10) { setError('Kata sandi minimal 10 karakter.'); return }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError('Kata sandi harus memuat huruf dan angka.'); return }
    if (password !== confirm) { setError('Konfirmasi kata sandi tidak sama.'); return }
    setBusy(true); setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })
    if (updateError) { setError(updateError.message); setBusy(false); return }
    await onDone()
    setBusy(false)
  }

  return <main className="login-page">
    <section className="login-hero">
      <div className="logo-lockup"><img src="/rq-logo.png" alt="Logo Dayah Ruhul Qurani"/><div><strong>RQ SDM</strong><span>DAYAH RUHUL QURANI</span></div></div>
      <p className="eyebrow light">KEAMANAN AKUN</p>
      <h1>Satu langkah<br/><span>sebelum mulai.</span></h1>
      <p className="hero-copy">Kata sandi sementara dari administrator hanya untuk masuk pertama kali. Buat kata sandi pribadi yang tidak dibagikan kepada siapa pun.</p>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">GANTI KATA SANDI</p>
        <h2>Buat kata sandi baru</h2>
        <p className="muted">Akun: {email}</p>
        <label htmlFor="new-password">Kata sandi baru</label>
        <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10}/>
        <label htmlFor="confirm-password">Ulangi kata sandi baru</label>
        <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10}/>
        <small>Minimal 10 karakter, memuat huruf dan angka.</small>
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan dan lanjutkan'}</button>
        <button type="button" className="btn secondary" onClick={onLogout} disabled={busy}>Keluar</button>
      </form>
    </section>
  </main>
}
