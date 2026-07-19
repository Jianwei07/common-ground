import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Common Ground",
    short_name: "Ground",
    description: "Design systems together in a local-first architecture workbench.",
    start_url: "/workspace",
    display: "standalone",
    background_color: "#171918",
    theme_color: "#171918",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
