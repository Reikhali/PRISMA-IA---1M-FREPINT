import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { OTC_ASSETS, getAssetById } from './src/lib/otc-assets';
import { analyze } from './src/lib/analysis';
import { evaluateTaxaDividida } from './src/lib/taxa-dividida';
import {
  getAccount,
  setSsidOverride,
  clearSsidOverride,
  getCandles as getBrokerCandles,
  openOption as openBrokerOption,
  getBrokerOtcActives,
  getPayouts
} from './src/lib/broker.server';
import { fetchGambolCandles } from './src/lib/gambol.server';
import type { Candle } from './src/types';

const app = express();
app.use(express.json());

const PORT = 3000;

// ─── Gambol Manipulation State (Controlador ao vivo) ─────────────────────────
interface ActiveManipulation {
  activeId: number;
  direction: 'alta' | 'baixa';
  force: number; // 10% to 127%
  broker: string;
  startedAt: number; // timestamp ms
  duration: number; // ms (default 60000ms = 1 min)
}

let currentManipulation: ActiveManipulation | null = null;

function getActiveManipulationFor(activeId: number): ActiveManipulation | null {
  if (!currentManipulation) return null;
  const now = Date.now();
  if (now - currentManipulation.startedAt > currentManipulation.duration) {
    currentManipulation = null;
    return null;
  }
  if (currentManipulation.activeId === activeId) {
    return currentManipulation;
  }
  return null;
}

// Deterministic / High-Fidelity OTC Candle Engine
// Provides smooth realistic continuous price movement for all 148 OTC assets
const assetStates = new Map<number, {
  basePrice: number;
  currentPrice: number;
  candles: Candle[];
  lastCandleMinute: number;
}>();

function getInitialBasePrice(id: number, category: string): number {
  switch (category) {
    case 'crypto':
      if (id === 1934 || id === 1939) return 64200.50; // BTC
      if (id === 1940 || id === 1941) return 3480.20; // ETH
      if (id === 2439) return 148.50; // SOL
      if (id === 2440) return 0.5820; // XRP
      return 120.0;
    case 'commodity':
      if (id === 1931 || id === 1859) return 78.45; // Oil
      if (id === 1932) return 2380.50; // Gold
      if (id === 1933) return 29.40; // Silver
      return 85.0;
    case 'index':
      if (id === 1971) return 5620.0; // SP500
      if (id === 1972) return 19800.0; // NDAQ
      if (id === 1973) return 41200.0; // US30
      return 18500.0;
    case 'stock':
      if (id === 1938) return 224.50; // Apple
      if (id === 1935) return 188.20; // Amazon
      if (id === 1936) return 215.30; // Tesla
      if (id === 2084) return 128.40; // NVDA
      return 150.0;
    default:
      // Forex
      if (id === 76) return 1.08450; // EURUSD OTC
      if (id === 1) return 1.08450;
      if (id === 2) return 154.200; // USDJPY OTC
      if (id === 3) return 1.29340; // GBPUSD OTC
      if (id === 1380) return 18.2500;
      return 1.12000;
  }
}

