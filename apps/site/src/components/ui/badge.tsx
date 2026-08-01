import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1.5 font-[family-name:var(--font-code)] leading-none whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "rounded-[5px] border border-white/[0.09] bg-white/5 px-2 py-[3px] text-[0.6rem] font-medium tracking-[0.06em] text-white/[0.38]",
        tag: "rounded-[4px] border border-white/[0.12] bg-white/5 px-[9px] py-[3px] text-[0.65rem] tracking-[0.08em] text-white/60",
        mark: "rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.7rem] tracking-[0.06em] text-white/40",
        mint: "rounded-[5px] border border-[#35d39b]/[0.28] bg-[#35d39b]/[0.06] px-2.5 py-1 text-[0.65rem] tracking-[0.08em] text-[#35d39b]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
