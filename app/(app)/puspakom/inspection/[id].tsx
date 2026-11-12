import { useLocalSearchParams } from "expo-router";
import React from "react";
import BusInspectionView from "@/components/puspakom/BusInspectionView";

// Same screen as /puspakom/bus/[busId], reached by inspection id (notifications).
export default function PuspakomInspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BusInspectionView inspectionId={Number(id)} />;
}
