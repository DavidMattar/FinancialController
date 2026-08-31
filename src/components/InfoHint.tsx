"use client";

// Dica de ajuda ao lado de um rótulo: um "?" que, ao receber o mouse (ou o
// foco do teclado), abre uma bolha explicando o que se espera naquele campo.
//
// Por que existe: os campos de investimento têm nomes que não se explicam
// sozinhos — "Preço médio (R$)" pode ser lido como "quantos reais custa uma
// unidade" ou "quanto de cripto um real compra", e essa ambiguidade já gerou
// dúvida real na hora de cadastrar. A dica coloca a resposta a um passe de
// mouse do campo, em vez de num documento que ninguém abre na hora de digitar.
//
// Não usa o `title` nativo do HTML de propósito: ele demora ~1s para aparecer,
// não estiliza, não abre pelo teclado e não caberia um exemplo em duas linhas.
// A abertura é controlada por estado do React (e não por `:hover` no CSS)
// justamente para o comportamento ser testável em jsdom, que não aplica CSS.

import { useId, useState } from "react";

interface Props {
  /** Texto da dica. Pode ter várias linhas — são preservadas na exibição. */
  children: string;
  /**
   * Rótulo do campo a que a dica se refere. Vira o nome acessível do botão
   * ("ajuda sobre Quantidade"), para leitor de tela e para os testes acharem a
   * dica certa quando há várias na mesma tela.
   */
  label: string;
}

export default function InfoHint({ children, label }: Props) {
  const [open, setOpen] = useState(false);
  // Liga o botão à bolha por aria-describedby, para o leitor de tela anunciar a
  // explicação junto com o campo em vez de só um "?" solto.
  const hintId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`ajuda sobre ${label}`}
        aria-describedby={open ? hintId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // O clique alterna, para funcionar em tela de toque (onde não existe
        // "passar o mouse em cima").
        onClick={() => setOpen((v) => !v)}
        className="w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-bold leading-none border border-slate-300 text-slate-500 hover:border-indigo-500 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-indigo-400 dark:hover:text-indigo-400"
      >
        ?
      </button>
      {open && (
        <span
          id={hintId}
          role="tooltip"
          // `whitespace-pre-line` preserva as quebras de linha do texto da dica
          // (mesma razão da nota de estadia do aluguel); `z-20` mantém a bolha
          // acima das linhas seguintes da tabela.
          className="absolute left-0 top-5 z-20 w-64 whitespace-pre-line rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal normal-case text-slate-600 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
        >
          {children}
        </span>
      )}
    </span>
  );
}
