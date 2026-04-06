/**
 * Push notification setup for ManFriday mobile.
 *
 * Registers the device with Expo Push Notification service,
 * handles incoming notifications (foreground + background),
 * and provides helpers for the rest of the app.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

// ── Configuration ───────────────────────────────────────────

// Set default notification behavior (show alert even when app is in foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ── Permission & registration ───────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return false;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission not granted");
    return false;
  }

  // Android requires a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1a1a2eFF",
    });

    await Notifications.setNotificationChannelAsync("ingest", {
      name: "Ingest Complete",
      description: "Notifications when a source has been ingested into your wiki",
      importance: Notifications.AndroidImportance.DEFAULT,
    });

    await Notifications.setNotificationChannelAsync("lint", {
      name: "Wiki Health",
      description: "Notifications about wiki quality issues found by the linter",
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  return true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  const permitted = await requestPermissions();
  if (!permitted) return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? "manfriday";

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenData.data;
    console.log("Expo push token:", token);

    // Send token to our backend so we can push from Cloud Run
    await sendTokenToBackend(token);

    return token;
  } catch (error) {
    console.error("Failed to get push token:", error);
    return null;
  }
}

async function sendTokenToBackend(token: string): Promise<void> {
  // Lazy import to avoid circular dependency
  const { getToken } = await import("./api");

  const jwt = await getToken();
  if (!jwt) {
    console.warn("No auth token — cannot register push token with backend");
    return;
  }

  const baseUrl =
    Constants.expoConfig?.extra?.apiBaseUrl ?? "http://localhost:8000";

  try {
    await fetch(`${baseUrl}/notifications/register-device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
      }),
    });
  } catch (error) {
    console.error("Failed to register push token with backend:", error);
  }
}

// ── Notification handling ───────────────────────────────────

export type NotificationListener = (
  notification: Notifications.Notification
) => void;

export type NotificationResponseListener = (
  response: Notifications.NotificationResponse
) => void;

/**
 * Handle a notification received while app is in the foreground.
 * Returns a subscription that should be removed on cleanup.
 */
export function onNotificationReceived(
  listener: NotificationListener
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(listener);
}

/**
 * Handle user tapping on a notification (foreground or background).
 * Returns a subscription that should be removed on cleanup.
 */
export function onNotificationResponse(
  listener: NotificationResponseListener
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(listener);
}

/**
 * Process a notification tap — extract routing info and navigate.
 * Call this from your notification response handler.
 */
export function handleNotification(
  response: Notifications.NotificationResponse
): { route: string; params: Record<string, string> } | null {
  const data = response.notification.request.content.data;

  if (!data || typeof data !== "object") return null;

  // Our backend sends notifications with { type, slug, ... }
  const type = data.type as string | undefined;
  const slug = data.slug as string | undefined;

  if (type === "ingest_complete" && slug) {
    return { route: "/(tabs)", params: { highlight: slug } };
  }

  if (type === "lint_report") {
    return { route: "/(tabs)", params: { tab: "health" } };
  }

  if (type === "qa_answer" && slug) {
    return { route: "/(tabs)/qa", params: { answerId: slug } };
  }

  return null;
}

// ── Badge management ────────────────────────────────────────

export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
}

export async function getBadgeCount(): Promise<number> {
  return Notifications.getBadgeCountAsync();
}
