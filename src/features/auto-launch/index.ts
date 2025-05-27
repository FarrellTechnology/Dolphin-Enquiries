import AutoLaunch from "auto-launch";
import { app } from "electron";

export async function enableAutoLaunch(): Promise<void> {
  const autoLauncher = new AutoLaunch({
    name: "Dolphin Enquiries",
    path: app.getPath("exe"),
  });

  if (!(await autoLauncher.isEnabled())) {
    await autoLauncher.enable();
  }
}
