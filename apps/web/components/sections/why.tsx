import { SectionLabel } from "@/components/ui/section-label"

export function WhySection() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <SectionLabel>Why it exists</SectionLabel>

        <div className="mt-6 flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            Linear ships an excellent MCP server. The catch is that one
            credential means one workspace: if you work across three, you have
            to register it three times — and some clients refuse that outright,
            because the URL would be identical every time.
          </p>
          <p>
            This gateway sits in front of it. It holds one Linear API key per
            workspace, re-exports Linear&apos;s tools with a{" "}
            <code className="font-mono text-xs">workspace</code> argument, and
            forwards each call with the right key. One connection, every
            workspace.
          </p>
          <p>
            The important part is what it <em>doesn&apos;t</em> do: it does not
            reimplement Linear. The tools come from Linear&apos;s own server, so
            whatever they ship arrives here without a code change. A handful of
            custom tools cover the gaps Linear&apos;s MCP leaves — deleting and
            reordering milestones, archiving, initiative links — and step aside
            if Linear ever implements them.
          </p>
        </div>
      </div>
    </section>
  )
}
