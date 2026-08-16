import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-3xl flex-col items-start justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center">
        <span>linear-mcp-gateway · MIT</span>
        <Link
          href="https://github.com/ergo04/linear-mcp-gateway"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          GitHub
        </Link>
      </div>
    </footer>
  )
}
