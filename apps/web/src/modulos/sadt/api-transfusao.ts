// Cliente das telas da agência transfusional, etapa 1 (M47): as requisições e amostras, o ato à beira do leito e a
// hemovigilância. As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a Idempotency-Key (o mesmo
// pedido reenviado não grava duas vezes). Problem Details viram ErroApi (com os códigos do bloqueio em `bloqueios`).
import type {
  AdendoAtoLido,
  AtoTransfusionalLido,
  ItemHemoterapiaAAtender,
  ReacaoTransfusionalLida,
  RequisicaoTransfusionalLida,
  TipagemDoReceptor,
  TipagemSanguinea,
  UrgenciaTransfusao,
  VersaoRequisicaoLida,
} from '@sgh/contratos';
import type { CamposNotificacaoHemovigilancia } from '@sgh/dominio-sadt';
import { tokenCsrf } from '../../api.js';
import { ErroApi, erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from '../enfermagem/api-enfermagem.js';

const B = '/api/sadt/transfusao';
const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(
  url: string,
  corpo: unknown,
  chave = novaChave('transfusao'),
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave ?? novaChave('transfusao'),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface GravacaoTransfusao {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly agenciaCompleta: boolean;
  readonly passos: readonly string[];
  readonly acoes: {
    readonly requisitar: boolean;
    readonly cancelar: boolean;
    readonly amostra: boolean;
    readonly administrar: boolean;
    readonly reacao: boolean;
    /** W0-03: alterar a requisição antes do atendimento; adendo no ato. */
    readonly alterar?: boolean;
    readonly adendo?: boolean;
  };
}

export interface TarefaSinaisLida {
  readonly momento: 'antes' | 'durante' | 'depois';
  readonly abreEm: string | null;
  readonly atrasaEm: string | null;
  readonly situacao: 'feita' | 'aguardando' | 'devida' | 'atrasada';
}

export interface DetalheRequisicao {
  readonly requisicao: RequisicaoTransfusionalLida;
  readonly agora: string;
  readonly leito: { readonly leito: string; readonly unidade: string } | null;
  readonly horarioPendente: { readonly id: number; readonly previsto: string | null } | null;
  readonly gravacaoNoHorario: 'checar-administrado' | 'so-registro-clinico';
  readonly atos: readonly (AtoTransfusionalLido & {
    readonly tarefas: readonly TarefaSinaisLida[];
    /** W0-03: os adendos do ato (o registro original não muda). */
    readonly adendos?: readonly AdendoAtoLido[];
  })[];
  /** W0-03: as versões anteriores da requisição (a original primeiro) e o número da vigente. */
  readonly versoes?: readonly VersaoRequisicaoLida[];
  readonly versaoVigente?: number;
  readonly gravacao: GravacaoTransfusao;
  /** Etapa 2 (agência própria): a tipagem que vale e as bolsas reservadas para a requisição. */
  readonly agencia?: {
    readonly receptor: TipagemDoReceptor;
    readonly reservadas: readonly {
      readonly numero: string;
      readonly hemocomponente: string;
      readonly tipagem: TipagemSanguinea;
      readonly validade: string;
      readonly volumeMl: number;
    }[];
  } | null;
}

export interface ItemDetalhe {
  readonly item: ItemHemoterapiaAAtender;
  readonly proposta: {
    readonly quantidadeBolsas: number;
    readonly volumeMl: number | null;
    readonly urgencia: UrgenciaTransfusao;
    readonly indicacao: string;
    readonly rotulo: string;
  };
  readonly termos: readonly { readonly id: number; readonly procedimento: string; readonly em: string }[];
  readonly tipagem: TipagemSanguinea;
  readonly horarios: number;
  readonly agora: string;
}

export interface IndicadorLido {
  readonly codigo: string;
  readonly rotulo: string;
  readonly numerador: number;
  readonly denominador: number;
  readonly valor: number | null;
  readonly unidade: '%' | 'por mil';
}

export const lerItens = (b?: typeof fetch) =>
  ler<{
    itens: ItemHemoterapiaAAtender[];
    cortada: boolean;
    agora: string;
    gravacao: GravacaoTransfusao;
  }>(`${B}/itens`, b);
export const lerItem = (item: number, b?: typeof fetch) => ler<ItemDetalhe>(`${B}/itens/${item}`, b);
export const lerRequisicoes = (filtro: Readonly<Record<string, string>>, b?: typeof fetch) => {
  const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v !== '')).toString();
  return ler<{
    itens: RequisicaoTransfusionalLida[];
    cortada: boolean;
    agora: string;
    gravacao: GravacaoTransfusao;
  }>(`${B}/requisicoes${q ? `?${q}` : ''}`, b);
};
export const lerRequisicao = (id: number, b?: typeof fetch) =>
  ler<DetalheRequisicao>(`${B}/requisicoes/${id}`, b);
export const requisitar = (corpo: unknown, chave?: string, b?: typeof fetch) =>
  enviar<{ ok: true; id: number; prazo: string | null; mensagem: string }>(
    `${B}/requisicoes`,
    corpo,
    chave,
    b,
  );
