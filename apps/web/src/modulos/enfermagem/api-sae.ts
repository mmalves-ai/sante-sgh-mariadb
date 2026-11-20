// Cliente das telas da etapa 4 do M45 (o processo de enfermagem, a prescrição de enfermagem no turno, a receita do
// enfermeiro e a vacina aplicada). As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a
// Idempotency-Key (o mesmo pedido reenviado não grava duas vezes). Problem Details viram ErroApi.
import type {
  ConsultaEnfermagemLida,
  CuidadosDoTurno,
  ExternosDoDiaVacina,
  PrescricaoEnfermeiroDoAtendimento,
  PreviaReceitaEnfermeiro,
  ResultadoReceitaEnfermeiro,
  ResultadoSae,
  ResultadoVacina,
  SaeDoPaciente,
  VacinasDoPaciente,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-enfermagem.js';

const S = '/api/enfermagem/sae';
const R = '/api/enfermagem/prescricao-medicamento';
const V = '/api/enfermagem/vacinas';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface UnidadeEnfermagem {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}
export interface PacienteInternado {
  readonly paciente: number;
  readonly atendimento: number;
  readonly numero: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
}

export interface TerminologiaEmUso {
  readonly sistema: string;
  readonly versao: string;
  readonly licenca: string;
  readonly sintetica: boolean;
  readonly diagnosticos: number;
  readonly resultados: number;
  readonly intervencoes: number;
  readonly carregar: boolean;
}

// ── SAE e cuidados ──
export const lerUnidadesSae = (b?: typeof fetch) => ler<UnidadeEnfermagem[]>(`${S}/unidades`, b);
export const lerPacientesSae = (unidade: string, b?: typeof fetch) =>
  ler<PacienteInternado[]>(`${S}/unidades/${encodeURIComponent(unidade)}/pacientes`, b);
export const lerSae = (atendimento: number, b?: typeof fetch) => ler<SaeDoPaciente>(`${S}/${atendimento}`, b);
export const lerCuidadosDoTurno = (unidade: string, b?: typeof fetch) =>
  ler<CuidadosDoTurno>(`${S}/turno?unidade=${encodeURIComponent(unidade)}`, b);
export const lerTerminologia = (b?: typeof fetch) => ler<TerminologiaEmUso>(`${S}/terminologia`, b);
export const carregarTerminologia = (corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoSae>(`${S}/terminologia`, corpo, novaChave('terminologia'), b);
export const registrarSae = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoSae>(`${S}/${atendimento}`, corpo, novaChave('sae'), b);
export const evoluirSae = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoSae>(`${S}/${atendimento}/evolucao`, corpo, novaChave('evolucao'), b);
export const prescreverCuidados = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoSae>(`${S}/${atendimento}/cuidados`, corpo, novaChave('cuidados'), b);
export const suspenderCuidado = (atendimento: number, atividade: number, motivo: string, b?: typeof fetch) =>
  enviar<ResultadoSae>(
    `${S}/${atendimento}/cuidados/${atividade}/suspensao`,
    { motivo },
    novaChave(`suspensao-${atividade}`),
    b,
  );
export const checarCuidado = (
  atendimento: number,
  atividade: number,
  corpo: {
    previsto: string;
    feita: boolean;
    motivo?: string | null;
    horaReal?: string | null;
    origemOffline?: boolean;
  },
  b?: typeof fetch,
  /** A chave do ato (a da fila sem rede, reenviada igual); sem ela, uma nova. */
  chave: string = novaChave(`cuidado-${atividade}`),
) => enviar<ResultadoSae>(`${S}/${atendimento}/cuidados/${atividade}/checagem`, corpo, chave, b);
export const estornarCuidado = (atendimento: number, checagem: number, motivo: string, b?: typeof fetch) =>
  enviar<ResultadoSae>(
    `${S}/${atendimento}/checagens/${checagem}/estorno`,
    { motivo },
    novaChave(`estorno-cuidado-${checagem}`),
    b,
  );

// ── Receita do enfermeiro ──
export const lerConsultasDeEnfermagem = (b?: typeof fetch) =>
  ler<ConsultaEnfermagemLida[]>(`${R}/consultas`, b);
export const lerPrescricaoEnfermeiro = (atendimento: number, b?: typeof fetch) =>
  ler<PrescricaoEnfermeiroDoAtendimento>(`${R}/${atendimento}`, b);
export const previaReceita = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<PreviaReceitaEnfermeiro>(`${R}/${atendimento}/previa`, corpo, novaChave('previa'), b);
export const assinarReceita = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoReceitaEnfermeiro>(`${R}/${atendimento}`, corpo, novaChave('receita'), b);
/** W0-03: suspender ou cancelar a receita, com o motivo e a senha (a original fica legível e inativa). */
export const inativarReceita = (
  atendimento: number,
  id: number,
  corpo: { tipo: 'suspensao' | 'cancelamento'; motivo: string; senha: string },
  b?: typeof fetch,
) =>
  enviar<{ ok: true; id: number; mensagem: string }>(
    `${R}/${atendimento}/receitas/${id}/inativar`,
    corpo,
    novaChave('receita-inativar'),
    b,
  );

// ── Vacinas ──
/** W0-03 (M6): uma recusa do RIA no monitor (sem dado do paciente). */
export interface RecusaRiaTela {
  readonly envio: number;
  readonly evento: 'aplicada' | 'substituida' | 'cancelada';
  readonly vacina: number | null;
  readonly versao: number;
  readonly situacao: 'pendente' | 'morto';
  readonly tentativas: number;
  readonly motivo: string;
  readonly proximaTentativaEm: string | null;
  readonly mortoEm: string | null;
  readonly criadoEm: string;
}
export const lerRecusasRia = (b?: typeof fetch) =>
  ler<{
    recusas: RecusaRiaTela[];
    conector: { ligado: boolean; motivo: string | null };
    destino: 'producao' | 'homologacao' | 'simulador';
    credencial: boolean;
  }>(`${V}/rnds/recusas`, b);
export const lerUnidadesVacina = (b?: typeof fetch) => ler<UnidadeEnfermagem[]>(`${V}/unidades`, b);
export const lerPacientesVacina = (unidade: string, b?: typeof fetch) =>
  ler<PacienteInternado[]>(`${V}/unidades/${encodeURIComponent(unidade)}/pacientes`, b);
export const lerExternosVacina = (b?: typeof fetch) => ler<ExternosDoDiaVacina>(`${V}/externos`, b);
export const lerVacinas = (atendimento: number, b?: typeof fetch) =>
  ler<VacinasDoPaciente>(`${V}/${atendimento}`, b);
export const registrarVacina = (atendimento: number, corpo: unknown, b?: typeof fetch) =>
  enviar<ResultadoVacina>(`${V}/${atendimento}`, corpo, novaChave('vacina'), b);
/** W0-03: estornar ou retificar a vacina (o RIA de cancelamento ou substituição vai à fila de saída). */
export const corrigirVacina = (
  atendimento: number,
  id: number,
  corpo: { tipo: 'estorno' | 'retificacao'; motivo: string; dados: Record<string, string | null> | null },
  b?: typeof fetch,
) =>
  enviar<{ ok: true; id: number; versao: number; mensagem: string }>(
    `${V}/${atendimento}/${id}/corrigir`,
    corpo,
    novaChave('vacina-corrigir'),
    b,
  );
export const lerRia = (atendimento: number, id: number, b?: typeof fetch) =>
  ler<{ recurso: Record<string, unknown>; valido: boolean; problemas: unknown[] }>(
    `${V}/${atendimento}/${id}/ria`,
    b,
  );
