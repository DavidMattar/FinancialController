// Pricing rules transcribed from "Tabela Rancho (Versão 03) 26.08.2023.pdf".
// "Valor dia mínimo" in the table is explicitly defined as the per-night rate
// (for up to 8 guests) — not a fixed package price — so any stay is priced by
// summing each night's applicable rate below.

const HIGH_SEASON_WEEKDAY_RATE = 200; // Alta temporada, night starting Mon-Thu
const HIGH_SEASON_WEEKEND_RATE = 300; // Alta temporada, night starting Fri-Sun
const LOW_SEASON_WEEKDAY_RATE = 140; // Baixa temporada, night starting Mon-Thu
const LOW_SEASON_WEEKEND_RATE = 180; // Baixa temporada, night starting Fri-Sun
const HOLIDAY_NIGHT_RATE = 350;

/** Valor fixo de limpeza sugerido por padrão (o usuário pode editar por aluguel). */
export const CLEANING_FEE_FIXED = 180; // valor fixo definido pelo usuário

/** Soma (ou subtrai, se `days` negativo) dias de uma data, sem alterar a data original. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Chave única "ano-mês-dia" para usar uma data como identificador em um `Set`/`Map`. */
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Quantidade de noites de uma estadia. Uma "noite" vai das 8h de um dia até
 * as 12h do dia seguinte (regra do próprio negócio) — por isso é contada por
 * noite (diferença de dias entre check-in e check-out), nunca por dia
 * corrido.
 */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Alta temporada: 15 de Dezembro a 15 de Fevereiro (exceto feriados, tratados
// separadamente). O limite exato do dia 15/fev é tratado como pertencente à
// alta temporada (ambiguidade do próprio documento, que lista "15" nos dois
// extremos).
function isHighSeason(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11 && day >= 15) return true;
  if (month === 0) return true;
  if (month === 1 && day <= 15) return true;
  return false;
}

/** Uma "noite de fim de semana" é a que começa sexta, sábado ou domingo. */
function isWeekendNight(date: Date): boolean {
  const dow = date.getDay();
  return dow === 5 || dow === 6 || dow === 0;
}

// Easter Sunday via the Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// National fixed-date + Easter-derived holidays only. Minas Gerais state and
// Belo Horizonte municipal holidays are NOT included — their exact dates
// weren't in the source table and guessing wrong is worse than omitting them.
function nationalHolidays(year: number): Date[] {
  const easter = easterSunday(year);
  const holidays = [
    new Date(year, 0, 1), // Confraternização Universal
    addDays(easter, -48), // Carnaval (segunda)
    addDays(easter, -47), // Carnaval (terça)
    addDays(easter, -2), // Sexta-feira Santa
    addDays(easter, 60), // Corpus Christi
    new Date(year, 3, 21), // Tiradentes
    new Date(year, 4, 1), // Dia do Trabalho
    new Date(year, 8, 7), // Independência
    new Date(year, 9, 12), // Nossa Senhora Aparecida
    new Date(year, 10, 2), // Finados
    new Date(year, 10, 15), // Proclamação da República
    new Date(year, 11, 25), // Natal
  ];
  if (year >= 2024) holidays.push(new Date(year, 10, 20)); // Consciência Negra (nacional desde 2024)
  return holidays;
}

// The table only spells out the "bridge" window for holidays landing on
// Monday, Tuesday or Thursday. For any other weekday, only the holiday's own
// calendar night is priced at the holiday rate — the table gives no rule to
// extend it further, so we don't guess one.
function holidayPricedNightKeys(year: number): Set<string> {
  const keys = new Set<string>();
  for (const h of [...nationalHolidays(year - 1), ...nationalHolidays(year), ...nationalHolidays(year + 1)]) {
    const dow = h.getDay();
    let nights: Date[];
    if (dow === 1) {
      nights = Array.from({ length: 6 }, (_, i) => addDays(h, i)); // Segunda..Sábado (saída domingo)
    } else if (dow === 2) {
      nights = Array.from({ length: 4 }, (_, i) => addDays(h, -4 + i)); // Sexta..Segunda (saída terça)
    } else if (dow === 4) {
      nights = Array.from({ length: 4 }, (_, i) => addDays(h, -1 + i)); // Quarta..Sábado (saída domingo)
    } else {
      nights = [h];
    }
    for (const n of nights) keys.add(dateKey(n));
  }
  return keys;
}

/**
 * Calcula o "valor de tabela" de uma estadia: percorre cada noite entre o
 * check-in e o check-out e soma a tarifa aplicável (feriado > alta temporada
 * > baixa temporada, sempre distinguindo dia de semana de fim de semana).
 * Este é o valor de referência usado por `computeRental` para descobrir se
 * o valor líquido recebido ficou acima ou abaixo da tabela.
 */
export function computeTableValue(checkIn: Date, checkOut: Date): number {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return 0;

  const years = new Set<number>();
  for (let i = 0; i < nights; i++) years.add(addDays(checkIn, i).getFullYear());
  const holidayKeys = new Set<string>();
  for (const y of years) for (const k of holidayPricedNightKeys(y)) holidayKeys.add(k);

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = addDays(checkIn, i);
    if (holidayKeys.has(dateKey(night))) {
      total += HOLIDAY_NIGHT_RATE;
    } else if (isHighSeason(night)) {
      total += isWeekendNight(night) ? HIGH_SEASON_WEEKEND_RATE : HIGH_SEASON_WEEKDAY_RATE;
    } else {
      total += isWeekendNight(night) ? LOW_SEASON_WEEKEND_RATE : LOW_SEASON_WEEKDAY_RATE;
    }
  }
  return total;
}

/** Valor de limpeza sugerido para preencher o formulário de novo aluguel (fixo, mas editável pelo usuário). */
export function suggestCleaningFee(): number {
  return CLEANING_FEE_FIXED;
}
