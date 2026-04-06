/**
 * Home tab — wiki stats dashboard + recent articles list.
 *
 * Shows stat cards (total pages, sources, entities, concepts) at the top,
 * followed by a scrollable list of recently updated wiki pages.
 * Tapping a page navigates to the full article view.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import {
  getWikiStats,
  getRecentPages,
  WikiStats,
  WikiPage,
} from "../../services/api";
import { getCachedPages, startAutoSync } from "../../services/offline";

// ── Stat card ───────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={24} color="#6366f1" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Article row ─────────────────────────────────────────────

function ArticleRow({ page }: { page: WikiPage }) {
  const typeColors: Record<string, string> = {
    entity: "#10b981",
    concept: "#8b5cf6",
    article: "#3b82f6",
    output: "#f59e0b",
  };

  return (
    <Pressable style={styles.articleRow}>
      <View style={styles.articleHeader}>
        <View
          style={[
            styles.typeBadge,
            { backgroundColor: typeColors[page.type] ?? "#6b7280" },
          ]}
        >
          <Text style={styles.typeBadgeText}>{page.type}</Text>
        </View>
        <Text style={styles.articleDate}>{page.updated}</Text>
      </View>
      <Text style={styles.articleTitle}>{page.title}</Text>
      {page.tags.length > 0 && (
        <View style={styles.tagRow}>
          {page.tags.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
          {page.tags.length > 3 && (
            <Text style={styles.moreTag}>+{page.tags.length - 3}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ── Home screen ─────────────────────────────────────────────

export default function HomeScreen() {
  const [stats, setStats] = useState<WikiStats | null>(null);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setError(null);

      const [statsResult, pagesResult] = await Promise.allSettled([
        getWikiStats(),
        getRecentPages(20),
      ]);

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      }

      if (pagesResult.status === "fulfilled") {
        setPages(pagesResult.value);
      } else {
        // Fall back to cached pages when offline
        const cached = await getCachedPages(20);
        if (cached.length > 0) {
          setPages(cached);
        } else if (statsResult.status === "rejected") {
          setError("Unable to load wiki data. Check your connection.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    startAutoSync();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, [loadData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading wiki...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={pages}
        keyExtractor={(item) => item.slug}
        renderItem={({ item }) => <ArticleRow page={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>ManFriday</Text>

            {error && (
              <View style={styles.errorBanner}>
                <Ionicons name="cloud-offline-outline" size={16} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {stats && (
              <View style={styles.statsGrid}>
                <StatCard label="Pages" value={stats.total_pages} icon="documents-outline" />
                <StatCard label="Sources" value={stats.total_sources} icon="link-outline" />
                <StatCard label="Entities" value={stats.entities} icon="people-outline" />
                <StatCard label="Concepts" value={stats.concepts} icon="bulb-outline" />
              </View>
            )}

            {stats?.last_activity && (
              <Text style={styles.lastActivity}>
                Last activity: {stats.last_activity}
              </Text>
            )}

            <Text style={styles.sectionTitle}>Recent Pages</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#6b7280" />
            <Text style={styles.emptyText}>No wiki pages yet.</Text>
            <Text style={styles.emptySubtext}>
              Share a URL to start building your knowledge base.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f0f23",
  },
  loadingText: {
    color: "#9ca3af",
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#f9fafb",
    marginBottom: 16,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1f1f38",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#ef4444",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    flex: 1,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#1f1f38",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f9fafb",
  },
  statLabel: {
    fontSize: 12,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  lastActivity: {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#e5e7eb",
    marginBottom: 12,
  },
  articleRow: {
    backgroundColor: "#1f1f38",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  articleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  articleDate: {
    color: "#6b7280",
    fontSize: 12,
  },
  articleTitle: {
    color: "#f3f4f6",
    fontSize: 16,
    fontWeight: "500",
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap",
  },
  tag: {
    backgroundColor: "#2d2d50",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    color: "#a5b4fc",
    fontSize: 11,
  },
  moreTag: {
    color: "#6b7280",
    fontSize: 11,
    alignSelf: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
  },
  emptyText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "500",
  },
  emptySubtext: {
    color: "#6b7280",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 260,
  },
});
