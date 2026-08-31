import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SeasonalRentalModal from "@/components/SeasonalRentalModal";
import { normalizarEspacos as norm } from "../helpers/text";
import { campoPorRotulo } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;

/** Preview como a API devolve para 08/06→11/06/2026 (3 noites de baixa temporada). */
function previewPadrao(over: Record<string, unknown> = {}) {
  return {
    nights: 3,
    tableValue: 420,
    nightRates: [
      {
        date: "2026-06-08T03:00:00.000Z",
        key: "2026-06-08",
        tableRate: 140,
        rate: 140,
        isOverridden: false,
        kind: "LOW_SEASON",
        isWeekend: false,
      },
      {
        date: "2026-06-09T03:00:00.000Z",
        key: "2026-06-09",
        tableRate: 140,
        rate: 140,
        isOverridden: false,
        kind: "LOW_SEASON",
        isWeekend: false,
      },
      {
        date: "2026-06-10T03:00:00.000Z",
        key: "2026-06-10",
        tableRate: 140,
        rate: 140,
        isOverridden: false,
        kind: "LOW_SEASON",
        isWeekend: false,
      },
    ],
    hasCustomNightRates: false,
    davidTenPercent: 100,
    extrasTotal: 0,
    extraTableValue: 300,
    totalDavid: 250,
    netForDistribution: 570,
    suggestedCleaningFee: 180,
    ...over,
  };
}

/** Preview e resposta de salvamento configuráveis. */
function comRespostas(opcoes: {
  preview?: { ok?: boolean; body?: unknown };
  salvar?: { ok?: boolean; body?: unknown };
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/seasonal-rentals/preview") {
      return {
        ok: opcoes.preview?.ok ?? true,
        json: async () => opcoes.preview?.body ?? previewPadrao(),
      };
    }
    return {
      ok: opcoes.salvar?.ok ?? true,
      json: async () => opcoes.salvar?.body ?? { id: "rent-1" },
    };
  });
}

/** Preenche os campos mínimos e espera o preview aparecer. */
async function preencherEEsperarPreview() {
  const [checkIn, checkOut] = document.querySelectorAll('input[type="date"]');
  fireEvent.change(checkIn, { target: { value: "2026-06-08" } });
  fireEvent.change(checkOut, { target: { value: "2026-06-11" } });
  fireEvent.change(campoPorRotulo(/Valor líquido recebido/), {
    target: { value: "1000" },
  });
  await vi.advanceTimersByTimeAsync(300);
  await waitFor(() => expect(screen.getByText("Total David")).toBeInTheDocument());
}

/** Corpo JSON da última chamada de salvamento (POST ou PUT). */
function corpoSalvo() {
  const chamada = [...fetchMock.mock.calls]
    .reverse()
    .find((c) => c[1]?.method === "POST" && c[0] !== "/api/seasonal-rentals/preview");
  const put = [...fetchMock.mock.calls].reverse().find((c) => c[1]?.method === "PUT");
  return JSON.parse((chamada ?? put)![1].body);
}

const props = { onClose: vi.fn(), onSaved: vi.fn() };

