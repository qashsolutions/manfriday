# Google OAuth verification — round 2 (email received 13 Sep 2026)

Project 845649489196 · man-friday-508102 · scopes youtube.upload + youtube.readonly

## A. Demo video (Google: "does not sufficiently demonstrate why the scopes are necessary")

- [ ] A1  New video shows the FULL in-app use of youtube.upload: approve a video → schedule → it uploads to the user's channel.
- [ ] A2  New video shows the FULL in-app use of youtube.readonly: channel name shown after connect (channels.list) AND the Analytics page / queue chip showing view, like, comment counts read from YouTube (videos.list).
- [ ] A3  Source-account impact for the write scope: after the upload, switch to YouTube Studio (the user's Google account) and show the same Short there.
- [ ] A4  Source-account impact for readonly: show the view count in YouTube Studio matching the number in Man Friday.
- [ ] A5  Explain on screen why no narrower scope works: youtube.upload is the only scope that allows videos.insert; youtube.readonly is the narrowest scope that allows videos.list statistics on the user's own videos (no "own videos only" scope exists). Shown as captions/narration.
- [ ] A6  Show the OAuth consent screen with the browser address bar visible (client_id in the URL) and the app name "Man Friday" on the consent screen, both scopes listed.
- [ ] A7  Show revocation: Disconnect in Settings → Google account › Third-party access no longer lists Man Friday.
- [ ] A8  Video is unlisted on YouTube, in English (on-screen text), ≥720p, and the link is updated in Cloud Console.
- [ ] A9  "Live app" note: confirm in the reply that the app is In Production, the two scopes are used only by test/founder accounts (well under the 100-user cap), and the demo was recorded on the production app with a test account. Publishing status stays "In production".

## B. Privacy policy (Google: three missing disclosures)

- [ ] B1  How the app USES Google user data — an explicit "How Man Friday uses Google user data" section (upload approved videos, read channel name, read stats of our own uploads; nothing else).
- [ ] B2  With whom Google user data is SHARED / transferred / disclosed — explicit section: not sold, not shared with third parties, not used for ads; the only sub-processor that holds it is our database/hosting provider; disclosed to authorities only if legally required.
- [ ] B3  DATA PROTECTION mechanisms for sensitive data — explicit section: TLS in transit, encryption at rest, tokens server-side only, passkey/2FA gate before connecting, least-privilege scopes, deletion on disconnect, incident contact.
- [ ] B4  Google API Services User Data Policy "Limited Use" statement (required wording) + explicit "not used to train AI/ML models" line.
- [ ] B5  Publish the updated policy at https://manfriday.app/privacy (same URL already in the Console).

## C. Resubmit and reply

- [ ] C1  Cloud Console › Verification Center: update the demo video link, confirm the privacy policy URL, save and submit.
- [ ] C2  Reply to Google's email confirming: new video link, privacy policy URL, and the three disclosures with their section names; mention the live-app note (A9).

## D. Standing requirements (already met — re-check before replying)

- [x] Homepage live and names the product · [x] Domain verified in Search Console · [x] Branding verified · [x] Use cases described · [x] Minimum scopes (2) · [ ] In-app testing: a reviewer can sign up free at manfriday.app; offer a test account in the reply if they ask.
