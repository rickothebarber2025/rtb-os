import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/jspdf/') || id.includes('/fflate/') || id.includes('/fast-png/') || id.includes('/@babel/runtime/')) return 'jspdf';
          if (id.includes('html2canvas')) return 'html2canvas';
          if (id.includes('dompurify')) return 'dompurify';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@capacitor')) return 'capacitor';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react')) return 'react-vendor';
          return 'vendor';
        },
      },
    },
  },
  server: {
    allowedHosts: ['.loca.lt'],
  },
  preview: {
    allowedHosts: ['.loca.lt'],
  },
});
