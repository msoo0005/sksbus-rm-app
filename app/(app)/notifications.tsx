import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AppNotification, NotificationType } from "../api/client";
import { api } from "../api/client";
import { useSession } from "../ctx";

const TYPE_CONFIG: Record<
  NotificationType,
  { icon: string; color: string; colorLight: string }
> = {
  new_report: { icon: "file-alt", color: "#2563EB", colorLight: "#EFF6FF" },
  new_job: { icon: "clipboard-list", color: "#EA580C", colorLight: "#FFF7ED" },
  job_progress: { icon: "chart-line", color: "#16A34A", colorLight: "#F0FDF4" },
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { dbUser } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (opts?: { refreshing?: boolean }) => {
    try {
      if (opts?.refreshing) setRefreshing(true);
      else setLoading(true);

      const rows = await api.listNotifications();
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    try {
      await api.markAllNotificationsRead();
    } catch {
      // best-effort — a stale unread flag isn't worth surfacing an error for
    }
  };

  const openNotification = async (n: AppNotification) => {
    if (!n.is_read) {
      setNotifications((prev) =>
        prev.map((x) =>
          x.notification_id === n.notification_id ? { ...x, is_read: 1 } : x,
        ),
      );
      api.markNotificationRead(n.notification_id).catch(() => {});
    }

    const role = dbUser?.user_role;

    if (n.notification_type === "new_job" && role === "technician") {
      router.push("/technician");
      return;
    }

    if (n.job_id != null && (role === "admin" || role === "rm_manager")) {
      router.push({
        pathname: "/rm-manager/job/[id]",
        params: { id: String(n.job_id) },
      });
      return;
    }

    if (role === "admin" || role === "rm_manager") {
      router.push("/rm-manager");
      return;
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refreshing: true })}
        />
      }
    >
      {notifications.length > 0 && (
        <View style={styles.headerRow}>
          <Text style={styles.headerCount}>
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </Text>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} hitSlop={8}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.mutedText}>Loading notifications…</Text>
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <FontAwesome5 name="bell-slash" size={28} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.mutedText}>
            You&apos;ll see updates here as reports and jobs come in.
          </Text>
        </View>
      ) : (
        notifications.map((n) => {
          const conf = TYPE_CONFIG[n.notification_type] ?? TYPE_CONFIG.job_progress;
          const unread = !n.is_read;

          return (
            <Pressable
              key={n.notification_id}
              onPress={() => openNotification(n)}
              style={({ pressed }) => [
                styles.row,
                unread && styles.rowUnread,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: conf.colorLight }]}>
                <FontAwesome5 name={conf.icon as any} size={15} color={conf.color} />
              </View>

              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {n.notification_title}
                </Text>
                {!!n.notification_body && (
                  <Text style={styles.rowDesc} numberOfLines={2}>
                    {n.notification_body}
                  </Text>
                )}
                <Text style={styles.rowWhen}>{formatWhen(n.created_at)}</Text>
              </View>

              {unread && <View style={styles.unreadDot} />}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 32 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerCount: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B7280",
  },
  markAllText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2563EB",
  },

  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 64,
    gap: 8,
  },
  mutedText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "500",
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
    marginTop: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    marginBottom: 10,
  },
  rowUnread: {
    borderColor: "#DBEAFE",
    backgroundColor: "#F8FAFF",
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },
  rowDesc: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    lineHeight: 18,
    marginBottom: 4,
  },
  rowWhen: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "600",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563EB",
    marginTop: 4,
  },
});
