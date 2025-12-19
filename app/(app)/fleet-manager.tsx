import { View, Text, StyleSheet } from 'react-native';

export default function FleetManagerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Fleet Manager Dashboard</Text>
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
