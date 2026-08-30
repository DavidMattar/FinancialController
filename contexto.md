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
| `/transacoes` | `src/app/transacoes/page.tsx` | CRUD de transações (ledger principal), tabela com filtros. |
| `/transacoes-familia` | `src/app/transacoes-familia/page.tsx` | Ledger **isolado** da família (não entra em nada do resto do app). |
| `/receitas` | `src/app/receitas/page.tsx` | Receitas do mês + seção "Aluguéis de Temporada" (colapsável). |
| `/categorias` | `src/app/categorias/page.tsx` | CRUD de categorias (cor, ícone, palavras-chave, flags). |
| `/investimentos` | `src/app/investimentos/page.tsx` | Holdings de cripto/moeda com cotação ao vivo. |
| `/relatorios` | `src/app/relatorios/page.tsx` | Gráficos de tendência mensal + regra de orçamento 15/10/75. No fim da página, bloco separado de **backup/restauração** do banco inteiro (seção 4.8). |
| `/importar-fatura` | `src/app/importar-fatura/page.tsx` | Duas abas: importar fatura de cartão (PDF) e nota fiscal/NFC-e (PDF ou texto colado). |
| `src/app/layout.tsx` | — | Layout raiz: `Nav`, tema (dark/light), fontes. |

## 3. Modelos de dados (`prisma/schema.prisma`) e como se relacionam

O schema em si já tem comentários `///` em cada model/enum — leia-o
diretamente para o detalhe de cada campo. Resumo da topologia:

```
Category ──┐
CreditCard ─┤
Invoice ────┼──> Transaction ──> TransactionItem
            │        (ledger principal, com categoria/cartão/fatura opcionais)
            
InvestmentHolding        (independente, sem relação com Transaction)
DashboardView             (filtros salvos do dashboard, JSON livre)

FamilyTransaction         (ISOLADO — sem relação com nada acima, de propósito)

SeasonalRental ──> SeasonalRentalExpense
       │
       ├─ davidSettlementId ──> RentalSettlement (type=DAVID)
       ├─ familiaSettlementId ─> RentalSettlement (type=FAMILIA)
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
- `SeasonalRental` tem **duas relações Prisma nomeadas** distintas para
  o mesmo model `RentalSettlement` (`"DavidSettlementRentals"` e
  `"FamiliaSettlementRentals"`), porque os repasses de David e da
  Família são trilhas independentes — um aluguel pode estar fechado
  para uma e aberto para a outra.

## 4. Regras de negócio importantes (não são óbvias lendo só o código)

### 4.1. Orçamento mensal 15/10/75 (`/api/budget/summary`, `src/app/relatorios`)
- Sempre referente ao **mês corrente** (calculado a partir de `new Date()`),
  não recebe parâmetro de período — é intencional, não uma limitação a
  corrigir.
- 15% da receita do mês = "livre para gastar". `Category.deductsFromFreeSpend`
  (toggle na tela de Categorias, só em categorias EXPENSE) marca quais
  categorias contam contra essa fatia.
- `disponível = 15% da receita do mês − soma de despesas do mês nas
  categorias marcadas`. **Sempre recalculado do zero a cada request**,
  nunca um saldo salvo/acumulado — evita que o valor "arraste" erro e
  lida naturalmente com edições/exclusões/lançamentos retroativos.
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
- **Repasses (`RentalSettlement`) são permanentes.** Existem dois tipos
  independentes: `DAVID` (soma de `totalDavid` dos aluguéis não
  liquidados) e `FAMILIA` (soma de `netForDistribution`, **dividida por
  2 só no total final**, não por aluguel). Gerar um repasse trava os
  aluguéis correspondentes (`davidSettlementId`/`familiaSettlementId`)
  para nunca serem contados de novo. **Não existe UI de cancelar/desfazer
  repasse — foi pedida e depois explicitamente retirada pelo usuário.
  Não adicione essa funcionalidade a menos que seja pedida de novo.**
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
- `Transaction.pendingReturn: Boolean` — checkbox só exibido quando a
  transação tem `creditCardId` E a descrição casa com um comerciante de
  e-commerce conhecido (`src/lib/ecommerceMerchants.ts`). Linha fica
  destacada em vermelho em toda a UI. `PendingReturnsPanel` no dashboard
  ignora o filtro de período (busca própria) porque é para persistir
  entre períodos.

### 4.5. Importação de fatura de cartão (`src/lib/invoiceParsers/`)
- Só suporta **Santander** (`santander.ts`). Extração via `pdfjs-dist`
  (`src/lib/pdf.ts`), reconstruindo linhas por `hasEOL` — reproduz a
  ordem do `pdftotext -raw`, **não** `-layout` (que embaralha faturas
  com múltiplos titulares em colunas lado a lado).
- Fluxo em duas etapas: `parse` (preview, nada salvo) → `confirm`
  (salva no banco após o usuário revisar/editar). Mesmo padrão usado
  para notas fiscais.
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

### 4.7. Investimentos (`src/lib/prices.ts`)
- Cotação de cripto via **CoinGecko**, de moeda estrangeira via
  **open.er-api.com** — únicas chamadas externas do app, sem chave de
  API, sem dado do usuário saindo da máquina. Cache em memória de 30s.
- Preço atual nunca é salvo no `InvestmentHolding` — é buscado ao vivo e
  combinado com `quantity`/`avgCostBrl` na exibição.

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
   `.next`, `src/generated` (Prisma Client gerado) e `.env`. Se algum
   desses aparecer como "untracked" no `git status`, é esperado — não
   são para entrar no repositório.
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
12. **O Next carrega `.env.local` com prioridade sobre `.env`** (e sobre
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
- Todo o código já tem comentários JSDoc em português explicando o "por
  quê" de decisões não óbvias — ao editar uma função, mantenha/atualize
  o comentário se a lógica mudar (comentário desatualizado é peor que
  nenhum comentário).

## 7. Mapa de arquivos (fonte, sem gerados)

```
src/app/
  layout.tsx, page.tsx                    → shell raiz + dashboard
  api/
    transactions/                         → CRUD + metrics + export + items (sub-itens)
    categories/                           → CRUD de categorias
    credit-cards/                         → CRUD de cartões
    invoices/{parse,confirm}/             → importação de fatura (2 etapas)
    receipts/{parse,confirm}/             → importação de NFC-e (2 etapas)
    investments/, investments/prices/     → holdings + cotação ao vivo
    views/                                → filtros salvos do dashboard
    budget/summary/                       → orçamento 15/10/75 do mês corrente
    family-transactions/                  → ledger isolado da família
    seasonal-rentals/, seasonal-rentals/preview/,
    seasonal-rentals/[id]/ (GET não existe, só PUT/DELETE) → aluguéis de temporada
    rental-settlements/, rental-settlements/preview/ → repasses David/Família
    backup/export/, backup/restore/       → backup completo do banco em JSON (seção 4.8)
  categorias/, transacoes/, transacoes-familia/,
  receitas/, investimentos/, relatorios/,
  importar-fatura/                        → páginas (uma pasta por rota)

