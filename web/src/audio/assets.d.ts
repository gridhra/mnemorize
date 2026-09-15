// Vite の `?url` / `?raw` 付き読み込みの型（AudioWorklet の中身を取り込むのに使う）。
declare module '*?url' {
  const url: string
  export default url
}

declare module '*?raw' {
  const source: string
  export default source
}
