import { SplashScreen } from 'expo-router';
import { useSession } from './ctx';

SplashScreen.preventAutoHideAsync();

export function SplashScreenController() {
  const { loading } = useSession();

  if (!loading) {
    SplashScreen.hide();
  }

  return null;
}
