import AutoLaunch from "auto-launch";
import { app } from "electron";

/**
 * Enables auto-launch for the application on startup.
 * 
 * This function ensures that the "Dolphin Enquiries" application is set to automatically launch when the system starts.
 * It uses the `auto-launch` package to manage this functionality and the Electron app's executable path.
 * 
 * If auto-launch is not already enabled, it will enable it for the current system session.
 * 
 * @returns {Promise<void>} A promise that resolves once the auto-launch has been successfully enabled. 
 * If the auto-launch is already enabled, the promise resolves without any action.
 */
export async function enableAutoLaunch(): Promise<void> {
  const autoLauncher = new AutoLaunch({
    name: "Dolphin Enquiries", // The name that will appear in the startup list.
    path: app.getPath("exe"), // Path to the Electron app's executable.
  });

  // Check if auto-launch is already enabled.
  if (!(await autoLauncher.isEnabled())) {
    // If not enabled, enable auto-launch functionality.
    await autoLauncher.enable();
  }
}
