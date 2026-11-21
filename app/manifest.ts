import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iDIABA Gestion",
    short_name: "iDIABA",
    description: "Gestion commerciale, caisse, stocks, achats et comptabilité.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f7faf7",
    theme_color: "#176b43",
    lang: "fr",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
