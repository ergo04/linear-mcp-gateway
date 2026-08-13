import { GitBranch } from "lucide-react"
import Link from "next/link"
import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          <span className="font-mono text-sm font-medium">linear-mcp-gateway</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href="https://github.com/ergo04/linear-mcp-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            GitHub
          </Link>
          <Link
            href="https://vercel.com/new/clone?repository-url=https://github.com/ergo04/linear-mcp-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Deploy
          </Link>
        </nav>
      </div>
    </header>
  )
}
