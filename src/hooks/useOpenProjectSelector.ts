import { usePathname, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Opens the project selector on top of the current screen and comes back to
 * it, so switching project re-renders the screen you were on instead of
 * dropping you at a role home. Shared by the project chip and the home
 * screens' project logo tile.
 */
export function useOpenProjectSelector() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    // `from=chip` tells the selector it was PUSHED onto this screen and can
    // dismiss itself by going back, rather than replacing itself with the
    // screen it is already sitting on top of — which would leave that screen
    // in the stack twice and make the first back press look dead.
    router.push(`/project-selector?returnTo=${encodeURIComponent(pathname)}&from=chip` as any);
  }, [router, pathname]);
}
