import { useState, type ReactNode } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

const box: React.CSSProperties = { maxWidth: 420, margin: '12vh auto', padding: 28, background: 'var(--panel, #fff)', border: '1px solid rgba(0,0,0,.12)', borderRadius: 14, fontFamily: 'inherit' }
const input: React.CSSProperties = { width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8, border: '1px solid rgba(0,0,0,.2)', margin: '6px 0 14px', boxSizing: 'border-box' }
const btn: React.CSSProperties = { width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8, border: 0, background: '#1f3b57', color: '#fff', cursor: 'pointer' }
const link: React.CSSProperties = { display: 'block', background: 'none', border: 0, color: '#1f3b57', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: 14, fontSize: 14, textAlign: 'left' }
const errText = (err: unknown, fallback: string) => err instanceof Error ? (err.message.split('Uncaught Error: ')[1] ?? err.message).split('\n')[0] : fallback

function Frame({ children }: { children: ReactNode }) {
  return <main style={{ minHeight: '100vh', padding: 16 }}><div style={box}>
    <p style={{ margin: 0, fontSize: 13, letterSpacing: '.04em', opacity: .7 }}>UNG-MERCURY</p>
    {children}
  </div></main>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const me = useQuery(api.staff.me, isAuthenticated ? {} : 'skip')
  const { signOut } = useAuthActions()
  if (isLoading || (isAuthenticated && me === undefined)) return <Frame><p>Checking access…</p></Frame>
  if (!isAuthenticated) return <SignIn />
  if (!me?.staff) return <Frame>
    <h1 style={{ fontSize: 24 }}>No access yet</h1>
    <p>{me?.email ?? 'This account'} is not on the MERCURY staff list. Ask a MERCURY administrator to add this email, then sign in again.</p>
    <button style={btn} onClick={() => void signOut()}>Sign out</button>
  </Frame>
  if (!me.hasPassword) return <Frame>
    <h1 style={{ fontSize: 24, margin: '6px 0 4px' }}>Create your password</h1>
    <p style={{ opacity: .75 }}>You signed in with a one-time code. Set a permanent password now. From next time you'll sign in with your email and this password.</p>
    <PasswordForm />
    <button type="button" style={link} onClick={() => void signOut()}>Sign out</button>
  </Frame>
  return <>{children}</>
}

export function PasswordForm() {
  const setPassword = useAction(api.password.setPassword)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setDone('')
    if (pw !== again) { setError("The two passwords don't match."); return }
    setBusy(true)
    try { await setPassword({ password: pw }); setPw(''); setAgain(''); setDone('Password saved.') }
    catch (err) { setError(errText(err, 'Could not save the password.')) }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <label htmlFor="pw1">New password</label>
    <input id="pw1" style={input} type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw} onChange={e => setPw(e.target.value)} />
    <label htmlFor="pw2">Type it again</label>
    <input id="pw2" style={input} type={show ? 'text' : 'password'} autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} />
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', fontSize: 14 }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />Show password</label>
    <p style={{ fontSize: 13, opacity: .7, marginTop: 0 }}>At least 10 characters, with a letter and a number.</p>
    <button style={btn} disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    {error && <p role="alert" style={{ color: '#b3261e', marginTop: 12 }}>{error}</p>}
    {done && <p style={{ color: '#1e7a46', marginTop: 12 }}>{done}</p>}
  </form>
}

function SignIn() {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<'password' | 'email' | 'code'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const clean = () => email.trim().toLowerCase()

  async function withPassword(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await signIn('password', { email: clean(), password, flow: 'signIn' }) }
    catch { setError("Email or password is wrong. If you haven't set a password yet, use an emailed code below.") }
    finally { setBusy(false) }
  }
  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await signIn('resend-otp', { email: clean() }); setMode('code') }
    catch { setError('Could not send the code. Check the email address and try again.') }
    finally { setBusy(false) }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await signIn('resend-otp', { email: clean(), code: code.trim() }) }
    catch { setError('That code is wrong or has expired. Request a new one.') }
    finally { setBusy(false) }
  }

  return <Frame>
    <h1 style={{ fontSize: 24, margin: '6px 0 4px' }}>Staff sign in</h1>
    {mode === 'password' && <form onSubmit={withPassword}>
      <label htmlFor="mercury-email">Email</label>
      <input id="mercury-email" style={input} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
      <label htmlFor="mercury-pw">Password</label>
      <input id="mercury-pw" style={input} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      <button style={btn} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" style={link} onClick={() => { setMode('email'); setError('') }}>First time here, or forgot your password? Email me a code</button>
    </form>}
    {mode === 'email' && <form onSubmit={sendCode}>
      <p style={{ opacity: .75 }}>We'll email you a 6-digit code. Once you're in, you can set a new password.</p>
      <label htmlFor="mercury-email2">Email</label>
      <input id="mercury-email2" style={input} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      <button style={btn} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      <button type="button" style={link} onClick={() => { setMode('password'); setError('') }}>Back to password sign-in</button>
    </form>}
    {mode === 'code' && <form onSubmit={verify}>
      <p style={{ opacity: .75 }}>We sent a code to {email}. It expires in 15 minutes.</p>
      <label htmlFor="mercury-code">6-digit code</label>
      <input id="mercury-code" style={input} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} />
      <button style={btn} disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
      <button type="button" style={link} onClick={() => { setMode('email'); setCode('') }}>Send a new code</button>
    </form>}
    {error && <p role="alert" style={{ color: '#b3261e', marginTop: 12 }}>{error}</p>}
  </Frame>
}

export function StaffPanel() {
  const staff = useQuery(api.staff.list)
  const add = useMutation(api.staff.add)
  const setActive = useMutation(api.staff.setActive)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'staff' | 'admin'>('staff')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg('')
    try { await add({ email, role }); setMsg(`${email} can now sign in as ${role}. They get in the first time with an emailed code, then set their own password.`); setEmail('') }
    catch (err) { setMsg(errText(err, 'Could not add this person')) }
  }

  return <div>
    <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 14px' }}>
      <input className="field" style={{ flex: '2 1 220px' }} type="email" placeholder="Staff email" required value={email} onChange={e => setEmail(e.target.value)} />
      <select className="field" style={{ flex: '1 1 120px' }} value={role} onChange={e => setRole(e.target.value as 'staff' | 'admin')}>
        <option value="staff">Staff (scan and dispatch)</option>
        <option value="admin">Administrator</option>
      </select>
      <button className="primary compact">Add person</button>
    </form>
    {msg && <p className="empty">{msg}</p>}
    <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>
      {staff?.map((s: any) => <tr key={s._id}><td>{s.email}</td><td>{s.role}</td><td>{s.active ? 'Active' : 'Removed'}</td>
        <td><button className="ghost" onClick={() => setActive({ id: s._id as Id<'staff'>, active: !s.active }).catch((e: any) => setMsg(errText(e, 'Could not change access')))}>{s.active ? 'Remove access' : 'Restore'}</button></td></tr>)}
    </tbody></table></div>
  </div>
}
