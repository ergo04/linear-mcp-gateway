export const metadata = {
  title: "Linear MCP Gateway — status",
  description: "Configuration status for this Linear MCP gateway deployment.",
}

// Deliberately dependency-free: this deployment's job is serving /api/mcp, and
// the status page should never be a reason for the build to break.
const css = `
  :root {
    color-scheme: light dark;
    --bg: #fff; --fg: #111; --muted: #666; --border: #e5e5e5; --card: #fafafa;
    --ok: #087443; --warn: #8a5a00; --err: #b42318;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0a; --fg: #ededed; --muted: #a1a1a1; --border: #262626; --card: #141414;
      --ok: #3ddc97; --warn: #e3b341; --err: #ff6b6b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 680px; margin: 0 auto; padding: 48px 24px 80px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  pre {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 14px; overflow-x: auto;
  }
  a { color: inherit; }
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
