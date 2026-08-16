# linear-mcp-gateway

A self-hosted MCP (Model Context Protocol) server built with Next.js that gives any MCP
client — Claude Code, Codex, Cursor, your own agent — access to **several Linear
workspaces over a single connection**, with no database and nothing to register.

Linear ships its own excellent MCP server, but one credential means one workspace: covering three workspaces means registering it three times, which some clients (claude.ai connectors) refuse because the URL would be identical. This gateway solves exactly that. It **routes to Linear's official MCP** rather than reimplementing it, so new Linear features show up here for free.

## How it works

```
Any MCP client (Claude Code, Codex, Cursor, …)
     │  stdio (mcp-remote) or native HTTP
     │  Authorization: Bearer <your gateway token>
  /api/mcp  (Next.js App Router)
     │
     ├── proxied ────►  https://mcp.linear.app/mcp   (one API key per workspace)
     │                  63 tools, re-exported with a `workspace` argument
     │
     └── custom  ────►  @linear/sdk directly
                        11 tools Linear's own MCP does not implement
```

- Each team member has a secret Bearer token configured via env vars
- Each Linear workspace has its own Linear API key
- `/api/mcp` authenticates the token, resolves which workspaces that user may reach, and forwards each call upstream with the matching key
- Stateless end to end: Linear's MCP needs no `initialize` handshake and no session id, so this works on Vercel serverless
- Clients that cannot send a header — Claude's connector UI — get the same token through an
  OAuth flow the gateway serves itself, without storing a thing. See
  [Claude Desktop and claude.ai](#claude-desktop-and-claudeai--the-connector-ui)

### Protocol versions

The server is **dual-era**: it implements MCP `2026-07-28`, which dropped the
`initialize` handshake in favour of per-request `_meta`, while still answering
`initialize` for clients on `2025-06-18`.

- `server/discover` reports both supported versions, the capabilities and the server
  identity — cacheable publicly, since none of it depends on the caller.
- A request declaring an unsupported version in
  `_meta["io.modelcontextprotocol/protocolVersion"]` gets
  `UnsupportedProtocolVersionError` (`-32022`) listing what is supported, so the client
  can retry.
- `tools/list` carries `ttlMs` and `cacheScope: "private"`. Private is not a detail:
  the tool list depends on the caller's token, so a shared cache would serve one user's
  tools to another.
- Results carry `resultType: "complete"`; the tool list is sorted, which the spec asks
  for so clients can cache it and prompt caches keep hitting.

Requests may mirror body fields into `Mcp-Method`, `Mcp-Name` and `MCP-Protocol-Version`
headers. Omitting them is fine — this server also serves legacy clients, which the spec
permits — but a header that **contradicts** the body is rejected with `HeaderMismatch`
(`-32020`). That is not pedantry: an intermediary may route or rate-limit on the header
while the server executes the body, and the two disagreeing is a way to smuggle a call
past it. Base64-sentinel values (`=?base64?…?=`) are decoded before comparison.

Calls to Linear carry the same headers, declaring `2025-06-18` — the version Linear
reports — so the proxy keeps working when Linear starts enforcing them.

Status codes follow the transport: `400` for header and version errors, `404` with
`-32601` for an unimplemented method, `202` for notifications. A client probing which
revision the server speaks reads the status together with the error body.

## MCP tools

Every tool takes a **`workspace`** argument (`egix`, `acme`, … — call `list_workspaces` to discover the valid values). It is injected into each upstream schema and stripped again before the call is forwarded.

### Custom tools (11) — gaps in Linear's own MCP

| Tool                                                            | Why it exists                                           |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `list_workspaces`                                               | Router-level: lists the workspaces this token can reach |
| `delete_milestone`                                              | Linear's MCP cannot delete milestones at all            |
| `reorder_milestone`                                             | Its `save_milestone` has no `sortOrder` parameter       |
| `assign_issues_to_milestone`                                    | Batch (up to 50) instead of one issue at a time         |
| `archive_project` / `unarchive_project`                         | Linear's MCP cannot archive                             |
| `archive_initiative` / `unarchive_initiative`                   | Same                                                    |
| `list_initiative_projects`                                      | Exposes initiative↔project links, and the link IDs      |
| `link_project_to_initiative` / `unlink_project_from_initiative` | Creating and removing those links                       |

A custom tool shadows an upstream tool of the same name, so a gap can be filled — and later dropped when Linear implements it — without touching the rest.

### Proxied from Linear (63)

| Area                    | Tools                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues & comments       | `list_issues`, `get_issue`, `save_issue`, `list_comments`, `save_comment`, `delete_comment`, `list_issue_statuses`, `get_issue_status`, `list_issue_labels`, `create_issue_label`                                     |
| Projects & milestones   | `list_projects`, `get_project`, `save_project`, `list_project_labels`, `list_milestones`, `get_milestone`, `save_milestone`                                                                                           |
| Initiatives             | `list_initiatives`, `get_initiative`, `save_initiative`, `list_initiative_labels`, `create_initiative_label`                                                                                                          |
| Status updates          | `get_status_updates`, `save_status_update`, `delete_status_update`                                                                                                                                                    |
| Documents & attachments | `list_documents`, `get_document`, `save_document`, `get_attachment`, `create_attachment`, `prepare_attachment_upload`, `create_attachment_from_upload`, `delete_attachment`, `extract_images`, `search_documentation` |
| Code review             | `list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`, `delete_diff_comment`, `resolve_diff_thread`, `submit_diff_review`, `merge_diff`                                                                   |
| Releases                | `list_release_pipelines`, `list_releases`, `get_release`, `save_release`, `list_release_notes`, `get_release_note`, `save_release_note`                                                                               |
| Customers               | `list_customers`, `save_customer`, `delete_customer`, `save_customer_need`, `delete_customer_need`                                                                                                                    |
| Workspace               | `list_teams`, `get_team`, `list_users`, `get_user`, `get_workspace`, `list_cycles`, `list_agent_skills`, `get_agent_skill`                                                                                            |

Two behaviours worth knowing, both discovered the hard way:

- **`get_issue` hides relations by default.** Pass `includeRelations: true` to see blocking / blocked-by / related / duplicate links (`includeReleases` and `includeCustomerNeeds` work the same way). Relations are _written_ through `save_issue` with `blocks`, `blockedBy`, `relatedTo`, `duplicateOf` and the matching `remove*` fields.
- **The upstream tool list differs per workspace.** Linear gates some tools on the workspace's plan — the five `customer*` tools are absent on lower plans. The gateway exposes the _union_ across your workspaces and narrows each tool's `workspace` enum to the ones that actually support it, noting the restriction in the tool description.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/ergo04/linear-mcp-gateway
cd linear-mcp-gateway
pnpm install
```

### 2. Configure environment variables

```bash
cp apps/gateway/.env.example apps/gateway/.env.local
```

Edit `apps/gateway/.env.local`:

```env
# Team members — add one block per person
USER_1_NAME="Simone"
USER_1_TOKEN="tok_abc123"          # generate with: openssl rand -base64 32
USER_1_WORKSPACES="acme,beta"      # comma-separated workspace slugs

USER_2_NAME="Marco"
USER_2_TOKEN="tok_xyz789"
USER_2_WORKSPACES="acme"

# Linear workspaces — add one block per workspace
WS_ACME_NAME="Acme Corp"
WS_ACME_LINEAR_KEY="lin_api_..."   # Linear: Settings → API → Personal API keys

WS_BETA_NAME="Beta Project"
WS_BETA_LINEAR_KEY="lin_api_..."

# Optional — only for Claude's connectors, see "Claude Desktop and claude.ai" below
OAUTH_SIGNING_SECRET="another_openssl_rand_base64_32"
```

**Generate a secure token:**

```bash
openssl rand -base64 32
```

### 3. Run locally

```bash
pnpm dev
```

Two apps come up: the **gateway** on port **3023** (`/api/mcp` plus a status page at
`/`) and this documentation **site** on port 3022. Only the gateway reads the env vars.

Open <http://localhost:3023> — the status page lists what is still missing and turns
green once every Linear key answers.

The status page is **unauthenticated**, so it names nothing: it reports how many members
and workspaces are configured and what kind of problem exists, never a name, a slug or an
env var. Pass a configured token to see which item each line refers to:

```bash
curl -H "Authorization: Bearer tok_abc123" http://localhost:3023
```

While nothing is configured yet there is nothing to hide, so the page shows full setup
guidance. It is served `noindex`.

**Test the endpoint:**

```bash
curl -s -X POST http://localhost:3023/api/mcp \
  -H "Authorization: Bearer tok_abc123" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | jq '.result.tools | length'
```

Expect 74 — 11 custom plus whatever Linear exposes for your workspaces (63 on a plan with Customer Requests, 58 without).

```bash
# Test a tool call
curl -s -X POST http://localhost:3023/api/mcp \
  -H "Authorization: Bearer tok_abc123" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}' \
  | jq -r '.result.content[0].text'
