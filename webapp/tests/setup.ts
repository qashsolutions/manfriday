/** Sentinel secrets: recognizable values the leak tests grep response bodies
    for. If any of these ever appear in an HTTP response, a test must fail. */
export const SENTINELS = {
  ANTHROPIC_API_KEY: "sk-ant-TEST-SENTINEL-anthropic-key",
  SUPABASE_SECRET_KEY: "sb-TEST-SENTINEL-service-key",
  GOOGLE_CLIENT_SECRET: "GOCSPX-TEST-SENTINEL-google-secret",
  TOKEN_ENC_KEY: "TEST-SENTINEL-token-enc-key",
};

process.env.ANTHROPIC_API_KEY = SENTINELS.ANTHROPIC_API_KEY;
process.env.SUPABASE_SECRET_KEY = SENTINELS.SUPABASE_SECRET_KEY;
process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = SENTINELS.GOOGLE_CLIENT_SECRET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-sentinel.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.YOUTUBE_API_KEY = "TEST-SENTINEL-yt-api-key";