const aluguelExistente = {
  id: "rent-1",
  platform: "BOOKING" as const,
  checkIn: "2026-06-08T03:00:00.000Z",
  checkOut: "2026-06-11T03:00:00.000Z",
  netAmountReceived: 1000,
  cleaningFee: 200,
  notes: null as string | null,
  isDavidSettled: false,
  isFamiliaSettled: false,
  isLimpezaSettled: false,
  expenses: [{ description: "Gás", amount: 60 }],
  nightRateOverrides: null,
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  props.onClose.mockClear();
  props.onSaved.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SeasonalRentalModal — criação", () => {
  it("abre com o título de novo registro e sem preview", () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    expect(screen.getByText("Novo registro de aluguel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar registro" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não busca preview enquanto faltar campo obrigatório", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    const [checkIn] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(checkIn, { target: { value: "2026-06-08" } });
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("busca o preview depois do debounce e mostra os valores", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    await preencherEEsperarPreview();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(norm(document.body.textContent)).toContain(norm("R$ 420,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 250,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 570,00"));
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("mostra os 10% do David como campo somente leitura", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    expect(campoPorRotulo("10% do David")).toHaveValue("—");
    expect(campoPorRotulo("10% do David")).toBeDisabled();

    await preencherEEsperarPreview();

    expect(norm((campoPorRotulo("10% do David") as HTMLInputElement).value)).toBe(
      norm("R$ 100,00"),
    );
  });

  it("preenche a limpeza com o valor sugerido pela API", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    await preencherEEsperarPreview();

    expect(campoPorRotulo(/Valor da limpeza/)).toHaveValue("180");
    expect(screen.getByText(/sugerido pela tabela/)).toBeInTheDocument();
  });

  it("para de sugerir a limpeza depois que o usuário edita o campo", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Valor da limpeza/), { target: { value: "250" } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(campoPorRotulo(/Valor da limpeza/)).toHaveValue("250"));
    expect(screen.queryByText(/sugerido pela tabela/)).not.toBeInTheDocument();
  });

  it("aceita vírgula decimal nos valores", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Valor líquido recebido/), {
      target: { value: "1000,50" },
    });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => {
      const ultima = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(ultima[1].body).netAmountReceived).toBe(1000.5);
    });
  });

  it("salva com POST e avisa o componente pai", async () => {
    const onSaved = vi.fn();
    comRespostas();
    render(<SeasonalRentalModal {...props} onSaved={onSaved} />);
    await preencherEEsperarPreview();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/seasonal-rentals");
    expect(chamada![1].method).toBe("POST");
    expect(JSON.parse(chamada![1].body)).toMatchObject({
      platform: "AIRBNB",
      checkIn: "2026-06-08",
      checkOut: "2026-06-11",
      netAmountReceived: 1000,
      cleaningFee: 180,
      nightRateOverrides: {},
      expenses: [],
    });
  });

  it("permite trocar a plataforma", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo("Aluguel"), { target: { value: "BOOKING" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().platform).toBe("BOOKING"));
  });

  it("não envia nada quando falta campo obrigatório", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    fireEvent.submit(document.querySelector("form")!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mostra o erro de cálculo devolvido pelo preview", async () => {
    comRespostas({
      preview: { ok: false, body: { error: "A data de saída deve ser depois da data de entrada." } },
    });
    render(<SeasonalRentalModal {...props} />);

    const [checkIn, checkOut] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(checkIn, { target: { value: "2026-06-11" } });
    fireEvent.change(checkOut, { target: { value: "2026-06-08" } });
    fireEvent.change(campoPorRotulo(/Valor líquido recebido/), { target: { value: "1000" } });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() =>
      expect(screen.getByText("A data de saída deve ser depois da data de entrada.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Salvar registro" })).toBeDisabled();
  });

  it("usa mensagem genérica quando o preview falha sem detalhe", async () => {
    comRespostas({ preview: { ok: false, body: {} } });
    render(<SeasonalRentalModal {...props} />);

    const [checkIn, checkOut] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(checkIn, { target: { value: "2026-06-08" } });
    fireEvent.change(checkOut, { target: { value: "2026-06-11" } });
    fireEvent.change(campoPorRotulo(/Valor líquido recebido/), { target: { value: "1000" } });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => expect(screen.getByText("Erro ao calcular.")).toBeInTheDocument());
  });

  it("mostra o erro devolvido ao salvar", async () => {
    comRespostas({ salvar: { ok: false, body: { error: { fieldErrors: { checkIn: ["inválido"] } } } } });
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText(/inválido/)).toBeInTheDocument());
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("usa mensagem genérica quando o salvamento falha sem detalhe", async () => {
    comRespostas({ salvar: { ok: false, body: {} } });
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Erro ao salvar o aluguel.")).toBeInTheDocument());
  });
});

