/**
 * upstream-mcp.ts — minimal MCP client for Linear's own hosted MCP server.
 *
 * Linear accepts a personal API key as `Authorization: Bearer`, and its server
 * is stateless: no `initialize` handshake, no session id, one response per POST.
 * That is what makes proxying viable from a serverless function.
 */

const UPSTREAM_URL = "https://mcp.linear.app/mcp"

export interface UpstreamTool {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface UpstreamResponse {
  jsonrpc: "2.0"
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Responses come back as `text/event-stream` even though there is exactly one
 * message per request, so the `data:` payloads have to be unwrapped. Plain JSON
 * is accepted too, in case the upstream stops framing single replies as SSE.
 */
function parseUpstreamBody(contentType: string, body: string): UpstreamResponse {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body)

  const messages = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as UpstreamResponse)

  const answer = messages.find((m) => m.result !== undefined || m.error !== undefined)
  if (!answer) throw new Error("Upstream returned no JSON-RPC result")
  return answer
}

async function request(
  apiKey: string,
  method: string,
  params?: unknown,
  id: string | number = 1
): Promise<unknown> {
  const res = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Linear MCP returned ${res.status}: ${text.slice(0, 300)}`)
  }

  const parsed = parseUpstreamBody(res.headers.get("content-type") ?? "", text)
  if (parsed.error) {
    throw new Error(`Linear MCP error ${parsed.error.code}: ${parsed.error.message}`)
  }
  return parsed.result
}

/**
 * The tool set is not the same for every workspace — Linear gates some tools on
 * the workspace's plan (e.g. the `customer*` tools), so this is cached per key
 * rather than globally.
 */
const toolCache = new Map<string, { tools: UpstreamTool[]; expiresAt: number }>()
const TOOL_CACHE_TTL_MS = 5 * 60 * 1000

export async function listUpstreamTools(apiKey: string): Promise<UpstreamTool[]> {
  const cached = toolCache.get(apiKey)
  if (cached && cached.expiresAt > Date.now()) return cached.tools

  const result = (await request(apiKey, "tools/list")) as {
    tools?: UpstreamTool[]
    nextCursor?: string | null
  }
  const tools = result.tools ?? []

  toolCache.set(apiKey, { tools, expiresAt: Date.now() + TOOL_CACHE_TTL_MS })
  return tools
}

/** Forwards a tool call verbatim; the result is passed straight back to the client. */
export async function callUpstreamTool(
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return request(apiKey, "tools/call", { name, arguments: args })
}
