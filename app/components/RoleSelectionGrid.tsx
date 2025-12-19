import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from 'expo-router';
import React from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardContent } from './card';



// Get the window width to calculate card size dynamically
const { width, height } = Dimensions.get('window');
const cardMargin = 10;
const numColumns = 2;
const numRows = 2;
const headerHeight = 0.1 * height;
const sidePadding = 10;

// Calculate card size: (screen width - total margins) / number of columns
// We use (numColumns + 1) * cardMargin for total space for 2 outer and 1 inner margin
const cardWidth = ((width - (numColumns + 1) * cardMargin) / numColumns)- sidePadding - cardMargin;
const cardHeight = ((height - headerHeight - (numRows+ 1) * cardMargin) / numRows - headerHeight) - cardMargin;


export default function RoleSelectionGrid(){

  const router = useRouter();

  const roles = [
    {
      id: "fleet-manager",
      title: "Fleet Manager",
      description: "Report problems, repairs & accidents",
      icon: "truck",
      color: "#3b82f6", // blue-500
    },
    {
      id: "rm-manager",
      title: "R&M Manager",
      description: "Approve & queue work orders",
      icon: "clipboard-check",
      color: "#22c55e", // green-500
    },
    {
      id: "technician",
      title: "Technician",
      description: "Complete repairs & maintenance",
      icon: "wrench",
      color: "#f97316", // orange-500
    },
    {
      id: "inventory",
      title: "Inventory Manager",
      description: "Manage parts & supplies",
      icon: "boxes",
      color: "#a855f7", // purple-500
    },
  ];

  return(
      /* A single row wrapper is enough if flexWrap is used */
      <View style={styles.gridContainer}>
        {roles.map((role) => (
          <Pressable
            key={role.id}
            onPress={() => router.push(`./${role.id}`)}>
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
                      styles.card,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <CardContent style={styles.cardContent}>
                      <View style={[styles.iconWrapper, { backgroundColor: role.color }]}>
                        <FontAwesome5 name={role.icon as any} size={40} color="#fff" />
                      </View>
                      <View style={styles.textWrapper}>
                        <Text style={styles.cardTitle}>{role.title}</Text>
                        <Text style={styles.cardDescription}>{role.description}</Text>
                      </View>
                    </CardContent>
                  </Card>
                </View>
              )}
          </Pressable>
        ))}
      </View>
  )
};

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap', // Allows items to wrap to the next line
    // Or 'flex-start' if you want margins to handle spacing
  },
  card: {
    width: cardWidth,
    height: cardHeight,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    margin: cardMargin,

    // Android shadow
    elevation: 6,

    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  cardTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: "center",
  },
  cardNormal: {
    backgroundColor: '#fff', // Normal background
  },
  cardPressed: {
    elevation: 2, // Android
    shadowOffset: { width: 0, height: 1 }, // iOS
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
  cardDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
});