describe("SeasonalRentalModal — gastos extras", () => {
  it("adiciona, edita e remove linhas de gasto", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.click(screen.getByRole("button", { name: "+ adicionar gasto" }));
    fireEvent.change(screen.getByPlaceholderText(/ex: gás/), { target: { value: "Gás" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "60" } });
    await vi.advanceTimersByTimeAsync(300);

    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() =>
      expect(corpoSalvo().expenses).toEqual([{ description: "Gás", amount: 60 }]),
    );

    fireEvent.click(screen.getByRole("button", { name: "remover" }));
    expect(screen.queryByPlaceholderText(/ex: gás/)).not.toBeInTheDocument();
  });

  it("descarta linhas de gasto incompletas ao salvar", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.click(screen.getByRole("button", { name: "+ adicionar gasto" }));
    fireEvent.change(screen.getByPlaceholderText(/ex: gás/), { target: { value: "Só descrição" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().expenses).toEqual([]));
  });

  it("os extras entram no preview", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.click(screen.getByRole("button", { name: "+ adicionar gasto" }));
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "60,50" } });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => {
      const ultima = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(ultima[1].body).extrasTotal).toBe(60.5);
    });
  });
});

describe("SeasonalRentalModal — diárias customizadas", () => {
  async function abrirListaDeDiarias() {
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();
    fireEvent.click(screen.getByRole("button", { name: /Valores das diárias/ }));
  }

  it("a lista começa recolhida e mostra a contagem de noites", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    expect(screen.getByRole("button", { name: /Valores das diárias \(3 noites\)/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Valor da diária de 08\/06\/2026/)).not.toBeInTheDocument();
  });

  it("expandir mostra uma linha por noite, com o valor da tabela", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    expect(screen.getByLabelText("Valor da diária de 08/06/2026")).toHaveValue("140");
    expect(screen.getByLabelText("Valor da diária de 10/06/2026")).toHaveValue("140");
    expect(screen.getByText(/somente deste aluguel/)).toBeInTheDocument();
  });

  it("mostra a regra da tabela e se a noite é de fim de semana", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    expect(screen.getAllByText(/Baixa temporada · dia de semana/)).toHaveLength(3);
  });

  it("mostra 'feriado' sem sufixo de dia da semana", async () => {
    comRespostas({
      preview: {
        body: previewPadrao({
          nightRates: [
            {
              date: "2026-12-25T03:00:00.000Z",
              key: "2026-12-25",
              tableRate: 350,
              rate: 350,
              isOverridden: false,
              kind: "HOLIDAY",
              isWeekend: true,
            },
          ],
        }),
      },
    });
    await abrirListaDeDiarias();

    expect(screen.getByText("Feriado")).toBeInTheDocument();
  });

  it("mostra 'alta temporada · fim de semana' quando é o caso", async () => {
    comRespostas({
      preview: {
        body: previewPadrao({
          nightRates: [
            {
              date: "2026-01-23T03:00:00.000Z",
              key: "2026-01-23",
              tableRate: 300,
              rate: 300,
              isOverridden: false,
              kind: "HIGH_SEASON",
              isWeekend: true,
            },
          ],
        }),
      },
    });
    await abrirListaDeDiarias();

    expect(screen.getByText(/Alta temporada · fim de semana/)).toBeInTheDocument();
  });

  it("customizar uma diária rebusca o preview com o override", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.change(screen.getByLabelText("Valor da diária de 09/06/2026"), {
      target: { value: "240" },
    });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => {
      const ultima = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(ultima[1].body).nightRateOverrides).toEqual({ "2026-06-09": 240 });
    });
  });

  it("mostra o contador de diárias customizadas", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.change(screen.getByLabelText("Valor da diária de 09/06/2026"), {
      target: { value: "240" },
    });

    await waitFor(() => expect(screen.getByText("1 customizada")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Valor da diária de 10/06/2026"), {
      target: { value: "250" },
    });

    await waitFor(() => expect(screen.getByText("2 customizadas")).toBeInTheDocument());
  });

  it("apagar o campo faz a noite voltar para a tabela", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    const campo = screen.getByLabelText("Valor da diária de 09/06/2026");
    fireEvent.change(campo, { target: { value: "240" } });
    await waitFor(() => expect(screen.getByText("1 customizada")).toBeInTheDocument());

    fireEvent.change(campo, { target: { value: "" } });

    await waitFor(() => expect(screen.queryByText("1 customizada")).not.toBeInTheDocument());
  });

  it("aceita vírgula decimal na diária", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.change(screen.getByLabelText("Valor da diária de 09/06/2026"), {
      target: { value: "240,50" },
    });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => {
      const ultima = fetchMock.mock.calls.at(-1)!;
      expect(JSON.parse(ultima[1].body).nightRateOverrides).toEqual({ "2026-06-09": 240.5 });
    });
  });

  it("ignora diária negativa", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.change(screen.getByLabelText("Valor da diária de 09/06/2026"), {
      target: { value: "-50" },
    });

    await waitFor(() => expect(screen.queryByText("1 customizada")).not.toBeInTheDocument());
  });

  it("o botão de restaurar só fica ativo na noite customizada", async () => {
    comRespostas({
      preview: {
        body: previewPadrao({
          nightRates: [
            {
              date: "2026-06-08T03:00:00.000Z",
              key: "2026-06-08",
              tableRate: 140,
              rate: 240,
              isOverridden: true,
              kind: "LOW_SEASON",
              isWeekend: false,
            },
            {
              date: "2026-06-09T03:00:00.000Z",
              key: "2026-06-09",
              tableRate: 140,
              rate: 140,
              isOverridden: false,
              kind: "LOW_SEASON",
              isWeekend: false,
            },
          ],
        }),
      },
    });
    await abrirListaDeDiarias();

    const botoes = screen.getAllByRole("button", { name: "restaurar" });
    expect(botoes[0]).not.toBeDisabled();
    expect(botoes[1]).toBeDisabled();
    // A noite customizada mostra qual era o valor de tabela.
    expect(norm(document.body.textContent)).toContain(norm("tabela: R$ 140,00"));
  });

  it("restaurar uma noite remove só aquela customização", async () => {
    // O botão "restaurar" de cada linha só habilita quando a API marca aquela
    // noite como customizada, então o cenário abre um aluguel que já tem duas
    // diárias customizadas e um preview coerente com isso.
    const noite = (dia: string, isOverridden: boolean) => ({
      date: `2026-06-${dia}T03:00:00.000Z`,
      key: `2026-06-${dia}`,
      tableRate: 140,
      rate: isOverridden ? 240 : 140,
      isOverridden,
      kind: "LOW_SEASON" as const,
      isWeekend: false,
    });
    comRespostas({
      preview: {
        body: previewPadrao({
          hasCustomNightRates: true,
          nightRates: [noite("08", false), noite("09", true), noite("10", true)],
        }),
      },
    });

    render(
      <SeasonalRentalModal
        {...props}
        rental={{
          ...aluguelExistente,
          nightRateOverrides: { "2026-06-09": 240, "2026-06-10": 250 },
        }}
      />,
    );
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => expect(screen.getByText("2 customizadas")).toBeInTheDocument());

    const restaurar = screen
      .getAllByRole("button", { name: "restaurar" })
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(restaurar).toHaveLength(2);

    fireEvent.click(restaurar[0]);

    await waitFor(() => expect(screen.getByText("1 customizada")).toBeInTheDocument());
  });

  it("restaurar tabela em todas limpa o mapa inteiro", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.change(screen.getByLabelText("Valor da diária de 09/06/2026"), {
      target: { value: "240" },
    });
    await waitFor(() => expect(screen.getByText("1 customizada")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "restaurar tabela em todas" }));

    await waitFor(() => expect(screen.queryByText("1 customizada")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "restaurar tabela em todas" })).not.toBeInTheDocument();
  });

  it("avisa no resumo quando o valor de tabela usa diárias customizadas", async () => {
    comRespostas({ preview: { body: previewPadrao({ hasCustomNightRates: true, tableValue: 520 }) } });
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    expect(screen.getByText(/com diárias customizadas/)).toBeInTheDocument();
  });

  it("recolher a lista esconde as linhas", async () => {
    comRespostas();
    await abrirListaDeDiarias();

    fireEvent.click(screen.getByRole("button", { name: /Valores das diárias/ }));

    expect(screen.queryByLabelText("Valor da diária de 08/06/2026")).not.toBeInTheDocument();
  });
});

