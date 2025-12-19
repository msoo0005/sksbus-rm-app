import { Dimensions, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RoleSelectionGrid from '../components/RoleSelectionGrid';

const { height } = Dimensions.get('window');
const headerHeight = 0.1* height;
const sidePadding = 10

export default function HomeScreen() {  

  return (
    <SafeAreaView style={{flex:1}}>
      <View style = {styles.container}>
        <RoleSelectionGrid/>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center', // Centers the grid vertically
    alignItems: 'center', // Centers the grid horizontally,
    padding: sidePadding,
  },
  header: {
    height: headerHeight,                 // Small title bar
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    backgroundColor: '#fff',
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },

  subHeaderTitle: {
    fontSize: 10,
    fontWeight: '300'
  }
});