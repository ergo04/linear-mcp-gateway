import { SectionLabel } from "@/components/ui/section-label"
import { CodeBlock } from "@/components/ui/code-block"

function StepHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-medium text-primary-foreground">
        {number}
      </span>
      <h3 className="font-medium">{title}</h3>
    </div>
  )
}

export function SetupSection() {
  return (
    <section id="setup" className="border-b border-border/60">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <SectionLabel>Setup guide</SectionLabel>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          From zero to working in minutes
        </h2>

        <div className="mt-12 flex flex-col gap-12">
          {/* Step 1 */}
          <div className="flex flex-col gap-4">
            <StepHeader number={1} title="Clone the repository" />
            <div className="pl-10">
              <CodeBlock label="terminal">{`git clone https://github.com/ergo04/linear-mcp-gateway
cd linear-mcp-gateway
pnpm install`}</CodeBlock>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col gap-4">
            <StepHeader number={2} title="Configure environment variables" />
            <div className="flex flex-col gap-3 pl-10">
              <p className="text-sm text-muted-foreground">
                Copy <code className="font-mono text-xs">.env.example</code> to{" "}
                <code className="font-mono text-xs">apps/web/.env.local</code> and fill in
                your values. Generate secure tokens with:
              </p>
              <CodeBlock label="terminal">openssl rand -base64 32</CodeBlock>
              <CodeBlock label="apps/web/.env.local">{`# Team members
USER_1_NAME="Simone"
USER_1_TOKEN="tok_your_secure_token_here"
USER_1_WORKSPACES="acme,beta"

USER_2_NAME="Marco"
USER_2_TOKEN="tok_another_secure_token"
USER_2_WORKSPACES="acme"

# Linear workspaces
WS_ACME_NAME="Acme Corp"
WS_ACME_LINEAR_KEY="lin_api_..."

WS_BETA_NAME="Beta Project"
WS_BETA_LINEAR_KEY="lin_api_..."`}</CodeBlock>
              <p className="text-sm text-muted-foreground">
                Linear API keys can be created at{" "}
                <strong>Settings → API → Personal API keys</strong> in your Linear workspace.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col gap-4">
            <StepHeader number={3} title="Run locally and test the endpoint" />
            <div className="flex flex-col gap-3 pl-10">
              <CodeBlock label="terminal">pnpm dev</CodeBlock>
              <p className="text-sm text-muted-foreground">Then send a test request:</p>
              <CodeBlock label="terminal">{`curl -s -X POST http://localhost:3000/api/mcp \\
  -H "Authorization: Bearer tok_your_secure_token_here" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \\
  | jq .`}</CodeBlock>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex flex-col gap-4">
            <StepHeader number={4} title="Deploy to Vercel" />
            <div className="flex flex-col gap-3 pl-10">
              <p className="text-sm text-muted-foreground">
                Push to GitHub and import in Vercel. Set your env vars in{" "}
                <strong>Project → Settings → Environment Variables</strong>.
                The monorepo root directory is{" "}
                <code className="font-mono text-xs">apps/web</code>.
              </p>
              <CodeBlock label="terminal">{`# Or deploy instantly with Vercel CLI
pnpm dlx vercel --cwd apps/web`}</CodeBlock>
            </div>
          </div>

          {/* Step 5 */}
          <div className="flex flex-col gap-4">
            <StepHeader number={5} title="Connect your AI client" />
            <div className="flex flex-col gap-8 pl-10">

              {/* Claude Desktop */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest font-mono">Claude Desktop</p>
                <p className="text-sm text-muted-foreground">
                  Edit{" "}
                  <code className="font-mono text-xs">~/Library/Application Support/Claude/claude_desktop_config.json</code>:
                </p>
                <CodeBlock label="claude_desktop_config.json">{`{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_your_secure_token_here"
      ]
    }
  }
}`}</CodeBlock>
                <p className="text-sm text-muted-foreground">Restart Claude Desktop. The Linear tools will appear in the tool panel.</p>
              </div>

              <div className="border-t border-border/60" />

              {/* Claude Code */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest font-mono">Claude Code</p>
                <p className="text-sm text-muted-foreground">Add via CLI (recommended):</p>
                <CodeBlock label="terminal">{`claude mcp add linear \\
  --transport http \\
  https://your-app.vercel.app/api/mcp \\
  --header "Authorization: Bearer tok_your_secure_token_here"`}</CodeBlock>
                <p className="text-sm text-muted-foreground">
                  Or add it manually to{" "}
                  <code className="font-mono text-xs">~/.claude.json</code> (global) /{" "}
                  <code className="font-mono text-xs">.claude/settings.json</code> (project):
                </p>
                <CodeBlock label="~/.claude.json">{`{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_your_secure_token_here"
      ]
    }
  }
}`}</CodeBlock>
                <p className="text-sm text-muted-foreground">
                  Verify with <code className="font-mono text-xs">claude mcp list</code>. The Linear tools will be available in every conversation.
                </p>
              </div>

              <div className="border-t border-border/60" />

              {/* Cursor */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest font-mono">Cursor</p>
                <p className="text-sm text-muted-foreground">
                  Edit{" "}
                  <code className="font-mono text-xs">~/.cursor/mcp.json</code> (global) or{" "}
                  <code className="font-mono text-xs">.cursor/mcp.json</code> (project):
                </p>
                <CodeBlock label="~/.cursor/mcp.json">{`{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-app.vercel.app/api/mcp",
        "--header",
        "Authorization: Bearer tok_your_secure_token_here"
      ]
    }
  }
}`}</CodeBlock>
                <p className="text-sm text-muted-foreground">
                  Restart Cursor or run <strong>Reload Window</strong>. The Linear tools will be available in the Composer agent panel.
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
