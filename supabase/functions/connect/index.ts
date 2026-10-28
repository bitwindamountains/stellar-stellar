// Logs an account into Facebook (+Instagram), X or TikTok and saves the tokens to Supabase Vault.
//   POST {platform, account_id} with the user's session -> {url} to send the browser to.
//   GET  ?code&state  (the platform redirects here)      -> saves the login, redirects back to the app.
// Deploy with JWT verification OFF (the platform's redirect carries no session); POST checks the user itself.
// Secrets: WEB_APP_URL, META_APP_ID, META_APP_SECRET, X_CLIENT_ID, X_CLIENT_SECRET, TIKTOK_CLIENT_KEY,
// TIKTOK_CLIENT_SECRET; optional META_GRAPH_VERSION. Register this function's URL as the redirect URI on each app.
// Tokens never reach the browser, logs or error text.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/connect`
const GRAPH = `https://graph.facebook.com/${Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0'}`
const STATE_MINUTES = 10
const PLATFORMS = ['meta', 'x', 'tiktok'] as const
type Platform = (typeof PLATFORMS)[number]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const env = (name: string) => Deno.env.get(name) ?? ''

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function backToApp(params: Record<string, string>): Response {
  const app = env('WEB_APP_URL').replace(/\/$/, '')
  return Response.redirect(`${app}/#/accounts?${new URLSearchParams(params)}`, 303)
}

/** Service-role call to PostgREST. */
async function db(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`store ${res.status}`)
  return res.status === 204 ? null : res.json()
}

function random(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE_KEY } })
  if (!res.ok) return null
  const user = await res.json().catch(() => null)
  return typeof user?.id === 'string' ? user.id : null
}

function authorizeUrl(platform: Platform, state: string, codeChallenge: string): string {
  if (platform === 'meta') {
    const scope = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'
    return `https://www.facebook.com/${GRAPH.split('/').pop()}/dialog/oauth?${new URLSearchParams({
      client_id: env('META_APP_ID'), redirect_uri: REDIRECT_URI, state, scope, response_type: 'code',
    })}`
  }
  if (platform === 'x') {
    return `https://x.com/i/oauth2/authorize?${new URLSearchParams({
      response_type: 'code', client_id: env('X_CLIENT_ID'), redirect_uri: REDIRECT_URI, state,
      scope: 'tweet.read tweet.write users.read media.write offline.access',
      code_challenge: codeChallenge, code_challenge_method: 'S256',
    })}`
  }
  return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
    client_key: env('TIKTOK_CLIENT_KEY'), response_type: 'code', redirect_uri: REDIRECT_URI, state,
    scope: 'user.info.basic,video.publish',
  })}`
}

const CREDENTIALS: Record<Platform, string[]> = {
  meta: ['META_APP_ID', 'META_APP_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
}

async function start(req: Request): Promise<Response> {
  const owner = await signedInUser(req)
  if (!owner) return reply({ error: 'Sign in first' }, 401)
  const { platform, account_id } = await req.json().catch(() => ({}))
  if (!PLATFORMS.includes(platform) || !Number.isInteger(account_id)) return reply({ error: 'Bad request' }, 400)
  const missing = [...CREDENTIALS[platform as Platform], 'WEB_APP_URL'].filter((n) => !env(n))
  if (missing.length) return reply({ error: `Set the Edge Function secrets ${missing.join(', ')} first` }, 400)
  const owned = (await db(`accounts?select=id&id=eq.${account_id}&owner_id=eq.${owner}`)) as unknown[]
  if (!owned.length) return reply({ error: 'Account not found' }, 404)

  const state = random()
  const verifier = platform === 'x' ? random() : ''
  const cutoff = new Date(Date.now() - STATE_MINUTES * 60_000).toISOString()
  await db(`oauth_states?created_at=lt.${cutoff}`, { method: 'DELETE' })
  await db('oauth_states', { method: 'POST', body: JSON.stringify({ state, owner_id: owner, account_id, platform, verifier }) })
  return reply({ url: authorizeUrl(platform, state, verifier && (await challenge(verifier))) })
}

interface Saved {
  handle: string
  tokens: Record<string, string>
  expiresIn?: number // seconds; undefined = doesn't expire
}

async function form(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error('The platform refused the login. Try again.')
  return data
}

async function exchangeX(code: string, verifier: string): Promise<Saved> {
  const basic = btoa(`${env('X_CLIENT_ID')}:${env('X_CLIENT_SECRET')}`)
  const t = await form('https://api.x.com/2/oauth2/token', {
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier, client_id: env('X_CLIENT_ID'),
  }, { Authorization: `Basic ${basic}` })
  const me = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${t.access_token}` } })
    .then((r) => r.json()).catch(() => ({}))
  return {
    handle: me?.data?.username ? `@${me.data.username}` : 'X',
    tokens: { access_token: t.access_token, refresh_token: t.refresh_token ?? '' },
    expiresIn: t.expires_in ?? 7200,
  }
}

