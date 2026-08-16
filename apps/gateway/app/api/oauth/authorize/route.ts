/**
 * Where the consent screen posts — the authorization endpoint's second half.
 *
 * The form came back through the user's browser, so every field is validated
 * again from scratch; nothing is trusted for having been rendered by us. On
 * approval this mints the authorization code and sends the browser back to
 * the client. The 303 matters: it turns the POST into a GET, so the callback
 * is not re-submitted if the user reloads.
 */

import { type NextRequest, NextResponse } from "next/server"
import {
  issueAuthorizationCode,
  oauthEnabled,
  parseAuthorizationRequest,
  redirectBackUrl,
} from "@/lib/oauth"

function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  })
}

export async function POST(req: NextRequest) {
  if (!oauthEnabled()) return new NextResponse(null, { status: 404 })

  const form = await req.formData()
  const params = new URLSearchParams()
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.set(key, value)
  }

  const parsed = parseAuthorizationRequest(params, req.headers)

  if (parsed.kind === "fatal") {
    return new NextResponse(parsed.description, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  if (parsed.kind === "reject") {
    return seeOther(
      redirectBackUrl(parsed.redirectUri, {
        error: parsed.error,
        error_description: parsed.description,
        state: parsed.state,
      })
    )
  }

  const { request } = parsed

  if (params.get("decision") !== "allow") {
    return seeOther(
      redirectBackUrl(request.redirectUri, {
        error: "access_denied",
        error_description: "The user declined the connection.",
        state: request.state,
      })
    )
  }

  const code = issueAuthorizationCode({
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    audience: request.audience,
    scope: request.scope,
  })

  return seeOther(
    redirectBackUrl(request.redirectUri, { code, state: request.state })
  )
}
