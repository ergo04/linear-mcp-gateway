import { HeroSection } from "@/components/sections/hero"
import { WhySection } from "@/components/sections/why"
import { SetupSection } from "@/components/sections/setup"
import { CreditsSection } from "@/components/sections/credits"

export default function Page() {
  return (
    <>
      <HeroSection />
      <WhySection />
      <SetupSection />
      <CreditsSection />
    </>
  )
}
