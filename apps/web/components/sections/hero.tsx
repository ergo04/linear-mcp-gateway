import Link from "next/link"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { TechBadge } from "@/components/ui/tech-badge"

export function HeroSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            <TechBadge>Next.js 16</TechBadge>
            <TechBadge>MCP HTTP</TechBadge>
            <TechBadge>@linear/sdk</TechBadge>
            <TechBadge>no database</TechBadge>
          </div>

          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Use Linear from Claude —{" "}
            <span className="text-muted-foreground">across multiple workspaces.</span>
          </h1>

          <p className="max-w-xl text-base text-muted-foreground leading-relaxed">
            A self-hosted MCP gateway that lets your team query and manage Linear issues
            directly from Claude. Zero database, zero OAuth — just environment variables
            and a single API endpoint.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="#setup" className={cn(buttonVariants({ size: "lg" }))}>
              Get started
            </Link>
            <Link
              href="#tools"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
            >
              See all tools
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
