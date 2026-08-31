import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SettlementModal from "@/components/SettlementModal";
import { normalizarEspacos as norm } from "../helpers/text";

let fetchMock: ReturnType<typeof vi.fn>;

const aluguelPreview = {
  id: "rent-1",
  platform: "AIRBNB" as const,
  checkIn: "2026-08-08",
  checkOut: "2026-08-11",
  // Base da trilha LIMPEZA: vem do preview da API, não é derivado do computed.
  cleaningFee: 180,
  computed: { totalDavid: 250, netForDistribution: 570 },
};

/** Preview padrão para GET, e resposta configurável para o POST. */
function comPreview(preview: unknown, postResposta?: { ok?: boolean; body?: unknown }) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return {
        ok: postResposta?.ok ?? true,
        json: async () => postResposta?.body ?? { totalAmount: 250 },
      };
    }
    return { json: async () => preview };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const props = { onClose: vi.fn(), onGenerated: vi.fn() };

/**
 * Texto da linha de total. A busca por texto solto não serve aqui: a palavra
 * "aluguéis" também aparece no parágrafo que explica o tipo de repasse, e o
 * texto do total é quebrado em vários nós de texto pelo JSX.
 */
function linhaDoTotal(): string {
  const p = Array.from(document.querySelectorAll("p")).find((el) =>
    el.textContent?.startsWith("Total "),
  );
  return p?.textContent ?? "";
}

describe("SettlementModal — preview", () => {
  it("começa no tipo David e busca o preview do mês corrente", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rental-settlements/preview?type=DAVID&from=2026-08-01&to=2026-08-31",
      ),
    );
    expect(screen.getByText("Fechar repasse do período")).toBeInTheDocument();
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<SettlementModal {...props} />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("lista os aluguéis do período com o valor do tipo escolhido", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);

    await waitFor(() => expect(screen.getByText(/Airbnb/)).toBeInTheDocument());
    expect(screen.getByText(/08\/08\/2026 a 11\/08\/2026/)).toBeInTheDocument();
    // No tipo David, o valor por aluguel é o Total David. A busca é escopada na
    // linha do aluguel porque o mesmo valor aparece de novo no total do período.
    const linha = screen.getByText(/Airbnb/).closest("li")!;
    expect(norm(linha.textContent)).toContain(norm("R$ 250,00"));
  });

  it("mostra o total com a contagem no plural correto", async () => {
    comPreview({
      totalAmount: 500,
      rentalCount: 2,
      rentals: [aluguelPreview, { ...aluguelPreview, id: "rent-2" }],
    });

    render(<SettlementModal {...props} />);

    await waitFor(() => expect(norm(linhaDoTotal())).toContain("2 aluguéis"));
  });

  it("usa singular quando é um só aluguel", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);

    await waitFor(() => expect(norm(linhaDoTotal()).trim()).toContain("1 aluguel)"));
  });

  it("avisa quando não há aluguel pendente no período", async () => {
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    render(<SettlementModal {...props} />);

    await waitFor(() =>
      expect(screen.getByText("Nenhum aluguel pendente de fechamento nesse período.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Gerar registro" })).toBeDisabled();
  });
});

