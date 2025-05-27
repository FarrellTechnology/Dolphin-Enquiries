import schedule from 'node-schedule';

const scheduledJobs: schedule.Job[] = [];

export function setupScheduler(...tasks: ScheduledTask[]) {
  scheduledJobs.forEach(job => job.cancel());
  scheduledJobs.length = 0;

  for (const { task, schedule: cronTime = '0 1 * * *' } of tasks) {
    const job = schedule.scheduleJob(cronTime, () => {
      try {
        void task();
      } catch (e) {
        console.error('Scheduled task error:', e);
      }
    });
    scheduledJobs.push(job);
  }
}
