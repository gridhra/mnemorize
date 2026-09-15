// サービス層が投げる共通のエラー型。
// entries.ts と settings.ts の両方から使われる（settings.ts は entries.ts の boundaryHour に
// 依存しているため、エラー型を entries.ts 側に置くと循環インポートになり、
// settings.ts でエラー型をモジュール読み込み時に extends したときに
// 「初期化前にアクセスした」という参照エラーを起こす。エラー型だけをここに独立させて避ける）。

/** 入力が不正なときに投げる。ルート側が 400 に変換する。 */
export class ValidationError extends Error {}
/** 対象が見つからないときに投げる。ルート側が 404 に変換する。 */
export class NotFoundError extends Error {}
