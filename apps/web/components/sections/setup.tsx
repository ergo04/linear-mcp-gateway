import Link from "next/link"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { SectionLabel } from "@/components/ui/section-label"
import { CodeBlock } from "@/components/ui/code-block"
import { VercelLogo } from "@/components/ui/vercel-logo"
import { DEPLOY_URL, REPO_URL as REPO } from "@/lib/deploy-url"

export function SetupSection() {
  return (
    <section id="setup" className="border-b border-border/60">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <SectionLabel>Setup</SectionLabel>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          Two ways to run it
        </h2>

        <div className="mt-12 flex flex-col gap-14">
          {/* Vercel */}
          <div className="flex flex-col gap-4">
            <h3 className="flex items-center gap-2 font-medium">
              <VercelLogo className="size-3.5" />
              On Vercel, in one click
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The button deploys the <strong>gateway</strong>, not this site, and asks for
              the environment variables up front. Once it is live, open the deployment: it
              serves a status page that tells you exactly what is still missing, and turns
              green when every Linear key answers.
            </p>
            <div>
              <Link
                href={DEPLOY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ size: "lg" }), "gap-2")}
              >
                <VercelLogo className="size-3.5" />
                Deploy
              </Link>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generate the token with{" "}
              <code className="font-mono text-xs">openssl rand -base64 32</code>, and create
              the Linear key under <strong>Settings → API → Personal API keys</strong>. Add
              more workspaces later by adding another{" "}
              <code className="font-mono text-xs">WS_&lt;SLUG&gt;_*</code> pair and listing
              the slug in <code className="font-mono text-xs">USER_1_WORKSPACES</code>.
            </p>
          </div>

          {/* Local */}
          <div className="flex flex-col gap-4">
            <h3 className="font-medium">Locally</h3>
            <CodeBlock label="terminal">{`git clone ${REPO}
cd linear-mcp-gateway
pnpm install
cp apps/gateway/.env.example apps/gateway/.env.local`}</CodeBlock>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Fill in <code className="font-mono text-xs">apps/gateway/.env.local</code>.
              One block per person, one per workspace — the slug in the variable name
              becomes the workspace ID:{" "}
              <code className="font-mono text-xs">WS_ACME_*</code> →{" "}
              <code className="font-mono text-xs">acme</code>.
            </p>
            <CodeBlock label="apps/gateway/.env.local">{`USER_1_NAME="Simone"
USER_1_TOKEN="tok_your_secure_token"
USER_1_WORKSPACES="acme,beta"

WS_ACME_NAME="Acme Corp"
WS_ACME_LINEAR_KEY="lin_api_..."

WS_BETA_NAME="Beta Project"
WS_BETA_LINEAR_KEY="lin_api_..."`}</CodeBlock>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Then <code className="font-mono text-xs">pnpm dev</code> and open{" "}
              <code className="font-mono text-xs">localhost:3023</code> for the same status
              page.
            </p>
          </div>

          {/* Connect */}
          <div className="flex flex-col gap-4">
            <h3 className="font-medium">Connecting a client</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              It is a plain Streamable HTTP MCP server, so any client that can call an HTTP
              endpoint with an <code className="font-mono text-xs">Authorization</code>{" "}
              header works. You need the URL and your token — nothing else. Two examples:
            </p>
            <CodeBlock label="Claude Code">{`claude mcp add linear --transport http \\
  https://your-deployment.vercel.app/api/mcp \\
  --header "Authorization: Bearer tok_your_secure_token"`}</CodeBlock>
            <CodeBlock label="Codex CLI — ~/.codex/config.toml">{`experimental_use_rmcp_client = true

[mcp_servers.linear]
url = "https://your-deployment.vercel.app/api/mcp"
bearer_token_env_var = "LINEAR_GATEWAY_TOKEN"`}</CodeBlock>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Clients that only speak stdio can bridge with{" "}
              <code className="font-mono text-xs">mcp-remote</code>. Every tool takes a{" "}
              <code className="font-mono text-xs">workspace</code> argument — start with{" "}
              <code className="font-mono text-xs">list_workspaces</code>. The full tool list
              and the details worth knowing are in the{" "}
              <Link
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                README
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
