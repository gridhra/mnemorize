// AudioWorkletProcessor：オーディオレンダリングスレッドで動く。
// 128 サンプル単位で process() が呼ばれるので、そのつど Float32Array のコピーを
// メインスレッドへ postMessage で送る（リサンプリングと Int16 変換はメインスレッド側でまとめて行う）。
// 検証コード spikes/recorder/public/recorder-worklet.js をそのまま土台にしている。
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input.length > 0) {
      const channelData = input[0] // モノラル前提で ch0 のみ使う
      if (channelData && channelData.length > 0) {
        // process() が使い回すバッファをそのまま渡すと次回の呼び出しで上書きされるため、
        // 必ず slice() でコピーしてから送る。
        const copy = channelData.slice()
        this.port.postMessage(copy, [copy.buffer])
      }
    }
    // true を返し続けてプロセッサを生かしておく。
    return true
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
