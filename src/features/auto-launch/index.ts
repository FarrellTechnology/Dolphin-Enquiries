import AutoLaunch from "auto-launch";

export async function enableAutoLaunch(): Promise<void> {
  const autoLauncher = new AutoLaunch({
    name: "Dolphin Enquiries",
    path: require("electron").app.getPath("exe"),
  });

  if (!(await autoLauncher.isEnabled())) {
    await autoLauncher.enable();
  }
}
