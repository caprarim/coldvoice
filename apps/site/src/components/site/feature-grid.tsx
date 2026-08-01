import { IconChip, type IconName } from "@/components/site/icon"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { TiltCard } from "@/components/site/tilt-card"
import { Badge } from "@/components/ui/badge"
import { FEATURES } from "@/lib/content"
import { cn } from "@/lib/utils"

const SPANS: Record<string, string> = {
  wide: "lg:col-span-2",
  tall: "lg:row-span-2",
  normal: "",
}

export function FeatureGrid({ limit }: { limit?: number }) {
  const items = limit ? FEATURES.slice(0, limit) : FEATURES

  return (
    <div className="grid auto-rows-[minmax(220px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((feature, index) => (
        <ScrollReveal
          key={feature.title}
          delay={(index % 3) * 80}
          className={cn("h-full", SPANS[feature.span])}
        >
          <TiltCard tilt={6} className="h-full">
            <div className="flex h-full flex-col gap-5 p-8">
              <Badge>{feature.platform}</Badge>
              <IconChip name={feature.icon as IconName} />
              <h3 className="h3-card text-white">{feature.title}</h3>
              <p className="body-copy">{feature.body}</p>
            </div>
          </TiltCard>
        </ScrollReveal>
      ))}
    </div>
  )
}
