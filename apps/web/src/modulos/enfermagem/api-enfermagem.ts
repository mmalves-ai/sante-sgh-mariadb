// Cliente das telas da enfermagem beira-leito (M25). As leituras vêm tipadas pelos contratos; as gravações levam o
// CSRF e a Idempotency-Key (uma por ato: repetir o pedido, inclusive na sincronização depois da queda de rede, não
// grava duas vezes). Problem Details viram ErroApi; o código da recusa (ex.: horario-suspenso) fica em
// `problema.codigo` e o conflito aberto em `problema.conflito`.
import type {
  ConflitoSincronizacao,
  DispositivoBeiraLeito,
  EventoHorario,
  EventoInfusaoLido,
  FaixaGlicemiaLida,
  GravacaoEnfermagem,
  HorarioEnfermagem,
  LinhaDoTempoTurno,
  News2DaAfericao,
  PacienteDaUnidade,
  PassagemPlantaoLida,
  PendenciasSugeridas,
  PropostaAprazamento,
  ResultadoChecagem,
  SinaisVitaisDoPaciente,
  AtoChecagemLido,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { ErroApi, erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from '../pep/api-registro.js';

export { novaChave };

const E = '/api/enfermagem';
export const CANAL_ENFERMAGEM = `${E}/eventos`;
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  chave: string | null,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      ...(chave ? { 'idempotency-key': chave } : {}),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export function consulta(x: Readonly<Record<string, string | number | undefined | null>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** O código da recusa do servidor (Problem Details), quando houver. */
export function codigoDaRecusa(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const c = (e.problema as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' ? c : null;
}

/** O conflito aberto pela recusa (regra 8), quando houver. */
export function conflitoDaRecusa(e: unknown): number | null {
  if (!(e instanceof ErroApi)) return null;
  const c = (e.problema as { conflito?: unknown } | null)?.conflito;
  return typeof c === 'number' ? c : null;
}

/** W1-08: a recusa do estorno da dose que já baixou estoque (o texto do servidor, com quantas baixas). */
export function estoqueBaixadoDaRecusa(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const p = (e.problema ?? {}) as { codigo?: unknown; detail?: unknown };
  return p.codigo === 'estoque-baixado' ? (typeof p.detail === 'string' ? p.detail : '') : null;
}

/** Os bloqueios e avisos dos nove certos devolvidos na recusa. */
export function noveCertosDaRecusa(e: unknown): { bloqueios: string[]; avisos: string[] } {
  if (!(e instanceof ErroApi)) return { bloqueios: [], avisos: [] };
  const p = (e.problema ?? {}) as { bloqueios?: unknown; avisos?: unknown };
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : []);
  return { bloqueios: lista(p.bloqueios), avisos: lista(p.avisos) };
}

/** Sem rede (o fetch falhou antes da resposta): o ato vai para a fila do aparelho. */
export function semRede(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ErroApi && e.status === 0);
}

export interface UnidadeEnfermagem {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}

export interface HorariosDoPaciente {
  readonly paciente: PacienteDaUnidade;
  readonly horarios: readonly HorarioEnfermagem[];
  readonly agora: string;
  readonly cacheHoras: number;
  readonly cortada?: boolean;
}

export interface PacienteDaPulseira {
  readonly atendimento: number;
  readonly paciente: number;
  readonly numero: number | null;
  readonly nome: string;
  readonly leito: string | null;
  readonly unidade: string;
}

export interface DetalheDoHorario {
  readonly horario: HorarioEnfermagem;
  readonly historico: readonly EventoHorario[];
  readonly cortado: boolean;
  readonly atos: readonly AtoChecagemLido[];
  readonly infusao: readonly EventoInfusaoLido[];
  readonly faixas: readonly FaixaGlicemiaLida[];
}

export interface RespostaAprazamento {
  readonly unidade: string;
  readonly itens: readonly PropostaAprazamento[];
  readonly gravaNoHorario: boolean;
  readonly motivo: string | null;
}

export interface RespostaPlantao {
  readonly unidade: string;
  readonly turno: LinhaDoTempoTurno['turno'];
  readonly sugestoes: PendenciasSugeridas;
  readonly passagens: readonly PassagemPlantaoLida[];
}

export interface ResultadoSincronizacao {
  readonly ok: boolean;
  readonly resultados: readonly {
    readonly chave: string;
    readonly tipo: string;
    readonly ok: boolean;
    readonly codigo: string | null;
    readonly mensagem: string;
    readonly conflito?: number;
  }[];
  readonly conflitos: number;
}

export interface Indicadores {
  readonly unidade: string;
  readonly resumo: Readonly<Record<string, number>>;
  readonly checagens: number;
  readonly semPulseira: number;
  readonly duplaChecagem: number;
  readonly semRede: number;
  readonly conflitosAbertos: number;
}

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────
export const lerGravacao = (b?: typeof fetch) => ler<GravacaoEnfermagem>(`${E}/gravacao`, b);
export const lerUnidades = (b?: typeof fetch) => ler<UnidadeEnfermagem[]>(`${E}/unidades`, b);
export const lerTurno = (unidade: string, data?: string, turno?: string, b?: typeof fetch) =>
  ler<LinhaDoTempoTurno>(`${E}/turno${consulta({ unidade, data, turno })}`, b);
export const lerHorariosDoPaciente = (atendimento: number, horas = 12, b?: typeof fetch) =>
  ler<HorariosDoPaciente>(`${E}/pacientes/${atendimento}/horarios${consulta({ horas })}`, b);
export const lerPulseira = (codigo: string, unidade?: string, b?: typeof fetch) =>
  ler<PacienteDaPulseira>(`${E}/pulseira${consulta({ codigo, unidade })}`, b);
export const lerHorario = (id: number, b?: typeof fetch) => ler<DetalheDoHorario>(`${E}/horarios/${id}`, b);
export const lerAprazamento = (unidade: string, b?: typeof fetch) =>
  ler<RespostaAprazamento>(`${E}/aprazamento${consulta({ unidade })}`, b);
export const lerConflitos = (abertos: boolean, b?: typeof fetch) =>
  ler<ConflitoSincronizacao[]>(`${E}/conflitos${consulta({ abertos: abertos ? 1 : 0 })}`, b);
export const lerSinais = (paciente: number, de?: string, ate?: string, b?: typeof fetch) =>
  ler<SinaisVitaisDoPaciente>(`${E}/pacientes/${paciente}/sinais-vitais${consulta({ de, ate })}`, b);
export const lerPlantao = (unidade: string, b?: typeof fetch) =>
  ler<RespostaPlantao>(`${E}/plantao${consulta({ unidade })}`, b);
export const lerDispositivos = (b?: typeof fetch) => ler<DispositivoBeiraLeito[]>(`${E}/dispositivos`, b);
export const lerIndicadores = (unidade: string, b?: typeof fetch) =>
  ler<Indicadores>(`${E}/indicadores${consulta({ unidade })}`, b);

// ── Gravações ──────────────────────────────────────────────────────────────────────────────────────────
export const checar = (horario: number, corpo: unknown, chave: string, b?: typeof fetch) =>
  enviar<ResultadoChecagem>(`${E}/horarios/${horario}/checar`, corpo, chave, b);
/** W1-08: o estorno grava no horário (volta a não checado) com o motivo da lista; a dose com baixa de estoque é
 * recusada (409 estoque-baixado) e só segue com a devolução registrada como pendente. */
export const estornar = (
  horario: number,
  corpo: { motivo: string; justificativa: string; devolucaoPendente?: boolean },
  chave: string,
  b?: typeof fetch,
) =>
  enviar<{
    ok: true;
    horario: number;
    situacao: 'P';
    devolucaoPendente: boolean;
    repetida: boolean;
    mensagem: string;
  }>(`${E}/horarios/${horario}/estornar`, corpo, chave, b);
export const registrarInfusao = (horario: number, corpo: unknown, chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; volumeInfundidoMl: number | null; mensagem: string }>(
    `${E}/horarios/${horario}/infusao`,
    corpo,
    chave,
    b,
  );
export const confirmarAprazamento = (itens: unknown[], chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; registrados: number; gravados: number; mensagem: string }>(
    `${E}/aprazamento`,
    { itens },
    chave,
    b,
  );
export const resolverConflito = (
  id: number,
  resolucao: string,
  observacao: string,
  chave: string,
  b?: typeof fetch,
) =>
  enviar<{ ok: true; mensagem: string }>(
    `${E}/conflitos/${id}/resolver`,
    { resolucao, observacao },
    chave,
    b,
  );
export const sincronizar = (dispositivo: string, atos: unknown[], chave: string, b?: typeof fetch) =>
  enviar<ResultadoSincronizacao>(`${E}/sincronizar`, { dispositivo, atos }, chave, b);
export const registrarSinais = (paciente: number, sinais: unknown[], chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; sinais: number[]; mensagem: string; news2?: News2DaAfericao | null }>(
    `${E}/pacientes/${paciente}/sinais-vitais`,
    { sinais },
    chave,
    b,
  );
export const retificarSinal = (
  id: number,
  paciente: number,
  corpo: unknown,
  chave: string,
  b?: typeof fetch,
) =>
  enviar<{ ok: true; mensagem: string }>(
    `${E}/sinais-vitais/${id}/retificar${consulta({ paciente })}`,
    corpo,
    chave,
    b,
  );
export const passarPlantao = (corpo: unknown, chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; passagem: number; mensagem: string }>(`${E}/plantao`, corpo, chave, b);
export const responderPlantao = (
  id: number,
  aceite: boolean,
  observacao: string | null,
  chave: string,
  b?: typeof fetch,
) => enviar<{ ok: true; mensagem: string }>(`${E}/plantao/${id}/aceite`, { aceite, observacao }, chave, b);
export const autorizarDispositivo = (corpo: unknown, chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; dispositivo: number; identificador: string; mensagem: string }>(
    `${E}/dispositivos`,
    corpo,
    chave,
    b,
  );
export const alterarDispositivo = (
  id: number,
  mudanca: { ativo?: boolean; nome?: string; unidade?: string; motivo?: string },
  chave: string,
  b?: typeof fetch,
) => enviar<{ ok: true; mensagem: string }>(`${E}/dispositivos/${id}`, mudanca, chave, b);
/** W0-03: excluir o aparelho cadastrado por engano (só sem leituras; com leituras, 409 com a contagem). */
export const excluirDispositivo = (id: number, motivo: string, chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; mensagem: string }>(`${E}/dispositivos/${id}/excluir`, { motivo }, chave, b);
/** W0-03: quem passou cancela a passagem, com o motivo, antes do aceite (409 depois). */
export const cancelarPlantao = (id: number, motivo: string, chave: string, b?: typeof fetch) =>
  enviar<{ ok: true; mensagem: string }>(`${E}/plantao/${id}/cancelar`, { motivo }, chave, b);

/**
 * M40 (regra 6): o relatório de contingência do posto em PDF/A (serviço de emissão; leitura auditada). O PDF abre numa
 * aba nova e nada fica guardado no navegador.
 */
/**
 * M40 (regra 6): o último relatório do posto (o da geração de cada hora ou o último pedido na tela), relido do armazém.
 * 404 quando ainda não há relatório do posto.
 */
export async function lerUltimaContingencia(
  unidade: string,
  buscar: typeof fetch = fetch,
): Promise<{ pdf: Blob; pacientes: number; horarios: number; geradoEm: string }> {
  const r = await buscar(`${E}/contingencia/ultima?unidade=${encodeURIComponent(unidade)}`, {
    headers: { accept: 'application/pdf' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return {
    pdf: await r.blob(),
    pacientes: Number(r.headers.get('x-sgh-pacientes') ?? 0),
    horarios: Number(r.headers.get('x-sgh-horarios') ?? 0),
    geradoEm: r.headers.get('x-sgh-gerado-em') ?? '',
  };
}

export async function gerarContingencia(
  unidade: string,
  horas: number,
  buscar: typeof fetch = fetch,
): Promise<{ pdf: Blob; pacientes: number; horarios: number }> {
  const r = await buscar(`${E}/contingencia`, {
    method: 'POST',
    headers: { accept: 'application/pdf', 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify({ unidade, horas }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return {
    pdf: await r.blob(),
    pacientes: Number(r.headers.get('x-sgh-pacientes') ?? 0),
    horarios: Number(r.headers.get('x-sgh-horarios') ?? 0),
  };
}
