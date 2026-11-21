import { Platform } from "react-native";

// How a scrolling screen hides the keyboard: on iPhone it follows a finger
// dragging down, on Android it goes away once the user scrolls. Used on every
// scroll view so the keyboard can always be put away.
export const KEYBOARD_DISMISS_MODE = Platform.OS === "ios" ? ("interactive" as const) : ("on-drag" as const);
