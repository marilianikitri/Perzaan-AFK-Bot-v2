const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');
const readline = require('readline');

let setupLeaveRejoin = null;
try {
  setupLeaveRejoin = require('./leaveRejoin');
} catch (err) {
  console.log('[Rejoin] Optional ./leaveRejoin.js not found, skipping.');
}

// ============================================================
// EXPRESS SERVER - Health & Dashboard for Railway
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  lastDisconnectReason: 'Starting up...',
  errors: []
};

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
          }
          .container {
            background: #1e293b;
            padding: 36px;
            border-radius: 20px;
            box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
            text-align: center;
            width: 420px;
            border: 1px solid #334155;
            transition: box-shadow 0.3s ease;
          }
          h1 { margin-bottom: 24px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card {
            background: #0f172a;
            padding: 14px;
            margin: 12px 0;
            border-radius: 12px;
            border-left: 5px solid #2dd4bf;
            text-align: left;
            box-shadow: 5px 5px 15px rgba(0, 0, 0, 0.3);
            word-break: break-word;
          }
          .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 16px; font-weight: bold; color: #2dd4bf; margin-top: 4px; }
          .status-dot {
            height: 12px; width: 12px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 8px;
            box-shadow: 0 0 10px currentColor;
            background-color: currentColor;
          }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
        </style>
      </head>
      <body>
        <div class="container" id="main-container">
          <h1>
            <span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span>
            ${config.name}
          </h1>

          <div class="stat-card">
            <div class="label">Status</div>
            <div class="value" id="status-text">Connecting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Last Event / Reason</div>
            <div class="value" id="reason-text" style="font-size: 13px; color: #cbd5e1;">Starting up...</div>
          </div>

          <div class="stat-card">
            <div class="label">Uptime</div>
            <div class="value" id="uptime-text">0h 0m 0s</div>
          </div>

          <div class="stat-card">
            <div class="label">Coordinates</div>
            <div class="value" id="coords-text">Waiting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Server</div>
            <div class="value">${config.server.ip}:${config.server.port}</div>
          </div>
        </div>

        <script>
          const formatUptime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return \`\${h}h \${m}m \${s}s\`;
          };

          const updateStats = async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();

              const statusText = document.getElementById('status-text');
              const reasonText = document.getElementById('reason-text');
              const uptimeText = document.getElementById('uptime-text');
              const coordsText = document.getElementById('coords-text');
              const liveDot = document.getElementById('live-indicator');
              const container = document.getElementById('main-container');

              if (data.status === 'connected') {
                statusText.innerHTML = '<span class="status-dot" style="color: #4ade80;"></span> Online & Running';
                statusText.style.color = '#2dd4bf';
                liveDot.style.color = '#4ade80';
                container.style.boxShadow = '0 0 50px rgba(45, 212, 191, 0.2)';
              } else {
                statusText.innerHTML = '<span class="status-dot" style="color: #f87171;"></span> Reconnecting (Attempt #' + data.reconnectAttempts + ')';
                statusText.style.color = '#f87171';
                liveDot.style.color = '#f87171';
                container.style.boxShadow = '0 0 50px rgba(248, 113, 113, 0.2)';
              }

              reasonText.innerText = data.lastDisconnectReason || 'None';
              uptimeText.innerText = formatUptime(data.uptime);

              if (data.coords) {
                coordsText.innerText = \`\${Math.floor(data.coords.x)}, \${Math.floor(data.coords.y)}, \${Math.floor(data.coords.z)}\`;
              } else {
                coordsText.innerText = 'Not spawned yet';
              }
            } catch (e) {
              document.getElementById('status-text').innerText = 'System Offline';
              document.getElementById('live-indicator').style.color = '#64748b';
            }
          };

          setInterval(updateStats, 1000);
          updateStats();
        </script>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    lastDisconnectReason: botState.lastDisconnectReason,
    memoryUsageMB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2))
  });
});

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${PORT}`);
});

// ============================================================
// LOCAL HEALTH CHECK PING
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;

