import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Playwright is externalized by Next.js and loads its internals dynamically.
  // The default file trace omitted modules in the Vercel batch function.
  outputFileTracingIncludes: {
    '/api/batch/*': ['./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*'],
    '/api/run': ['./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*'],
    '/api/admin/run': ['./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*'],
  },
};

export default nextConfig;