```

### 4. Deploy to Vercel

**Option A — one-click:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fergo04%2Flinear-mcp-gateway&root-directory=apps%2Fgateway&project-name=linear-mcp-gateway&repository-name=linear-mcp-gateway&env=USER_1_NAME,USER_1_TOKEN,USER_1_WORKSPACES,WS_MAIN_NAME,WS_MAIN_LINEAR_KEY)

The `root-directory=apps/gateway` parameter is what matters: it deploys the gateway
rather than this documentation site, and the clone flow asks for the environment
variables up front. Afterwards, open the deployment to see the status page.

**Option B — CLI:**

```bash
vercel link                     # from the repo ROOT, not from apps/gateway
vercel deploy --prod
```

> Set the project's **Root Directory** to `apps/gateway`. Deploying from inside
> `apps/gateway` uploads that directory alone, and the `workspace:*` dependencies then
> fail to install.

### 5. Connect an MCP client

The gateway is a plain **Streamable HTTP** MCP server. Any client that can reach an HTTP
endpoint and send an `Authorization` header works — there is nothing product-specific in
it. You need two things: the URL `https://your-deployment/api/mcp` and the token from
`USER_N_TOKEN`.

Clients that only speak stdio can bridge with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```bash
npx mcp-remote https://your-app.vercel.app/api/mcp \
  --header "Authorization: Bearer tok_abc123"
```

