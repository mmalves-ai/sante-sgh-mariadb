// Cliente do comercial da operadora (08-SGO L100, C2-095): força de venda (corretora, vendedor, equipe), regra de
// comissão com faixas de parcelas, proposta de adesão (RN ANS 195/2009) com os proponentes e as mudanças de situação,
// metas com faixas de prêmio e apuração, campanhas de desconto e lote de comissão (só parcela paga; estorno no
// cancelamento ou na inadimplência). Respostas validadas aqui; Problem Details viram ErroApi.
import {
  MEDIDAS_META,
  type Proponente,
  SITUACOES_CAMPANHA,
  SITUACOES_COMISSAO,
  SITUACOES_PROPOSTA,
  TIPOS_PROPONENTE,
} from '@sgh/dominio-operadora';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/comercial';
const n = z.number();
const tn = z.string().nullable();
const nn = n.nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();
const linha = z.object({ id: n }).catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type Linha = z.infer<typeof linha>;

const esquemaParcela = z.object({
  parcelaInicial: n,
  parcelaFinal: nn,
  tipo: z.enum(['percentual', 'valor']),
  percentual: nn,
  valor: nn,
  desconto: nn,
  vigenciaInicio: z.string(),
});
export type ParcelaRegra = z.infer<typeof esquemaParcela>;
const esquemaRegraLida = z
  .object({ id: n, codigo: z.string(), descricao: z.string(), parcelas: z.array(esquemaParcela) })
  .passthrough();
export type RegraLida = z.infer<typeof esquemaRegraLida>;

export const esquemaPainel = z.object({
  corretoras: z.array(linha),
  vendedores: z.array(linha),
  equipes: z.array(linha),
  regras: z.array(esquemaRegraLida),
  incidencias: z.array(linha),
  planos: z.array(linha),
  contratos: z.array(linha),
  parentescos: z.array(linha),
  propostas: z.array(linha),
  metas: z.array(linha),
  campanhas: z.array(linha),
  lotes: z.array(linha),
});
export type PainelComercial = z.infer<typeof esquemaPainel>;

const esquemaProponente = z.object({
  sequencia: n,
  tipo: z.enum(TIPOS_PROPONENTE),
  titularSequencia: nn,
  parentesco: nn,
  nome: z.string(),
  nascimento: z.string(),
  sexo: z.string(),
  cpf: tn,
  cns: tn,
  nomeMae: tn,
});
export const esquemaProposta = z.object({
  id: n,
  versao: n,
  numero: z.string(),
  situacao: z.enum(SITUACOES_PROPOSTA),
  propostaEm: z.string(),
  plano: n,
  contrato: nn,
  contratoGerado: nn,
  vendedor: nn,
  corretora: nn,
  equipe: nn,
  diaVencimento: nn,
  observacao: tn,
  observacaoOperadora: tn,
  proponentes: z.array(esquemaProponente),
});
export type PropostaLida = z.infer<typeof esquemaProposta>;
export const esquemaApuracaoMeta = z.object({
  medida: z.enum(MEDIDAS_META),
  realizado: n,
  atingido: nn,
  faixa: nn,
  percentualPremio: nn,
  valorPremio: nn,
});
export type ApuracaoMeta = z.infer<typeof esquemaApuracaoMeta>;

