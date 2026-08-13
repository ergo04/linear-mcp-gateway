import { PenLine, Settings } from "lucide-react"
import { CodeBlock } from "@/components/ui/code-block"

export function ConfigSection() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-12 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Settings className="size-4 text-muted-foreground" />
              <h3 className="font-medium">Adding a team member</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Add a new <code className="font-mono text-xs">USER_N_*</code> block and
              redeploy. No code changes needed.
            </p>
            <CodeBlock>{`USER_3_NAME="Elena"
USER_3_TOKEN="tok_elena_token"
USER_3_WORKSPACES="acme"`}</CodeBlock>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <PenLine className="size-4 text-muted-foreground" />
              <h3 className="font-medium">Adding a workspace</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Add a <code className="font-mono text-xs">WS_SLUG_*</code> block and
              reference the slug in the user&apos;s <code className="font-mono text-xs">WORKSPACES</code> list.
            </p>
            <CodeBlock>{`WS_GAMMA_NAME="Gamma Startup"
WS_GAMMA_LINEAR_KEY="lin_api_..."

# then in the user block:
USER_1_WORKSPACES="acme,beta,gamma"`}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  )
}
