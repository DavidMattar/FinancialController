import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEFAULT_CATEGORIES = [
  { name: "Alimentação", color: "#f97316", icon: "utensils", keywords: ["RESTAURANTE", "LANCHONETE", "IFOOD", "PADARIA"], deductsFromFreeSpend: true },
  { name: "Supermercado", color: "#22c55e", icon: "shopping-cart", keywords: ["SUPERMERCADO", "MERCADO", "HORTIFRUTI", "ATACAD"] },
  { name: "Transporte", color: "#3b82f6", icon: "car", keywords: ["UBER", "99APP", "POSTO", "COMBUSTIVEL", "TRANSFACIL", "BHBUS", "ESTACIONAMENTO"] },
  { name: "Saúde", color: "#ef4444", icon: "heart-pulse", keywords: ["FARMACIA", "DROGARIA", "PAGUE MENOS", "HOSPITAL", "CLINICA", "LABORATORIO"] },
  { name: "Educação", color: "#8b5cf6", icon: "graduation-cap", keywords: ["ESCOLA", "FACULDADE", "CURSO", "UDEMY"] },
  { name: "Assinaturas e Streaming", color: "#ec4899", icon: "tv", keywords: ["NETFLIX", "SPOTIFY", "CRUNCHYROLL", "AMAZON PRIME", "GOOGLE ONE", "CHATGPT", "OPENAI", "HOSTINGER", "HBO"], deductsFromFreeSpend: true },
  { name: "Casa", color: "#0ea5e9", icon: "home", keywords: ["ALUGUEL", "CONDOMINIO", "LUZ", "AGUA", "GAS", "CEMIG", "COPASA"] },
  { name: "Vestuário", color: "#f59e0b", icon: "shirt", keywords: ["SHOPEE", "RENNER", "C&A", "ZARA", "SHEIN"], deductsFromFreeSpend: true },
  { name: "Lazer", color: "#14b8a6", icon: "party-popper", keywords: ["CINEMA", "INGRESSO", "BAR", "ACADEMIA", "WELLHUB"], deductsFromFreeSpend: true },
  {
    name: "Viagem",
    color: "#6366f1",
    icon: "plane",
    keywords: ["LATAM", "AZUL", "GOL", "HOTEL", "AIRBNB", "DECOLAR"],
    fixedSubItems: ["Comida", "Transporte", "Estadia", "Entretenimento", "Extras"],
  },
  { name: "Seguros", color: "#64748b", icon: "shield", keywords: ["SEGURO", "PORTO SEGURO", "ALLIANZ"] },
  { name: "Telefonia e Internet", color: "#84cc16", icon: "wifi", keywords: ["CLARO", "VIVO", "TIM", "OI FIBRA"] },
  { name: "Cartão e Taxas", color: "#78716c", icon: "credit-card", keywords: ["ANUIDADE", "IOF", "JUROS", "TARIFA"] },
  { name: "Salário", color: "#16a34a", icon: "wallet", kind: "INCOME" as const, keywords: ["SALARIO", "PAGAMENTO DE SALARIO"] },
  { name: "Outros", color: "#94a3b8", icon: "more-horizontal", keywords: [], deductsFromFreeSpend: true },
];

async function main() {
  for (const category of DEFAULT_CATEGORIES) {
    const fixedSubItems = "fixedSubItems" in category ? category.fixedSubItems : [];
    const deductsFromFreeSpend = "deductsFromFreeSpend" in category ? category.deductsFromFreeSpend : false;
    await prisma.category.upsert({
      where: { name: category.name },
      // Note: deductsFromFreeSpend is intentionally NOT updated here — it's a
      // user-editable toggle (Categorias page) and must survive re-seeding.
      update: { color: category.color, icon: category.icon, keywords: category.keywords, fixedSubItems },
      create: {
        name: category.name,
        color: category.color,
        icon: category.icon,
        keywords: category.keywords,
        kind: category.kind ?? "EXPENSE",
        fixedSubItems,
        deductsFromFreeSpend,
      },
    });
  }
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} categories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
