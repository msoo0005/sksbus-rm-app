// components/ReportCard.tsx
import { Eye } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import StatusBadge from './StatusBadge';

type Report = {
  id: number;
  type: 'repair' | 'problem';
  severity: 'medium' | 'high' | 'low' | 'critical';
  vehicle: string;
  location: string;
  description: string;
  date: string;
  assigned?: string;
};

type ReportCardProps = {
  report: Report;
};

export default function ReportCard({ report }: ReportCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Report #{report.id}</Text>
          <View style={styles.badges}>
            <StatusBadge label={report.type} type={report.type} />
            <StatusBadge label={report.severity} type="medium" />
          </View>
        </View>
        <Text style={styles.date}>{report.date}</Text>
      </View>

      <Text style={styles.meta}>Vehicle: {report.vehicle}</Text>
      <Text style={styles.meta}>Location: {report.location}</Text>

      <Text style={styles.description}>{report.description}</Text>

      <Pressable style={styles.button}>
        <Eye size={16} />
        <Text style={styles.buttonText}>View Details</Text>
      </Pressable>

      {report.assigned && (
        <Text style={styles.assigned}>
          Assigned to: {report.assigned}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  badges: {
    flexDirection: 'row',
    marginTop: 6,
  },
  date: {
    fontSize: 12,
    color: '#666',
  },
  meta: {
    marginTop: 8,
    color: '#666',
  },
  description: {
    marginTop: 12,
    fontSize: 14,
  },
  button: {
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: {
    fontWeight: '600',
  },
  assigned: {
    marginTop: 10,
    fontSize: 12,
    color: '#666',
  },
});
