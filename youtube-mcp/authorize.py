"""One-time OAuth authorization for the YouTube analytics tools.

These tools read PRIVATE analytics (retention, traffic sources, demographics)
and only work for channels the signed-in Google account owns.

Setup:
  1. Google Cloud Console -> enable BOTH "YouTube Data API v3" and
     "YouTube Analytics API" on your project.
  2. APIs & Services -> Credentials -> Create credentials -> OAuth client ID
     -> Application type: "Desktop app". Download the JSON and save it as
     youtube-mcp/client_secret.json (or set YT_OAUTH_CLIENT_SECRETS).
  3. Run:  youtube-mcp/.venv/bin/python youtube-mcp/authorize.py
     A browser opens for Google sign-in; the token is saved locally.

Re-run this script any time to re-authorize or switch accounts.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRETS = os.environ.get("YT_OAUTH_CLIENT_SECRETS") or os.path.join(
    HERE, "client_secret.json"
)
TOKEN = os.environ.get("YT_OAUTH_TOKEN") or os.path.join(HERE, ".oauth-token.json")
SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]


def main() -> None:
    if not os.path.exists(CLIENT_SECRETS):
        sys.exit(
            f"Missing OAuth client file: {CLIENT_SECRETS}\n"
            "Create a 'Desktop app' OAuth client in Google Cloud Console "
            "(with YouTube Data API v3 + YouTube Analytics API enabled) and "
            "save its JSON at that path."
        )
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS, SCOPES)
    creds = flow.run_local_server(port=0)
    with open(TOKEN, "w") as f:
        f.write(creds.to_json())
    os.chmod(TOKEN, 0o600)
    print(f"Authorized. Token saved to {TOKEN}")
    print("The get_my_* analytics tools are now enabled for your channel.")


if __name__ == "__main__":
    main()
