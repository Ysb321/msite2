import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'next/link': path.resolve(__dirname, './src/shims/next-link.tsx'),
        'next/navigation': path.resolve(__dirname, './src/shims/next-navigation.ts'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api/tmdb': {
          target: 'https://api.themoviedb.org/3',
          changeOrigin: true,
          rewrite: (urlPath) => {
            const parsed = new URL('https://dummy' + urlPath);
            const rawEndpoint = urlPath.replace(/^\/api\/tmdb\//, '').split('?')[0];
            const qs = new URLSearchParams(parsed.search);
            if (!qs.has('api_key')) {
              qs.set('api_key', process.env.TMDB_API_KEY || 'f8243ad5d5cd1ef0ebe5d6c5bfcc59f2');
            }
            return `/${rawEndpoint}?${qs.toString()}`;
          },
        },
      },
    },
  };
});
