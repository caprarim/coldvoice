import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-none text-[0.8rem] font-semibold leading-none tracking-[0.01em] whitespace-nowrap outline-none select-none transition-[transform,background-color,border-color,box-shadow,color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:translate-y-0 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "border border-white bg-white text-[#0a0a0a] shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_4px_14px_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.35)] hover:-translate-y-px hover:border-[#ececec] hover:bg-[#ececec] hover:shadow-[0_8px_20px_rgba(255,255,255,0.1),0_3px_8px_rgba(0,0,0,0.4)]",
        secondary:
          "border border-white/15 bg-white/5 text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:-translate-y-px hover:border-white/25 hover:bg-white/10 hover:text-white",
        mint: "border border-[#35d39b]/30 bg-[#35d39b]/10 text-[#35d39b] hover:-translate-y-px hover:border-[#35d39b]/50 hover:bg-[#35d39b]/15",
        ghost: "border-none bg-transparent text-white/50 shadow-none hover:text-white",
        mono: "border border-white/15 bg-[#d4d4d4] font-[family-name:var(--font-code)] text-[0.85rem] font-semibold uppercase tracking-[0.18em] text-black shadow-[0_0_48px_rgba(200,200,200,0.18),0_6px_24px_rgba(0,0,0,0.45)] hover:border-white/40 hover:bg-[#e0e0e0]",
      },
      size: {
        default: "h-10 px-4",
        lg: "h-12 px-6 text-[0.85rem]",
        xl: "h-[3.25rem] px-[3.25rem] py-[1.125rem]",
        icon: "size-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
