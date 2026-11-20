// Regra 3 do M43: "sem sessão de pessoa no sistema anterior". A tabela de conexões dele guarda só a ÚLTIMA conexão
// por usuário e módulo, com data sem hora, e é carimbada por ele (o novo nunca grava nela). A medida é por dia, a
// partir dos retratos diários do M37 (login com conexão nova no dia) completados pela série diária das conexões ao
// banco (MON$ATTACHMENTS, coletor do M09) com o programa do sistema anterior vindo de estação que não é técnica.
// Contas técnicas e de contingência combinadas (ESTADO.md › Autorizações) ficam fora. Falha fechada: dia sem
// retrato ou sem série é "sem medida" e quebra a sequência (não se conta como limpo o que não se mediu).

/** O que se sabe de um dia (AAAA-MM-DD). */
export interface DiaSessoes {
  readonly dia: string;
  /** Logins com conexão nova no dia (retrato do M37); null: não houve retrato no dia. */
  readonly loginsComConexao: readonly string[] | null;
  /**
   * Maior número de conexões ao banco do programa do sistema anterior, no dia, vindas de estação que não é das
   * contas técnicas (série do M09); null: sem coleta no dia.
   */
  readonly conexoesProgramaAnterior: number | null;
}

export type SituacaoDia = 'limpo' | 'com-sessao' | 'sem-medida';

export interface DiaAvaliado {
  readonly dia: string;
  readonly situacao: SituacaoDia;
  /** Pessoas (logins fora das contas combinadas) com conexão no dia. */
  readonly pessoas: number;
}

const norm = (l: string) => l.trim().toUpperCase();

/** Situação de cada dia, fora as contas combinadas. */
export function avaliarDias(
  dias: readonly DiaSessoes[],
  contasCombinadas: ReadonlySet<string> | readonly string[],
): DiaAvaliado[] {
  const fora = new Set([...contasCombinadas].map(norm));
  return [...dias]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => {
      if (d.loginsComConexao === null || d.conexoesProgramaAnterior === null)
        return { dia: d.dia, situacao: 'sem-medida', pessoas: 0 } as const;
      const pessoas = new Set(d.loginsComConexao.map(norm).filter((l) => l && !fora.has(l))).size;
      const situacao: SituacaoDia =
        pessoas === 0 && d.conexoesProgramaAnterior === 0 ? 'limpo' : 'com-sessao';
      return { dia: d.dia, situacao, pessoas };
    });
}

const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface SequenciaSemSessao {
  /** Dias seguidos limpos terminando em `hoje` (inclusive). */
  readonly dias: number;
  /** Primeiro dia da sequência limpa atual; null sem sequência. */
  readonly desde: string | null;
  /** Dia em que a sequência atingiu `exigidos` (a data em que o item ficou verde); null se não atingiu. */
  readonly verdeDesde: string | null;
  /** Dia sem medida em que a sequência parou (o painel mostra: falta medir, não houve sessão), ou null. */
  readonly paradaSemMedida: string | null;
  /** Último dia com sessão de pessoa, ou null. */
  readonly ultimaSessao: string | null;
}

/**
 * Sequência de dias limpos até `hoje`. Um dia que não está na lista conta como sem medida. `exigidos` é 14 no
 * critério do cap-15 e 30 no conjunto do cap-14 (regras 1 e 2).
 */
export function sequenciaSemSessao(
  avaliados: readonly DiaAvaliado[],
  hoje: string,
  exigidos: number,
): SequenciaSemSessao {
  const porDia = new Map(avaliados.map((a) => [a.dia, a]));
  const primeiro = avaliados.reduce<string | null>((m, a) => (m === null || a.dia < m ? a.dia : m), null);
  let paradaSemMedida: string | null = null;
  let ultimaSessao: string | null = null;
  for (const a of avaliados) if (a.situacao === 'com-sessao' && a.dia <= hoje) ultimaSessao = a.dia;
  let dias = 0;
  let cursor = hoje;
  while (primeiro !== null && cursor >= primeiro) {
    const a = porDia.get(cursor);
    if (!a || a.situacao === 'sem-medida') {
      paradaSemMedida = cursor;
      break;
    }
    if (a.situacao === 'com-sessao') break;
    dias += 1;
    cursor = somarDias(cursor, -1);
  }
  const desde = dias > 0 ? somarDias(hoje, -(dias - 1)) : null;
  const verdeDesde = desde !== null && dias >= exigidos ? somarDias(desde, exigidos - 1) : null;
  return { dias, desde, verdeDesde, paradaSemMedida, ultimaSessao };
}
