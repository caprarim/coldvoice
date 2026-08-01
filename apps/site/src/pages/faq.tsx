import { CTA } from "@/components/site/cta"
import { ScrollReveal } from "@/components/site/scroll-reveal"
import { CenteredEyebrow, Section } from "@/components/site/section"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { FAQ } from "@/lib/content"

export default function Faq() {
  return (
    <>
      <Section background="#090909" pattern="grid-tight" className="pb-16 pt-24" inner="max-w-[880px]">
        <div className="flex flex-col items-center gap-5 text-center">
          <ScrollReveal>
            <CenteredEyebrow>Questions</CenteredEyebrow>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <h1 className="h2-display text-white">
              Frequently <span className="soft">asked.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <p className="body-copy max-w-[48ch] text-[0.95rem]">
              Straight answers, including the parts that are not flattering.
            </p>
          </ScrollReveal>
        </div>
      </Section>

      <Section background="#0b0b0b" pattern="grid" className="pb-24 pt-4" inner="max-w-[880px]">
        <ScrollReveal>
          <Accordion type="single" collapsible className="flex flex-col gap-2.5">
            {FAQ.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger>
                  <span className="flex flex-col items-start gap-2.5">
                    <Badge variant="tag">{item.tag}</Badge>
                    {item.q}
                  </span>
                </AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollReveal>
      </Section>

      <CTA />
    </>
  )
}
