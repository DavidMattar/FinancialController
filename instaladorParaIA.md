# instaladorParaIA.md

> Este arquivo existe para que uma IA (ou qualquer pessoa) consiga colocar
> este projeto para rodar localmente do zero, sem precisar redescobrir as
> decisões e armadilhas já resolvidas durante o desenvolvimento. Siga os
> passos na ordem. Não pule a seção "Armadilhas conhecidas" — ela existe
> porque cada item ali já causou um erro real durante o desenvolvimento.

## 1. Visão geral do projeto

Aplicativo web de controle financeiro pessoal, 100% local (sem login,
sem backend em nuvem, um único usuário), com as seguintes áreas:

- Dashboard (`/`) — resumo financeiro, gráficos, orçamento do mês.
- Transações (`/transacoes`) — lançamentos manuais e importados.
- Transações Família (`/transacoes-familia`) — ledger **isolado** (não
  entra em relatório/orçamento algum do resto do app, de propósito).
- Receitas (`/receitas`) — receitas do mês + seção de "Aluguéis de
  Temporada" (Airbnb/Booking) com cálculo de repasse.
- Categorias (`/categorias`) — CRUD de categorias.
- Investimentos (`/investimentos`) — cripto/moeda com cotação ao vivo.
- Relatórios (`/relatorios`) — gráficos e regra de orçamento 15/10/75, e
  no fim da página um bloco separado de **backup/restauração** de todos
  os dados em JSON (ver seção 8).
- Importar fatura (`/importar-fatura`) — importação de fatura de cartão
  (PDF) e de nota fiscal/NFC-e (PDF ou texto colado).

## 2. Stack técnica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Estilo | Tailwind CSS v4 (dark mode via classe `dark`, `@custom-variant`) |
| ORM | Prisma 7 (`generator` = `prisma-client`, saída em `src/generated/prisma`) |
| Driver do banco | `@prisma/adapter-pg` + `pg` (driver adapter, obrigatório no Prisma 7) |
| Banco de dados | PostgreSQL 17 |
| Gráficos | Recharts |
| PDF | `pdfjs-dist` (extração de texto de faturas/notas fiscais) |
| Validação | Zod |
| Seed/scripts | `tsx` |
| Testes | Vitest 4 + Testing Library (jsdom) — cobertura V8 travada em 100% |

Testado neste ambiente com **Node v24.18.0** e **npm 11.16.0** no Windows.
Qualquer Node ≥ 20 deve funcionar (o projeto usa `@types/node@^20` como
alvo mínimo de tipos, mas nada no código depende de uma API exclusiva do
Node 24).

## 3. Pré-requisitos

1. **Node.js 20+** instalado e no `PATH`.
2. **PostgreSQL 17** instalado e rodando (neste ambiente, como serviço
   Windows chamado `postgresql-x64-17`). Qualquer PostgreSQL 14+ deve
   funcionar; 17 foi só a versão usada no desenvolvimento.
3. Acesso a um usuário `postgres` (superusuário) do Postgres para criar o
   papel/banco de aplicação (passo 4 abaixo).
4. Conexão de saída à internet **apenas** para dois endpoints (ver seção
   6 — "Dependências externas"). Tudo o mais funciona 100% offline.

## 4. Passo a passo de instalação

### 4.1. Instalar as dependências do Node

```bash
cd C:\financialSupport
npm install
```

**Atenção:** `prisma`, `@prisma/engines` e `esbuild` têm scripts de
`postinstall` que precisam de aprovação explícita. Este projeto já
declara no `package.json` (campo `allowScripts`) que esses scripts são
confiáveis, mas dependendo do ambiente/ferramenta usada para instalar,
pode ser necessário aprovar manualmente os scripts do `prisma` e do
`esbuild` (procure por um comando equivalente a "approve builds/scripts"
na ferramenta usada) antes de continuar. Se o `npx prisma` do passo 4.4
falhar dizendo que o binário não foi encontrado/gerado, essa é a causa
mais provável.

### 4.2. Criar o papel e o banco de dados no PostgreSQL

O app usa um papel de **baixo privilégio dedicado** (`finance_app`),
separado do superusuário `postgres`, por segurança — nunca conecte o app
como `postgres`.

