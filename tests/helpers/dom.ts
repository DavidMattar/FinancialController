/**
 * Busca de campo por rótulo, adaptada ao markup deste app.
 *
 * Os formulários do projeto escrevem o rótulo como um `<label>` IRMÃO do
 * campo, sem `htmlFor`/`id` e sem envolver o input:
 *
 * ```tsx
 * <div className="flex flex-col gap-1">
 *   <label>Valor da limpeza (R$)</label>
 *   <input type="text" ... />
 * </div>
 * ```
 *
 * Nesse formato o `getByLabelText` da Testing Library não encontra nada (ele
 * depende de uma associação real entre rótulo e campo). Em vez de mudar o
 * markup de todas as telas só por causa do teste, este helper reproduz a
 * ligação visual: acha o `<label>` pelo texto e devolve o primeiro campo do
 * mesmo container.
 *
 * Onde o componente já usa `aria-label` (ex: a lista de diárias do modal de
 * aluguel), continue usando `screen.getByLabelText` — é o caminho correto.
 */
type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function textoCasa(texto: string, alvo: string | RegExp): boolean {
  return typeof alvo === "string" ? texto.includes(alvo) : alvo.test(texto);
}

/** O campo cujo `<label>` irmão casa com `rotulo`. Lança erro se não achar. */
export function campoPorRotulo(rotulo: string | RegExp, raiz: ParentNode = document): Campo {
  const labels = Array.from(raiz.querySelectorAll("label"));
  for (const label of labels) {
    if (!textoCasa(label.textContent ?? "", rotulo)) continue;
    const container = label.parentElement;
    const campo = container?.querySelector<Campo>("input, select, textarea");
    if (campo) return campo;
  }
  throw new Error(`Nenhum campo encontrado para o rótulo ${String(rotulo)}`);
}