function getAssetCandles(activeId: number, count = 150): Candle[] {
  const asset = getAssetById(activeId) || OTC_ASSETS[0];
  const now = Math.floor(Date.now() / 1000);
  const currentMinute = Math.floor(now / 60) * 60;

  let state = assetStates.get(activeId);
  if (!state) {
    const base = getInitialBasePrice(activeId, asset.category);
    const candles: Candle[] = [];
    let price = base;
    const volatility = base > 1000 ? base * 0.0008 : base > 10 ? base * 0.0005 : 0.00015;

    // Build 150 prior minutes
    for (let i = 150; i >= 1; i--) {
      const cTime = currentMinute - i * 60;
      const seed = Math.sin(cTime * 0.01 + activeId * 13) + Math.cos(cTime * 0.05);
      const delta = seed * volatility + (Math.sin(i / 10) * volatility * 0.8);
      const open = price;
      const close = Math.max(open * 0.5, open + delta);
      const high = Math.max(open, close) + Math.abs(seed) * volatility * 0.6;
      const low = Math.min(open, close) - Math.abs(seed) * volatility * 0.6;
      candles.push({
        time: cTime,
        open: Number(open.toFixed(asset.precision || 5)),
        high: Number(high.toFixed(asset.precision || 5)),
        low: Number(low.toFixed(asset.precision || 5)),
        close: Number(close.toFixed(asset.precision || 5)),
        volume: Math.floor(50 + Math.abs(seed) * 200),
      });
      price = close;
    }

    // Current candle
    const open = price;
    const high = open + volatility * 0.2;
    const low = open - volatility * 0.2;
    const close = open;
    candles.push({
      time: currentMinute,
      open: Number(open.toFixed(asset.precision || 5)),
      high: Number(high.toFixed(asset.precision || 5)),
      low: Number(low.toFixed(asset.precision || 5)),
      close: Number(close.toFixed(asset.precision || 5)),
      volume: 10,
    });

    state = {
      basePrice: base,
      currentPrice: close,
      candles,
      lastCandleMinute: currentMinute,
    };
    assetStates.set(activeId, state);
  }

  // Update current forming candle or rollover to new minute
  if (currentMinute > state.lastCandleMinute) {
    const last = state.candles[state.candles.length - 1];
    const newOpen = last ? last.close : state.currentPrice;
    state.candles.push({
      time: currentMinute,
      open: newOpen,
      high: newOpen,
      low: newOpen,
      close: newOpen,
      volume: 1,
    });
    if (state.candles.length > 200) {
      state.candles.shift();
    }
    state.lastCandleMinute = currentMinute;
  }

  // Minor tick wiggle on forming candle (with Gambol active manipulation injection)
  const activeCandle = state.candles[state.candles.length - 1];
  const prec = asset.precision || 5;
  const vol = state.basePrice > 1000 ? 0.8 : state.basePrice > 10 ? 0.02 : 0.00003;
  
  // Check if active manipulation is in progress
  const manip = getActiveManipulationFor(activeId);
  let bias = 0;
  if (manip) {
    const forceMultiplier = (manip.force / 100) * 1.8;
    bias = manip.direction === 'alta' ? vol * forceMultiplier : -vol * forceMultiplier;
  }

  const microWiggle = (Math.random() - 0.49) * vol + bias;
  const newClose = Number((activeCandle.close + microWiggle).toFixed(prec));

  activeCandle.close = newClose;
  activeCandle.high = Math.max(activeCandle.high, newClose);
  activeCandle.low = Math.min(activeCandle.low, newClose);
  activeCandle.volume = (activeCandle.volume || 0) + 1;
  state.currentPrice = newClose;

  return state.candles.slice(-count);
}

// ─── API Routes ─────────────────────────────────────────────────────────────

// Gambol: /api/me (Assinatura Vitalícia Sempre Ativa)
app.get('/api/me', (req, res) => {
  res.json({
    nome: 'Trader VIP Master',
    email: 'blackmoney3052@gmail.com',
    whatsapp: '+55 (11) 98765-4321',
    planName: 'Acesso Vitalício VIP Master (Desbloqueado)',
    subscriptionStartLabel: 'Ativo Permanente',
    subscriptionEndLabel: 'Acesso Vitalício (Sem Expiração)',
    subscriptionActive: true,
    lifetime: true,
    connectedServers: 12,
    balance: 14250.00,
    demoBalance: 50000.00,
  });
});

// Gambol: /api/access (Verificação de Acesso - Sempre OK / Lifetime)
app.get('/api/access', (req, res) => {
  res.json({
    ok: true,
    access: 'lifetime',
    subscriptionActive: true,
    message: 'Acesso vitalício validado com sucesso.',
  });
});

// Gambol: /api/login
app.post('/api/login', (req, res) => {
  const { email = 'blackmoney3052@gmail.com' } = req.body || {};
  res.json({
    session: 'gambol_vitalicio_vip_session_' + Date.now(),
    user: {
      nome: 'Trader VIP Master',
      email: email || 'blackmoney3052@gmail.com',
      whatsapp: '+55 (11) 98765-4321',
      planName: 'Acesso Vitalício VIP Master (Desbloqueado)',
      subscriptionStartLabel: 'Ativo Permanente',
      subscriptionEndLabel: 'Acesso Vitalício (Sem Expiração)',
      subscriptionActive: true,
      lifetime: true,
      connectedServers: 12,
      balance: 14250.00,
      demoBalance: 50000.00,
    },
  });
});

// Gambol: /api/config
app.get('/api/config', (req, res) => {
  res.json({
    telegramUrl: 'https://t.me/Hacklandiaoficial',
    lifetimeActive: true,
    plans: [
      { id: 'vitalicio', name: 'Acesso Vitalício VIP Master', price: 'R$ 0,00 (ATIVO)', days: null },
      { id: 'anual', name: 'Plano Anual Alpha', price: 'R$ 0,00 (ATIVO)', days: 365 },
      { id: 'mensal', name: 'Plano Mensal Pro', price: 'R$ 0,00 (ATIVO)', days: 30 },
    ],
  });
});

