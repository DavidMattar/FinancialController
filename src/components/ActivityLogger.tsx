"use client";

// Liga a interceptação de movimentações/erros (src/lib/logClient.ts) ao ciclo
// de vida do React e ao pop-up de erro.
//
// Não renderiza nada: existe só para instalar (e desinstalar) o invólucro do
// `fetch` e os handlers globais de erro, e para registrar a troca de aba.
// Fica no layout raiz, dentro do ErrorPopupProvider, para valer em todas as
// telas — inclusive nas que forem criadas depois.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installFetchMonitor, installGlobalErrorHandlers, logNavigation } from "@/lib/logClient";
import { useErrorPopup } from "./ErrorPopupProvider";

export default function ActivityLogger() {
  const { report } = useErrorPopup();
  const pathname = usePathname();

  // Instalação com dependência em `report`, que é estável (useCallback no
  // provider) — então na prática instala uma vez e desinstala ao desmontar.
  // A ordem importa: o invólucro do fetch primeiro, porque os handlers globais
  // guardam a referência de `window.fetch` que encontram.
  useEffect(() => {
    const restaurarFetch = installFetchMonitor({ report });
    const removerHandlers = installGlobalErrorHandlers({ report });
    return () => {
      removerHandlers();
      restaurarFetch();
    };
  }, [report]);

  // Uma linha de log por aba aberta. Roda também na primeira carga, então o
  // arquivo do dia sempre começa dizendo onde o usuário entrou.
  useEffect(() => {
    logNavigation(pathname);
  }, [pathname]);

  return null;
}
