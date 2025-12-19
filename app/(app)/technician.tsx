import { StyleSheet, Text, View } from 'react-native';

export default function TechnicianScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Technician Dashboard</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 24,
    fontWeight: '600',
  },
});
