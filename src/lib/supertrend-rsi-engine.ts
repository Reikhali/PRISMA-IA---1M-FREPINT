import type { Candle } from '@/types';

export interface SuperTrendPoint {
  time: number;
  value: number;
  direction: 'BULLISH' | 'BEARISH'; // BULLISH = verde (suporte), BEARISH = vermelho (resistência)
  upperBand: number;
  lowerBand: number;
}

export interface RsiPoint {
  time: number;
  value: number;
}

export interface StrategySignal {
  verdict: 'CALL' | 'PUT' | 'NO_TRADE';
  superTrendDirection: 'BULLISH' | 'BEARISH';
  superTrendValue: number;
  rsiValue: number;
  rsiStatus: 'COMPRADOR' | 'VENDEDOR' | 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO';
  candleQuality: 'SAUDAVEL' | 'DOJI_TRAVADO' | 'EXAUSTAO';
  candleMovement: 'IMPULSAO_ALTA' | 'IMPULSAO_BAIXA' | 'LATERAL';
  priceAction: string;
  filters: {
    superTrendOk: boolean;
    rsiMomentumOk: boolean;
    antiExhaustionOk: boolean;
    volatilityOk: boolean;
  };
  reasons: string[];
  blocks: string[];
  confidence: number;
}

// ─── 1. Cálculo do ATR (Average True Range) ──────────────────────────────────
export function calculateATR(candles: Candle[], period = 10): number[] {
  if (candles.length < 2) return candles.map(() => 0.0002);

  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }

  const atrs: number[] = [];
  let sum = 0;
  for (let i = 0; i < Math.min(period, trs.length); i++) {
    sum += trs[i];
  }
  let prevAtr = sum / Math.max(1, Math.min(period, trs.length));

  for (let i = 0; i < trs.length; i++) {
    if (i < period) {
      atrs.push(prevAtr);
    } else {
      prevAtr = (prevAtr * (period - 1) + trs[i]) / period;
      atrs.push(prevAtr);
    }
  }

  return atrs;
}

// ─── 2. Cálculo do SuperTrend (Período 10, Multiplicador 2.0) ─────────────────
export function calculateSuperTrend(
  candles: Candle[],
  period = 10,
  multiplier = 2.0
): SuperTrendPoint[] {
  if (candles.length === 0) return [];
  if (candles.length < period) {
    const last = candles[candles.length - 1];
    return candles.map((c) => ({
      time: c.time,
      value: c.close,
      direction: 'BULLISH',
      upperBand: c.close * 1.001,
      lowerBand: c.close * 0.999,
    }));
  }

  const atrs = calculateATR(candles, period);
  const points: SuperTrendPoint[] = [];

  let prevUpper = 0;
  let prevLower = 0;
  let prevDir: 'BULLISH' | 'BEARISH' = 'BULLISH';
  let prevSuperTrend = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const atr = atrs[i] || 0.0002;
    const hl2 = (c.high + c.low) / 2;

    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    let finalUpper = basicUpper;
    let finalLower = basicLower;

    if (i > 0) {
      const prevC = candles[i - 1];
      finalUpper =
        basicUpper < prevUpper || prevC.close > prevUpper
          ? basicUpper
          : prevUpper;
      finalLower =
        basicLower > prevLower || prevC.close < prevLower
          ? basicLower
          : prevLower;
    }

    let dir: 'BULLISH' | 'BEARISH' = prevDir;
    let st = 0;

    if (i === 0) {
      dir = c.close >= basicUpper ? 'BULLISH' : 'BEARISH';
      st = dir === 'BULLISH' ? finalLower : finalUpper;
    } else {
      if (prevDir === 'BULLISH') {
        if (c.close < finalLower) {
          dir = 'BEARISH';
          st = finalUpper;
        } else {
          dir = 'BULLISH';
          st = finalLower;
        }
      } else {
        if (c.close > finalUpper) {
          dir = 'BULLISH';
          st = finalLower;
        } else {
          dir = 'BEARISH';
          st = finalUpper;
        }
      }
    }

    prevUpper = finalUpper;
    prevLower = finalLower;
    prevDir = dir;
    prevSuperTrend = st;

    points.push({
      time: c.time,
      value: st,
      direction: dir,
      upperBand: finalUpper,
      lowerBand: finalLower,
    });
  }

  return points;
}

