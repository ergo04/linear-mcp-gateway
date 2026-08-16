/**
 * proxy-handler.ts — prototype of the "route to Linear's MCP" architecture.
 *
 * Linear's own MCP exposes ~58 tools but has no concept of a workspace: one
 * credential, one workspace. This handler re-exports those tools with a
 * `workspace` argument injected into each schema, then routes each call to the
 * matching workspace's API key — so a single MCP connection covers all of them.
 *
 * Custom tools are layered on top for what Linear's MCP does not cover, and
 * shadow an upstream tool of the same name.
 */

import { z } from "zod"
import type { AuthenticatedUser } from "@/lib/env"
import * as linear from "@/lib/linear"
import {
  callUpstreamTool,
  listUpstreamTools,
  TOOL_CACHE_TTL_MS,
  type UpstreamTool,
} from "@/lib/upstream-mcp"
import { decodeHeaderValue } from "@/lib/mcp-headers"

const WORKSPACE_PARAM = "workspace"

// --------------------------------------------------------------------------
// Protocol versions
//
// `2026-07-28` dropped the initialize handshake in favour of per-request `_meta`
// and made every result carry `resultType`. This server is "dual-era": it still
// answers `initialize` for existing clients while satisfying the newer revision.
// Only versions actually implemented are advertised — a client that asks for
// anything else gets UnsupportedProtocolVersionError and retries.
// --------------------------------------------------------------------------

const MODERN_VERSION = "2026-07-28"
const LEGACY_VERSION = "2025-06-18"
const SUPPORTED_VERSIONS = [MODERN_VERSION, LEGACY_VERSION]

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion"
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo"

const SERVER_INFO = { name: "linear-mcp-gateway", version: "0.2.0" }

const INSTRUCTIONS =
  "Multi-workspace router in front of Linear's own MCP. Every tool takes a " +
  "`workspace` argument — call list_workspaces first to discover the valid values. " +
  "get_issue hides relations by default: pass `includeRelations: true` to see " +
  "blocking/blocked-by/related/duplicate links. Tools whose description names " +
  "specific workspaces are unavailable in the others (Linear gates them per plan)."

/** The protocol version a modern request declares in `_meta`, if any. */
function declaredVersion(params: unknown): string | undefined {
  const meta = (params as { _meta?: Record<string, unknown> } | undefined)?._meta
  const version = meta?.[META_PROTOCOL_VERSION]
  return typeof version === "string" ? version : undefined
}

/** Servers SHOULD identify themselves in every result's `_meta`. */
function withServerInfo<T extends object>(result: T): T {
  const existing = (result as { _meta?: Record<string, unknown> })._meta ?? {}
  return { ...result, _meta: { ...existing, [META_SERVER_INFO]: SERVER_INFO } }
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number; result: unknown }
  | {
      jsonrpc: "2.0"
      id: string | number | null
      error: { code: number; message: string; data?: unknown }
    }

interface ToolResult {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

// --------------------------------------------------------------------------
// Custom tools — the gaps Linear's own MCP leaves open
// --------------------------------------------------------------------------

interface CustomTool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required: string[]
  }
  /** Validates the arguments left after `workspace` is stripped off. */
  schema: z.ZodType
}