describe("SettlementModal — troca de tipo", () => {
  it("trocar para Família rebusca o preview e muda a explicação", async () => {
    comPreview({ totalAmount: 285, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => expect(screen.getByText(/Total David/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Família" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rental-settlements/preview?type=FAMILIA&from=2026-08-01&to=2026-08-31",
      ),
    );
    expect(screen.getByText(/divide o total por 2/)).toBeInTheDocument();
    expect(screen.getByText(/soma ÷ 2/)).toBeInTheDocument();
  });

  it("no tipo Família o valor por aluguel é o líquido para distribuição", async () => {
    comPreview({ totalAmount: 285, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Família" }));

    await waitFor(() => expect(screen.getByText(/570,00/)).toBeInTheDocument());
  });

  it("trocar para Limpeza rebusca o preview e muda a explicação", async () => {
    comPreview({ totalAmount: 180, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => expect(screen.getByText(/Total David/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Limpeza" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rental-settlements/preview?type=LIMPEZA&from=2026-08-01&to=2026-08-31",
      ),
    );
    expect(screen.getByText(/sem dividir/)).toBeInTheDocument();
  });

  it("no tipo Limpeza o valor por aluguel é o valor da limpeza", async () => {
    comPreview({ totalAmount: 180, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Limpeza" }));

    // Escopado na linha do aluguel: o mesmo valor reaparece no total do período.
    await waitFor(() => {
      const linha = screen.getByText(/Airbnb/).closest("li")!;
      expect(norm(linha.textContent)).toContain(norm("R$ 180,00"));
    });
  });

  it("o total da trilha Limpeza não mostra a divisão por 2", async () => {
    comPreview({ totalAmount: 380, rentalCount: 2, rentals: [aluguelPreview, { ...aluguelPreview, id: "rent-2" }] });

    render(<SettlementModal {...props} />);
    // Dois aluguéis da mesma plataforma aqui, então a espera é pela linha do
    // total (o `getByText(/Airbnb/)` acharia duas linhas e falharia).
    await waitFor(() => expect(norm(linhaDoTotal())).toContain("2 aluguéis"));

    fireEvent.click(screen.getByRole("button", { name: "Limpeza" }));

    await waitFor(() => expect(linhaDoTotal()).toContain("380,00"));
    expect(linhaDoTotal()).not.toContain("÷ 2");
  });

  it("destaca a aba ativa", async () => {
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    render(<SettlementModal {...props} />);

    expect(screen.getByRole("button", { name: "David" }).className).toContain("border-indigo-600");
    expect(screen.getByRole("button", { name: "Família" }).className).toContain("border-transparent");
    expect(screen.getByRole("button", { name: "Limpeza" }).className).toContain("border-transparent");

    fireEvent.click(screen.getByRole("button", { name: "Família" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Família" }).className).toContain(
        "border-indigo-600",
      ),
    );
    expect(screen.getByRole("button", { name: "David" }).className).toContain("border-transparent");
  });

  it("trocar o período rebusca o preview", async () => {
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    render(<SettlementModal {...props} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rental-settlements/preview?type=DAVID&from=2026-07-01&to=2026-07-31",
      ),
    );
  });

  it("mostra a plataforma Booking quando é o caso", async () => {
    comPreview({
      totalAmount: 250,
      rentalCount: 1,
      rentals: [{ ...aluguelPreview, platform: "BOOKING" }],
    });

    render(<SettlementModal {...props} />);

    await waitFor(() => expect(screen.getByText(/Booking/)).toBeInTheDocument());
  });
});

describe("SettlementModal — gerar o repasse", () => {
  it("envia o tipo e o período e mostra o resultado", async () => {
    const onGenerated = vi.fn();
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} onGenerated={onGenerated} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/rental-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DAVID", periodFrom: "2026-08-01", periodTo: "2026-08-31" }),
      }),
    );
    await waitFor(() => expect(screen.getByText(/Registro gerado \(David\)/)).toBeInTheDocument());
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });

  it("depois de gerar, esconde o botão de gerar e troca o rótulo de cancelar", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Gerar registro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("mostra o rótulo Família no resultado quando é esse o tipo", async () => {
    comPreview({ totalAmount: 285, rentalCount: 1, rentals: [aluguelPreview] }, { body: { totalAmount: 285 } });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));
    fireEvent.click(screen.getByRole("button", { name: "Família" }));
    await waitFor(() => screen.getByText(/soma ÷ 2/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() => expect(screen.getByText(/Registro gerado \(Família\)/)).toBeInTheDocument());
  });

  it("mostra o rótulo Limpeza no resultado quando é esse o tipo", async () => {
    comPreview({ totalAmount: 180, rentalCount: 1, rentals: [aluguelPreview] }, { body: { totalAmount: 180 } });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));
    fireEvent.click(screen.getByRole("button", { name: "Limpeza" }));
    await waitFor(() => screen.getByText(/sem dividir/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/rental-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "LIMPEZA", periodFrom: "2026-08-01", periodTo: "2026-08-31" }),
      }),
    );
    await waitFor(() => expect(screen.getByText(/Registro gerado \(Limpeza\)/)).toBeInTheDocument());
  });

  it("mostra o erro devolvido pela API", async () => {
    comPreview(
      { totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] },
      { ok: false, body: { error: "Nenhum aluguel não liquidado encontrado." } },
    );

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() => expect(screen.getByText(/Nenhum aluguel não liquidado/)).toBeInTheDocument());
    // Não marca como gerado.
    expect(screen.queryByText(/Registro gerado/)).not.toBeInTheDocument();
  });

  it("usa mensagem genérica quando a API falha sem detalhar o erro", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] }, { ok: false, body: {} });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() => expect(screen.getByText("Erro ao gerar o registro.")).toBeInTheDocument());
  });

  it("desabilita o botão enquanto gera", async () => {
    let liberarPost: () => void = () => {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await new Promise<void>((resolve) => {
          liberarPost = resolve;
        });
        return { ok: true, json: async () => ({ totalAmount: 250 }) };
      }
      return { json: async () => ({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] }) };
    });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Gerar registro" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Gerando..." })).toBeDisabled());
    liberarPost();
    await waitFor(() => expect(screen.getByText(/Registro gerado/)).toBeInTheDocument());
  });
});

describe("SettlementModal — fechar", () => {
  it("fecha pelo botão cancelar", async () => {
    const onClose = vi.fn();
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    render(<SettlementModal {...props} onClose={onClose} />);
    await waitFor(() => screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fecha ao clicar no fundo escuro", async () => {
    const onClose = vi.fn();
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    const { container } = render(<SettlementModal {...props} onClose={onClose} />);

    fireEvent.click(container.firstElementChild!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicar dentro do modal não fecha", async () => {
    const onClose = vi.fn();
    comPreview({ totalAmount: 0, rentalCount: 0, rentals: [] });

    render(<SettlementModal {...props} onClose={onClose} />);

    fireEvent.click(screen.getByText("Fechar repasse do período"));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SettlementModal — voltar para a aba David", () => {
  it("dá para alternar Família → David", async () => {
    comPreview({ totalAmount: 250, rentalCount: 1, rentals: [aluguelPreview] });

    render(<SettlementModal {...props} />);
    await waitFor(() => screen.getByText(/Airbnb/));

    fireEvent.click(screen.getByRole("button", { name: "Família" }));
    await waitFor(() => expect(screen.getByText(/divide o total por 2/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "David" }));

    await waitFor(() => expect(screen.getByText(/Total David/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "David" }).className).toContain("border-indigo-600");
  });
});
