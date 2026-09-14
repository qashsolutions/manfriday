# Google OAuth verification — round 2 (email received 13 Sep 2026)

**Status: all items closed and reply sent 13 Sep 2026 15:12** (Console: demo link updated to https://youtu.be/_aZEliCyCOE; privacy URL unchanged; reply sent in Google's thread from ramanac@gmail.com, admin@manfriday.app in CC). **APPROVED 14 Sep 2026** for youtube.readonly + youtube.upload (email from the Third Party Data Safety Team). Still separate and pending: the YouTube API Services quota/compliance audit submitted 12 Sep.

Project 845649489196 · man-friday-508102 · scopes youtube.upload + youtube.readonly

## A. Demo video (Google: "does not sufficiently demonstrate why the scopes are necessary")

- [x] A1  New video shows the FULL in-app use of youtube.upload: approve a video → schedule → it uploads to the user's channel.
- [x] A2  New video shows the FULL in-app use of youtube.readonly: channel name shown after connect (channels.list) AND the Analytics page / queue chip showing view, like, comment counts read from YouTube (videos.list).
- [x] A3  Source-account impact for the write scope: after the upload, switch to YouTube Studio (the user's Google account) and show the same Short there.
- [x] A4  Source-account impact for readonly: show the view count in YouTube Studio matching the number in Man Friday.
- [x] A5  Explain on screen why no narrower scope works: youtube.upload is the only scope that allows videos.insert; youtube.readonly is the narrowest scope that allows videos.list statistics on the user's own videos (no "own videos only" scope exists). Shown as captions/narration.
- [x] A6  Show the OAuth consent screen with the browser address bar visible (client_id in the URL) and the app name "Man Friday" on the consent screen, both scopes listed.
- [x] A7  Show revocation: Disconnect in Settings → Google account › Third-party access no longer lists Man Friday.
- [x] A8  Uploaded unlisted 13 Sep: https://youtu.be/_aZEliCyCOE (docs/youtube-demo-v2.mp4, 2:25, 1920×1112). Video is unlisted on YouTube, in English (on-screen text), ≥720p, and the link is updated in Cloud Console.
- [x] A9  "Live app" note: confirm in the reply that the app is In Production, the two scopes are used only by test/founder accounts (well under the 100-user cap), and the demo was recorded on the production app with a test account. Publishing status stays "In production".

## B. Privacy policy (Google: three missing disclosures)

- [x] B1  How the app USES Google user data — an explicit "How Man Friday uses Google user data" section (upload approved videos, read channel name, read stats of our own uploads; nothing else).
- [x] B2  With whom Google user data is SHARED / transferred / disclosed — explicit section: not sold, not shared with third parties, not used for ads; the only sub-processor that holds it is our database/hosting provider; disclosed to authorities only if legally required.
- [x] B3  DATA PROTECTION mechanisms for sensitive data — explicit section: TLS in transit, encryption at rest, tokens server-side only, passkey/2FA gate before connecting, least-privilege scopes, deletion on disconnect, incident contact.
- [x] B4  Google API Services User Data Policy "Limited Use" statement (required wording) + explicit "not used to train AI/ML models" line.
- [x] B5  Publish the updated policy at https://manfriday.app/privacy (same URL already in the Console).

## C. Resubmit and reply

- [x] C1  Cloud Console › Verification Center: update the demo video link, confirm the privacy policy URL, save and submit.
- [x] C2  Reply to Google's email confirming: new video link, privacy policy URL, and the three disclosures with their section names; mention the live-app note (A9).

## D. Standing requirements (already met — re-check before replying)

- [x] Homepage live and names the product · [x] Domain verified in Search Console · [x] Branding verified · [x] Use cases described · [x] Minimum scopes (2) · [ ] In-app testing: a reviewer can sign up free at manfriday.app; offer a test account in the reply if they ask.

## Reply to Google (send from admin@manfriday.app, as a reply to their email, after A8 + C1)

Subject: Re: [Action Needed] OAuth Verification Request — project 845649489196 (man-friday-508102)

Hello,

We have addressed both items and resubmitted in the Cloud Console.

1. Demo video (new): https://youtu.be/_aZEliCyCOE
   It shows, in the production app with a founder test account: the consent screen with the browser address bar visible and both scopes listed; youtube.readonly in use (the connected channel name via channels.list, and the Analytics page reading view/like/comment counts of the Shorts the app itself published via videos.list, matched against YouTube Studio); youtube.upload in use (an approved video scheduled and uploaded as a Short via videos.insert, then visible in the user's YouTube Studio); and revocation (Disconnect in the app revokes the grant at Google — the Google Account "Linked apps" page no longer lists Man Friday). The end card explains why no narrower scope exists for either feature.
   Note on the live-app guidance: the app is In production; the two scopes are currently used only by founder/test accounts, far below the unverified-user cap, and the demo was recorded on the production app with one of those accounts.

2. Privacy policy (updated, same URL): https://manfriday.app/privacy
   New sections under "YouTube and Google user data":
   - "How Man Friday uses Google user data" (data use disclosure)
   - "How Man Friday shares Google user data" (data sharing / transfer / disclosure)
   - "How Man Friday protects Google user data" (data protection mechanisms for sensitive data)
   - "How long we keep it, and how you revoke it", plus the Google API Services User Data Policy Limited Use statement.

Homepage: https://manfriday.app · Terms: https://manfriday.app/terms · Contact: admin@manfriday.app
A reviewer can sign up free at manfriday.app; we can provide a dedicated test account on request.

Thank you,
<name>, Qash Solutions (operator of Man Friday)
