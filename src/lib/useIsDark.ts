import { useEffect, useState } from "react";

/**
 * Hook React que informa se o modo escuro está ativo, observando em tempo
 * real a classe CSS `dark` na tag `<html>`.
 *
 * Por que usa um `MutationObserver` em vez de só ler o valor uma vez: o
 * toggle de tema do app muda a classe do `<html>` diretamente via
 * JavaScript (fora do ciclo de renderização do React), então um componente
 * que só lê o valor no primeiro render nunca saberia que o usuário trocou de
 * tema depois. O observer garante que o componente re-renderize sempre que a
 * classe mudar. Usado por componentes de gráfico, que precisam saber a cor
 * de fundo/texto correta para desenhar (bibliotecas de gráfico não reagem
 * automaticamente ao CSS dark mode).
 *
 * @returns `true` se o modo escuro estiver ativo, `false` caso contrário.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
