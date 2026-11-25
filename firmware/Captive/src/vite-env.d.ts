/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Allow importing markdown files as raw strings
declare module '*.md?raw' {
  const content: string;
  export default content;
}
