# malanga_welfare_companion

Malanga Welfare companion Flutter app.

## Setup

1. Copy `.env.example` to `.env`.
2. Set real Supabase values in `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Run the app with `flutter run`.

If startup configuration is invalid, the app shows a startup error screen and
prints the exact failure reason in logs.

## Android release APK

The website serves the signed APK at `/malanga-welfare.apk` from its `public/`
directory. To generate a local Android release signing key for future builds,
run `node scripts/create-android-signing-key.mjs` from the repository root, then
build with `flutter build apk --release` from `flt_app/`.

The signing key is stored in `android/app/malanga-upload-key.jks` and its
passwords in `android/key.properties`. Both files are intentionally excluded
from Git. Back them up together in secure storage and reuse the same key for
every app update; losing it prevents existing installations from receiving
signed updates. The APK currently linked from the website is approximately
73 MB.
