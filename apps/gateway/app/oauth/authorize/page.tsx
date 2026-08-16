/**
 * The consent screen — the authorization endpoint's GET half.
 *
 * It asks for a click, not a password, and says so: this page cannot tell who
 * is looking at it. The credential arrives later, when Claude exchanges the
 * code at /token and presents the gateway token as its client secret. So the
 * code handed out here is worth nothing on its own, and the screen's job is to
 * show where the user is about to be sent — the redirect host is the one thing
 * they can actually check.
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import {
  oauthEnabled,
  parseAuthorizationRequest,
  redirectBackUrl,
} from "@/lib/oauth"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Authorize — Linear MCP Gateway",
  robots: { index: false, follow: false },
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!oauthEnabled()) notFound()

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value)
  }

  const parsed = parseAuthorizationRequest(params, await headers())

  if (parsed.kind === "fatal") {
    return (
      <>
        <h1 style={{ margin: "0 0 8px" }}>Cannot continue</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>{parsed.description}</p>
      </>
    )
  }

  if (parsed.kind === "reject") {
    redirect(
      redirectBackUrl(parsed.redirectUri, {
        error: parsed.error,
        error_description: parsed.description,
        state: parsed.state,
      })
    )
  }

  const { request } = parsed
  const redirectHost = new URL(request.redirectUri).host

  return (
    <>
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
        Linear MCP Gateway
      </p>
      <h1 style={{ margin: "8px 0 4px" }}>Authorize this connection</h1>
      <p style={{ color: "var(--muted)", margin: "0 0 24px" }}>
        A client at <strong>{redirectHost}</strong> is asking to reach the
        Linear workspaces of whoever holds the gateway token it was configured
        with.
      </p>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "14px 16px",
          margin: "0 0 24px",
          fontSize: 14,
        }}
      >
        <p style={{ margin: 0 }}>
          Approving here only issues a one-time code. The connection completes
          only if the client also presents a valid gateway token as its OAuth
          client secret — so if that field is empty or wrong, this will fail at
          the next step, not now.
        </p>
      </div>

      <form method="POST" action="/api/oauth/authorize">
        <input type="hidden" name="client_id" value={request.clientId} />
        <input type="hidden" name="redirect_uri" value={request.redirectUri} />
        <input
          type="hidden"
          name="code_challenge"
          value={request.codeChallenge}
        />
        <input type="hidden" name="code_challenge_method" value="S256" />
        <input type="hidden" name="scope" value={request.scope} />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="resource" value={request.audience} />
        {request.state !== null && (
          <input type="hidden" name="state" value={request.state} />
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="submit"
            name="decision"
            value="allow"
            style={{
              font: "inherit",
              padding: "9px 18px",
              borderRadius: 8,
              border: "1px solid transparent",
              background: "var(--fg)",
              color: "var(--bg)",
              cursor: "pointer",
            }}
          >
            Authorize
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            style={{
              font: "inherit",
              padding: "9px 18px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  )
}
