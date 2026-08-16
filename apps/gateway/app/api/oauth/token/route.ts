/**
 * The token endpoint — where the flow finally proves who is connecting.
 *
 * Everything before this point is unauthenticated: anyone can open the consent
 * screen and walk away with a code. It converts to nothing unless the caller
 * also presents a configured USER_N_TOKEN as its client secret, which is the
 * same credential every other client sends in an Authorization header. The
 * exchange then hands back a short-lived token bound to that user and to this
 * server as its audience.
 *
 * Bodies are form-encoded, per RFC 6749 — Claude sends both the exchange and
 * the refresh that way, and answers are expected within ten seconds.
 */

import { type NextRequest, NextResponse } from "next/server"
import {
  authenticateClientSecret,
  isSameResource,
  issueTokens,
  oauthEnabled,
  redeemAuthorizationCode,
  redeemRefreshToken,
  resourceIdentifier,
  SCOPE,
  type IssuedTokens,
} from "@/lib/oauth"

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" }

function fail(
  error: string,
  description: string,
  init: { status?: number; headers?: Record<string, string> } = {}
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    {
      status: init.status ?? 400,
      headers: { ...NO_STORE, ...init.headers },
    }
  )
}

function ok(tokens: IssuedTokens): NextResponse {
  return NextResponse.json(tokens, { headers: NO_STORE })
}

/** RFC 6749 §2.3.1: Basic credentials are form-urlencoded before base64. */
function decodeFormComponent(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, " "))
}

interface ClientCredentials {
  id: string | null
  secret: string | null
  /** Basic auth failing must answer 401, not 400. */
  viaHeader: boolean
}

function readClientCredentials(
  req: NextRequest,
  form: URLSearchParams
): ClientCredentials {
  const authorization = req.headers.get("authorization") ?? ""

  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf8"
      )
      const separator = decoded.indexOf(":")
      if (separator !== -1) {
        return {
          id: decodeFormComponent(decoded.slice(0, separator)),
          secret: decodeFormComponent(decoded.slice(separator + 1)),
          viaHeader: true,
        }
      }
    } catch {
      // Falls through to a missing-credential error below.
    }
    return { id: null, secret: null, viaHeader: true }
  }

  return {
    id: form.get("client_id"),
    secret: form.get("client_secret"),
    viaHeader: false,
  }
}

export async function POST(req: NextRequest) {
  if (!oauthEnabled()) return new NextResponse(null, { status: 404 })

  let form: URLSearchParams
  try {
    form = new URLSearchParams(await req.text())
  } catch {
    return fail("invalid_request", "Expected a form-encoded body.")
  }

  const audience = resourceIdentifier(req.headers)
  const claimedResource = form.get("resource")
  if (claimedResource && !isSameResource(claimedResource, audience)) {
    return fail(
      "invalid_target",
      `This server only issues tokens for ${audience}.`
    )
  }

  const credentials = readClientCredentials(req, form)
  const client = authenticateClientSecret(credentials.secret ?? undefined)
  if (!credentials.id || !client) {
    return fail(
      "invalid_client",
      "The OAuth client secret must be a gateway token configured on this deployment.",
      credentials.viaHeader
        ? {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="linear-mcp-gateway"' },
          }
        : {}
    )
  }

  switch (form.get("grant_type")) {
    case "authorization_code": {
      const code = form.get("code")
      const redirectUri = form.get("redirect_uri")
      const codeVerifier = form.get("code_verifier")
      if (!code || !redirectUri || !codeVerifier) {
        return fail(
          "invalid_request",
          "code, redirect_uri and code_verifier are all required."
        )
      }

      const payload = redeemAuthorizationCode(code, {
        clientId: credentials.id,
        redirectUri,
        codeVerifier,
      })
      if (!payload?.aud || !isSameResource(payload.aud, audience)) {
        return fail(
          "invalid_grant",
          "The authorization code is invalid or expired."
        )
      }

      return ok(
        issueTokens({
          userIndex: client.user.id,
          userToken: client.token,
          audience: payload.aud,
          scope: payload.scope ?? SCOPE,
        })
      )
    }

    case "refresh_token": {
      const refreshToken = form.get("refresh_token")
      if (!refreshToken)
        return fail("invalid_request", "Missing refresh_token.")

      const tokens = redeemRefreshToken(refreshToken, audience, client.user.id)
      if (!tokens) {
        // invalid_grant specifically: any other code leaves Claude retrying a
        // refresh that can never succeed instead of prompting to reconnect.
        return fail("invalid_grant", "The refresh token is invalid or expired.")
      }

      return ok(tokens)
    }

    default:
      return fail(
        "unsupported_grant_type",
        "Only authorization_code and refresh_token are supported."
      )
  }
}
