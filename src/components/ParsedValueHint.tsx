"use client";

// Eco do valor interpretado, mostrado embaixo de um campo decimal.
//
// Por que existe: "1.000" é ambíguo de verdade — pode ser mil (separador de
// milhar) ou um e zero centésimos (separador decimal). O sistema decidiu que um
// separador sozinho é decimal, porque foi isso que garantiu que "3,07" e "3.07"
// fossem o mesmo número, e porque a regra alternativa (três casas = milhar)
// quebraria uma quantidade de cripto como "1.500" ETH.
//
// Em vez de tentar adivinhar melhor, a tela MOSTRA o que entendeu. O usuário vê
// "= R$ 1,00" logo abaixo do campo e corrige antes de salvar — nenhuma regra de
// adivinhação chega perto disso em confiabilidade.
//
// Campo vazio não mostra nada (não há o que ecoar). Texto que não descreve um
// número mostra o aviso, que é a mesma informação que o envio daria depois, só
// mais cedo.

import { parseDecimalInput } from "@/lib/decimalInput";
import { formatBRL } from "@/lib/format";

interface Props {
  /** O texto cru do campo. */
  raw: string;
  /**
   * `money` formata como moeda ("= R$ 1.234,56"); `plain` mostra o número puro
   * ("= 0,5"), para campos que não são reais — a quantidade de um ativo.
   */
  kind: "money" | "plain";
}

/** Número puro no padrão brasileiro, com até 8 casas (a precisão de quantidade do banco). */
function formatPlain(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(value);
}

export default function ParsedValueHint({ raw, kind }: Props) {
  if (raw.trim() === "") return null;

  const value = parseDecimalInput(raw);
  if (value === null) {
    return (
      <p className="text-xs text-red-600 dark:text-red-400">
        Não consegui ler esse número — use vírgula ou ponto (ex: 3,07).
      </p>
    );
  }

  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      = {kind === "money" ? formatBRL(value) : formatPlain(value)}
    </p>
  );
}
