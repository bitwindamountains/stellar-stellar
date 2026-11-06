// "Post now": asks the database's dispatch_due() to start the GitHub "publish" workflow right away, instead of
// waiting for the schedule. dispatch_due() owns the GitHub token (Vault: 'postpilot_github_token') and only starts a
// run when a post is due; without the token it does nothing and the scheduled run publishes the post.
// Deploy with JWT verification on; the function also checks for a real signed-in user (see below).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// The gateway's JWT check also lets the public browser key through, so require a real signed-in user here.
async function isSignedInUser(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  })
  if (!res.ok) return false
  const user = await res.json().catch(() => null)
  return typeof user?.id === 'string'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!(await isSignedInUser(req))) return reply({ dispatched: false, reason: 'sign in required' }, 401)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dispatch_due`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null)
  // Never echo the upstream body to the browser.
  return res?.ok ? reply({ dispatched: true }) : reply({ dispatched: false }, 502)
})
