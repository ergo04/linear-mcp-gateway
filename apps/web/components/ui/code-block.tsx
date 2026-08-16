export function CodeBlock({
  children,
  label,
}: {
  children: string
  label?: string
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {label && (
        <div className="border-b border-border bg-muted px-4 py-2 font-mono text-xs text-muted-foreground">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </div>
  )
}
