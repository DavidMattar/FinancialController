import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DateRangePicker from "@/components/DateRangePicker";

/** Relógio fixo: os atalhos de período são calculados a partir de `new Date()`. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

const periodo = { from: "2026-08-01", to: "2026-08-31" };

describe("DateRangePicker", () => {
  it("mostra os dois campos de data com os valores atuais", () => {
    render(<DateRangePicker value={periodo} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue("2026-08-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-08-31")).toBeInTheDocument();
  });

  it("mostra os quatro atalhos de período", () => {
    render(<DateRangePicker value={periodo} onChange={vi.fn()} />);

    for (const label of ["Este mês", "Mês passado", "Últimos 3 meses", "Este ano"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("o atalho 'Este mês' devolve o mês corrente inteiro", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Este mês" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("o atalho 'Mês passado' devolve o mês anterior inteiro", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("o atalho 'Últimos 3 meses' inclui o mês corrente", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Últimos 3 meses" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-08-31" });
  });

  it("o atalho 'Este ano' devolve o ano inteiro", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Este ano" }));

    expect(onChange).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("editar a data inicial preserva a final", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue("2026-08-01"), {
      target: { value: "2026-08-10" },
    });

    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-10", to: "2026-08-31" });
  });

  it("editar a data final preserva a inicial", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={periodo} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue("2026-08-31"), {
      target: { value: "2026-08-20" },
    });

    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-20" });
  });
});
