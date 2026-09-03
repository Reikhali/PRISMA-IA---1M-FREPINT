import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Volume2, Bot, Sparkles, Send, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import type { Candle, OtcAsset } from '@/types';
import type { StrategySignal } from '@/lib/supertrend-rsi-engine';
import { speakVoiceNotification, playClickSound } from '@/lib/sound';

interface MarketVoiceAssistantProps {
  selectedAsset: OtcAsset;
  candles: Candle[];
  metrics: StrategySignal;
  secondsToNextCandle: number;
  autoVoiceAlerts: boolean;
  onToggleAutoVoice: () => void;
}

interface Message {
  sender: 'user' | 'bot';
  text: string;
  time: string;
}

export const MarketVoiceAssistant: React.FC<MarketVoiceAssistantProps> = ({
  selectedAsset,
  candles,
  metrics,
  secondsToNextCandle,
  autoVoiceAlerts,
  onToggleAutoVoice,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const [inputText, setInputText] = useState<string>('');
  const [transcript, setTranscript] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'bot',
      text: `Olá! Sou o assistente de voz do robô Prisma IA. Estou monitorando ${selectedAsset.label} em tempo real. Você pode falar comigo pelo microfone ou me perguntar sobre a tendência, o SuperTrend, o RSI ou se há sinal de entrada agora.`,
      time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
    },
  ]);

  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Inicializa a API de reconhecimento de voz do navegador (SpeechRecognition / webkitSpeechRecognition)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
        if (event.results[0].isFinal) {
          handleUserQuery(currentTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Erro no reconhecimento de voz:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Falha ao iniciar SpeechRecognition:', err);
      setSpeechSupported(false);
    }
  }, []);

  // Rola mensagens para o final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Inteligência de Resposta Contextual Baseada nos Dados Reais de Mercado
  const generateMarketExplanation = useCallback(
    (query: string): string => {
      const q = query.toLowerCase();
      const lastCandle = candles[candles.length - 1];
      const prevCandle = candles[candles.length - 2];
      const isGreen = lastCandle ? lastCandle.close >= lastCandle.open : true;
      const stDir = metrics.superTrendDirection === 'BULLISH' ? 'Alta' : 'Baixa';
      const rsiVal = metrics.rsiValue.toFixed(1);
      const rsiSide = metrics.rsiValue > 50 ? 'comprador acima de 50' : 'vendedor abaixo de 50';

      // Pergunta sobre comprar ou vender / sinal
      if (q.includes('compr') || q.includes('vend') || q.includes('sinal') || q.includes('entr') || q.includes('devo')) {
        if (metrics.verdict === 'CALL') {
          return `O mercado está favorável para COMPRA no par ${selectedAsset.label}! O SuperTrend está verde em alta e o RSI está em ${rsiVal}, com momentum comprador sem exaustão. Faltam ${secondsToNextCandle} segundos para a virada da vela. O momento ideal de execução é exatamente aos 00 segundos.`;
        } else if (metrics.verdict === 'PUT') {
          return `O mercado está favorável para VENDA no par ${selectedAsset.label}! O SuperTrend está vermelho em baixa e o RSI está em ${rsiVal}, confirmando força vendedora sem exaustão. Faltam ${secondsToNextCandle} segundos para o término da vela M1. Prepare sua ordem para os 00 segundos.`;
        } else {
          return `Neste momento recomendo cautela e proteção no par ${selectedAsset.label}. ${metrics.blocks.join('. ')}. Aguarde uma confluência perfeita entre o SuperTrend e o RSI para entrar com segurança.`;
        }
      }

      // Pergunta sobre tendência / SuperTrend
      if (q.includes('tend') || q.includes('supertrend') || q.includes('direção') || q.includes('direcao')) {
        return `A tendência calculada pelo SuperTrend para ${selectedAsset.label} é de ${stDir.toUpperCase()}, posicionado em ${metrics.superTrendValue.toFixed(selectedAsset.precision || 5)}. A vela atual é ${isGreen ? 'verde de alta' : 'vermelha de baixa'}. O RSI está em ${rsiVal}.`;
      }

      // Pergunta sobre RSI / momentum / força
      if (q.includes('rsi') || q.includes('momentum') || q.includes('força') || q.includes('forca') || q.includes('exaustão')) {
        const exhaustionStatus =
          metrics.rsiValue >= 70
            ? 'em sobrecompra extrema (acima de 70)'
            : metrics.rsiValue <= 30
            ? 'em sobrevenda extrema (abaixo de 30)'
            : 'dentro da faixa segura e saudável entre 30 e 70';
        return `O oscilador RSI de período 9 está medindo ${rsiVal}, indicando fluxo ${rsiSide}. O mercado está ${exhaustionStatus}, o que é essencial para evitar falsos rompimentos.`;
      }

      // Pergunta sobre o que está acontecendo / análise geral do mercado
      return `Análise do robô para ${selectedAsset.label}: Estamos em gráfico de 1 minuto OTC. O SuperTrend indica tendência de ${stDir}, com RSI em ${rsiVal} (${rsiSide}). Situação operacional: ${metrics.verdict === 'CALL' ? 'Sinal ativo de COMPRA' : metrics.verdict === 'PUT' ? 'Sinal ativo de VENDA' : 'Mercado sem confluência unânime, proteção ativada'}. Faltam ${secondsToNextCandle} segundos para a próxima vela.`;
    },
    [candles, metrics, selectedAsset, secondsToNextCandle]
  );

  // Processa a pergunta do usuário e responde com voz
  const handleUserQuery = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      const nowTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());

      // Adiciona mensagem do usuário
      setMessages((prev) => [...prev, { sender: 'user', text, time: nowTime }]);
      setInputText('');
      setTranscript('');

      // Gera explicação inteligente
      const botReply = generateMarketExplanation(text);

      setTimeout(() => {
        const replyTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
        setMessages((prev) => [...prev, { sender: 'bot', text: botReply, time: replyTime }]);
        speakVoiceNotification(botReply);
      }, 400);
    },
    [generateMarketExplanation]
  );

  const toggleListening = () => {
    playClickSound();
    if (!speechSupported) {
      handleUserQuery('Como está o mercado agora?');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setTranscript('');
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.warn('Erro ao disparar microfone:', e);
      }
    }
  };

  const quickQuestions = [
    'Como está o mercado agora?',
    'Qual a tendência e SuperTrend?',
    'Devo comprar ou vender?',
    'Como está o RSI e momentum?',
  ];

  return (
    <div className="bg-[#050b14]/95 border border-emerald-500/30 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden font-mono">
      {/* Header do Assistente */}
      <div className="p-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-black/80 border-b border-emerald-500/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Bot className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-white">ASSISTENTE DE VOZ IA DO ROBÔ</h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                AO VIVO
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Fale no microfone ou pergunte sobre o gráfico, tendências e sinais</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle de Alertas Automáticos por Voz */}
          <button
            type="button"
            onClick={onToggleAutoVoice}
            className={`text-xs px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              autoVoiceAlerts
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="O robô avisa por voz automaticamente quando detectar um sinal novo"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Avisos por Voz:</span>
            <span>{autoVoiceAlerts ? 'LIGADO' : 'MUDO'}</span>
          </button>

          {/* Minimizar / Expandir */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 space-y-3">
          {/* Caixa de Diálogo do Robô */}
          <div className="h-44 overflow-y-auto space-y-2.5 pr-1 bg-black/50 border border-slate-800 rounded-xl p-3 text-xs">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'bot' && (
                  <div className="w-6 h-6 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 text-emerald-400 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] p-2.5 rounded-xl ${
                    msg.sender === 'user'
                      ? 'bg-emerald-600/30 border border-emerald-500/40 text-emerald-100 rounded-br-none'
                      : 'bg-slate-900 border border-slate-700 text-slate-200 rounded-bl-none'
                  }`}
                >
                  <p className="leading-relaxed">{msg.text}</p>
                  <span className="text-[9px] text-slate-400 mt-1 block text-right">{msg.time}</span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Indicador de fala / escuta ativa */}
          {isListening && (
            <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center gap-3 animate-pulse">
              <div className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
              <div className="text-xs text-emerald-300 flex-1">
                <strong>Ouvindo sua voz...</strong> {transcript || 'Fale agora ("Como está o mercado?")'}
              </div>
            </div>
          )}

          {/* Atalhos de Perguntas Rápidas */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
            <span className="text-slate-500 flex items-center gap-1 text-[10px] uppercase font-bold flex-shrink-0">
              <MessageSquare className="w-3 h-3" /> Perguntas:
            </span>
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  playClickSound();
                  handleUserQuery(q);
                }}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-emerald-950/50 border border-slate-800 hover:border-emerald-500/30 text-slate-300 hover:text-emerald-300 transition-colors cursor-pointer text-xs"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Barra de Input & Botão de Microfone */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleUserQuery(inputText);
            }}
            className="flex items-center gap-2 pt-1"
          >
            <button
              type="button"
              onClick={toggleListening}
              className={`p-2.5 rounded-xl border font-bold flex items-center gap-2 transition-all cursor-pointer ${
                isListening
                  ? 'bg-rose-600 text-white border-rose-500 animate-bounce shadow-lg shadow-rose-600/40'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20 active:scale-95'
              }`}
              title={speechSupported ? 'Clique para falar pelo microfone' : 'Microfone não suportado no navegador'}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span className="text-xs font-black hidden sm:inline">
                {isListening ? 'OUVINDO...' : 'FALAR NO MICROFONE'}
              </span>
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Digite ou fale sua dúvida sobre o mercado e candles..."
              className="flex-1 bg-black/60 border border-slate-800 focus:border-emerald-500/60 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition-colors"
            />

            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-emerald-600 disabled:opacity-40 text-white border border-slate-700 hover:border-emerald-500 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
