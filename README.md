# linear-mcp-gateway

A self-hosted MCP (Model Context Protocol) server built with Next.js that gives Claude access to **several Linear workspaces over a single connection** — no database, no OAuth flow.

Linear ships its own excellent MCP server, but one credential means one workspace: covering three workspaces means registering it three times, which some clients (claude.ai connectors) refuse because the URL would be identical. This gateway solves exactly that. It **routes to Linear's official MCP** rather than reimplementing it, so new Linear features show up here for free.

## How it works

```
Claude Desktop / Code / Cursor
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

## MCP tools

Every tool takes a **`workspace`** argument (`egix`, `acme`, … — call `list_workspaces` to discover the valid values). It is injected into each upstream schema and stripped again before the call is forwarded.

### Custom tools (11) — gaps in Linear's own MCP

| Tool | Why it exists |
|------|---------------|
| `list_workspaces` | Router-level: lists the workspaces this token can reach |
| `delete_milestone` | Linear's MCP cannot delete milestones at all |
| `reorder_milestone` | Its `save_milestone` has no `sortOrder` parameter |
| `assign_issues_to_milestone` | Batch (up to 50) instead of one issue at a time |
| `archive_project` / `unarchive_project` | Linear's MCP cannot archive |
| `archive_initiative` / `unarchive_initiative` | Same |
| `list_initiative_projects` | Exposes initiative↔project links, and the link IDs |
| `link_project_to_initiative` / `unlink_project_from_initiative` | Creating and removing those links |

A custom tool shadows an upstream tool of the same name, so a gap can be filled — and later dropped when Linear implements it — without touching the rest.

### Proxied from Linear (63)

| Area | Tools |
|------|-------|
| Issues & comments | `list_issues`, `get_issue`, `save_issue`, `list_comments`, `save_comment`, `delete_comment`, `list_issue_statuses`, `get_issue_status`, `list_issue_labels`, `create_issue_label` |
| Projects & milestones | `list_projects`, `get_project`, `save_project`, `list_project_labels`, `list_milestones`, `get_milestone`, `save_milestone` |
| Initiatives | `list_initiatives`, `get_initiative`, `save_initiative`, `list_initiative_labels`, `create_initiative_label` |
| Status updates | `get_status_updates`, `save_status_update`, `delete_status_update` |
| Documents & attachments | `list_documents`, `get_document`, `save_document`, `get_attachment`, `create_attachment`, `prepare_attachment_upload`, `create_attachment_from_upload`, `delete_attachment`, `extract_images`, `search_documentation` |
| Code review | `list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`, `delete_diff_comment`, `resolve_diff_thread`, `submit_diff_review`, `merge_diff` |
| Releases | `list_release_pipelines`, `list_releases`, `get_release`, `save_release`, `list_release_notes`, `get_release_note`, `save_release_note` |
| Customers | `list_customers`, `save_customer`, `delete_customer`, `save_customer_need`, `delete_customer_need` |
| Workspace | `list_teams`, `get_team`, `list_users`, `get_user`, `get_workspace`, `list_cycles`, `list_agent_skills`, `get_agent_skill` |

Two behaviours worth knowing, both discovered the hard way:

- **`get_issue` hides relations by default.** Pass `includeRelations: true` to see blocking / blocked-by / related / duplicate links (`includeReleases` and `includeCustomerNeeds` work the same way). Relations are *written* through `save_issue` with `blocks`, `blockedBy`, `relatedTo`, `duplicateOf` and the matching `remove*` fields.
- **The upstream tool list differs per workspace.** Linear gates some tools on the workspace's plan — the five `customer*` tools are absent on lower plans. The gateway exposes the *union* across your workspaces and narrows each tool's `workspace` enum to the ones that actually support it, noting the restriction in the tool description.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/ergo04/linear-mcp-gateway
cd linear-mcp-gateway
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example apps/web/.env.local
```

Edit `apps/web/.env.local`:

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
```

**Generate a secure token:**

```bash
openssl rand -base64 32
```

### 3. Run locally

```bash
pnpm dev
```

The dev server listens on **port 3022**.

**Test the endpoint:**

```bash
curl -s -X POST http://localhost:3022/api/mcp \
  -H "Authorization: Bearer tok_abc123" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | jq '.result.tools | length'
