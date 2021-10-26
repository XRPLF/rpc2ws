module.exports = {
  apps: [{
    name: 'RPC2WS',
    script: 'index.js',
    watch: true,
    instances: 4,
    autorestart: true,
    max_memory_restart: '1000M',
    exec_mode: 'cluster',
    ignore_watch: ["node_modules", "db", ".git"],
    env: {
      DEBUG: 'post2ws*',
      PORT: 80,
      TIMEOUT: 60,
      NONFHNODES: ''
    }
  }]
}
