import Link from "next/link"
import { SectionLabel } from "@/components/ui/section-label"

// Add a line here to add a link — nothing else to touch.
const links = [{ label: "GitHub", href: "https://github.com/ergo04" }]

export function CreditsSection() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <SectionLabel>Credits</SectionLabel>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Built by <strong className="text-foreground">Simone Ergotino</strong>{" "}
          — because working across three Linear workspaces from an AI client
          should not take three connections. Open source under the MIT license:
          fork it, host it, change it.
        </p>

        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
