// 開発用：API サーバー（8790）と Vite（5173）を同時に起動する。
// どちらかが落ちたらもう一方も止める。
const procs = [
  Bun.spawn(['bun', 'run', '--hot', 'server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] }),
  Bun.spawn(['bunx', 'vite', '--config', 'web/vite.config.ts'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
]

function stopAll(): void {
  for (const p of procs) {
    try {
      p.kill()
    } catch {
      // すでに終了している
    }
  }
}

process.on('SIGINT', () => {
  stopAll()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopAll()
  process.exit(0)
})

await Promise.race(procs.map((p) => p.exited))
stopAll()
