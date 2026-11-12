import { FontAwesome5 } from "@expo/vector-icons";
import { Eye } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { Report } from "../types/report";
import { busSystemLabel } from "../utils/busSystems";
import { reportTypeTitleLabel } from "../utils/reportType";
import ElapsedTimer from "./ElapsedTimer";
import PersonChip from "./PersonChip";
import StatusBadge from "./StatusBadge";

type ReportCardProps = {
  report: Report;
  onViewDetails?: (report: Report) => void;
  onAccept?: (report: Report) => void;
  onApprove?: (report: Report) => void;
  onDecline?: (report: Report) => void;
  currentTech?: string;
};

export default function ReportCard({
  report,
  onViewDetails,
  onAccept,
  onApprove,
  onDecline,
  currentTech,
}: ReportCardProps) {
  const { t } = useI18n();
  const isDeclined = report.audit?.action === "declined";

  const showAccept = !!(
    onAccept &&
    report.status === "open" &&
    !report.assigned
  );

  const showManagerActions = !!(
    onApprove &&
    onDecline &&
    report.status === "pending"
  );

  const declineReason = report.audit?.reason?.trim();
  const isJobOrder = report.type === "job_order";

  return (
    <View style={styles.card}>
      {/* Header: title, the vehicle right under it, then the date. Priority
          and the open timer sit top-right, same size, priority first. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>
            {reportTypeTitleLabel(report.type, t)} #{report.id}
          </Text>
          <View style={styles.vehicleRow}>
            <FontAwesome5 name="bus" size={13} color="#374151" />
            <Text style={styles.vehicle}>
              {report.vehicle}
              {!!report.evNumber && <Text style={styles.vehicleEv}>{`  (${report.evNumber})`}</Text>}
            </Text>
          </View>
          <Text style={styles.date}>{report.date}</Text>
          {(isDeclined || isJobOrder) && (
            <View style={styles.badges}>
              {isDeclined && <StatusBadge type="critical" size="sm" label={t("statusBadge.declined")} />}
              {isJobOrder && (
                <View style={styles.jobOrderTag}>
                  <Text style={styles.jobOrderTagText}>{t("jobOrder.tag")}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {!isJobOrder && <StatusBadge type={report.severity} size="sm" style={styles.rightPill} />}
          <ElapsedTimer
            since={report.dateIso}
            until={report.status === "closed" ? report.closedAt : null}
            style={styles.rightPill}
          />
        </View>
      </View>

      {/* Meta */}
      <Text style={styles.meta}>{t("reportCard.location", { value: report.location })}</Text>

      {report.reporter && (report.reporter.username || report.reporter.name) ? (
        <View style={styles.reporterRow}>
          <PersonChip
            label={t("signoffs.reportedBy")}
            name={report.reporter.name}
            username={report.reporter.username}
            selfieUrl={report.reporter.selfieUrl}
            size={36}
          />
        </View>
      ) : (
        !!report.reportedBy && (
          <Text style={styles.meta}>{t("reportCard.reportedBy", { value: report.reportedBy })}</Text>
        )
      )}

      {report.assignee && (report.assignee.username || report.assignee.name) ? (
        <View style={styles.reporterRow}>
          <PersonChip
            label={
              report.assignee.username && report.assignee.username === currentTech
                ? `${t("signoffs.assignedTo")} · ${t("reportCard.you")}`
                : t("signoffs.assignedTo")
            }
            name={report.assignee.name}
            username={report.assignee.username}
            selfieUrl={report.assignee.selfieUrl}
            size={36}
          />
        </View>
      ) : (
        !!report.assigned && (
          <Text style={styles.meta}>
            {t("reportCard.assignedTo", {
              value: report.assigned === currentTech ? t("reportCard.you") : report.assigned,
            })}
          </Text>
        )
      )}

      <Text style={styles.description}>
        <Text style={styles.issueLabel}>{t("reportCard.issue")} </Text>
        {report.description}
      </Text>
      {!!report.issueType && (
        <Text style={styles.issueType}>{busSystemLabel(report.issueType, t)}</Text>
      )}

      {isDeclined && (
        <View style={styles.declineBox}>
          <Text style={styles.declineTitle}>{t("reportCard.declineReasonTitle")}</Text>
          <Text style={styles.declineText}>
            {declineReason ? declineReason : t("reportCard.noReasonProvided")}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionRow}>
        <Pressable
          style={styles.button}
          onPress={() => onViewDetails?.(report)}
        >
          <Eye size={16} color="#111827" />
          <Text style={styles.buttonText}>{t("reportCard.viewDetails")}</Text>
        </Pressable>

        {showAccept && (
          <Pressable
            style={[styles.button, styles.acceptButton]}
            onPress={() => onAccept?.(report)}
          >
            <Text style={styles.whiteText}>{t("reportCard.acceptJob")}</Text>
          </Pressable>
        )}
      </View>

      {showManagerActions && (
        <View style={styles.managerRow}>
          <Pressable
            style={[styles.button, styles.approveButton]}
            onPress={() => onApprove?.(report)}
          >
            <Text style={styles.whiteText}>{t("reportCard.approve")}</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.declineButton]}
            onPress={() => onDecline?.(report)}
          >
            <Text style={styles.whiteText}>{t("reportCard.decline")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "stretch", gap: 6, minWidth: 104 },
  rightPill: { justifyContent: "center" },

  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4 },
  vehicle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  vehicleEv: { fontWeight: "700", color: "#4B5563" },

  jobOrderTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#F3E8FF",
  },
  jobOrderTagText: { fontSize: 12, fontWeight: "800", color: "#7E22CE" },

  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },

  badges: {
    flexDirection: "row",
    marginTop: 6,
    gap: 6,
    flexWrap: "wrap",
  },

  date: {
    fontSize: 16,
    color: "#666",
    marginTop: 2,
  },

  reporterRow: { marginVertical: 6 },
  meta: {
    marginTop: 8,
    color: "#666",
  },

  description: {
    marginTop: 12,
    fontSize: 15,
    color: "#111827",
    lineHeight: 21,
  },
  issueLabel: { fontWeight: "800" },
  issueType: { marginTop: 4, fontSize: 12, fontWeight: "600", color: "#6B7280" },

  declineBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#FFF3F3",
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#E53935",
  },
  declineTitle: { fontWeight: "700", color: "#E53935" },
  declineText: { marginTop: 4, color: "#333" },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  managerRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },

  button: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },

  acceptButton: {
    backgroundColor: "#4CAF50",
    borderColor: "#4CAF50",
  },
  approveButton: {
    backgroundColor: "#4CAF50",
    borderColor: "#4CAF50",
  },
  declineButton: {
    backgroundColor: "#E53935",
    borderColor: "#E53935",
  },

  buttonText: { fontWeight: "600", color: "#111827" },
  whiteText: { color: "#fff", fontWeight: "600" },
});
