import { Menu, X } from "lucide-react"
import * as React from "react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const LINKS = [
  { to: "/features", label: "Features" },
  { to: "/platforms", label: "Platforms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/faq", label: "FAQ" },
]

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[0.95rem] font-bold tracking-[-0.03em]", className)}>
      <span className="text-white">Cold</span>
      <span className="font-normal text-white/[0.38]">Voice</span>
    </span>
  )
}

export function Navbar() {
  const [open, setOpen] = React.useState(false)
  const { pathname } = useLocation()

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-100 border-b border-white/[0.06] bg-[rgba(8,8,8,0.82)] backdrop-blur-[16px] backdrop-saturate-[1.2]">
        <nav className="mx-auto flex h-13 w-full max-w-[1200px] items-center justify-between px-6 md:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="ColdVoice home">
            <Mark />
            <Wordmark />
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "group relative text-[0.86rem] font-medium transition-colors duration-150",
                    isActive ? "text-white" : "text-white/[0.48] hover:text-white/80"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {link.label}
                    <span
                      className={cn(
                        "absolute -bottom-1.5 left-0 h-[1.5px] w-full origin-left bg-white transition-transform duration-200",
                        isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                      )}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button asChild size="default" className="hidden h-8 px-3.5 text-[0.78rem] sm:inline-flex">
              <Link to="/download">Download</Link>
            </Button>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-label={open ? "Close menu" : "Open menu"}
              className="flex size-8 items-center justify-center text-white/70 transition-colors hover:text-white md:hidden"
            >
              {open ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
            </button>
          </div>
        </nav>
      </header>

      {open ? (
        <div className="fixed inset-0 top-13 z-99 flex flex-col gap-2 bg-[#080808] px-8 pt-12 md:hidden">
          {[{ to: "/", label: "Home" }, ...LINKS, { to: "/download", label: "Download" }].map(
            (link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                style={{ transitionDelay: `${index * 34}ms` }}
                className={({ isActive }) =>
                  cn(
                    "py-2 text-[1.35rem] font-bold tracking-[-0.03em] transition-colors",
                    isActive ? "text-white" : "text-white/45"
                  )
                }
              >
                {link.label}
              </NavLink>
            )
          )}
          <span className="eyebrow mt-auto pb-10">ColdVoice · Talk. It types.</span>
        </div>
      ) : null}

      <div className="h-13" />
    </>
  )
}

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18.4 5.6A9 9 0 1 0 20.5 15"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="8" y="10" width="1.6" height="4" rx="0.8" fill="#35d39b" />
      <rect x="11.2" y="7.5" width="1.6" height="9" rx="0.8" fill="#ffffff" />
      <rect x="14.4" y="10" width="1.6" height="4" rx="0.8" fill="rgba(255,255,255,0.6)" />
    </svg>
  )
}
