import Link from "next/link"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { TechBadge } from "@/components/ui/tech-badge"

export function HeroSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            <TechBadge>self-hosted</TechBadge>
            <TechBadge>proxies Linear&apos;s MCP</TechBadge>
            <TechBadge>no database</TechBadge>
          </div>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            All of Linear from your AI client —{" "}
            <span className="text-muted-foreground">
              every workspace, one connection.
            </span>
          </h1>

          <p className="text-base leading-relaxed text-muted-foreground">
            A small gateway you host yourself. It routes to Linear&apos;s own
            MCP server and adds a{" "}
            <code className="font-mono text-sm">workspace</code> argument to
            every tool, so a single connection reaches all of your workspaces.
            Plain Streamable HTTP: any MCP client can use it.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="#setup" className={cn(buttonVariants({ size: "lg" }))}>
              Set it up
            </Link>
            <Link
              href="https://github.com/ergo04/linear-mcp-gateway"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              Source on GitHub
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
