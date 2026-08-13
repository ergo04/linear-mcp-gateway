import { HeroSection } from "@/components/sections/hero"
import { HowItWorksSection } from "@/components/sections/how-it-works"
import { ArchitectureSection } from "@/components/sections/architecture"
import { ToolsSection } from "@/components/sections/tools"
import { SetupSection } from "@/components/sections/setup"
import { ConfigSection } from "@/components/sections/config"

export default function Page() {
  return (
    <>
      <HeroSection />
      <HowItWorksSection />
      <ArchitectureSection />
      <ToolsSection />
      <SetupSection />
      <ConfigSection />
    </>
  )
}
