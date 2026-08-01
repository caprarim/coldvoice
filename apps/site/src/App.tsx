import * as React from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import { Footer } from "@/components/site/footer"
import { Navbar } from "@/components/site/navbar"
import Download from "@/pages/download"
import Faq from "@/pages/faq"
import Features from "@/pages/features"
import Home from "@/pages/home"
import Platforms from "@/pages/platforms"
import Privacy from "@/pages/privacy"

function ScrollToTop() {
  const { pathname } = useLocation()

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [pathname])

  return null
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Navbar />
      <main className="w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/platforms" element={<Platforms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/download" element={<Download />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}

export default App
