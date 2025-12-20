import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from 'expo-router';
import React from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, CardContent } from '../components/card';


// Get the window width to calculate card size dynamically
const { width, height } = Dimensions.get('window');
const cardMargin = 10;
const numColumns = 1;
const numRows = 3;
const headerHeight = 0.1 * height;
const sidePadding = 10;

// Calculate card size: (screen width - total margins) / number of columns
// We use (numColumns + 1) * cardMargin for total space for 2 outer and 1 inner margin
const cardWidth = ((width - (numColumns + 1) * cardMargin) / numColumns) - sidePadding - cardMargin;
const cardHeight = ((height - (numRows+ 1) * cardMargin) / numRows - headerHeight) - cardMargin;


export default function FleetManagerScreen(){

  const router = useRouter();

  const report_type = [
    {
      id: "report-problem",
      title: "Report Probelm",
      description: "Vehicle issue or malfunction",
      icon: "exclamation-triangle",
      color: "red", // blue-500
    },
    {
      id: "request-repair",
      title: "Request Repair",
      description: "Schedule maintenace needed",
      icon: "wrench",
      color: "blue", // green-500
    },
    {
      id: "report-accident",
      title: "Report Accident",
      description: "Collision or damage incident",
      icon: "car-crash",
      color: "#f97316", // orange-500
    },
  ];

  return(
      /* A single row wrapper is enough if flexWrap is used */
      <View style={styles.gridContainer}>
        {report_type.map((report) => (
          <Pressable
            key={report.id}
            onPress={() => router.push(`./${report.id}`)}>
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
                      <View style={[styles.iconWrapper, { backgroundColor: report.color }]}>
                        <FontAwesome5 name={report.icon as any} size={40} color="#fff" />
                      </View>
                      <View style={styles.textWrapper}>
                        <Text style={styles.cardTitle}>{report.title}</Text>
                        <Text style={styles.cardDescription}>{report.description}</Text>
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
    padding: sidePadding
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
    shadowRadius: 1,
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
