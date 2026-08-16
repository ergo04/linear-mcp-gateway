/**
 * oauth.ts — a stateless OAuth 2.1 authorization server, sized for one job.
 *
 * Claude's remote-connector form takes a URL and, under "Advanced settings", a
 * pre-registered OAuth client id and secret. It never takes a header, so the
 * Bearer token every other client uses cannot be handed to it: the only way in
 * is an authorization-code flow. Anthropic documents supplying your own client
 * credentials as a supported alternative to Dynamic Client Registration, which
 * is the door this file walks through.
 *
 * The premise of this gateway is no database, and an authorization server is
 * normally all state — clients, codes, tokens. So nothing is stored: every
 * artefact is an HMAC-signed, expiring blob carrying what a lookup would have
 * returned. The code carries the PKCE challenge and the redirect it was minted
 * for; the tokens carry the user and the audience.
 *
 * Identity comes from the client secret: the user pastes the same
 * USER_N_TOKEN they would have put in an Authorization header. That keeps one
 * credential in the system — this adds a way to present it, not a second thing
 * to steal — and means a token that authenticates nobody simply fails at
 * /token, before any code becomes useful.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import {
  authenticateToken,
  authenticateUserIndex,
  type AuthenticatedUser,
} from "@/lib/env"

/** The path this gateway serves MCP on — the resource tokens are bound to. */
export const MCP_PATH = "/api/mcp"

/** One scope, because everything this gateway does is Linear. */
export const SCOPE = "linear"

const CODE_TTL_SECONDS = 120
const ACCESS_TTL_SECONDS = 60 * 60
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

/** Where Claude's hosted surfaces — web, Desktop, mobile, Cowork — return to. */
const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback"

const TOKEN_PREFIX = "lmg1."

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// --------------------------------------------------------------------------
// Deployment identity
// --------------------------------------------------------------------------

/**
 * Absent this secret the whole OAuth surface stays off and every endpoint
 * below 404s: advertising an authorization server that cannot sign is worse
 * than advertising none, since the client then fails halfway through a flow.
 */
export function signingSecret(): string | undefined {
  return process.env.OAUTH_SIGNING_SECRET || undefined
}

export function oauthEnabled(): boolean {
  return signingSecret() !== undefined
}

function requireSecret(): string {
  const secret = signingSecret()
  if (!secret) throw new Error("OAUTH_SIGNING_SECRET is not configured")
  return secret
}

/**
 * The origin the caller actually reached. Claude requires the `resource` we
 * advertise to match the URL the user typed into the connector form, and one
 * deployment answers on several hostnames (production domain, preview URLs),
 * so the request describes it better than any constant could. GATEWAY_URL
 * pins it for deployments that want a single canonical origin.
 */
export function baseUrl(headers: Headers): string {
  const configured = process.env.GATEWAY_URL
  if (configured) return configured.replace(/\/+$/, "")

  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? ""
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const proto =
    forwardedProto || (host.startsWith("localhost") ? "http" : "https")

  return `${proto}://${host}`
}

export function resourceIdentifier(headers: Headers): string {
  return `${baseUrl(headers)}${MCP_PATH}`
}

/**
 * RFC 8707 canonical form: lowercase scheme and host, no default port, no
 * query, no fragment, no trailing slash. Claude sends the canonical form of
 * whatever the user typed, so both sides get normalised before comparison
 * rather than compared byte for byte.
 */
export function canonicalizeResource(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`
}

export function isSameResource(claimed: string, ours: string): boolean {
  const a = canonicalizeResource(claimed)
  return a !== null && a === canonicalizeResource(ours)
}

// --------------------------------------------------------------------------
// Signed artefacts
// --------------------------------------------------------------------------

interface Payload {
  typ: "code" | "access" | "refresh"
  /** Epoch seconds. */
  exp: number
  /** USER_N index — the only stable id a user has in an env-var config. */
  sub?: number
  /**
   * Prefix of the SHA-256 of that user's USER_N_TOKEN, re-checked on every
   * use. Rotating the token invalidates everything minted from it, which is
   * the only revocation a server with no storage can offer.
   */
  tkh?: string
  aud?: string
  scope?: string
  /** Codes only: the client, redirect URI and PKCE challenge they are bound to. */
  cid?: string
  ru?: string
  cc?: string
}

function hmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${TOKEN_PREFIX}${body}.${hmac(body, requireSecret())}`
}