src/components/                           → um componente de UI por arquivo
  Nav, ThemeToggle                        → navegação/tema global
  ConfirmDialog, DateRangePicker,
  CollapsibleSection                      → utilitários de UI reutilizáveis
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
  dateOnly.ts                             → helpers de data sem bug de fuso (USE SEMPRE)
  types.ts, format.ts                     → tipos e formatação compartilhados
  dateRanges.ts                           → presets de período (este mês, últimos 3 meses, etc.)
  categorize.ts                           → auto-categorização por keywords
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
  seasonalRentals.ts                      → serializeRentalWithComputed/RENTAL_PLATFORM_LABEL (compartilhado entre as rotas de seasonal-rentals)
  whatsappReport.ts                       → geração de relatório formatado para WhatsApp
  backup.ts                               → backup/restauração do banco inteiro em JSON (schema zod, collectBackup, restoreBackup)

prisma/
  schema.prisma                           → modelos (com comentários /// já incluídos)
  seed.ts                                 → 15 categorias padrão (upsert, idempotente)
```

## 8. Onde procurar mais detalhes

- **Como instalar/rodar do zero:** `instaladorParaIA.md` (raiz do projeto).
- **Detalhe campo a campo dos models:** comentários `///` direto em
  `prisma/schema.prisma`.
- **Detalhe função a função:** comentários JSDoc já presentes em cada
  arquivo `src/**/*.ts(x)`.
- Este arquivo (`contexto.md`) é o nível "arquitetura e regras de
  negócio" — atualize-o sempre que uma decisão de design nova e não
  óbvia for tomada, para continuar servindo seu propósito.
