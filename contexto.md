# contexto.md

> Documento de contexto do projeto. Objetivo: permitir que uma IA (ou
> qualquer desenvolvedor) faça alterações neste sistema **sem precisar
> reler todo o código antes** — as decisões de negócio, armadilhas
> técnicas e a estrutura de arquivos já mapeadas aqui.
>
> Para instalar o projeto do zero, ver `instaladorParaIA.md`. Este
> arquivo (`contexto.md`) é sobre **o que o sistema faz e por quê**, não
> sobre como colocá-lo no ar.

## 1. O que é este projeto

App web de controle financeiro pessoal, local-first (sem login, um
único usuário, sem nuvem exceto duas cotações externas — seção 7).
Stack: Next.js 16 (App Router) + TypeScript + Prisma 7 + PostgreSQL 17
+ Tailwind CSS v4. Todo o código-fonte já está comentado em português
(JSDoc acima de funções/handlers) — se uma dúvida específica de "o que
essa função faz" não for respondida aqui, o comentário no próprio
arquivo deve responder.

## 2. Mapa de páginas (rotas de usuário)

| Rota | Arquivo | O que é |
|---|---|---|
| `/` | `src/app/page.tsx` | Dashboard: banner de orçamento, cards de resumo, gráficos, pendências de devolução, filtros/views salvas. |
| `/transacoes` | `src/app/transacoes/page.tsx` | CRUD de transações (ledger principal), tabela com filtros. O formulário manual tem o checkbox "continuar lançando" (seção 4.15). |
| `/transacoes-familia` | `src/app/transacoes-familia/page.tsx` | Ledger **isolado** da família (não entra em nada do resto do app). |
| `/receitas` | `src/app/receitas/page.tsx` | Receitas de UM mês (escolhido nos seletores de mês/ano do próprio título), editáveis/excluíveis na própria lista exceto as de "Aluguel Rancho" (seção 4.13), + seção "Aluguéis de Temporada" (colapsável). |
| `/categorias` | `src/app/categorias/page.tsx` | CRUD de categorias (cor, ícone, palavras-chave, flags) + a ordem em que elas aparecem em todo o app (seção 4.14). |
| `/investimentos` | `src/app/investimentos/page.tsx` | Holdings de cripto/moeda com cotação ao vivo. |
| `/relatorios` | `src/app/relatorios/page.tsx` | Filtro de período/categorias, gráficos de tendência mensal e export CSV. No fim da página, bloco separado de **backup/restauração** do banco inteiro (seção 4.8). A regra 15/10/75 **não** fica aqui — ela é do dashboard e de `/receitas` (seção 4.1). |
| `/importar-fatura` | `src/app/importar-fatura/page.tsx` | Duas abas: importar fatura de cartão (PDF) e nota fiscal/NFC-e (PDF ou texto colado). |
| `src/app/layout.tsx` | — | Layout raiz: `Nav`, tema (dark/light), fontes, e o par `ErrorPopupProvider` + `ActivityLogger` que faz o pop-up de erro e o log de toda movimentação valerem em qualquer tela (seção 4.10). |

## 3. Modelos de dados (`prisma/schema.prisma`) e como se relacionam

O schema em si já tem comentários `///` em cada model/enum — leia-o
diretamente para o detalhe de cada campo. Resumo da topologia:

```
Category ──┐
CreditCard ─┤
Invoice ────┼──> Transaction ──> TransactionItem
            │        (ledger principal, com categoria/cartão/fatura opcionais)
            
InvestmentHolding ──> InvestmentPurchase
     (identidade do ativo)   (uma linha por compra; o total e o custo médio
                              da posição são a SOMA delas, não colunas)
DashboardView             (filtros salvos do dashboard, JSON livre)

FamilyTransaction         (ISOLADO — sem relação com nada acima, de propósito)

SeasonalRental ──> SeasonalRentalExpense
       │
       ├─ davidSettlementId ──> RentalSettlement (type=DAVID)
       ├─ familiaSettlementId ─> RentalSettlement (type=FAMILIA)
       ├─ limpezaSettlementId ─> RentalSettlement (type=LIMPEZA)
       └─ transactionId (soft reference, String simples, SEM @relation)
            └─> aponta para a Transaction de receita auto-criada
```

**Isolamentos propositais (não "corrija" isso):**
- `FamilyTransaction` não tem nenhuma FK/relation para `Category`,
  `CreditCard`, `Invoice` ou `Transaction`. Nunca deve aparecer em
  relatórios, métricas ou no orçamento do ledger principal.
- `SeasonalRental`/`SeasonalRentalExpense` também não têm relação com o
  ledger principal. A ligação com a `Transaction` de receita gerada
  automaticamente (`transactionId`) é uma **soft reference** — um campo
  `String?` puro, sem `@relation` — feita assim de propósito para não
  precisar tocar no model `Transaction` compartilhado.
- `SeasonalRental` tem **três relações Prisma nomeadas** distintas para
  o mesmo model `RentalSettlement` (`"DavidSettlementRentals"`,
  `"FamiliaSettlementRentals"` e `"LimpezaSettlementRentals"`), porque os
  repasses de David, da Família e da Limpeza são trilhas independentes —
  um aluguel pode estar fechado para uma e aberto para as outras, em
  qualquer combinação.

## 4. Regras de negócio importantes (não são óbvias lendo só o código)

### 4.1. Orçamento 15/10/75 (`src/lib/budget.ts`, `/api/budget/summary`)
- 15% da receita do período = "livre para gastar". `Category.deductsFromFreeSpend`
  (toggle na tela de Categorias, só em categorias EXPENSE) marca quais
  categorias contam contra essa fatia. Os outros 10% (dízimo) e 75%
  (investimento) são **informativos**: não são abatidos de nada.
- `disponível = 15% da receita do período − soma das despesas do período nas
  categorias marcadas`. **Sempre recalculado do zero a cada request**,
  nunca um saldo salvo/acumulado — evita que o valor "arraste" erro e
  lida naturalmente com edições/exclusões/lançamentos retroativos.
- **O período é PARAMETRIZADO** (`?from=YYYY-MM-DD&to=YYYY-MM-DD`). Era fixo no
  mês corrente até 2026-08-31; hoje quem manda o período é a tela:
  - `/receitas` manda o mês escolhido nos seletores de mês/ano do título
    (`monthRange` de `dateRanges.ts`), e os quatro cards seguem esse mês junto
    com a lista de lançamentos.
  - o dashboard manda o **mesmo período do `DateRangePicker`**, para o banner
    dos 15% falar do que está filtrado na tela, e não de um mês fixo.
  - **sem parâmetro a resposta continua sendo a do mês corrente** — é o padrão
    de quem chamar a rota sem nada.
  - Data fora do formato `YYYY-MM-DD` devolve **400**, em vez de cair no mês
    corrente: período errado exibido sem aviso é pior do que um erro visível
    (o pop-up da seção 4.10 mostra a mensagem).
- **A fatia de 15% ACUMULA dentro do período, mês a mês.** Estourar num mês não
  zera na virada, e sobrar num mês aumenta o disponível do seguinte. Com
  receita de R$ 100/mês (15% = R$ 15) e R$ 32 gastos no primeiro mês: fim do
  1º mês −R$ 17, fim do 2º −R$ 2, fim do 3º (sem gastar nada) +R$ 13.
  - Matematicamente o total do período é só "15% da receita do período menos o
    gasto descontável do período" — o acúmulo não muda o resultado. O campo
    `months` da resposta (um item por mês, com `allocated`, `spent`,
    `monthAvailable` e `cumulativeAvailable`) existe para mostrar o CAMINHO, que
    é a pergunta real: "em que mês eu estourei?".
  - Os totais são derivados da soma de `months` justamente para o último
    `cumulativeAvailable` fechar sempre com `freeToSpend.available` — as duas
    visões do banner não podem divergir (mesma postura do `aggregatePurchases`
    da seção 4.7).
  - Mês do período **sem nenhuma transação entra zerado** na lista
    (`enumerateMonths` não deixa furo): é o mês em que a receita entrou sem
    gasto que faz o acumulado voltar ao positivo, e sem ele a conta "não
    fecharia" na leitura.
  - O mês de referência de cada transação é o do calendário **local**
    (`monthKey`), não UTC — uma transação de 31/08 à noite cairia em setembro
    (mesma armadilha de fuso da seção 5.2 e do log da seção 4.10).
- A conta inteira vive em `src/lib/budget.ts` e é **pura** (não toca banco nem
  rede): a rota só junta as duas consultas do Prisma com o cálculo. É o que
  permite testar o acúmulo sozinho, e é o único lugar onde os percentuais
  15/10/75 estão escritos.
- No banner do dashboard (`FreeToSpendBanner`) o detalhamento mês a mês só
  aparece com **mais de um mês** no período (num mês só ele repetiria os
  números de cima) e vem **recolhido** num `<details>`, para o banner não
  crescer 12 linhas quando o filtro é "Este ano".
- O texto do período vem de `periodLabel` (`format.ts`): meses inteiros são
  descritos por nome ("agosto de 2026", "junho de 2026 a agosto de 2026") e um
  período que corta o mês no meio cai nas datas ("10/06/2026 a 20/08/2026") —
  dizer "agosto de 2026" para 05/08–20/08 seria mentira, e o banner existe
  justamente para dizer de que período é o número.
