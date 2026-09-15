import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dir, "out");
await mkdir(OUT_DIR, { recursive: true });

const app = new Hono();

// --- WAV ヘッダ解析（依存なし、自前実装） ---
// WAV は RIFF コンテナ形式。先頭12バイトが "RIFF" + サイズ + "WAVE"、
// そのあとに "fmt " チャンクと "data" チャンクなどが任意の順で続く。
// whisper.cpp が要求するのは 16kHz・モノラル・16bit PCM のみだが、
// このパーサーはチャンクを順に読み進めることで、他のチャンネル数や
// ビット深度の WAV も含めて汎用的に解析できるようにしている。
interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
  fileSizeBytes: number;
}

class WavParseError extends Error {}

function parseWavHeader(buf: Uint8Array): WavInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (buf.length < 12) {
    throw new WavParseError("ファイルが短すぎて RIFF ヘッダを読めません");
  }

  const riffTag = readAscii(buf, 0, 4);
  const waveTag = readAscii(buf, 8, 4);
  if (riffTag !== "RIFF" || waveTag !== "WAVE") {
    throw new WavParseError(
      `RIFF/WAVE ヘッダが見つかりません（先頭: RIFF="${riffTag}", WAVE="${waveTag}"）`,
    );
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let dataChunkSize: number | null = null;

  while (offset + 8 <= buf.length) {
    const chunkId = readAscii(buf, offset, 4);
    const chunkSize = dv.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt ") {
      if (chunkDataStart + 16 > buf.length) {
        throw new WavParseError("fmt チャンクが不完全です");
      }
      channels = dv.getUint16(chunkDataStart + 2, true);
      sampleRate = dv.getUint32(chunkDataStart + 4, true);
      bitsPerSample = dv.getUint16(chunkDataStart + 14, true);
    } else if (chunkId === "data") {
      dataChunkSize = chunkSize;
    }

    // チャンクは偶数バイト境界に揃えられる（奇数サイズなら1バイトのパディングが入る）
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (sampleRate === null || channels === null || bitsPerSample === null) {
    throw new WavParseError("fmt チャンクが見つかりませんでした");
  }
  if (dataChunkSize === null) {
    throw new WavParseError("data チャンクが見つかりませんでした");
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataChunkSize / (bytesPerSample * channels);
  const durationSeconds = totalSamples / sampleRate;

  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds,
    fileSizeBytes: buf.length,
  };
}

function readAscii(buf: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(buf[start + i] ?? 0);
  }
  return s;
}

// --- ルーティング ---

app.get("/", async (c) => {
  const html = await Bun.file(join(import.meta.dir, "public", "index.html")).text();
  return c.html(html);
});

app.get("/recorder-worklet.js", async (c) => {
  const js = await Bun.file(join(import.meta.dir, "public", "recorder-worklet.js")).text();
  return c.body(js, 200, { "Content-Type": "application/javascript" });
});

app.post("/upload", async (c) => {
  const arrayBuffer = await c.req.arrayBuffer();
  const buf = new Uint8Array(arrayBuffer);

  if (buf.length === 0) {
    return c.json({ error: "空のリクエストボディです" }, 400);
  }

  let info: WavInfo;
  try {
    info = parseWavHeader(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `WAV ヘッダの解析に失敗しました: ${message}` }, 400);
  }

  const filename = `rec-${Date.now()}.wav`;
  const outPath = join(OUT_DIR, filename);
  await Bun.write(outPath, buf);

  return c.json({
    filename,
    sampleRate: info.sampleRate,
    channels: info.channels,
    bitsPerSample: info.bitsPerSample,
    durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
    fileSizeBytes: info.fileSizeBytes,
  });
});

const port = 8787;
console.log(`recorder spike server: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