setInterval(() => {
  http.get(`http://127.0.0.1:${PORT}/ping`, (res) => {
    res.resume();
  }).on('error', (err) => {
    console.log(`[KeepAlive] Local ping failed: ${err.message}`);
  });
}, SELF_PING_INTERVAL);

// ============================================================
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeout = null;
let isReconnecting = false;
let isShuttingDown = false;

function clearAllIntervals() {
  activeIntervals.forEach(id => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  const baseDelay = config.utils['auto-reconnect-delay'] || 10000;
  const maxDelay = config.utils['max-reconnect-delay'] || 60000;
  return Math.min(baseDelay + (botState.reconnectAttempts * 2000), maxDelay);
}

function createBot() {
  if (isShuttingDown || isReconnecting) return;

  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      console.log('[Cleanup] Error ending previous bot:', e.message);
    }
    bot = null;
  }

  const configuredVersion =
    !config.server.version || config.server.version.toLowerCase() === 'auto'
      ? false
      : config.server.version;

  console.log(`[Bot] Connecting to ${config.server.ip}:${config.server.port} (version: ${configuredVersion || 'auto'})`);
  botState.lastDisconnectReason = `Connecting to ${config.server.ip}:${config.server.port}...`;

  try {
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      password: config['bot-account'].password || undefined,
      auth: config['bot-account'].type,
      host: config.server.ip,
      port: Number(config.server.port),
      version: configuredVersion,
      hideErrors: false,
      checkTimeoutInterval: 120000
    });

    bot.loadPlugin(pathfinder);

    let spawned = false;
    const connectionTimeout = setTimeout(() => {
      if (!spawned && !isShuttingDown) {
        console.log('[Bot] Connection timeout - no spawn received within 60s');
        botState.lastDisconnectReason = 'Connection timeout (no spawn within 60s)';
        try {
          bot.end();
        } catch (e) {}
        scheduleReconnect();
      }
    }, 60000);

    bot.once('spawn', () => {
      clearTimeout(connectionTimeout);
      spawned = true;
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      botState.lastDisconnectReason = 'Spawned and active';
      isReconnecting = false;

      console.log(`[Bot] [+] Successfully spawned on server! (Protocol version: ${bot.version})`);

      if (config.discord && config.discord.events && config.discord.events.connect) {
        sendDiscordWebhook(`[+] **Connected** to \`${config.server.ip}:${config.server.port}\``, 0x4ade80);
      }

      const mcData = require('minecraft-data')(bot.version);
      const defaultMove = new Movements(bot, mcData);

      initializeModules(bot, mcData, defaultMove);

      // Only run leaveRejoin if periodic-rejoin is explicitly enabled
      if (
        config.utils['periodic-rejoin'] &&
        config.utils['periodic-rejoin'].enabled &&
        typeof setupLeaveRejoin === 'function'
      ) {
        setupLeaveRejoin(bot, createBot);
      }
    });

    bot.on('kicked', (reason) => {
      const formattedReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
      console.log('[KICK]', formattedReason);
      botState.lastDisconnectReason = `Kicked: ${formattedReason}`;
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
      botState.lastDisconnectReason = `Error: ${err.message}`;
      botState.errors.push({ type: 'error', message: err.message, time: Date.now() });
    });

    bot.on('end', (reason) => {
      clearTimeout(connectionTimeout);
      const endReason = reason || botState.lastDisconnectReason || 'Disconnected';
      console.log(`[Bot] Disconnected: ${endReason}`);
      botState.connected = false;
      botState.lastDisconnectReason = `Disconnected: ${endReason}`;
      clearAllIntervals();

      if (config.discord && config.discord.events && config.discord.events.disconnect && reason !== 'Periodic Rejoin') {
        sendDiscordWebhook(`[-] **Disconnected**: ${endReason}`, 0xf87171);
      }

      if (!isShuttingDown && config.utils['auto-reconnect']) {
        scheduleReconnect();
      }
    });
  } catch (err) {
    console.log(`[Bot] Failed to create bot: ${err.message}`);
    botState.lastDisconnectReason = `Create failed: ${err.message}`;
    if (!isShuttingDown) {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect() {
  if (isShuttingDown || isReconnecting) return;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  console.log(`[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`);

  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  console.log('[Modules] Initializing modules...');

  let authDone = false;
  const authPassword =
    (config.utils['auto-auth'] && config.utils['auto-auth'].password) ||
    config['bot-account'].password ||
    'qwerty123';

  if (config.utils['auto-auth'] && config.utils['auto-auth'].enabled) {
    bot.on('messagestr', (msg) => {
      if (config.utils['chat-log']) {
        console.log(`[Chat] ${msg}`);
      }
      if (authDone) return;
      const message = msg.toLowerCase();

      if (message.includes('/register') || message.includes('register')) {
        authDone = true;
        setTimeout(() => {
          if (bot && botState.connected) {
            bot.chat(`/register ${authPassword} ${authPassword}`);
            console.log('[Auth] Register command sent');
          }
        }, 1500);
      } else if (message.includes('/login') || message.includes('login')) {
        authDone = true;
        setTimeout(() => {
          if (bot && botState.connected) {
            bot.chat(`/login ${authPassword}`);
            console.log('[Auth] Login command sent');
          }
        }, 1500);
      }
    });
  }

  if (config.position && config.position.enabled) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new GoalBlock(config.position.x, config.position.y, config.position.z));
  }

  if (config.utils['anti-afk'] && config.utils['anti-afk'].enabled) {
    addInterval(() => {
      if (bot && botState.connected) {
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot && botState.connected) bot.setControlState('jump', false);
        }, 100);
        botState.lastActivity = Date.now();
      }
    }, 30000);

    if (config.utils['anti-afk'].sneak) {
      bot.setControlState('sneak', true);
    }
  }

  if (config.movement && config.movement.enabled) {
    if (config.movement['circle-walk'] && config.movement['circle-walk'].enabled) {
      startCircleWalk(bot, defaultMove);
    }
    if (config.movement['random-jump'] && config.movement['random-jump'].enabled) {
      startRandomJump(bot);
    }
    if (config.movement['look-around'] && config.movement['look-around'].enabled) {
      startLookAround(bot);
    }
  }

  if (config.modules) {
    if (config.modules.avoidMobs) avoidMobs(bot);
    if (config.modules.combat) combatModule(bot, mcData);
    if (config.modules.beds) bedModule(bot);
    if (config.modules.chat) chatModule(bot);
  }

  console.log('[Modules] Modules initialized!');
}