Two concrete examples follow. The pattern is the same everywhere: URL plus bearer token.

**Claude Code** — native HTTP, no bridge needed:

```bash
claude mcp add linear --transport http \
  https://your-app.vercel.app/api/mcp \
  --header "Authorization: Bearer tok_abc123"
```

or in `~/.claude.json` (global) / `.mcp.json` (project root):

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://your-app.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer tok_abc123" }
    }
  }
}
```

**Codex CLI** — in `~/.codex/config.toml`. Remote HTTP servers currently sit behind an
experimental flag, so check it is still needed for your version:

```toml
experimental_use_rmcp_client = true

[mcp_servers.linear]
url = "https://your-app.vercel.app/api/mcp"
bearer_token_env_var = "LINEAR_GATEWAY_TOKEN"
```

`bearer_token_env_var` points at an environment variable rather than holding the token in
the file — preferable for something that often ends up in a dotfiles repo.

For local development, replace the URL with `http://localhost:3023/api/mcp`.

### Claude Desktop and claude.ai — the connector UI

Claude's **Add custom connector** form takes a URL and, under _Advanced settings_, an
OAuth client id and secret. There is no field for a header, and none is coming — the
request for one was [closed as not
planned](https://github.com/anthropics/claude-ai-mcp/issues/112). So the bearer token
every other client uses cannot be handed to this one, and the connector is unreachable
unless the server speaks OAuth.

It now does. Set `OAUTH_SIGNING_SECRET` and redeploy, then:

| Field                 | Value                                 |
| --------------------- | ------------------------------------- |
| Name                  | anything                              |
| Remote MCP server URL | `https://your-app.vercel.app/api/mcp` |
| OAuth Client ID       | anything, e.g. `linear-gateway`       |
| OAuth Client Secret   | **your `USER_N_TOKEN`**               |

Click **Connect**, approve on the consent screen, done. The same connector works across
claude.ai, Desktop and mobile, since they share one backend.

**Why the client secret is the token.** Anthropic documents supplying your own
pre-registered client credentials as the alternative to Dynamic Client Registration, and
those two fields are the only place in that form where a user-supplied secret reaches the
server. So the gateway treats the client secret as what it already is elsewhere: the
credential that says which user is connecting. One credential, one more way to present
it — not a second thing to steal.

**Why it needs no database.** An authorization server is normally all state — clients,
codes, tokens. Here every artefact is an HMAC-signed, expiring blob carrying what a lookup
would have returned: the code carries the PKCE challenge and the redirect it was minted
for, the tokens carry the user and the audience. `OAUTH_SIGNING_SECRET` is what signs
them, so rotating it invalidates all of them at once, and rotating a `USER_N_TOKEN`
invalidates everything issued to that user.

The flow, once, so nothing here is a black box:

```
Claude → POST /api/mcp                         401 + WWW-Authenticate: resource_metadata=…
       → GET  /.well-known/oauth-protected-resource/api/mcp   names this origin as its own AS
       → GET  /.well-known/oauth-authorization-server         no registration_endpoint: use the
                                                              credentials the user typed
       → GET  /oauth/authorize?…                consent screen → 303 back with a code
       → POST /api/oauth/token                  code + PKCE verifier + client secret
                                                → access token (1h) + refresh token (30d)
       → POST /api/mcp                          Authorization: Bearer <access token>
```

Three things break this, all outside the code:

- **Vercel deployment protection.** Claude reaches the connector from Anthropic's
  infrastructure (`160.79.104.0/21`), not from your browser, so a protected deployment
  answers it with a login page. Turn it off for the gateway project.
- **A redirecting URL.** If the URL you enter `301`s to another host — apex to `www.`,
  vanity domain to CDN — the `Authorization` header is dropped on the hop and every
  request arrives unauthenticated. Register the host that actually serves it.
- **Discovery caching.** Claude caches the two metadata documents globally for about five
  minutes. After changing `GATEWAY_URL` or the scopes, wait it out before concluding
  anything.

**Claude Code does not need any of this** — it takes a header, so the `claude mcp add`
above stays the shortest path. The OAuth surface exists for the clients that cannot.

### 6. First calls

Every tool takes a `workspace` argument, so start by discovering the valid values:

```json
{ "name": "list_workspaces", "arguments": {} }
```

Then, for example:

```json
{ "name": "list_issues", "arguments": { "workspace": "acme", "limit": 10 } }
```

## Adding users and workspaces

**New team member** — add a `USER_N_*` block to `apps/gateway/.env.local` (or the
gateway's Vercel env vars) and redeploy. Numbering must run 1, 2, 3… with no gaps:
authentication stops at the first missing block, so a `USER_3` without a `USER_2` is never
matched. The status page flags this.

```env
USER_3_NAME="Elena"
USER_3_TOKEN="tok_elena_secure_token"
USER_3_WORKSPACES="acme"
```

**New Linear workspace** — add a `WS_SLUG_*` block and reference the slug in the relevant user's `WORKSPACES`:

```env
WS_GAMMA_NAME="Gamma Startup"
WS_GAMMA_LINEAR_KEY="lin_api_..."

# Update user access:
USER_1_WORKSPACES="acme,beta,gamma"
```

The workspace ID used in tool calls is the part between `WS_` and `_NAME` / `_LINEAR_KEY`,
lowercased with underscores turned into hyphens:

| Env var prefix  | `workspace` value |
| --------------- | ----------------- |
| `WS_ACME`       | `acme`            |
| `WS_MY_STARTUP` | `my-startup`      |

A slug listed in `USER_N_WORKSPACES` with no matching `WS_*` block is dropped silently —
the user simply never sees that workspace. The status page reports it as a warning.

## Security notes

- Tokens are compared in constant time — still use long random values (`openssl rand -base64 32`)
- Each user only sees workspaces explicitly listed in their `USER_N_WORKSPACES`
- Linear API keys are never exposed to the client
- All authentication happens server-side on every request
- The status page at `/` is **unauthenticated**, so it names nothing: counts and failure
  kinds only, never a member name, a workspace slug or an env var. Names appear only for a
  caller presenting a configured token. It is served `noindex`
- Deployment URLs are not a secret. The bearer token is what protects the endpoint — an
  obscure URL only reduces drive-by scanning
- There is no rate limiting built in — add it at the Vercel/reverse-proxy level if needed

On the OAuth surface specifically, since it is the newest thing here:

- It is **off** unless `OAUTH_SIGNING_SECRET` is set, and the discovery endpoints 404
  while it is. Advertising an authorization server that cannot sign is worse than
  advertising none
- The consent screen authenticates nobody, and says so. Anyone can reach it and click
  Authorize; the code that comes out is worth nothing without a valid `USER_N_TOKEN`
  presented as the client secret at `/token`
- Redirect URIs are an exact allowlist — Claude's callback, plus loopback addresses with
  the port ignored per RFC 8252 for native clients. Anything else is refused on the page
  rather than redirected to, which is the difference between an authorization server and
  an open redirector
- Access tokens are bound to the origin they were minted for and rejected elsewhere, so
  one taken from a preview deployment does not open production
- **Codes are replayable within their 120-second lifetime.** A server with no storage
  cannot mark one spent. Redeeming it still requires both the PKCE verifier and the
  client secret, so the window buys an attacker nothing that holding those two did not
  already buy — but it is a real difference from a stateful implementation
- **Refresh tokens cannot be revoked individually**, for the same reason. Rotating that
  user's `USER_N_TOKEN` invalidates theirs; rotating `OAUTH_SIGNING_SECRET` invalidates
  everyone's

## Project structure

Two apps, deployed separately. Only `apps/gateway` is worth deploying yourself — the
Deploy Button targets it, so nobody ends up hosting a copy of the documentation site.

```
linear-mcp-gateway/
├── apps/
│   ├── gateway/                    # ← what you deploy (port 3023)
│   │   ├── app/
│   │   │   ├── api/mcp/route.ts    # MCP HTTP endpoint
│   │   │   ├── api/oauth/          # authorize (form post) and token endpoints
│   │   │   ├── oauth/authorize/    # Consent screen
│   │   │   ├── .well-known/        # RFC 9728 + RFC 8414 discovery documents
│   │   │   └── page.tsx            # Status page: what's missing, green when ready
│   │   ├── lib/
│   │   │   ├── env.ts              # Env var parser, auth, config introspection
│   │   │   ├── oauth.ts            # Stateless authorization server, for Claude connectors
│   │   │   ├── proxy-handler.ts    # MCP protocol, workspace routing, custom tools
│   │   │   ├── upstream-mcp.ts     # Client for Linear's own MCP (SSE, tool cache)
│   │   │   ├── mcp-headers.ts      # Base64 sentinel encoding for mirrored headers
│   │   │   ├── status.ts           # Config checks for the status page
│   │   │   └── linear.ts           # Linear SDK wrapper — backs the custom tools
│   │   └── .env.example
│   └── web/                        # this documentation site (port 3022, no env vars)
├── packages/
│   ├── ui/                         # Shared UI components (shadcn/ui)
│   └── typescript-config/
└── README.md
```

`apps/gateway` deliberately has no UI dependencies — no Tailwind, no component library —
so a fresh deploy builds fast and has little to break.

## Toolchain

```bash
pnpm lint          # oxlint, including type-aware rules
pnpm format        # Prettier, writes
pnpm format:check  # Prettier, verifies — for CI
pnpm typecheck     # tsc (TypeScript 7's native compiler)
```

**oxlint instead of ESLint.** ESLint could not be kept: `eslint-plugin-react` supports
ESLint 9.7 at most and crashes on 10, and `typescript-eslint` accepts
`typescript@<6.1.0`, which pins the whole workspace to TypeScript 6. oxlint runs its
type-aware rules through `tsgolint`, which embeds tsgo — so it needs no TypeScript
programmatic API, and TypeScript 7 works. Rules live in `.oxlintrc.json`.

**Prettier keeps formatting**, with `@prettier/plugin-oxc` swapping in OXC's Rust parser.
Verified to produce byte-identical output, and `prettier-plugin-tailwindcss` still sorts
classes — it must stay last in the `plugins` array. oxfmt is not used yet: it is in beta,
and a formatter bug shows up as churn across every file.

## Stack

- [Next.js 16](https://nextjs.org) — App Router, serverless API routes
- [Linear's MCP server](https://linear.app/docs/mcp) — the proxied tool surface, authenticated with a personal API key per workspace
- [@linear/sdk](https://github.com/linear/linear) — official Linear GraphQL client, backing the custom tools
- [Zod](https://zod.dev) — tool argument validation
- [oxlint](https://oxc.rs) + [Prettier](https://prettier.io) — linting and formatting, kept
  as separate jobs: oxlint never touches formatting, Prettier never enforces rules
- [shadcn/ui](https://ui.shadcn.com) + [Tailwind CSS v4](https://tailwindcss.com) — the documentation site only
- [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build) — monorepo tooling

## License

MIT
