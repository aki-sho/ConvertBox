# ConvertBox

> 最新バージョン: 1.4.0（2026-11-01）。一括変換・品質プリセット・画像のサイズと向き・中止と再実行に対応しました。

ConvertBox は、Windows向けのインストール不要・ポータブルEXE版ファイル変換アプリです。

動画・音声・画像ファイルを別形式へ変換できます。変換処理はアプリ内に同梱したエンジンで実行し、PC本体へFFmpegなどをグローバルインストールすることを前提にしません。

## Version 1.4.0

最大100件のファイルをまとめて選び、順番に変換できます。ドラッグ＆ドロップと保存先の一括指定に対応し、同名ファイルは連番で保存します。

- 品質・容量プリセット: 高画質・高音質／標準／容量優先。動画の圧縮品質、音声ビットレート、JPG・WebPの品質やGIFの色数を調整します。PNG・SVG・WAVの画質・音質は劣化させません。
- 画像の最大幅・最大高さ、90・180・270度回転、EXIFの自動向き補正。縦横比を維持して縮小し、拡大はしません。GIFアニメーションの回転でもフレームと表示時間を保ちます。
- 実行中・待機中の項目を個別またはまとめて中止。完了・失敗・中止した項目は、そのカテゴリで設定を変更して再実行できます。
- 設定はキューへ追加した時点で保持します。処理中に画面の設定を変えても、登録済みの項目は変わりません。

ファイル削除・IPC・画面の隔離・異常ファイル対策は維持しています。FFmpeg / ffprobeはSHA-256を検証した9.0.2です。

HEIC / HEIF画像を読み込み、JPGやPNGなどへ変換できます。追加コーデックのインストールは不要で、オフラインで利用できます。

- Video: MP4 / MOV / WebM / AVI
- 動画 → 音声: MP4 / MOV / WebM / AVI から MP3 / WAV / M4A / AAC / WebM
- Audio: MP3 / WAV / M4A / AAC / WebM
- Image入力: JPG / PNG / JPEG / GIF / WebP / SVG / HEIC / HEIF
- Image出力: JPG / PNG / JPEG / GIF / WebP / SVG

HEIC / HEIFはImageカテゴリでファイルを選択して変換できます。複数の画像を含むHEIC / HEIFは先頭の1枚を変換します。

音声のWebMファイルを変換する場合は、Audioカテゴリを選んでからファイルを開いてください。WebMへの音声出力はOpus（高音質192／標準128／容量優先64 kbps、48 kHz）で、映像を含みません。動画のWebMはVideoまたは動画 → 音声で扱えます。

ImageのSVG出力は、変換元画像をSVG内へ埋め込んで表示を保つ方式です。写真やラスター画像の輪郭を自動的にベクターデータへ変換する機能ではありません。

## 動作環境

- Windows 10 / 11（64ビット）
- インストール不要
- オフライン動作
- 変換元と保存先を扱える十分な空き容量

## 使い方

配布用ZIPは `ConvertBox-Portable-1.4.0.zip` です。開発者は下記のビルド手順で生成できます。公開済みの配布版はGitHub Releasesから取得できます。

1. ZIPを展開します。
2. 作成された `ConvertBox-Portable-1.4.0` フォルダを、書き込み可能な場所へ置きます。
3. フォルダ内の `ConvertBox-Portable-1.4.0.exe` をダブルクリックします。
4. Video / 動画 → 音声 / Audio / Image のカテゴリを選びます。
5. 変換元ファイルを複数選択するか、ドロップ領域へ追加します。1つのカテゴリでまとめて処理します。
6. 変換先形式と品質プリセットを選びます。Imageでは最大サイズ・回転・向き補正も指定できます。この時点では変換は始まりません。
7. 複数件では `一括保存先を選択` で保存フォルダを指定します。
8. `キューへ追加して変換` を押します。項目ごとの状態と進捗を確認でき、失敗した項目があっても次の項目へ進みます。
9. 保存先を指定した場合は自動保存します。1件だけで保存先未指定の場合は、完了後の `保存` または `ダウンロード` から保存先を選びます。
10. 必要に応じて項目の `中止` または `現在の設定で再実行` を使います。全体の中止では、実行中と待機中の項目をまとめて止めます。