const CUSTOM_TOOLS: CustomTool[] = [
  {
    name: "list_workspaces",
    description:
      "List the Linear workspaces this token can reach. Call this first: every other tool needs a `workspace`.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    schema: z.object({}),
  },
  {
    name: "delete_milestone",
    description:
      "Permanently delete a project milestone. Linear's own MCP cannot delete milestones. " +
      "The milestone's issues are not deleted: they stay in the project with no milestone assigned.",
    inputSchema: {
      type: "object" as const,
      properties: {
        milestoneId: { type: "string", description: "Milestone ID to delete" },
      },
      required: ["milestoneId"],
    },
    schema: z.object({ milestoneId: z.string().min(1) }),
  },
  {
    name: "reorder_milestone",
    description:
      "Change a milestone's position within its project. Linear's own `save_milestone` has no sortOrder parameter. " +
      "Read the neighbours' sortOrder from list_milestones and pass a value between them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        milestoneId: { type: "string", description: "Milestone ID" },
        sortOrder: { type: "number", description: "New position — lower sorts first" },
      },
      required: ["milestoneId", "sortOrder"],
    },
    schema: z.object({ milestoneId: z.string().min(1), sortOrder: z.number() }),
  },
  {
    name: "assign_issues_to_milestone",
    description:
      "Assign several issues to a project milestone in one call, or clear their milestone by omitting `milestoneId`. " +
      "Linear's own MCP only sets the milestone one issue at a time.",
    inputSchema: {
      type: "object" as const,
      properties: {
        issueIds: {
          type: "array",
          items: { type: "string" },
          description: "Issue IDs to assign (max 50 per call)",
        },
        milestoneId: {
          type: "string",
          description: "Target milestone ID — omit to detach these issues from their milestone",
        },
      },
      required: ["issueIds"],
    },
    schema: z.object({
      issueIds: z.array(z.string().min(1)).min(1).max(50),
      milestoneId: z.string().optional(),
    }),
  },
  {
    name: "archive_project",
    description:
      "Archive a Linear project. Linear's own MCP cannot archive. Archived projects stay recoverable with unarchive_project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project ID to archive" } },
      required: ["projectId"],
    },
    schema: z.object({ projectId: z.string().min(1) }),
  },
  {
    name: "unarchive_project",
    description: "Restore a previously archived Linear project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project ID to restore" } },
      required: ["projectId"],
    },
    schema: z.object({ projectId: z.string().min(1) }),
  },
  {
    name: "archive_initiative",
    description:
      "Archive a Linear initiative. Linear's own MCP cannot archive. Recoverable with unarchive_initiative.",
    inputSchema: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "Initiative ID to archive" },
      },
      required: ["initiativeId"],
    },
    schema: z.object({ initiativeId: z.string().min(1) }),
  },
  {
    name: "unarchive_initiative",
    description: "Restore a previously archived Linear initiative.",
    inputSchema: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "Initiative ID to restore" },
      },
      required: ["initiativeId"],
    },
    schema: z.object({ initiativeId: z.string().min(1) }),
  },
  {
    name: "list_initiative_projects",
    description:
      "List the projects linked to an initiative, with the link ID needed to unlink them. " +
      "Linear's own MCP exposes initiatives but not their project links.",
    inputSchema: {
      type: "object",
      properties: { initiativeId: { type: "string", description: "Initiative ID" } },
      required: ["initiativeId"],
    },
    schema: z.object({ initiativeId: z.string().min(1) }),
  },
  {
    name: "link_project_to_initiative",
    description:
      "Link a project to an initiative. Linear's own MCP cannot create these links.",
    inputSchema: {
      type: "object",
      properties: {
        initiativeId: { type: "string", description: "Initiative ID" },
        projectId: { type: "string", description: "Project ID to link" },
        sortOrder: {
          type: "number",
          description: "Position within the initiative (optional) — lower sorts first",
        },
      },
      required: ["initiativeId", "projectId"],
    },
    schema: z.object({
      initiativeId: z.string().min(1),
      projectId: z.string().min(1),
      sortOrder: z.number().optional(),
    }),
  },
  {
    name: "unlink_project_from_initiative",
    description:
      "Remove a project from an initiative. Takes the link ID from list_initiative_projects, " +
      "not the project ID — Linear models the association as its own entity.",
    inputSchema: {
      type: "object",
      properties: {
        linkId: {
          type: "string",
          description: "Link ID from list_initiative_projects",
        },
      },
      required: ["linkId"],
    },
    schema: z.object({ linkId: z.string().min(1) }),
  },
]

const CUSTOM_TOOL_NAMES = new Set<string>(CUSTOM_TOOLS.map((t) => t.name))

// --------------------------------------------------------------------------
// Tool listing
// --------------------------------------------------------------------------

function withWorkspaceParam(tool: UpstreamTool, workspaceIds: string[]): UpstreamTool {
  const schema = tool.inputSchema ?? { type: "object", properties: {} }
  const existing = (schema.properties ?? {}) as Record<string, unknown>

  return {
    ...tool,
    inputSchema: {
      ...schema,
      type: schema.type ?? "object",
      properties: {
        [WORKSPACE_PARAM]: {
          type: "string",
          enum: workspaceIds,
          description: `Which Linear workspace to act on. One of: ${workspaceIds.join(", ")}`,
        },
        ...existing,
      },
      required: [WORKSPACE_PARAM, ...(schema.required ?? [])],
    },
  }
}

