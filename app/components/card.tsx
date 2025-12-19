import * as React from "react";
import { View, Text, StyleSheet, ViewProps, TextProps } from "react-native";

type CardProps = ViewProps;
type CardTextProps = TextProps;

export function Card({ style, ...props }: CardProps) {
  return (
    <View
      style={[styles.card, style]}
      {...props}
    />
  );
}

export function CardHeader({ style, ...props }: CardProps) {
  return (
    <View
      style={[styles.cardHeader, style]}
      {...props}
    />
  );
}

export function CardTitle({ style, ...props }: CardTextProps) {
  return (
    <Text
      style={[styles.cardTitle, style]}
      {...props}
    />
  );
}

export function CardDescription({ style, ...props }: CardTextProps) {
  return (
    <Text
      style={[styles.cardDescription, style]}
      {...props}
    />
  );
}

export function CardAction({ style, ...props }: CardProps) {
  return (
    <View
      style={[styles.cardAction, style]}
      {...props}
    />
  );
}

export function CardContent({ style, ...props }: CardProps) {
  return (
    <View
      style={[styles.cardContent, style]}
      {...props}
    />
  );
}

export function CardFooter({ style, ...props }: CardProps) {
  return (
    <View
      style={[styles.cardFooter, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 16,
    gap: 12,
  },

  cardHeader: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
    gap: 6,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },

  cardDescription: {
    fontSize: 14,
    color: "#6b7280",
  },

  cardAction: {
    alignSelf: "flex-end",
  },

  cardContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },

  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
  },
});
