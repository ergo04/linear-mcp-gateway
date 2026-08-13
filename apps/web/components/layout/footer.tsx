import { GitBranch } from "lucide-react"
import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranch className="size-4" />
          <span>linear-mcp-gateway</span>
          <span className="text-border">·</span>
          <span>MIT License</span>
        </div>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <Link
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            MCP docs
          </Link>
          <Link
            href="https://linear.app/developers"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Linear API
          </Link>
          <Link
            href="https://github.com/ergo04/linear-mcp-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  )
}
