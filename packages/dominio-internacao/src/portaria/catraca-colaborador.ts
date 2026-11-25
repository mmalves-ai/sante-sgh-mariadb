// A passagem do crachá do colaborador na catraca (08-INTG L141): o crachá fica ligado à matrícula (vínculo de
// trabalho) e a liberação segue as regras de acesso do terminal, por perfil, setor, dias da semana, faixa horária,
// vigência e sentido. Sem regra para colaborador no terminal, a passagem é recusada (acesso negado por padrão, como
// pede a NR-32 nas áreas restritas). A recusa leva o motivo e a regra de maior prioridade que mais se aproximou. Regra
// pura: nada lê nem grava.
import type { ResultadoCatraca, SentidoCatraca, SentidoTerminal } from '@sgh/contratos';

export type MotivoCatracaColaborador =
  | 'terminal-inativo'
  | 'sentido-do-terminal'
  | 'colaborador-inativo'
  | 'sem-regra'
  | 'fora-da-vigencia'
  | 'perfil-nao-permitido'
  | 'setor-nao-permitido'
  | 'fora-do-dia'
  | 'fora-do-horario'
  | 'sentido-nao-permitido';

export interface RegraAcessoParaAvaliar {
  readonly id: number;
  /** O perfil de acesso exigido (null: qualquer perfil). */
  readonly perfil: number | null;
  /** O setor de lotação exigido (null: qualquer setor). */
  readonly setor: number | null;
  /** Dias permitidos, 1 (domingo) a 7 (sábado). */
  readonly diasSemana: readonly number[];
  /** HH:MM. Início igual ao fim: o dia inteiro; fim menor que o início: a faixa atravessa a meia-noite. */
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly entrada: boolean;
  readonly saida: boolean;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly prioridade: number;
  readonly ativo: boolean;
}

export interface ColaboradorParaAvaliar {
  readonly id: number;
  /** Vínculo ativo, sem desligamento até a data da passagem. */
  readonly ativo: boolean;
  /** Os perfis de acesso vigentes do usuário do colaborador no estabelecimento. */
  readonly perfis: readonly number[];
  /** Os setores do vínculo e das lotações vigentes. */
  readonly setores: readonly number[];
}

export interface AvaliacaoCatracaColaborador {
  readonly resultado: ResultadoCatraca;
  readonly motivo: MotivoCatracaColaborador | null;
  /** A regra que liberou ou, na recusa, a regra de maior prioridade que mais se aproximou. */
  readonly regra: number | null;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Dia da semana de AAAA-MM-DD: 1 (domingo) a 7 (sábado). */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 1;
}

/** A data anterior a AAAA-MM-DD. */
function diaAnterior(data: string): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** O primeiro critério que a regra não atende, ou null quando ela libera a passagem. */
function falhaDaRegra(
  r: RegraAcessoParaAvaliar,
  c: ColaboradorParaAvaliar,
  data: string,
  hora: string,
  sentido: SentidoCatraca,
): MotivoCatracaColaborador | null {
  if (data < r.vigenciaInicio || (r.vigenciaFim !== null && data > r.vigenciaFim)) return 'fora-da-vigencia';
  if (r.perfil !== null && !c.perfis.includes(r.perfil)) return 'perfil-nao-permitido';
  if (r.setor !== null && !c.setores.includes(r.setor)) return 'setor-nao-permitido';
  // Na faixa que atravessa a meia-noite, a madrugada pertence ao turno do dia anterior.
  const vira = r.horaFim < r.horaInicio;
  const madrugada = vira && hora < r.horaFim;
  const diaDoTurno = diaDaSemana(madrugada ? diaAnterior(data) : data);
  if (!r.diasSemana.includes(diaDoTurno)) return 'fora-do-dia';
  const diaInteiro = r.horaInicio === r.horaFim;
  const dentro =
    diaInteiro ||
    (vira ? hora >= r.horaInicio || hora < r.horaFim : hora >= r.horaInicio && hora < r.horaFim);
  if (!dentro) return 'fora-do-horario';
  if (sentido === 'entrada' ? !r.entrada : !r.saida) return 'sentido-nao-permitido';
  return null;
}

/** A passagem do crachá do colaborador (`agora`: AAAA-MM-DDTHH:mm, hora local do estabelecimento). */
export function avaliarColaboradorNaCatraca(e: {
  readonly colaborador: ColaboradorParaAvaliar;
  readonly regras: readonly RegraAcessoParaAvaliar[];
  readonly agora: string;
  readonly sentido: SentidoCatraca;
  readonly terminal: { readonly ativo: boolean; readonly sentido: SentidoTerminal };
}): AvaliacaoCatracaColaborador {
  const negar = (
    motivo: MotivoCatracaColaborador,
    regra: number | null = null,
  ): AvaliacaoCatracaColaborador => ({
    resultado: 'negado',
    motivo,
    regra,
  });
  if (!e.terminal.ativo) return negar('terminal-inativo');
  if (e.terminal.sentido !== 'ambos' && e.terminal.sentido !== e.sentido) return negar('sentido-do-terminal');
  if (!e.colaborador.ativo) return negar('colaborador-inativo');
  const data = e.agora.slice(0, 10);
  const hora = e.agora.slice(11, 16);
  const candidatas = e.regras
    .filter((r) => r.ativo)
    .slice()
    .sort((a, b) => b.prioridade - a.prioridade || a.id - b.id);
  if (candidatas.length === 0) return negar('sem-regra');
  let primeira: { motivo: MotivoCatracaColaborador; regra: number } | null = null;
  for (const r of candidatas) {
    const falha = falhaDaRegra(r, e.colaborador, data, hora, e.sentido);
    if (falha === null) return { resultado: 'liberado', motivo: null, regra: r.id };
    primeira ??= { motivo: falha, regra: r.id };
  }
  return negar(primeira!.motivo, primeira!.regra);
}

/** Conferência da regra antes de gravar: a lista dos problemas (vazia quando a regra está certa). */
export function conferirRegraAcesso(r: {
  readonly diasSemana: readonly number[];
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly entrada: boolean;
  readonly saida: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}): { campo: string; mensagem: string }[] {
  const erros: { campo: string; mensagem: string }[] = [];
  if (r.diasSemana.length === 0 || r.diasSemana.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
    erros.push({ campo: 'diasSemana', mensagem: 'Marque ao menos um dia da semana.' });
  if (!HORA.test(r.horaInicio)) erros.push({ campo: 'horaInicio', mensagem: 'Hora de início inválida.' });
  if (!HORA.test(r.horaFim)) erros.push({ campo: 'horaFim', mensagem: 'Hora de fim inválida.' });
  if (!r.entrada && !r.saida)
    erros.push({ campo: 'entrada', mensagem: 'A regra precisa permitir a entrada, a saída ou as duas.' });
  if (!DATA.test(r.vigenciaInicio))
    erros.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  else if (r.vigenciaFim !== null && r.vigenciaFim < r.vigenciaInicio)
    erros.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  return erros;
}
