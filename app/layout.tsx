import type { Metadata, Viewport } from "next";
import PWARegister from "./pwa-register";
import "./globals.css";
import "./universal-commerce.css";

export const metadata: Metadata = {
  title: "iDIABA | Gestion commerciale",
  description: "Gestion commerciale, caisse, stock, achats et comptabilité.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#176b43" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body><PWARegister />{children}</body></html>;
}