- Categorias com `deductsFromFreeSpend=true` por padrão no seed:
  Alimentação, Assinaturas e Streaming, Vestuário, Lazer, Outros.

### 4.2. Aluguéis de temporada (`src/lib/rentalCalc.ts`, `rentalPriceTable.ts`)
- `tableValue` (valor de referência pela tabela de preços) **nunca é
  salvo no banco** — sempre recalculado a partir de `checkIn`/`checkOut`
  na hora da leitura. Uma correção futura na tabela de preços conserta
  retroativamente todos os registros antigos.
- **Diárias customizadas por aluguel (`SeasonalRental.nightRateOverrides`).**
  Único dado de precificação que É salvo: um `Json?` no formato
  `{ "YYYY-MM-DD": valor }`, uma chave por noite. Cada noite listada ali
  substitui a tarifa da tabela **somente naquele aluguel**; as noites
  ausentes continuam seguindo a tabela e continuam se corrigindo
  retroativamente. Editado na lista "Valores das diárias" do modal de
  edição (`SeasonalRentalModal`), que mostra noite a noite o valor da
  tabela, o valor aplicado e um "restaurar" por linha.
  - `computeNightRates()` (`rentalPriceTable.ts`) é a fonte desse
    detalhamento; `computeTableValue()` virou a soma dele. Todo caminho
    que calcula um aluguel precisa repassar os overrides — hoje:
    `serializeRentalWithComputed`, as rotas de `seasonal-rentals`
    (POST/PUT/preview) e `rentalSettlements.findUnsettledRentals`
    (se o repasse ignorasse os overrides, fecharia um valor diferente
    do Total David exibido no próprio aluguel).
  - Como o mapa de gastos extras, é **substituído por completo** a cada
    edição (mapa vazio = todas as noites voltam para a tabela), e
    `sanitizeNightRateOverrides()` descarta noites fora do período —
    necessário porque o usuário pode customizar diárias e depois mudar
    o check-in/check-out.
  - É um Json livre, e não uma tabela relacionada, porque é sempre lido
    e gravado inteiro, como um bloco (mesmo motivo de
    `DashboardView.filters`). Registros criados antes desta feature têm
    `null` — `readNightRateOverrides()` trata isso (e qualquer conteúdo
    fora do formato) como "sem customização".
- Fórmulas (`computeRental()`):
  ```
  davidTenPercent  = netAmountReceived * 0.10
  extraTableValue  = netAmountReceived - davidTenPercent - cleaningFee - tableValue - extrasTotal
  totalDavid       = davidTenPercent + max(0, 0.5 * extraTableValue)
  netForDistribution = netAmountReceived - totalDavid - cleaningFee
  ```
- **Os 10% são um piso mínimo garantido para o David.** Se a diária
  reservada ficou abaixo do valor de tabela, `extraTableValue` fica
  negativo mas é travado em 0 antes de aplicar os 50% — o `totalDavid`
  nunca cai abaixo de `davidTenPercent`. A perda é absorvida inteiramente
  por `netForDistribution`.
- Tabela de preços (`rentalPriceTable.ts`): alta temporada (15/dez–15/fev)
  R$200 (dia de semana) / R$300 (fim de semana) por noite; baixa
  temporada R$140/R$180; feriados nacionais R$350/noite (calendário via
  algoritmo de Meeus/Jones/Butcher para a Páscoa). Feriados de MG/BH
  **não estão incluídos** (a tabela-fonte não especificava essas datas —
  gap conhecido, não um bug). Taxa de limpeza padrão é fixa R$180
  (`CLEANING_FEE_FIXED`), mas o campo continua editável pelo usuário.
- Toda criação de `SeasonalRental` gera automaticamente uma `Transaction`
  de receita (`type: INCOME`, categoria "Aluguel Rancho" buscada por
  nome) no valor de `totalDavid`, datada `checkOut + 1 dia`. Apagar o
  aluguel apaga essa transação vinculada também.
- **Repasses (`RentalSettlement`) são permanentes.** Existem **três**
  tipos independentes: `DAVID` (soma de `totalDavid` dos aluguéis não
  liquidados), `FAMILIA` (soma de `netForDistribution`, **dividida por
  2 só no total final**, não por aluguel) e `LIMPEZA` (soma de
  `cleaningFee`, **sem nenhuma divisão** — é o que sai para pagar quem
  limpa). Gerar um repasse trava os aluguéis correspondentes
  (`davidSettlementId`/`familiaSettlementId`/`limpezaSettlementId`) para
  nunca serem contados de novo. **Não existe UI de cancelar/desfazer
  repasse — foi pedida e depois explicitamente retirada pelo usuário.
  Não adicione essa funcionalidade a menos que seja pedida de novo.**
  - As três trilhas somadas fecham exatamente o `netAmountReceived` de
    cada aluguel, porque `netForDistribution` já é
    `netAmountReceived − totalDavid − cleaningFee`. Foi por isso que a
    limpeza virou uma terceira trilha, e não um desconto embutido em
    outra: o dinheiro já estava separado na fórmula, só faltava o
    fechamento por período.
  - A base de cada trilha vive em **um lugar só**, o `rentalShare()` de
    `src/lib/rentalSettlements.ts`, e a coluna que trava o aluguel em
    cada uma vive no mapa `SETTLEMENT_FIELD` do mesmo arquivo (é o que
    garante que o filtro do `findMany` e o `updateMany` do fechamento
    nunca divirjam). O `perRentalValue` do `SettlementModal` é o espelho
    do `rentalShare` na tela — mudar um sem o outro faz a lista do
    preview não bater com o total gerado.
  - `LIMPEZA` é a única trilha que **não** depende de `computeRental()`:
    lê o `cleaningFee` direto do registro, então gasto extra e diária
    customizada não a afetam.
- **Editar um `SeasonalRental` já é permitido mesmo depois de repassado**
  (botão "editar" por aluguel em `SeasonalRentalsSection`, `PUT
  /api/seasonal-rentals/[id]`). Isso é diferente de desfazer um repasse:
  o `RentalSettlement.totalAmount` já fechado continua congelado — só o
  registro do aluguel em si é atualizado. Se o novo `totalDavid`
  calculado mudar, a `Transaction` de receita vinculada
  (`transactionId`) é atualizada com o novo valor/data/descrição na
  mesma chamada, para o ledger principal continuar batendo com o
  aluguel. Os gastos extras (`SeasonalRentalExpense`) são substituídos
  por completo a cada edição (delete + recreate), não casados por id.
- **Nota da estadia (`SeasonalRental.notes`).** Observação livre por
  aluguel (textarea "Nota sobre a estadia" no `SeasonalRentalModal`,
  exibida na lista com `whitespace-pre-line` para preservar as quebras
  de linha digitadas). Nota em branco ou só com espaços é gravada como
  `null`, não como `""` — "sem nota" é um único valor no banco.
  **Não entra no relatório de WhatsApp**, por decisão explícita do
  usuário: é anotação interna, não informação para o destinatário.
- Relatório de WhatsApp (`src/lib/whatsappReport.ts`) é **por aluguel
  individual**, não por período — cada aluguel na lista tem seu próprio
  botão. Formatação usa `*texto*` para negrito (convenção do WhatsApp).

### 4.3. Sub-itens de transação (`TransactionItem`)
- Puramente visual/informativo — nunca lido por métricas, export ou
  relatórios. Só aparece ao expandir uma transação na `TransactionsTable`.
- `Category.fixedSubItems: String[]` (hoje só "Viagem" →
  Comida/Transporte/Estadia/Entretenimento/Extras): ao definir/mudar a
  categoria de uma transação para uma com `fixedSubItems` não vazio,
  `ensureFixedSubItems()` (`src/lib/transactionItems.ts`) cria esses
  itens com valor 0 automaticamente, de forma idempotente. Estender para
  outra categoria = só popular o array, sem mudança de código.
- Categorias com `fixedSubItems` não vazio **não podem ser excluídas**
  (DELETE `/api/categories/[id]` retorna 400) — regra calculada
  dinamicamente a partir do array, não uma flag separada.

### 4.4. Categorias de receita e devoluções pendentes
- Categorias `kind: INCOME` forçam `type: INCOME` na transação
  (create e update, no servidor) — o formulário de lançamento manual
  também trava e ajusta o select de Tipo automaticamente.
- `Transaction.pendingReturn: Boolean` — "verificar devolução". Linha fica
  destacada em vermelho em toda a UI. `PendingReturnsPanel` no dashboard
  ignora o filtro de período (busca própria) porque é para persistir
  entre períodos.
  - **A trava de e-commerce vale só para a transação JÁ CRIADA.** No
    `TransactionItemsPanel` (painel da linha expandida) o checkbox só
    aparece quando a transação tem `creditCardId` E a descrição casa com
    um comerciante conhecido (`src/lib/ecommerceMerchants.ts`) — regra
    original, inalterada.
  - **Na criação não há trava nenhuma**, por decisão explícita do usuário:
    o checkbox aparece sempre no formulário manual de `/transacoes` e em
    toda linha da revisão de fatura importada. O raciocínio: na hora de
    lançar, quem sabe o que precisa de acompanhamento é o usuário — pode
    ser loja física, serviço, adiantamento. Não "conserte" isso aplicando
    `isEcommerceMerchant` nesses dois pontos.
  - Os dois caminhos de criação aceitam o campo: `POST /api/transactions`
    (`pendingReturn` opcional) e `POST /api/invoices/confirm` (um
    `pendingReturn` por lançamento).

