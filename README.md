# ConvertBox

ConvertBox は、Windows向けのインストール不要・ポータブルEXE版ファイル変換アプリです。

動画・音声・画像ファイルを別形式へ変換できます。変換処理はアプリ内に同梱したエンジンで実行し、PC本体へFFmpegなどをグローバルインストールすることを前提にしません。

## Version 1.0.0

`1.0.0` は、ConvertBoxの最初の正式リリースです。次の変換機能を実装しています。

- Video: MP4 / MOV / WebM / AVI
- Audio: MP3 / WAV / M4A / AAC
- Image: JPG / PNG / JPEG / GIF / WebP / SVG

ImageのSVG出力は、変換元画像をSVG内へ埋め込んで表示を保つ方式です。写真やラスター画像の輪郭を自動的にベクターデータへ変換する機能ではありません。

## 動作環境

- Windows 10 / 11（64ビット）
- インストール不要
- オフライン動作
- 変換元と保存先を扱える十分な空き容量

## 使い方
GitHubのReleasesページから、ConvertBox-Portable-1.0.0.exeをダウンロードします。
1. `ConvertBox-Portable-1.0.0.exe` を、書き込み可能なフォルダへ置きます。
2. EXEをダブルクリックします。
3. Video / Audio / Image のカテゴリを選びます。
4. 変換元ファイルを選択します。
5. 変換先形式を選択します。この時点では変換は始まりません。
6. `変換する` を押して変換を開始します。
7. 変換完了後に表示される `ダウンロード` を押します。
8. 保存先とファイル名を指定すると、変換済みファイルが保存されます。

Windowsの警告が表示される場合があります。現在の配布EXEにはコード署名証明書による署名を行っていません。配布元とSHA-256チェックサムを確認してから実行してください。

## ポータブル方針

BAT起動は廃止しました。配布時は単体のポータブルEXEを使います。

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

アプリ終了時には、変換中のFFmpeg子プロセスを停止し、一時変換ファイルを削除します。ローカルサーバーは使用していません。

同じポータブルフォルダからの二重起動は防止します。すでに起動している状態でもう一度EXEを実行すると、既存のConvertBoxウィンドウを前面に表示します。

## 開発環境での起動

開発時のみNode.jsとnpmを使用します。ユーザー配布用EXEの実行には不要です。

```powershell
npm install
npm start
```

## 正式版ポータブルEXEの作成

```powershell
npm install
npm run release:portable
```

作成後は、EXEとSHA-256チェックサムが出力されます。

```text
dist/ConvertBox-Portable-1.0.0.exe
dist/ConvertBox-Portable-1.0.0.exe.sha256
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

`dist/` のEXEとチェックサムは通常コミットへ含めません。将来的にはGitHub Releasesの成果物として添付する想定ですが、現在のEXEにはGPL有効のFFmpegが含まれています。対応する正確なソースコードとビルド情報を同時に提供できる状態になるまで、公開Releaseへ添付しないでください。

ローカルGitリポジトリは初期化済みで、既定ブランチは `main` です。リモートリポジトリの登録、コミット、GitHubへの送信は行っていません。

## 主なフォルダ構成

```text
ConvertBox/
├─ package.json
├─ README.md
├─ CHANGELOG.md
├─ THIRD_PARTY_NOTICES.md
├─ build/
│  ├─ icon.svg
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
│  │  └─ style.css
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

画像変換には `sharp` を使用します。これもプロジェクト内の依存関係として扱い、PC本体へグローバルインストールしません。

公開配布前に、必ず [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を確認してください。同梱中のFFmpegはGPL有効ビルドであり、対応する正確なソースコードとビルド情報を用意しないまま、FFmpegバイナリまたはそれを含むポータブルEXEを公開しないでください。

## 確認用コマンド

```powershell
npm run check
npm run check:video
npm run check:audio
npm run check:image
```

## GitHub公開前チェック

1. `package.json` と画面のバージョンが `1.0.0` であることを確認する。
2. 上記の確認用コマンドをすべて実行する。
3. `npm run release:portable` で正式版EXEとチェックサムを作成する。
4. EXEを起動し、Video / Audio / Image の選択、変換、保存、終了を確認する。
5. EXE終了後に `ConvertBox`、`ffmpeg`、`ffprobe` のプロセスが残っていないことを確認する。
6. FFmpegの対応ソースとライセンス文書をReleaseから取得できる状態にする。
7. ConvertBox本体をオープンソースとして公開する場合は、用途に合うライセンスを追加する。
8. GitHub ReleaseへEXEと `.sha256` を添付し、バージョンタグを `v1.0.0` にする。

## 今後の候補

- 変換品質の詳細設定
- 画像サイズ変更
- 一括変換
- 変換履歴
- コード署名
