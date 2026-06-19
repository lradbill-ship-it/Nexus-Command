/// <reference types="vite/client" />

// Inlined image assets (base64 data URI) for the single-file build.
declare module '*.jpg?inline' {
  const url: string;
  export default url;
}
declare module '*.png?inline' {
  const url: string;
  export default url;
}
