const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Schedule',
  tableName: 'schedules',
  columns: {
    id: {
      primary: true,
      type: 'int',
      generated: true,
    },
    agentName: {
      type: 'varchar',
    },
    type: {
      type: 'varchar',
      default: 'manual',
    },
    name: {
      type: 'varchar',
      nullable: true,
    },
    active: {
      type: 'boolean',
      default: true,
    },
    intervalMinutes: {
      type: 'int',
      nullable: true,
    },
    cronExpression: {
      type: 'varchar',
      nullable: true,
    },
    dailyTime: {
      type: 'varchar',
      nullable: true,
    },
    lastRun: {
      type: 'datetime',
      nullable: true,
    },
    nextRun: {
      type: 'datetime',
      nullable: true,
    },
    createdAt: {
      type: 'datetime',
      createDate: true,
    },
    updatedAt: {
      type: 'datetime',
      updateDate: true,
    },
  },
  relations: {
    agent: {
      target: 'Agent',
      type: 'many-to-one',
      joinColumn: {
        name: 'agentName',
        referencedColumnName: 'name',
      },
      onDelete: 'CASCADE',
    },
  },
});
