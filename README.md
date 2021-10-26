# JSON RPC to WebSocket proxy
### for `rippled` (`xrpld`)

Proxy: offers rippled compatible JSON RPC endpoint, internally sending to WebSocket, replying RPC

# Install

1. Clone
2. `npm install`

# Develop

`npm run dev`

# Run:

Runs under PM2 as `RPC2WS`;

`npm run pm2` 

# Environment Vars

- Timeout (uplink WS response) in seconds: `TIMEOUT=60`
- Debug (log) output: `DEBUG=post2ws*`
- Non FH Query offloading (space separated): `NONFHNODES=ws://something:8080 ws://another:80`