### 4.5. Importação de fatura de cartão (`src/lib/invoiceParsers/`)
- Só suporta **Santander** (`santander.ts`). Extração via `pdfjs-dist`
  (`src/lib/pdf.ts`), reconstruindo linhas por `hasEOL` — reproduz a
  ordem do `pdftotext -raw`, **não** `-layout` (que embaralha faturas
  com múltiplos titulares em colunas lado a lado).
- Fluxo em duas etapas: `parse` (preview, nada salvo) → `confirm`
  (salva no banco após o usuário revisar/editar). Mesmo padrão usado
  para notas fiscais.
- **Na revisão dá para reescrever a descrição de cada lançamento** (input
  no lugar do texto). Existe porque a fatura traz o nome do adquirente
  ("PAG*Loja1234"), que muitas vezes não diz nada — renomear antes de
  gravar evita abrir cada transação depois.
  - A descrição original fica em `EditableRow.parsedDescription`, que é
    **estado só da tela** (alimenta o "↺ restaurar" por linha e o `title`)
    e é removida do corpo enviado por `toConfirmPayload()`. `EditableRow`
    existe separado de `PreviewTransaction` justamente para esses campos
    serem obrigatórios na tela e ausentes no que a API devolve — sem isso
    a leitura precisaria de um fallback que a interface nunca produz.
  - Renomear **não** re-sugere categoria: a sugestão por
    `Category.keywords` acontece no `parse`, e daí em diante a categoria
    é escolha explícita no select da mesma linha.
  - Descrição vazia bloqueia o botão "Confirmar importação" (a rota exige
    `z.string().min(1)`) — melhor avisar na tela que receber erro de
    validação depois de revisar a fatura inteira.
- Para adicionar outro banco: só depois de receber uma amostra real do
  PDF — nunca implemente um parser a partir de suposição de layout.
  Registrar o novo parser em `invoiceParsers/index.ts`.

### 4.6. Importação de nota fiscal / NFC-e (`src/lib/receiptParsers/nfce.ts`)
- Só suporta o formato de **NFC-e de Minas Gerais** (portal SEFAZ-MG).
  O usuário precisa resolver o CAPTCHA do portal manualmente e salvar a
  página como PDF (Ctrl+P) — **nunca tente automatizar/contornar um
  CAPTCHA por código**.
- Peculiaridade real do formato (não é bug): quantidade usa decimal com
  **ponto** (`1.5800`), valores em R$ usam decimal com **vírgula**
  (`R$ 3,98`) — o parser trata os dois formatos.
- Ao confirmar, cria UMA `Transaction` (EXPENSE, source IMPORT) + um
  `TransactionItem` por produto incluído, reaproveitando o recurso de
  sub-itens visuais.

### 4.7. Investimentos (`src/lib/investments.ts`, `prices.ts`)
- Cotação de cripto via **CoinGecko**, de moeda estrangeira via
  **open.er-api.com** — únicas chamadas externas do app, sem chave de
  API, sem dado do usuário saindo da máquina. Cache em memória de 30s.
- Preço atual nunca é salvo — é buscado ao vivo e combinado com a posição na
  exibição.
- **A COMPRA individual é a única coisa gravada.** `InvestmentPurchase` tem
  uma linha por aporte (quantidade + `unitCostBrl`, os reais pagos por UMA
  unidade naquela compra). `InvestmentHolding` é só a identidade do ativo:
  **não tem colunas de quantidade nem de custo médio**. Os dois são derivados
  da soma das compras em `aggregatePurchases()` (`src/lib/investments.ts`),
  na leitura, toda vez — mesma regra do `tableValue` de aluguel (seção 6).
  - É isso que torna **impossível** a visão compactada divergir da expandida:
    o total não é um número guardado em paralelo, é a soma daquelas linhas.
  - O custo médio é **ponderado pela quantidade** (`cost / quantity`): 3
    unidades a R$100 + 1 a R$200 dá R$125, não R$150.
  - `unitCostBrl` é `Decimal(24, 12)` de propósito: 1 SHIB vale ~R$0,000026,
    e com 2 casas (como era o `avgCostBrl` antigo) o preço arredondaria para
    0,00 e o resultado da posição sairia errado.
- **A tela mostra os dois níveis** (`/investimentos`): a linha do ativo
  compactada, e a lista de compras ao clicar no símbolo — mesmo padrão da
  transação de supermercado que expande em sub-itens. Cada compra mostra o
  resultado dela isolada; é informação que o custo médio esconde, porque a
  cotação é a mesma para todas mas o preço pago em cada uma não.
- **Cadastrar de novo um ativo que já existe é uma SEGUNDA COMPRA, não um
  erro.** O schema tem `@@unique([type, symbol])`, então existe uma única
  posição por tipo+símbolo. `POST /api/investments` procura essa posição
  antes de criar: se ela existe, a compra entra como `InvestmentPurchase`
  dela e a rota devolve `200` com `merged: true` (a tela usa esse sinal para
  avisar que a compra entrou numa posição que já existia, em vez de parecer
  que não fez nada por não ter surgido linha nova). Sem isso o segundo
  cadastro estourava a constraint, virava 500 e o formulário — que ignorava o
  status da resposta — fechava sem mensagem: era o "não consigo adicionar
  mais nada".
  - **Nada é sobrescrito nem recalculado na segunda compra**: não há custo
    médio para atualizar. Nome e descrição da posição existente ficam como
    estão — a compra nova fala de quantidade e preço, não da identidade do
    ativo.
- **`DELETE /api/investments/[id]/purchases/[purchaseId]`** apaga UMA compra
  (o "excluir" de cada linha da lista expandida). Existe porque, com o custo
  médio derivado, um aporte digitado errado não tem mais como ser consertado
  por um PATCH — sem essa rota o único caminho seria apagar o ativo inteiro e
  relançar tudo.
  - **Apagar a última compra apaga a posição junto**, na MESMA transação do
    Postgres: posição sem compra apareceria zerada na tabela, indistinguível
    de um ativo realmente sem saldo.
  - A compra é buscada com `holdingId` no filtro, não só pelo id dela, para
    uma URL com o par trocado não apagar a compra de outro ativo.
- **Dicas de "?" nos campos e nos cabeçalhos** (`src/components/InfoHint.tsx`).
  Existem porque "Preço médio (R$)" era ambíguo o suficiente para gerar
  dúvida real — "é quanto 1 real compra do ativo, ou quanto custa 1 unidade
  dele?". O campo virou "Preço pago por unidade (R$)" e a dica responde a
  pergunta com exemplo. Os textos ficam todos no objeto `HINTS` da página, num
  lugar só, porque a dica do formulário e a do cabeçalho falam do MESMO
  conceito e precisam continuar dizendo a mesma coisa.
  - A abertura é estado do React (`onMouseEnter`/`onFocus`/`onClick`) e não
    `:hover` no CSS, para funcionar no teclado e no toque — e para ser
    testável em jsdom, que não aplica CSS. Também não usa o `title` nativo:
    demora ~1s, não estiliza e não caberia um exemplo em duas linhas.
- **Coluna "Vs. compra" (não mais "24h").** A tabela mostra quanto a cotação
  atual está acima/abaixo do preço médio pago, **por unidade** do ativo
  (`priceVsCost` em R$ e `priceVsCostPercent` em %, calculados na rota de
  preços). Substituiu a variação de 24h do CoinGecko, que falava de como o
  mercado andou no dia e não de como a posição está indo. O percentual é nulo
  quando `avgCostBrl` é 0 (ativo recebido, não comprado) — não existe
  "quanto subiu em relação a zero" —, mas o valor absoluto continua válido.
  - `CryptoPrice.brl24hChange` continua existindo em `src/lib/prices.ts`
    porque descreve o payload do CoinGecko, mas **nenhuma tela o usa** hoje.
- **Coluna "Descrição" (`InvestmentHolding.notes`).** Comentário curto do
  usuário sobre o ativo, editável direto na célula da tabela (grava por
  `PATCH` ao sair do campo ou no Enter, que só tira o foco). Texto em branco
  grava `null`, não `""` — mesma regra da nota de aluguel (seção 4.2). O
  texto em edição vive em estado local do componente, e não no `data` da
  página: a tela recarrega as cotações a cada 30s e ler do `data` faria o
  recarregamento apagar o que está sendo digitado.

### 4.8. Backup e restauração em JSON (`src/lib/backup.ts`, `/api/backup/*`)
- Bloco no fim de `/relatorios` (`BackupPanel`), separado do relatório de
  propósito: não tem relação com o período/categorias filtrados acima, é
  ferramenta de manutenção dos dados. Motivo de existir: o app é local-first
  e sem nuvem, então o usuário precisa de um jeito de fazer um retrato dos
  dados antes de mexer em algo que afete o banco e voltar atrás **sem passar
  pelo PostgreSQL** (`pg_dump`/`psql`).
- **Os `id` (cuid) são preservados** no arquivo e na restauração. É isso que
  mantém as relações (categoria da transação, fatura do lançamento, aluguel do
  gasto extra, repasse do aluguel) e o que torna a restauração idempotente:
  aplicar o mesmo arquivo duas vezes não duplica nada.
