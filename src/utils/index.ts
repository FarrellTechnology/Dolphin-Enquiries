import path from "path";
import { app } from "electron";

function resolveAppPath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", ...segments)
    : path.join(__dirname, "..", "..", "src", "assets", ...segments);
}

export function getTemplate(...segments: string[]) {
  return resolveAppPath("templates", ...segments);
}

export function getImage(...segments: string[]) {
  return resolveAppPath("images", ...segments);
}

export function getJs(...segments: string[]) {
  return resolveAppPath("js", ...segments);
}