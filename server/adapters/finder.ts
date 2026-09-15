// Finder で開く（設定画面「Finder で開く」ボタン）。ローカル専用アプリなので `open` の
// サブプロセス呼び出しを許容するが、任意のパスを渡されると外部ファイルを開けてしまうため、
// データ置き場（MNEMORIZE_DATA_DIR）配下のパスだけを許可する。
import { resolve, sep } from 'node:path'
import { dataDir } from '../db/connection.ts'
import { ValidationError } from '../services/entries.ts'

/**
 * 指定パスがデータ置き場配下かどうかを検証し、正規化した絶対パスを返す。
 * 配下でなければ ValidationError（`open` を実行する前に必ず呼ぶ）。
 * `open` を起動しないので、ユニットテストはこの関数だけを対象にできる。
 */
export function assertWithinDataDir(path: string): string {
  const dir = resolve(dataDir())
  const target = resolve(path)
  if (target !== dir && !target.startsWith(dir + sep)) {
    throw new ValidationError('データ置き場の外のパスは開けません')
  }
  return target
}

/** Finder でファイル・フォルダを選択した状態で開く（`open -R`）。 */
export async function openInFinder(path: string): Promise<void> {
  const target = assertWithinDataDir(path)
  const proc = Bun.spawn(['open', '-R', target], { stdout: 'ignore', stderr: 'ignore' })
  await proc.exited
  if (proc.exitCode !== 0) {
    throw new ValidationError('Finder を開けませんでした')
  }
}
