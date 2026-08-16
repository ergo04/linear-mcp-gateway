/**
 * upstream-mcp.ts — minimal MCP client for Linear's own hosted MCP server.
 *
 * Linear accepts a personal API key as `Authorization: Bearer`, and its server
 * is stateless: no `initialize` handshake, no session id, one response per POST.
 * That is what makes proxying viable from a serverless function.
 */

import { encodeHeaderValue } from "@/lib/mcp-headers"

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
function parseUpstreamBody(
  contentType: string,
  body: string
): UpstreamResponse {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body)

  const messages = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as UpstreamResponse)

  const answer = messages.find(
    (m) => m.result !== undefined || m.error !== undefined
  )
  if (!answer) throw new Error("Upstream returned no JSON-RPC result")
  return answer
}

/**
 * The version spoken upstream. Linear's MCP reports `2025-06-18`, and that
 * revision is where `MCP-Protocol-Version` was introduced — so the header is
 * understood there. Claiming `2026-07-28` instead would be rejected outright by
 * a server that does not implement it.
 */
const UPSTREAM_PROTOCOL_VERSION = "2025-06-18"

async function request(
  apiKey: string,
  method: string,
  params?: unknown,
  id: string | number = 1
): Promise<unknown> {
  // Mcp-Method / Mcp-Name are required of clients from 2026-07-28 onwards so
  // that intermediaries can route without parsing the body. They are harmless
  // extra headers for an older server, and they stop the proxy from breaking
  // the day Linear starts enforcing them. Values must mirror the body exactly.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": UPSTREAM_PROTOCOL_VERSION,
    "Mcp-Method": method,
  }

  const name = (params as { name?: unknown } | undefined)?.name
  if (method === "tools/call" && typeof name === "string") {
    headers["Mcp-Name"] = encodeHeaderValue(name)
  }

  const res = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Linear MCP returned ${res.status}: ${text.slice(0, 300)}`)
  }

  const parsed = parseUpstreamBody(res.headers.get("content-type") ?? "", text)
  if (parsed.error) {
    throw new Error(
      `Linear MCP error ${parsed.error.code}: ${parsed.error.message}`
    )
  }
  return parsed.result
}

/**
 * The tool set is not the same for every workspace — Linear gates some tools on
 * the workspace's plan (e.g. the `customer*` tools), so this is cached per key
 * rather than globally.
 */
const toolCache = new Map<
  string,
  { tools: UpstreamTool[]; expiresAt: number }
>()

/** Also handed to clients as the `ttlMs` freshness hint on `tools/list`. */
export const TOOL_CACHE_TTL_MS = 5 * 60 * 1000

export async function listUpstreamTools(
  apiKey: string
): Promise<UpstreamTool[]> {
  const cached = toolCache.get(apiKey)
  if (cached && cached.expiresAt > Date.now()) return cached.tools

  // Follow nextCursor: Linear currently returns every tool in one page, but a
  // single unpaginated read would silently drop the tail the day it doesn't.
  const tools: UpstreamTool[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = (await request(
      apiKey,
      "tools/list",
      cursor ? { cursor } : undefined
    )) as { tools?: UpstreamTool[]; nextCursor?: string | null }

    tools.push(...(result.tools ?? []))
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }

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
