const url = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD

if (!email || !password) {
  throw new Error('STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD are required')
}

function p95(values) {
  return values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
}

const login = []
const signInToShell = []

for (let run = 0; run < 20; run += 1) {
  let started = performance.now()
  const loginResponse = await fetch(`${url}/`)
  await loginResponse.arrayBuffer()
  login.push(performance.now() - started)

  let signIn
  for (;;) {
    started = performance.now()
    signIn = await fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ email, password }),
    })
    if (signIn.status !== 429) break
    const retryAfter = Number(signIn.headers.get('retry-after') ?? 10)
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
  }
  if (!signIn.ok) throw new Error(`Sign in ${run + 1} returned ${signIn.status}`)
  const cookie = signIn.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error(`Sign in ${run + 1} returned no session cookie`)
  const shell = await fetch(`${url}/videos`, { headers: { Cookie: cookie } })
  if (!shell.ok || !(await shell.text()).includes('No videos yet')) {
    throw new Error(`Private shell ${run + 1} did not render`)
  }
  signInToShell.push(performance.now() - started)
}

const loginP95 = p95(login)
const signInP95 = p95(signInToShell)
console.log(`login_response_p95_ms=${loginP95.toFixed(1)}`)
console.log(`signin_to_shell_p95_ms=${signInP95.toFixed(1)}`)

if (loginP95 > 500 || signInP95 > 1500) process.exit(1)
