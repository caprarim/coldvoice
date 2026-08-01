import { Github } from "lucide-react"
import { Link } from "react-router-dom"

import { Mark, Wordmark } from "@/components/site/navbar"
import { Separator } from "@/components/ui/separator"
import { SITE } from "@/lib/content"

const COLUMNS = [
  {
    title: "Product",
    links: [
      { to: "/features", label: "Features" },
      { to: "/platforms", label: "Platforms" },
      { to: "/download", label: "Download" },
    ],
  },
  {
    title: "More",
    links: [
      { to: "/privacy", label: "Privacy" },
      { to: "/faq", label: "FAQ" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#0c0c0c] px-6 pb-7 pt-12 md:px-8">
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="grid gap-9 pb-9 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:gap-12">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <Mark />
              <Wordmark />
            </div>
            <p className="body-copy max-w-[42ch]">
              Built because typing the same paragraph twice is a waste of a morning. ColdVoice keeps the
              transcription on your own machine and out of everyone else's.
            </p>
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-2 border border-white/[0.09] bg-white/[0.03] px-3 py-[7px] text-[0.78rem] text-white/60 transition-colors hover:border-white/20 hover:text-white"
            >
              <Github size={14} strokeWidth={1.5} className="opacity-70" />
              GitHub
            </a>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <span className="eyebrow">{column.title}</span>
                {column.links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="text-[0.85rem] text-white/[0.45] transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2 pt-6 font-[family-name:var(--font-code)] text-[0.7rem] tracking-[0.06em] text-white/20 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ColdVoice</span>
          <span>
            Windows {SITE.windowsVersion} · Android {SITE.androidVersion}
          </span>
        </div>
      </div>
    </footer>
  )
}
