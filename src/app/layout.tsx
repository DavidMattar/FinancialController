/**
 * Layout raiz do Next.js (App Router): envolve TODAS as páginas do app.
 * Aqui ficam coisas que devem existir em qualquer tela: as fontes, a barra
 * de navegação (`Nav`), o script que decide tema claro/escuro antes da
 * página renderizar, e o container central que dá a largura máxima ao
 * conteúdo.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Controle Financeiro",
  description: "Controle financeiro pessoal local",
};

// Script inline injetado direto no <head>, executado ANTES do React
// hidratar a página. Por quê: se a gente só aplicasse o tema depois do
// React montar, o usuário veria um "flash" da tela clara antes de trocar
// para escura. Rodando aqui, a classe "dark" já está no <html> no primeiro
// paint. Lê a preferência salva (localStorage) ou, se nunca escolheu, usa
// a preferência do sistema operacional.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

/** Componente de layout raiz — recebe `children` (a página atual) e monta o HTML/body em volta. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* suppressHydrationWarning no <html> acima existe porque esse script
            muda a classe do <html> no cliente antes do React hidratar —
            sem isso o React reclamaria de uma "diferença" entre servidor e cliente. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
