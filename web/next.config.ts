import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep legacy bookmarks/links working: the old static entry page maps to
  // the new homepage. The legacy site itself is not removed.
  async redirects() {
    return [{ source: "/index.html", destination: "/", permanent: false }];
  }
};

export default nextConfig;
