/**
 * RFC 9728 Protected Resource Metadata — the document that names this
 * deployment's authorization server.
 *
 * Claude reaches it from the `resource_metadata` pointer on our 401. The
 * well-known paths are the documented fallback for when that pointer is
 * missing, and they are served anyway because other MCP clients probe them
 * directly. The path-suffixed sibling in [...path] is the one Claude tries
 * first, since the MCP endpoint has a path component.
 */

import { type NextRequest, NextResponse } from "next/server"
import { oauthEnabled, protectedResourceMetadata } from "@/lib/oauth"

export function GET(req: NextRequest) {
  if (!oauthEnabled()) return new NextResponse(null, { status: 404 })

  return NextResponse.json(protectedResourceMetadata(req.headers), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