function verify(raw: string, typ: Payload["typ"]): Payload | null {
  const secret = signingSecret()
  if (!secret || !raw.startsWith(TOKEN_PREFIX)) return null

  const parts = raw.slice(TOKEN_PREFIX.length).split(".")
  const [body, signature] = parts
  if (!body || !signature || parts.length !== 2) return null
  if (!equals(hmac(body, secret), signature)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null

  const payload = parsed as Payload
  if (payload.typ !== typ) return null
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds()) return null

  return payload
}

function tokenHash(userToken: string): string {
  return createHash("sha256").update(userToken).digest("hex").slice(0, 32)
}

// --------------------------------------------------------------------------
// Redirect URIs
//
// The one place an unvalidated value would turn this into an open redirector,
// so the allowlist is exact rather than derived from anything the caller sends.
// --------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

export function isAllowedRedirectUri(raw: string): boolean {
  if (raw === CLAUDE_REDIRECT_URI) return true

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  // Native clients — Claude Code among them — bind an ephemeral loopback port
  // at runtime, so RFC 8252 §7.3 requires matching those with the port ignored.
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

// --------------------------------------------------------------------------
// The authorization request
//
// Parsed once and used twice: to render the consent screen, and again when
// that screen posts back. Re-validating on the post is the point — the form
// travels through the user's browser, so its fields are input, not memory.
// --------------------------------------------------------------------------

export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scope: string
  audience: string
}

export type AuthorizationParse =
  | { kind: "ok"; request: AuthorizationRequest }
  | {
      kind: "reject"
      redirectUri: string
      state: string | null
      error: string
      description: string
    }
  /** Nowhere safe to send the error, so it has to be shown to the user. */
  | { kind: "fatal"; description: string }

export function parseAuthorizationRequest(
  params: URLSearchParams,
  headers: Headers
): AuthorizationParse {
  const redirectUri = params.get("redirect_uri")
  if (!redirectUri)
    return { kind: "fatal", description: "Missing redirect_uri." }
  if (!isAllowedRedirectUri(redirectUri)) {
    return {
      kind: "fatal",
      description: `This gateway does not redirect to ${redirectUri}. Claude's connectors return to ${CLAUDE_REDIRECT_URI}.`,
    }
  }

  const state = params.get("state")
  const reject = (error: string, description: string): AuthorizationParse => ({
    kind: "reject",
    redirectUri,
    state,
    error,
    description,
  })

  if (params.get("response_type") !== "code") {
    return reject(
      "unsupported_response_type",
      "Only response_type=code is supported."
    )
  }

  // Any client id is accepted, because it identifies nothing: this server has
  // no client registry, and the secret presented at /token is what says who is
  // connecting. It is still bound into the code, so the exchange must come
  // from the same client the authorization was started by.
  const clientId = params.get("client_id")
  if (!clientId) return reject("invalid_request", "Missing client_id.")

  const codeChallenge = params.get("code_challenge")
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return reject(
      "invalid_request",
      "PKCE with code_challenge_method=S256 is required."
    )
  }

  const audience = resourceIdentifier(headers)
  const claimed = params.get("resource")
  if (claimed && !isSameResource(claimed, audience)) {
    return reject(
      "invalid_target",
      `This server only issues tokens for ${audience}.`
    )
  }

  return {
    kind: "ok",
    request: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: params.get("scope") || SCOPE,
      audience,
    },
  }
}

/** Build a redirect back to the client. Safe only for an allowlisted URI. */
export function redirectBackUrl(
  redirectUri: string,
  params: Record<string, string | null>
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value)
  }

  return url.toString()
}

// --------------------------------------------------------------------------
// Authorization codes
// --------------------------------------------------------------------------

export function issueAuthorizationCode(params: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  audience: string
  scope: string
}): string {
  return sign({
    typ: "code",
    exp: nowSeconds() + CODE_TTL_SECONDS,
    cid: params.clientId,
    ru: params.redirectUri,
    cc: params.codeChallenge,
    aud: params.audience,
    scope: params.scope,
  })
}

/**
 * A stateless code cannot be marked spent, so it stays redeemable until it
 * expires. Two minutes of replay window, to a caller who already holds both
 * the PKCE verifier and the client secret, buys nothing that holding those
 * two did not already buy.
 */
