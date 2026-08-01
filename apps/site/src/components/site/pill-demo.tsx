import { Check, Pause, X } from "lucide-react"
import * as React from "react"

const BAR_COUNT = 22

const RAW = "hey comma can you open index dot html and fix the next js import um the broken one period"
const CLEAN = "Hey, can you open @index.html and fix the Next.js import — the broken one."

function Waveform() {
  const bars = React.useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, index) => ({
        delay: (index % 7) * 0.09 + index * 0.012,
        duration: 0.7 + ((index * 37) % 9) / 20,
      })),
    []
  )

  return (
    <div className="flex h-6 flex-1 items-center justify-center gap-[3px]">
      {bars.map((bar, index) => (
        <span
          key={index}
          className="w-[2px] rounded-full bg-white/70"
          style={{
            height: "100%",
            animation: `wave ${bar.duration}s ease-in-out ${bar.delay}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

export function PillDemo() {
  const [typed, setTyped] = React.useState(0)

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(CLEAN.length)
      return
    }

    const timer = window.setInterval(() => {
      setTyped((value) => (value >= CLEAN.length ? 0 : value + 1))
    }, 55)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="relative w-full">
      <div
        className="pointer-events-none absolute -inset-8 opacity-70"
        style={{
          background: "radial-gradient(ellipse at center, rgba(53,211,155,0.1) 0%, transparent 70%)",
          animation: "glow-pulse 3s ease infinite",
        }}
      />

      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[linear-gradient(145deg,#121212,#0c0c0c)] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_32px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)]"
        style={{ animation: "float 6s ease-in-out infinite" }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span className="eyebrow">Listening</span>
          </div>
          <span className="font-[family-name:var(--font-code)] text-[0.68rem] tracking-[0.08em] text-white/25">
            LOCAL · BASE.EN
          </span>
        </div>

        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3 rounded-full border border-white/[0.09] bg-[#16181e] px-3 py-2.5">
            <button
              type="button"
              tabIndex={-1}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/40"
              aria-hidden="true"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
            <Waveform />
            <button
              type="button"
              tabIndex={-1}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/40"
              aria-hidden="true"
            >
              <Pause size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#35d39b]/15 text-[#35d39b]"
              aria-hidden="true"
            >
              <Check size={14} strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="eyebrow">Heard</span>
            <p className="font-[family-name:var(--font-code)] text-[0.78rem] leading-relaxed text-white/30">
              {RAW}
            </p>
          </div>

          <div className="h-px w-full bg-white/[0.06]" />

          <div className="flex flex-col gap-2">
            <span className="eyebrow">Inserted</span>
            <p className="min-h-[3.5rem] font-[family-name:var(--font-code)] text-[0.82rem] leading-relaxed text-white">
              {CLEAN.slice(0, typed)}
              <span
                className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[#35d39b]"
                style={{ animation: "caret 1s step-end infinite" }}
              />
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 font-[family-name:var(--font-code)] text-[0.65rem] tracking-[0.08em] text-white/25">
          <span>NO AUDIO LEFT THIS MACHINE</span>
          <span>CTRL + 1</span>
        </div>
      </div>
    </div>
  )
}