Abra um terminal com acesso ao `psql` (ou use o pgAdmin) como
superusuário e rode:

```sql
CREATE ROLE finance_app WITH LOGIN PASSWORD 'escolha-uma-senha-forte';
CREATE DATABASE financial_support OWNER finance_app;
```

> Se preferir outro nome de banco/papel, tudo bem — só precisa bater com
> o `DATABASE_URL` do passo 4.3.

**Importante:** propositalmente o papel `finance_app` **não** recebeu
permissão `CREATEDB`. Isso é relevante no passo 4.4 (explicado ali).

### 4.3. Criar o arquivo `.env`

Na raiz do projeto (`C:\financialSupport\.env`), crie:

```env
DATABASE_URL="postgresql://finance_app:escolha-uma-senha-forte@localhost:5432/financial_support"
```

Esse arquivo é ignorado pelo Git (`.env*` no `.gitignore`) — nunca vai
para o repositório.

### 4.4. Gerar o Prisma Client e sincronizar o schema

```bash
npx prisma generate
npx prisma db push
```

**Por que `db push` e não `prisma migrate dev`:** `migrate dev` precisa
criar um "shadow database" temporário, o que exige permissão `CREATEDB`
no papel de conexão. Como `finance_app` foi criado de propósito **sem**
essa permissão (princípio de menor privilégio), use sempre `db push`
para sincronizar o schema neste projeto. Não crie migrations com
`migrate dev` a menos que troque para um papel com `CREATEDB` só para
esse comando.

> Numa instalação já em uso, **gere um backup antes de rodar `db push`**:
> abra `/relatorios` e clique em "Baixar backup (JSON)" no bloco do fim da
> página, ou
> `curl http://localhost:3000/api/backup/export -o backup.json`.
> Ver seção 8.

### 4.5. Popular categorias padrão (seed)

```bash
npm run db:seed
```

Isso cria as 15 categorias padrão (Alimentação, Supermercado,
Transporte, Salário, etc. — ver `prisma/seed.ts`). É seguro rodar de
novo mais tarde: usa `upsert` por nome e nunca sobrescreve o campo
`deductsFromFreeSpend` depois da primeira criação (esse campo é um
toggle editável pelo usuário na tela de Categorias).

### 4.6. Rodar o servidor de desenvolvimento

```bash
npm run dev
```

Abra `http://localhost:3000`. Se a porta 3000 já estiver ocupada por
outro processo, o Next.js sobe automaticamente em 3001, 3002, etc. —
**confira a porta impressa no terminal**, não assuma que é sempre 3000.

⚠️ Isso vale inclusive quando quem ocupa a 3000 é **outro `next dev`**:
nesse caso ele imprime `Another next dev server is already running`
(com o PID e a pasta do servidor existente) e sobe na porta seguinte.
Ou seja, é possível ficar com dois servidores no ar ao mesmo tempo
servindo **código diferente** — e olhar a tela do errado. Nesta máquina
o risco é concreto porque existe uma **segunda cópia do projeto em
`C:\financialSupport`**, apontando para o MESMO banco
(`financial_support`); o `X:` é um disco físico distinto, não um
mapeamento de `C:`. Antes de concluir que uma alteração "não
funcionou", confirme de qual pasta veio o servidor da porta:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'next' } |
  Select-Object ProcessId, CommandLine | Format-List
