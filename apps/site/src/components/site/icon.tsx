import {
  Activity,
  BellRing,
  BookMarked,
  Bot,
  Braces,
  CornerDownLeft,
  Crosshair,
  Database,
  Eraser,
  Gauge,
  GitBranch,
  HardDrive,
  HeartPulse,
  Keyboard,
  KeyRound,
  ListOrdered,
  Mic,
  Monitor,
  Scissors,
  ShieldOff,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserX,
  WifiOff,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

const ICONS = {
  Activity,
  BellRing,
  BookMarked,
  Bot,
  Braces,
  CornerDownLeft,
  Crosshair,
  Database,
  Eraser,
  Gauge,
  GitBranch,
  HardDrive,
  HeartPulse,
  Keyboard,
  KeyRound,
  ListOrdered,
  Mic,
  Monitor,
  Scissors,
  ShieldOff,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  UserX,
  WifiOff,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  className,
  size = 22,
}: {
  name: IconName
  className?: string
  size?: number
}) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} className={className} />
}

export function IconChip({
  name,
  large = false,
}: {
  name: IconName
  large?: boolean
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.04] text-white/50",
        large ? "size-13 rounded-xl border-white/[0.12] bg-white/[0.05] text-white/65" : "size-12 rounded-[10px]"
      )}
    >
      <Icon name={name} size={large ? 24 : 22} />
    </div>
  )
}
