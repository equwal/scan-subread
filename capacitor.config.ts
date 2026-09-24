import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the Vite build in `dist/` for the Android app.
const config: CapacitorConfig = {
  appId: 'com.equwal.scansubread',
  appName: 'Scan SubRead',
  webDir: 'dist',
};

export default config;
