// Regra 1 do M37 (cap-15 §15.3.4; matriz da tabela de conexões do outro sistema; M05): o outro sistema guarda só a
// ÚLTIMA conexão por usuário e módulo (não um histórico). O novo tira um retrato periódico (worker, a cada 15 min) e
// grava uma linha por (dia, login, módulo) em SGH_CFG_COEX_CONEXAO com a última conexão vista e se ela mudou desde o
// retrato anterior. Daí saem: "dias desde a última conexão no outro sistema" (pela última vista em qualquer módulo)
// e a série diária de pessoas com conexão nova (a queda contínua é um critério da regra 10). O novo nunca grava a
// tabela de conexões do outro sistema.

/** Uma linha da tabela de conexões do outro sistema (lida inteira; tabela pequena). */
export interface ConexaoLida {
  readonly login: string;
  readonly modulo: number;
  readonly ultima: Date;
}

/** Uma linha do retrato gravado (SGH_CFG_COEX_CONEXAO). */
export interface LinhaRetrato {
  readonly dia: string;
  readonly login: string;
  readonly modulo: number;
  readonly ultima: Date;
  /** A última conexão mudou desde o retrato anterior (houve uso do outro sistema no período). */
  readonly mudou: boolean;
}

const chave = (login: string, modulo: number) => `${login.trim().toUpperCase()}|${modulo}`;

/** Dia civil (AAAA-MM-DD) de uma data, no fuso informado (o do estabelecimento; padrão America/Sao_Paulo). */
export function diaCivilDe(d: Date, fuso = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * O retrato do dia: cada conexão lida vira uma linha; `mudou` quando a última conexão é mais nova que a do retrato
 * anterior (ou quando o par não estava no retrato anterior e a conexão é do próprio dia). Linhas repetidas do mesmo
 * par (não deveria haver) ficam com a mais nova.
 */
export function retratoDoDia(
  dia: string,
  lidas: readonly ConexaoLida[],
  anterior: readonly Pick<LinhaRetrato, 'login' | 'modulo' | 'ultima'>[],
  fuso = 'America/Sao_Paulo',
): LinhaRetrato[] {
  const antes = new Map<string, Date>();
  for (const a of anterior) {
    const k = chave(a.login, a.modulo);
    const atual = antes.get(k);
    if (!atual || a.ultima > atual) antes.set(k, a.ultima);
  }
  const porPar = new Map<string, ConexaoLida>();
  for (const l of lidas) {
    const k = chave(l.login, l.modulo);
    const x = porPar.get(k);
    if (!x || l.ultima > x.ultima) porPar.set(k, l);
  }
  return [...porPar.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, l]) => {
      const a = antes.get(k);
      const mudou = a ? l.ultima.getTime() > a.getTime() : diaCivilDe(l.ultima, fuso) === dia;
      return { dia, login: l.login.trim(), modulo: l.modulo, ultima: l.ultima, mudou };
    });
}

/** Dias inteiros entre a última conexão (qualquer módulo) e hoje; null quando a pessoa nunca conectou. */
export function diasDesdeUltimaConexao(
  ultimas: readonly Date[],
  hoje: string,
  fuso = 'America/Sao_Paulo',
): number | null {
  if (ultimas.length === 0) return null;
  const maior = ultimas.reduce((m, d) => (d > m ? d : m));
  const dia = diaCivilDe(maior, fuso);
  const ms = Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Pessoas distintas com conexão nova no outro sistema, por dia (a série da regra 10), em ordem de dia. */
export function seriePessoasPorDia(
  retratos: readonly LinhaRetrato[],
  logins?: ReadonlySet<string>,
): { dia: string; pessoas: number }[] {
  const porDia = new Map<string, Set<string>>();
  for (const r of retratos) {
    if (!r.mudou) continue;
    const login = r.login.trim().toUpperCase();
    if (logins && !logins.has(login)) continue;
    const s = porDia.get(r.dia) ?? new Set<string>();
    s.add(login);
    porDia.set(r.dia, s);
  }
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, s]) => ({ dia, pessoas: s.size }));
}

/**
 * Queda contínua (regra 10): na janela, cada semana tem menos pessoas conectadas no outro sistema que a anterior,
 * medida pela média diária (o ruído de um dia não quebra a tendência). Precisa de duas semanas com medida; a última
 * semana pode chegar a zero.
 */
export function emQuedaContinua(
  serie: readonly { dia: string; pessoas: number }[],
  diasJanela: number,
): boolean {
  if (serie.length === 0) return false;
  const ultimo = serie[serie.length - 1]!.dia;
  const inicio = Date.parse(`${ultimo}T00:00:00Z`) - (diasJanela - 1) * 86_400_000;
  const janela = serie.filter((s) => Date.parse(`${s.dia}T00:00:00Z`) >= inicio);
  const semanas = new Map<number, number[]>();
  for (const s of janela) {
    const semana = Math.floor((Date.parse(`${s.dia}T00:00:00Z`) - inicio) / (7 * 86_400_000));
    semanas.set(semana, [...(semanas.get(semana) ?? []), s.pessoas]);
  }
  const medias = [...semanas.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.reduce((t, n) => t + n, 0) / v.length);
  if (medias.length < 2) return false;
  return medias.every((m, i) => i === 0 || m < medias[i - 1]!);
}
