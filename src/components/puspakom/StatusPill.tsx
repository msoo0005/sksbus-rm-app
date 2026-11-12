import React from "react";
import type { ViewStyle } from "react-native";
import type { PspStatus } from "../../api/puspakom";
import { useI18n } from "../../i18n/i18n-ctx";
import { STATUS_TONE } from "../../utils/puspakom";
import Pill from "./Pill";

export default function StatusPill({ status, style }: { status: PspStatus | "PASSED"; style?: ViewStyle }) {
  const { t } = useI18n();
  return <Pill label={t(`puspakom.status.${status}`)} tone={STATUS_TONE[status]} style={style} />;
}
