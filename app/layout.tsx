import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iDIABA | Gestion commerciale",
  description: "Gestion commerciale, caisse, stock, achats et comptabilité.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
