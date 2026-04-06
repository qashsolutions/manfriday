/**
 * Share sheet handler — receives text/URL from the system share menu.
 *
 * When a user shares a URL or text to ManFriday from another app,
 * this screen receives it, shows a confirmation, and submits it
 * to the /ingest endpoint (or queues it for offline sync).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";

import { ingest, IngestResponse } from "../../services/api";
import { queueIngest, getQueueLength } from "../../services/offline";

type ShareStatus = "idle" | "submitting" | "success" | "queued" | "error";

export default function ShareScreen() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();

  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [queueCount, setQueueCount] = useState(0);

  // Extract shared content from params or deep link
  useEffect(() => {
    async function extractSharedContent() {
      // Check URL params first (from share intent)
      if (params.url) {
        setUrl(params.url);
        return;
      }
      if (params.text) {
        // Try to extract a URL from shared text
        const urlMatch = params.text.match(
          /https?:\/\/[^\s<>"{}|\\^`[\]]+/i
        );
        if (urlMatch) {
          setUrl(urlMatch[0]);
        } else {
          setUrl(params.text);
        }
        return;
      }

      // Check deep link
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        const parsed = Linking.parse(initialUrl);
        if (parsed.queryParams?.url) {
          setUrl(String(parsed.queryParams.url));
        }
      }
    }

    extractSharedContent();
    getQueueLength().then(setQueueCount);
  }, [params.url, params.text]);

  const handleSubmit = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    setStatus("submitting");
    setErrorMsg("");

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const response = await ingest({
        url: trimmedUrl,
        tags: tagList.length > 0 ? tagList : undefined,
      });

      setResult(response);
      setStatus("success");
    } catch (error) {
      // Queue for offline sync
      try {
        await queueIngest({
          url: trimmedUrl,
          tags: tagList.length > 0 ? tagList : undefined,
        });
        const count = await getQueueLength();
        setQueueCount(count);
        setStatus("queued");
      } catch (queueError) {
        setErrorMsg(
          error instanceof Error ? error.message : "Failed to submit"
        );
        setStatus("error");
      }
    }
  }, [url, tags]);

  const handleDone = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="share-outline" size={24} color="#a5b4fc" />
        <Text style={styles.headerTitle}>Add to Wiki</Text>
      </View>

      {status === "success" && result ? (
        <View style={styles.resultContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
          </View>
          <Text style={styles.successTitle}>Source ingested</Text>
          <Text style={styles.successSlug}>{result.slug}</Text>
          {result.pages_updated.length > 0 && (
            <Text style={styles.successDetail}>
              {result.pages_updated.length} page
              {result.pages_updated.length !== 1 ? "s" : ""} updated
            </Text>
          )}
          <Pressable style={styles.doneButton} onPress={handleDone}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      ) : status === "queued" ? (
        <View style={styles.resultContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="cloud-offline-outline" size={64} color="#f59e0b" />
          </View>
          <Text style={styles.queuedTitle}>Queued for sync</Text>
          <Text style={styles.queuedDetail}>
            You appear to be offline. This source will be ingested when
            connectivity returns.
          </Text>
          <Text style={styles.queueCount}>
            {queueCount} item{queueCount !== 1 ? "s" : ""} in queue
          </Text>
          <Pressable style={styles.doneButton} onPress={handleDone}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>URL or text</Text>
          <TextInput
            style={styles.urlInput}
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/article"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            selectTextOnFocus
          />

          <Text style={styles.label}>Tags (optional, comma-separated)</Text>
          <TextInput
            style={styles.tagInput}
            value={tags}
            onChangeText={setTags}
            placeholder="research, AI, paper"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
          />

          {status === "error" && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          <Pressable
            style={[
              styles.submitButton,
              (!url.trim() || status === "submitting") &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!url.trim() || status === "submitting"}
          >
            {status === "submitting" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.submitButtonText}>Ingest Source</Text>
              </>
            )}
          </Pressable>

          {queueCount > 0 && (
            <Text style={styles.pendingNote}>
              {queueCount} pending ingest{queueCount !== 1 ? "s" : ""} waiting
              to sync
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f38",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#f9fafb",
  },
  form: {
    padding: 20,
    gap: 6,
  },
  label: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 12,
    marginBottom: 4,
  },
  urlInput: {
    backgroundColor: "#1f1f38",
    borderRadius: 10,
    padding: 14,
    color: "#f3f4f6",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2d2d50",
  },
  tagInput: {
    backgroundColor: "#1f1f38",
    borderRadius: 10,
    padding: 14,
    color: "#f3f4f6",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2d2d50",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1f1f38",
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#ef4444",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    flex: 1,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    padding: 16,
    marginTop: 20,
  },
  submitButtonDisabled: {
    backgroundColor: "#2d2d50",
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  pendingNote: {
    color: "#f59e0b",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },
  resultContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 8,
  },
  successIcon: {
    marginBottom: 8,
  },
  successTitle: {
    color: "#10b981",
    fontSize: 22,
    fontWeight: "700",
  },
  successSlug: {
    color: "#9ca3af",
    fontSize: 14,
    fontFamily: "monospace",
  },
  successDetail: {
    color: "#6b7280",
    fontSize: 14,
  },
  queuedTitle: {
    color: "#f59e0b",
    fontSize: 22,
    fontWeight: "700",
  },
  queuedDetail: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 20,
  },
  queueCount: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 4,
  },
  doneButton: {
    backgroundColor: "#1f1f38",
    borderRadius: 10,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 24,
  },
  doneButtonText: {
    color: "#a5b4fc",
    fontSize: 16,
    fontWeight: "600",
  },
});
