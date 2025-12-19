import { StyleSheet, Text, View } from 'react-native';

export default function RMManagerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Repair & Maintenance Manager Dashboard</Text>
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

