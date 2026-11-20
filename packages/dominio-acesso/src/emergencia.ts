// Quebra de vidro (ficha do M06, regra 8; cap-08 §8.5): só perfil assistencial com conselho; aviso, motivo
// de lista, justificativa curta obrigatória, reautenticação recente, prazo configurável, alerta ao Auditor
// e revisão obrigatória (só inclusão: a revisão é uma linha nova). Puro: a API grava em
// SGH_ACESSO_EMERGENCIA e na trilha, e manda o alerta pela fila `email`.

export const MOTIVOS_EMERGENCIA = {
  'intercorrencia-outro-setor': 'Intercorrência com paciente de outro setor',
  'parada-cardiorrespiratoria': 'Parada cardiorrespiratória ou atendimento de urgência',
  'interconsulta-sem-registro': 'Interconsulta ainda não registrada no sistema',
  'transferencia-em-andamento': 'Transferência em andamento',
  outro: 'Outro (descrever na justificativa)',
} as const;
export type MotivoEmergencia = keyof typeof MOTIVOS_EMERGENCIA;

/** Justificativa: 15 a 500 caracteres (o validador CP1252 é o do contrato). */
export const JUSTIFICATIVA_MIN = 15;
export const JUSTIFICATIVA_MAX = 500;
/** Prazo padrão do acesso (minutos) e o teto configurável. */
export const PRAZO_PADRAO_MINUTOS = 60;
export const PRAZO_MAXIMO_MINUTOS = 12 * 60;
/** Reautenticação exigida na janela das operações críticas (5 min, SBIS-07). */
export const JANELA_REAUTENTICACAO_MS = 5 * 60_000;

export type RecusaEmergencia =
  | 'sem-permissao'
  | 'sem-conselho'
  | 'motivo-invalido'
  | 'justificativa-curta'
  | 'justificativa-longa'
  | 'reautenticacao-necessaria';

export interface PedidoEmergencia {
  readonly permissoes: ReadonlySet<string>;
  readonly temConselho: boolean;
  readonly motivo: string;
  readonly justificativa: string;
  readonly reautenticadoEm: number | null;
  readonly agora: number;
}

/** Confere o pedido; null quando pode abrir. */
export function recusaDaEmergencia(p: PedidoEmergencia): RecusaEmergencia | null {
  if (!p.permissoes.has('acesso.emergencia.solicitar')) return 'sem-permissao';
  if (!p.temConselho) return 'sem-conselho';
  if (!(p.motivo in MOTIVOS_EMERGENCIA)) return 'motivo-invalido';
  const j = p.justificativa.trim();
  if (j.length < JUSTIFICATIVA_MIN) return 'justificativa-curta';
  if (j.length > JUSTIFICATIVA_MAX) return 'justificativa-longa';
  if (p.reautenticadoEm === null || p.agora - p.reautenticadoEm > JANELA_REAUTENTICACAO_MS)
    return 'reautenticacao-necessaria';
  return null;
}

/** Prazo efetivo (minutos) dentro do teto; inválido volta ao padrão. */
export function prazoEmergencia(configurado: number | null | undefined): number {
  if (!configurado || !Number.isInteger(configurado) || configurado <= 0) return PRAZO_PADRAO_MINUTOS;
  return Math.min(configurado, PRAZO_MAXIMO_MINUTOS);
}

export function fimDaEmergencia(inicio: Date, minutos: number): Date {
  return new Date(inicio.getTime() + minutos * 60_000);
}

export function emergenciaVigente(fim: Date, agora: Date): boolean {
  return agora.getTime() < fim.getTime();
}

export type ClassificacaoRevisao = 'justificado' | 'nao-justificado';

/** A revisão é obrigatória e não é feita por quem pediu o acesso. */
export function recusaDaRevisao(
  revisor: { login: string; permissoes: ReadonlySet<string> },
  solicitante: string,
): 'sem-permissao' | 'revisor-e-solicitante' | null {
  if (!revisor.permissoes.has('acesso.emergencia.revisar')) return 'sem-permissao';
  if (revisor.login === solicitante) return 'revisor-e-solicitante';
  return null;
}
