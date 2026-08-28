"use client";

/**
 * Página "/investimentos" — lista os ativos (criptomoedas e moedas
 * estrangeiras) cadastrados manualmente, com cotação ao vivo buscada do
 * servidor (que por sua vez consulta CoinGecko e open.er-api.com — essas
 * são as ÚNICAS chamadas externas aprovadas neste app, que é local-first
 * por padrão). A tela recarrega os preços automaticamente a cada 30s.
 */
import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";

/** Um ativo (holding) já com a cotação atual e o resultado (lucro/prejuízo) calculado pelo servidor. */
interface HoldingWithPrice {
  id: string;
  type: "CRYPTO" | "CURRENCY";
  symbol: string;
  name: string;
  quantity: number;
  avgCostBrl: number;
  cost: number;
  priceBrl: number | null;
  change24h: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

/** Espelha o resultado de GET /api/investments/prices: os holdings com cotação + totais agregados da carteira. */
interface PricesResponse {
  holdings: HoldingWithPrice[];
  totals: { totalCost: number; totalCurrentValue: number; totalGainLoss: number; totalGainLossPercent: number };
  fetchedAt: string;
}

// Intervalo de atualização automática das cotações (30 segundos).
const REFRESH_MS = 30_000;

export default function InvestimentosPage() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  /** Busca os holdings com cotação atual e totais calculados no servidor. */
  async function load() {
    const res = await fetch("/api/investments/prices");
    setData(await res.json());
    setLoading(false);
  }

  // Busca os preços ao montar a página e depois repete a cada 30s
  // (polling simples — cotações de cripto/moeda mudam constantemente).
  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  /** Remove um ativo da carteira, pedindo confirmação nativa do navegador antes. */
  async function handleDelete(id: string) {
    if (!window.confirm("Remover este ativo?")) return;
    await fetch(`/api/investments/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Investimentos</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cotações via CoinGecko / open.er-api.com · atualiza a cada 30s
            {data ? ` · última atualização ${new Date(data.fetchedAt).toLocaleTimeString("pt-BR")}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {showForm ? "Cancelar" : "+ Novo ativo"}
        </button>
      </div>

      {showForm && (
        <NewHoldingForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading || !data ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Custo total investido</p>
              <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                {formatBRL(data.totals.totalCost)}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Valor atual</p>
              <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                {formatBRL(data.totals.totalCurrentValue)}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Resultado</p>
              <p
                className={`text-2xl font-semibold mt-1 ${
                  data.totals.totalGainLoss >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatBRL(data.totals.totalGainLoss)} ({data.totals.totalGainLossPercent.toFixed(1)}%)
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 px-4">Ativo</th>
                  <th className="py-2 px-4">Qtd.</th>
                  <th className="py-2 px-4">Preço atual</th>
                  <th className="py-2 px-4">24h</th>
                  <th className="py-2 px-4 text-right">Custo</th>
                  <th className="py-2 px-4 text-right">Valor atual</th>
                  <th className="py-2 px-4 text-right">Resultado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="py-2 px-4">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{h.symbol}</span>
                      <span className="text-slate-400 dark:text-slate-500 text-xs ml-1">{h.name}</span>
                    </td>
                    <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{h.quantity}</td>
                    <td className="py-2 px-4 text-slate-700 dark:text-slate-300">
                      {h.priceBrl !== null ? formatBRL(h.priceBrl) : "—"}
                    </td>
                    <td
                      className={`py-2 px-4 ${
                        (h.change24h ?? 0) >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {h.change24h !== null ? `${h.change24h.toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-2 px-4 text-right text-slate-700 dark:text-slate-300">{formatBRL(h.cost)}</td>
                    <td className="py-2 px-4 text-right text-slate-700 dark:text-slate-300">
                      {h.currentValue !== null ? formatBRL(h.currentValue) : "—"}
                    </td>
                    <td
                      className={`py-2 px-4 text-right font-medium ${
                        (h.gainLoss ?? 0) >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {h.gainLoss !== null ? `${formatBRL(h.gainLoss)} (${h.gainLossPercent?.toFixed(1)}%)` : "—"}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(h.id)}
                        className="text-xs text-slate-400 hover:text-red-500"
                      >
                        excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Formulário de cadastro de um novo ativo (holding). O símbolo é sempre
 * salvo em caixa alta (ex: "btc" → "BTC") pois é assim que o servidor busca
 * o preço correspondente (ver mapeamento em `src/lib/cryptoIds.ts`).
 */
function NewHoldingForm({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState<"CRYPTO" | "CURRENCY">("CRYPTO");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCostBrl, setAvgCostBrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** Envia o novo ativo para a API; valores digitados com vírgula (formato BR) são convertidos para ponto antes de virarem número. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          symbol: symbol.toUpperCase(),
          name: name || symbol.toUpperCase(),
          quantity: Number(quantity.replace(",", ".")),
          avgCostBrl: Number(avgCostBrl.replace(",", ".")),
        }),
      });
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Tipo</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="CRYPTO">Criptomoeda</option>
          <option value="CURRENCY">Moeda estrangeira</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Símbolo (ex: BTC, USD)</label>
        <input
          type="text"
          required
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Nome (opcional)</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Quantidade</label>
        <input
          type="text"
          required
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Preço médio (R$)</label>
        <input
          type="text"
          required
          inputMode="decimal"
          value={avgCostBrl}
          onChange={(e) => setAvgCostBrl(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 col-span-2 sm:col-span-1"
      >
        Adicionar
      </button>
    </form>
  );
}
