const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Agent',
  tableName: 'agents',
  columns: {
    name: {
      primary: true,
      type: 'varchar',
    },
    status: {
      type: 'varchar',
      default: 'idle',
    },
    currentActivity: {
      type: 'varchar',
      nullable: true,
    },
    runsToday: {
      type: 'int',
      default: 0,
    },
    commentsToday: {
      type: 'int',
      default: 0,
    },
    lastRun: {
      type: 'datetime',
      nullable: true,
    },
    ip: {
      type: 'varchar',
      nullable: true,
    },
    browserOpen: {
      type: 'boolean',
      default: false,
    },
    logs: {
      type: 'simple-json',
      default: '[]',
    },
    customInstructions: {
      type: 'text',
      default: '',
    },
    visitedSubreddits: {
      type: 'simple-json',
      default: '[]',
    },
    postedComments: {
      type: 'simple-json',
      default: '[]',
    },
    allowedSites: {
      type: 'simple-json',
      default: '[]',
    },
    blockedSites: {
      type: 'simple-json',
      default: '[]',
    },
    runtimeMinutes: {
      type: 'int',
      default: 10,
    },
    pageTimeSeconds: {
      type: 'int',
      default: 30,
    },
    targetSubreddits: {
      type: 'simple-json',
      default: '[]',
    },
    searchTopics: {
      type: 'simple-json',
      default: '[]',
    },
    commentFrequency: {
      type: 'varchar',
      default: 'medium',
    },
    upvotesPerSession: {
      type: 'int',
      default: 5,
    },
    enabled: {
      type: 'boolean',
      default: true,
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
    runs: {
      target: 'AgentRun',
      type: 'one-to-many',
      inverseSide: 'agent',
    },
    comments: {
      target: 'PostedComment',
      type: 'one-to-many',
      inverseSide: 'agent',
    },
    schedules: {
      target: 'Schedule',
      type: 'one-to-many',
      inverseSide: 'agent',
    },
  },
});
