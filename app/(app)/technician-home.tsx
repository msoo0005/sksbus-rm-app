import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import TyreIcon from "@/components/icons/TyreIcon";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useOutstandingCount } from "@/hooks/useOutstandingCount";
import { useTyreAttention } from "@/hooks/useTyreAttention";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS, ROLE_ICONS } from "@/utils/roles";

const { accent, light } = ROLE_COLORS.technician;

export default function TechnicianHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  // Two cheap scans, so the tyre card can say whether anything is waiting
  // instead of making the technician open it to find out.
  const projectId = useProjectFilter();
  const { overdueBuses, lowTread } = useTyreAttention(projectId);
  const waiting = overdueBuses.length + lowTread.length;
  // Open jobs (available + mine) — the red bubble on the jobs card.
  const outstanding = useOutstandingCount("technician", projectId);

  return (
    <RoleHomeScreen
      roleLabel={t("roles.technician")}
      roleIcon={ROLE_ICONS.technician}
      actionTitle={t("technicianHome.actionTitle")}
      actionDescription={t("technicianHome.actionDescription")}
      ctaLabel={t("technicianHome.ctaLabel")}
      actionIcon="clipboard-check"
      accent={accent}
      accentLight={light}
      onPress={() => router.push("./technician")}
      alertCount={outstanding}
      highlights={[
        { icon: "hand-paper", label: t("technicianHome.highlight1") },
        { icon: "file-alt", label: t("technicianHome.highlight2") },
        { icon: "pen", label: t("technicianHome.highlight3") },
        { icon: "archive", label: t("technicianHome.highlight4") },
      ]}
      secondaryAction={{
        title: t("jobOrder.homeTitle"),
        description: t("jobOrder.homeDescription"),
        icon: "clipboard-list",
        accent,
        accentLight: light,
        prominent: true,
        onPress: () => router.push("/technician/job-order" as any),
      }}
      extraActions={[
        {
          title: t("technicianHome.secondaryTitle"),
          description: t("technicianHome.secondaryDescription"),
          icon: "dot-circle",
          iconElement: <TyreIcon size={20} color={accent} />,
          accent,
          accentLight: light,
          // Recording tyre inspections is one of this role's main jobs, not a
          // side trip, so the card carries the same weight as the jobs CTA above.
          prominent: true,
          badge: waiting > 0 ? t("tyres.section.homeBadge", { count: waiting }) : null,
          onPress: () => router.push("/tyres" as any),
        },
      ]}
    />
  );
}
