import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SeasonalRentalsSection from "@/components/SeasonalRentalsSection";
import { normalizarEspacos as norm } from "../helpers/text";

/**
 * Os três modais têm testes próprios; aqui eles são dublês para o foco ficar na
 * seção: qual modal abre a partir de qual botão, com qual aluguel, e o que
 * acontece quando o modal avisa que salvou.
 */
vi.mock("@/components/SeasonalRentalModal", () => ({
  default: ({ rental, onClose, onSaved }: any) => (
    <div data-testid="modal-aluguel">
      <span>{rental ? `editando ${rental.id}` : "novo aluguel"}</span>
      <button type="button" onClick={onSaved}>
        simular salvar
      </button>
      <button type="button" onClick={onClose}>
        simular fechar
      </button>
    </div>
  ),
}));

vi.mock("@/components/SettlementModal", () => ({
  default: ({ onClose, onGenerated }: any) => (
    <div data-testid="modal-repasse">
      <button type="button" onClick={onGenerated}>
        simular gerar
      </button>
      <button type="button" onClick={onClose}>
        simular fechar repasse
      </button>
    </div>
  ),
}));

vi.mock("@/components/RentalWhatsAppModal", () => ({
  default: ({ rental, onClose }: any) => (
    <div data-testid="modal-whatsapp">
      <span>relatório de {rental.id}</span>
      <button type="button" onClick={onClose}>
        simular fechar whatsapp
      </button>
    </div>
  ),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function aluguel(over: Record<string, unknown> = {}) {
  return {
    id: "rent-1",
    platform: "AIRBNB",
    checkIn: "2026-08-08",
    checkOut: "2026-08-11",
    netAmountReceived: 1000,
    cleaningFee: 180,
    notes: null as string | null,
    isDavidSettled: false,
    isFamiliaSettled: false,
    isLimpezaSettled: false,
    expenses: [],
    nightRateOverrides: {},
    computed: {
      nights: 3,
      tableValue: 420,
      hasCustomNightRates: false,
      davidTenPercent: 100,
      extrasTotal: 0,
      extraTableValue: 300,
      totalDavid: 250,
      netForDistribution: 570,
    },
    ...over,
  };
}

/** GET devolve a lista; DELETE responde ok. */
function comAlugueis(...listas: unknown[][]) {
  const fila = [...listas];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return { json: async () => ({ ok: true }) };
    const proxima = fila.length > 1 ? fila.shift()! : fila[0];
    return { json: async () => proxima };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SeasonalRentalsSection — listagem", () => {
  it("mostra o cabeçalho da seção", async () => {
    comAlugueis([]);

    render(<SeasonalRentalsSection />);

    expect(screen.getByText("Aluguéis de Temporada")).toBeInTheDocument();
    expect(screen.getByText(/cálculo do repasse para o David/)).toBeInTheDocument();
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<SeasonalRentalsSection />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("avisa quando não há aluguel registrado", async () => {
    comAlugueis([]);

    render(<SeasonalRentalsSection />);

    await waitFor(() =>
      expect(screen.getByText("Nenhum aluguel registrado ainda.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/seasonal-rentals");
  });

  it("mostra plataforma, período, noites e todos os valores do aluguel", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText("Airbnb")).toBeInTheDocument());
    expect(screen.getByText(/08\/08\/2026 → 11\/08\/2026 \(3 noites\)/)).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 1.000,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 180,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 420,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 300,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 250,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 570,00"));
  });

  it("mostra a plataforma Booking quando é o caso", async () => {
    comAlugueis([aluguel({ platform: "BOOKING" })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText("Booking")).toBeInTheDocument());
  });

  it("lista os gastos extras do aluguel", async () => {
    comAlugueis([
      aluguel({ expenses: [{ id: "e1", description: "Gás", amount: 60 }] }),
    ]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText(/Gás/)).toBeInTheDocument());
    expect(norm(screen.getByText(/Gás/).textContent)).toContain(norm("R$ 60,00"));
  });

  it("não mostra lista de extras quando não há nenhum", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(document.querySelector("ul.list-disc")).toBeNull();
  });

  it("marca os repasses já fechados", async () => {
    comAlugueis([
      aluguel({ isDavidSettled: true, isFamiliaSettled: true, isLimpezaSettled: true }),
    ]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText("✓ David")).toBeInTheDocument());
    expect(screen.getByText("✓ Família")).toBeInTheDocument();
    expect(screen.getByText("✓ Limpeza")).toBeInTheDocument();
  });

  it("marca só a trilha fechada (as três são independentes)", async () => {
    comAlugueis([aluguel({ isLimpezaSettled: true })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText("✓ Limpeza")).toBeInTheDocument());
    expect(screen.queryByText("✓ David")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ Família")).not.toBeInTheDocument();
  });

  it("não marca nada quando os repasses estão abertos", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(screen.queryByText("✓ David")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ Família")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ Limpeza")).not.toBeInTheDocument();
  });

  it("mostra a nota do aluguel quando existe", async () => {
    comAlugueis([aluguel({ notes: "Hóspede quebrou uma taça." })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getByText("Hóspede quebrou uma taça.")).toBeInTheDocument());
  });

  it("preserva as quebras de linha da nota", async () => {
    comAlugueis([aluguel({ notes: "Linha 1\nLinha 2" })]);

    render(<SeasonalRentalsSection />);

    const nota = await waitFor(() => screen.getByText(/Linha 1/));
    // `whitespace-pre-line`: sem isso o textarea do usuário viraria uma linha só.
    expect(nota.className).toContain("whitespace-pre-line");
  });

  it("não reserva espaço para a nota quando o aluguel não tem uma", async () => {
    comAlugueis([aluguel({ notes: null })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(document.querySelector(".whitespace-pre-line")).toBeNull();
  });

  it("nota vazia (string em branco) também não é exibida", async () => {
    comAlugueis([aluguel({ notes: "" })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(document.querySelector(".whitespace-pre-line")).toBeNull();
  });

  it("sinaliza quando o aluguel tem diárias customizadas", async () => {
    comAlugueis([
      aluguel({
        nightRateOverrides: { "2026-08-09": 240 },
        computed: { ...aluguel().computed, hasCustomNightRates: true },
      }),
    ]);

    render(<SeasonalRentalsSection />);

    await waitFor(() =>
      expect(
        screen.getByTitle("Este aluguel tem diárias customizadas (editáveis no botão 'editar')"),
      ).toBeInTheDocument(),
    );
  });

  it("não sinaliza customização quando tudo segue a tabela", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(screen.queryByText("✎")).not.toBeInTheDocument();
  });

  it("lista vários aluguéis", async () => {
    comAlugueis([aluguel(), aluguel({ id: "rent-2", platform: "BOOKING" })]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "editar" })).toHaveLength(2));
  });
});