```

## 5. Armadilhas conhecidas (leia antes de programar/depurar)

Estas são coisas que já causaram erro real durante o desenvolvimento
deste projeto. Evite repeti-las.

1. **Sempre reinicie o `npm run dev` completamente depois de qualquer
   mudança em `prisma/schema.prisma`.** O `PrismaClient` é guardado numa
   variável global (`src/lib/prisma.ts`) para sobreviver ao hot-reload do
   Next em desenvolvimento (evita esgotar conexões do Postgres a cada
   salvamento de arquivo). Mas isso significa que, depois de rodar
   `prisma db push && prisma generate`, o processo do `next dev` que já
   estava rodando continua com a classe antiga do Prisma Client em
   memória — e vai faltar o novo model (erro típico: `Cannot read
   properties of undefined (reading 'findMany')`). Sempre pare (Ctrl+C) e
   rode `npm run dev` de novo depois de mudar o schema.

2. **Nunca use `new Date(stringSoData)` diretamente para strings tipo
   `"2026-07-06"` (formato `YYYY-MM-DD`, sem horário).** O JavaScript
   interpreta essa string como meia-noite em UTC. Como o servidor roda em
   horário de Brasília (UTC-3), isso faz a data "voltar" um dia (ex:
   `"2026-07-06"` virava 5 de julho às 21h). Use sempre as funções de
   `src/lib/dateOnly.ts`:
   - `parseLocalDate(str)` — converte `"YYYY-MM-DD"` para meia-noite no
     horário local.
   - `parseLocalDateEndOfDay(str)` — mesma coisa, mas 23:59:59.999 (para
     filtros `lte` de intervalo de datas).
   - `addDays(date, n)` — soma dias sem cair na mesma pegadinha de fuso.

3. **Prisma 7 não usa mais `@prisma/client` clássico nem `datasource.url`
   no schema.** O generator é `prisma-client` (saída em
   `src/generated/prisma`, importado como `@/generated/prisma/client`), e
   a conexão é feita passando um "driver adapter" (`PrismaPg`, do pacote
   `@prisma/adapter-pg`) para `new PrismaClient({ adapter })` — ver
   `src/lib/prisma.ts` e `prisma/seed.ts`. A `DATABASE_URL` do `.env` é
   lida em runtime pelo adapter, não pelo `schema.prisma`.

4. **`pdfjs-dist` precisa continuar em `serverExternalPackages` no
   `next.config.ts`.** Se for removido, o Turbopack (bundler do Next)
   quebra o worker interno do pdf.js (erro: não encontra o módulo
   `.../chunks/pdf.worker.mjs`). Isso afeta a importação de faturas de
   cartão e de notas fiscais/NFC-e, que dependem de `src/lib/pdf.ts`.

5. **Se `.next/types/validator.ts` der erro de tipo estranho depois de
   renomear um model do Prisma ou uma rota**, apague a pasta `.next`
   inteira e rode `npm run dev` de novo — esses tipos ficam com cache
   obsoleto e o TypeScript aponta erros que já não existem no código
   fonte.

6. **Os modelos `FamilyTransaction` e `SeasonalRental` /
   `SeasonalRentalExpense` são propositalmente isolados** do resto do
   app (sem relação Prisma com `Transaction`/`Category`). Não crie
   relação entre eles achando que é uma correção — é uma decisão de
   design explícita do usuário (ver comentários no `schema.prisma`).

   Existe um caminho de MOVIMENTAÇÃO de uma transação do ledger principal
   para o da família (`POST /api/transactions/[id]/move-to-family`), e ele
   não fura o isolamento: copia só os campos que a família tem, apaga a
   transação original e não deixa nenhuma referência entre as tabelas.
   Categoria, cartão, fatura, parcelamento e devolução pendente são
   perdidos de propósito — não tente "preservar" esses dados criando
   colunas novas em `FamilyTransaction`.

7. **Repasses (`RentalSettlement`) são permanentes por design.** O
   usuário pediu e depois retirou explicitamente o pedido de uma função
   de cancelar/desfazer um repasse já gerado — não adicione essa
   funcionalidade a menos que seja pedida de novo.

   São **três** trilhas independentes (`DAVID`, `FAMILIA`, `LIMPEZA`),
   cada uma com sua própria coluna de trava no `SeasonalRental`. Ao
   acrescentar uma quarta, o único lugar a mexer na lógica é
   `src/lib/rentalSettlements.ts` (mapa `SETTLEMENT_FIELD` + função
   `rentalShare`) — mas o `perRentalValue` do `SettlementModal` precisa
   mudar junto, senão a lista do preview não bate com o total gerado.

8. **`tableValue` (valor de tabela do aluguel) nunca é salvo no banco** —
   é sempre recalculado a partir de `src/lib/rentalPriceTable.ts` na hora
   da leitura. Isso é intencional: uma correção futura na tabela de
   preços conserta retroativamente todos os registros antigos. Não
   adicione uma coluna para "cachear" esse valor.

   A **única** coisa de precificação que fica salva é
   `SeasonalRental.nightRateOverrides` (Json `{ "YYYY-MM-DD": valor }`):
   as diárias que o usuário customizou naquele aluguel específico, pela
   lista "Valores das diárias" do modal de edição. Isso **não** é cache
   de cálculo — é uma entrada informada pelo usuário. Só as noites
   presentes no mapa saem da tabela; as ausentes continuam seguindo
   `rentalPriceTable.ts` e continuam se corrigindo retroativamente. Não
   remova esse campo achando que ele viola a regra acima, e ao criar
   qualquer caminho novo que calcule um aluguel, repasse os overrides
   para `computeRental()` (hoje: `serializeRentalWithComputed`, as rotas
   de `seasonal-rentals` e `rentalSettlements.findUnsettledRentals` — se
   o repasse ignorar os overrides, ele fecha um valor diferente do Total
   David exibido no próprio aluguel).

9. **Não existe banco de testes isolado nesta instalação, e não dá para
   criar um** (checado em 2026-08-29). Duas barreiras somadas:
   - O papel `finance_app` não tem `CREATEDB` (decisão do passo 4.2) e só
     tem permissão de `CREATE` no próprio `financial_support`, então não há
     como criar um banco separado com as credenciais do app.
   - Criar um **schema** separado no mesmo banco (`CREATE SCHEMA zztest` +
     `prisma db push` com a URL apontando para ele) **não isola nada**: com
     driver adapter o Prisma emite SQL qualificado com o schema do
     datasource (`"public"."Transaction"`), então nem `?schema=zztest` na
     URL nem `search_path` (via `?options=-c%20search_path%3Dzztest`) mudam
     onde as queries caem — o app continua lendo e escrevendo em `public`.
     O `prisma db push` até cria as tabelas no schema novo, o que dá a
     falsa impressão de que funcionou.

   Consequência prática: testar qualquer coisa destrutiva significa mexer
   nos dados reais. Gere um backup antes (seção 8) e, quando possível,
   prefira testes que só **inserem** registros com um prefixo de `id`
   próprio (ex: `zztest-…`), fáceis de apagar depois.

10. **O Next carrega `.env.local` com prioridade sobre `.env`** — e
    sobrescreve até variáveis já definidas no `process.env` do processo que
    chamou o `next dev` (ou seja, `$env:DATABASE_URL = ...; npx next dev`
    **não** vence o `.env`). Se criar um `.env.local` para um teste, apague-o
    depois: senão o app fica apontando para outro banco sem nenhum aviso na
    tela. O `.gitignore` já cobre `.env*.local`, então ele não vai para o
    repositório.

    Armadilha dobrada no PowerShell 5.1: `Set-Content -Encoding utf8`
    escreve **BOM**, e o BOM entra no nome da primeira variável
    (`﻿DATABASE_URL`), que passa a ser silenciosamente ignorada — o
    arquivo parece certo em qualquer editor. Escreva sem BOM:

    ```powershell
    [System.IO.File]::WriteAllText($path, $texto, (New-Object System.Text.UTF8Encoding($false)))
    ```

## 6. Dependências externas (as únicas chamadas fora da máquina local)

O app é local-first, mas duas cotações em tempo real exigem chamada de
saída à internet (nenhuma delas exige chave de API nem envia dados do
usuário):

- **CoinGecko** — cotação de criptomoedas (`src/lib/prices.ts`).
- **open.er-api.com** — cotação de moedas estrangeiras (`src/lib/prices.ts`).

Há um cache em memória de 30 segundos para evitar chamadas repetidas em
sequência. Se a máquina não tiver internet, tudo o resto do app continua
funcionando normalmente — só a página de Investimentos não conseguirá
mostrar preço atual.

## 7. Limitações conhecidas (não são bugs, são escopo atual)

- Importação de fatura de cartão só suporta o layout do **Santander**
  (`src/lib/invoiceParsers/santander.ts`). Para outro banco, é preciso
  uma amostra real do PDF antes de escrever um parser novo — nunca
  implemente um parser a partir de suposição de layout.
- Importação de nota fiscal só suporta o formato de **NFC-e de Minas
  Gerais** (SEFAZ-MG), extraído de um PDF salvo manualmente pelo usuário
  (o portal da SEFAZ exige resolver um CAPTCHA antes de mostrar os
  dados — isso nunca deve ser automatizado/contornado por código).
- A tabela de preços de aluguel de temporada não inclui feriados
  estaduais de Minas Gerais nem municipais de Belo Horizonte (só
  feriados nacionais, calculados via algoritmo de Meeus/Jones/Butcher
  para a Páscoa) — a fonte original (PDF da tabela de preços) não
  especificava essas datas. Existe uma saída manual: no modal de editar
  o aluguel, a lista "Valores das diárias" permite ajustar a diária
  daquela noite específica só naquele aluguel (ver armadilha 8).
- Não há autenticação/login — o app assume um único usuário local.

## 8. Backup e restauração dos dados (sem passar pelo banco)

Como não existe backup em nuvem (o app é local-first), o próprio app faz
backup completo em JSON. Isso é o que permite mexer no schema/banco com
rede de segurança, sem precisar de `pg_dump`/`psql`.

**Onde fica:** bloco no fim da página `/relatorios`, com as duas opções.

| Ação | Pela tela | Por linha de comando |
|---|---|---|
| Fazer backup | "Baixar backup (JSON)" | `curl http://localhost:3000/api/backup/export -o backup.json` |
| Restaurar (substituir tudo) | escolher o arquivo → "Substituir tudo" | `curl -X POST "http://localhost:3000/api/backup/restore?mode=replace" -H "Content-Type: application/json" --data-binary @backup.json` |
| Restaurar (só o que falta) | escolher o arquivo → "Só adicionar o que falta" | idem, com `mode=merge` |

