# ポータブル実行用バイナリ

このフォルダには、ConvertBoxが使用する外部バイナリを配置します。PC本体にインストールせず、アプリ内から参照することでポータブル動作を実現します。

現在は、Video / Audio の解析と変換、および動画からの音声抽出に使用する `ffmpeg.exe` と `ffprobe.exe` を同梱しています。

両方とも Gyan Doshi の **FFmpeg 9.0.2 essentials build** に統一しています。
取得元・アーカイブと実行ファイルのSHA-256は `ffmpeg-runtime.json` に記録しています。
ビルド前には `npm run check:runtime` が一致を確認し、古い・異なる実行ファイルの混入を防ぎます。
新しい開発環境では、同JSONの `archiveUrl` からアーカイブを取得してSHA-256を照合し、
`bin/ffmpeg.exe` と `bin/ffprobe.exe` をこのフォルダへ配置してください。

これらはこのフォルダ内からのみ実行され、PC本体へのインストールや環境変数の変更は行いません。

Image変換はプロジェクト内の画像処理ライブラリを使用し、同様にPC本体へのグローバルインストールは行いません。

同梱バイナリを再配布する前に、必ずルートの `THIRD_PARTY_NOTICES.md` を確認してください。
