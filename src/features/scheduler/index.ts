import schedule from "node-schedule";

const scheduledJobs: schedule.Job[] = [];

export function setupScheduler(...tasks: Array<() => void>) {
  // Cancel any existing jobs
  scheduledJobs.forEach(job => job.cancel());
  scheduledJobs.length = 0;

  for (const task of tasks) {
    const job = schedule.scheduleJob("0 1 * * *", () => {
      try {
        void task();
      } catch (e) {
        console.error('Scheduled task error:', e);
      }
    });
    scheduledJobs.push(job);
  }
}
