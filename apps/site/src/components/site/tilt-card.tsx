import * as React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type TiltCardProps = React.ComponentProps<"div"> & {
  tilt?: number
}

export function TiltCard({ className, tilt = 6, children, ...props }: TiltCardProps) {
  const ref = React.useRef<HTMLDivElement>(null)

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const card = ref.current
      if (!card) return

      const rect = card.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const cx = rect.width / 2
      const cy = rect.height / 2

      card.style.setProperty("--mouse-x", `${x}px`)
      card.style.setProperty("--mouse-y", `${y}px`)
      card.style.transform = `perspective(900px) rotateX(${((y - cy) / cy) * -tilt}deg) rotateY(${((x - cx) / cx) * tilt}deg) scale(0.97)`
      card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)"
    },
    [tilt]
  )

  const handleMouseLeave = React.useCallback(() => {
    const card = ref.current
    if (!card) return

    card.style.setProperty("--mouse-x", "-100px")
    card.style.setProperty("--mouse-y", "-100px")
    card.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)"
    card.style.boxShadow = ""
  }, [])

  return (
    <Card
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn("spotlight cursor-default transition-transform duration-200", className)}
      {...props}
    >
      <div className="relative z-1 flex h-full flex-col">{children}</div>
    </Card>
  )
}
