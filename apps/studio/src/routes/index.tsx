import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { authClient } from '#/lib/auth-client'
import { loadSession } from '#/server/auth.functions'
import { ThemeControl } from '#/components/theme-control'
import { DEFAULT_LIST_CONFIG } from '#/domain/videos'

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  beforeLoad: async () => {
    if (await loadSession()) throw redirect({ to: '/videos', search: DEFAULT_LIST_CONFIG })
  },
  component: Login,
})

function Login() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>(token ? 'reset' : 'sign-in')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  function changeMode(nextMode: Mode) {
    setMode(nextMode)
    setMessage('')
    setShowPassword(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const values = new FormData(event.currentTarget)
    const email = String(values.get('email') ?? '')
    const password = String(values.get('password') ?? '')
    const name = String(values.get('name') ?? '')

    if (mode === 'forgot') {
      await authClient.requestPasswordReset({ email, redirectTo: '/' })
      setMessage('If the account exists, a reset link is on its way.')
      setBusy(false)
      return
    }

    if (mode === 'reset' && token) {
      const result = await authClient.resetPassword({ newPassword: password, token })
      setMessage(result.error ? result.error.message ?? 'Unable to reset password.' : 'Password updated. Sign in with your new password.')
      if (!result.error) setMode('sign-in')
      setBusy(false)
      return
    }

    const result = mode === 'sign-up'
      ? await authClient.signUp.email({ email, password, name, callbackURL: '/' })
      : await authClient.signIn.email({ email, password, callbackURL: '/videos' })

    if (result.error) {
      setMessage(result.error.message ?? 'Unable to continue.')
    } else if (mode === 'sign-up') {
      setMessage('Check your email to verify your account.')
    } else {
      await navigate({ to: '/videos', search: DEFAULT_LIST_CONFIG })
    }
    setBusy(false)
  }

  const heading = mode === 'sign-up' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Welcome back'

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-block">
          <div className="brand-header">
            <a className="wordmark" href="/"><span>YATB</span> Studio</a>
            <ThemeControl />
          </div>
          <div className="brand-copy">
            <p className="eyebrow light">Private production workspace</p>
            <h1>Ideas become<br />finished videos.</h1>
            <p>Plan shoots, share drafts, and close every edit note in one place.</p>
          </div>
          <p className="private-note"><CheckCircle2 size={16} /> Invitation-only access</p>
        </div>
        <div className="auth-block">
          <form className="auth-card" key={mode} onSubmit={submit}>
            <div>
              <p className="eyebrow">Your Average Tech Bro</p>
              <h2>{heading}</h2>
              <p className="form-intro">Use your approved email address to continue.</p>
            </div>
            {mode === 'sign-up' && <label>Name<input name="name" autoComplete="name" required /></label>}
            {mode !== 'reset' && <label>Email<input name="email" type="email" autoComplete="email" required /></label>}
            {mode !== 'forgot' && (
              <label>Password
                <span className="password-field">
                  <input name="password" type={showPassword ? 'text' : 'password'} minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </span>
              </label>
            )}
            {message && <p className="form-message" role="status">{message}</p>}
            <button className="submit-button" disabled={busy} type="submit">
              {busy ? 'Working…' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}
              {!busy && <ArrowRight size={17} />}
            </button>
            <div className="form-links">
              {mode === 'sign-in' && <button type="button" onClick={() => changeMode('forgot')}>Forgot password?</button>}
              <button type="button" onClick={() => changeMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}>
                {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Request access'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}