O que é bom saber antes de confiar nisso:

- O arquivo cobre **todas as 11 tabelas** e preserva os `id` (cuid), então
  as ligações entre os registros continuam valendo depois de restaurar — e
  restaurar o mesmo arquivo duas vezes não duplica nada.
- `mode` é **obrigatório** e não tem padrão, de propósito: é uma operação
  destrutiva demais para o servidor adivinhar a intenção.
- A restauração roda inteira em **uma transação do Postgres**: ou aplica
  tudo, ou o banco fica exatamente como estava. Vale inclusive para o
  `replace`, cujo primeiro passo é apagar tudo.
- A restauração **não recria** valores derivados, porque eles nunca são
  salvos (ver armadilha 8): restaurar um backup antigo com uma tabela de
  preços nova é seguro e esperado.
- Não é substituto de `pg_dump` para um desastre de servidor — é para
  desfazer uma mudança de dados/schema feita por você.
- Detalhes de formato e das decisões de design: `src/lib/backup.ts` e a
  seção 4.8 do `contexto.md`.

## 9. Rodar os testes

O projeto tem uma suíte de **1242 testes** (Vitest + Testing Library)
cobrindo **100% de `src/`**. Ela não depende de banco nem de internet —
`src/lib/prisma` e o `fetch` são substituídos por dublês —, então dá para
rodar antes mesmo de configurar o PostgreSQL:

