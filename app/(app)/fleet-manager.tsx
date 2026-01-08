// FleetManagerScreen.tsx
import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Card, CardContent } from '../components/card';


// ✅ define a strict type (optional but recommended)
type ReportType = 'problem' | 'repair' | 'accident';

export default function FleetManagerScreen() {
  const router = useRouter();

  const report_type: {
    id: string;
    title: string;
    description: string;
    icon: any;
    color: string;
    formType: ReportType; // ✅ add this
  }[] = [
    {
      id: "report-problem",
      title: "Report Problem",
      description: "Vehicle issue or malfunction",
      icon: "exclamation-triangle",
      color: "red",
      formType: "problem",
    },
    {
      id: "request-repair",
      title: "Request Repair",
      description: "Schedule maintenance needed",
      icon: "wrench",
      color: "blue",
      formType: "repair",
    },
    {
      id: "report-accident",
      title: "Report Accident",
      description: "Collision or damage incident",
      icon: "car-crash",
      color: "#f97316",
      formType: "accident",
    },
  ];

  const { width, height } = useWindowDimensions();
  
    const layout = useMemo(() => {
      const cardMargin = 10;
      const sidePadding = 10;
  
      // Example: 2 columns in landscape, 1 column in portrait (tweak to taste)
      const isLandscape = width > height;
      const numColumns = isLandscape ? 1 : 1;
  
      // Compute available width INSIDE the padded container
      const containerWidth = width - sidePadding * 2;
  
      const cardWidth =
        (containerWidth - cardMargin * (numColumns * 2)) / numColumns;
  
      // Height can be a ratio (more stable than “numRows” math)
      const cardHeight = isLandscape ? 270 : 190;
  
      return { cardWidth, cardHeight, cardMargin };
    }, [width, height]);

  return (
    <View style={styles.gridContainer}>
      {report_type.map((report) => (
        <Pressable
          key={report.id}
          onPress={() =>
            router.push({
              pathname: "./form",
              params: { type: report.formType }, // ✅ pass it here
            })
          }
        >
          {({ pressed }) => (
            <View
              style={{
                transform: [
                  { scale: pressed ? 0.97 : 1 },
                  { translateY: pressed ? 2 : 0 },
                ],
              }}
            >
              <Card style={[styles.card, {
                  width: layout.cardWidth,
                  margin: layout.cardMargin,
                 },   pressed && styles.cardPressed]}>
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
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    elevation: 6,
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
  cardDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
});
