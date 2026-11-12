import { useLocalSearchParams } from "expo-router";
import React from "react";
import BusInspectionView from "@/components/puspakom/BusInspectionView";

export default function PuspakomBusScreen() {
  const { busId } = useLocalSearchParams<{ busId: string }>();
  return <BusInspectionView busId={String(busId)} />;
}
