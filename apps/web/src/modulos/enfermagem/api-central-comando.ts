// Cliente das rotas da central de comando assistencial (C2-053, 01-ADM L117; central-comando.controller.ts): o quadro
// da unidade, a visão por paciente, a apuração dos riscos, o tratamento da ocorrência, as metas das 24 horas e a
// configuração (temas, regras com critérios, limites de fluxo). A gravação leva CSRF e a Idempotency-Key (uma por ato).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/enfermagem/central-comando';

export type Gravidade = 'baixa' | 'media' | 'alta' | 'critica';
export type SituacaoMeta = 'pendente' | 'cumprida' | 'nao_cumprida' | 'cancelada';
export type NivelAlerta = 'normal' | 'atencao' | 'critico' | 'sem_medida';

export interface Ocorrencia {
  id: number;
  regra: string;
  tema: string;
  atendimento: number;
  gravidade: Gravidade;
  situacao: 'aberta' | 'reconhecida' | 'resolvida' | 'descartada';
  detectadoEm: string;
  evidencia: { criterios?: { tipo: string; negado: boolean; valor: number | string | null }[] } | null;
  resolucao: string | null;
  versao: number;
}
export interface Meta {
  id: number;
  atendimento: number;
  data: string;
  categoria: string;
  descricao: string;
  prazoEm: string;
  situacao: SituacaoMeta;
  atrasada: boolean;
  justificativa: string | null;
  ocorrencia: number | null;
  versao: number;
}
export interface PacienteQuadro {
  atendimento: number;
  paciente: number;
  nome: string;
  numero: string;
  leito: string | null;
  permanenciaHoras: number;
  maiorGravidade: Gravidade | null;
  riscosAbertos: number;
  riscos: Ocorrencia[];
  metas: Meta[];
  metasAtrasadas: number;
  cumprimento: { total: number; cumpridas: number; pendentes: number; percentual: number | null };
  escorePiora: number | null;
  protocolosAbertos: number;
}
export interface AlertaFluxo {
  id: number;
  unidade: number | null;
  unidadeNome: string | null;
  tipo: string;
  unidadeLimite: 'minutos' | 'percentual' | 'quantidade';
  limiteAtencao: number | null;
  limiteCritico: number;
  indicador: number | null;
  ativo: boolean;
  versao: number;
  medida?: number | null;
  nivel?: NivelAlerta;
}
export interface Quadro {
  agora: string;
  pacientes: PacienteQuadro[];
  alertas: AlertaFluxo[];
  resumo: {
    pacientes: number;
    comRisco: number;
    riscosCriticos: number;
    metas: { total: number; cumpridas: number; pendentes: number; percentual: number | null };
    metasAtrasadas: number;
    alertasCriticos: number;
  };
}
export interface Opcao {
  id: number;
  rotulo: string;
}
export interface Configuracao {
  temas: { id: number; codigo: string; descricao: string; ativo: boolean }[];
  regras: { id: number; codigo: string; nome: string; gravidade: string; ativo: boolean; versao: number }[];
  alertas: AlertaFluxo[];
  apoio: { exames: Opcao[]; itens: Opcao[]; sinais: Opcao[]; unidades: Opcao[] };
}
export interface Gravado {
  ok: true;
  mensagem: string;
  id?: number;
  versao?: number;
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
      'idempotency-key': `cc-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const lerQuadro = (unidade: number | null) =>
  ler<Quadro>(`${B}/quadro${unidade ? `?unidade=${unidade}` : ''}`);
export const lerAtendimento = (id: number) =>
  ler<{ atendimento: number; ocorrencias: Ocorrencia[]; metas: Meta[] }>(`${B}/atendimentos/${id}`);
export const apurar = () =>
  postar<Gravado & { avaliados: number; abertas: number; encerradas: number }>(`${B}/apuracao`);
export const passarOcorrencia = (
  id: number,
  acao: 'reconhecer' | 'resolver' | 'descartar',
  versao: number,
  resolucao: string | null,
) => postar<Gravado>(`${B}/ocorrencias/${id}`, { acao, versao, resolucao });
export const incluirMeta = (corpo: {
  atendimento: number;
  categoria: string;
  descricao: string;
  prazoEm: string;
  ocorrencia: number | null;
}) => postar<Gravado>(`${B}/metas`, corpo);
export const encerrarMeta = (
  id: number,
  versao: number,
  situacao: Exclude<SituacaoMeta, 'pendente'>,
  justificativa: string | null,
) => postar<Gravado>(`${B}/metas/${id}/encerramento`, { versao, situacao, justificativa });
export const lerConfiguracao = () => ler<Configuracao>(`${B}/regras`);
export const incluirTema = (corpo: { codigo: string; descricao: string }) =>
  postar<Gravado>(`${B}/temas`, corpo);
export const incluirRegra = (corpo: unknown) => postar<Gravado>(`${B}/regras`, corpo);
export const ativarRegra = (id: number, versao: number, ativo: boolean, motivo: string) =>
  postar<Gravado>(`${B}/regras/${id}/ativacao`, { versao, ativo, motivo });
export const incluirAlerta = (corpo: unknown) => postar<Gravado>(`${B}/alertas`, corpo);
export const inativarAlerta = (id: number, versao: number, motivo: string) =>
  postar<Gravado>(`${B}/alertas/${id}/inativacao`, { versao, motivo });
