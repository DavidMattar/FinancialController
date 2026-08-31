"use client";

/**
 * Página "/investimentos" — lista os ativos (criptomoedas e moedas
 * estrangeiras) cadastrados manualmente, com cotação ao vivo buscada do
 * servidor (que por sua vez consulta CoinGecko e open.er-api.com — essas
 * são as ÚNICAS chamadas externas aprovadas neste app, que é local-first
 * por padrão). A tela recarrega os preços automaticamente a cada 30s.
 *
 * Cada ativo aparece **compactado** (quantidade e custo médio somados de todas
 * as compras, valor atual e lucro em R$ e %) e **expande** ao clicar no
 * símbolo, mostrando o resultado de cada compra individual — mesmo padrão da
 * transação de supermercado que expande em sub-itens. Os dois níveis fecham
 * entre si porque o total é, por construção, a soma das compras
 * (ver `src/lib/investments.ts`).
 */
import { Fragment, useEffect, useState } from "react";
import { formatBRL, formatDate } from "@/lib/format";
import { parseDecimalInput } from "@/lib/decimalInput";
import InfoHint from "@/components/InfoHint";
import ParsedValueHint from "@/components/ParsedValueHint";

/** Resultado de UMA compra do ativo, como a rota de preços devolve. */
interface PurchaseWithResult {
  id: string;
  createdAt: string;
  quantity: number;
  unitCostBrl: number;
  cost: number;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
}

/** Um ativo (holding) já com a cotação atual e o resultado (lucro/prejuízo) calculado pelo servidor. */
interface HoldingWithPrice {
  id: string;
  type: "CRYPTO" | "CURRENCY";
  symbol: string;
  name: string;
  /** Comentário curto do usuário sobre o ativo (coluna "Descrição"). */
  notes: string | null;
  /** Somas das compras — não são colunas do banco. */
  quantity: number;
  avgCostBrl: number;
  cost: number;
  priceBrl: number | null;
  /** Quanto a cotação atual subiu/caiu em reais por unidade em relação ao custo médio pago. */
  priceVsCost: number | null;
  /** A mesma variação em percentual; nulo quando o custo médio é zero. */
  priceVsCostPercent: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  /** As compras que compõem a posição, na ordem em que foram registradas. */
  purchases: PurchaseWithResult[];
}

/** Espelha o resultado de GET /api/investments/prices: os holdings com cotação + totais agregados da carteira. */
interface PricesResponse {
  holdings: HoldingWithPrice[];
  totals: { totalCost: number; totalCurrentValue: number; totalGainLoss: number; totalGainLossPercent: number };
  fetchedAt: string;
}

// Intervalo de atualização automática das cotações (30 segundos).
const REFRESH_MS = 30_000;

// Número de colunas da tabela, usado no colSpan da linha expandida. Fica aqui
// (e não contado no JSX) para quem adicionar uma coluna lembrar de ajustar.
const COLUMN_COUNT = 9;

/**
 * Textos das dicas de "?" — ficam juntos, num lugar só, porque a dica do
 * formulário e a do cabeçalho da tabela falam do MESMO conceito e precisam
 * continuar dizendo a mesma coisa. Ver `src/components/InfoHint.tsx`.
 */
