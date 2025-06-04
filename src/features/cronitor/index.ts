import { settings } from "../../utils";

let cronitor: CronitorModule | null = null;
const monitorCache = new Map<string, CronitorMonitor>();

async function setupCronitor(): Promise<CronitorModule> {
    if (cronitor) return cronitor;

    const config = await settings.getCronitorConfig();
    if (!config) throw new Error("Cronitor config is missing");

    const loaded = require("cronitor")(config.apiKey);
    cronitor = loaded as CronitorModule;

    return cronitor;
}

export async function ping(
    name: string,
    options?: CronitorPingInput
): Promise<void> {
    const cr = await setupCronitor();

    let monitor = monitorCache.get(name);
    if (!monitor) {
        monitor = new cr.Monitor(name);
        monitorCache.set(name, monitor);
    }

    monitor.ping({
        ...(options?.state && { state: options.state }),
        ...(options?.message && { message: options.message }),
    });
}
