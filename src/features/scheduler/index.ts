import schedule from 'node-schedule';
import { logToFile } from "../../utils";  // Assuming logToFile is imported from utils

const scheduledJobs: schedule.Job[] = [];

/**
 * Sets up the scheduler with the provided tasks.
 * This function cancels any existing scheduled jobs before scheduling the new ones.
 * 
 * @param {...ScheduledTask[]} tasks - The tasks to be scheduled, each with a cron expression and a task function.
 * @returns {void}
 * 
 * @example
 * setupScheduler(
 *   { task: myTaskFunction, schedule: '0 2 * * *' },
 *   { task: anotherTaskFunction }
 * );
 */
export function setupScheduler(...tasks: ScheduledTask[]): void {
  // Cancel any previously scheduled jobs
  scheduledJobs.forEach(job => job.cancel());
  scheduledJobs.length = 0;

  // Schedule new tasks based on the provided cron times
  for (const { task, schedule: cronTime = '0 1 * * *' } of tasks) {
    const job = schedule.scheduleJob(cronTime, () => {
      const taskName = task.name || "Unnamed Task"; // Get task name or use a default name
      logToFile("scheduler", `Scheduled task "${taskName}" started at ${new Date().toISOString()}`);
      
      try {
        void task();
        logToFile("scheduler", `Scheduled task "${taskName}" completed successfully at ${new Date().toISOString()}`);
      } catch (e) {
        console.error('Scheduled task error:', e);
        logToFile("scheduler", `Scheduled task "${taskName}" failed at ${new Date().toISOString()}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    scheduledJobs.push(job);
  }
}
