const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'AgentRun',
  tableName: 'agent_runs',
  columns: {
    id: {
      primary: true,
      type: 'int',
      generated: true,
    },
    agentName: {
      type: 'varchar',
    },
    startTime: {
      type: 'datetime',
      nullable: true,
    },
    endTime: {
      type: 'datetime',
      nullable: true,
    },
    durationMinutes: {
      type: 'int',
      default: 0,
    },
    status: {
      type: 'varchar',
      default: 'running',
    },
    ip: {
      type: 'varchar',
      nullable: true,
    },
    runsCount: {
      type: 'int',
      default: 0,
    },
    commentsCount: {
      type: 'int',
      default: 0,
    },
    visitedSubreddits: {
      type: 'simple-json',
      default: '[]',
    },
    errorMessage: {
      type: 'text',
      nullable: true,
    },
    createdAt: {
      type: 'datetime',
      createDate: true,
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
