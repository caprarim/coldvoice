import { CTA } from "@/components/site/cta"
import { FeatureGrid } from "@/components/site/feature-grid"
import { Icon, type IconName } from "@/components/site/icon"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { Eyebrow, Section, SplitHeader } from "@/components/site/section"
import { TiltCard } from "@/components/site/tilt-card"
import { STEPS } from "@/lib/content"

const PIPELINE = [
  { spoken: "\"hey comma how are you question mark\"", written: "Hey, how are you?" },
  { spoken: "\"um so the the build is broken\"", written: "So the build is broken." },
  { spoken: "\"send it monday actually scratch that friday\"", written: "Send it Friday." },
  { spoken: "\"open index dot html\"", written: "@index.html" },
  { spoken: "\"push to next js repo\"", written: "Next.js" },
]

export default function Features() {
  return (
    <>
      <Section background="#080808" pattern="hero" className="pb-20 pt-24">
        <div className="flex flex-col gap-6">
          <ScrollReveal>
            <Eyebrow>Features</Eyebrow>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <h1 className="h2-display max-w-[860px] text-white">
              Twelve things it does,
              <br />
              <span className="soft">and nothing it doesn't.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <p className="body-copy max-w-[56ch] text-[0.95rem]">
              No summarising, no rewriting your meaning, no assistant with opinions. It transcribes what
              you said, applies rules you control, and gets out of the way.
            </p>
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0b0b0b" pattern="grid" className="py-16">
        <FeatureGrid />
      </Section>

      <Section background="#0d0d0d" pattern="grid">
        <SplitHeader
          eyebrow="The pipeline"
          title={
            <>
              Rules, not
              <br />
              <span className="soft">a second opinion.</span>
            </>
          }
          body="The cleanup stage is nine ordered steps of plain code with unit tests behind them. It is why the same sentence always comes out the same way, and why it still works with the network off."
        />

        <ScrollReveal>
          <div className="card-surface overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3.5">
              <span className="eyebrow">Spoken → written</span>
              <span className="font-[family-name:var(--font-code)] text-[0.65rem] tracking-[0.08em] text-white/25">
                DETERMINISTIC
              </span>
            </div>
            <div className="flex flex-col">
              {PIPELINE.map((row) => (
                <div
                  key={row.spoken}
                  className="grid items-center gap-3 border-b border-white/[0.04] px-6 py-4 last:border-b-0 sm:grid-cols-[1fr_auto_1fr]"
                >
                  <span className="font-[family-name:var(--font-code)] text-[0.8rem] text-white/30">
                    {row.spoken}
                  </span>
                  <span className="hidden text-white/20 sm:inline">→</span>
                  <span className="font-[family-name:var(--font-code)] text-[0.82rem] text-white">
                    {row.written}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </Section>

      <Section background="#0e0e0e" pattern="grid">
        <ScrollReveal>
          <div className="mb-12 flex flex-col gap-4">
            <Eyebrow>Start to finish</Eyebrow>
            <h2 className="h2-md max-w-[640px] text-white">
              What happens <span className="soft">between the hotkey and the text.</span>
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <ScrollReveal key={step.n} delay={index * 70} className="h-full">
              <TiltCard tilt={6} className="h-full">
                <div className="flex h-full flex-col gap-4 p-7">
                  <span className="font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.14em] text-white/40">
                    {step.n}
                  </span>
                  <span className="rule-left h-px w-full" />
                  <Icon name={step.icon as IconName} className="text-white/45" size={20} />
                  <h3 className="h3-card text-white">{step.title}</h3>
                  <p className="body-copy text-[0.85rem]">{step.body}</p>
                </div>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </Section>

      <CTA />
    </>
  )
}
