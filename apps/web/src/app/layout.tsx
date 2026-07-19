import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@excalidraw/excalidraw/index.css";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Common Ground",
  description: "A local-first architecture workbench for engineering teams.",
  manifest: "/manifest.webmanifest",
  title: "Common Ground",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#171918",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
