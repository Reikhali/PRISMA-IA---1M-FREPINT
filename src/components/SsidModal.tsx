import React, { useState } from 'react';
import { KeyRound, X, Check, ShieldCheck, AlertCircle, ExternalLink, Unlink } from 'lucide-react';
import type { AccountInfo } from '@/types';
import { playClickSound } from '@/lib/sound';

interface SsidModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: AccountInfo;
  onConnectSsid: (ssid: string) => Promise<boolean>;
  onDisconnectSsid: () => Promise<void>;
}

export function SsidModal({
  isOpen,
  onClose,
  account,
  onConnectSsid,
  onDisconnectSsid,
}: SsidModalProps) {
  const [ssidInput, setSsidInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssidInput.trim()) return;

    setLoading(true);
    setFeedback(null);
    try {
      const ok = await onConnectSsid(ssidInput.trim());
      if (ok) {
        setFeedback({ ok: true, msg: 'Conectado com sucesso à sua conta da corretora!' });
        setSsidInput('');
      } else {
        setFeedback({ ok: false, msg: 'Não foi possível conectar com esse SSID no momento.' });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: 'Falha de comunicação com o servidor de corretagem.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await onDisconnectSsid();
      setFeedback({ ok: true, msg: 'Sessão desconectada com sucesso.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5 font-mono">
                Conexão Corretora <span className="text-emerald-400 font-extrabold">OPTGO BROKER</span>
              </h2>
              <p className="text-xs text-gray-400">trade.optgobroker.com/traderoom · Conexão Direta SSID</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {/* Direct Broker Link Bar */}
          <div className="flex items-center justify-between p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-[11px] text-emerald-300 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Corretora Oficial: <strong>trade.optgobroker.com</strong></span>
            </div>
            <a
              href="https://trade.optgobroker.com/traderoom"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-lg text-[10px] flex items-center gap-1 transition-all"
            >
              <span>Abrir Traderoom</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Status badge */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between ${
              account.connected
                ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  account.connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
                }`}
              />
              <span className="font-semibold font-mono">
                Status: {account.connected ? 'Sessão OPTGO Ativa (Conectado)' : 'Modo Simulado / Desconectado'}
              </span>
            </div>
            {account.connected && (
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1"
              >
                <Unlink className="w-3.5 h-3.5" /> Desconectar
              </button>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-gray-950/80 p-3 rounded-xl border border-gray-800/80 space-y-2">
            <span className="font-bold text-gray-300 block">Como obter o SSID da Optgo Broker:</span>
            <ol className="list-decimal list-inside space-y-1 text-gray-400 leading-relaxed text-[11px]">
              <li>Acesse <strong className="text-emerald-400">trade.optgobroker.com/traderoom</strong> no seu navegador</li>
              <li>Abra o Inspecionar elemento (Pressione <strong>F12</strong> ou Ctrl+Shift+I)</li>
              <li>Vá na aba <strong>Application</strong> (ou Aplicativo/Armazenamento)</li>
              <li>No menu lateral esquerdo, abra <strong>Cookies</strong> → selecione <strong>https://trade.optgobroker.com</strong></li>
              <li>Procure a chave <strong className="text-emerald-300">ssid</strong> e copie o valor correspondente</li>
              <li>Cole o valor copiado no campo abaixo para sincronizar suas ordens reais e demo</li>
            </ol>
          </div>

          {/* Form */}
          <form onSubmit={handleConnect} className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                Token SSID da Sessão:
              </label>
              <input
                id="ssid-input-field"
                type="password"
                placeholder="ex: 4a8f9c2d1b0e..."
                value={ssidInput}
                onChange={(e) => setSsidInput(e.target.value)}
                className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            {feedback && (
              <div
                className={`p-2.5 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  feedback.ok
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40'
                    : 'bg-rose-950/40 text-rose-300 border border-rose-800/40'
                }`}
              >
                {feedback.ok ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                )}
                <span>{feedback.msg}</span>
              </div>
            )}

            <button
              id="submit-ssid-btn"
              type="submit"
              disabled={loading || !ssidInput.trim()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-gray-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-gray-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Salvar e Conectar Sessão</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="p-3 bg-gray-950 border-t border-gray-800 text-[11px] text-gray-500 text-center">
          Terminal OTC seguro • Conexão criptografada ponto-a-ponto
        </div>
      </div>
    </div>
  );
}
