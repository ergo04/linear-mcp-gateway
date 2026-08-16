import { Lock, Route, Server, Wrench, Zap } from "lucide-react"

const cards = [
  {
    icon: Route,
    title: "Routes, doesn't reimplement",
    body: "The tool surface comes from Linear's hosted MCP, re-exported with a workspace argument. Features Linear ships show up here without a code change.",
  },
  {
    icon: Server,
    title: "Multi-workspace",
    body: "One Linear API key per workspace, picked per call. Users only see the workspaces their token is configured for.",
  },
  {
    icon: Wrench,
    title: "Gaps filled locally",
    body: "11 custom tools cover what Linear's MCP lacks — deleting and reordering milestones, archiving, initiative links — and shadow upstream names when it catches up.",
  },
  {
    icon: Lock,
    title: "Token-based auth",
    body: "Each team member gets a secret Bearer token, validated on every request. No sessions, no cookies, no OAuth dance.",
  },
  {
    icon: Zap,
    title: "Serverless-ready",
    body: "Stateless throughout: Linear's MCP needs no handshake and no session id, so every request stands alone. Deploy on Vercel or any Node.js host.",
  },
]

export function ArchitectureSection() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {cards.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-background p-6"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4 text-primary" />
              </div>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
