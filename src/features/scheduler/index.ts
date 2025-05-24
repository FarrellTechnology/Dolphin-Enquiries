import schedule from "node-schedule";

export function setupScheduler(task: () => void) {
  schedule.scheduleJob("0 1 * * *", () => void task());
}
