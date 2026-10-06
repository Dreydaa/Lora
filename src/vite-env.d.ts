/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_DASHBOARD_API_KEY: string;
  readonly WEATHER_LAT?: string;
  readonly WEATHER_LON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
