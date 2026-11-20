// Cliente das telas de escores, classificação de pacientes e índices de UTI (M45, etapa 2). As leituras vêm tipadas
// pelos contratos; as gravações levam o CSRF e a Idempotency-Key. Problem Details viram ErroApi (o código da recusa em
// `problema.codigo`).
import type {
  CalculoIndiceUti,
  CargaDaUnidade,
  EscoresDaUnidade,
  EscoresDoPaciente,
  IndicesDoPaciente,
  PendenciaProfilaxia,
  RegraEscore,
  ResultadoEscore,
  SmrDoPeriodo,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { consulta, novaChave } from './api-enfermagem.js';

const E = '/api/enfermagem';
const U = '/api/pep/uti';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('m45'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export type EscoresDoPacienteTela = EscoresDoPaciente & {
  gravacao: EscoresDaUnidade['gravacao'];
  nome: string;
  leito: string;
  reg: number;
};

export interface PacienteUti {
  readonly paciente: number;
  readonly atendimento: number;
  readonly reg: number;
  readonly nome: string;
  readonly leito: string;
  readonly apache2: {
    id: number;
    pontuacao: number;
    mortalidade: number | null;
    situacao: string;
    coletadoEm: string;
  } | null;
  readonly sofa: {
    id: number;
    pontuacao: number;
    mortalidade: number | null;
    situacao: string;
    coletadoEm: string;
  } | null;
}

export type IndicesDoPacienteTela = IndicesDoPaciente & {
  nome: string;
  leito: string;
  reg: number;
  atendimento: number;
  unidade: string;
};

// ── Escores ────────────────────────────────────────────────────────────────────────────────────
export const lerEscoresDaUnidade = (unidade: string, b?: typeof fetch) =>
  ler<EscoresDaUnidade>(`${E}/escores/unidade${consulta({ unidade })}`, b);
export const lerEscoresDoPaciente = (atendimento: number, b?: typeof fetch) =>
  ler<EscoresDoPacienteTela>(`${E}/escores/atendimentos/${atendimento}`, b);
export const lerRegrasEscore = (b?: typeof fetch) =>
  ler<{ vigentes: RegraEscore[]; publicadas: RegraEscore[]; historicas: RegraEscore[] }>(
    `${E}/escores/regras`,
    b,
  );
export const registrarAfericao = (corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoEscore>(`${E}/escores/afericao`, corpo, b);
export const registrarEscore = (corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoEscore>(`${E}/escores`, corpo, b);
export const programarReavaliacao = (corpo: unknown, b?: typeof fetch) =>
  enviar<{ id: number; mensagem: string }>(`${E}/escores/reavaliacoes`, corpo, b);
export const dispensarReavaliacao = (id: number, motivo: string, b?: typeof fetch) =>
  enviar<{ id: number; mensagem: string }>(`${E}/escores/reavaliacoes/${id}/dispensar`, { motivo }, b);
export const publicarRegraEscore = (corpo: unknown, b?: typeof fetch) =>
  enviar<{ id: number; versao: number; mensagem: string }>(`${E}/escores/regras`, corpo, b);

// ── Classificação de pacientes ─────────────────────────────────────────────────────────────────
export const lerCarga = (unidade: string, data?: string, turno?: string, b?: typeof fetch) =>
  ler<CargaDaUnidade>(`${E}/classificacao${consulta({ unidade, data, turno })}`, b);
export const classificarPaciente = (corpo: unknown, b?: typeof fetch) =>
  enviar<{
    id: number;
    total: number;
    categoria: string;
    rotuloCategoria: string;
    horas24h: number;
    mensagem: string;
  }>(`${E}/classificacao`, corpo, b);

// ── Índices de UTI ─────────────────────────────────────────────────────────────────────────────
export const lerUnidadesUti = (b?: typeof fetch) =>
  ler<{ unidade: string; nome: string; internados: number }[]>(`${U}/unidades`, b);
export const lerPacientesUti = (unidade: string, b?: typeof fetch) =>
  ler<{ unidade: string; pacientes: PacienteUti[] }>(`${U}/pacientes${consulta({ unidade })}`, b);
export const lerIndicesDoPaciente = (atendimento: number, b?: typeof fetch) =>
  ler<IndicesDoPacienteTela>(`${U}/indices/${atendimento}`, b);
export const registrarIndiceUti = (corpo: unknown, b?: typeof fetch) =>
  enviar<CalculoIndiceUti & { id: number; mensagem: string }>(`${U}/indices`, corpo, b);
export const validarIndiceUti = (id: number, senha: string, b?: typeof fetch) =>
  enviar<{ id: number; mensagem: string }>(`${U}/indices/${id}/validar`, { senha }, b);
export const lerSmr = (de: string, ate: string, b?: typeof fetch) =>
  ler<SmrDoPeriodo>(`${U}/smr${consulta({ de, ate })}`, b);

/** W0-03: o estorno (lançado errado) ou a invalidação (paciente errado) com o motivo; o original fica inativo e visível. */
export interface CorrecaoRegistro {
  readonly tipo: 'estorno' | 'invalidacao';
  readonly motivo: string;
}
export interface RespostaEstorno {
  readonly ok: true;
  readonly id: number;
  readonly alerta: 'sem-alerta' | 'encerrado' | 'mantido' | null;
  readonly escoreMantem: number | null;
  readonly mensagem: string;
}
/**
 * Revisão W0-03: as pendências de profilaxia de TEV da unidade, na leitura própria de quem prescreve (só a permissão
 * de prescrever); sem a unidade, só a lista das unidades.
 */
export interface ProfilaxiasDoPrescritor {
  readonly unidade: string | null;
  readonly agora: string | null;
  readonly pendentes: readonly PendenciaProfilaxia[];
  readonly decidir: boolean;
  readonly unidades: readonly { unidade: string; nome: string; internados: number }[];
}
export const lerProfilaxiasPendentes = (unidade: string, b?: typeof fetch) =>
  ler<ProfilaxiasDoPrescritor>(`${E}/escores/profilaxia${consulta({ unidade: unidade || undefined })}`, b);
/** W0-03, M1: a decisão do prescritor sobre a profilaxia de TEV sugerida pelo escore. */
export const decidirProfilaxia = (
  escore: number,
  c: { decisao: 'prescrita' | 'nao-prescrita'; motivo?: string },
  b?: typeof fetch,
) =>
  enviar<{ ok: true; escore: number; decisao: string; mensagem: string }>(
    `${E}/escores/${escore}/profilaxia`,
    c,
    b,
  );
/** Revisão W0-03: a correção da decisão de profilaxia pelo autor (a anulação reabre a pendência). */
export const retificarProfilaxia = (
  escore: number,
  c: { decisao: 'prescrita' | 'nao-prescrita' | 'anulada'; motivo?: string; justificativa: string },
  b?: typeof fetch,
) =>
  enviar<{ ok: true; escore: number; decisao: string; mensagem: string }>(
    `${E}/escores/${escore}/profilaxia/retificar`,
    c,
    b,
  );
export const estornarEscore = (id: number, c: CorrecaoRegistro, b?: typeof fetch) =>
  enviar<RespostaEstorno>(`${E}/escores/${id}/estornar`, c, b);
export const estornarClassificacao = (id: number, c: CorrecaoRegistro, b?: typeof fetch) =>
  enviar<RespostaEstorno>(`${E}/classificacao/${id}/estornar`, c, b);
export const estornarIndiceUti = (id: number, c: CorrecaoRegistro, b?: typeof fetch) =>
  enviar<RespostaEstorno>(`${U}/indices/${id}/estornar`, c, b);
/** W0-03: a exportação do histórico de escores (CSV), com os estornados como inativos e o motivo. */
export const exportarEscores = (atendimento: number, b?: typeof fetch) =>
  ler<{ arquivo: string; csv: string }>(`${E}/escores/atendimentos/${atendimento}/exportar`, b);
