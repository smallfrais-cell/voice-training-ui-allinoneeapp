# Voice Garden Pocket

A phone-first practice companion for Android Chrome and Android APK builds.

This mobile version is intentionally separate from the desktop Electron and Python analyzer. It is static and runs in the browser, so it can be hosted through GitHub Pages, installed to an Android home screen, or wrapped into an Android APK with Capacitor.

## Included in mobile v1

- live microphone pitch monitor
- pitch floor and ceiling controls
- manual mic gain from 0.25x to 3.00x
- fan and room-noise calibration gate
- volume meter
- waveform view
- local scripts stored in localStorage
- default starter drills
- optional screen wake lock
- PWA manifest and service worker
- Capacitor config for Android APK builds
- GitHub Actions workflow for downloadable APK artifacts

## Not included yet

The full desktop analyzer is not bundled here. The current analyzer depends on Python, NumPy, Praat or Parselmouth, and desktop-style file paths. A full offline Android analyzer should be explored separately with either Chaquopy or a mobile-native analyzer rewrite.

## Android APK from GitHub Actions

Use the workflow named `Build mobile Android APK`.

1. Open the repository on GitHub.
2. Go to Actions.
3. Choose `Build mobile Android APK`.
4. Tap `Run workflow`.
5. Wait for the build to finish.
6. Open the run summary.
7. Download the `VoiceGardenPocket-...-apk` artifact.
8. Extract the zip on Android.
9. Install the APK.

The workflow uses Capacitor to generate an Android project, adds microphone permission, assigns a version code from the GitHub run number, builds a debug APK, and uploads it as an artifact.

Updates should install over older APKs as long as the signing key is the same and the version code is newer. The workflow caches the Android debug signing key under `voice-pocket-debug-keystore-v1`, which should keep updates working across normal GitHub Actions runs. For real distribution later, replace this with a private release signing key stored in GitHub Secrets.

## Local static test

From this folder, serve the files with any static server. Microphone access needs a secure context, so use localhost or HTTPS.

    python -m http.server 8080

Then open http://localhost:8080.

On Android, use the deployed HTTPS GitHub Pages URL.

## Local APK build

From this folder:

    npm install
    npm run apk:debug

The debug APK will be produced under:

    mobile/android/app/build/outputs/apk/debug/app-debug.apk

## GitHub Pages

This folder is ready to deploy as a static Pages artifact. The included workflow publishes mobile/.
