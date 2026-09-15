// 初回セットアップの案内に使う状態表示。
import { Hono } from 'hono'
import { dataDir, dbPath } from '../db/connection.ts'
import { getSettings } from '../services/settings.ts'
import { resolveModelStatus } from '../adapters/asr-whisper-cli.ts'
import { localDate, now as clockNow, toLocalIso } from '../adapters/clock.ts'

const app = new Hono()

/** whisper-cli が PATH にあるか。外部コマンドを呼ぶのでアダプタ相当の処理だが、参照のみ。 */
async function whichWhisperCli(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['which', 'whisper-cli'], { stdout: 'pipe', stderr: 'ignore' })
    const out = (await new Response(proc.stdout).text()).trim()
    await proc.exited
    return proc.exitCode === 0 && out.length > 0 ? out : null
  } catch {
    return null
  }
}

app.get('/', async (c) => {
  const settings = getSettings()
  const modelPath = settings.whisper_model_path
  const cli = await whichWhisperCli()
  const modelStatus = await resolveModelStatus(modelPath)
  const now = clockNow() // MNEMORIZE_FAKE_NOW での検証時に「今日」を復習側と揃える
  return c.json({
    ok: true,
    data_dir: dataDir(),
    db_path: dbPath(),
    whisper_cli: cli,
    whisper_cli_found: cli !== null,
    whisper_model_path: modelPath,
    whisper_model_configured: modelPath.length > 0,
    // 設定のパスが無くても、保険の候補が見つかれば文字起こしは動く。そちらも「ある」として扱う。
    whisper_model_exists: modelStatus.effectivePath !== null,
    whisper_model_effective_path: modelStatus.effectivePath,
    whisper_model_used_fallback: modelStatus.usedFallback,
    boundary_hour: settings.boundary_hour,
    today: localDate(now, settings.boundary_hour),
    now: toLocalIso(now),
  })
})

export default app
