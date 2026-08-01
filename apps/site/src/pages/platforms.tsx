import { Check, Minus } from "lucide-react"

import { CTA } from "@/components/site/cta"
import { DownloadButtons } from "@/components/site/download-buttons"
import { IconChip, type IconName } from "@/components/site/icon"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { Eyebrow, Section } from "@/components/site/section"
import { TiltCard } from "@/components/site/tilt-card"
import { Badge } from "@/components/ui/badge"
import { DOWNLOADS, PLATFORM_MATRIX } from "@/lib/content"

function Cell({ value }: { value: string | boolean }) {
  if (value === true) {
    return <Check size={15} strokeWidth={1.5} className="text-[#35d39b]" />
  }

  if (value === false) {
    return <Minus size={15} strokeWidth={1.5} className="text-white/20" />
  }

  return (
    <span className="font-[family-name:var(--font-code)] text-[0.75rem] leading-relaxed text-white/55">
      {value}
    </span>
  )
}

export default function Platforms() {
  const platforms = [DOWNLOADS.windows, DOWNLOADS.linux, DOWNLOADS.android]

  return (
    <>
      <Section background="#0c0c0c" pattern="glow" className="pb-20 pt-24">
        <div className="flex flex-col items-center gap-5 text-center">
          <ScrollReveal>
            <Eyebrow>Available on</Eyebrow>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <h1 className="h2-display max-w-[820px] text-white">
              Two platforms,
              <br />
              <span className="soft">one set of rules.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <p className="body-copy max-w-[52ch] text-[0.95rem]">
              The desktop app is where the full product lives. The Android build carries the same engine
              decision, the same cleanup rules and the same refusal to touch a password field — with a
              smaller surface around them.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={240}>
            <DownloadButtons className="mt-4 justify-center" />
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0b0b0b" pattern="grid">
        <div className="grid gap-3.5 md:grid-cols-2">
          {platforms.map((platform, index) => (
            <ScrollReveal key={platform.platform} delay={index * 100} className="h-full">
              <TiltCard tilt={5} className="h-full rounded-[18px]">
                <div className="flex h-full flex-col gap-4 p-8">
                  <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]" />
                  <div className="flex items-start justify-between">
                    <IconChip name={platform.icon as IconName} large />
                    <Badge variant="mint">v{platform.version}</Badge>
                  </div>
                  <h2 className="text-[1.55rem] font-bold leading-tight tracking-[-0.03em] text-white">
                    {platform.platform}
                  </h2>
                  <p className="body-copy">{platform.note}</p>
                  <div className="mt-auto flex flex-col gap-1.5 pt-4 font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.06em] text-white/35">
                    <span>{platform.requirement}</span>
                    <span>
                      {platform.file} · {platform.size}
                    </span>
                  </div>
                </div>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </Section>

      <Section background="#0d0d0d" pattern="grid">
        <ScrollReveal>
          <div className="mb-12 flex flex-col gap-4">
            <Eyebrow>Side by side</Eyebrow>
            <h2 className="h2-md max-w-[640px] text-white">
              What you actually get <span className="soft">on each one.</span>
            </h2>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={80}>
          <div className="card-surface overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-4 border-b border-white/[0.07] px-6 py-4">
              <span className="eyebrow">Capability</span>
              <span className="eyebrow">Windows</span>
              <span className="eyebrow">Android</span>
            </div>
            {PLATFORM_MATRIX.map((row) => (
              <div
                key={row.row}
                className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-4 border-b border-white/[0.04] px-6 py-4 last:border-b-0 hover:bg-white/[0.015]"
              >
                <span className="text-[0.85rem] font-medium tracking-[-0.01em] text-white/80">
                  {row.row}
                </span>
                <Cell value={row.win} />
                <Cell value={row.droid} />
              </div>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal delay={160}>
          <p className="body-copy mt-6 max-w-[62ch] text-[0.82rem]">
            The Android package is signed with the debug key on purpose, so builds you already have keep
            updating in place. Android will warn you about that on install, and on Android 13 and above
            you also have to allow restricted settings before accessibility can be switched on.
          </p>
        </ScrollReveal>
      </Section>

      <CTA />
    </>
  )
}
