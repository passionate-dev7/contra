import path from "node:path";
import type { NextConfig } from "next";

// packages/short and packages/exec are raw TypeScript workspace packages that
// import sibling modules with a ".js" specifier (correct under "moduleResolution":
// "bundler"/tsx, since it resolves against the eventual .ts file) but webpack's
// default resolver takes the extension literally. transpilePackages pulls them
// through Next's own TS/babel loader; extensionAlias tells webpack ".js" here
// also means ".ts".
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@contra/short", "@fineprint/exec"],
  // klend-sdk pulls in kliquidity-sdk's Orca wasm bindings; webpack can't bundle
  // that .wasm into a server chunk cleanly, so these run as plain Node requires
  // instead of being bundled at all.
  serverExternalPackages: ["@kamino-finance/klend-sdk", "@kamino-finance/kliquidity-sdk", "@kamino-finance/farms-sdk"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
