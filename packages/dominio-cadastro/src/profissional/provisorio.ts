// Profissional provisório (F8, 02-CAD linha 21): quem atende antes de completar o cadastro e regulariza depois. Regras
// puras do cadastro mínimo, do prazo, dos registros ligados e da regularização. Desenho próprio:
// - o cadastro mínimo exige o conselho, o número e a UF da inscrição (o conselho profissional responde pelo ato; a UF
//   só quando o conselho inscreve por região) e o motivo; o CPF é opcional, mas, informado, tem de ser válido;
// - o prazo é curto (padrão de 15 dias, no máximo 90 a partir do início) e o vencido só gera alerta: nada é travado de
//   forma automática (ADR 0002), a decisão é do hospital, que prorroga, regulariza ou cancela;
// - a regularização liga o provisório ao cadastro definitivo e transfere os registros ligados (atendimento, agenda
//   cirúrgica e de internação); o definitivo tem de estar ativo e coincidir no CPF e na inscrição do conselho;
// - cancelar só sem registros ligados ainda não transferidos (o atendimento feito nunca fica sem dono) e com motivo.
// Nada é apagado: o provisório regularizado ou cancelado fica, com a situação e a trilha. Datas AAAA-MM-DD.
import { cpfValido, somenteDigitos } from '../documento/cpf.js';

export const PRAZO_PADRAO_DIAS = 15;
export const PRAZO_MAXIMO_DIAS = 90;
/** Dias antes do fim do prazo em que o provisório entra em alerta. */
export const DIAS_ALERTA = 3;
/** Quantos dias para trás o atendimento já feito pode ter começado. */
export const RETROATIVO_MAXIMO_DIAS = 30;

export const SITUACOES_PROVISORIO = ['provisorio', 'regularizado', 'expirado', 'cancelado'] as const;
export type SituacaoProvisorio = (typeof SITUACOES_PROVISORIO)[number];

export const TIPOS_USO_PROVISORIO = [
  'atendimento',
  'paciente',
  'agendamento_cirurgico',
  'agendamento_internacao',
] as const;
export type TipoUsoProvisorio = (typeof TIPOS_USO_PROVISORIO)[number];

/** Situações em que o provisório ainda está aberto (aceita registro, prorrogação e regularização). */
export const SITUACOES_ABERTAS: readonly SituacaoProvisorio[] = ['provisorio', 'expirado'];