/**
 * Linear gates part of its tool surface on the workspace's plan, so the union of
 * every workspace's tools is exposed and each tool's `workspace` enum is narrowed
 * to the workspaces that actually support it. Taking one workspace as
 * representative would silently hide tools the others do have.
 */
async function listTools(user: AuthenticatedUser) {
  const allWorkspaceIds = user.workspaces.map((w) => w.id)

  const custom = CUSTOM_TOOLS.map((t) => {
    const definition = {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }
    return t.name === "list_workspaces"
      ? definition
      : withWorkspaceParam(definition, allWorkspaceIds)
  })

  const perWorkspace = await Promise.all(
    user.workspaces.map(async (ws) => {
      try {
        return { ws, tools: await listUpstreamTools(ws.linearApiKey) }
      } catch (error) {
        // One unreachable workspace must not blank out the whole tool list
        console.warn(`[proxy] tools/list failed for "${ws.id}":`, error)
        return { ws, tools: [] as UpstreamTool[] }
      }
    })
  )

  const merged = new Map<string, { tool: UpstreamTool; workspaceIds: string[] }>()
  for (const { ws, tools } of perWorkspace) {
    for (const tool of tools) {
      if (CUSTOM_TOOL_NAMES.has(tool.name)) continue
      const entry = merged.get(tool.name)
      if (entry) entry.workspaceIds.push(ws.id)
      else merged.set(tool.name, { tool, workspaceIds: [ws.id] })
    }
  }

  // Sorted, not left in upstream/insertion order: the spec asks for a
  // deterministic tools/list so clients can cache it and prompt caches keep
  // hitting. Custom tools stay first — that array is already fixed.
  const proxied = [...merged.values()]
    .sort((a, b) => a.tool.name.localeCompare(b.tool.name))
    .map(({ tool, workspaceIds }) => {
    const partial = workspaceIds.length < allWorkspaceIds.length
    const withParam = withWorkspaceParam(tool, workspaceIds)
    if (!partial) return withParam

    return {
      ...withParam,
      description:
        `${tool.description ?? ""}\n\nOnly available in these workspaces: ${workspaceIds.join(", ")}.`.trim(),
    }
  })

  return [...custom, ...proxied]
}

// --------------------------------------------------------------------------
// Tool execution
// --------------------------------------------------------------------------

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

function resolveWorkspace(user: AuthenticatedUser, id: unknown) {
  if (typeof id !== "string" || !id)
    throw new Error(
      `\`${WORKSPACE_PARAM}\` is required. Available: ${user.workspaces.map((w) => w.id).join(", ") || "(none)"}`
    )

  const ws = user.workspaces.find((w) => w.id === id)
  if (!ws)
    throw new Error(
      `Workspace "${id}" not found or not accessible. ` +
        `Available: ${user.workspaces.map((w) => w.id).join(", ") || "(none)"}`
    )
  return ws
}

