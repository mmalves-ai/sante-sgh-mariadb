// Cliente da tela do kit de implantação (C2-025, 01-ADM L98): o diagnóstico do hospital novo pelo checklist padrão,
// a implantação aberta com o "o que falta" por módulo, as metas e a edição do modelo pela plataforma. As gravações vão
// com o CSRF e a Idempotency-Key; as recusas viram ErroApi (Problem Details) com a mensagem para a tela.
import {
  FASES_IMPLANTACAO,
  INDICADORES_META,
  SITUACOES_ITEM_PRONTIDAO,
  TIPOS_VERIFICACAO,
} from '@sgh/dominio-config/implantacao'; // subcaminho: o índice do pacote traz node:crypto, que não roda no navegador
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { ler, lerJson, novaChave } from '../exames/api-exames.js';

const P = '/api/implantacao/kit';
const txt = z.string().nullable();

export const esquemaItemModelo = z.object({
  id: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  descricao: txt,
  modulo: z.string(),
  tipo: z.enum(TIPOS_VERIFICACAO),
  entidade: txt,
  quantidadeMinima: z.number().nullable(),
  orientacao: txt,
  ordem: z.number(),
  critico: z.boolean(),
  ativo: z.boolean(),
  versao: z.number(),
});
export type ItemModeloTela = z.infer<typeof esquemaItemModelo>;

const esquemaDiagnostico = esquemaItemModelo.extend({
  contagem: z.number().nullable(),
  situacao: z.enum(SITUACOES_ITEM_PRONTIDAO),
});
export type ItemDiagnosticoTela = z.infer<typeof esquemaDiagnostico>;

const esquemaItem = z.object({
  id: z.number(),
  sequencia: z.number(),
  modelo: esquemaItemModelo,
  situacao: z.enum(SITUACOES_ITEM_PRONTIDAO),
  quantidadePrevista: z.number().nullable(),
  quantidadeRealizada: z.number().nullable(),
  dataInicioPrevista: txt,
  dataPrazo: txt,
  concluidoEm: txt,
  ultimaConferenciaEm: txt,
  responsavelNome: txt,
  responsavelEmail: txt,
  motivoDispensa: txt,
  observacao: txt,
  atrasado: z.boolean(),
  versao: z.number(),
});
export type ItemImplantacaoTela = z.infer<typeof esquemaItem>;

const esquemaMeta = z.object({
  id: z.number(),
  sequencia: z.number(),
  processo: z.string(),
  indicador: z.enum(INDICADORES_META),
  descricao: txt,
  unidade: txt,
  valorMeta: z.number(),
  valorMedido: z.number().nullable(),
  dataLimite: txt,
  medidoEm: txt,
  situacao: z.enum(['pendente', 'atingida', 'parcial', 'nao_atingida', 'cancelada']),
  analise: txt,
  melhorias: txt,
  versao: z.number(),
});
export type MetaImplantacaoTela = z.infer<typeof esquemaMeta>;

const esquemaImplantacao = z.object({
  id: z.number(),
  nome: z.string(),
  fase: z.string(),
  situacao: z.string(),
  dataInicioPrevista: txt,
  dataFimPrevista: txt,
  dataViradaPrevista: txt,
  viradaEm: txt,
  responsavelClienteNome: txt,
  responsavelClienteEmail: txt,
  observacao: txt,
  versao: z.number(),
});
export type ImplantacaoTela = z.infer<typeof esquemaImplantacao>;

const esquemaResumo = z.object({
  total: z.number(),
  prontos: z.number(),
  dispensados: z.number(),
  emAndamento: z.number(),
  pendentes: z.number(),
  criticosEmAberto: z.number(),
  atrasados: z.number(),
  percentual: z.number(),
  porModulo: z.array(
    z.object({ modulo: z.string(), total: z.number(), concluidos: z.number(), percentual: z.number() }),
  ),
  oQueFalta: z.array(z.number()),
});

export const esquemaPainelImplantacao = z.object({
  hoje: z.string(),
  implantacao: esquemaImplantacao.nullable(),
  diagnostico: z.array(esquemaDiagnostico),
  itens: z.array(esquemaItem),
  metas: z.array(esquemaMeta),
  resumo: esquemaResumo,
});
export type PainelImplantacaoTela = z.infer<typeof esquemaPainelImplantacao>;

const esquemaModelo = z.object({ itens: z.array(esquemaItemModelo), contagens: z.array(z.string()) });
export type ModeloImplantacaoTela = z.infer<typeof esquemaModelo>;

const esquemaId = z.object({ id: z.number() }).passthrough();
const esquemaConferencia = z.object({ alterados: z.number(), conferidos: z.number() });

export { FASES_IMPLANTACAO, INDICADORES_META };

async function mandar<T>(
  metodo: 'POST' | 'PATCH',
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  rotulo: string,
): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(`kit.${rotulo}`),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  return lerJson(r, esquema);
}

export const lerPainelImplantacao = (): Promise<PainelImplantacaoTela> => ler(P, esquemaPainelImplantacao);
export const lerModeloImplantacao = (): Promise<ModeloImplantacaoTela> => ler(`${P}/modelo`, esquemaModelo);

export interface PedidoAbrirImplantacao {
  nome: string;
  dataInicioPrevista: string | null;
  dataFimPrevista: string | null;
  dataViradaPrevista: string | null;
  responsavelClienteNome: string | null;
  responsavelClienteEmail: string | null;
  observacao: string | null;
}
export const abrirImplantacao = (p: PedidoAbrirImplantacao) => mandar('POST', P, p, esquemaId, 'abrir');

export interface PedidoAlterarImplantacao {
  fase?: (typeof FASES_IMPLANTACAO)[number];
  dataViradaPrevista?: string | null;
  versao: number;
}
export const alterarImplantacao = (id: number, p: PedidoAlterarImplantacao) =>
  mandar('PATCH', `${P}/${id}`, p, esquemaId, 'alterar');

export const recontarImplantacao = (id: number) =>
  mandar('POST', `${P}/${id}/conferencia`, {}, esquemaConferencia, 'recontar');

export interface PedidoAlterarItem {
  situacao?: (typeof SITUACOES_ITEM_PRONTIDAO)[number];
  motivoDispensa?: string | null;
  dataPrazo?: string | null;
  responsavelNome?: string | null;
  responsavelEmail?: string | null;
  versao: number;
}
export const alterarItemImplantacao = (item: number, p: PedidoAlterarItem) =>
  mandar('PATCH', `${P}/itens/${item}`, p, esquemaId, 'item');

export interface PedidoMeta {
  processo: string;
  indicador: (typeof INDICADORES_META)[number];
  valorMeta: number;
  unidade: string | null;
  dataLimite: string | null;
  modulo: string | null;
}
export const incluirMetaImplantacao = (id: number, p: PedidoMeta) =>
  mandar('POST', `${P}/${id}/metas`, p, esquemaId, 'meta');

export interface PedidoMedicao {
  valorMedido: number;
  analise: string | null;
  versao: number;
}
export const medirMetaImplantacao = (meta: number, p: PedidoMedicao) =>
  mandar('POST', `${P}/metas/${meta}/medicao`, p, esquemaId, 'medir');

export interface PedidoItemModelo {
  codigo: string;
  titulo: string;
  modulo: string;
  tipo: (typeof TIPOS_VERIFICACAO)[number];
  entidade: string | null;
  quantidadeMinima: number | null;
  critico: boolean;
  ativo: boolean;
}
export const salvarItemModelo = (p: PedidoItemModelo) =>
  mandar('POST', `${P}/modelo`, p, esquemaId, 'modelo');
