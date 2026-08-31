"use client";

// Pop-up global de erro: toda falha do app aparece aqui, explicada em "o que
// aconteceu" e "por que aconteceu" (ver `src/lib/errorExplain.ts`).
//
// Por que um provider no layout raiz, e não um aviso por tela: antes disso cada
// formulário decidia sozinho se mostrava erro — e a maioria não mostrava, o que
// produzia exatamente o sintoma de "clico e não acontece nada, sem mensagem".
// Com um canal único, uma falha em qualquer lugar (inclusive em código futuro)
// tem para onde ir.
//
// Erros chegam numa FILA, não sobrescrevendo um ao outro: se duas coisas falham
// em sequência, o usuário lê as duas. Falhas idênticas seguidas são unificadas
// (ver `mesmaFalha`), porque uma tela que reenvia sozinha geraria a mesma
// mensagem várias vezes.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ExplainedError } from "@/lib/errorExplain";

interface ErrorPopupApi {
  /** Coloca uma falha na fila do pop-up. */
  report: (error: ExplainedError) => void;
}

const ErrorPopupContext = createContext<ErrorPopupApi | null>(null);

/**
 * Acesso ao pop-up de erro.
 *
 * Fora do provider devolve um `report` que não faz nada, em vez de lançar: o
 * provider vive no layout raiz, então isso só acontece num teste que monta um
 * componente isolado — e nesse caso não abrir pop-up é o comportamento certo.
 */
export function useErrorPopup(): ErrorPopupApi {
  return useContext(ErrorPopupContext) ?? SEM_POPUP;
}

const SEM_POPUP: ErrorPopupApi = { report: () => {} };

/** Duas falhas são "a mesma" quando o texto todo coincide. */
function mesmaFalha(a: ExplainedError, b: ExplainedError): boolean {
  return a.title === b.title && a.what === b.what && a.why === b.why && a.technical === b.technical;
}

export default function ErrorPopupProvider({ children }: { children: ReactNode }) {
  const [fila, setFila] = useState<ExplainedError[]>([]);

  const report = useCallback((error: ExplainedError) => {
    setFila((atual) => {
      const ultimo = atual[atual.length - 1];
      if (ultimo && mesmaFalha(ultimo, error)) return atual;
      return [...atual, error];
    });
  }, []);

  // `useMemo` para o objeto do contexto não trocar de identidade a cada
  // render, o que faria todo consumidor re-renderizar sem motivo.
  const api = useMemo<ErrorPopupApi>(() => ({ report }), [report]);

  const atual = fila[0];
  const restantes = fila.length - 1;

  return (
    <ErrorPopupContext.Provider value={api}>
      {children}
      {atual && (
        <ErrorPopup
          error={atual}
          remaining={restantes}
          onClose={() => setFila((f) => f.slice(1))}
          onCloseAll={() => setFila([])}
        />
      )}
    </ErrorPopupContext.Provider>
  );
}

/** O modal em si. Separado do provider só para ficar legível. */
function ErrorPopup({
  error,
  remaining,
  onClose,
  onCloseAll,
}: {
  error: ExplainedError;
  remaining: number;
  onClose: () => void;
  onCloseAll: () => void;
}) {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      {/*
        Sem fechar ao clicar no fundo, ao contrário do ConfirmDialog: aqui o
        conteúdo é informação que o usuário precisa ter lido, e um clique
        distraído fora do modal descartaria a explicação do que quebrou.
      */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-popup-title"
        aria-describedby="error-popup-what"
        className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900 p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-xl leading-none">
            ⚠️
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="error-popup-title"
              className="text-base font-semibold text-red-700 dark:text-red-400"
            >
              {error.title}
            </h2>

            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  O que aconteceu
                </dt>
                <dd id="error-popup-what" className="text-slate-700 dark:text-slate-200">
                  {error.what}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Por que aconteceu
                </dt>
                <dd className="text-slate-700 dark:text-slate-200">{error.why}</dd>
              </div>
              {error.hint && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    O que fazer
                  </dt>
                  <dd className="text-slate-700 dark:text-slate-200">{error.hint}</dd>
                </div>
              )}
            </dl>

            {error.technical && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowTechnical((v) => !v)}
                  aria-expanded={showTechnical}
                  className="text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
                >
                  {showTechnical ? "esconder detalhe técnico" : "ver detalhe técnico"}
                </button>
                {showTechnical && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-slate-100 dark:bg-slate-900 p-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-all">
                    {error.technical}
                  </pre>
                )}
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Este erro foi gravado no log de erros de hoje, em{" "}
              <code>logs/{new Date().toISOString().slice(0, 10)}/erros.log</code>.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {remaining > 0 && (
            <>
              <span className="mr-auto text-xs text-slate-400 dark:text-slate-500">
                +{remaining} {remaining === 1 ? "outro erro" : "outros erros"} na fila
              </span>
              <button
                type="button"
                onClick={onCloseAll}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Fechar todos
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            {remaining > 0 ? "Próximo" : "Entendi"}
          </button>
        </div>
      </div>
    </div>
  );
}
