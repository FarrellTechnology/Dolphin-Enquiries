import { settings } from "../../utils";

let cronitor: CronitorModule | null = null;
const monitorCache = new Map<string, CronitorMonitor>();

/**
 * Initializes and returns the Cronitor module using the provided configuration.
 * 
 * This function checks if the Cronitor module has already been loaded. If not, it retrieves the Cronitor configuration from the settings 
 * and initializes the module using the API key. If the configuration is missing, an error is thrown.
 * 
 * @returns {Promise<CronitorModule>} A promise that resolves to the initialized Cronitor module.
 * @throws {Error} Throws an error if the Cronitor configuration is not available or incomplete.
 */
async function setupCronitor(): Promise<CronitorModule> {
    if (cronitor) return cronitor; // Return the cached Cronitor module if it exists.

    const config = await settings.getCronitorConfig();
    if (!config) throw new Error("Cronitor config is missing"); // Ensure the config is available

    const loaded = require("cronitor")(config.apiKey); // Load the Cronitor module with the provided API key
    cronitor = loaded as CronitorModule;

    return cronitor;
}

/**
 * Sends a ping to the Cronitor monitor with the specified name and options.
 * 
 * This function ensures that a monitor for the provided name exists in the cache, or creates a new one if not. 
 * It then sends a ping to the monitor, optionally including the state and message for additional context.
 * 
 * @param {string} name - The name of the Cronitor monitor to ping. This name is used to identify and retrieve the monitor from the cache.
 * @param {CronitorPingInput} [options] - Optional configuration for the ping, including `state` (monitor state) and `message` (additional message).
 * 
 * @returns {Promise<void>} A promise that resolves once the ping operation is completed.
 * 
 * @example
 * // Example usage of the ping function:
 * ping("someMonitorName", { state: "success", message: "Ping successful!" });
 */
export async function ping(
    name: string,
    options?: CronitorPingInput
): Promise<void> {
    const cr = await setupCronitor(); // Ensure the Cronitor module is set up and initialized

    // Retrieve the monitor from cache or create a new monitor instance if not found
    let monitor = monitorCache.get(name);
    if (!monitor) {
        monitor = new cr.Monitor(name); // Create a new monitor with the provided name
        monitorCache.set(name, monitor); // Cache the monitor for future use
    }

    // Ping the monitor with the provided state and message, if available
    monitor.ping({
        ...(options?.state && { state: options.state }), // Only add state if it's provided
        ...(options?.message && { message: options.message }), // Only add message if it's provided
    });
}
