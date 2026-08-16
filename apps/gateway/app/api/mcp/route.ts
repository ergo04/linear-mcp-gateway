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
 * Clients that only speak stdio connect via `mcp-remote`, which bridges stdio → HTTP.
 */

import { type NextRequest, NextResponse } from "next/server"
import { authenticateBearer, challengeHeader } from "@/lib/oauth"
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

  const user = authenticateBearer(token, req.headers)
  if (!user) {
    // The WWW-Authenticate header is what turns this 401 into the start of an
    // OAuth flow for clients that cannot be given a token by hand — Claude's
    // connectors read the pointer from here, and from nowhere else.
    const challenge = challengeHeader(req.headers)

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "Unauthorized: missing or invalid Bearer token",
        },
      },
      {
        status: 401,
        headers: challenge ? { "WWW-Authenticate": challenge } : undefined,
      }
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
  // The status matters to the protocol, not just to HTTP: a client probing which
  // MCP revision this server speaks decides from the status plus the error body.
  const { status, body: response } = await handleProxyRequest(
    user,
    body,
    req.headers
  )

  // Notifications return null — acknowledged with no body
  if (response === null) {
    return new NextResponse(null, { status })
  }

  return NextResponse.json(response, {
    status,
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
