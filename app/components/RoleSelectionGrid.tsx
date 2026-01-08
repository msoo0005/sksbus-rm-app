import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Card, CardContent } from "./card";


type Props = {
  allowedRoles: string[];
};

export default function RoleSelectionGrid({ allowedRoles }: Props) {
  const router = useRouter();

  const { width, height } = useWindowDimensions();

  const layout = useMemo(() => {
    const cardMargin = 10;
    const sidePadding = 10;

    // Example: 2 columns in landscape, 1 column in portrait (tweak to taste)
    const isLandscape = width > height;
    const numColumns = isLandscape ? 2 : 1;

    // Compute available width INSIDE the padded container
    const containerWidth = width - sidePadding * 2;

    const cardWidth =
      (containerWidth - cardMargin * (numColumns * 2)) / numColumns;

    // Height can be a ratio (more stable than “numRows” math)
    const cardHeight = isLandscape ? 270 : 190;

    return { cardWidth, cardHeight, cardMargin };
  }, [width, height]);

  const roles = [
    {
      id: "fleet-manager",
      title: "Fleet Manager",
      description: "Report problems, repairs & accidents",
      icon: "truck",
      color: "#3b82f6",
    },
    {
      id: "rm-manager",
      title: "R&M Manager",
      description: "Approve & queue work orders",
      icon: "clipboard-check",
      color: "#22c55e",
    },
    {
      id: "technician",
      title: "Technician",
      description: "Complete repairs & maintenance",
      icon: "wrench",
      color: "#f97316",
    },
    {
      id: "inventory",
      title: "Inventory Manager",
      description: "Manage parts & supplies",
      icon: "boxes",
      color: "#a855f7",
    },
  ];

  const handleRolePress = (roleId: string) => {
    // ✅ new flow for Fleet Manager only
    if (roleId === "fleet-manager") {
      router.push("./project-selector");
      return;
    }

    // ✅ other roles keep existing behaviour
    router.push(`./${roleId}` as any);
  };

  return (
    <View style={styles.gridContainer}>
      {roles.map((role) => {
        const enabled = allowedRoles.includes(role.id);

        return (
          <Pressable
            key={role.id}
            disabled={!enabled}
            onPress={() => handleRolePress(role.id)}
            style={{ opacity: enabled ? 1 : 0.45 }}
          >
            {({ pressed }) => (
              <View
                style={{
                  transform: enabled
                    ? [
                        { scale: pressed ? 0.97 : 1 },
                        { translateY: pressed ? 2 : 0 },
                      ]
                    : undefined,
                }}
              >
                <Card
                  style={[
                    styles.card,
                      {
                  width: layout.cardWidth,
                  margin: layout.cardMargin,
                 },  
                    !enabled && styles.cardDisabled,
                    pressed && enabled && styles.cardPressed,
                  ]}
                >
                  <CardContent style={styles.cardContent}>
                    <View
                      style={[
                        styles.iconWrapper,
                        {
                          backgroundColor: enabled ? role.color : "#d1d5db",
                        },
                      ]}
                    >
                      <FontAwesome5
                        name={role.icon as any}
                        size={40}
                        color={enabled ? "#fff" : "#9ca3af"}
                      />
                    </View>

                    <View style={styles.textWrapper}>
                      <Text
                        style={[
                          styles.cardTitle,
                          !enabled && styles.textDisabled,
                        ]}
                      >
                        {role.title}
                      </Text>

                      <Text
                        style={[
                          styles.cardDescription,
                          !enabled && styles.textDisabled,
                        ]}
                      >
                        {role.description}
                      </Text>
                    </View>
                  </CardContent>
                </Card>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    elevation: 6,
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
  cardDisabled: {
    backgroundColor: "#f3f4f6",
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
  },
  cardDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
  textDisabled: {
    color: "#9ca3af",
  },
});