async function executeCustomTool(
  user: AuthenticatedUser,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<ToolResult> {
  const tool = CUSTOM_TOOLS.find((t) => t.name === name)!

  if (name === "list_workspaces") {
    if (user.workspaces.length === 0) return ok("No workspaces configured for this user.")
    const lines = user.workspaces.map((w) => `- **${w.name}** (${WORKSPACE_PARAM}: \`${w.id}\`)`)
    return ok(`## Accessible workspaces\n\n${lines.join("\n")}`)
  }

  const ws = resolveWorkspace(user, rawArgs[WORKSPACE_PARAM])
  const { [WORKSPACE_PARAM]: _ignored, ...rest } = rawArgs
  const parsed = tool.schema.safeParse(rest)
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }], isError: true }
  const args = parsed.data as Record<string, unknown>

  switch (name) {
    case "delete_milestone": {
      const m = await linear.deleteMilestone(ws.linearApiKey, args["milestoneId"] as string)
      const detached = m.detachedIssuesCapped ? `${m.detachedIssues}+` : `${m.detachedIssues}`
      return ok(
        `Milestone **${m.name}** deleted (id: \`${m.id}\`).\n` +
          `${detached} issue(s) stayed in the project with no milestone assigned.`
      )
    }

    case "reorder_milestone": {
      const m = await linear.saveMilestone(ws.linearApiKey, {
        id: args["milestoneId"] as string,
        sortOrder: args["sortOrder"] as number,
      })
      return ok(`Milestone **${m.name}** moved to sortOrder ${m.sortOrder} in ${m.project ?? "its project"}.`)
    }

    case "assign_issues_to_milestone": {
      const result = await linear.assignIssuesToMilestone(
        ws.linearApiKey,
        args["issueIds"] as string[],
        (args["milestoneId"] as string | undefined) || null
      )
      const target = result.milestone ? `milestone **${result.milestone}**` : "no milestone"
      const lines = result.issues.map((i) => `- **${i.identifier}** ${i.title}`)
      return ok(`## ${result.issues.length} issue(s) assigned to ${target}\n\n${lines.join("\n")}`)
    }

    case "archive_project": {
      const p = await linear.archiveProject(ws.linearApiKey, args["projectId"] as string)
      return ok(`Project **${p.name}** archived (id: \`${p.id}\`). Restore with unarchive_project.`)
    }

    case "unarchive_project": {
      const p = await linear.unarchiveProject(ws.linearApiKey, args["projectId"] as string)
      return ok(`Project **${p.name}** restored (id: \`${p.id}\`)`)
    }

    case "archive_initiative": {
      const i = await linear.archiveInitiative(ws.linearApiKey, args["initiativeId"] as string)
      return ok(
        `Initiative **${i.name}** archived (id: \`${i.id}\`). Restore with unarchive_initiative.`
      )
    }

    case "unarchive_initiative": {
      const i = await linear.unarchiveInitiative(
        ws.linearApiKey,
        args["initiativeId"] as string
      )
      return ok(`Initiative **${i.name}** restored (id: \`${i.id}\`)`)
    }

    case "list_initiative_projects": {
      const projects = await linear.listInitiativeProjects(
        ws.linearApiKey,
        args["initiativeId"] as string
      )
      if (projects.length === 0) return ok("No projects linked to this initiative.")
      const lines = projects.map(
        (p) =>
          `- **${p.projectName}** [${p.state}]` +
          (p.targetDate ? ` | Due: ${p.targetDate}` : "") +
          `\n  project id: \`${p.projectId}\` | link id: \`${p.linkId}\``
      )
      return ok(`## Linked projects (${projects.length})\n\n${lines.join("\n")}`)
    }

    case "link_project_to_initiative": {
      const link = await linear.linkProjectToInitiative(ws.linearApiKey, {
        initiativeId: args["initiativeId"] as string,
        projectId: args["projectId"] as string,
        sortOrder: args["sortOrder"] as number | undefined,
      })
      return ok(
        `Project **${link.projectName}** linked to initiative **${link.initiativeName}**\n` +
          `Link id: \`${link.id}\` (use it with unlink_project_from_initiative)`
      )
    }

    case "unlink_project_from_initiative": {
      await linear.unlinkProjectFromInitiative(ws.linearApiKey, args["linkId"] as string)
      return ok(`Link \`${args["linkId"]}\` removed.`)
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true }
  }
}

