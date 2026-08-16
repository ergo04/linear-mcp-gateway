import { headers } from "next/headers"
import { authenticateToken } from "@/lib/env"
import { buildStatusReport, type CheckLevel } from "@/lib/status"

export const dynamic = "force-dynamic"

// A public page describing a deployment that holds live API keys has no business
// in a search index.
export const metadata = {
  robots: { index: false, follow: false },
}

const HEADLINE: Record<
  CheckLevel,
  { icon: string; title: string; blurb: string }
> = {
  ok: {
    icon: "✓",
    title: "Gateway ready",
    blurb:
      "Every workspace answered. Point your MCP client at the endpoint below.",
  },
  warn: {
    icon: "!",
    title: "Gateway running, with warnings",
    blurb:
      "It works, but something in the configuration is probably not what you intended.",
  },
  error: {
    icon: "×",
    title: "Not ready yet",
    blurb: "Fix the items below, then redeploy or reload this page.",
  },
}

const COLOR: Record<CheckLevel, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  error: "var(--err)",
}

export default async function StatusPage() {
  // Anyone can open this page, so names and workspace slugs are only filled in
  // for a caller that proves it holds a configured token.
  const authorization = (await headers()).get("authorization") ?? ""
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : undefined

  const report = await buildStatusReport({
    detailed: authenticateToken(token) !== null,
  })
  const head = HEADLINE[report.level]

  return (
    <>
      <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
        Linear MCP Gateway
      </p>

      <h1
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "8px 0 4px",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: COLOR[report.level],
            color: "var(--bg)",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          {head.icon}
        </span>
        <span style={{ fontSize: 24 }}>{head.title}</span>
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>{head.blurb}</p>

      <ul style={{ listStyle: "none", padding: 0, margin: "32px 0 0" }}>
        {report.checks.map((check) => (
          <li
            key={check.label}
            style={{
              display: "flex",
              gap: 12,
              padding: "14px 16px",
              marginBottom: 8,
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${COLOR[check.level]}`,
              borderRadius: 8,
              background: "var(--card)",
            }}
          >
            <div>
              <strong style={{ display: "block", fontWeight: 600 }}>
                {check.label}
              </strong>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>
                {check.detail}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {report.level === "ok" ? (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 16 }}>Connect a client</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Streamable HTTP MCP endpoint — any client that can send an{" "}
            <code>Authorization</code> header works. You need this
            deployment&apos;s URL and the token from <code>USER_1_TOKEN</code>:
          </p>
          <pre>{`https://<this-deployment>/api/mcp
Authorization: Bearer <USER_1_TOKEN>`}</pre>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            For example, with Claude Code:
          </p>
          <pre>{`claude mcp add linear --transport http \\
  https://<this-deployment>/api/mcp \\
  --header "Authorization: Bearer <USER_1_TOKEN>"`}</pre>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Every tool takes a <code>workspace</code> argument — call{" "}
            <code>list_workspaces</code> first to see the valid values.
          </p>
        </section>
      ) : (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 16 }}>What the configuration looks like</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Set these as environment variables on the deployment, then redeploy.
            Slugs map to workspace IDs: <code>WS_ACME_*</code> →{" "}
            <code>acme</code>.
          </p>
          <pre>{`USER_1_NAME="Your name"
USER_1_TOKEN="<openssl rand -base64 32>"
USER_1_WORKSPACES="acme"

WS_ACME_NAME="Acme Corp"
WS_ACME_LINEAR_KEY="lin_api_..."`}</pre>
        </section>
      )}

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 40 }}>
        This page reports presence and validity only — it never displays a token
        or an API key.
        {report.redacted ? (
          <>
            {" "}
            Names and workspace slugs are hidden because this page is public. To
            see which item each line refers to, ask for it with a configured
            token:
            <br />
            <code style={{ fontSize: 12 }}>
              curl -H &quot;Authorization: Bearer &lt;USER_1_TOKEN&gt;&quot;
              &lt;this-deployment&gt;
            </code>
          </>
        ) : null}
      </p>
    </>
  )
}