const HINTS = {
  type: "Criptomoeda busca a cotação no CoinGecko; Moeda estrangeira busca no open.er-api.com.",
  symbol:
    "O código do ativo, não o nome: BTC, ETH, SOL, USD, EUR.\nÉ por ele que a cotação é buscada, então precisa ser o código oficial.",
  name: "Só um apelido para você reconhecer o ativo na lista (ex: Bitcoin). Em branco, repete o símbolo.",
  quantity:
    "Quantas unidades DO ATIVO você comprou neste aporte — não o valor em reais.\nEx: 0,0495 se você comprou 0,0495 BTC. Aceita vírgula ou ponto.",
  unitCost:
    "Quantos REAIS custou UMA unidade do ativo nesta compra.\nEx: 402058 se 1 BTC valia R$ 402.058 quando você comprou.\nNão é quanto de cripto um real compra, e não é o total que você gastou.\nSe você sabe só o total, divida: total pago ÷ quantidade.",
  notes:
    "Um comentário curto seu sobre o ativo, para lembrar do que se trata (ex: reserva de longo prazo, recebido em airdrop). Editável direto na tabela.",
  currentPrice: "Quanto UMA unidade do ativo vale agora, em reais, na cotação ao vivo.",
  vsCost:
    "Quanto a cotação de hoje está acima ou abaixo do preço médio que você pagou, por unidade.\nÉ comparação de preço com preço — o lucro da posição está na coluna Resultado.",
  cost: "A soma de tudo que você já pagou neste ativo (todas as compras somadas).",
  currentValue: "Quanto sua quantidade total valeria se fosse vendida à cotação de agora.",
  result:
    "Valor atual menos o custo: o lucro ou prejuízo da posição inteira, em reais e em percentual sobre o que você pagou.",
  quantityColumn:
    "A soma das quantidades de todas as suas compras deste ativo. Clique no símbolo para ver compra por compra.",
} as const;

