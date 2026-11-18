import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Server-only secrets that must not be embedded in the client bundle.
// These are set with VITE_ prefix in the Netlify environment but are only
// used by server-side code (Supabase Edge Functions / Netlify Functions).
// Deleting them from process.env before Vite collects them prevents
// their values from leaking into the built JavaScript.
const serverOnlyEnvVars = [
  'VITE_SENDGRID_API_KEY',
  'VITE_SMS_API_KEY',
  'VITE_MPESA_CONSUMER_KEY',
  'VITE_MPESA_CONSUMER_SECRET',
  'VITE_MPESA_PASSKEY',
  'VITE_REDIS_URL',
  'VITE_REDIS_TOKEN',
];

for (const key of serverOnlyEnvVars) {
  delete process.env[key];
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    watch: {
      // The bundled Flutter app contains tens of thousands of generated files
      // (windows/flutter/ephemeral/.plugin_symlinks/...). Watching them exhausts
      // the OS inotify watch limit and crashes Vite with ENOSPC. They are not
      // part of the web app, so exclude them from the file watcher.
      // Vite merges these with its own defaults (.git, node_modules, dist, etc.).
      ignored: [
        "**/flt_app/**",
        "**/graphify-out/**",
      ],
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Raise the chunk size warning threshold (heavy libs like recharts are expected to be large)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunk splitting to avoid one giant vendor bundle.
        // Heavy, infrequently-changing libraries get their own cached chunk.
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // UI component library
          'radix-ui': [
            '@radix-ui/react-accordion', '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar', '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label', '@radix-ui/react-popover',
            '@radix-ui/react-select', '@radix-ui/react-tabs',
            '@radix-ui/react-toast', '@radix-ui/react-tooltip',
            '@radix-ui/react-slot',
          ],
          // Data fetching
          'query': ['@tanstack/react-query'],
          // Supabase
          'supabase': ['@supabase/supabase-js'],
          // Charts (recharts is large)
          'charts': ['recharts'],
          // Form utilities
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // Date utilities
          'dates': ['date-fns', 'react-day-picker', 'react-datepicker'],
          // Icon library
          'icons': ['lucide-react'],
        },
      },
    },
  },
}));
