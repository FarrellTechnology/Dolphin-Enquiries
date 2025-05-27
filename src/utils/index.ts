import path from "path";
import { app } from "electron";

export * from "./settings";

function resolveAppPath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", ...segments)
    : path.join(__dirname, "..", "..", "src", "assets", ...segments);
}

export function documentsFolder(): string {
  return app.getPath("documents");
}

export const assets = {
  template: (...segments: string[]) => resolveAppPath("templates", ...segments),
  image: (...segments: string[]) => resolveAppPath("images", ...segments),
  js: (...segments: string[]) => resolveAppPath("js", ...segments),
};