import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CategoryPieChart from "@/components/CategoryPieChart";
import MonthlyTrendChart from "@/components/MonthlyTrendChart";

/**
 * Renderização real, com o Recharts de verdade.
 *
 * O jsdom não faz layout nem mede texto, então o Recharts esconde rótulos de
 * eixo que ele acha que colidem — por isso aqui se verifica a ESTRUTURA
 * (o SVG existe, há uma barra/fatia por item, a legenda lista as categorias) e
 * não o texto de cada tick. Os formatadores de valor, que o jsdom nunca chama,
 * são testados em `chartFormatters.test.tsx`.
 */
afterEach(() => {
  document.documentElement.classList.remove("dark");
});

const fatias = [
  { name: "Supermercado", color: "#22c55e", total: 800 },
  { name: "Transporte", color: "#3b82f6", total: 300 },
];

const pontos = [
  { month: "2026-06", total: 1200 },
  { month: "2026-07", total: 1500 },
  { month: "2026-08", total: 900 },
];

describe("CategoryPieChart", () => {
  it("mostra a mensagem padrão de período vazio", () => {
    render(<CategoryPieChart data={[]} />);
    expect(screen.getByText("Sem despesas no período selecionado.")).toBeInTheDocument();
  });

  it("aceita mensagem de vazio customizada", () => {
    render(<CategoryPieChart data={[]} emptyMessage="Sem receitas no período." />);
    expect(screen.getByText("Sem receitas no período.")).toBeInTheDocument();
    expect(screen.queryByText("Sem despesas no período selecionado.")).not.toBeInTheDocument();
  });

  it("desenha o gráfico e lista as categorias na legenda", () => {
    const { container } = render(<CategoryPieChart data={fatias} />);

    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Supermercado")).toBeInTheDocument();
    expect(screen.getByText("Transporte")).toBeInTheDocument();
  });

  it("usa a cor de cada categoria nas fatias", () => {
    const { container } = render(<CategoryPieChart data={fatias} />);

    const preenchimentos = Array.from(container.querySelectorAll("path[fill]")).map((p) =>
      p.getAttribute("fill"),
    );
    expect(preenchimentos).toContain("#22c55e");
    expect(preenchimentos).toContain("#3b82f6");
  });

  it("renderiza no tema escuro (o gráfico precisa saber o tema por conta própria)", () => {
    document.documentElement.classList.add("dark");

    const { container } = render(<CategoryPieChart data={fatias} />);

    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Supermercado")).toBeInTheDocument();
  });

  it("aceita uma única categoria", () => {
    const { container } = render(<CategoryPieChart data={[fatias[0]]} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("MonthlyTrendChart", () => {
  it("mostra a mensagem de vazio quando não há dados", () => {
    render(<MonthlyTrendChart data={[]} />);
    expect(screen.getByText("Sem dados suficientes.")).toBeInTheDocument();
  });

  it("desenha uma barra por mês", () => {
    const { container } = render(<MonthlyTrendChart data={pontos} />);

    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(3);
  });

  it("desenha os eixos", () => {
    const { container } = render(<MonthlyTrendChart data={pontos} />);

    expect(container.querySelector(".recharts-xAxis")).toBeTruthy();
    expect(container.querySelector(".recharts-yAxis")).toBeTruthy();
  });

  it("renderiza no tema escuro", () => {
    document.documentElement.classList.add("dark");

    const { container } = render(<MonthlyTrendChart data={pontos} />);

    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(3);
  });

  it("aceita um único mês", () => {
    const { container } = render(<MonthlyTrendChart data={[pontos[0]]} />);
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(1);
  });
});
