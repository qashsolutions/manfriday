/**
 * Q&A tab — chat interface for querying the wiki.
 *
 * Users type questions, and the app streams answers from the ManFriday
 * Q&A endpoint. Answers include [[wikilink]] citations that can be
 * tapped to navigate to the referenced page.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { qa, qaStream, QAResponse } from "../../services/api";

// ── Types ───────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  timestamp: Date;
  streaming?: boolean;
}

// ── Wikilink renderer ───────────────────────────────────────

function renderContent(text: string): React.ReactNode[] {
  // Split on [[wikilink]] patterns
  const parts = text.split(/(\[\[[^\]]+\]\])/g);

  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/);
    if (match) {
      return (
        <Text key={i} style={styles.wikilink}>
          {match[1]}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}

// ── Message bubble ──────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}
    >
      {!isUser && (
        <View style={styles.avatarRow}>
          <Ionicons name="sparkles" size={14} color="#a5b4fc" />
          <Text style={styles.avatarLabel}>ManFriday</Text>
        </View>
      )}

      <Text style={[styles.messageText, isUser && styles.userText]}>
        {renderContent(message.content)}
      </Text>

      {message.streaming && (
        <ActivityIndicator
          size="small"
          color="#6366f1"
          style={styles.streamingIndicator}
        />
      )}

      {message.sources && message.sources.length > 0 && (
        <View style={styles.sourcesRow}>
          <Ionicons name="document-text-outline" size={12} color="#6b7280" />
          <Text style={styles.sourcesText}>
            Sources: {message.sources.join(", ")}
          </Text>
        </View>
      )}

      <Text style={styles.timestamp}>
        {message.timestamp.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
    </View>
  );
}

// ── Q&A screen ──────────────────────────────────────────────

export default function QAScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const messageIdRef = useRef(0);

  const nextId = () => {
    messageIdRef.current += 1;
    return `msg-${messageIdRef.current}`;
  };

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;

    setInput("");
    setSending(true);

    const userMsg: Message = {
      id: nextId(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    const assistantId = nextId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      // Try streaming first
      let fullContent = "";
      let usedStream = false;

      try {
        const stream = qaStream({ question });
        for await (const chunk of stream) {
          fullContent += chunk;
          usedStream = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: fullContent, streaming: true }
                : m
            )
          );
        }
      } catch {
        // Fall back to non-streaming
        if (!usedStream) {
          const response: QAResponse = await qa({ question });
          fullContent = response.answer;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: response.answer,
                    sources: response.sources,
                    streaming: false,
                  }
                : m
            )
          );
          setSending(false);
          return;
        }
      }

      // Finalize streaming message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: fullContent, streaming: false }
            : m
        )
      );
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Something went wrong";

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `Error: ${errorText}`,
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Ionicons name="chatbubbles-outline" size={22} color="#a5b4fc" />
        <Text style={styles.headerTitle}>Ask your wiki</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color="#4b5563" />
              <Text style={styles.emptyTitle}>Ask anything</Text>
              <Text style={styles.emptySubtext}>
                Questions are answered using your wiki knowledge base with
                [[wikilink]] citations.
              </Text>
            </View>
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question..."
            placeholderTextColor="#6b7280"
            multiline
            maxLength={2000}
            returnKeyType="send"
            editable={!sending}
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
          <Pressable
            style={[
              styles.sendButton,
              (!input.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f38",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#f9fafb",
  },
  messageList: {
    padding: 16,
    flexGrow: 1,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#4f46e5",
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1f1f38",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  avatarLabel: {
    color: "#a5b4fc",
    fontSize: 11,
    fontWeight: "600",
  },
  messageText: {
    color: "#e5e7eb",
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: "#fff",
  },
  wikilink: {
    color: "#818cf8",
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  streamingIndicator: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  sourcesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#2d2d50",
  },
  sourcesText: {
    color: "#6b7280",
    fontSize: 11,
    flex: 1,
  },
  timestamp: {
    color: "#4b5563",
    fontSize: 10,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#1f1f38",
    backgroundColor: "#0f0f23",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1f1f38",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: "#f3f4f6",
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4f46e5",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#2d2d50",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 120,
    gap: 8,
  },
  emptyTitle: {
    color: "#9ca3af",
    fontSize: 18,
    fontWeight: "500",
  },
  emptySubtext: {
    color: "#6b7280",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 18,
  },
});
