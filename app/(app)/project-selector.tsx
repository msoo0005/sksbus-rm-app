// app/(app)/project-selector.tsx
import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Card, CardContent } from "../components/card";

type ProjectKey = "GOKL" | "MBSJ";

export default function ProjectSelectorScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions(); // ✅ updates on rotation

  // Layout tuning (same intent as your original)
  const cardMargin = 10;
  const sidePadding = 10;

  // You can keep 1 column always, or switch to 2 columns in landscape if you want
  const isLandscape = width > height;
  const numColumns = isLandscape ? 2 : 1;
  const numRows = isLandscape ? 2 : 3;

  // If you have a header, this helps leave space. Safe, even if header differs.
  const headerHeight = 0.1 * height;

  const { cardWidth, cardHeight } = useMemo(() => {
    const usableWidth = width - sidePadding * 2;

    // total horizontal margin across columns + outer edges
    const totalHorizontalMargins = (numColumns + 1) * cardMargin;
    const computedCardWidth = usableWidth / numColumns - totalHorizontalMargins / numColumns;

    // vertical: allow some breathing room for header
    const usableHeight = height - headerHeight;
    const totalVerticalMargins = (numRows + 1) * cardMargin;
    const computedCardHeight = usableHeight / numRows - totalVerticalMargins / numRows;

    return {
      cardWidth: Math.max(160, Math.floor(computedCardWidth)), // clamp so it never gets tiny
      cardHeight: Math.max(140, Math.floor(computedCardHeight)),
    };
  }, [width, height, numColumns, numRows, headerHeight]);

  const projects: {
    id: ProjectKey;
    title: string;
    description: string;
    icon: any;
    color: string;
  }[] = [
    {
      id: "GOKL",
      title: "GOKL",
      description: "Select project: GOKL",
      icon: "project-diagram",
      color: "#111827",
    },
    {
      id: "MBSJ",
      title: "MBSJ",
      description: "Select project: MBSJ",
      icon: "building",
      color: "#2563eb",
    },
  ];

  const onSelect = (project: ProjectKey) => {
    router.push({
      pathname: "./fleet-manager",
      params: { project },
    });
  };

  return (
    <View style={[styles.gridContainer, { padding: sidePadding }]}>
      {projects.map((p) => (
        <Pressable key={p.id} onPress={() => onSelect(p.id)}>
          {({ pressed }) => (
            <View
              style={{
                transform: [
                  { scale: pressed ? 0.97 : 1 },
                  { translateY: pressed ? 2 : 0 },
                ],
              }}
            >
              <Card
                style={[
                  styles.cardBase,
                  { width: cardWidth, height: cardHeight, margin: cardMargin },
                  pressed && styles.cardPressed,
                ]}
              >
                <CardContent style={styles.cardContent}>
                  <View style={[styles.iconWrapper, { backgroundColor: p.color }]}>
                    <FontAwesome5 name={p.icon as any} size={40} color="#fff" />
                  </View>

                  <View style={styles.textWrapper}>
                    <Text style={styles.cardTitle}>{p.title}</Text>
                    <Text style={styles.cardDescription}>{p.description}</Text>
                  </View>
                </CardContent>
              </Card>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },

  cardBase: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,

    // Android shadow
    elevation: 6,

    // iOS shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 1,
  },

  cardPressed: {
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },

  cardContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 16,
  },

  iconWrapper: {
    padding: 16,
    borderRadius: 24,
    marginBottom: 8,
  },

  textWrapper: {
    alignItems: "center",
  },

  cardTitle: {
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
    fontSize: 18,
  },

  cardDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
});
