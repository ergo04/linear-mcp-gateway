/**
 * RFC 9728 §3.1 path-suffixed metadata: a resource with a path component
 * publishes at /.well-known/oauth-protected-resource/<that path>, and that is
 * the URL Claude tries before the bare one.
 *
 * Only this gateway's own MCP path answers. Serving the same document under
 * any suffix would claim to describe resources that do not exist here.
 */

import { type NextRequest, NextResponse } from "next/server"
import { MCP_PATH, oauthEnabled, protectedResourceMetadata } from "@/lib/oauth"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params
  if (!oauthEnabled() || `/${path.join("/")}` !== MCP_PATH) {
    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.json(protectedResourceMetadata(req.headers), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