export interface EntradaProvisorio {
  readonly nome: string;
  readonly cpf: string | null;
  readonly conselhoId: number | null;
  readonly numeroConselho: string | null;
  readonly ufConselhoId: number | null;
  readonly motivo: string;
  readonly dataInicio: string;
  readonly prazo: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(d: string | null | undefined): d is string {
  if (!d || !DATA.test(d)) return false;
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(d: string, dias: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + dias);
  return x.toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (negativo quando `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** O prazo sugerido a partir do início (padrão de 15 dias). */
export function prazoSugerido(dataInicio: string, dias = PRAZO_PADRAO_DIAS): string {
  return somarDias(dataInicio, dias);
}

/** O número da inscrição como se compara: só letras e dígitos, em maiúsculas e sem zeros à esquerda. */
export function normalizarNumeroConselho(n: string | null | undefined): string {
  return String(n ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^0+(?=.)/, '');
}

/**
 * Erros do cadastro mínimo (códigos estáveis; a tela e o servidor usam os mesmos). `conselhoPorUf` diz se o conselho
 * escolhido inscreve por UF (sem conselho escolhido, a UF é exigida).
 */
export function errosProvisorio(e: EntradaProvisorio, hoje: string, conselhoPorUf = true): string[] {
  const erros: string[] = [];
  const nome = e.nome.trim();
  if (nome.length < 3) erros.push('nome-curto');
  else if (nome.length > 150) erros.push('nome-longo');
  else if (!/\s/.test(nome)) erros.push('nome-incompleto');
  if (e.cpf !== null && e.cpf.trim() !== '' && !cpfValido(somenteDigitos(e.cpf))) erros.push('cpf-invalido');
  if (e.conselhoId === null) erros.push('conselho-ausente');
  const numero = normalizarNumeroConselho(e.numeroConselho);
  if (!numero) erros.push('numero-conselho-ausente');
  else if (numero.length > 20) erros.push('numero-conselho-longo');
  if (e.ufConselhoId === null && conselhoPorUf) erros.push('uf-conselho-ausente');
  const motivo = e.motivo.trim();
  if (motivo.length < 10) erros.push('motivo-curto');
  else if (motivo.length > 500) erros.push('motivo-longo');
  if (!dataValida(e.dataInicio)) erros.push('inicio-invalido');
  else {
    if (e.dataInicio > hoje) erros.push('inicio-futuro');
    else if (diasEntre(e.dataInicio, hoje) > RETROATIVO_MAXIMO_DIAS) erros.push('inicio-antigo');
  }
  erros.push(...errosPrazo(e.dataInicio, e.prazo, null));
  return erros;
}

/** Erros de um prazo (na criação, `atual` é nulo; na prorrogação, o novo prazo vem depois do atual). */
export function errosPrazo(dataInicio: string, prazo: string, atual: string | null): string[] {
  if (!dataValida(prazo)) return ['prazo-invalido'];
  if (!dataValida(dataInicio)) return [];
  if (prazo < dataInicio) return ['prazo-antes-do-inicio'];
  if (diasEntre(dataInicio, prazo) > PRAZO_MAXIMO_DIAS) return ['prazo-longo'];
  if (atual !== null && prazo <= atual) return ['prazo-nao-prorroga'];
  return [];
}

export type EstadoPrazo = 'em_dia' | 'vence_logo' | 'vencido' | 'encerrado';

/** Como está o prazo hoje: o alerta da tela (nunca uma trava). */
export function estadoDoPrazo(
  situacao: SituacaoProvisorio,
  prazo: string,
  hoje: string,
): { estado: EstadoPrazo; dias: number } {
  const dias = diasEntre(hoje, prazo);
  if (!SITUACOES_ABERTAS.includes(situacao)) return { estado: 'encerrado', dias };
  if (situacao === 'expirado' || dias < 0) return { estado: 'vencido', dias };
  if (dias <= DIAS_ALERTA) return { estado: 'vence_logo', dias };
  return { estado: 'em_dia', dias };
}

/** Erros ao ligar um registro ao provisório. O vencido aceita (sem trava): o atendimento já aconteceu. */
export function errosUso(situacao: SituacaoProvisorio, tipo: string): string[] {
  const erros: string[] = [];
  if (!(TIPOS_USO_PROVISORIO as readonly string[]).includes(tipo)) erros.push('tipo-uso-invalido');
  if (!SITUACOES_ABERTAS.includes(situacao)) erros.push('provisorio-encerrado');
  return erros;
}

export interface ProvisorioParaRegularizar {
  readonly situacao: SituacaoProvisorio;
  readonly cpf: string | null;
  readonly conselhoId: number | null;
  readonly numeroConselho: string | null;
  readonly ufConselhoId: number | null;
}

export interface DefinitivoParaRegularizar {
  readonly situacao: string;
  readonly cpf: string | null;
  readonly inscricoes: readonly {
    readonly conselhoId: number;
    readonly ufId: number;
    readonly numero: string;
    readonly ativa: boolean;
  }[];
}

/** A inscrição do provisório existe, ativa, no definitivo (mesmo conselho, número e, quando há, UF). */
export function inscricaoCoincide(p: ProvisorioParaRegularizar, d: DefinitivoParaRegularizar): boolean {
  const numero = normalizarNumeroConselho(p.numeroConselho);
  return d.inscricoes.some(
    (i) =>
      i.ativa &&
      i.conselhoId === p.conselhoId &&
      normalizarNumeroConselho(i.numero) === numero &&
      (p.ufConselhoId === null || i.ufId === p.ufConselhoId),
  );
}

/** Erros da regularização: provisório aberto, definitivo ativo, CPF e inscrição do conselho iguais. */
export function errosRegularizacao(p: ProvisorioParaRegularizar, d: DefinitivoParaRegularizar): string[] {
  const erros: string[] = [];
  if (!SITUACOES_ABERTAS.includes(p.situacao)) erros.push('provisorio-encerrado');
  if (d.situacao !== 'ativo') erros.push('definitivo-inativo');
  const cp = p.cpf ? somenteDigitos(p.cpf) : '';
  const cd = d.cpf ? somenteDigitos(d.cpf) : '';
  if (cp && cd && cp !== cd) erros.push('cpf-diferente');
  if (p.conselhoId !== null && !inscricaoCoincide(p, d)) erros.push('inscricao-diferente');
  return erros;
}

/** Erros do cancelamento: aberto, sem registro ligado pendente e com motivo. */
export function errosCancelamento(
  situacao: SituacaoProvisorio,
  usosPendentes: number,
  motivo: string,
): string[] {
  const erros: string[] = [];
  if (!SITUACOES_ABERTAS.includes(situacao)) erros.push('provisorio-encerrado');
  if (usosPendentes > 0) erros.push('usos-pendentes');
  if (motivo.trim().length < 10) erros.push('motivo-curto');
  return erros;
}

/** A coluna do profissional que a regularização transfere em cada tipo de registro (o paciente só guarda o vínculo). */
export const COLUNA_TRANSFERIDA: Readonly<Record<TipoUsoProvisorio, string | null>> = {
  atendimento: 'profissional_id',
  paciente: null,
  agendamento_cirurgico: 'cirurgiao_profissional_id',
  agendamento_internacao: 'medico_profissional_id',
};

/** Situações em que o registro já está fechado: a transferência do profissional pede confirmação explícita. */
export const SITUACOES_REGISTRO_FECHADO: Readonly<Record<TipoUsoProvisorio, readonly string[]>> = {
  atendimento: ['encerrado', 'cancelado'],
  paciente: [],
  agendamento_cirurgico: ['realizado', 'reprovado', 'suspenso', 'cancelado'],
  agendamento_internacao: ['internado', 'cancelado', 'nao_compareceu'],
};

/** Situações da conta em que o atendimento já está faturado (o profissional já foi informado ao pagador). */
export const SITUACOES_CONTA_FATURADA: readonly string[] = ['fechada', 'faturada', 'enviada', 'paga'];

/** O registro ligado como está no momento da regularização. */
export interface RegistroParaTransferir {
  readonly tipo: TipoUsoProvisorio;
  /** Situação atual do registro (nula no vínculo com o paciente). */
  readonly situacao: string | null;
  /** Há conta do atendimento fechada, faturada, enviada ou paga. */
  readonly faturado: boolean;
  /** O profissional que está no registro agora. */
  readonly profissionalAtualId: number | null;
  /** O profissional em cujo nome o registro estava quando foi ligado ao provisório (nulo: não guardado). */
  readonly substitutoId: number | null;
}

export type PendenciaTransferencia =
  'registro-fechado' | 'registro-faturado' | 'profissional-alterado' | 'substituto-desconhecido';

/**
 * O que impede a transferência silenciosa do profissional de um registro ligado: registro já fechado, atendimento já
 * faturado, ou o profissional do registro não é mais o substituto declarado ao ligar (ou não foi guardado). Cada
 * pendência pede confirmação explícita de quem regulariza; o vínculo com o paciente não troca profissional.
 */
export function pendenciasTransferencia(r: RegistroParaTransferir): PendenciaTransferencia[] {
  if (COLUNA_TRANSFERIDA[r.tipo] === null) return [];
  const p: PendenciaTransferencia[] = [];
  if (r.situacao !== null && SITUACOES_REGISTRO_FECHADO[r.tipo].includes(r.situacao))
    p.push('registro-fechado');
  if (r.faturado) p.push('registro-faturado');
  if (r.substitutoId === null) p.push('substituto-desconhecido');
  else if (r.profissionalAtualId !== r.substitutoId) p.push('profissional-alterado');
  return p;
}

/** Erros da transferência: com pendência, só com a confirmação explícita. */
export function errosTransferencia(
  registros: readonly RegistroParaTransferir[],
  confirmado: boolean,
): string[] {
  if (confirmado) return [];
  return registros.some((r) => pendenciasTransferencia(r).length > 0) ? ['transferencia-a-confirmar'] : [];
}
