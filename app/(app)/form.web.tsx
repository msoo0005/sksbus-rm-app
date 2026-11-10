import React from "react";
import MobileOnlyNotice from "@/components/MobileOnlyNotice";
import { useI18n } from "@/i18n/i18n-ctx";

// The web stand-in for the report form.
//
// Filing a report needs three photographs of the vehicle, a verification selfie
// taken at the time, and a location pinned on a map — none of which a desk
// browser can honestly provide. The map is also the hard technical blocker:
// react-native-maps has no web build, and importing it fails the web bundle
// outright. Because Metro picks this file over form.tsx on web, the map never
// enters the bundle.
export default function ReportFormWeb() {
  const { t } = useI18n();
  return (
    <MobileOnlyNotice
      title={t("mobileOnly.formTitle")}
      reason={t("mobileOnly.formReason")}
    />
  );
}