// ============================================================
// MOVEMENT & CUSTOM MODULES
// ============================================================
function startCircleWalk(bot, defaultMove) {
  const radius = config.movement['circle-walk'].radius || 4;
  let angle = 0;
  let lastPathTime = 0;

  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;

    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(bot.entity.position.y), Math.floor(z)));
      angle += Math.PI / 4;
      botState.lastActivity = Date.now();
    } catch (e) {
      console.log('[CircleWalk] Error:', e.message);
    }
  }, config.movement['circle-walk'].speed || 3000);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot && botState.connected) bot.setControlState('jump', false);
      }, 300);
      botState.lastActivity = Date.now();
    } catch (e) {
      console.log('[RandomJump] Error:', e.message);
    }
  }, config.movement['random-jump'].interval || 10000);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 4;
      bot.look(yaw, pitch, true);
      botState.lastActivity = Date.now();
    } catch (e) {
      console.log('[LookAround] Error:', e.message);
    }
  }, config.movement['look-around'].interval || 5000);
}

function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity) return;
    try {
      const entities = Object.values(bot.entities).filter(e =>
        e.type === 'mob' || (e.type === 'player' && e.username !== bot.username)
      );
      for (const e of entities) {
        if (!e.position) continue;
        if (bot.entity.position.distanceTo(e.position) < safeDistance) {
          bot.setControlState('back', true);
          setTimeout(() => {
            if (bot && botState.connected) bot.setControlState('back', false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      console.log('[AvoidMobs] Error:', e.message);
    }
  }, 2000);
}

function combatModule(bot, mcData) {
  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity) return;
    try {
      if (config.combat && config.combat['attack-mobs']) {
        const mobs = Object.values(bot.entities).filter(e =>
          e.type === 'mob' && e.position && bot.entity.position.distanceTo(e.position) < 4
        );
        if (mobs.length > 0) bot.attack(mobs[0]);
      }
    } catch (e) {
      console.log('[Combat] Error:', e.message);
    }
  }, 1500);

  bot.on('health', () => {
    if (!config.combat || !config.combat['auto-eat']) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory.items().find(i => {
          const itemData = mcData.itemsByName[i.name];
          return itemData && itemData.food;
        });
        if (food) {
          bot.equip(food, 'hand')
            .then(() => bot.consume())
            .catch(e => console.log('[AutoEat] Error:', e.message));
        }
      }
    } catch (e) {
      console.log('[AutoEat] Error:', e.message);
    }
  });
}

