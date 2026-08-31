import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { POST } from "@/app/api/transactions/[id]/move-to-family/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Transação como o Prisma devolve (Decimal simulado por string, data como Date). */
function transacao(over: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    date: new Date(2026, 7, 15),
    description: "SUPERMERCADO BH",
    amount: "150.00",
    type: "EXPENSE",
    notes: "compra do mês",
    categoryId: "cat-1",
    creditCardId: "card-1",
    invoiceId: "inv-1",
    installmentCurrent: 1,
    installmentTotal: 3,
    pendingReturn: true,
    ...over,
  };
}

/** Chama o handler para o id informado. */
function mover(id = "tx-1") {
  return POST(
    jsonRequest("POST", `/api/transactions/${id}/move-to-family`, {}),
    routeParams({ id }),
  );
}

describe("POST /api/transactions/[id]/move-to-family", () => {
  it("cria a transação da família com os campos que existem lá", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    const { status } = await readJson(await mover());

    expect(status).toBe(200);
    expect(prisma.familyTransaction.create).toHaveBeenCalledWith({
      data: {
        date: new Date(2026, 7, 15),
        description: "SUPERMERCADO BH",
        amount: "150.00",
        type: "EXPENSE",
        notes: "compra do mês",
      },
    });
  });

  it("apaga a transação do ledger principal (é movimentação, não cópia)", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: "tx-1" } });
  });

  it("as duas gravações rodam na mesma transação do banco", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    // Sem isso, uma falha no meio deixaria a transação nos dois ledgers (ou em
    // nenhum) — ver o comentário na própria rota.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("não migra categoria, cartão, fatura, parcelamento nem devolução pendente", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    const dados = prisma.familyTransaction.create.mock.calls[0][0].data;
    for (const campo of [
      "categoryId",
      "creditCardId",
      "invoiceId",
      "installmentCurrent",
      "installmentTotal",
      "pendingReturn",
      "source",
      "id",
    ]) {
      expect(dados).not.toHaveProperty(campo);
    }
  });

  it("mantém o tipo Crédito", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao({ type: "INCOME" }));
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    expect(prisma.familyTransaction.create.mock.calls[0][0].data.type).toBe("INCOME");
  });

  it("converte Pagamento em Despesa (o ledger da família não tem esse tipo)", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao({ type: "PAYMENT" }));
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    const { body } = await readJson(await mover());

    expect(prisma.familyTransaction.create.mock.calls[0][0].data.type).toBe("EXPENSE");
    // A tela usa esse campo para avisar da conversão sem repetir a regra.
    expect(body.convertedFromPayment).toBe(true);
  });

  it("não sinaliza conversão quando o tipo já existia na família", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    const { body } = await readJson(await mover());

    expect(body.convertedFromPayment).toBe(false);
  });

  it("devolve a transação criada na família", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao());
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1", description: "SUPERMERCADO BH" });

    const { body } = await readJson(await mover());

    expect(body.familyTransaction).toEqual({ id: "fam-1", description: "SUPERMERCADO BH" });
  });

  it("aceita transação sem observação", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao({ notes: null }));
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    expect(prisma.familyTransaction.create.mock.calls[0][0].data.notes).toBeNull();
  });

  it("responde 404 e não grava nada quando a transação não existe", async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);

    const { status, body } = await readJson(await mover("nao-existe"));

    expect(status).toBe(404);
    expect(body.error).toContain("não encontrada");
    expect(prisma.familyTransaction.create).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it("usa o id da URL nas duas pontas", async () => {
    prisma.transaction.findUnique.mockResolvedValue(transacao({ id: "tx-9" }));
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-9" });

    await mover("tx-9");

    expect(prisma.transaction.findUnique).toHaveBeenCalledWith({ where: { id: "tx-9" } });
    expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: "tx-9" } });
  });

  it("a data vai como Date do banco, sem passar por dateOnly", async () => {
    // A armadilha de fuso do dateOnly.ts vale para string "YYYY-MM-DD"; aqui a
    // data já vem do banco como instante exato.
    const date = new Date(2026, 0, 31, 3, 0, 0);
    prisma.transaction.findUnique.mockResolvedValue(transacao({ date }));
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-1" });

    await mover();

    expect(prisma.familyTransaction.create.mock.calls[0][0].data.date).toBe(date);
  });

  it("não existe rota de trazer de volta (a movimentação não tem desfazer)", async () => {
    const rota = await import("@/app/api/transactions/[id]/move-to-family/route");
    expect(rota).not.toHaveProperty("DELETE");
    expect(rota).not.toHaveProperty("GET");
    expect(rota).not.toHaveProperty("PATCH");
  });
});
