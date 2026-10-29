import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'Sowveil Studio — Mobile Motion Design & Editor Gateway',
          short_name: 'Sowveil',
          description:
            'Mobile-first motion-design platform and mobile editor export gateway for Android, CapCut, Alight Motion, Node Video, and KineMaster with live procedural previews and Project Library.',
          theme_color: '#080707',
          background_color: '#080707',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/admin/, /^\/technical/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Cache ONLY explicitly unauthenticated, public published-catalog GET requests.
              // Strictly reject any request with an Authorization header.
              // Strictly require visibility to be absent or explicitly 'published'.
              // Reject all visibility=all, draft, archived, and admin requests.
              urlPattern: ({ url, request }) => {
                if (request.method !== 'GET') return false;
                if (url.pathname !== '/api/v1/catalog') return false;
                // Exclude any authenticated requests
                if (request.headers && request.headers.has('authorization')) return false;
                // Exclude any draft, archived, or all requests
                const visibility = url.searchParams.get('visibility');
                if (visibility && visibility !== 'published') return false;
                if (url.searchParams.has('includeDrafts')) return false;
                return true;
              },
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'sowveil-public-catalog-v2',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 10, // 10 minutes
                },
                cacheableResponse: {
                  statuses: [200],
                },
              },
            },
          ],
          cleanupOutdatedCaches: true,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio environment.
      hmr: false,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

