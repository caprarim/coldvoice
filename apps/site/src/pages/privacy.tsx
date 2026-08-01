import { CTA } from "@/components/site/cta"
import { IconChip, type IconName } from "@/components/site/icon"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { CenteredEyebrow, Eyebrow, Section } from "@/components/site/section"
import { TiltCard } from "@/components/site/tilt-card"
import { PRIVACY_POINTS } from "@/lib/content"

const FLOW = [
  { label: "Microphone", detail: "A hidden recorder window opens the device and streams segments." },
  { label: "Local engine", detail: "whisper.cpp on Windows, Vosk on Android. Same machine, no socket." },
  { label: "Cleanup rules", detail: "Plain code in the shared package. Nothing is sent anywhere to do it." },
  { label: "Your text field", detail: "Typed in directly, after the target is cleared as safe." },
]

const CLOUD_CONDITIONS = [
  "AI mode is switched on in Settings",
  "A Groq API key you supplied is present",
  "The machine is actually online",
]

export default function Privacy() {
  return (
    <>
      <Section
        background="#090909"
        pattern="none"
        className="pb-20 pt-24"
      >
        <div
          className="pointer-events-none absolute left-1/2 top-[-200px] h-[520px] w-[900px] -translate-x-1/2"
          style={{
            background: "radial-gradient(ellipse at center, rgba(53,211,155,0.07) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-5 text-center">
          <ScrollReveal>
            <CenteredEyebrow>Privacy</CenteredEyebrow>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <h1 className="h2-display max-w-[860px] text-white">
              Your voice does not
              <br />
              <span className="soft">need to go anywhere.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <p className="body-copy max-w-[54ch] text-[0.95rem]">
              Most dictation tools upload first and explain later. ColdVoice transcribes on the device by
              default, and the cloud path stays off until you go and turn it on yourself.
            </p>
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0b0b0b" pattern="grid">
        <div className="grid gap-3.5 md:grid-cols-2">
          {PRIVACY_POINTS.map((point, index) => (
            <ScrollReveal key={point.kicker} delay={index * 100} className="h-full">
              <TiltCard tilt={5} className="h-full rounded-[18px]">
                <div className="flex h-full flex-col gap-4 p-8">
                  <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]" />
                  <IconChip name={point.icon as IconName} large />
                  <span className="eyebrow">{point.kicker}</span>
                  <h2 className="-mt-2 text-[1.35rem] font-bold leading-tight tracking-[-0.03em] text-white">
                    {point.title}
                  </h2>
                  <p className="body-copy">{point.body}</p>
                </div>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </Section>

      <Section background="#0d0d0d" pattern="grid">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <ScrollReveal>
              <div className="flex flex-col gap-4">
                <Eyebrow>Where the audio goes</Eyebrow>
                <h2 className="h2-md text-white">
                  The whole path,
                  <br />
                  <span className="soft">on one machine.</span>
                </h2>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={80}>
              <div className="flex flex-col">
                {FLOW.map((item, index) => (
                  <div key={item.label} className="grid grid-cols-[3.5rem_1fr] gap-4 pb-7 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className="font-[family-name:var(--font-code)] text-[0.7rem] text-white/35">
                        0{index + 1}
                      </span>
                      {index < FLOW.length - 1 ? (
                        <span className="mt-2 w-px flex-1 bg-white/[0.09]" />
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[0.95rem] font-bold tracking-[-0.02em] text-white">
                        {item.label}
                      </span>
                      <span className="body-copy text-[0.85rem]">{item.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollReveal>
          </div>

          <ScrollReveal delay={140}>
            <div className="card-surface overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3.5">
                <span className="eyebrow">The cloud path</span>
                <span className="font-[family-name:var(--font-code)] text-[0.65rem] tracking-[0.08em] text-white/25">
                  OPT-IN
                </span>
              </div>
              <div className="flex flex-col gap-5 p-6">
                <p className="body-copy text-[0.85rem]">
                  Groq transcription only runs when all three of these are true at the moment you start
                  speaking:
                </p>
                <div className="flex flex-col gap-2">
                  {CLOUD_CONDITIONS.map((condition, index) => (
                    <div
                      key={condition}
                      className="flex items-center gap-3 rounded-[10px] bg-white/[0.025] px-4 py-3.5"
                    >
                      <span className="font-[family-name:var(--font-code)] text-[0.7rem] text-white/30">
                        0{index + 1}
                      </span>
                      <span className="text-[0.85rem] text-white/75">{condition}</span>
                    </div>
                  ))}
                </div>
                <p className="body-copy text-[0.85rem]">
                  Miss any one of them and the engine silently falls back to the local model without
                  losing what you were saying. The choice is locked when the utterance starts, so it
                  never swaps halfway through a sentence.
                </p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0e0e0e" pattern="grid" inner="max-w-[820px]">
        <ScrollReveal>
          <div className="card-surface flex flex-col gap-4 rounded-2xl p-9">
            <span className="eyebrow">One more thing</span>
            <h2 className="text-[1.55rem] font-bold leading-tight tracking-[-0.03em] text-white">
              It will not type into a password box
            </h2>
            <p className="body-copy">
              Every insertion target is checked by one shared rule set before a single character is
              written, and password, secure and blocklisted banking fields are refused outright. That
              check is the same code on both platforms, and it runs whether you are online or not.
            </p>
          </div>
        </ScrollReveal>
      </Section>

      <CTA />
    </>
  )
}