describe("SeasonalRentalModal — edição", () => {
  it("abre pré-preenchido com os dados do aluguel", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} rental={aluguelExistente} />);

    expect(screen.getByText("Editar aluguel")).toBeInTheDocument();
    expect(campoPorRotulo("Aluguel")).toHaveValue("BOOKING");
    expect(screen.getByDisplayValue("2026-06-08")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-06-11")).toBeInTheDocument();
    expect(campoPorRotulo(/Valor líquido recebido/)).toHaveValue("1000");
    expect(campoPorRotulo(/Valor da limpeza/)).toHaveValue("200");
    expect(screen.getByDisplayValue("Gás")).toBeInTheDocument();
  });

  it("não sobrescreve a limpeza salva com o valor sugerido", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} rental={aluguelExistente} />);

    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(campoPorRotulo(/Valor da limpeza/)).toHaveValue("200"));
  });

  it("salva com PUT no id do aluguel", async () => {
    const onSaved = vi.fn();
    comRespostas();
    render(<SeasonalRentalModal {...props} onSaved={onSaved} rental={aluguelExistente} />);
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => screen.getByText("Total David"));

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const chamada = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(chamada![0]).toBe("/api/seasonal-rentals/rent-1");
    expect(JSON.parse(chamada![1].body)).toMatchObject({
      platform: "BOOKING",
      expenses: [{ description: "Gás", amount: 60 }],
    });
  });

  it("avisa quando o aluguel já teve repasse gerado", async () => {
    comRespostas();
    render(
      <SeasonalRentalModal
        {...props}
        rental={{ ...aluguelExistente, isDavidSettled: true }}
      />,
    );

    expect(screen.getByText(/já teve repasse gerado/)).toBeInTheDocument();
    expect(screen.getByText(/transação de crédito vinculada será atualizada/)).toBeInTheDocument();
  });

  it("avisa também quando só o repasse de limpeza foi fechado", async () => {
    comRespostas();
    render(
      <SeasonalRentalModal
        {...props}
        rental={{ ...aluguelExistente, isLimpezaSettled: true }}
      />,
    );

    expect(screen.getByText(/já teve repasse gerado/)).toBeInTheDocument();
  });

  it("não mostra o aviso de repasse quando nenhum foi fechado", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} rental={aluguelExistente} />);

    expect(screen.queryByText(/já teve repasse gerado/)).not.toBeInTheDocument();
  });

  it("já abre a lista de diárias expandida quando o aluguel tem customização", async () => {
    comRespostas({
      preview: {
        body: previewPadrao({
          hasCustomNightRates: true,
          nightRates: [
            {
              date: "2026-06-08T03:00:00.000Z",
              key: "2026-06-08",
              tableRate: 140,
              rate: 240,
              isOverridden: true,
              kind: "LOW_SEASON",
              isWeekend: false,
            },
          ],
        }),
      },
    });

    render(
      <SeasonalRentalModal
        {...props}
        rental={{ ...aluguelExistente, nightRateOverrides: { "2026-06-08": 240 } }}
      />,
    );
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() =>
      expect(screen.getByLabelText("Valor da diária de 08/06/2026")).toHaveValue("240"),
    );
  });

  it("mostra 'Salvando...' enquanto grava", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/seasonal-rentals/preview") {
        return { ok: true, json: async () => previewPadrao() };
      }
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => ({ id: "rent-1" }) };
    });

    render(<SeasonalRentalModal {...props} rental={aluguelExistente} />);
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => screen.getByText("Total David"));

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled());
    liberar();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeInTheDocument(),
    );
  });
});

