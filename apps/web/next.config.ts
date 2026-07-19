import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV !== "production",
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  reloadOnOnline: false,
  swDest: "public/sw.js",
  swSrc: "src/app/sw.ts",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@common-ground/protocol"],
};

export default withSerwist(nextConfig);
