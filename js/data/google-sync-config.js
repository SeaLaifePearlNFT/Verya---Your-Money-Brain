// Veyra — Google sync configuration.
//
// Fill in your own OAuth Client ID from Google Cloud Console below (see the
// setup steps you were given alongside this file). This is a public,
// client-side identifier — it is NOT a secret, it's safe to ship in this
// file the same way your site's URL is public.
//
// Until this is filled in, "Sign in with Google" will show a friendly
// message instead of trying (and failing) to contact Google.
//
// apiKey and appId are only needed for "Connect a shared budget" (the
// Google file/folder picker) — clientId alone is enough for sign-in and
// backup. Get them from the same Google Cloud Console project:
//   apiKey: APIs & Services -> Credentials -> Create Credentials -> API key
//   appId:  the number shown next to your project name in the Cloud
//           Console header (NOT the project ID/name — the numeric one)
// Both are public, client-side values, same as clientId.

window.VeyraGoogleSyncConfig = {
  clientId: '745502576644-bntpvfcnk9iha75sjavmo7ldgbeir3ej.apps.googleusercontent.com', // e.g. '123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com'
  apiKey: 'AIzaSyAX1D47ASv0ZfFPHDVCHr2Zl1rLgwy8pbI',   // e.g. 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567'
  appId: '745502576644'     // e.g. '123456789012'
};
