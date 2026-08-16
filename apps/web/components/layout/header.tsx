import { GitBranch } from "lucide-react"
import Link from "next/link"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { VercelLogo } from "@/components/ui/vercel-logo"
import { DEPLOY_URL, REPO_URL } from "@/lib/deploy-url"

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          <span className="font-mono text-sm font-medium">
            linear-mcp-gateway
          </span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            GitHub
          </Link>
          <Link
            href={DEPLOY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            <VercelLogo className="size-3" />
            Deploy
          </Link>
        </nav>
      </div>
    </header>
  )
}
