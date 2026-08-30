/**
 * Normalização de texto para comparações nos testes.
 *
 * O `Intl.NumberFormat("pt-BR")` separa "R$" do número com um espaço
 * NÃO-QUEBRÁVEL (U+00A0, e em algumas versões do ICU U+202F), que é
 * indistinguível de um espaço comum ao ler o código. Comparar direto gera
 * teste que falha "sem motivo" e que volta a falhar quando o Node é
 * atualizado.
 *
 * A classe `\s` do regex já cobre U+00A0 e U+202F, então esta função não
 * precisa de nenhum literal invisível no meio do código — é de propósito.
 * Aplique nos DOIS lados da comparação.
 */
export function normalizarEspacos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\s/g, " ");
}

/** `true` se `texto` contém `trecho`, ignorando diferença de tipo de espaço. */
export function contemTexto(texto: string | null | undefined, trecho: string): boolean {
  return normalizarEspacos(texto).includes(normalizarEspacos(trecho));
}
