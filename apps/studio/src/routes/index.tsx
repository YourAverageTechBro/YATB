import {
  createFileRoute,
  redirect,
  useNavigate,
  type SearchSchemaInput,
} from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@yatb/ui/alert'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { authClient } from '#/lib/auth-client'
import { loadSession } from '#/server/auth.functions'
import { ThemeControl } from '#/components/theme-control'
import { parseAuthSearch } from '#/domain/auth'
import { DEFAULT_LIST_CONFIG } from '#/domain/videos'

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) =>
    parseAuthSearch(search),
  beforeLoad: async () => {
    if (await loadSession()) throw redirect({ to: '/videos', search: DEFAULT_LIST_CONFIG })
  },
  component: Login,
})

function Login() {
  const { token, showEmailVerifiedConfirmation } = Route.useSearch()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>(token ? 'reset' : 'sign-in')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(
    showEmailVerifiedConfirmation ? 'Email verified, please sign in.' : '',
  )
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
      ? await authClient.signUp.email({ email, password, name, callbackURL: '/?verified=1' })
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
          <Card className="auth-card">
            <form key={mode} onSubmit={submit}>
              <div>
                <p className="eyebrow">Your Average Tech Bro</p>
                <h2>{heading}</h2>
                <p className="form-intro">Use your approved email address to continue.</p>
              </div>
              {mode === 'sign-up' && <Label>Name<Input name="name" autoComplete="name" required /></Label>}
              {mode !== 'reset' && <Label>Email<Input name="email" type="email" autoComplete="email" required /></Label>}
              {mode !== 'forgot' && (
                <Label>Password
                  <span className="password-field">
                    <Input name="password" type={showPassword ? 'text' : 'password'} minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required />
                    <Button variant="ghost" size="icon-sm" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</Button>
                  </span>
                </Label>
              )}
              {message && <Alert className="form-message" role="status"><AlertDescription>{message}</AlertDescription></Alert>}
              <Button className="submit-button" disabled={busy} type="submit">
                {busy ? 'Working…' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}
                {!busy && <ArrowRight size={17} />}
              </Button>
              <div className="form-links">
                {mode === 'sign-in' && <Button variant="link" type="button" onClick={() => changeMode('forgot')}>Forgot password?</Button>}
                <Button variant="link" type="button" onClick={() => changeMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}>
                  {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Request access'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </section>
    </main>
  )
}