一括保存先の同名ファイルと元ファイルは上書きしません。`name_converted (1).ext` のように連番を付けます。保存済み・失敗・中止の項目をクリアするとキューに空きができます。未保存の結果はクリアされません。

単体EXE版を利用する場合は、利用者自身で書き込み可能な専用フォルダを作成し、その中へEXEを置いてください。

Windowsの警告が表示される場合があります。現在の配布EXEにはコード署名証明書による署名を行っていません。配布元とSHA-256チェックサムを確認してから実行してください。

## ポータブル方針

BAT起動とインストーラーは使用しません。配布時は単体のポータブルEXE、または専用フォルダ入りZIPを使います。

実行時に作成される設定、データ、ログ、キャッシュ、一時変換ファイルは、EXEと同じフォルダ内の次の場所へ保存します。

```text
ConvertBox-PortableData/
├─ settings/
├─ data/
├─ logs/
├─ cache/
└─ temp/
   └─ working/
```

`temp/working/` は変換中の一時ファイル置き場です。アプリ終了時に可能な限り削除します。

EXEと同じ場所へデータを書き込むため、`Program Files` など一般ユーザーが書き込めないフォルダには置かないでください。

## 終了時の処理

画像の解析・変換も専用の子プロセスで実行し、終了時に停止します。

アプリ終了時には、変換中のFFmpeg子プロセスの停止を待ってから一時変換ファイルを削除します。削除に失敗してもログに記録し、アプリ自体は終了します。終了処理には5秒の上限を設けています。ポータブルEXEはその後に展開先の後片付けを行うため、削除する際は起動用プロセスの終了まで数秒お待ちください。ローカルサーバーは使用していません。

同じポータブルフォルダからの二重起動は防止します。すでに起動している状態でもう一度EXEを実行すると、既存のConvertBoxウィンドウを前面に表示します。

## 開発環境での起動

開発時のみNode.jsとnpmを使用します。ユーザー配布用EXEの実行には不要です。

```powershell
npm install
npm start
```

## 正式版ポータブル成果物の作成

```powershell
npm install
npm run release:portable
```

作成後の `dist/` には、単体EXE、専用フォルダ入りZIP、それぞれのSHA-256チェックサムだけが出力されます。

```text
dist/ConvertBox-Portable-1.4.0.exe
dist/ConvertBox-Portable-1.4.0.exe.sha256
dist/ConvertBox-Portable-1.4.0.zip
dist/ConvertBox-Portable-1.4.0.zip.sha256
```

ZIPを展開すると、次の構成になります。

```text
ConvertBox-Portable-1.4.0/
├─ ConvertBox-Portable-1.4.0.exe
└─ README.txt
```

## GitHubへ登録する時の考え方

GitHubへ登録する場合は、ソースコード、README、ライセンス注意、同梱バイナリの説明を管理対象にします。

登録しないもの:

- `node_modules/`
- `dist/`
- `.tmp/`
- `.cache/`
- `ConvertBox-PortableData/`
- `portable/working/`
- `portable/bin/*.exe`

`portable/bin/*.exe` は第三者バイナリのため、誤ってGitへ登録しないよう除外しています。ローカルビルドでは手元のファイルを使用できますが、GitHub Actionsなど別環境でビルドする場合は、出所とライセンス要件を確認したバイナリを別途準備する必要があります。

`dist/` のEXE、ZIP、チェックサムは通常コミットへ含めません。GitHub Releasesの成果物として添付する想定ですが、現在のEXEとZIPにはGPL有効のFFmpegが含まれています。対応する正確なソースコードとビルド情報を同時に提供できる状態になるまで、公開Releaseへ添付しないでください。

