/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HF_TOKEN: string;
  readonly VITE_REMOVEBG_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