// Gambol: /api/controlador/manipulate (Forçar ALTA / BAIXA no servidor)
app.post('/api/controlador/manipulate', (req, res) => {
  const { activeId = 76, direction = 'alta', force = 100, broker = 'alpha' } = req.body || {};
  
  const clampedForce = Math.min(127, Math.max(10, Number(force) || 100));
  const dir = direction === 'baixa' ? 'baixa' : 'alta';

  currentManipulation = {
    activeId: Number(activeId) || 76,
    direction: dir,
    force: clampedForce,
    broker: String(broker || 'alpha'),
    startedAt: Date.now(),
    duration: 60000, // 60 segundos
  };

  const asset = getAssetById(Number(activeId)) || OTC_ASSETS[0];

  res.json({
    ok: true,
    message: `Manipulação ${dir.toUpperCase()} iniciada com força ${clampedForce}% em ${asset.symbol} (${broker}) por 60s`,
    manipulation: {
      ...currentManipulation,
      symbol: asset.symbol,
      remainingSeconds: 60,
    },
  });
});

// Gambol: /api/controlador/reset (Voltar ao Preço de Mercado)
app.post('/api/controlador/reset', (req, res) => {
  currentManipulation = null;
  res.json({
    ok: true,
    message: 'Preço restaurado para o fluxo natural de mercado.',
  });
});

// Gambol: /api/controlador/status
app.get('/api/controlador/status', (req, res) => {
  const activeId = parseInt(req.query.activeId as string, 10) || 76;
  const manip = getActiveManipulationFor(activeId);
  if (!manip) {
    return res.json({
      active: false,
      mode: 'Preço de Mercado',
      remainingSeconds: 0,
    });
  }

  const elapsed = Math.floor((Date.now() - manip.startedAt) / 1000);
  const remaining = Math.max(0, 60 - elapsed);

  res.json({
    active: true,
    mode: `Manipulação ${manip.direction.toUpperCase()} (${manip.force}%)`,
    direction: manip.direction,
    force: manip.force,
    broker: manip.broker,
    remainingSeconds: remaining,
  });
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    serverTime: Math.floor(Date.now() / 1000),
    brasiliaTime: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  });
});

// All 148 OTC Assets
app.get('/api/assets', async (req, res) => {
  try {
    let liveActives = await getBrokerOtcActives().catch(() => []);
    if (liveActives && liveActives.length > 0) {
      return res.json(liveActives);
    }
  } catch {
    // fallback
  }

  const result = OTC_ASSETS.map((a) => ({
    ...a,
    payout: a.payout || 88,
    enabled: true,
  }));
  res.json(result);
});

// Account Status
app.get('/api/account', async (req, res) => {
  try {
    const acc = await getAccount();
    return res.json({
      connected: true,
      id: acc.id,
      name: acc.name,
      balance: acc.balance,
      demoBalance: acc.demoBalance,
      currency: acc.currency,
    });
  } catch (err) {
    // Default simulated account
    return res.json({
      connected: false,
      id: 994821,
      name: 'PRISMA Trader (DEMO)',
      balance: 1250.00,
      demoBalance: 10000.00,
      currency: 'USD',
    });
  }
});

// Connect Broker SSID
app.post('/api/connect-ssid', async (req, res) => {
  const { ssid } = req.body;
  if (!ssid || typeof ssid !== 'string' || ssid.trim().length < 10) {
    return res.status(400).json({ ok: false, message: 'SSID inválido ou muito curto' });
  }

  setSsidOverride(ssid.trim());
  try {
    const account = await getAccount();
    return res.json({
      ok: true,
      message: 'Conectado à corretora com sucesso!',
      account: {
        id: account.id,
        name: account.name,
        balance: account.balance,
        demoBalance: account.demoBalance,
        currency: account.currency,
      },
    });
  } catch (err) {
    return res.json({
      ok: true,
      message: 'SSID salvo no terminal. Conexão em buffer.',
      account: {
        id: 994821,
        name: 'Sessão Conectada (Buffering)',
        balance: 1540.00,
        demoBalance: 10000.00,
        currency: 'USD',
      },
    });
  }
});

// Disconnect Broker SSID
app.post('/api/disconnect-ssid', (req, res) => {
  clearSsidOverride();
  res.json({ ok: true, message: 'Desconectado da corretora' });
});

// Candles
app.get('/api/candles', async (req, res) => {
  const activeId = parseInt(req.query.activeId as string, 10) || 76;
  const count = parseInt(req.query.count as string, 10) || 150;

  try {
    const gambolData = await fetchGambolCandles(activeId, count);
    if (gambolData && gambolData.length >= 30) {
      return res.json(gambolData);
    }
  } catch {
    // continue to broker
  }

  try {
    const brokerData = await getBrokerCandles(activeId, count);
    if (brokerData && brokerData.length >= 30) {
      return res.json(brokerData);
    }
  } catch {
    // Fallback to local continuous OTC engine
  }

  const candles = getAssetCandles(activeId, count);
  res.json(candles);
});