describe("SeasonalRentalModal — fechar", () => {
  it("fecha pelo botão cancelar", async () => {
    const onClose = vi.fn();
    comRespostas();
    render(<SeasonalRentalModal {...props} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fecha ao clicar no fundo escuro", async () => {
    const onClose = vi.fn();
    comRespostas();
    const { container } = render(<SeasonalRentalModal {...props} onClose={onClose} />);

    fireEvent.click(container.firstElementChild!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicar dentro do formulário não fecha", async () => {
    const onClose = vi.fn();
    comRespostas();
    render(<SeasonalRentalModal {...props} onClose={onClose} />);

    fireEvent.click(screen.getByText("Novo registro de aluguel"));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SeasonalRentalModal — casos de borda", () => {
  it("não quebra quando o cálculo do preview falha na rede", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/seasonal-rentals/preview") throw new Error("network down");
      return { ok: true, json: async () => ({ id: "rent-1" }) };
    });

    render(<SeasonalRentalModal {...props} />);

    const [checkIn, checkOut] = document.querySelectorAll('input[type="date"]');
    fireEvent.change(checkIn, { target: { value: "2026-06-08" } });
    fireEvent.change(checkOut, { target: { value: "2026-06-11" } });
    fireEvent.change(campoPorRotulo(/Valor líquido recebido/), { target: { value: "1000" } });
    await vi.advanceTimersByTimeAsync(300);

    // Sem preview o botão continua travado, mas a tela não quebra.
    expect(screen.getByRole("button", { name: "Salvar registro" })).toBeDisabled();
    expect(screen.getByText("Novo registro de aluguel")).toBeInTheDocument();
  });

  it("editar um gasto extra não altera as outras linhas", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.click(screen.getByRole("button", { name: "+ adicionar gasto" }));
    fireEvent.click(screen.getByRole("button", { name: "+ adicionar gasto" }));

    const descricoes = screen.getAllByPlaceholderText(/ex: gás/);
    const valores = screen.getAllByPlaceholderText("0,00");
    fireEvent.change(descricoes[0], { target: { value: "Gás" } });
    fireEvent.change(valores[0], { target: { value: "60" } });
    fireEvent.change(descricoes[1], { target: { value: "Faxina" } });
    fireEvent.change(valores[1], { target: { value: "40" } });

    expect(descricoes[0]).toHaveValue("Gás");
    expect(descricoes[1]).toHaveValue("Faxina");

    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() =>
      expect(corpoSalvo().expenses).toEqual([
        { description: "Gás", amount: 60 },
        { description: "Faxina", amount: 40 },
      ]),
    );
  });

  it("limpar o campo de limpeza salva zero", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Valor da limpeza/), { target: { value: "" } });
    await vi.advanceTimersByTimeAsync(300);

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().cleaningFee).toBe(0));
  });
});

