const schedule = require('node-schedule');
const { AppDataSource } = require('../database');

class ScheduleService {
  constructor(agentService) {
    this.repo = AppDataSource.getRepository(require('../entities/Schedule'));
    this.activeJobs = new Map();
    this.agentService = agentService;
    this.triggerAgentRun = null;
  }

  async getAll() {
    return this.repo.find();
  }

  async getByAgent(agentName) {
    return this.repo.findBy({ agentName });
  }

  async create(data) {
    const scheduleEntity = this.repo.create(data);
    const saved = await this.repo.save(scheduleEntity);
    if (saved.active) {
      this.scheduleJob(saved);
    }
    return saved;
  }

  async update(id, data) {
    const existing = await this.repo.findOneBy({ id });
    if (!existing) return null;

    if (existing.active && this.activeJobs.has(id)) {
      this.activeJobs.get(id).job.cancel();
      this.activeJobs.delete(id);
    }

    await this.repo.update({ id }, data);
    const updated = await this.repo.findOneBy({ id });
    if (updated && updated.active) {
      this.scheduleJob(updated);
    }
    return updated;
  }

  async delete(id) {
    const existing = await this.repo.findOneBy({ id });
    if (!existing) return false;

    if (this.activeJobs.has(id)) {
      this.activeJobs.get(id).job.cancel();
      this.activeJobs.delete(id);
    }

    const result = await this.repo.delete({ id });
    return result.affected ? result.affected > 0 : false;
  }

  async toggle(id) {
    const existing = await this.repo.findOneBy({ id });
    if (!existing) return null;

    existing.active = !existing.active;
    const saved = await this.repo.save(existing);

    if (saved.active) {
      this.scheduleJob(saved);
    } else if (this.activeJobs.has(id)) {
      this.activeJobs.get(id).job.cancel();
      this.activeJobs.delete(id);
    }

    return saved;
  }

  scheduleJob(scheduleEntity) {
    let job;

    switch (scheduleEntity.type) {
      case 'interval':
        if (scheduleEntity.intervalMinutes) {
          job = schedule.scheduleJob(`*/${scheduleEntity.intervalMinutes} * * * *`, () => {
            this.runAgent(scheduleEntity.agentName);
          });
        }
        break;
      case 'cron':
        if (scheduleEntity.cronExpression) {
          job = schedule.scheduleJob(scheduleEntity.cronExpression, () => {
            this.runAgent(scheduleEntity.agentName);
          });
        }
        break;
      case 'daily':
        if (scheduleEntity.dailyTime) {
          const [hour, minute] = scheduleEntity.dailyTime.split(':').map(Number);
          job = schedule.scheduleJob({ hour, minute }, () => {
            this.runAgent(scheduleEntity.agentName);
          });
        }
        break;
      case 'manual':
      default:
        return;
    }

    if (job) {
      this.activeJobs.set(scheduleEntity.id, { schedule: scheduleEntity, job });
    }
  }

  async runAgent(agentName) {
    const agent = await this.agentService.getByName(agentName);
    if (agent && agent.enabled && agent.status === 'idle') {
      console.log(`[Schedule] Running agent: ${agentName}`);
      if (typeof this.triggerAgentRun === 'function') {
        await this.triggerAgentRun(agentName, { source: 'schedule' });
      }
    }
  }

  async loadActiveSchedules() {
    const activeSchedules = await this.repo.findBy({ active: true });
    for (const s of activeSchedules) {
      this.scheduleJob(s);
    }
    console.log(`[Schedule] Loaded ${activeSchedules.length} active schedules`);
  }

  async cancelAll() {
    for (const [id, { job }] of this.activeJobs) {
      job.cancel();
    }
    this.activeJobs.clear();
  }

  setRunner(triggerAgentRun) {
    this.triggerAgentRun = triggerAgentRun;
  }
}

module.exports = { ScheduleService };