```bash
npm test              # roda a suíte uma vez
npm run test:watch    # fica observando os arquivos
npm run test:coverage # roda com relatório de cobertura
```

O limite de 100% está fixado em `coverage.thresholds`
(`vitest.config.mts`): **`npm run test:coverage` falha se a cobertura
cair**. Ao adicionar código, adicione teste junto.

Detalhes de organização, decisões de configuração (por que duas
"projects", por que o fuso é fixado, por que `sequence.hooks: "list"`) e as
armadilhas de teste já mapeadas estão na **seção 9 do `contexto.md`** —
leia antes de escrever teste novo, especialmente se for de componente.

## 10. Comandos úteis (resumo rápido)

```bash
npm install              # instala dependências
npx prisma generate      # gera o Prisma Client em src/generated/prisma
npx prisma db push       # sincroniza o schema.prisma com o banco (NÃO usar migrate dev)
npm run db:seed          # popula as categorias padrão
npm run dev               # servidor de desenvolvimento (http://localhost:3000, ou porta seguinte se ocupada)
npm run build             # build de produção
npm run start             # roda o build de produção
npm run lint               # ESLint
npx tsc --noEmit           # checagem de tipos sem gerar arquivos

# backup de todos os dados em JSON (com o servidor rodando) — ver seção 8
curl http://localhost:3000/api/backup/export -o backup.json
```
