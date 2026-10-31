# Third-Party Notices

ConvertBox includes and uses third-party software.

## FFmpeg / FFprobe

`portable/bin/ffmpeg.exe` and `portable/bin/ffprobe.exe` are included so the app can convert video and audio without requiring a system-wide FFmpeg installation.

The bundled executables report the following build:

- Version: `9.0.2-essentials_build-www.gyan.dev` (both FFmpeg and ffprobe)
- Build toolchain: GCC 16.2.0, MSYS2
- Provider: https://www.gyan.dev/ffmpeg/builds/
- Archive: https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.7z
- Archive SHA-256: `4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077`
- FFmpeg source commit: `946fcce07b`
- Per-binary SHA-256 values: `portable/bin/ffmpeg-runtime.json`
- License text: `portable/bin/FFMPEG-LICENSE.txt`
- License mode: GPLv3 or later (`--enable-gpl` and `--enable-version3`)
- FFmpeg project: https://ffmpeg.org/
- License information: https://ffmpeg.org/legal.html

The FFmpeg executables are separate programs started by ConvertBox. FFmpeg remains licensed by its respective copyright holders.

The exact upstream FFmpeg source commit identified by the binary provider, the bundled binary build configuration, runtime hashes, and license text are supplied in the source-and-build-info Release asset.

- Source and build information: https://github.com/aki-sho/ConvertBox/releases/download/v1.3.2/FFmpeg-9.0.2-source-and-build-info.zip
- Source manifest: third-party/ffmpeg-source.json

## Sharp

Image conversion uses the `sharp` npm package and its native image processing dependencies. These are installed inside this project and packaged with the app. They are not installed globally on the PC.

- Project: https://sharp.pixelplumbing.com/
- License: Apache-2.0

The complete npm dependency versions and integrity hashes are recorded in `package-lock.json`. License files included with installed npm packages are packaged with the application where required.

## HEIC decoding

HEIC / HEIF input uses `heic-decode` (ISC) and `libheif-js` (LGPL-3.0), including
its bundled WebAssembly decoder. These are packaged with the app and work
offline without installing Windows codecs.

- heic-decode: https://github.com/catdad-experiments/heic-decode
- libheif-js and build scripts: https://github.com/catdad-experiments/libheif-js
- libheif: https://github.com/strukturag/libheif

Preserve the applicable license notices and corresponding source/build
information when distributing the decoder. Installed dependency versions and
integrity hashes are recorded in `package-lock.json`.

## Electron

ConvertBox is built with Electron.

- Project: https://www.electronjs.org/
- License: MIT

## ConvertBox source code

No open-source license has been selected for the ConvertBox application code. The package is currently marked `UNLICENSED`. Publishing the source on GitHub does not by itself grant permission to copy, modify, or redistribute it. Add a project license before publication if open-source reuse is intended.