- **`GET /api/backup/export`** devolve todas as 11 tabelas (`findMany()` sem
  `include`, só escalares + colunas de FK) num JSON indentado, com
  `Content-Disposition: attachment` (mesmo padrão do CSV de transações).
  `Decimal` sai como string e `Date` como timestamp ISO completo — é o que o
  `JSON.stringify` faz com os tipos do Prisma, e é o que a restauração espera
  de volta.
- **`POST /api/backup/restore?mode=replace|merge`** recebe o arquivo inteiro
  como corpo. `mode` é obrigatório e **não tem padrão de propósito** — é
  destrutivo demais para adivinhar a intenção.
  - `replace`: apaga tudo e insere o arquivo (a restauração de verdade).
  - `merge`: mantém o banco e insere só o que falta (`skipDuplicates`, que
    cobre tanto `id` repetido quanto os índices únicos). Para recuperar algo
    apagado sem perder o que foi lançado depois do backup.
- **Tudo roda em UMA transação do Postgres** (`timeout` de 120s, bem acima do
  padrão de 5s do Prisma): ou aplica inteiro, ou o banco fica exatamente como
  estava. Isso é essencial no `replace`, cujo primeiro passo é apagar tudo.
- Duas ordens importam e estão explícitas no código: inserção pai→filho
  (`insertBackup`) e exclusão filho→pai (`wipeAll`). Em particular
  `RentalSettlement` entra **antes** de `SeasonalRental`, porque é o aluguel
  que aponta para o repasse. O `wipeAll` apaga cada tabela explicitamente em
  vez de confiar em `onDelete: Cascade`, para a ordem ficar visível e não
  mudar de comportamento junto com o schema.
- **Nada é recalculado na restauração** — o backup guarda só o que o banco
  guarda. Valores derivados (`tableValue`, orçamento 15/10/75, cotação de
  investimento) continuam sendo recalculados na leitura, então restaurar um
  backup antigo já com uma tabela de preços nova é seguro e esperado
  (é a mesma regra da seção 6).
- `new Date()` é usado aqui sem passar por `dateOnly.ts` e **isso está
  correto**: as datas do arquivo são timestamps ISO completos (`...T03:00:00.000Z`),
  que já carregam o instante exato. A armadilha de fuso da seção 5.2 vale para
  strings de data pura ("YYYY-MM-DD"), que não aparecem no backup.
- O `updatedAt` do arquivo é respeitado na inserção (verificado): o
  `@updatedAt` do Prisma só preenche o campo quando ele não é informado, então
  um registro restaurado mantém a data de modificação original.
- O painel valida o arquivo **no navegador** e mostra um resumo (data de
  geração + contagem por tabela) antes de qualquer gravação — é o mesmo padrão
  de import em duas etapas da seção 6.
- Se um dia o formato mudar de forma incompatível, incremente
  `BACKUP_FORMAT_VERSION`; a rota recusa arquivo com versão maior que a que
  ela entende. Cada tabela é opcional no schema zod (padrão `[]`), então
  backup gerado antes de um model novo existir continua restaurável.
- **Formato 2 (compras de investimento) — o único exemplo real de migração
  de formato até agora.** No formato 1 a posição guardava `quantity` e
  `avgCostBrl` em colunas próprias; hoje quem guarda isso é
  `InvestmentPurchase` (seção 4.7). Um arquivo do formato 1 continua
  restaurável: os dois campos antigos seguem aceitos no
  `investmentHoldingSchema` (como opcionais, marcados LEGADO) e
  `legacyPurchasesFromHoldings()` os converte em UMA compra equivalente —
  mesmo total investido, mesmo custo médio, mesmo resultado.
  - Sem essa conversão, restaurar um backup antigo deixaria a posição com
    zero compras e ela apareceria **zerada** na tela: perda de dado silenciosa,
    justamente no arquivo que existe para evitar perda de dado.
  - O id da compra convertida é derivado do id da posição
    (`<holdingId>-legacy`) e não um cuid novo, para a restauração continuar
    idempotente: aplicar o mesmo arquivo duas vezes não dobra a posição.
  - Uma posição que já venha com compras no arquivo é ignorada pela conversão
    mesmo que ainda carregue os campos antigos — o dado real ganha do legado.

### 4.9. Mover uma transação para o ledger da família (`POST /api/transactions/[id]/move-to-family`)
- Botão "→ Família" por linha em `/transacoes` (só lá: `TransactionsTable` só
  mostra o botão quando recebe `onMoveToFamily`, e nem o dashboard nem
  `/receitas` passam esse callback — mover é decisão do ledger principal, não
  da tela de receitas, que edita as linhas dela mas não as tira do lugar).
- É **movimentação, não cópia**: cria a `FamilyTransaction` e apaga a
  `Transaction`, as duas coisas na MESMA transação do Postgres — sem isso
  uma falha no meio deixaria o lançamento nos dois ledgers ou em nenhum.
- **Só migram os campos que a família tem**: data, descrição, valor, tipo e
  observação. Categoria, cartão, fatura, parcelamento, `pendingReturn` e
  sub-itens **são perdidos** — é consequência direta do isolamento
  proposital entre os dois ledgers (seção 3), não um esquecimento. Os
  sub-itens saem por `onDelete: Cascade`. O diálogo de confirmação lista
  isso explicitamente antes de o usuário confirmar.
- **`PAYMENT` vira `EXPENSE`** (mapa `FAMILY_TYPE` na rota), porque
  `FamilyTransactionType` não tem `PAYMENT` de propósito. A rota devolve
  `convertedFromPayment` para a tela avisar da conversão sem repetir a
  regra no front-end.
- É uma rota própria, e não um PATCH em `/api/transactions/[id]`, porque
  não é edição de campo: são duas tabelas sem relação nenhuma e o
  resultado é a transação deixar de existir no ledger principal.
- **Não existe caminho de volta pela interface** (nem `DELETE`/`GET` nessa
  rota) — mesma postura dos repasses de aluguel. Se a transação movida era
  a receita auto-criada de um aluguel, o `SeasonalRental.transactionId`
  fica órfão, exatamente como já acontece ao excluir a transação, e o PUT
  do aluguel já tolera isso.
- `ConfirmDialog` passou a renderizar a mensagem com `whitespace-pre-line`
  para caber essa explicação em vários parágrafos; mensagem de uma linha
  não muda em nada.

### 4.10. Pop-up de erro e log de movimentações (`src/lib/logClient.ts`, `logFiles.ts`)

Duas metades do mesmo requisito — "nada fica sem registro": o pop-up é o canal
IMEDIATO (o usuário sabe na hora o que quebrou e por quê) e os arquivos de log
são o registro PERMANENTE.

**Interceptação num lugar só.** O app tem mais de 50 chamadas de API espalhadas
em páginas, componentes e modais. Em vez de instrumentar uma por uma,
`installFetchMonitor()` **troca o `window.fetch` global** por um invólucro, e
`installGlobalErrorHandlers()` escuta `error` e `unhandledrejection`. Os dois
são instalados pelo `ActivityLogger` (no layout raiz, dentro do
`ErrorPopupProvider`). Consequência boa: chamada de API escrita amanhã já nasce
registrada, sem ninguém lembrar de nada.

**O que É e o que NÃO é registrado:**
- Escrita (POST/PUT/PATCH/DELETE) bem-sucedida → linha `gravou`.
- Qualquer falha (status fora de 2xx, rede caída, exceção de JS) → linha `erro`
  em DOIS arquivos (ver abaixo) + pop-up.
- Entrada numa aba → linha `navegou`.
- **Leitura bem-sucedida NÃO é registrada.** O dashboard e a tela de
  investimentos consultam a API a cada 30s; registrar isso soterraria as
  mudanças de verdade no meio de milhares de linhas de consulta. Leitura que
  FALHA é erro, e é registrada.

**Três regras que existem para não criar laço nem ruído** (as três com teste):
1. **A rota `/api/logs` não é interceptada.** Se fosse, uma falha de gravação
   viraria um evento de log, que falharia, que geraria outro evento — laço
   infinito. Falha de log vai só para o `console.error`.
2. **Requisição cancelada não é erro** (`AbortError`). O `SeasonalRentalModal`
   aborta a prévia a cada tecla; sem essa regra a tela encheria de pop-up
   enquanto o usuário digita.
3. **As rotas de prévia são registradas mas não abrem pop-up**
   (`POPUP_MUTED_PATHS`). Elas recalculam a cada tecla e podem legitimamente
   recusar um estado intermediário do formulário — o modal já mostra esse aviso
   embutido.

**Estrutura dos arquivos**, criada automaticamente (`mkdir recursive`):

```
logs/
  2026-08-31/
    transacoes.log     ← toda movimentação da aba, INCLUSIVE os erros dela
    investimentos.log
    erros.log          ← o log PARALELO: só erros, de todas as abas
```

- **Um erro é gravado nos DOIS arquivos.** No da aba, para a cronologia ficar
  completa (dá para ver o que o usuário fez imediatamente antes de quebrar); no
  `erros.log`, para "houve erro hoje?" ser respondido abrindo um arquivo só.
  Nenhum dos dois, lido isolado, esconde um erro.