ローカルGitリポジトリは初期化済みで、既定ブランチは `main` です。リモートリポジトリの登録、コミット、GitHubへの送信は行っていません。

## 主なフォルダ構成

```text
ConvertBox/
├─ package.json
├─ README.md
├─ CHANGELOG.md
├─ THIRD_PARTY_NOTICES.md
├─ build/
│  ├─ icon-source.png
│  ├─ icon.png
│  └─ icon.ico
├─ src/
│  ├─ main/
│  │  ├─ main.js
│  │  ├─ preload.js
│  │  └─ portablePaths.js
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ app.js
│  │  ├─ style.css
│  │  └─ icon.png
│  ├─ shared/
│  │  └─ formats.js
│  └─ converter/
│     ├─ converterService.js
│     └─ imageConverterService.js
├─ portable/
│  └─ bin/
│     ├─ ffmpeg.exe
│     ├─ ffprobe.exe
│     └─ README.md
└─ scripts/
```

## 同梱バイナリについて

`portable/bin/` には動画・音声解析と変換に使う `ffmpeg.exe` と `ffprobe.exe` を配置しています。PC本体へのインストールや環境変数の変更は行いません。

画像変換には `sharp` を使用し、HEIC / HEIFの読み込みには `heic-decode` と `libheif-js` のWebAssemblyデコーダーを同梱します。これらもプロジェクト内の依存関係として扱い、PC本体へグローバルインストールしません。

公開配布前に、必ず [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を確認してください。同梱中のFFmpegはGPL有効ビルドであり、対応する正確なソースコードとビルド情報を用意しないまま、FFmpegバイナリまたはそれを含むポータブルEXEを公開しないでください。

## 安全のための処理上限

- 動画・音声入力: 20 GiBまで。解析は30秒、変換は2時間まで。
- 変換出力: 10 GiBまで。上限到達時は変換失敗として扱います。
- 画像入力: 100 MiB、合計4000万画素、200ページまで。画像処理は60秒まで。
- HEIC / HEIFデコード: 30秒まで。画素数をデコード前に検証します。
- アプリの解析・変換は同時に1件、キューは100件まで。変換済みの未保存ファイルは1件まで。一括保存では各項目を保存してから次の処理へ進みます。

上限を超えたファイルはエラーを表示して処理を停止します。設定値は `src/converter/resourceLimits.js` にまとめています。
FFmpeg / ffprobeの通信プロトコルとコンテナ形式も制限しています。

## 確認用コマンド

```powershell
npm run check
npm run check:security
npm run check:runtime
npm run check:features
npm run check:video
npm run check:video-to-audio
npm run check:shutdown
npm run check:audio
npm run check:image
```

Windows上で配布EXEを作成した後は、次のコマンドで移動先での起動・通常終了・変換中の終了・一時ファイルのロック中の終了を検証できます。テスト用にコピーしたEXEだけを起動・削除します。

```powershell
npm run check:portable-shutdown
npm run check:desktop
npm run check:feature-desktop
```

## GitHub公開前チェック

1. `package.json` と画面のバージョンが `1.4.0` であることを確認する。
2. 上記の確認用コマンドをすべて実行する。
3. `npm run release:portable` でEXE、ZIP、両方のチェックサムを作成する。
4. ZIP内のREADMEとフォルダ構成を確認する。
5. EXEを起動し、Video / 動画 → 音声 / Audio / Image の選択、変換、保存、終了を確認する。
6. EXE終了後に `ConvertBox`、`ffmpeg`、`ffprobe` のプロセスが残っていないことを確認する。
7. FFmpegの対応ソースとライセンス文書をReleaseから取得できる状態にする。
8. ConvertBox本体をオープンソースとして公開する場合は、用途に合うライセンスを追加する。
9. GitHub Releaseへ4つの成果物を添付し、バージョンタグを `v1.4.0` にする。

## 今後の候補

- 変換品質の詳細設定
- 音量調整・ノーマライズ
- 保存したプリセットの再利用
- 変換履歴
- コード署名