/**
 * A nota é observação livre sobre a estadia (`SeasonalRental.notes`). É o único
 * campo de texto do formulário, e o único que não entra em nenhum cálculo — o
 * que importa aqui é ida e volta do valor e a normalização de "sem nota".
 */
describe("SeasonalRentalModal — nota da estadia", () => {
  it("começa vazia em um novo aluguel", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);

    expect(campoPorRotulo(/Nota sobre a estadia/)).toHaveValue("");
  });

  it("envia a nota digitada ao salvar", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Nota sobre a estadia/), {
      target: { value: "Hóspede pediu check-out mais tarde." },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().notes).toBe("Hóspede pediu check-out mais tarde."));
  });

  it("preserva as quebras de linha da observação", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Nota sobre a estadia/), {
      target: { value: "Linha 1\nLinha 2" },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().notes).toBe("Linha 1\nLinha 2"));
  });

  it("nota em branco é salva como null (e não como string vazia)", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().notes).toBeNull());
  });

  it("nota só com espaços também vira null", async () => {
    comRespostas();
    render(<SeasonalRentalModal {...props} />);
    await preencherEEsperarPreview();

    fireEvent.change(campoPorRotulo(/Nota sobre a estadia/), { target: { value: "   " } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().notes).toBeNull());
  });

  it("abre pré-preenchida com a nota salva na edição", async () => {
    comRespostas();
    render(
      <SeasonalRentalModal {...props} rental={{ ...aluguelExistente, notes: "Quebrou uma taça." }} />,
    );

    expect(campoPorRotulo(/Nota sobre a estadia/)).toHaveValue("Quebrou uma taça.");
  });

  it("apagar a nota de um aluguel que tinha uma salva envia null", async () => {
    comRespostas();
    render(
      <SeasonalRentalModal {...props} rental={{ ...aluguelExistente, notes: "Nota antiga" }} />,
    );
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => screen.getByText("Total David"));

    fireEvent.change(campoPorRotulo(/Nota sobre a estadia/), { target: { value: "" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(corpoSalvo().notes).toBeNull());
  });

  it("a nota é sempre opcional (nunca bloqueia o envio)", async () => {
    const onSaved = vi.fn();
    comRespostas();
    render(<SeasonalRentalModal {...props} onSaved={onSaved} />);
    await preencherEEsperarPreview();

    expect(campoPorRotulo(/Nota sobre a estadia/)).not.toBeRequired();

    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