- **A pasta do dia usa a data LOCAL**, não UTC — é o dia que o usuário
  reconhece. Por isso o horário de cada linha também é local, com o
  deslocamento escrito (`-03:00`): misturar local e UTC faria a movimentação
  das 23h aparecer no arquivo do dia seguinte.
- O nome do arquivo vem do `slug` de `src/lib/appTabs.ts` — a MESMA lista que
  alimenta o `Nav`. Aba desconhecida cai em `outras-rotas.log` em vez de ser
  descartada (`safeSlug`), inclusive um slug que tentasse escapar da pasta.
- `logs/` está no `.gitignore`: é dado de execução da máquina, não código.

**O pop-up** (`ErrorPopupProvider`) mostra título, "o que aconteceu", "por que
aconteceu", "o que fazer" e um bloco recolhido de detalhe técnico. Os textos
saem de `src/lib/errorExplain.ts`, que traduz status HTTP e exceção em
explicação — a MESMA explicação vai para o pop-up e para o log, então os dois
nunca contam versões diferentes da falha.
- Erros entram numa **fila**: duas falhas em sequência são lidas as duas, e não
  uma sobrescrevendo a outra. Falhas idênticas seguidas são unificadas.
- **Não fecha ao clicar fora**, ao contrário do `ConfirmDialog`: aqui o
  conteúdo é explicação que precisa ter sido lida.
- Formulários que já mostravam aviso embutido continuam mostrando — agora
  aparecem os dois. É deliberado: o pop-up é o canal garantido, o aviso
  embutido é o contexto ao lado do campo.

### 4.11. Eco do valor interpretado (`src/components/ParsedValueHint.tsx`)

Embaixo de cada campo decimal aparece o que o sistema entendeu: digitar
`1.000` mostra `= R$ 1,00`. Existe porque `1.000` é ambíguo de verdade (mil ou
um e zero centésimos) e **nenhuma regra acerta os dois casos** — a regra atual
(um separador sozinho é decimal) foi escolhida para não quebrar uma quantidade
de cripto como `1.500` ETH, ver seção 6. Em vez de adivinhar melhor, a tela
mostra a interpretação e o usuário corrige antes de salvar.
- `kind="money"` formata como moeda; `kind="plain"` mostra número puro (a
  quantidade de um ativo não é valor em reais).
- Campo vazio não mostra nada; texto ilegível mostra o aviso — a mesma
  informação que o envio daria depois, só mais cedo.
- **Não está na lista de diárias do modal de aluguel**, de propósito: aquela
  lista já mostra lado a lado o valor da tabela e o valor aplicado por noite,
  então a interpretação já está visível, e um eco por linha dobraria a altura.

### 4.12. Edição inline de data e descrição em `/transacoes`

Na aba de Transações a coluna **Data** é um `<input type="date">` e a coluna
**Descrição** é um campo de texto, editáveis direto na linha — mesmo padrão que
a coluna de categoria já usava ali e que a coluna "Descrição" de
`/investimentos` usa (seção 4.7). Nenhuma rota nova: as três edições são o
MESMO `PATCH /api/transactions/[id]`, que já aceitava `date` e `description`.

- **Cada tela libera a edição que faz sentido nela.** `TransactionsTable` abre
  cada coluna por um callback próprio (`onDateChange`, `onDescriptionChange`),
  como já fazia com `onCategoryChange` e `onDelete`: no dashboard a tabela
  continua somente de leitura porque ele não passa nenhum callback. Desde
  2026-09-03 `/receitas` também edita (seção 4.13), com um gate por linha; a
  descrição desta seção é o mecanismo que as duas telas compartilham.
- **A data grava na hora da mudança**, sem estado intermediário: o
  `<input type="date">` só dispara `onChange` com uma data completa. Campo
  **limpo é ignorado** — a transação precisa de uma data, e apagar não é uma
  edição válida.
- **A descrição grava ao sair do campo (ou no Enter, que só tira o foco).** O
  texto em edição vive em estado LOCAL da célula, não no `data` da página: cada
  gravação substitui a linha pela resposta do servidor, e ler dali faria essa
  resposta (ou uma listagem em trânsito) apagar o que está sendo digitado —
  mesmo motivo da nota de `/investimentos`.
  - Texto **em branco é revertido para o original, não gravado**: a rota exige
    `z.string().min(1)`, então devolver o texto anterior é melhor do que mandar
    um valor que já se sabe que a API vai recusar. Espaço em volta é aparado, e
    texto que não mudou não gera PATCH.
  - **Renomear não re-sugere categoria**, mesma postura da renomeação na revisão
    de fatura (seção 4.5): a sugestão por `Category.keywords` acontece na
    importação, e daí em diante a categoria é escolha explícita.
- **No modo editável a seta `›` passa a ser o alvo de clique para expandir** o
  detalhamento. Antes o clique era em toda a descrição; com um campo de texto no
  lugar, clicar no texto posiciona o cursor — fechar a linha nesse clique seria
  irritante. No modo somente leitura o comportamento é o de antes.
- **Gravar atualiza SÓ A LINHA editada — não recarrega a lista.** Recarregar
  (o que as três edições faziam até 2026-09-01) liga o `loading` da página e
  troca a tabela inteira por "Carregando...", o que fecha o detalhamento aberto
  e remonta o campo que está sendo editado: barulho visual a cada Enter.
  - A linha nova vem da **resposta do PATCH**, e não do que foi enviado, porque
    a rota pode mudar mais do que se pediu — categoria de receita força
    `type: INCOME` (seção 4.4) — e a resposta já traz `category` e `creditCard`
    populados, no mesmo formato da listagem.
  - Resposta **fora de 2xx não aplica nada**: o corpo é um objeto de erro, não a
    transação, e aplicá-lo apagaria os dados da linha na tela. A falha em si não
    fica escondida — o pop-up global cobre qualquer fetch (seção 4.10).
  - **A linha sai da lista quando deixa de casar com os filtros ativos** (data
    fora do período, categoria ou tipo filtrados, busca por texto) — o mesmo
    resultado que o recarregamento dava. Quem decide isso é
    `matchesTransactionFilters` (`src/lib/transactionFilters.ts`), o **espelho no
    navegador do `where` de `GET /api/transactions`**: mudar o filtro da rota sem
    mudar esse arquivo faria a tela discordar da próxima listagem (mesma postura
    do `perRentalValue` do `SettlementModal`, seção 4.2).
  - A lista é **reordenada por data** (`sortTransactionsByDateDesc`, espelho do
    `orderBy: { date: "desc" }`), senão a linha com data editada ficaria fora de
    lugar até o próximo recarregamento. O `sort` é estável, então transações do
    mesmo dia não trocam de posição.
  - O `TransactionItemsPanel` recebe `categoryId` e **recarrega os itens quando
    ela muda**: a categoria nova pode ter criado sub-itens fixos no servidor
    (`ensureFixedSubItems`, seção 4.3). Antes o recarregamento da lista fechava o
    painel e a próxima abertura já vinha com eles; com a linha atualizada no
    lugar, o painel continua aberto e precisa buscar de novo por conta própria.
- `toDateInputValue()` (`dateOnly.ts`) é o caminho do dado do banco para o
  campo: a data chega como ISO completo e é lida no calendário **local**, nunca
  por `slice(0, 10)` — a meia-noite local gravada num fuso à frente de UTC sai
  como o dia anterior na parte UTC da string (armadilha 2 da seção 5).

### 4.13. Editar e excluir receitas em `/receitas` (exceto "Aluguel Rancho")

A lista de lançamentos de `/receitas` passou a ser editável (categoria, data,
descrição, **valor** e excluir), reusando a mesma `TransactionsTable` e o mesmo
`PATCH /api/transactions/[id]` de `/transacoes` (seção 4.12) — nenhuma rota
nova. Duas coisas são novas de verdade:

- **Coluna "Valor" editável** (`onAmountChange` + `AmountCell` na
  `TransactionsTable`). É `<input type="text" inputMode="decimal">` e passa por
  `parseDecimalInput`, como todo campo financeiro (seção 6); o callback recebe
  **número**, já convertido pela célula. Valor ilegível, zero ou negativo é
  **revertido** para o atual em vez de enviado — a rota exige
  `z.number().positive()`, e devolver o valor anterior é mais honesto do que
  mandar algo que já se sabe que a API recusa (mesma regra da descrição em
  branco). Depois de gravar, o campo mostra o valor **já formatado a partir do
  número interpretado**: digitar `1.000` deixa `1,00` na célula. É o serviço do
  `ParsedValueHint` (seção 4.11) prestado dentro da própria célula — um eco por
  linha dobraria a altura da tabela.
- **Gate por linha (`isRowEditable`)**, um predicado só que a tela passa para a
  tabela e que vale para as cinco ações (categoria, data, descrição, valor,
  excluir). É um predicado, e não um por coluna, porque a pergunta é uma só:
  "esta linha pertence a outro sistema?". Sem o prop, todas as linhas são
  editáveis — o comportamento de `/transacoes`, que não o passa.