export const cancelarRequisicao = (id: number, motivo: string, b?: typeof fetch) =>
  enviar<{ ok: true; mensagem: string }>(`${B}/requisicoes/${id}/cancelar`, { motivo }, undefined, b);
/** W0-03: alterar hemocomponente, volume e urgência antes do atendimento (a versão anterior fica legível). */
export const alterarRequisicao = (id: number, corpo: unknown, b?: typeof fetch) =>
  enviar<{ ok: true; versao: number; prazo: string | null; mensagem: string }>(
    `${B}/requisicoes/${id}/alterar`,
    corpo,
    undefined,
    b,
  );
/** W0-03: o adendo do ato para os sinais digitados errado (o registro original não muda). */
export const adendoAto = (ato: number, corpo: unknown, b?: typeof fetch) =>
  enviar<{ ok: true; id: number; mensagem: string }>(`${B}/atos/${ato}/adendo`, corpo, undefined, b);
export const registrarAmostra = (id: number, corpo: unknown, chave?: string, b?: typeof fetch) =>
  enviar<{ ok: true; codigo: string; validaAte: string; mensagem: string }>(
    `${B}/requisicoes/${id}/amostra`,
    corpo,
    chave,
    b,
  );
export const iniciarTransfusao = (id: number, corpo: unknown, chave?: string, b?: typeof fetch) =>
  enviar<{ ok: true; ato: number; alertas: string[]; horarioChecado: number | null; mensagem: string }>(
    `${B}/requisicoes/${id}/atos`,
    corpo,
    chave,
    b,
  );
export const registrarSinais = (ato: number, corpo: unknown, chave?: string, b?: typeof fetch) =>
  enviar<{ ok: true; foraDaJanela: boolean; mensagem: string }>(`${B}/atos/${ato}/sinais`, corpo, chave, b);
export const concluirTransfusao = (ato: number, corpo: unknown, b?: typeof fetch) =>
  enviar<{ ok: true; estadoRequisicao: string; ganhoNoBalanco: boolean; mensagem: string }>(
    `${B}/atos/${ato}/concluir`,
    corpo,
    undefined,
    b,
  );
export const registrarReacao = (ato: number, corpo: unknown, chave?: string, b?: typeof fetch) =>
  enviar<{ ok: true; id: number; mensagem: string; notificacao: { prioridade: 'imediata' | 'rotina' } }>(
    `${B}/atos/${ato}/reacao`,
    corpo,
    chave,
    b,
  );
export const lerHemovigilancia = (de: string, ate: string, b?: typeof fetch) =>
  ler<{
    de: string;
    ate: string;
    reacoes: ReacaoTransfusionalLida[];
    indicadores: IndicadorLido[];
    gravacao: GravacaoTransfusao;
  }>(`${B}/hemovigilancia?${new URLSearchParams({ de, ate }).toString()}`, b);
export const lerNotificacao = (reacao: number, b?: typeof fetch) =>
  ler<{ campos: CamposNotificacaoHemovigilancia; enviadaEm: string | null; prioridade: string }>(
    `${B}/reacoes/${reacao}/notificacao`,
    b,
  );
export const marcarNotificada = (reacao: number, enviadaEm: string, b?: typeof fetch) =>
  enviar<{ ok: true; mensagem: string }>(`${B}/reacoes/${reacao}/notificacao`, { enviadaEm }, undefined, b);

/** Os códigos do bloqueio da recusa (o início da transfusão, a requisição, a reação). */
export function bloqueiosDaRecusa(e: unknown): readonly string[] {
  if (!(e instanceof ErroApi)) return [];
  const b = (e.problema as { bloqueios?: unknown } | null)?.bloqueios;
  return Array.isArray(b) ? b.filter((x): x is string => typeof x === 'string') : [];
}

export interface TransfusaoDoTurno {
  readonly ato: number;
  readonly requisicao: number;
  readonly paciente: { readonly nome: string; readonly leito: string };
  readonly bolsa: { readonly numero: string; readonly hemocomponente: string };
  readonly estado: 'emCurso' | 'concluido' | 'interrompido';
  readonly inicioEm: string;
  readonly tarefas: readonly TarefaSinaisLida[];
}
export const lerTarefasDoTurno = (unidade: string, b?: typeof fetch) =>
  ler<{ unidade: string; agora: string; itens: TransfusaoDoTurno[] }>(
    `${B}/tarefas?${new URLSearchParams({ unidade }).toString()}`,
    b,
  );
export const lerHistorico = (paciente: number, b?: typeof fetch) =>
  ler<{
    tipagem: TipagemSanguinea;
    origemTipagem: 'cadastro';
    atos: {
      id: number;
      requisicao: number;
      bolsa: AtoTransfusionalLido['bolsa'];
      estado: AtoTransfusionalLido['estado'];
      inicioEm: string;
      terminoEm: string | null;
      volumeTransfundidoMl: number | null;
      reacao: number | null;
    }[];
  }>(`${B}/pacientes/${paciente}/historico`, b);
