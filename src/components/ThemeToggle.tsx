"use client";

// Botão de alternar entre tema claro e escuro (sol/lua), exibido na barra de navegação.
// O tema é aplicado adicionando/removendo a classe "dark" na tag <html> (Tailwind v4
// usa essa classe para decidir quais estilos "dark:" aplicar).

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  // Estado local só para saber qual ícone mostrar (sol ou lua); a fonte de
  // verdade real é a classe "dark" no <html>, definida antes mesmo do React
  // carregar (script inline no layout) para evitar "flash" de tema errado.
  const [isDark, setIsDark] = useState(false);

  // Ao montar o componente, sincroniza o estado local com o tema que já foi
  // aplicado na página (definido pelo script inline do layout ou pela última escolha salva).
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  /** Inverte o tema atual: alterna a classe "dark" no <html> e salva a escolha no localStorage
   * para que a próxima visita já carregue no tema escolhido. */
  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="ml-auto shrink-0 w-9 h-9 flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