**Por que "Aluguel Rancho" é somente leitura** (`isReceitaEditavel` na página):
essas linhas são a `Transaction` auto-criada por um aluguel de temporada, e o
valor delas **é** o `totalDavid` calculado pelo aluguel (seção 4.2). Editar o
aluguel já reescreve valor, data e descrição da transação vinculada, então
deixar o ledger mexer nela daria dois donos para o mesmo número — e o aluguel
ganharia na próxima edição, apagando o que foi digitado, sem aviso. Excluir
seria pior: o aluguel ficaria com `transactionId` órfão e a receita dele
desapareceria do mês. A linha **continua listada** (é receita do mês e entra nos
15/10/75 como qualquer outra); quem manda nela é o botão "editar" do próprio
aluguel.

- O teste é pelo **nome da categoria**, não por `source: "IMPORT"` — fatura de
  cartão e NFC-e também são importadas e não têm nada a ver com isso. O nome
  vive em `RENTAL_INCOME_CATEGORY_NAME` (`src/lib/seasonalRentals.ts`), num
  lugar só, porque a rota que cria a receita e a tela que a bloqueia precisam
  concordar: se divergissem, a receita de aluguel voltaria a ser editável no
  ledger.
- **Aqui a releitura é da tela inteira**, ao contrário de `/transacoes`, que
  atualiza só a linha editada (seção 4.12): mudar valor ou data de uma receita
  muda o total do mês e com ele os quatro cards do 15/10/75, e uma data movida
  para fora do mês tem que fazer a linha sair da lista. O que se evita é só o
  pisca — o recarregamento de depois de uma edição **não liga o `loading`**
  (`load(true)`), então a tabela não é trocada por "Carregando..." e o campo em
  edição não é remontado a cada Enter.
- A exclusão usa o `ConfirmDialog` do app, com descrição e valor na mensagem
  (`/transacoes` usa o `window.confirm` nativo): a lista de receitas tem linhas
  de descrição parecida ("Salário", "Salário 13º") e apagar a errada só se
  descobre pelo total do mês mudando. O estado guarda o **id**, e a transação do
  diálogo é buscada na lista da tela — se a linha desaparecer num
  recarregamento, o diálogo se fecha junto.

### 4.14. Ordem das categorias (`Category.sortOrder`)

O usuário define na tela de Categorias, com setas ↑/↓ por linha, a ordem em que
as categorias aparecem em **todo** o app: selects da tabela de transações,
filtros do dashboard e de `/relatorios`, telas de importação.

- **Quem ordena é `GET /api/categories`** (`orderBy: [{ sortOrder }, { name }]`)
  — as telas só renderizam a lista na ordem em que ela chega. É o que faz uma
  reordenação valer na interface inteira de uma vez; nenhuma tela ordena por
  conta própria (não crie um `sort` local).
- **O nome é o segundo critério, e isso importa:** `sortOrder` nasce 0 para
  todas (o padrão da coluna), então antes da primeira reordenação — e numa
  instalação nova, cujo seed não mexe no campo — a lista sai em **ordem
  alfabética**, exatamente como saía antes desta coluna existir.
- **Categoria nova entra no fim** (`sortOrder = max + 1` no POST). Com o padrão
  0 ela pularia para o topo de todas as listas assim que a primeira
  reordenação tivesse normalizado as posições em 0..n-1.
- **A ordem é gravada inteira, por `PATCH /api/categories`** (na coleção, não em
  `/[id]`): reordenar não é editar um campo de uma categoria — mover uma muda a
  posição de outra. Como caminho fixo também não disputa a rota com o segmento
  dinâmico `[id]`. O corpo (`{ order: [ids] }`) tem que trazer **todos** os ids
  existentes, uma vez cada; subconjunto, id repetido ou desconhecido é **400**,
  para `sortOrder` continuar sendo uma permutação de 0..n-1 sem empate nem furo
  (a tela com lista velha vê o motivo no pop-up da seção 4.10). Os updates vão
  numa transação do Postgres só.
- A tela **reordena antes da resposta** do servidor (atualização otimista, como
  o toggle dos 15%): o usuário clica a seta várias vezes seguidas para levar a
  linha até a posição, e esperar uma ida ao servidor por clique faria a lista
  andar com atraso.
- No backup, `sortOrder` **precisa estar no schema zod** de `backup.ts`: o zod
  descarta chave desconhecida, então sem o campo a restauração perderia a ordem
  gravada no arquivo. Tem padrão 0, o que mantém restaurável o arquivo gerado
  antes da coluna existir (e 0 em todas é a ordem alfabética que aquele arquivo
  descrevia) — por isso o `BACKUP_FORMAT_VERSION` **não** subiu.

### 4.15. "Continuar lançando" no formulário manual de `/transacoes`

Checkbox no formulário de nova transação (`ManualTransactionForm`). Marcado,
salvar **não fecha o formulário**: limpa só o que muda de um lançamento para o
outro e devolve o foco à descrição, pronto para o próximo. Desmarcado (o
padrão), o comportamento é o de antes — salvar fecha.

Existe porque lançar várias transações seguidas é o uso normal quando se senta
para pôr o mês em dia, e reabrir o formulário a cada linha era o incômodo.

- **Quem decide é o formulário, e a página obedece:** o `onCreated` passou a
  receber `keepOpen`, e a página só fecha se ele for falso. A lista **recarrega
  nos dois casos** — o lançamento novo tem que aparecer atrás do formulário que
  ficou aberto.
- **Data, tipo e categoria FICAM; descrição, valor e "verificar devolução"
  são limpos.** Quem lança várias seguidas costuma estar no mesmo dia e muitas
  vezes na mesma categoria, e reescrever isso a cada linha anularia o ganho do
  checkbox. Já o "verificar devolução" é marca de um item específico: herdá-lo
  criaria uma pendência que ninguém pediu.
- **O checkbox continua marcado** entre lançamentos, mas o estado vive no
  formulário — reabrir depois de fechar começa desmarcado, porque a decisão é
  sobre a sessão de lançamento que acabou.
- **O foco volta para a descrição** (uma `ref`), senão "continuar lançando"
  ainda exigiria um clique por transação.
- **Contador "✓ N lançamentos salvos"** ao lado do botão. Com o formulário
  aberto, "salvou?" deixa de ser óbvio: o formulário cobre a lista que acabou de
  mudar, e campos limpos são o mesmo estado visual de um formulário que nunca
  foi enviado.
- **Resposta fora de 2xx não limpa nem fecha nada** (mudança que vale para os
  dois modos): antes, um POST recusado fechava o formulário e levava o
  lançamento digitado com ele. O pop-up global (seção 4.10) já explica a falha,
  e o texto fica na tela para ser corrigido — mesma postura da seção 4.12.

## 5. Convenções e armadilhas técnicas (ver detalhe completo em `instaladorParaIA.md` seção 5)

Resumo rápido — cada item já causou um bug real durante o desenvolvimento:

1. **Reinicie `npm run dev` por completo** depois de qualquer mudança em
   `prisma/schema.prisma` (o `PrismaClient` fica em cache no
   `globalThis` para sobreviver ao hot-reload — HMR não pega o model
   novo).
2. **Nunca `new Date("YYYY-MM-DD")` direto.** Sempre use
   `parseLocalDate` / `parseLocalDateEndOfDay` / `addDays` de
   `src/lib/dateOnly.ts` — string de data pura é interpretada como UTC
   e "volta" um dia em horário de Brasília (UTC-3).
3. Prisma 7: sem `@prisma/client` clássico, sem `datasource.url` no
   schema. Client gerado em `src/generated/prisma`
   (`@/generated/prisma/client`), conectado via driver adapter
   (`PrismaPg` de `@prisma/adapter-pg`) em `src/lib/prisma.ts`.
   Sincronize o schema com `prisma db push` (não `migrate dev` — o
   papel `finance_app` não tem `CREATEDB`).
4. `pdfjs-dist` precisa continuar em `serverExternalPackages` no
   `next.config.ts`, ou o Turbopack quebra o worker interno do pdf.js.
5. Erro de tipo estranho em `.next/types/validator.ts` depois de
   renomear model/rota → apague a pasta `.next` inteira.
6. Isolamentos de model (`FamilyTransaction`, `SeasonalRental`) e a
   soft reference `SeasonalRental.transactionId` são decisões de design
   explícitas — não "normalize" isso adicionando relações Prisma.
7. Repasses de aluguel são permanentes por design (ver 4.2) — não
   adicione cancelamento sem pedido explícito novo do usuário.
8. **`.gitignore` existe na raiz do projeto** (criado em 2026-08-28,
   antes disso o repositório não tinha nenhum) e ignora `node_modules`,
   `.next`, `src/generated` (Prisma Client gerado), `.env`, `/coverage` e
   `tsconfig.tsbuildinfo` (cache incremental que `npx tsc` recria). Se
   algum desses aparecer como "untracked" no `git status`, é esperado —
   não são para entrar no repositório.
