# DEEP_LINKS.md — landing page, App Links, Universal Links, install → import

App identifiers (from the app repo): Android `applicationId` **`com.studdly.app`**, iOS bundle id **`com.studdly.app`**.

## 1. What happens when someone taps `https://share.studdly.app/<code>`

```
             tap link
                │
   app installed & link verified? ──yes──► Studdly opens → fetch GET /api/v1/shares/<code>
                │ no                                      → "Add this topic?" → import → open path
                ▼
   Landing page (Worker HTML)
     ├─ preview: title, N lessons, lesson titles, language flag
     ├─ [Open in Studdly]  (for in-app browsers that don't hand links to apps)
     ├─ [Get it on Google Play] / [Download on the App Store]  (auto-picks by user agent, shows both on desktop)
     └─ small "Report" link
```

## 2. Landing page (`GET /{code}`)

- Server-rendered HTML by the Worker. No framework, no client JS except a tiny `report.js` (served from `/public`, CSP `script-src 'self'`).
- Design = Studdly: background `#000000`, Figtree (self-hosted in `/public/fonts`), text `#F2F0F0`/`#C8C8C8`, ocean CTA `#4D67AA`, radius 12, content max-width 500, 24 px padding, CTA 273×51. Mirror `ai_context/DESIGN_STYLE.md` from the app repo.
- Language: `Accept-Language` best match among the app's languages, fallback EN. Copy is short and child-friendly ("Kasia shared a topic with you" is **not** possible — we don't know names; use "Someone shared a topic with you!").
- `<head>`:
  - `<meta name="robots" content="noindex, nofollow">`
  - Open Graph / Twitter: `og:title` = topic title, `og:description` = "12 lessons · 36 quiz questions · Learn it in Studdly", `og:image` = one static branded image from `/public` (no per-share image generation in v1 — CPU budget), `og:url`, `og:site_name` = Studdly.
  - `apple-itunes-app` smart banner meta with `app-argument=https://share.studdly.app/<code>`.
- Gone/unknown codes → same layout, friendly "This link doesn't work anymore — ask your friend to share it again" + store buttons. Status `404`/`410` (not 200, so crawlers don't cache previews for dead links).

## 3. Android App Links

`android/app/src/main/AndroidManifest.xml` (MainActivity):

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="share.studdly.app" android:pathPattern="/....." />
  <data android:scheme="https" android:host="share.studdly.app" android:pathPattern="/......" />
</intent-filter>
```

`pathPattern="/....."` / `"/......"` = slash + exactly five / six characters (today's codes are 5; 6 is reserved for later). The app still validates the code with the same regex as the server and falls back to opening the URL in the browser if it doesn't match.

Worker serves `/.well-known/assetlinks.json`:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.studdly.app",
    "sha256_cert_fingerprints": [
      "<Play App Signing key SHA-256 — Play Console → Setup → App signing>",
      "<Upload key SHA-256 (for internal testing / sideloaded release builds)>",
      "<Debug keystore SHA-256 (staging host only)>"
    ]
  }
}]
```

Verify with `adb shell pm get-app-links com.studdly.app` and Google's Statement List tester. Without the **Play App Signing** fingerprint, links from Play installs open the browser instead of the app.

## 4. iOS Universal Links

- Entitlement (`ios/Runner/Runner.entitlements`): `com.apple.developer.associated-domains` = `["applinks:share.studdly.app"]` (+ enable the capability for the App ID in the Apple Developer portal).
- Worker serves `/.well-known/apple-app-site-association` (`Content-Type: application/json`, no redirect):

```json
{
  "applinks": {
    "details": [{
      "appIDs": ["<TEAM_ID>.com.studdly.app"],
      "components": [
        { "/": "/api/*", "exclude": true },
        { "/": "/.well-known/*", "exclude": true },
        { "/": "/?????", "comment": "share code (5 chars, current)" },
        { "/": "/??????", "comment": "share code (6 chars, reserved)" }
      ]
    }]
  }
}
```

- Apple fetches AASA through its CDN — changes can take up to ~24 h to propagate; test on a fresh install.
- Known iOS limitations: tapping a universal link **from a page on the same domain** stays in Safari (so the landing page's "Open in Studdly" button uses a custom scheme `studdly://share/<code>` registered in `Info.plist` `CFBundleURLTypes`). In-app browsers (Instagram, TikTok, sometimes Messenger) often ignore universal links → same button.

## 5. Flutter side (summary; full spec in the app repo `ai_context/TOPIC_SHARING.md`)

- Package `app_links` for initial + streamed links (`https://share.studdly.app/<code>` and `studdly://share/<code>`). If Flutter's built-in deep linking is on by default in the Flutter version used, disable it (`FlutterDeepLinkingEnabled = NO` in Info.plist, `flutter_deeplinking_enabled=false` meta-data on Android) so links aren't pushed as Navigator routes — check the `app_links` README for the current guidance.
- If the user hasn't finished onboarding yet (first launch **or** no AI key), the code is stored as a *pending import* and the "Add this topic?" confirmation appears right after onboarding. There is no key-less mode (owner's decision).

## 6. Android "in-app browser" button

```
intent://share.studdly.app/<code>#Intent;scheme=https;package=com.studdly.app;S.browser_fallback_url=<url-encoded Play Store URL with referrer>;end
```

## 7. Install → import (deferred deep link)

Firebase Dynamic Links is dead (shut down 2025-08-25), so no free "magic" service exists. Plan:

- **Android (phase 2):** Play Store button URL `https://play.google.com/store/apps/details?id=com.studdly.app&referrer=share_code%3D<code>`. On first launch the app reads the **Play Install Referrer** (package `play_install_referrer` or equivalent), validates the code, and stores it as a pending import. Works without any third party.
- **iOS:** no reliable free deferred link. Landing page tells the user "After installing, tap the link again" (big, simple). Optional later: copy the link to clipboard on the "Download" button and offer "Paste link" on Home — note iOS shows a paste permission prompt, so it must be user-initiated.
- Paid alternatives (Branch, AppsFlyer OneLink, ChottuLink) are **not** planned — cost / SDK weight / child-privacy review.