type Id = number | null;
export interface NovaCorretora {
  codigo: string;
  nome: string;
  tipo: 'corretora' | 'unidade_venda' | 'administradora' | 'venda_propria';
  cnpj: string | null;
  corretoraPai: Id;
  registroSusep: string | null;
  email: string | null;
}
export interface NovoVendedor {
  codigo: string;
  nome: string;
  cpf: string;
  corretora: Id;
  email: string | null;
}
export interface NovaEquipe {
  codigo: string;
  nome: string;
  corretora: Id;
  chefe: Id;
  membros: { vendedor: number; inicio: string }[];
}
export interface NovaRegra {
  codigo: string;
  descricao: string;
  incidencia: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  corretora: Id;
  equipe: Id;
  vendedor: Id;
  plano: Id;
  parcelas: ParcelaRegra[];
}
export interface NovaProposta {
  propostaEm: string;
  plano: number;
  contrato: Id;
  contratante: Id;
  vendedor: Id;
  corretora: Id;
  equipe: Id;
  diaVencimento: number | null;
  observacao: string | null;
  proponentes: Proponente[];
}
export interface NovaMeta {
  descricao: string;
  medida: (typeof MEDIDAS_META)[number];
  inicio: string;
  fim: string;
  equipe: Id;
  vendedor: Id;
  corretora: Id;
  valorMeta: number | null;
  faixas: { de: number; ate: number | null; percentualPremio: number | null; valorPremio: number | null }[];
}
export interface NovaCampanha {
  codigo: string;
  descricao: string;
  inicio: string;
  fim: string | null;
  regra: Id;
  condicoes: string | null;
  descontos: { parcela: number; percentual: number | null; valor: number | null }[];
  participantes: { corretora: Id; equipe: Id; vendedor: Id }[];
}
export interface NovaApuracao {
  descricao: string | null;
  regra: number;
  corretora: Id;
  equipe: Id;
  vendedor: Id;
  pagamentoInicio: string;
  pagamentoFim: string;
  prazoEstornoDias: number;
  aliquotaIrrf: number;
  aliquotaIss: number;
}

export const lerPainelComercial = (op: number) => ler(`${A}/${op}`, esquemaPainel);
export const gravarCorretora = (op: number, c: NovaCorretora) =>
  enviar(`${A}/${op}/corretoras`, c, gravado, novaChave('com-corretora'));
export const gravarVendedor = (op: number, c: NovoVendedor) =>
  enviar(`${A}/${op}/vendedores`, c, gravado, novaChave('com-vendedor'));
export const gravarEquipe = (op: number, c: NovaEquipe) =>
  enviar(`${A}/${op}/equipes`, c, gravado, novaChave('com-equipe'));
export const gravarRegraComissao = (op: number, c: NovaRegra) =>
  enviar(`${A}/${op}/regras`, c, gravado, novaChave('com-regra'));
export const incluirProposta = (op: number, c: NovaProposta) =>
  enviar(`${A}/${op}/propostas`, c, gravado, novaChave('com-proposta'));
export const lerProposta = (id: number) => ler(`${A}/propostas/${id}`, esquemaProposta);
export const mudarProposta = (
  id: number,
  c: { versao: number; para: (typeof SITUACOES_PROPOSTA)[number]; motivo: string | null; contrato: Id },
) => enviar(`${A}/propostas/${id}/situacao`, c, gravado, novaChave('com-proposta-situacao'));
export const gravarMeta = (op: number, c: NovaMeta) =>
  enviar(`${A}/${op}/metas`, c, gravado, novaChave('com-meta'));
export const lerApuracaoMeta = (id: number) => ler(`${A}/metas/${id}/apuracao`, esquemaApuracaoMeta);
export const gravarCampanha = (op: number, c: NovaCampanha) =>
  enviar(`${A}/${op}/campanhas`, c, gravado, novaChave('com-campanha'));
export const mudarCampanha = (id: number, c: { versao: number; para: (typeof SITUACOES_CAMPANHA)[number] }) =>
  enviar(`${A}/campanhas/${id}/situacao`, c, gravado, novaChave('com-campanha-situacao'));
export const apurarComissao = (op: number, c: NovaApuracao) =>
  enviar(`${A}/${op}/comissoes`, c, gravado, novaChave('com-comissao'));
export const lerItensComissao = (id: number) => ler(`${A}/comissoes/${id}/itens`, z.array(linha));
export const mudarComissao = (
  id: number,
  c: { versao: number; para: (typeof SITUACOES_COMISSAO)[number]; motivo: string | null },
) => enviar(`${A}/comissoes/${id}/situacao`, c, gravado, novaChave('com-comissao-situacao'));
