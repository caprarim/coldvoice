import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { Plus } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        "card-surface spotlight relative overflow-hidden rounded-xl transition-[border-color] duration-200 hover:border-white/[0.16]",
        className
      )}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group relative z-1 flex flex-1 items-center justify-between gap-6 px-6 py-5 text-left text-[0.98rem] font-semibold tracking-[-0.02em] text-white outline-none transition-colors focus-visible:text-white/70",
          className
        )}
        {...props}
      >
        {children}
        <Plus
          strokeWidth={1.5}
          className="size-4 shrink-0 text-white/35 transition-transform duration-200 group-data-[state=open]:rotate-45"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="relative z-1 overflow-hidden data-[state=closed]:animate-[accordion-up_0.2s_ease] data-[state=open]:animate-[accordion-down_0.2s_ease]"
      {...props}
    >
      <div className={cn("body-copy px-6 pb-6 pr-12", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
