import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  generateEtags: false,
  async headers() {
    return [
      {
        // Prevent the browser from caching pages/HTML so a normal refresh
        // (F5) always fetches the latest build instead of a stale copy.
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
