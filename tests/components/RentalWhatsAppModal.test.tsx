import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RentalWhatsAppModal from "@/components/RentalWhatsAppModal";
import { contemTexto } from "../helpers/text";

const aluguel = {
  platform: "AIRBNB" as const,
  checkIn: "2026-06-08",
  checkOut: "2026-06-11",
  netAmountReceived: 1000,
  cleaningFee: 180,
  expenses: [{ description: "Gás", amount: 60 }],
  computed: {
    nights: 3,
    tableValue: 420,
    davidTenPercent: 100,
    extraTableValue: 300,
    totalDavid: 250,
    netForDistribution: 570,
  },
};

let escrever: ReturnType<typeof vi.fn>;

beforeEach(() => {
  escrever = vi.fn().mockResolvedValue(undefined);
  // jsdom não implementa a área de transferência.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: escrever },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RentalWhatsAppModal", () => {
  it("mostra o relatório do aluguel dentro de um campo de texto", () => {
    render(<RentalWhatsAppModal rental={aluguel} onClose={vi.fn()} />);

    expect(screen.getByText("Relatório para WhatsApp")).toBeInTheDocument();
    const texto = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(contemTexto(texto.value, "*Relatório de Aluguel de Temporada*")).toBe(true);
    expect(contemTexto(texto.value, "*Total David: R$ 250,00*")).toBe(true);
    expect(contemTexto(texto.value, "• Gás: R$ 60,00")).toBe(true);
  });

  it("o campo de texto é somente leitura", () => {
    render(<RentalWhatsAppModal rental={aluguel} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
  });

  it("copia o relatório para a área de transferência", async () => {
    render(<RentalWhatsAppModal rental={aluguel} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));

    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
    expect(contemTexto(escrever.mock.calls[0][0], "*Total David: R$ 250,00*")).toBe(true);
  });

  it("confirma a cópia e volta ao rótulo original depois de 2 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<RentalWhatsAppModal rental={aluguel} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copiado!" })).toBeInTheDocument());

    vi.advanceTimersByTime(2000);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copiar mensagem" })).toBeInTheDocument(),
    );
  });

  it("fecha pelo botão Fechar", () => {
    const onClose = vi.fn();
    render(<RentalWhatsAppModal rental={aluguel} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fecha ao clicar no fundo escuro", () => {
    const onClose = vi.fn();
    const { container } = render(<RentalWhatsAppModal rental={aluguel} onClose={onClose} />);

    fireEvent.click(container.firstElementChild!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicar dentro do modal não fecha", () => {
    const onClose = vi.fn();
    render(<RentalWhatsAppModal rental={aluguel} onClose={onClose} />);

    fireEvent.click(screen.getByText("Relatório para WhatsApp"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("usa o rótulo Booking quando é o caso", () => {
    render(<RentalWhatsAppModal rental={{ ...aluguel, platform: "BOOKING" }} onClose={vi.fn()} />);

    const texto = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(texto.value).toContain("*Booking*");
  });

  it("omite a seção de gastos extras quando não há nenhum", () => {
    render(<RentalWhatsAppModal rental={{ ...aluguel, expenses: [] }} onClose={vi.fn()} />);

    const texto = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(texto.value).not.toContain("Gastos extras");
  });
});
