// Starts the GitHub "publish" workflow right away, so "Post now" doesn't wait for the 30-minute schedule.
// Deploy with JWT verification on: only signed-in app users can call it.
// Secrets: GITHUB_TOKEN (fine-grained, this repo only, "Actions: read and write"), GITHUB_REPO ("owner/name").

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const token = Deno.env.get('GITHUB_TOKEN')
  const repo = Deno.env.get('GITHUB_REPO')
  // Not set up yet is not an error: the scheduled run still publishes the post.
  if (!token || !repo) return reply({ dispatched: false, reason: 'not configured' })

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/publish.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'postpilot-dispatch',
    },
    body: JSON.stringify({ ref: 'main', inputs: { dry_run: 'false' } }),
  })
  // Never echo GitHub's response body: keep the token's scope and repo details out of the browser.
  return res.status === 204 ? reply({ dispatched: true }) : reply({ dispatched: false, status: res.status }, 502)
})