function bedModule(bot) {
  addInterval(async () => {
    if (!bot || !botState.connected) return;
    try {
      const isNight = bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;
      if (config.beds && config.beds['place-night'] && isNight && !bot.isSleeping) {
        const bedBlock = bot.findBlock({
          matching: block => block.name.includes('bed'),
          maxDistance: 8
        });
        if (bedBlock) {
          try {
            await bot.sleep(bedBlock);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('[Bed] Error:', e.message);
    }
  }, 10000);
}

function chatModule(bot) {
  bot.on('chat', (username, message) => {
    if (!bot || username === bot.username) return;
    try {
      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith('!tp ')) {
          const target = message.split(' ')[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      console.log('[Chat] Error:', e.message);
    }
  });
}

// ============================================================
// CONSOLE & DISCORD WEBHOOK
// ============================================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!bot || !botState.connected) return;
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('say ')) bot.chat(trimmed.slice(4));
  else if (trimmed.startsWith('cmd ')) bot.chat('/' + trimmed.slice(4));
  else if (trimmed === 'status') console.log(`Connected: ${botState.connected}`);
  else if (trimmed === 'reconnect') bot.end();
  else bot.chat(trimmed);
});

function sendDiscordWebhook(content, color = 0x0099ff) {
  if (!config.discord || !config.discord.enabled || !config.discord.webhookUrl || config.discord.webhookUrl.includes('YOUR_DISCORD')) return;

  const urlParts = new URL(config.discord.webhookUrl);
  const protocol = urlParts.protocol === 'https:' ? https : http;

  const payload = JSON.stringify({
    username: config.name,
    embeds: [{
      description: content,
      color: color,
      timestamp: new Date().toISOString(),
      footer: { text: 'AFK Bot' }
    }]
  });

  const options = {
    hostname: urlParts.hostname,
    port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
    path: urlParts.pathname + urlParts.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = protocol.request(options, (res) => res.resume());
  req.on('error', (e) => console.log(`[Discord] Error: ${e.message}`));
  req.write(payload);
  req.end();
}

// ============================================================
// PROCESS ERROR & SHUTDOWN HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
  console.log(`[FATAL] Uncaught Exception: ${err.message}`);
  botState.lastDisconnectReason = `Uncaught Error: ${err.message}`;
  botState.errors.push({ type: 'uncaught', message: err.message, time: Date.now() });

  if (!isShuttingDown && config.utils['auto-reconnect']) {
    clearAllIntervals();
    setTimeout(() => scheduleReconnect(), 2000);
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: 'rejection', message: String(reason), time: Date.now() });
});

function shutdown(signal) {
  console.log(`[System] ${signal} received. Exiting...`);
  isShuttingDown = true;
  clearAllIntervals();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (bot) {
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================================
// START THE BOT
// ============================================================
console.log('='.repeat(50));
console.log('  Minecraft AFK Bot');
console.log('='.repeat(50));
console.log(`Server: ${config.server.ip}:${config.server.port}`);
console.log(`Version: ${config.server.version}`);
console.log('='.repeat(50));

createBot();
