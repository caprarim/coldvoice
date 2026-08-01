import { Icon } from "@/components/site/icon"
import { Button } from "@/components/ui/button"
import { DOWNLOADS } from "@/lib/content"
import { cn } from "@/lib/utils"

export function DownloadButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button asChild size="lg">
        <a href={DOWNLOADS.windows.href}>
          <Icon name="Monitor" size={14} />
          Download for Windows
          <span className="font-[family-name:var(--font-code)] text-[0.7rem] font-normal opacity-45">
            .exe
          </span>
        </a>
      </Button>
      <Button asChild size="lg" variant="secondary">
        <a href={DOWNLOADS.linux.href}>
          <Icon name="Monitor" size={14} />
          Download for Linux
          <span className="font-[family-name:var(--font-code)] text-[0.7rem] font-normal opacity-45">
            .deb
          </span>
        </a>
      </Button>
      <Button asChild size="lg" variant="secondary">
        <a href={DOWNLOADS.android.href}>
          <Icon name="Smartphone" size={14} />
          Download for Android
          <span className="font-[family-name:var(--font-code)] text-[0.7rem] font-normal opacity-45">
            .apk
          </span>
        </a>
      </Button>
    </div>
  )
}

export function PlatformChips({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 font-[family-name:var(--font-code)] text-[0.7rem] tracking-[0.14em] text-white/25",
        className
      )}
    >
      <span>WINDOWS 10/11</span>
      <span className="h-3 w-px bg-white/10" />
      <span>UBUNTU 22.04+</span>
      <span className="h-3 w-px bg-white/10" />
      <span>ANDROID 8+</span>
      <span className="h-3 w-px bg-white/10" />
      <span>FREE · NO ACCOUNT</span>
    </div>
  )
}