```

Expect 74 — 11 custom plus whatever Linear exposes for your workspaces (63 on a plan with Customer Requests, 58 without).

```bash
# Test a tool call
curl -s -X POST http://localhost:3022/api/mcp \
  -H "Authorization: Bearer tok_abc123" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}' \
  | jq -r '.result.content[0].text'
```

### 4. Deploy to Vercel

**Option A — one-click:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ergo04/linear-mcp-gateway)

Set your env vars under **Project → Settings → Environment Variables**.

**Option B — CLI:**

```bash
pnpm dlx vercel --cwd apps/web
```

> The project root for Vercel is `apps/web`. Vercel auto-detects Next.js there.

### 5. Connect Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_abc123"
      ]
    }
  }
}
```

Restart Claude Desktop. The Linear tools will appear in the tool panel.

> For local development, replace the URL with `http://localhost:3022/api/mcp`.

### 6. Connect Claude Code

**Option A — CLI (recommended):**

```bash
claude mcp add linear \
  --transport http \
  https://your-app.vercel.app/api/mcp \
  --header "Authorization: Bearer tok_abc123"
```

**Option B — config file:**

Add to `~/.claude.json` for global access, or `.claude/settings.json` for a single project:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_abc123"
      ]
    }
  }
}
```

Verify the server is loaded:

```bash
claude mcp list
```

> For local development, replace the URL with `http://localhost:3022/api/mcp`.

### 7. Connect Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-level):

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_abc123"
      ]
    }
  }
}
```

Restart Cursor (or run **Reload Window**). The Linear tools will be available in the Composer agent panel.

> For local development, replace the URL with `http://localhost:3022/api/mcp`.

## Adding users and workspaces

**New team member** — add a `USER_N_*` block to `.env.local` (or Vercel env vars) and redeploy:

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

Workspace IDs (used in tool calls) are derived from the env var slug:
- `WS_ACME_*` → `"acme"`
- `WS_BETA_PROJECT_*` → `"beta-project"`

## Workspace key naming rules

| Env var prefix | Workspace ID in tools |
|----------------|----------------------|
| `WS_ACME` | `acme` |
| `WS_BETA` | `beta` |
| `WS_MY_STARTUP` | `my-startup` |

The slug is derived by lowercasing the part between `WS_` and `_NAME`/`_LINEAR_KEY`, replacing `_` with `-`.

## Security notes

- Tokens are compared with strict equality — use long random values (`openssl rand -base64 32`)
- Each user only sees workspaces explicitly listed in their `USER_N_WORKSPACES`
- Linear API keys are never exposed to the client
- All authentication happens server-side on every request
- There is no rate limiting built in — add it at the Vercel/reverse-proxy level if needed

## Project structure

```
linear-mcp-gateway/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── api/mcp/route.ts   # MCP HTTP endpoint
│       │   ├── layout.tsx
│       │   └── page.tsx           # Landing page
│       └── lib/
│           ├── env.ts             # Env var parser & auth
│           ├── proxy-handler.ts   # MCP protocol, workspace routing, custom tools
│           ├── upstream-mcp.ts    # Client for Linear's own MCP (SSE, tool cache)
│           ├── linear.ts          # Linear SDK wrapper — backs the custom tools
│           └── mcp-handler.ts     # RETIRED: the old hand-written 52-tool surface,
│                                  # no longer served. Safe to delete.
├── packages/
│   ├── ui/                        # Shared UI components (shadcn/ui)
│   └── typescript-config/
├── .env.example
└── README.md
```

## Stack

- [Next.js 16](https://nextjs.org) — App Router, serverless API routes
- [Linear's MCP server](https://linear.app/docs/mcp) — the proxied tool surface, authenticated with a personal API key per workspace
- [@linear/sdk](https://github.com/linear/linear) — official Linear GraphQL client, backing the custom tools
- [Zod](https://zod.dev) — tool argument validation
- [shadcn/ui](https://ui.shadcn.com) + [Tailwind CSS v4](https://tailwindcss.com) — landing page
- [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build) — monorepo tooling

## License

MIT
