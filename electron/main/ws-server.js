const { WebSocketServer } = require('ws');
const { handleActivityChange } = require('./intervention');

const PORT = 7842;
let wss = null;
let clients = new Set();
let mainWindowGetter = () => null;

function setMainWindowGetter(fn) {
  mainWindowGetter = fn;
}

function broadcastStatus() {
  const mw = mainWindowGetter();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send('extension:status', {
      connected: clients.size > 0,
      count: clients.size
    });
  }
}

function startWsServer() {
  wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    console.log('[ws] Extension connected. Total:', clients.size);
    broadcastStatus();

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === 'tab_switch' || msg.event === 'tab_update') {
        await handleActivityChange({
          url: msg.url,
          title: msg.title,
          tabId: msg.tabId,
          source: 'browser'
        });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[ws] Extension disconnected. Total:', clients.size);
      broadcastStatus();
    });

    ws.on('error', (err) => {
      console.error('[ws] Error:', err.message);
    });

    ws.send(JSON.stringify({ event: 'hello', from: 'pocraend' }));
  });

  wss.on('error', (err) => {
    console.error('[ws] Server error:', err.message);
  });

  // Drop sockets that stopped responding (e.g. a suspended extension worker)
  // so the connected-count stays accurate.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        // ignore — a failed ping means the socket is already gone
      }
    }
  }, 15000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log(`[ws] Listening on ws://127.0.0.1:${PORT}`);
}

function broadcastToExtension(message) {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function getExtensionStatus() {
  return {
    connected: clients.size > 0,
    count: clients.size
  };
}

module.exports = { startWsServer, broadcastToExtension, setMainWindowGetter, getExtensionStatus };