async function executeTool(
  user: AuthenticatedUser,
  name: string,
  rawArgs: unknown
): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, unknown>

  try {
    if (CUSTOM_TOOL_NAMES.has(name)) return await executeCustomTool(user, name, args)

    const ws = resolveWorkspace(user, args[WORKSPACE_PARAM])
    const { [WORKSPACE_PARAM]: _ignored, ...forwarded } = args
    const result = await callUpstreamTool(ws.linearApiKey, name, forwarded)

    // Upstream already returns a well-formed MCP tool result — pass it through
    return result as ToolResult
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error executing tool "${name}": ${message}` }], isError: true }
  }
}

// --------------------------------------------------------------------------
// JSON-RPC dispatch
// --------------------------------------------------------------------------

export interface HandlerOutcome {
  /** HTTP status the transport must answer with. */
  status: number
  /** Null for notifications, which get 202 and no body. */
  body: JsonRpcResponse | null
}

/**
 * Headers that mirror body fields are only validated when present. Requests
 * that omit them are accepted because this server also serves legacy clients,
 * which the spec explicitly permits — but a header that contradicts the body is
 * rejected: an intermediary may route or rate-limit on the header while this
 * server executes the body, and those must not disagree.
 */
function headerMismatch(
  headers: Headers,
  method: string,
  params: unknown
): string | null {
  const declared = declaredVersion(params)
  const versionHeader = headers.get("mcp-protocol-version")
  if (versionHeader && declared && versionHeader !== declared) {
    return `MCP-Protocol-Version header value '${versionHeader}' does not match body value '${declared}'`
  }

  const methodHeader = headers.get("mcp-method")
  if (methodHeader && methodHeader !== method) {
    return `Mcp-Method header value '${methodHeader}' does not match body value '${method}'`
  }

  const nameHeader = headers.get("mcp-name")
  if (nameHeader && method === "tools/call") {
    const bodyName = (params as { name?: unknown } | undefined)?.name
    const decoded = decodeHeaderValue(nameHeader)
    if (typeof bodyName === "string" && decoded !== bodyName) {
      return `Mcp-Name header value '${decoded}' does not match body value '${bodyName}'`
    }
  }

  return null
}

export async function handleProxyRequest(
  user: AuthenticatedUser,
  body: unknown,
  headers: Headers = new Headers()
): Promise<HandlerOutcome> {
  const req = body as { id?: string | number; method?: string; params?: unknown }
  const id = req.id ?? 0

  if (!req.method) {
    return {
      status: 400,
      body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    }
  }

  if (req.method.startsWith("notifications/")) return { status: 202, body: null }

  const mismatch = headerMismatch(headers, req.method, req.params)
  if (mismatch) {
    return {
      status: 400,
      body: {
        jsonrpc: "2.0",
        id,
        error: { code: -32020, message: `Header mismatch: ${mismatch}` },
      },
    }
  }

  // A modern client states its version on every request; reject the ones this
  // server does not implement so the client can retry with a supported one.
  const requested = declaredVersion(req.params)
  if (requested && !SUPPORTED_VERSIONS.includes(requested)) {
    return {
      status: 400,
      body: {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: { supported: SUPPORTED_VERSIONS, requested },
        },
      },
    }
  }

  const ok = (result: unknown): HandlerOutcome => ({
    status: 200,
    body: { jsonrpc: "2.0", id, result },
  })

  try {
    switch (req.method) {
      case "server/discover":
        return ok(
          withServerInfo({
            resultType: "complete",
            supportedVersions: SUPPORTED_VERSIONS,
            capabilities: { tools: {} },
            instructions: INSTRUCTIONS,
            // Identity and version support are the same for every caller,
            // unlike tools/list, so this one is safe for shared caches.
            ttlMs: 60 * 60 * 1000,
            cacheScope: "public",
          })
        )

      case "initialize": {
        // Legacy handshake: answer with the requested version when it is one we
        // implement, otherwise with the newest revision that still has a
        // handshake at all — 2026-07-28 has none, so it can never go here.
        const asked = (req.params as { protocolVersion?: string } | undefined)
          ?.protocolVersion
        return ok({
          protocolVersion: asked === LEGACY_VERSION ? asked : LEGACY_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        })
      }

      case "ping":
        return ok({})

      case "tools/list":
        return ok(
          withServerInfo({
            resultType: "complete",
            tools: await listTools(user),
            // Same hint the upstream tool cache uses, so a client refetching
            // after it expires is the first request that costs anything.
            ttlMs: TOOL_CACHE_TTL_MS,
            // MUST stay private: which tools exist depends on the caller's
            // token, so a shared cache would serve one user's list to another.
            cacheScope: "private",
          })
        )

      case "tools/call": {
        const params = req.params as { name?: string; arguments?: unknown } | undefined
        if (!params?.name) {
          return {
            status: 400,
            body: {
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: "Missing tool name" },
            },
          }
        }
        return ok(
          withServerInfo({
            resultType: "complete",
            ...(await executeTool(user, params.name, params.arguments)),
          })
        )
      }

      default:
        // 404, not 200: it lets a client distinguish an unimplemented method
        // from a transport that isn't an MCP endpoint at all.
        return {
          status: 404,
          body: {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          },
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 500,
      body: { jsonrpc: "2.0", id, error: { code: -32603, message } },
    }
  }
}