export function redeemAuthorizationCode(
  code: string,
  presented: { clientId: string; redirectUri: string; codeVerifier: string }
): Payload | null {
  const payload = verify(code, "code")
  if (!payload?.cid || !payload.ru || !payload.cc) return null

  if (payload.cid !== presented.clientId) return null
  if (payload.ru !== presented.redirectUri) return null

  const computed = createHash("sha256")
    .update(presented.codeVerifier)
    .digest("base64url")

  return equals(computed, payload.cc) ? payload : null
}

// --------------------------------------------------------------------------
// Access and refresh tokens
// --------------------------------------------------------------------------

export interface IssuedTokens {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  refresh_token: string
  scope: string
}

export function issueTokens(params: {
  userIndex: number
  userToken: string
  audience: string
  scope: string
}): IssuedTokens {
  const common = {
    sub: params.userIndex,
    tkh: tokenHash(params.userToken),
    aud: params.audience,
    scope: params.scope,
  }

  return {
    access_token: sign({
      typ: "access",
      exp: nowSeconds() + ACCESS_TTL_SECONDS,
      ...common,
    }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: sign({
      typ: "refresh",
      exp: nowSeconds() + REFRESH_TTL_SECONDS,
      ...common,
    }),
    scope: params.scope,
  }
}

/** Resolve the user a signed token still stands for, or null if it no longer does. */
function resolveSubject(
  payload: Payload
): { user: AuthenticatedUser; token: string } | null {
  if (typeof payload.sub !== "number" || !payload.tkh) return null

  const entry = authenticateUserIndex(payload.sub)
  if (!entry || !equals(tokenHash(entry.token), payload.tkh)) return null

  return entry
}

export function redeemRefreshToken(
  refreshToken: string,
  audience: string,
  expectedUserIndex: number
): IssuedTokens | null {
  const payload = verify(refreshToken, "refresh")
  if (!payload?.aud || !isSameResource(payload.aud, audience)) return null
  if (payload.sub !== expectedUserIndex) return null

  const entry = resolveSubject(payload)
  if (!entry) return null

  return issueTokens({
    userIndex: entry.user.id,
    userToken: entry.token,
    audience: payload.aud,
    scope: payload.scope ?? SCOPE,
  })
}

/**
 * Accept either credential: a token minted by the flow above, or the static
 * USER_N_TOKEN that every non-Claude client still sends directly.
 */
export function authenticateBearer(
  token: string | undefined,
  headers: Headers
): AuthenticatedUser | null {
  if (!token) return null

  const payload = verify(token, "access")
  if (payload) {
    // The audience check is what stops a token minted for another deployment
    // — or for a hostname this one merely also answers on — from being replayed here.
    if (
      !payload.aud ||
      !isSameResource(payload.aud, resourceIdentifier(headers))
    ) {
      return null
    }
    return resolveSubject(payload)?.user ?? null
  }

  return authenticateToken(token)
}

/** Authenticate the client secret presented at /token: it *is* a user token. */
export function authenticateClientSecret(
  secret: string | undefined
): { user: AuthenticatedUser; token: string } | null {
  if (!secret) return null

  const user = authenticateToken(secret)
  return user ? { user, token: secret } : null
}

// --------------------------------------------------------------------------
// Discovery documents
// --------------------------------------------------------------------------

export function protectedResourceMetadata(headers: Headers) {
  const base = baseUrl(headers)

  return {
    resource: `${base}${MCP_PATH}`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
  }
}

export function authorizationServerMetadata(headers: Headers) {
  const base = baseUrl(headers)

  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    scopes_supported: [SCOPE, "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Deliberately no `registration_endpoint` and no client id metadata
    // document support: both would let Claude arrive as an anonymous client,
    // and an anonymous client has no secret — which is the only thing here
    // that says which user is connecting.
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
  }
}

/**
 * The 401 that starts the whole flow. Claude only reads this off a 401 — never
 * off a 200 — and follows `resource_metadata` from here rather than guessing
 * well-known paths.
 */
export function challengeHeader(headers: Headers): string | undefined {
  if (!oauthEnabled()) return undefined

  return [
    'Bearer error="invalid_token"',
    'error_description="Missing or invalid access token"',
    `resource_metadata="${baseUrl(headers)}/.well-known/oauth-protected-resource${MCP_PATH}"`,
    `scope="${SCOPE}"`,
  ].join(", ")
}