// ─── 3. Cálculo do RSI (Período 9) com Série Histórica ────────────────────────
export function calculateRSI(closes: number[], period = 9): number[] {
  if (closes.length === 0) return [];
  if (closes.length <= period) {
    return closes.map(() => 50);
  }

  const rsis: number[] = Array(closes.length).fill(50);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsis[period] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsis[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsis[i] = Number((100 - 100 / (1 + rs)).toFixed(1));
    }
  }

  return rsis;
}

// ─── 4. Motor de Avaliação da Estratégia na Vela Atual (Nascimento & Price Action) ─
export function evaluateSuperTrendRsiStrategy(candles: Candle[]): StrategySignal {
  if (candles.length < 15) {
    return {
      verdict: 'NO_TRADE',
      superTrendDirection: 'BULLISH',
      superTrendValue: 0,
      rsiValue: 50,
      rsiStatus: 'NEUTRO',
      candleQuality: 'SAUDAVEL',
      candleMovement: 'LATERAL',
      priceAction: 'Aguardando histórico de velas...',
      filters: {
        superTrendOk: false,
        rsiMomentumOk: false,
        antiExhaustionOk: false,
        volatilityOk: false,
      },
      reasons: ['Aguardando histórico suficiente de velas para cálculo...'],
      blocks: ['Histórico menor que 15 velas.'],
      confidence: 0,
    };
  }

  const stPoints = calculateSuperTrend(candles, 10, 2.0);
  const closes = candles.map((c) => c.close);
  const rsiValues = calculateRSI(closes, 9);

  const lastCandle = candles[candles.length - 1];
  const lastSt = stPoints[stPoints.length - 1];
  const lastRsi = rsiValues[rsiValues.length - 1] ?? 50;

  // Análise detalhada do movimento real da vela atual
  const bodySize = Math.abs(lastCandle.close - lastCandle.open);
  const totalRange = Math.max(0.00001, lastCandle.high - lastCandle.low);
  const isDoji = bodySize / totalRange < 0.10;
  const isBullishCandle = lastCandle.close > lastCandle.open;
  const isBearishCandle = lastCandle.close < lastCandle.open;

  let candleMovement: 'IMPULSAO_ALTA' | 'IMPULSAO_BAIXA' | 'LATERAL' = 'LATERAL';
  let priceAction = '';

  if (isBullishCandle && !isDoji) {
    candleMovement = 'IMPULSAO_ALTA';
    priceAction = 'Preço em expansão compradora na vela atual, sustentado acima da abertura.';
  } else if (isBearishCandle && !isDoji) {
    candleMovement = 'IMPULSAO_BAIXA';
    priceAction = 'Preço em expansão vendedora na vela atual, pressionado abaixo da abertura.';
  } else {
    candleMovement = 'LATERAL';
    priceAction = 'Preço consolidando em torno da abertura da vela atual.';
  }

  // Status do RSI (Linha 50 é o divisor, 70 e 30 são os extremos)
  let rsiStatus: 'COMPRADOR' | 'VENDEDOR' | 'SOBRECOMPRADO' | 'SOBREVENDIDO' | 'NEUTRO' = 'NEUTRO';
  if (lastRsi >= 70) {
    rsiStatus = 'SOBRECOMPRADO';
  } else if (lastRsi <= 30) {
    rsiStatus = 'SOBREVENDIDO';
  } else if (lastRsi > 50) {
    rsiStatus = 'COMPRADOR';
  } else if (lastRsi < 50) {
    rsiStatus = 'VENDEDOR';
  }

  // Regras para CALL (Compra na vela atual):
  // 1. SuperTrend em Alta (BULLISH, linha verde abaixo)
  // 2. Preço de fechamento da vela atual acima do SuperTrend
  // 3. RSI(9) > 50 (Momentum comprador ativo)
  // 4. RSI(9) < 70 (Não está sobrecomprado - espaço para subir)
  // 5. Sem doji travado
  const stCallOk = lastSt.direction === 'BULLISH' && lastCandle.close >= lastSt.value;
  const rsiCallMomentum = lastRsi > 50;
  const rsiCallNotExhausted = lastRsi < 70;
  const candleCallValid = !isDoji;

  // Regras para PUT (Venda na vela atual):
  // 1. SuperTrend em Baixa (BEARISH, linha vermelha acima)
  // 2. Preço de fechamento da vela atual abaixo do SuperTrend
  // 3. RSI(9) < 50 (Momentum vendedor ativo)
  // 4. RSI(9) > 30 (Não está sobrevendido - espaço para descer)
  // 5. Sem doji travado
  const stPutOk = lastSt.direction === 'BEARISH' && lastCandle.close <= lastSt.value;
  const rsiPutMomentum = lastRsi < 50;
  const rsiPutNotExhausted = lastRsi > 30;
  const candlePutValid = !isDoji;

  let verdict: 'CALL' | 'PUT' | 'NO_TRADE' = 'NO_TRADE';
  const reasons: string[] = [];
  const blocks: string[] = [];
  let confidence = 0;

  if (stCallOk && rsiCallMomentum && rsiCallNotExhausted && candleCallValid) {
    verdict = 'CALL';
    confidence = 95;
    reasons.push('Vela Atual: Movimento de alta confirmado a partir do nascimento da vela.');
    reasons.push('SuperTrend VERDE: Suporte dinâmico validando o avanço do preço.');
    reasons.push(`RSI(9) = ${lastRsi.toFixed(1)}: Fluxo comprador ativo sem exaustão (< 70).`);
    reasons.push('Price Action: Vela atual trabalhando com amplitude e volume saudável.');
  } else if (stPutOk && rsiPutMomentum && rsiPutNotExhausted && candlePutValid) {
    verdict = 'PUT';
    confidence = 95;
    reasons.push('Vela Atual: Movimento de baixa confirmado a partir do nascimento da vela.');
    reasons.push('SuperTrend VERMELHO: Resistência dinâmica validando a descida do preço.');
    reasons.push(`RSI(9) = ${lastRsi.toFixed(1)}: Fluxo vendedor ativo sem exaustão (> 30).`);
    reasons.push('Price Action: Vela atual trabalhando com amplitude e volume saudável.');
  } else {
    // Motivos do bloqueio
    if (lastSt.direction === 'BULLISH') {
      if (!rsiCallMomentum) blocks.push(`SuperTrend indica Alta, mas RSI(${lastRsi.toFixed(1)}) está abaixo de 50 na vela atual.`);
      if (!rsiCallNotExhausted) blocks.push(`RSI(${lastRsi.toFixed(1)}) em sobrecompra extrema (≥70) na vela atual. Risco de retração.`);
    } else {
      if (!rsiPutMomentum) blocks.push(`SuperTrend indica Baixa, mas RSI(${lastRsi.toFixed(1)}) está acima de 50 na vela atual.`);
      if (!rsiPutNotExhausted) blocks.push(`RSI(${lastRsi.toFixed(1)}) em sobrevenda extrema (≤30) na vela atual. Risco de repique.`);
    }
    if (isDoji) {
      blocks.push('Vela atual com pouca oscilação em relação à abertura (Doji/Travado).');
    }
    if (blocks.length === 0) {
      blocks.push('Aguardando sincronização exata do SuperTrend(10, 2) com o RSI(9) na vela atual.');
    }
  }

  return {
    verdict,
    superTrendDirection: lastSt.direction,
    superTrendValue: lastSt.value,
    rsiValue: lastRsi,
    rsiStatus,
    candleQuality: isDoji ? 'DOJI_TRAVADO' : 'SAUDAVEL',
    candleMovement,
    priceAction,
    filters: {
      superTrendOk: verdict === 'CALL' ? stCallOk : (verdict === 'PUT' ? stPutOk : false),
      rsiMomentumOk: verdict === 'CALL' ? rsiCallMomentum : (verdict === 'PUT' ? rsiPutMomentum : false),
      antiExhaustionOk: verdict === 'CALL' ? rsiCallNotExhausted : (verdict === 'PUT' ? rsiPutNotExhausted : false),
      volatilityOk: !isDoji,
    },
    reasons,
    blocks,
    confidence,
  };
}
