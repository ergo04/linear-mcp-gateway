import { SectionLabel } from "@/components/ui/section-label"

const steps = [
  {
    number: "01",
    title: "Clone & configure",
    description: "Clone the repo, copy .env.example, add your Linear API keys and user tokens.",
  },
  {
    number: "02",
    title: "Deploy",
    description: "Push to Vercel (or run locally). The /api/mcp endpoint goes live automatically.",
  },
  {
    number: "03",
    title: "Connect your AI client",
    description: "Add the MCP server to Claude Desktop, Claude Code, or Cursor using mcp-remote and your Bearer token.",
  },
]

export function HowItWorksSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <SectionLabel>How it works</SectionLabel>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Three steps to production</h2>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="flex flex-col gap-3">
              <span className="font-mono text-3xl font-semibold text-border">
                {step.number}
              </span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
