// Regra 7 do M37 (cap-14 §14.9.1 e §14.9.2): prazos do chamado por severidade — S1 (15 min de resposta, contorno
// imediato pelo outro sistema, 24 × 7), S2 (1 h e 8 h), S3 (1 dia útil), S4 (2 dias úteis) —, como parâmetros em
// SGH_CFG_PARAMETRO (propostos e aprovados pela diretoria antes da primeira liberação). S1 e S2 contam em minutos
// corridos; S3 e S4 em dias úteis (segunda a sexta, sem os feriados informados), no mesmo horário do dia. S1 tem
// comandante e atualização a cada 30 minutos; incidente com dado pessoal aciona o encarregado.
import type { SeveridadeChamado } from '@sgh/contratos';

export interface PrazoSeveridade {
  readonly severidade: SeveridadeChamado;
  readonly resposta: number;
  readonly contorno: number;
  /** true: `resposta` e `contorno` em dias úteis; false: em minutos corridos. */
  readonly diaUtil: boolean;
}

/** Os prazos propostos (os padrões dos parâmetros; a diretoria aprova). */
export const PRAZOS_PROPOSTOS: readonly PrazoSeveridade[] = [
  { severidade: 'S1', resposta: 15, contorno: 60, diaUtil: false },
  { severidade: 'S2', resposta: 60, contorno: 480, diaUtil: false },
  { severidade: 'S3', resposta: 1, contorno: 10, diaUtil: true },
  { severidade: 'S4', resposta: 2, contorno: 30, diaUtil: true },
];

/** Atualização do S1 para a diretoria (cap-14 §14.9.2). */
export const INTERVALO_ATUALIZACAO_S1_MIN = 30;

const DIA = 86_400_000;

/** O dia da semana no fuso (0 = domingo) e o dia civil. */
function partes(d: Date, fuso: string): { semana: number; dia: string } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p['weekday'] ?? '');
  return { semana, dia: `${p['year']}-${p['month']}-${p['day']}` };
}

/** É dia útil (segunda a sexta, fora dos feriados AAAA-MM-DD)? */
export function diaUtil(
  d: Date,
  feriados: ReadonlySet<string> = new Set(),
  fuso = 'America/Sao_Paulo',
): boolean {
  const p = partes(d, fuso);
  return p.semana >= 1 && p.semana <= 5 && !feriados.has(p.dia);
}

/**
 * Soma `n` dias úteis a partir de `inicio`, no mesmo horário: aberto num dia não útil, a contagem começa no próximo
 * dia útil (às 08:00 do fuso, o início do horário comercial).
 */
export function somarDiasUteis(
  inicio: Date,
  n: number,
  feriados: ReadonlySet<string> = new Set(),
  fuso = 'America/Sao_Paulo',
): Date {
  let atual = new Date(inicio.getTime());
  if (!diaUtil(atual, feriados, fuso)) {
    do atual = new Date(atual.getTime() + DIA);
    while (!diaUtil(atual, feriados, fuso));
    const { dia } = partes(atual, fuso);
    // 08:00 no fuso: o deslocamento do fuso no dia (sem horário de verão desde 2019 no Brasil, mas calculado).
    const meiaNoiteUtc = Date.parse(`${dia}T08:00:00Z`);
    const desloc = deslocamentoMin(new Date(meiaNoiteUtc), fuso);
    atual = new Date(meiaNoiteUtc - desloc * 60_000);
  }
  let restantes = Math.max(0, Math.trunc(n));
  while (restantes > 0) {
    atual = new Date(atual.getTime() + DIA);
    if (diaUtil(atual, feriados, fuso)) restantes--;
  }
  return atual;
}

/** Deslocamento do fuso em minutos (UTC−3 → −180). */
function deslocamentoMin(d: Date, fuso: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'shortOffset' });
  const nome = f.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(nome);
  if (!m) return 0;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

/** Os prazos de resposta e de contorno do chamado aberto em `abertoEm`. */
export function prazosDoChamado(
  severidade: SeveridadeChamado,
  abertoEm: Date,
  prazos: readonly PrazoSeveridade[] = PRAZOS_PROPOSTOS,
  feriados: ReadonlySet<string> = new Set(),
  fuso = 'America/Sao_Paulo',
): { resposta: Date; contorno: Date } {
  const p = prazos.find((x) => x.severidade === severidade);
  if (!p) throw new Error(`Severidade sem prazo: ${severidade}`);
  if (p.diaUtil)
    return {
      resposta: somarDiasUteis(abertoEm, p.resposta, feriados, fuso),
      contorno: somarDiasUteis(abertoEm, p.contorno, feriados, fuso),
    };
  return {
    resposta: new Date(abertoEm.getTime() + p.resposta * 60_000),
    contorno: new Date(abertoEm.getTime() + p.contorno * 60_000),
  };
}

/** O chamado venceu? Antes da primeira resposta, vale o prazo de resposta; depois, o de contorno. */
export function chamadoVencido(
  c: { situacao: string; prazoResposta: Date; prazoContorno: Date; respondidoEm: Date | null },
  agora: Date,
): boolean {
  if (c.situacao === 'resolvido' || c.situacao === 'cancelado' || c.situacao === 'contornado') return false;
  return c.respondidoEm === null ? agora > c.prazoResposta : agora > c.prazoContorno;
}

/** S1 em aberto: a próxima atualização devida (a cada 30 min desde a última atualização ou da abertura). */
export function proximaAtualizacaoS1(c: {
  severidade: SeveridadeChamado;
  situacao: string;
  abertoEm: Date;
  atualizadoEm: Date | null;
}): Date | null {
  if (c.severidade !== 'S1' || c.situacao === 'resolvido' || c.situacao === 'cancelado') return null;
  const base = c.atualizadoEm ?? c.abertoEm;
  return new Date(base.getTime() + INTERVALO_ATUALIZACAO_S1_MIN * 60_000);
}

/** Confere a triagem: S1 fora de "aberto" exige comandante (o banco também recusa: SGH_CK_CHAMADO_S1). */
export function conferirTriagem(t: {
  severidade: SeveridadeChamado;
  situacao: string;
  comandante: string | null;
}): null | string {
  if (t.severidade === 'S1' && t.situacao !== 'aberto' && !t.comandante?.trim())
    return 'Chamado S1 precisa de comandante designado.';
  return null;
}
