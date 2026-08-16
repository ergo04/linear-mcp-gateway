/**
 * RFC 8414 Authorization Server Metadata.
 *
 * The authorization server is this same deployment, so the issuer is the
 * origin and the endpoints live under /api/oauth. Claude reads this to find
 * them, and to check that S256 PKCE is supported before starting a flow.
 */

import { type NextRequest, NextResponse } from "next/server"
import { authorizationServerMetadata, oauthEnabled } from "@/lib/oauth"

export function GET(req: NextRequest) {
  if (!oauthEnabled()) return new NextResponse(null, { status: 404 })

  return NextResponse.json(authorizationServerMetadata(req.headers), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
