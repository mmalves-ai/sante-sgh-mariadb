// Cliente das rotas dos critérios de entrada, do alerta de elegível e das etapas com meta dos protocolos gerenciados
// (C2-042, 03-PEP L134; protocolo-criterios.controller.ts). A gravação leva CSRF e a Idempotency-Key (uma por ato).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/enfermagem/protocolos-gerenciados';

export interface ProtocoloResumo {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  situacao: string;
  publico: string;
  formula: string | null;
  versao: number;
  temModelo: boolean;
}

export interface CriterioLido {
  id: number;
  sequencia: number;
  finalidade: 'entrada' | 'saida' | 'sugestao';
  grupo: string | null;
  categoria: 'sinal_vital' | 'diagnostico' | 'escala' | 'idade' | 'resultado_exame';
  campo: string | null;
  termo: number | null;
  valorTexto: string | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  validadeHoras: number | null;
  descricao: string | null;
  ativo: boolean;
  versao: number;
}

export interface EtapaLida {
  id: number;
  sequencia: number;
  nome: string;
  tipo: string;
  metaMinutos: number | null;
  faixaEtaria: string;
  obrigatoria: boolean;
  versao: number;
}

export interface DefinicaoProtocolo {
  protocolo: ProtocoloResumo;
  criterios: CriterioLido[];
  etapas: EtapaLida[];
  formulaVigente: string;
  problemaFormula: string | null;
  /** Os parâmetros vitais ativos do cliente (opções do campo do critério de sinal vital). */
  sinaisVitais: { codigo: string; descricao: string }[];
}

export interface AlertaElegivel {
  atendimento: number;
  paciente: number;
  protocolo: number;
  nome: string;
  tipo: string;
  mensagem: string | null;
  criteriosAtendidos: string[];
  regraAvaliada: string;
  desde: string | null;
  nomePaciente: string;
  numeroAtendimento: string;
}

export interface InclusaoAberta {
  inclusao: number;
  atendimento: number;
  numeroAtendimento: string;
  nomePaciente: string;
  protocolo: string;
  horarioZero: string;
  etapas: number;
  pendentes: number;
  vencidas: number;
}

export type EstadoEtapa =
  'sem_meta' | 'no_prazo' | 'vencendo' | 'vencida' | 'cumprida' | 'perdida' | 'cancelada';

export interface EtapaDaInclusao {
  id: number;
  sequencia: number;
  nome: string;
  obrigatoria: boolean;
  metaMinutos: number | null;
  prazoMetaEm: string | null;
  concluidaEm: string | null;
  situacao: 'em_andamento' | 'meta_atingida' | 'meta_perdida' | 'cancelada';
  observacao: string | null;
  estado: EstadoEtapa;
  minutosRestantes: number | null;
  versao: number;
}

export interface EtapasDaInclusao {
  inclusao: number;
  nomeProtocolo: string;
  horarioZero: string;
  etapas: EtapaDaInclusao[];
  criterios: { descricao: string; valorEncontrado: string | null; atendido: boolean }[];
  cumpridas: number;
  perdidas: number;
}

export interface PedidoCriterio {
  grupo: string | null;
  categoria: 'sinal_vital' | 'diagnostico' | 'escala' | 'idade';
  campo: string | null;
  termo: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  validadeHoras: number | null;
  descricao: string | null;
}

export interface PedidoEtapa {
  nome: string;
  tipo: string;
  metaMinutos: number | null;
  obrigatoria: boolean;
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function postar<T>(url: string, corpo: unknown = {}): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': `pg-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

type Gravado = { ok: true; mensagem: string };

export const lerProtocolos = () => ler<{ itens: ProtocoloResumo[] }>(B).then((r) => r.itens);
export const lerDefinicao = (id: number) => ler<DefinicaoProtocolo>(`${B}/${id}`);
export const lerElegiveis = () =>
  ler<{ agora: string; avaliados: number; alertas: AlertaElegivel[] }>(`${B}/elegiveis`);
export const lerInclusoes = () => ler<{ agora: string; itens: InclusaoAberta[] }>(`${B}/inclusoes`);
export const lerEtapas = (inclusao: number) => ler<EtapasDaInclusao>(`${B}/inclusoes/${inclusao}/etapas`);

export const incluirCriterio = (protocolo: number, c: PedidoCriterio) =>
  postar<Gravado>(`${B}/${protocolo}/criterios`, c);
export const inativarCriterio = (id: number, versao: number, motivo: string) =>
  postar<Gravado>(`${B}/criterios/${id}/inativacao`, { versao, motivo });
export const gravarFormula = (protocolo: number, versao: number, formula: string | null) =>
  postar<Gravado>(`${B}/${protocolo}/formula`, { versao, formula });
export const incluirEtapa = (protocolo: number, e: PedidoEtapa) =>
  postar<Gravado>(`${B}/${protocolo}/etapas`, e);
export const ajustarMeta = (id: number, versao: number, metaMinutos: number | null, obrigatoria: boolean) =>
  postar<Gravado>(`${B}/etapas/${id}/meta`, { versao, metaMinutos, obrigatoria });
export const aplicarModelo = (protocolo: number) => postar<Gravado>(`${B}/${protocolo}/modelo`);
export const iniciarEtapas = (inclusao: number) => postar<Gravado>(`${B}/inclusoes/${inclusao}/etapas`);
export const concluirEtapa = (id: number, versao: number, justificativa: string | null) =>
  postar<Gravado & { situacao: string }>(`${B}/etapas-paciente/${id}/conclusao`, {
    versao,
    concluidaEm: null,
    justificativa,
  });
export const cancelarEtapa = (id: number, versao: number, motivo: string) =>
  postar<Gravado>(`${B}/etapas-paciente/${id}/cancelamento`, { versao, motivo });