/** Classe de cor por sinal do valor (verde para ganho, vermelho para perda). */
function signColor(value: number | null): string {
  return (value ?? 0) >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

/** Percentual com sinal explícito ("+50.00%"), ou travessão quando não existe. */
function signedPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function InvestimentosPage() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Aviso de "compra somada na posição existente": o cadastro de um ativo que
  // já existe não cria linha nova (ver POST /api/investments), então sem esse
  // aviso a tela pareceria não ter feito nada.
  const [notice, setNotice] = useState<string | null>(null);
  // Ativos com a lista de compras aberta. Um Set (e não um id só) porque dá
  // para deixar vários abertos ao mesmo tempo, como na tabela de transações.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  /** Abre/fecha a lista de compras de um ativo. */
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Remove um ativo da carteira, pedindo confirmação nativa do navegador antes. */
  async function handleDelete(id: string) {
    if (!window.confirm("Remover este ativo e todas as compras dele?")) return;
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
          onClick={() => {
            setShowForm((v) => !v);
            setNotice(null);
          }}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {showForm ? "Cancelar" : "+ Nova compra"}
        </button>
      </div>

      {showForm && (
        <NewPurchaseForm
          onCreated={(aviso) => {
            setShowForm(false);
            setNotice(aviso ?? null);
            load();
          }}
        />
      )}

      {notice && (
        <p className="text-sm rounded-md px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900">
          {notice}
        </p>
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
              <p className={`text-2xl font-semibold mt-1 ${signColor(data.totals.totalGainLoss)}`}>
                {formatBRL(data.totals.totalGainLoss)} ({data.totals.totalGainLossPercent.toFixed(1)}%)
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 px-4">Ativo</th>
                  <th className="py-2 px-4">
                    <span className="inline-flex items-center gap-1">
                      <span>Descrição</span>
                      <InfoHint label="Descrição">{HINTS.notes}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4">
                    <span className="inline-flex items-center gap-1">
                      <span>Qtd.</span>
                      <InfoHint label="Qtd.">{HINTS.quantityColumn}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4">
                    <span className="inline-flex items-center gap-1">
                      <span>Preço atual</span>
                      <InfoHint label="Preço atual">{HINTS.currentPrice}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4">
                    <span className="inline-flex items-center gap-1">
                      <span>Vs. compra</span>
                      <InfoHint label="Vs. compra">{HINTS.vsCost}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4 text-right">
                    <span className="inline-flex items-center gap-1">
                      <span>Custo</span>
                      <InfoHint label="Custo">{HINTS.cost}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4 text-right">
                    <span className="inline-flex items-center gap-1">
                      <span>Valor atual</span>
                      <InfoHint label="Valor atual">{HINTS.currentValue}</InfoHint>
                    </span>
                  </th>
                  <th className="py-2 px-4 text-right">
                    <span className="inline-flex items-center gap-1">
                      <span>Resultado</span>
                      <InfoHint label="Resultado">{HINTS.result}</InfoHint>
                    </span>
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => {
                  const aberto = expanded.has(h.id);
                  return (
                    <Fragment key={h.id}>
                      <tr className="border-b border-slate-100 dark:border-slate-700">
                        <td className="py-2 px-4">
                          {/*
                            O símbolo é o próprio botão de expandir, como na
                            tabela de transações: um clique abre as compras que
                            formam esta posição.
                          */}
                          <button
                            type="button"
                            onClick={() => toggleExpanded(h.id)}
                            aria-expanded={aberto}
                            // Nome acessível explícito: sem ele o leitor de tela
                            // (e o teste) leria o conteúdo inteiro do botão,
                            // "› BTC Bitcoin 2 compras", que não diz o que o
                            // clique faz.
                            aria-label={`compras de ${h.symbol}`}
                            title={`${h.symbol} — clique para ver as compras`}
                            className="flex items-center gap-1.5 text-left"
                          >
                            <span
                              aria-hidden="true"
                              className={`text-slate-400 dark:text-slate-500 transition-transform ${aberto ? "rotate-90" : ""}`}
                            >
                              ›
                            </span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">{h.symbol}</span>
                            <span className="text-slate-400 dark:text-slate-500 text-xs">{h.name}</span>
                            {h.purchases.length > 1 && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-600 rounded-full px-1.5">
                                {h.purchases.length} compras
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-4">
                          <DescriptionCell holding={h} onSaved={load} />
                        </td>
                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{h.quantity}</td>
                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">
                          {h.priceBrl !== null ? formatBRL(h.priceBrl) : "—"}
                        </td>
                        {/*
                          "Vs. compra": quanto a cotação atual está acima/abaixo
                          do preço médio que o usuário pagou, por unidade do
                          ativo. Substituiu a variação de 24h, que falava do
                          mercado no dia e não do resultado da posição.
                        */}
                        <td className={`py-2 px-4 ${signColor(h.priceVsCost)}`}>
                          {h.priceVsCost !== null ? (
                            <>
                              <span>{signedPercent(h.priceVsCostPercent)}</span>
                              <span className="block text-xs text-slate-400 dark:text-slate-500">
                                {h.priceVsCost >= 0 ? "+" : ""}
                                {formatBRL(h.priceVsCost)} /un.
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-4 text-right text-slate-700 dark:text-slate-300">
                          {formatBRL(h.cost)}
                        </td>
                        <td className="py-2 px-4 text-right text-slate-700 dark:text-slate-300">
                          {h.currentValue !== null ? formatBRL(h.currentValue) : "—"}
                        </td>
                        <td className={`py-2 px-4 text-right font-medium ${signColor(h.gainLoss)}`}>
                          {h.gainLoss !== null
                            ? `${formatBRL(h.gainLoss)} (${h.gainLossPercent?.toFixed(1)}%)`
                            : "—"}
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
                      {aberto && (
                        <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                          <td colSpan={COLUMN_COUNT}>
                            <PurchasesPanel holding={h} onChanged={load} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Lista de compras de um ativo, mostrada quando a linha está expandida: uma
 * linha por aporte, com o resultado daquele aporte isolado.
 *
 * Por que o lucro de cada compra difere entre linhas de um mesmo ativo: a
 * cotação atual é a mesma para todas, mas o preço pago em cada uma é diferente
 * — é justamente isso que a visão compactada (que mostra o custo médio) esconde.
 */
function PurchasesPanel({
  holding,
  onChanged,
}: {
  holding: HoldingWithPrice;
  onChanged: () => void;
}) {
  /**
   * Apaga uma compra. Se for a última, o servidor apaga o ativo junto (ver
   * DELETE /api/investments/[id]/purchases/[purchaseId]) — por isso o texto da
   * confirmação muda nesse caso.
   */
  async function handleDeletePurchase(purchaseId: string) {
    const ultima = holding.purchases.length === 1;
    const pergunta = ultima
      ? `Esta é a única compra de ${holding.symbol} — apagá-la remove o ativo da carteira. Continuar?`
      : "Apagar esta compra?";
    if (!window.confirm(pergunta)) return;
    await fetch(`/api/investments/${holding.id}/purchases/${purchaseId}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Compras de {holding.symbol} — resultado de cada aporte separadamente
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400 dark:text-slate-500">
            <th className="py-1 pr-4">Registrada em</th>
            <th className="py-1 pr-4">Qtd.</th>
            <th className="py-1 pr-4">
              <span className="inline-flex items-center gap-1">
                <span>Preço pago /un.</span>
                <InfoHint label="Preço pago por unidade">{HINTS.unitCost}</InfoHint>
              </span>
            </th>
            <th className="py-1 pr-4 text-right">Custo</th>
            <th className="py-1 pr-4 text-right">Valor atual</th>
            <th className="py-1 pr-4 text-right">Resultado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {holding.purchases.map((p) => (
            <tr key={p.id} className="border-t border-slate-200 dark:border-slate-700">
              <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-400">{formatDate(p.createdAt)}</td>
              <td className="py-1.5 pr-4 text-slate-700 dark:text-slate-300">{p.quantity}</td>
              <td className="py-1.5 pr-4 text-slate-700 dark:text-slate-300">{formatBRL(p.unitCostBrl)}</td>
              <td className="py-1.5 pr-4 text-right text-slate-700 dark:text-slate-300">
                {formatBRL(p.cost)}
              </td>
              <td className="py-1.5 pr-4 text-right text-slate-700 dark:text-slate-300">
                {p.currentValue !== null ? formatBRL(p.currentValue) : "—"}
              </td>
              <td className={`py-1.5 pr-4 text-right font-medium ${signColor(p.gainLoss)}`}>
                {p.gainLoss !== null
                  ? `${formatBRL(p.gainLoss)} (${signedPercent(p.gainLossPercent)})`
                  : "—"}
              </td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => handleDeletePurchase(p.id)}
                  aria-label={`apagar compra de ${formatDate(p.createdAt)}`}
                  className="text-slate-400 hover:text-red-500"
                >
                  excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Célula da coluna "Descrição": um comentário curto do usuário sobre o ativo
 * ("aporte da reserva", "recebido em airdrop"), editável direto na tabela.
 * Grava em `InvestmentHolding.notes` via PATCH ao sair do campo (ou no Enter,
 * que só tira o foco e cai no mesmo caminho) — não há botão de salvar porque
 * o campo é um comentário livre, sem validação para reportar.
 *
 * Texto em branco (ou só com espaços) grava `null`, e não `""`: "sem descrição"
 * é um único valor no banco, mesma regra da nota de aluguel de temporada.
 *
 * O valor digitado vive em estado local, e não no `data` da página: a tela
 * recarrega as cotações a cada 30s, e ler a descrição do `data` faria o
 * recarregamento apagar o que o usuário está digitando. O componente não é
 * remontado nesses recarregamentos (a key da linha é o id do ativo), então o
 * texto sobrevive a eles.
 */
function DescriptionCell({ holding, onSaved }: { holding: HoldingWithPrice; onSaved: () => void }) {
  const [value, setValue] = useState(holding.notes ?? "");
  const [saving, setSaving] = useState(false);

  /** Grava a descrição, mas só se ela realmente mudou (evita PATCH a cada clique fora). */
  async function save() {
    const next = value.trim();
    if (next === (holding.notes ?? "")) return;
    setSaving(true);
    try {
      await fetch(`/api/investments/${holding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: next === "" ? null : next }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="text"
      value={value}
      aria-label={`Descrição de ${holding.symbol}`}
      placeholder="—"
      disabled={saving}
      maxLength={120}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-40 bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-500 dark:hover:border-slate-600 rounded px-1.5 py-1 text-sm text-slate-700 dark:text-slate-300 outline-none"
    />
  );
}

/**
 * Formulário de registro de uma compra. O símbolo é sempre salvo em caixa alta
 * (ex: "btc" → "BTC") pois é assim que o servidor busca o preço correspondente
 * (ver mapeamento em `src/lib/cryptoIds.ts`).
 *
 * Cada envio é uma COMPRA, não um "ativo": se o símbolo já existe, o servidor
 * anexa a compra à posição existente e devolve `merged: true`, e a tela avisa.
 *
 * Cada campo tem uma dica de "?" explicando o que se espera ali — em especial o
 * preço por unidade, que é ambíguo o suficiente para ter gerado dúvida real
 * ("é quanto 1 real compra do ativo, ou quanto custa 1 unidade dele?").
 *
 * O formulário mostra o erro na tela e continua aberto quando o cadastro falha.
 * Antes ele fechava e recarregava a lista de qualquer jeito, ignorando o status
 * da resposta — era por isso que um valor que a API recusava (um preço digitado
 * como "350.000,00", que o `Number()` de antes transformava em `NaN`) aparecia
 * como "não dá para cadastrar mais nada", sem nenhuma mensagem.
 */
function NewPurchaseForm({ onCreated }: { onCreated: (aviso?: string) => void }) {
  const [type, setType] = useState<"CRYPTO" | "CURRENCY">("CRYPTO");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCostBrl, setUnitCostBrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Envia a compra para a API. Quantidade e preço passam por
   * `parseDecimalInput`, que aceita vírgula ou ponto como separador decimal e
   * separador de milhar (ver `src/lib/decimalInput.ts`); se o texto não
   * descrever um número, o envio para antes de sair da tela.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedQuantity = parseDecimalInput(quantity);
    const parsedUnitCost = parseDecimalInput(unitCostBrl);
    if (parsedQuantity === null || parsedUnitCost === null) {
      setError("Quantidade e preço precisam ser números — use vírgula ou ponto (ex: 0,5 ou 3.07).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const upperSymbol = symbol.toUpperCase();
      const res = await fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          symbol: upperSymbol,
          name: name || upperSymbol,
          quantity: parsedQuantity,
          unitCostBrl: parsedUnitCost,
          notes: notes.trim() === "" ? null : notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? JSON.stringify(data.error) : "Erro ao registrar a compra.");
        return;
      }
      // `merged` = o ativo já existia e esta compra entrou na posição dele.
      onCreated(
        data.merged
          ? `Compra registrada na posição que já existia de ${upperSymbol}. Clique no símbolo na tabela para ver compra por compra.`
          : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Tipo
          <InfoHint label="Tipo">{HINTS.type}</InfoHint>
        </label>
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
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Símbolo (ex: BTC, USD)
          <InfoHint label="Símbolo">{HINTS.symbol}</InfoHint>
        </label>
        <input
          type="text"
          required
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Nome (opcional)
          <InfoHint label="Nome">{HINTS.name}</InfoHint>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Quantidade
          <InfoHint label="Quantidade">{HINTS.quantity}</InfoHint>
        </label>
        <input
          type="text"
          required
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
        {/* `plain`: quantidade de um ativo não é valor em reais. */}
        <ParsedValueHint raw={quantity} kind="plain" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Preço pago por unidade (R$)
          <InfoHint label="Preço pago por unidade">{HINTS.unitCost}</InfoHint>
        </label>
        <input
          type="text"
          required
          inputMode="decimal"
          value={unitCostBrl}
          onChange={(e) => setUnitCostBrl(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
        <ParsedValueHint raw={unitCostBrl} kind="money" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          Descrição (opcional)
          <InfoHint label="Descrição do ativo">{HINTS.notes}</InfoHint>
        </label>
        <input
          type="text"
          value={notes}
          maxLength={120}
          onChange={(e) => setNotes(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      {error && <p className="col-span-2 sm:col-span-5 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 col-span-2 sm:col-span-1"
      >
        Registrar compra
      </button>
    </form>
  );
}
