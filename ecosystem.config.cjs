/**
 * PM2 production topology. Keep exactly one settlement worker: it owns game
 * round settlement. The API can later be scaled behind a load balancer because
 * settlement is claimed atomically in MongoDB.
 */
module.exports = {
  apps: [
    {
      name: "legend-games-api",
      script: "server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      kill_timeout: 10000,
      time: true,
      env: { NODE_ENV: "development" },
      env_production: { NODE_ENV: "production" },
    },
    {
      name: "legend-games-worker",
      script: "server/worker.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "350M",
      kill_timeout: 10000,
      time: true,
      env: { NODE_ENV: "development" },
      env_production: { NODE_ENV: "production" },
    },
  ],
};
