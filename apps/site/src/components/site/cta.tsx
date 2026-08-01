import { Link } from "react-router-dom"

import { ScrollReveal } from "@/components/site/scroll-reveal"
import { Section } from "@/components/site/section"
import { Button } from "@/components/ui/button"

export function CTA() {
  return (
    <Section background="#111111" pattern="grid-tight" inner="max-w-[720px]" className="py-28">
      <div className="flex flex-col items-center gap-8 text-center">
        <ScrollReveal>
          <h2 className="text-[clamp(2.4rem,5vw,4rem)] font-bold leading-[1.05] tracking-[-0.045em] text-white">
            Stop typing what you
            <br />
            could have <span className="soft">just said.</span>
          </h2>
        </ScrollReveal>

        <ScrollReveal delay={160}>
          <p className="body-copy max-w-[46ch]">
            Free, offline by default, and it never asks who you are. Install it and the next paragraph is
            spoken, not typed.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={240}>
          <Button asChild variant="mono" size="xl">
            <Link to="/download">Get ColdVoice</Link>
          </Button>
        </ScrollReveal>

        <ScrollReveal delay={320}>
          <span className="font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.1em] text-[#35d39b]">
            WINDOWS · ANDROID · NO ACCOUNT
          </span>
        </ScrollReveal>
      </div>
    </Section>
  )
}
