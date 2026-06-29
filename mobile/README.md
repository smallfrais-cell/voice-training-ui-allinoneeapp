# Voice Garden Pocket

A phone-first practice companion for Android Chrome.

This mobile version is intentionally separate from the desktop Electron and Python analyzer. It is static and runs in the browser, so it can be hosted through GitHub Pages and installed to an Android home screen.

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

## Not included yet

The full desktop analyzer is not bundled here. The current analyzer depends on Python, NumPy, Praat or Parselmouth, and desktop-style file paths. A full offline Android analyzer should be explored separately with either Chaquopy or a mobile-native analyzer rewrite.

## Local static test

From this folder, serve the files with any static server. Microphone access needs a secure context, so use localhost or HTTPS.

    python -m http.server 8080

Then open http://localhost:8080.

On Android, use the deployed HTTPS GitHub Pages URL.

## GitHub Pages

This folder is ready to deploy as a static Pages artifact. The included workflow publishes mobile/.