9. **Existe uma segunda cópia do projeto em `C:\financialSupport`** (o
   `X:` é um disco físico distinto, não um mapeamento de `C:`). As duas
   cópias apontam para o MESMO banco (`financial_support`), então é
   perfeitamente possível estar olhando uma tela servida pela cópia
   errada e concluir que uma alteração "não funcionou". Antes de
   depurar, confirme de qual pasta o servidor da porta 3000 veio:
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
   Where-Object { $_.CommandLine -match 'next' } | Select CommandLine`.
   Detalhe agravante: o `next dev` do Next 16 **não falha** quando a
   3000 está ocupada por outro `next dev` — ele avisa e sobe na 3001,
   então dá para ficar com dois servidores de código diferente no ar ao
   mesmo tempo.
10. **O `git config user.name`/`user.email` deste repositório é local**
    (configurado só dentro de `X:\FinancialController\.git\config`, sem
    `--global`) como `DavidMattar` / `dasmat2000@gmail.com`, para não
    afetar a identidade Git global da máquina em outros projetos. Não
    rode `git config --global` para "corrigir" autoria — o repo-local já
    resolve isso.
11. **Não existe banco de testes isolado, e não dá para criar um** (checado
    em 2026-08-29). O papel `finance_app` não tem `CREATEDB` e só tem
    permissão de `CREATE` no próprio `financial_support`. E criar um *schema*
    separado (`create schema zztest` + `prisma db push` apontando para ele)
    **não isola nada**: com driver adapter o Prisma emite SQL qualificado com
    o schema do datasource (`"public"."Transaction"`), então nem `?schema=` na
    URL nem `search_path` via `?options=-c%20search_path%3D...` mudam onde as
    queries caem — o app continua lendo `public`. Consequência prática: testar
    qualquer coisa destrutiva significa mexer nos dados reais. Gere um backup
    por `/relatorios` (seção 4.8) antes, e prefira testes que só inserem
    (registros com id de prefixo próprio, fáceis de apagar depois).
12. **`prisma db push` que remove coluna exige consentimento explícito do
    usuário** (visto em 2026-08-31, ao mover quantidade/custo médio de
    `InvestmentHolding` para `InvestmentPurchase`). O Prisma detecta que foi
    invocado por um agente de IA e **recusa** `--accept-data-loss`, pedindo
    que o usuário seja informado e consinta; só então aceita a variável
    `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` com o texto da autorização.
    Não é bug: é o comportamento correto num repositório cujo único banco tem
    dado real (armadilha 11). O roteiro que funcionou: exportar backup por
    `/api/backup/export` → pedir autorização → `db push` → **matar o `next dev`
    de verdade** (o `PrismaClient` fica em cache no `globalThis`; parar só o
    wrapper do `npm` deixa o processo filho vivo segurando a porta 3000) →
    reaplicar o backup em modo `merge`, que recupera o dado pela conversão de
    formato antigo (seção 4.8).
13. **O Next carrega `.env.local` com prioridade sobre `.env`** (e sobre
    variáveis já definidas no `process.env` do processo que chamou o
    `next dev`). Se você criar um `.env.local` para um teste, apague-o depois —
    senão o app fica apontando para outro lugar sem nenhum aviso. Armadilha
    dobrada no PowerShell 5.1: `Set-Content -Encoding utf8` escreve **BOM**, e
    o BOM entra no nome da primeira variável (`\uFEFFDATABASE_URL`), que passa
    a ser silenciosamente ignorada. Use
    `[System.IO.File]::WriteAllText(path, texto, (New-Object System.Text.UTF8Encoding($false)))`.

## 6. Padrão de código a seguir em novas features

- **Import em duas etapas (parse/preview → confirm)** para qualquer
  fluxo que crie dados a partir de um arquivo externo (fatura, nota
  fiscal): deixe o usuário revisar/editar antes de persistir.
- **Cálculos derivados nunca são cacheados no banco** quando dependem de
  uma regra de negócio que pode mudar (ex: `tableValue`, orçamento
  15/10/75) — sempre recompute a partir da fonte primária no momento da
  leitura. O que pode ser salvo é uma **entrada** que o usuário
  informou explicitamente para aquele registro (ex:
  `nightRateOverrides` — a diária que ele mesmo definiu naquele
  aluguel), nunca o resultado do cálculo.
- **Categorização por `Category.keywords[]`** (case-insensitive contra a
  descrição) é o padrão de auto-categorização usado na importação —
  reaproveite `src/lib/categorize.ts` em vez de criar lógica paralela.
- **Datas:** todo campo de formulário `<input type="date">` deve passar
  por `dateOnly.ts` antes de tocar o banco ou um filtro `gte`/`lte`.
- **Valores decimais digitados:** todo campo financeiro é
  `<input type="text" inputMode="decimal">` (nunca `type="number"`, que não
  aceita o formato brasileiro), então o que chega é texto livre. Passe SEMPRE
  por `parseDecimalInput` de `src/lib/decimalInput.ts` — nunca por
  `Number(valor.replace(",", "."))`, que só acerta o caso de uma vírgula
  sozinha e transforma "1.234,56" em `NaN`.
  - Vírgula e ponto são o **mesmo** separador decimal ("3,07" === "3.07"), e
    o separador de milhar é entendido nos dois formatos ("1.234,56" e
    "1,234.56"). O único ponto ambíguo — um ponto sozinho com três casas,
    como "1.234" — é lido como decimal de propósito: a regra alternativa
    quebraria uma quantidade de cripto como "1.500". A justificativa completa
    está no comentário no topo do arquivo.
  - `parseDecimalInput` devolve `null` para campo vazio ou texto que não
    descreve número; o formulário avisa na tela e **não envia**, em vez de
    mandar `NaN` (que o `JSON.stringify` vira `null`) e receber um 400 que a
    tela não mostrava. Use `parseDecimalInputOr(raw, 0)` onde "em branco"
    significa um valor conhecido (ex: taxa de limpeza).
  - **Só ruído CONHECIDO é removido** (espaços, inclusive o não-quebrável do
    `Intl`, e prefixo de moeda: "R$", "BRL", "US$", "$", "€"…). Qualquer outro
    caractere estranho **recusa** o valor. A primeira versão removia tudo que
    não fosse dígito ou separador, e por isso `"1e3"` virava 13 e `"12abc"`
    virava 12, silenciosamente — num campo de dinheiro, recusar e avisar é
    melhor do que adivinhar.
  - A ambiguidade que sobra (`1.000` = 1, não mil) é resolvida na tela, não
    por adivinhação: o campo ecoa o valor interpretado logo abaixo
    (`ParsedValueHint`, seção 4.11).
  - A varredura completa de formatos está em `tests/lib/decimalInput.test.ts`,
    numa **tabela** `[texto digitado, número esperado, por quê]` — é o lugar
    para conferir (ou estender) o que o sistema faz com cada formato, incluindo
    os casos em que a resposta é "recusa".
  - Limites conhecidos e aceitos: `"10,0000000000000000000000000001"` vira 10
    (o `double` não guarda além de ~17 dígitos significativos), e um valor
    absurdamente grande (`1e21`) passa pelo parser mas estoura o
    `Decimal(20, 8)` do banco — daria 500 sem mensagem na tela. Nenhum dos dois
    aparece em uso real; se um dia aparecer, o lugar de tratar é um `.max()` no
    schema zod da rota, não no parser.
  - Nas rotas de API, embrulhe o campo com `decimalField(z.number()...)` do
    mesmo arquivo: a API é a fronteira do sistema e também aceita "3,07",
    para não depender de qual cliente formatou o corpo.
  - **Não unifique isso com o `parseBrlNumber` dos parsers de fatura/NFC-e**
    (`invoiceParsers/santander.ts`, `receiptParsers/nfce.ts`): aqueles leem
    um formato de máquina, com separador fixo e conhecido, vindo de um PDF.
    A separação é proposital.
- Todo o código já tem comentários JSDoc em português explicando o "por
  quê" de decisões não óbvias — ao editar uma função, mantenha/atualize
  o comentário se a lógica mudar (comentário desatualizado é peor que
  nenhum comentário).
- **Todo código novo vem com teste.** A suíte cobre 100% de `src/` e o
  limite está travado no `vitest.config.mts` — `npm run test:coverage`
  falha se a cobertura cair. Ver seção 8 para como rodar e para as
  armadilhas de teste já mapeadas.

## 7. Mapa de arquivos (fonte, sem gerados)

```
src/app/
  layout.tsx, page.tsx                    → shell raiz + dashboard
  api/
    transactions/                         → CRUD + metrics + export + items (sub-itens)
    transactions/[id]/move-to-family/     → move a transação para o ledger da família (seção 4.9)
    categories/                           → CRUD de categorias + PATCH da coleção que regrava a ordem (seção 4.14)
    credit-cards/                         → CRUD de cartões
    invoices/{parse,confirm}/             → importação de fatura (2 etapas)
    receipts/{parse,confirm}/             → importação de NFC-e (2 etapas)
    investments/, investments/prices/      → posições + cotação ao vivo (e o resultado de cada compra)
    investments/[id]/purchases/[purchaseId]/ → apaga uma compra individual (seção 4.7)
    views/                                → filtros salvos do dashboard
    budget/summary/                       → orçamento 15/10/75 do período (?from/?to; sem parâmetro, mês corrente)
    family-transactions/                  → ledger isolado da família
    seasonal-rentals/, seasonal-rentals/preview/,
    seasonal-rentals/[id]/ (GET não existe, só PUT/DELETE) → aluguéis de temporada
    rental-settlements/, rental-settlements/preview/ → repasses David/Família
    backup/export/, backup/restore/       → backup completo do banco em JSON (seção 4.8)
    logs/                                 → grava as movimentações em logs/AAAA-MM-DD/ (seção 4.10)
  categorias/, transacoes/, transacoes-familia/,
  receitas/, investimentos/, relatorios/,
  importar-fatura/                        → páginas (uma pasta por rota)

