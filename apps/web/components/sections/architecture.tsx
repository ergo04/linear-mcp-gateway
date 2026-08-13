import { Lock, Server, Zap } from "lucide-react"

const cards = [
  {
    icon: Lock,
    title: "Token-based auth",
    body: "Each team member gets a secret Bearer token. The gateway validates it on every request — no sessions, no cookies.",
  },
  {
    icon: Server,
    title: "Multi-workspace",
    body: "Each Linear workspace has its own API key. Users see only the workspaces they're configured to access.",
  },
  {
    icon: Zap,
    title: "Serverless-ready",
    body: "Stateless HTTP transport. Deploy on Vercel, Fly.io, or any Node.js host. No persistent connections required.",
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