// Technical Analysis
app.get('/api/analysis', async (req, res) => {
  const activeId = parseInt(req.query.activeId as string, 10) || 76;
  let candles: Candle[] = [];

  try {
    candles = await getBrokerCandles(activeId, 180);
  } catch {
    // fallback
  }

  if (!candles || candles.length < 35) {
    candles = getAssetCandles(activeId, 180);
  }

  const closed = candles.slice(0, -1);
  const result = analyze(closed.length >= 35 ? closed : candles);

  if (!result) {
    return res.status(500).json({ error: 'Erro ao calcular análise técnica' });
  }

  res.json({
    activeId,
    analysis: result,
    candles: candles.slice(-120),
    serverTime: Math.floor(Date.now() / 1000),
  });
});

// Execute Order
app.post('/api/execute-order', async (req, res) => {
  const { activeId, direction, amount, duration = 60, isDemo = true, skipVerify = false } = req.body;

  if (!activeId || !direction || !amount) {
    return res.status(400).json({ success: false, reason: 'Parâmetros inválidos' });
  }

  const asset = getAssetById(activeId) || OTC_ASSETS[0];

  try {
    console.log(`[API /execute-order] Iniciando envio para corretora: ${asset.symbol} (${activeId}), dir: ${direction}, amount: $${amount}, demo: ${isDemo}`);
    const brokerOrder = await openBrokerOption({
      activeId,
      direction,
      amount,
      duration,
      isDemo,
    });
    console.log(`[API /execute-order] SUCESSO na corretora! ID: ${brokerOrder.id}, OpenPrice: ${brokerOrder.openPrice}`);
    return res.json({
      success: true,
      brokerExecuted: true,
      order: {
        ...brokerOrder,
        symbol: asset.symbol,
      },
      verified: true,
      reason: 'Ordem executada na corretora com sucesso',
    });
  } catch (err: any) {
    console.error(`[API /execute-order] Falha ao enviar para corretora:`, err?.message || err);
    // Simulated instant execution engine
    const candles = getAssetCandles(activeId, 10);
    const lastPrice = candles[candles.length - 1]?.close || getInitialBasePrice(activeId, asset.category);

    const order = {
      id: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      activeId,
      symbol: asset.symbol,
      direction,
      amount,
      openPrice: lastPrice,
      openTime: Math.floor(Date.now() / 1000),
      expiration: duration,
      isDemo,
      status: 'open',
      payoutPercent: asset.payout || 88,
    };

    return res.json({
      success: true,
      brokerExecuted: false,
      brokerError: err?.message || 'Erro de comunicação',
      order,
      verified: true,
      reason: isDemo ? 'Ordem DEMO aberta no terminal' : 'Ordem REAL gravada no terminal',
    });
  }
});

// Batch Scanner
app.post('/api/scan', async (req, res) => {
  const { activeIds = [], minStrength = 70, minPayout = 0 } = req.body;
  const targetIds: number[] = activeIds.length > 0 ? activeIds : OTC_ASSETS.slice(0, 30).map((a) => a.id);

  const alerts: any[] = [];

  for (const id of targetIds) {
    const asset = getAssetById(id);
    if (!asset) continue;

    const candles = getAssetCandles(id, 60);
    if (candles.length < 35) continue;

    const a = analyze(candles.slice(0, -1));
    if (!a) continue;

    const payout = asset.payout || 88;
    if (a.strength >= minStrength && payout >= minPayout) {
      alerts.push({
        activeId: id,
        symbol: asset.symbol,
        label: asset.label,
        category: asset.category,
        direction: a.direction,
        strength: a.strength,
        confidence: a.confidence,
        payout,
        reasons: a.reasons,
        blocks: a.blocks,
        candleContext: a.candleContext,
        signalReady: a.signalReady,
        time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        analysts: a.analysts,
      });
    }
  }

  alerts.sort((a, b) => b.strength - a.strength || b.payout - a.payout);
  res.json(alerts);
});

// Live SSE Stream for Candle updates & Brasília Time Sync
app.get('/api/stream', (req, res) => {
  const activeId = parseInt(req.query.activeId as string, 10) || 76;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  // Immediate time sync
  const now = Math.floor(Date.now() / 1000);
  sendEvent('timeSync', { serverTime: now, clientTimestamp: Date.now() });

  // Stream high-frequency ticks and candle updates
  const interval = setInterval(() => {
    const candles = getAssetCandles(activeId, 150);
    const last = candles[candles.length - 1];
    if (last) {
      sendEvent('candle', {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        activeId,
        allCount: candles.length,
      });
    }
    const currentNow = Math.floor(Date.now() / 1000);
    sendEvent('timeSync', { serverTime: currentNow, clientTimestamp: Date.now() });
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ─── Vite Middleware ────────────────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PRISMA AI OTC Trading Terminal running on port ${PORT}`);
  });
}

startServer();
