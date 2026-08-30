import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SummaryCards from "@/components/SummaryCards";
import { normalizarEspacos as norm } from "../helpers/text";


describe("SummaryCards", () => {
  it("mostra os três cards com os rótulos esperados", () => {
    render(<SummaryCards totalExpense={1500} transactionCount={12} averageTicket={125} />);

    expect(screen.getByText("Total gasto no período")).toBeInTheDocument();
    expect(screen.getByText("Transações")).toBeInTheDocument();
    expect(screen.getByText("Ticket médio")).toBeInTheDocument();
  });

  it("formata os valores monetários em reais", () => {
    render(<SummaryCards totalExpense={1500.5} transactionCount={12} averageTicket={125.04} />);

    const textos = screen.getAllByText(/R\$/).map((el) => norm(el.textContent));
    expect(textos).toContain(norm("R$ 1.500,50"));
    expect(textos).toContain(norm("R$ 125,04"));
  });

  it("mostra a quantidade de transações como número puro (sem moeda)", () => {
    render(<SummaryCards totalExpense={0} transactionCount={42} averageTicket={0} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("lida com tudo zerado", () => {
    render(<SummaryCards totalExpense={0} transactionCount={0} averageTicket={0} />);

    expect(screen.getByText("0")).toBeInTheDocument();
    const zeros = screen.getAllByText(/R\$/).map((el) => norm(el.textContent));
    expect(zeros.filter((t) => t === norm("R$ 0,00"))).toHaveLength(2);
  });

  it("aceita valor negativo (período com mais estorno que gasto)", () => {
    render(<SummaryCards totalExpense={-50} transactionCount={1} averageTicket={-50} />);
    expect(norm(screen.getAllByText(/R\$/)[0].textContent)).toBe(norm("-R$ 50,00"));
  });
});