async function exchangeTikTok(code: string): Promise<Saved> {
  const t = await form('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), code,
    grant_type: 'authorization_code', redirect_uri: REDIRECT_URI,
  })
  const me = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
    headers: { Authorization: `Bearer ${t.access_token}` },
  }).then((r) => r.json()).catch(() => ({}))
  return {
    handle: me?.data?.user?.display_name ?? 'TikTok',
    tokens: { access_token: t.access_token, refresh_token: t.refresh_token ?? '' },
    expiresIn: t.expires_in ?? 86400,
  }
}

async function graph(path: string, params: Record<string, string>) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Facebook refused the login. Try again.')
  return data
}

/** Facebook: long-lived user token -> the Page's token (doesn't expire). Fills empty Page/IG IDs on the account. */
async function exchangeMeta(code: string, accountId: number): Promise<Saved> {
  const app = { client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET') }
  const short = await graph('oauth/access_token', { ...app, redirect_uri: REDIRECT_URI, code })
  const long = await graph('oauth/access_token', { ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })
  const pages = (await graph('me/accounts', {
    access_token: long.access_token, fields: 'id,name,access_token,instagram_business_account', limit: '100',
  })).data ?? []
  const [account] = (await db(`accounts?select=fb_page_id,ig_user_id&id=eq.${accountId}`)) as { fb_page_id: string; ig_user_id: string }[]
  const page = account.fb_page_id ? pages.find((p: { id: string }) => p.id === account.fb_page_id) : pages.length === 1 ? pages[0] : undefined
  if (!page) {
    throw new Error(account.fb_page_id
      ? `This login can't manage Page ${account.fb_page_id}. Log in as a Page admin and tick that Page.`
      : pages.length ? 'You manage several Pages: type the Page ID on the account first, then connect again.' : 'No Facebook Page was shared. Tick your Page when asked.')
  }
  const fill: Record<string, string> = {}
  if (!account.fb_page_id) fill.fb_page_id = page.id
  if (!account.ig_user_id && page.instagram_business_account?.id) fill.ig_user_id = page.instagram_business_account.id
  if (Object.keys(fill).length) await db(`accounts?id=eq.${accountId}`, { method: 'PATCH', body: JSON.stringify(fill) })
  return { handle: page.name, tokens: { access_token: page.access_token } }
}

async function finish(url: URL): Promise<Response> {
  const state = url.searchParams.get('state') ?? ''
  const rows = state ? ((await db(`oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' })) as {
    account_id: number; platform: Platform; verifier: string; created_at: string
  }[]) : []
  const pending = rows[0]
  if (!pending || Date.now() - Date.parse(pending.created_at) > STATE_MINUTES * 60_000) {
    return backToApp({ error: 'That login link expired. Tap Connect again.' })
  }
  const code = url.searchParams.get('code')
  if (!code) return backToApp({ error: 'Login was cancelled.' })
  try {
    const saved = pending.platform === 'meta' ? await exchangeMeta(code, pending.account_id)
      : pending.platform === 'x' ? await exchangeX(code, pending.verifier)
      : await exchangeTikTok(code)
    await db('rpc/save_connection', {
      method: 'POST',
      body: JSON.stringify({
        p_account: pending.account_id,
        p_platform: pending.platform,
        p_handle: saved.handle,
        p_tokens: JSON.stringify(saved.tokens),
        p_expires_at: saved.expiresIn ? new Date(Date.now() + saved.expiresIn * 1000).toISOString() : null,
      }),
      headers: { Prefer: 'return=minimal' },
    })
    return backToApp({ connected: pending.platform })
  } catch (e) {
    // Only our own plain messages reach the app; anything else (could hold a URL with a code) is replaced.
    const message = e instanceof Error && !/https?:|store /.test(e.message) ? e.message : "Couldn't save the login. Try again."
    return backToApp({ error: message })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'POST') return await start(req)
    if (req.method === 'GET') return await finish(new URL(req.url))
  } catch {
    return reply({ error: 'Something went wrong. Try again.' }, 500)
  }
  return reply({ error: 'Method not allowed' }, 405)
})
