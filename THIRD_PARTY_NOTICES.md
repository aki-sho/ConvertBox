# Third-Party Notices

FileConverter includes and uses third-party software.

## FFmpeg / FFprobe

`portable/bin/ffmpeg.exe` and `portable/bin/ffprobe.exe` are included so the app can convert video and audio without requiring a system-wide FFmpeg installation.

The bundled executables report the following build:

- Version: `N-92722-gf22fcd4483`
- Build date/toolchain: GCC 8.2.1, 2018-12-01
- License mode: GPLv3 or later (`--enable-gpl` and `--enable-version3`)
- FFmpeg project: https://ffmpeg.org/
- License information: https://ffmpeg.org/legal.html

The FFmpeg executables are separate programs started by FileConverter. FFmpeg remains licensed by its respective copyright holders.

Before distributing these binaries publicly, the distributor must preserve the applicable copyright and license notices and provide the exact corresponding source code and build information required by the GPL. The current repository does not contain that corresponding FFmpeg source bundle. Do not publish the bundled executables or the portable EXE until that source bundle and its download location have been prepared.

## Sharp

Image conversion uses the `sharp` npm package and its native image processing dependencies. These are installed inside this project and packaged with the app. They are not installed globally on the PC.

- Project: https://sharp.pixelplumbing.com/
- License: Apache-2.0

The complete npm dependency versions and integrity hashes are recorded in `package-lock.json`. License files included with installed npm packages are packaged with the application where required.

## Electron

FileConverter is built with Electron.

- Project: https://www.electronjs.org/
- License: MIT

## FileConverter source code

No open-source license has been selected for the FileConverter application code. The package is currently marked `UNLICENSED`. Publishing the source on GitHub does not by itself grant permission to copy, modify, or redistribute it. Add a project license before publication if open-source reuse is intended.
