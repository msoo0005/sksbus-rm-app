import type { ImageSourcePropType } from "react-native";

// Bundled partner/client logos, keyed by PROJECT.project_id. Metro requires
// static string literals for `require`, so each one is listed explicitly
// rather than built from a template path.
const PROJECT_LOGOS: Record<string, ImageSourcePropType> = {
  GOKL: require("../../assets/images/projects/GOKL.png"),
  UKM: require("../../assets/images/projects/UKM.png"),
  MBSJ: require("../../assets/images/projects/MBSJ.png"),
  MBSA: require("../../assets/images/projects/MBSA.png"),
  UTP: require("../../assets/images/projects/UTP.png"),
  EMUTIARA: require("../../assets/images/projects/EMUTIARA.png"),
  USM: require("../../assets/images/projects/USM.png"),
  UUM: require("../../assets/images/projects/UUM.png"),
  UNIMAP: require("../../assets/images/projects/UNIMAP.png"),
  MBHS: require("../../assets/images/projects/MBHS.png"),
  UMT: require("../../assets/images/projects/UMT.png"),
  MBDK: require("../../assets/images/projects/MBDK.png"),
};

export function getProjectLogo(projectId: string | null | undefined): ImageSourcePropType | null {
  if (!projectId) return null;
  return PROJECT_LOGOS[projectId.trim().toUpperCase()] ?? null;
}
