# RTB OS — iOS App (private/unlisted distribution)

This wraps the live RTB OS web app (rtbheadquaters.com) as a real iOS
app using Capacitor, for distribution as an **Unlisted App** on the
App Store (or as a Custom App via Apple Business Manager — you
already have the D-U-N-S number for that if you'd rather go that
route).

## How it works

The native shell loads `https://rtbheadquaters.com` directly
(configured in `capacitor.config.ts`, `server.url`). It does **not**
bundle a snapshot of the site into the app. This means:

- Every push to `main` that deploys the web app is live in the iOS
  app instantly, same as it is in a browser today.
- You only need a new App Store submission when something about the
  *native shell itself* changes — the icon, splash screen, app name,
  or native config in this `ios/` folder. Everyday feature work never
  needs to go through App Review again.

## What's already done

- Capacitor installed and initialized (`capacitor.config.ts`)
- iOS platform scaffolded (`ios/App/App.xcodeproj`)
- Bundle ID: `com.rtbheadquaters.os`
- Display name: RTB OS
- Native auth callback registered:
  `com.rtbheadquaters.os://auth/callback`

## What's left — needs a Mac with Xcode

1. **Open the project**: `ios/App/App.xcodeproj`.
2. **App icon and launch screen**: replace the placeholder assets in
   `ios/App/App/Assets.xcassets/AppIcon.appiconset` and
   `Splash.imageset` with real RTB branding. A 1024x1024 icon is the
   main one needed; Xcode/Capacitor generates the rest.
3. **Signing**: in Xcode, under Signing & Capabilities, select your
   Apple Developer team and let Xcode manage signing automatically.
4. **App Store Connect**: create the app record there (bundle ID
   `com.rtbheadquaters.os`, matching what's already configured
   here), fill in the required metadata (screenshots, description,
   support URL, privacy policy URL, age rating, etc. — same as any
   public app, since unlisted apps go through the identical
   submission flow).
5. **Archive and upload**: Product → Archive in Xcode, then upload to
   App Store Connect via the Organizer window.
6. **Submit for review.** In the Review Notes field, state clearly
   that this app is intended for unlisted distribution.
7. **After approval**, submit the separate unlisted-distribution
   request (Apple's request form, linked from App Store Connect —
   see https://developer.apple.com/support/unlisted-app-distribution).
   Apple will then give you the private install link to share with
   staff.

## Google Home opening / closing bridge

RTB OS now has a native Capacitor bridge prepared for Google Home authorization.
The bridge is deliberately compiled behind `canImport(GoogleHomeSDK)` so normal
web/iOS CI continues to build until the Google SDK is installed locally.

One-time native setup:

1. In Google Cloud, enable **Home API** for the project used by RTB OS.
2. Create an **iOS OAuth client** for bundle ID `com.rtbheadquaters.os` and Apple Team ID `N6HF9ZX8D9`.
3. Add `rickothebarber@gmail.com` as a test user while the OAuth consent screen is in testing.
4. Set these Xcode build settings for the RTB OS target:
   - `GOOGLE_HOME_CLIENT_ID` = the iOS OAuth Client ID
   - `GOOGLE_HOME_CLOUD_PROJECT_NUMBER` = the numeric Google Cloud project number
5. Download the signed-in Google Home iOS SDK from Google Home Developers and unpack it to:
   `ios/ThirdParty/GoogleHomeSDK`.
6. In Xcode choose **File → Add Package Dependencies… → Add Local…**, then select that `GoogleHomeSDK` directory. Add both `GoogleHomeSDK` and `GoogleHomeTypes` to the RTB OS target.
7. Add the Apple **App Attest** capability. Google documents that Home APIs with App Attest require testing on a real iPhone rather than the simulator.
8. Rebuild and install RTB OS on the iPhone. Open **Operations → Checklists → Google Home opening & closing** and tap **Connect Google Home**.

Important limitation: Google currently marks its Google Camera device type as restricted. OAuth/Home SDK connection can be implemented now, but direct camera-event access may depend on Google's device-access approval. The RTB OS backend is intentionally source-agnostic so door/person events can still be supplied by another approved Google Home automation or supported device source without redesigning the opening/closing tracker.

## If you'd rather use Apple Business Manager Custom Apps instead

Since you already have the D-U-N-S number, Custom Apps is also
available to you and is the stricter option — distribution is tied
to specific staff/devices in Apple Business Manager rather than a
shareable link. The native shell built here works for either path;
the difference is entirely in how you distribute it from App Store
Connect / Apple Business Manager, not in this code.

## Local rebuild command

Whenever you want to refresh the native project from a fresh build
(only needed if you change `capacitor.config.ts` or add native
plugins — not needed for normal web app changes, since those load
live):

```
npm run build
npx cap sync ios
```

## Required Supabase Auth redirect URL

Supabase Auth must allow this native callback URL in addition to the
live website URLs:

```
com.rtbheadquaters.os://auth/callback
```
