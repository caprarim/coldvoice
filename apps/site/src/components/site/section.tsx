import * as React from "react"

import { ScrollReveal } from "@/components/site/scroll-reveal"
import { cn } from "@/lib/utils"

type SectionProps = React.ComponentProps<"section"> & {
  background?: string
  pattern?: "grid" | "grid-tight" | "hero" | "glow" | "none"
  inner?: string
}

export function Section({
  className,
  background = "#0b0b0b",
  pattern = "grid",
  inner,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn("relative flex justify-center overflow-hidden px-6 py-24 md:px-12", className)}
      style={{ backgroundColor: background }}
      {...props}
    >
      {pattern === "grid" ? <div className="grid-overlay" /> : null}
      {pattern === "grid-tight" ? <div className="grid-tight" /> : null}
      {pattern === "hero" ? <div className="grid-hero" /> : null}
      {pattern === "glow" ? (
        <div
          className="pointer-events-none absolute left-1/2 top-[-160px] h-[400px] w-[800px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(255,255,255,0.045) 0%, transparent 70%)",
          }}
        />
      ) : null}
      <div className={cn("relative z-1 w-full max-w-[1200px]", inner)}>{children}</div>
    </section>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>
}

export function CenteredEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <span className="rule-left h-px w-15" />
      <span className="eyebrow">{children}</span>
      <span className="rule-right h-px w-15" />
    </div>
  )
}

export function SplitHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div className="mb-14 grid items-end gap-8 md:grid-cols-2 md:gap-12">
      <ScrollReveal>
        <div className="flex flex-col gap-4">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="h2-md text-white">{title}</h2>
        </div>
      </ScrollReveal>
      <ScrollReveal delay={80}>
        <p className="body-copy max-w-[46ch]">{body}</p>
      </ScrollReveal>
    </div>
  )
}
