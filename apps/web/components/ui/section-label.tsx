export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
      {children}
    </p>
  )
}
