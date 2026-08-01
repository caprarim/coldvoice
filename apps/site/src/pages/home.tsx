import { ArrowRight } from "lucide-react"
import * as React from "react"
import { Link } from "react-router-dom"

import { CTA } from "@/components/site/cta"
import { DownloadButtons, PlatformChips } from "@/components/site/download-buttons"
import { FeatureGrid } from "@/components/site/feature-grid"
import { Icon, IconChip, type IconName } from "@/components/site/icon"
import { PillDemo } from "@/components/site/pill-demo"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { CenteredEyebrow, Eyebrow, Section, SplitHeader } from "@/components/site/section"
import { TiltCard } from "@/components/site/tilt-card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FAQ, PRIVACY_POINTS, STEPS, USE_CASES } from "@/lib/content"

function Hero() {
  const orbRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const orb = orbRef.current
      if (!orb) return
      const x = (event.clientX / window.innerWidth - 0.5) * 20
      const y = (event.clientY / window.innerHeight - 0.5) * 20
      orb.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`
    }

    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [])

  return (
    <section
      className="relative flex justify-center overflow-hidden px-6 md:px-12"
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 50% -5%, rgba(255,255,255,0.05) 0%, transparent 55%), #080808",
      }}
    >
      <div
        ref={orbRef}
        className="pointer-events-none absolute left-1/2 top-[-100px] size-[600px] -translate-x-1/2 transition-transform duration-600 ease-out"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)",
        }}
      />
      <div className="grid-hero" />

      <div className="relative z-1 grid w-full max-w-[1360px] items-center gap-16 py-20 lg:grid-cols-[1fr_1.15fr]">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <ScrollReveal>
            <Link
              to="/privacy"
              className="mb-7 inline-flex items-center gap-2 border border-white/[0.16] bg-white/[0.04] px-4 py-2 font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.06em] text-white/60 transition-colors hover:border-white/30 hover:text-white"
            >
              <span className="live-dot" />
              Transcribed on your machine
              <ArrowRight size={12} strokeWidth={1.5} />
            </Link>
          </ScrollReveal>

          <ScrollReveal delay={80}>
            <h1 className="h1-display text-white">
              Talk.
              <br />
              <span className="soft">It types.</span>
            </h1>
          </ScrollReveal>

          <ScrollReveal delay={160}>
            <p className="body-copy mt-7 max-w-[46ch] text-[0.95rem]">
              Press a hotkey, say the sentence, and it lands in whatever field already has focus. The
              model runs <strong className="font-medium text-white/80">on your own machine</strong> —
              no account, no upload, no network required.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={240}>
            <DownloadButtons className="mt-9 justify-center lg:justify-start" />
          </ScrollReveal>

          <ScrollReveal delay={320}>
            <PlatformChips className="mt-8 justify-center lg:justify-start" />
          </ScrollReveal>
        </div>

        <ScrollReveal delay={200}>
          <PillDemo />
        </ScrollReveal>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <Section background="#0c0c0c" pattern="grid">
      <SplitHeader
        eyebrow="How it works"
        title={
          <>
            One hotkey.
            <br />
            <span className="soft">Then it's already text.</span>
          </>
        }
        body="There is no window to open and nothing to paste. The hotkey is caught globally, the audio is transcribed locally, the transcript is cleaned by fixed rules, and the result is typed into the app you were already using."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <ScrollReveal key={step.n} delay={index * 70} className="h-full">
            <TiltCard tilt={7} className="h-full">
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
  )
}

function Features() {
  return (
    <Section background="#0b0b0b" pattern="grid" className="py-16">
      <ScrollReveal>
        <div className="mb-16 flex flex-col gap-4">
          <Eyebrow>Features</Eyebrow>
          <h2 className="h2-display max-w-[640px] text-white">
            Every part of it is <span className="soft">boring on purpose.</span>
          </h2>
        </div>
      </ScrollReveal>

      <FeatureGrid limit={6} />

      <ScrollReveal delay={120}>
        <div className="mt-10 flex justify-center">
          <Button asChild variant="ghost">
            <Link to="/features">
              See all twelve
              <ArrowRight size={14} strokeWidth={1.5} />
            </Link>
          </Button>
        </div>
      </ScrollReveal>
    </Section>
  )
}

function UseCases() {
  return (
    <Section background="#0e0e0e" pattern="grid">
      <SplitHeader
        eyebrow="Who it's for"
        title={
          <>
            For the parts of the day
            <br />
            <span className="soft">that are just typing.</span>
          </>
        }
        body="Not a note-taking app and not a meeting recorder. It is for the words you were going to type anyway, into the window that is already in front of you."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {USE_CASES.map((item, index) => (
          <ScrollReveal key={item.n} delay={index * 70} className="h-full">
            <TiltCard tilt={6} className="h-full">
              <div className="flex h-full flex-col gap-7 p-7">
                <Badge variant="mark">{item.n}</Badge>
                <div className="flex flex-col gap-3">
                  <Icon name={item.icon as IconName} className="text-white/45" size={20} />
                  <h3 className="h3-card text-white">{item.title}</h3>
                  <p className="body-copy text-[0.85rem]">{item.body}</p>
                </div>
              </div>
            </TiltCard>
          </ScrollReveal>
        ))}
      </div>
    </Section>
  )
}

function PrivacyStrip() {
  return (
    <Section background="#080808" pattern="glow">
      <ScrollReveal>
        <div className="mb-14 flex flex-col gap-4">
          <Eyebrow>Privacy</Eyebrow>
          <h2 className="h2-display max-w-[720px] text-white">
            The private option is the one
            <br />
            <span className="soft">you get by doing nothing.</span>
          </h2>
        </div>
      </ScrollReveal>

      <div className="grid gap-3.5 md:grid-cols-2">
        {PRIVACY_POINTS.map((point, index) => (
          <ScrollReveal key={point.kicker} delay={index * 100} className="h-full">
            <TiltCard tilt={5} className="h-full rounded-[18px]">
              <div className="flex h-full flex-col gap-4 p-8">
                <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]" />
                <IconChip name={point.icon as IconName} large />
                <span className="eyebrow">{point.kicker}</span>
                <h3 className="-mt-2 text-[1.35rem] font-bold leading-tight tracking-[-0.03em] text-white">
                  {point.title}
                </h3>
                <p className="body-copy">{point.body}</p>
              </div>
            </TiltCard>
          </ScrollReveal>
        ))}
      </div>
    </Section>
  )
}

function FaqPreview() {
  return (
    <Section background="#090909" pattern="grid-tight" inner="max-w-[820px]">
      <ScrollReveal>
        <div className="mb-12 flex flex-col items-center gap-5 text-center">
          <CenteredEyebrow>Questions</CenteredEyebrow>
          <h2 className="h2-md text-white">
            Common <span className="soft">questions.</span>
          </h2>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={80}>
        <Accordion type="single" collapsible className="flex flex-col gap-2.5">
          {FAQ.slice(0, 5).map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollReveal>

      <ScrollReveal delay={160}>
        <div className="mt-8 flex justify-center">
          <Button asChild variant="ghost">
            <Link to="/faq">
              Read the rest
              <ArrowRight size={14} strokeWidth={1.5} />
            </Link>
          </Button>
        </div>
      </ScrollReveal>
    </Section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <UseCases />
      <PrivacyStrip />
      <FaqPreview />
      <CTA />
    </>
  )
}
