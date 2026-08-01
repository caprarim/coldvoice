import { Download as DownloadIcon } from "lucide-react"

import { Icon, IconChip, type IconName } from "@/components/site/icon"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { CenteredEyebrow, Eyebrow, Section } from "@/components/site/section"
import { TiltCard } from "@/components/site/tilt-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DOWNLOADS, SITE } from "@/lib/content"

const WINDOWS_STEPS = [
  "Run ColdVoice-Setup.exe and let it install.",
  "Open it once so it can register the global hotkey.",
  "Press Ctrl+1 in any text field and start talking.",
]

const LINUX_STEPS = [
  "Install the .deb (double-click it, or sudo apt install ./ColdVoice.deb), or mark the AppImage executable.",
  "On Wayland, either log in with Ubuntu on Xorg or bind a GNOME custom shortcut to coldvoice --toggle.",
  "Press Ctrl+1, speak, and the text lands in the focused field.",
]

const ANDROID_STEPS = [
  "Allow installs from unknown sources, then open the APK.",
  "On Android 13+, allow restricted settings for ColdVoice.",
  "Enable the accessibility bubble, then tap the edge square on any text field.",
]

export default function Download() {
  const platforms = [
    { ...DOWNLOADS.windows, steps: WINDOWS_STEPS },
    { ...DOWNLOADS.linux, steps: LINUX_STEPS },
    { ...DOWNLOADS.android, steps: ANDROID_STEPS },
  ]

  return (
    <>
      <Section background="#111111" pattern="grid-tight" className="pb-20 pt-24">
        <div className="flex flex-col items-center gap-5 text-center">
          <ScrollReveal>
            <CenteredEyebrow>Download</CenteredEyebrow>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <h1 className="h2-display max-w-[820px] text-white">
              Free, and there is
              <br />
              <span className="soft">nothing to sign up for.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <p className="body-copy max-w-[50ch] text-[0.95rem]">
              Both builds come straight from the GitHub releases page. No licence key, no trial timer, no
              account wall in front of dictation.
            </p>
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0b0b0b" pattern="grid">
        <div className="grid gap-3.5 md:grid-cols-2">
          {platforms.map((platform, index) => (
            <ScrollReveal key={platform.platform} delay={index * 100} className="h-full">
              <TiltCard tilt={4} className="h-full rounded-[18px]">
                <div className="flex h-full flex-col gap-5 p-8">
                  <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]" />
                  <div className="flex items-start justify-between">
                    <IconChip name={platform.icon as IconName} large />
                    <Badge variant="mint">v{platform.version}</Badge>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h2 className="text-[1.55rem] font-bold leading-tight tracking-[-0.03em] text-white">
                      {platform.platform}
                    </h2>
                    <span className="font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.06em] text-white/35">
                      {platform.requirement} · {platform.size}
                    </span>
                  </div>

                  <p className="body-copy">{platform.note}</p>

                  <Button asChild size="lg" className="w-fit">
                    <a href={platform.href}>
                      <DownloadIcon size={14} strokeWidth={1.5} />
                      {platform.file}
                    </a>
                  </Button>

                  <div className="mt-auto flex flex-col gap-2 pt-4">
                    {platform.steps.map((step, stepIndex) => (
                      <div key={step} className="flex items-start gap-3">
                        <span className="mt-px font-[family-name:var(--font-code)] text-[0.7rem] text-white/25">
                          0{stepIndex + 1}
                        </span>
                        <span className="body-copy text-[0.82rem]">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </Section>

      <Section background="#0d0d0d" pattern="grid" inner="max-w-[880px]">
        <ScrollReveal>
          <div className="mb-10 flex flex-col gap-4">
            <Eyebrow>Before you install</Eyebrow>
            <h2 className="h2-md text-white">
              Two things worth <span className="soft">knowing up front.</span>
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid gap-3 md:grid-cols-2">
          <ScrollReveal className="h-full">
            <TiltCard tilt={5} className="h-full">
              <div className="flex h-full flex-col gap-3 p-7">
                <Icon name="Monitor" className="text-white/45" size={20} />
                <h3 className="h3-card text-white">The installer is large</h3>
                <p className="body-copy text-[0.85rem]">
                  Around 208 MB, because the speech model ships inside it. That is the trade for working
                  with no network and no account — nothing gets fetched later.
                </p>
              </div>
            </TiltCard>
          </ScrollReveal>

          <ScrollReveal delay={80} className="h-full">
            <TiltCard tilt={5} className="h-full">
              <div className="flex h-full flex-col gap-3 p-7">
                <Icon name="Smartphone" className="text-white/45" size={20} />
                <h3 className="h3-card text-white">Android will warn you</h3>
                <p className="body-copy text-[0.85rem]">
                  The APK is signed with the debug key so existing installs keep updating in place. It is
                  a sideload, and Android says so — that warning is expected.
                </p>
              </div>
            </TiltCard>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={160}>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-6">
            <span className="font-[family-name:var(--font-code)] text-[0.72rem] tracking-[0.08em] text-white/25">
              WINDOWS {SITE.windowsVersion} · ANDROID {SITE.androidVersion}
            </span>
            <Button asChild variant="ghost">
              <a href={`${SITE.repo}/releases`} target="_blank" rel="noreferrer">
                All releases and changelogs
              </a>
            </Button>
          </div>
        </ScrollReveal>
      </Section>
    </>
  )
}
