// AudioWorkletProcessor: メインスレッドとは別のオーディオレンダリングスレッドで動く。
// 128サンプル単位（Web Audio の標準ブロックサイズ）で process() が呼ばれるので、
// そのつど Float32Array のコピーをメインスレッドへ postMessage で送る。
// ここでは録音データの加工はせず、素通しでメインスレッドに渡すだけにしている
// （リサンプリングや Int16 変換はメインスレッド側でまとめて行う設計）。
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0]; // モノラル前提で ch0 のみ使う
      if (channelData && channelData.length > 0) {
        // process() が使い回すバッファをそのまま転送すると次回呼び出しで
        // 上書きされてしまうため、必ず slice() でコピーしてから送る。
        const copy = channelData.slice();
        this.port.postMessage(copy, [copy.buffer]);
      }
    }
    // true を返し続けることでプロセッサを生かしておく。
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