describe("SeasonalRentalsSection — modal de aluguel", () => {
  it("abre em modo de criação pelo botão de novo registro", async () => {
    comAlugueis([]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Nenhum aluguel registrado ainda."));

    fireEvent.click(screen.getByRole("button", { name: "+ Novo registro de aluguel" }));

    expect(screen.getByTestId("modal-aluguel")).toHaveTextContent("novo aluguel");
  });

  it("abre em modo de edição pelo botão do aluguel", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));

    fireEvent.click(screen.getByRole("button", { name: "editar" }));

    expect(screen.getByTestId("modal-aluguel")).toHaveTextContent("editando rent-1");
  });

  it("salvar fecha o modal e recarrega a lista", async () => {
    comAlugueis([aluguel()], [aluguel(), aluguel({ id: "rent-2" })]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "editar" }));

    fireEvent.click(screen.getByRole("button", { name: "simular salvar" }));

    await waitFor(() => expect(screen.queryByTestId("modal-aluguel")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("button", { name: "editar" })).toHaveLength(2));
  });

  it("fechar o modal não recarrega a lista", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "editar" }));
    const chamadas = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "simular fechar" }));

    expect(screen.queryByTestId("modal-aluguel")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(chamadas);
  });
});

describe("SeasonalRentalsSection — modal de repasse", () => {
  it("abre pelo botão de fechar repasse", async () => {
    comAlugueis([]);

    render(<SeasonalRentalsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar repasse do período" }));

    expect(screen.getByTestId("modal-repasse")).toBeInTheDocument();
  });

  it("gerar um repasse recarrega a lista sem fechar o modal", async () => {
    comAlugueis([aluguel()], [aluguel({ isDavidSettled: true })]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "Fechar repasse do período" }));

    fireEvent.click(screen.getByRole("button", { name: "simular gerar" }));

    await waitFor(() => expect(screen.getByText("✓ David")).toBeInTheDocument());
    expect(screen.getByTestId("modal-repasse")).toBeInTheDocument();
  });

  it("fecha pelo callback do modal", async () => {
    comAlugueis([]);

    render(<SeasonalRentalsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar repasse do período" }));

    fireEvent.click(screen.getByRole("button", { name: "simular fechar repasse" }));

    expect(screen.queryByTestId("modal-repasse")).not.toBeInTheDocument();
  });
});

describe("SeasonalRentalsSection — relatório de WhatsApp", () => {
  it("é por aluguel individual", async () => {
    comAlugueis([aluguel(), aluguel({ id: "rent-2" })]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "WhatsApp" })).toHaveLength(2));

    fireEvent.click(screen.getAllByRole("button", { name: "WhatsApp" })[1]);

    expect(screen.getByTestId("modal-whatsapp")).toHaveTextContent("relatório de rent-2");
  });

  it("fecha pelo callback do modal", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));

    fireEvent.click(screen.getByRole("button", { name: "simular fechar whatsapp" }));

    expect(screen.queryByTestId("modal-whatsapp")).not.toBeInTheDocument();
  });
});

describe("SeasonalRentalsSection — exclusão", () => {
  it("pede confirmação avisando que a receita também será removida", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(screen.getByText("Excluir registro de aluguel")).toBeInTheDocument();
    expect(screen.getByText(/receita gerada automaticamente/)).toBeInTheDocument();
  });

  it("confirmar exclui e recarrega", async () => {
    comAlugueis([aluguel()], []);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/seasonal-rentals/rent-1", { method: "DELETE" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Nenhum aluguel registrado ainda.")).toBeInTheDocument(),
    );
  });

  it("cancelar não exclui nada", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);
    await waitFor(() => screen.getByText("Airbnb"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText("Excluir registro de aluguel")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });

  it("o diálogo de confirmação começa fechado", async () => {
    comAlugueis([aluguel()]);

    render(<SeasonalRentalsSection />);

    await waitFor(() => screen.getByText("Airbnb"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
