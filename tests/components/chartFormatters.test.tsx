import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { normalizarEspacos as norm } from "../helpers/text";

/**
 * Os gráficos passam funções de formatação para o Recharts (`tickFormatter`,
 * `formatter` do tooltip) e cores calculadas a partir do tema (`contentStyle`).
 * O jsdom não mede texto nem dispara hover, então o Recharts real nunca chama
 * essas funções — elas ficariam sem teste justamente por serem o único trecho
 * de LÓGICA nesses componentes.
 *
 * Aqui o Recharts é substituído por dublês que só registram as props
 * recebidas; os testes então chamam os formatadores diretamente e conferem o
 * resultado. A renderização real (SVG, barras, legenda) é coberta em
 * `charts.test.tsx`.
 */
const { capturado, criarStub } = vi.hoisted(() => {
  const capturado = new Map<string, Record<string, unknown>[]>();
  const criarStub =
    (nome: string, comFilhos = true) =>
    (props: Record<string, unknown>) => {
      const lista = capturado.get(nome) ?? [];
      lista.push(props);
      capturado.set(nome, lista);
      return comFilhos ? props.children : null;
    };
  return { capturado, criarStub };
});

vi.mock("recharts", () => ({
  ResponsiveContainer: criarStub("ResponsiveContainer"),
  PieChart: criarStub("PieChart"),
  Pie: criarStub("Pie"),
  Cell: criarStub("Cell", false),
  Tooltip: criarStub("Tooltip", false),
  Legend: criarStub("Legend", false),
  BarChart: criarStub("BarChart"),
  Bar: criarStub("Bar", false),
  CartesianGrid: criarStub("CartesianGrid", false),
  XAxis: criarStub("XAxis", false),
  YAxis: criarStub("YAxis", false),
}));

import CategoryPieChart from "@/components/CategoryPieChart";
import MonthlyTrendChart from "@/components/MonthlyTrendChart";

/** Props recebidas pelo último dublê de um tipo. */
function props(nome: string): Record<string, any> {
  const lista = capturado.get(nome);
  if (!lista?.length) throw new Error(`nenhum <${nome}> renderizado`);
  return lista[lista.length - 1];
}

beforeEach(() => {
  capturado.clear();
});

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
];

describe("MonthlyTrendChart — formatadores", () => {
  it("formata o eixo de valores em milhares de reais", () => {
    render(<MonthlyTrendChart data={pontos} />);

    const formatar = props("YAxis").tickFormatter as (v: number) => string;
    expect(formatar(1200)).toBe("R$1k");
    expect(formatar(1500)).toBe("R$2k");
    expect(formatar(0)).toBe("R$0k");
    expect(formatar(25000)).toBe("R$25k");
  });

  it("formata o valor do tooltip como moeda cheia", () => {
    render(<MonthlyTrendChart data={pontos} />);

    const formatar = props("Tooltip").formatter as (v: unknown) => string;
    expect(norm(formatar(1200))).toBe(norm("R$ 1.200,00"));
    // O tooltip recebe o valor como string em alguns casos.
    expect(norm(formatar("1500.5"))).toBe(norm("R$ 1.500,50"));
  });

  it("usa cores de tema claro por padrão", () => {
    render(<MonthlyTrendChart data={pontos} />);

    expect(props("Tooltip").contentStyle).toMatchObject({
      backgroundColor: "#ffffff",
      color: "#0f172a",
    });
    expect(props("XAxis").tick.fill).toBe("#64748b");
    expect(props("CartesianGrid").stroke).toBe("#e2e8f0");
  });

  it("troca as cores no tema escuro", () => {
    document.documentElement.classList.add("dark");

    render(<MonthlyTrendChart data={pontos} />);

    expect(props("Tooltip").contentStyle).toMatchObject({
      backgroundColor: "#1e293b",
      color: "#e2e8f0",
    });
    expect(props("XAxis").tick.fill).toBe("#94a3b8");
    expect(props("CartesianGrid").stroke).toBe("#334155");
  });

  it("liga a barra ao campo de total e o eixo X ao mês", () => {
    render(<MonthlyTrendChart data={pontos} />);

    expect(props("Bar").dataKey).toBe("total");
    expect(props("XAxis").dataKey).toBe("month");
    expect(props("BarChart").data).toEqual(pontos);
  });
});

describe("CategoryPieChart — formatadores", () => {
  it("formata o valor do tooltip como moeda", () => {
    render(<CategoryPieChart data={fatias} />);

    const formatar = props("Tooltip").formatter as (v: unknown) => string;
    expect(norm(formatar(800))).toBe(norm("R$ 800,00"));
  });

  it("usa cores de tema claro por padrão", () => {
    render(<CategoryPieChart data={fatias} />);

    expect(props("Tooltip").contentStyle).toMatchObject({ backgroundColor: "#ffffff" });
    expect(props("Tooltip").labelStyle).toMatchObject({ color: "#0f172a" });
  });

  it("troca as cores no tema escuro", () => {
    document.documentElement.classList.add("dark");

    render(<CategoryPieChart data={fatias} />);

    expect(props("Tooltip").contentStyle).toMatchObject({ backgroundColor: "#1e293b" });
    expect(props("Tooltip").labelStyle).toMatchObject({ color: "#e2e8f0" });
  });

  it("liga a fatia ao total e ao nome da categoria", () => {
    render(<CategoryPieChart data={fatias} />);

    expect(props("Pie").dataKey).toBe("total");
    expect(props("Pie").nameKey).toBe("name");
    expect(props("Pie").data).toEqual(fatias);
  });

  it("cria uma célula com a cor de cada categoria", () => {
    render(<CategoryPieChart data={fatias} />);

    const cores = (capturado.get("Cell") ?? []).map((p) => p.fill);
    expect(cores).toEqual(["#22c55e", "#3b82f6"]);
  });
});
