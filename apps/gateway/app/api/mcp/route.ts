/**
 * /api/mcp — MCP Streamable HTTP endpoint.
 *
 * Authentication: Bearer token in Authorization header.
 * Protocol: JSON-RPC 2.0 (Model Context Protocol over HTTP).
 *
 * The tool surface is Linear's own MCP server, re-exported with a `workspace`
 * argument so one connection covers every configured workspace, plus the custom
 * tools in proxy-handler.ts for what Linear's MCP does not implement.
 *
 * Each POST request is stateless — perfect for serverless deployments.
 * Claude Desktop connects via `mcp-remote` which proxies stdio → HTTP.
 */

import { type NextRequest, NextResponse } from "next/server"
import { authenticateToken } from "@/lib/env"
import { handleProxyRequest } from "@/lib/proxy-handler"

// Use the Node.js runtime so @linear/sdk can run without restrictions
export const runtime = "nodejs"

// --------------------------------------------------------------------------
// POST — handle JSON-RPC requests
// --------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ---- Auth ----------------------------------------------------------------
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : undefined

  const user = authenticateToken(token)
  if (!user) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "Unauthorized: missing or invalid Bearer token",
        },
      },
      { status: 401 }
    )
  }

  // ---- Parse body ----------------------------------------------------------
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON" },
      },
      { status: 400 }
    )
  }

  // ---- Dispatch ------------------------------------------------------------
  const response = await handleProxyRequest(user, body)

  // Notifications return null — no response body needed
  if (response === null) {
    return new NextResponse(null, { status: 202 })
  }

  return NextResponse.json(response, {
    headers: { "Content-Type": "application/json" },
  })
}

// --------------------------------------------------------------------------
// GET — minimal SSE endpoint
//
// mcp-remote may probe this path. We return a basic SSE response that closes
// immediately; all actual communication happens via POST above.
// --------------------------------------------------------------------------

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      // Send a comment to confirm the endpoint is alive, then close
      controller.enqueue(new TextEncoder().encode(": linear-mcp-gateway\n\n"))
      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