src/components/                           → um componente de UI por arquivo
  Nav, ThemeToggle                        → navegação/tema global
  ConfirmDialog, DateRangePicker,
  CollapsibleSection, InfoHint,
  ParsedValueHint                         → utilitários de UI reutilizáveis
                                            (InfoHint = dica "?" no hover/foco;
                                             ParsedValueHint = eco do valor lido)
  ErrorPopupProvider, ActivityLogger      → pop-up global de erro + interceptação
                                            de movimentações (seção 4.10)
  SummaryCards, MonthlyTrendChart,
  CategoryPieChart, FreeToSpendBanner,
  PendingReturnsPanel                     → dashboard
  SavedViewsBar                           → filtros salvos
  TransactionsTable, TransactionItemsPanel → tabela principal + sub-itens
  SeasonalRentalModal, SeasonalRentalsSection,
  SettlementModal, RentalWhatsAppModal    → feature de aluguel de temporada
  InvoiceImportPanel, ReceiptImportPanel  → importação (2 abas de /importar-fatura)
  BackupPanel                             → bloco de backup/restauração no fim de /relatorios

src/lib/
  prisma.ts                               → singleton do PrismaClient (driver adapter)
  dateOnly.ts                             → helpers de data sem bug de fuso, ida e volta (USE SEMPRE)
  budget.ts                               → regra 15/10/75 e acúmulo mês a mês da fatia de 15% (pura, seção 4.1)
  decimalInput.ts                         → vírgula OU ponto como separador decimal, em formulário e API (USE SEMPRE)
  investments.ts                          → soma das compras em posição + resultado por compra (quantidade/custo médio NÃO são colunas)
  appTabs.ts                              → lista única das abas (alimenta o Nav E o nome do arquivo de log)
  errorExplain.ts                         → status HTTP/exceção → "o que aconteceu" e "por que" (pop-up e log usam o mesmo texto)
  logEvents.ts                            → formato da linha de log + descrição legível de cada rota
  logClient.ts                            → interceptação do fetch global e dos erros de JS (navegador)
  logFiles.ts                             → gravação em logs/AAAA-MM-DD/<aba>.log e erros.log (servidor)
  types.ts, format.ts                     → tipos e formatação compartilhados
  dateRanges.ts                           → presets de período (este mês, últimos 3 meses, etc.)
  categorize.ts                           → auto-categorização por keywords
  transactionFilters.ts                   → espelho no navegador do where/orderBy de GET /api/transactions (seção 4.12)
  ecommerceMerchants.ts                   → detecção de comerciante e-commerce (pendingReturn)
  transactionItems.ts                     → ensureFixedSubItems() (sub-itens automáticos)
  invoices.ts                             → helpers de fatura (fora do parser em si)
  pdf.ts                                  → extração de texto de PDF (pdfjs-dist)
  prices.ts                               → cotações ao vivo (CoinGecko/open.er-api.com), cache 30s
  cryptoIds.ts                            → mapeamento símbolo → id do CoinGecko
  useIsDark.ts                            → hook de detecção de tema dark/light
  invoiceParsers/{types,index,santander}.ts → parser de fatura por banco (registro extensível)
  receiptParsers/{types,index,nfce}.ts    → parser de nota fiscal por formato (registro extensível)
  rentalPriceTable.ts                     → tabela de preços + calendário de feriados + detalhamento por noite (computeNightRates) e diárias customizadas (sanitizeNightRateOverrides)
  rentalCalc.ts                           → fórmulas de repasse (computeRental)
  rentalSettlements.ts                    → previewSettlement/createSettlement (David/Família)
  seasonalRentals.ts                      → serializeRentalWithComputed/RENTAL_PLATFORM_LABEL/RENTAL_INCOME_CATEGORY_NAME (compartilhado entre as rotas de seasonal-rentals e a tela /receitas)
  whatsappReport.ts                       → geração de relatório formatado para WhatsApp
  backup.ts                               → backup/restauração do banco inteiro em JSON (schema zod, collectBackup, restoreBackup)

prisma/
  schema.prisma                           → modelos (com comentários /// já incluídos)
  seed.ts                                 → 15 categorias padrão (upsert, idempotente)

tests/                                    → suíte de testes (ver seção 8)
  setup.dom.ts                            → setup do ambiente jsdom (matchers, cleanup, layout fingido p/ Recharts)
  helpers/prismaMock.ts                   → mock do PrismaClient (proxy que cria vi.fn() por model/método)
  helpers/http.ts                          → monta Request/Response para testar route handlers
  helpers/text.ts, helpers/dom.ts         → normalização de espaço do Intl e busca de campo por rótulo
  lib/, api/                              → testes de src/lib e src/app/api (ambiente node)
  client/                                 → runtime de navegador que não é componente (interceptação de fetch): é lib, mas precisa de window, então roda no projeto "dom"
  components/, pages/, hooks/             → testes de componentes e páginas (ambiente jsdom)
vitest.config.mts                         → configuração do Vitest (2 projects + cobertura em 100%)

logs/                                     → NÃO versionado: um arquivo por aba, por dia (seção 4.10)
```

## 8. Testes (`tests/`, `vitest.config.mts`)

- **Rodar:** `npm test` (uma vez), `npm run test:watch` (contínuo),
  `npm run test:coverage` (com relatório de cobertura).
- **1805 testes** cobrindo **100% de `src/`** (statements, branches,
  functions e lines). O limite de 100% está fixado em
  `coverage.thresholds` do `vitest.config.mts`: **se a cobertura cair, o
  comando falha**. Ao adicionar código novo, adicione teste junto.
- **Nada de banco nem de rede.** Toda a suíte roda em mocks: `src/lib/prisma`
  é substituído por `tests/helpers/prismaMock.ts` e o `fetch` é dublado nos
  testes de UI. Rodar os testes NÃO toca no `financial_support` — o que é
  proposital, porque não existe banco de testes isolado nesta instalação
  (ver armadilha 11 da seção 5).
- **Duas "projects" no Vitest** (`node` e `dom`), porque o app vive em dois
  ambientes: `src/lib` + `src/app/api` rodam em Node (Prisma, `Request`), e
  componentes/páginas rodam em jsdom. A cobertura é somada das duas.
- **Fuso fixo em `America/Sao_Paulo`** (`test.env.TZ`): metade das regras
  depende de data local (ver `dateOnly.ts`), então sem fixar o fuso a suíte
  passaria nesta máquina e quebraria em outra.
- **`sequence.hooks: "list"`** no config: faz o `cleanup()` do
  `setup.dom.ts` rodar ANTES do `afterEach` de cada arquivo. Na ordem
  inversa (padrão do Vitest), um efeito ainda pendente caía no `fetch` real
  depois de o dublê ser removido.
- Route handler é testado chamando a função direto (`GET(request)`), sem
  subir servidor — ver `tests/helpers/http.ts`.
- **Armadilhas de teste que já custaram tempo aqui** (todas com comentário
  no próprio arquivo de teste):
  - O `Intl` separa "R$" do número com espaço NÃO-QUEBRÁVEL: compare sempre
    com `normalizarEspacos` (`tests/helpers/text.ts`) nos DOIS lados.
  - Os formulários usam `<label>` sem `htmlFor`, então `getByLabelText` não
    acha nada: use `campoPorRotulo` (`tests/helpers/dom.ts`).
  - O jsdom não faz layout; sem os dublês de `ResizeObserver` e
    `getBoundingClientRect` do `setup.dom.ts` o Recharts renderiza um SVG
    vazio e o teste de gráfico passa sem testar nada.
  - Input de arquivo `required` faz o jsdom bloquear o submit por validação:
    dispare `fireEvent.submit(form)` em vez de clicar no botão.
  - O React não dispara `onChange` quando o valor não muda — para testar
    "apagar um campo", preencha antes.
  - Formatadores passados ao Recharts (`tickFormatter`, `formatter` do
    tooltip) nunca são chamados em jsdom; eles são testados com o Recharts
    dublado em `tests/components/chartFormatters.test.tsx`.
- **`/* v8 ignore next */` aparece em 16 pontos do `src/`**, sempre com
  comentário explicando: são *guards de tipo* (`if (!preview) return;`,
  `prev ?? []`) cujo caminho falso a interface não consegue produzir, porque
  o controle que dispararia a função só é renderizado quando o valor já
  existe. Não remova o guard (é ele que estreita o tipo para o TypeScript) e
  não apague a anotação sem antes achar um jeito real de exercitá-lo.

## 9. Onde procurar mais detalhes

- **Como instalar/rodar do zero:** `instaladorParaIA.md` (raiz do projeto).
- **Detalhe campo a campo dos models:** comentários `///` direto em
  `prisma/schema.prisma`.
- **Detalhe função a função:** comentários JSDoc já presentes em cada
  arquivo `src/**/*.ts(x)`.
- **Comportamento esperado de cada função/tela:** a suíte de testes
  (`tests/`) é documentação executável — o nome de cada teste descreve a
  regra em português, e é o lugar mais rápido para confirmar "o que deve
  acontecer quando X".
- Este arquivo (`contexto.md`) é o nível "arquitetura e regras de
  negócio" — atualize-o sempre que uma decisão de design nova e não
  óbvia for tomada, para continuar servindo seu propósito.
