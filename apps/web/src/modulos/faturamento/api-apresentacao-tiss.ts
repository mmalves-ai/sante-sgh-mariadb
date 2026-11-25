// Cliente da regra de apresentação TISS por fonte pagadora (06-FAT linha 30): leitura da regra, dos itens e dos valores
// padrão de campo, os combos da tela e as gravações (cada uma com Idempotency-Key; o servidor confere tudo de novo).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const U = '/api/faturamento/tiss/apresentacao';
const idN = z.number().nullable();
const textoN = z.string().nullable();

const esquemaRegra = z.object({
  id: z.number(),
  versao: z.number(),
  versaoPadraoTissId: z.number(),
  tipoContaId: idN,
  registroAns: textoN,
  codigoContratadoOperadora: textoN,
  limiteGuiasLote: idN,
  ordenacaoGuias: z.enum(['numero_guia', 'paciente', 'data_atendimento']),
  usaGuiaConsulta: z.boolean(),
  agrupaItens: z.boolean(),
  omiteGuiaSemValor: z.boolean(),
  usaFaturamentoEletronico: z.boolean(),
  ativo: z.boolean(),
});
export type RegraApresentacaoTela = z.infer<typeof esquemaRegra>;

const esquemaItem = z.object({
  id: z.number(),
  versao: z.number(),
  regraId: z.number(),
  grupoId: idN,
  itemId: idN,
  funcaoId: idN,
  setorId: idN,
  profissionalId: idN,
  tipoGuia: textoN,
  codigoApresentacao: textoN,
  descricaoApresentacao: textoN,
  agrupa: z.boolean(),
  agrupamentoData: textoN,
  naoExporta: z.boolean(),
  ativo: z.boolean(),
});
export type ItemApresentacaoTela = z.infer<typeof esquemaItem>;

const esquemaPadrao = z.object({
  id: z.number(),
  versao: z.number(),
  campo: z.string(),
  valor: z.string(),
  sobrepoe: z.boolean(),
  estabelecimentoId: idN,
  regraId: idN,
  regimeId: idN,
  origemId: idN,
  itemId: idN,
  vigenciaInicio: z.string(),
  vigenciaFim: textoN,
  ativo: z.boolean(),
});
export type PadraoApresentacaoTela = z.infer<typeof esquemaPadrao>;

const esquemaApresentacao = z.object({
  regras: z.array(esquemaRegra),
  itens: z.array(esquemaItem),
  padroes: z.array(esquemaPadrao),
});
export type ApresentacaoTiss = z.infer<typeof esquemaApresentacao>;

const opcao = z.object({ id: z.number(), rotulo: z.string() });
const esquemaOpcoes = z.object({
  versoesTiss: z.array(opcao),
  tiposConta: z.array(opcao),
  grupos: z.array(opcao),
  funcoes: z.array(opcao),
  regimes: z.array(opcao),
  origens: z.array(opcao),
});
export type OpcoesApresentacao = z.infer<typeof esquemaOpcoes>;

const esquemaGravado = z.object({ id: z.number(), versao: z.number().optional() }).passthrough();

export const lerApresentacaoTiss = (convenio: number) =>
  ler(`${U}?convenio=${convenio}`, esquemaApresentacao);
export const lerOpcoesApresentacaoTiss = () => ler(`${U}/opcoes`, esquemaOpcoes);

export interface NovaRegraApresentacao {
  id?: number;
  versao?: number;
  fontePagadoraId: number;
  tipoContaId: number | null;
  versaoPadraoTissId: number;
  registroAns: string | null;
  codigoContratadoOperadora: string | null;
  limiteGuiasLote: number | null;
  ordenacaoGuias: 'numero_guia' | 'paciente' | 'data_atendimento';
  usaGuiaConsulta: boolean;
  agrupaItens: boolean;
  omiteGuiaSemValor: boolean;
  usaFaturamentoEletronico: boolean;
  ativo: boolean;
}
export const gravarRegraApresentacao = (corpo: NovaRegraApresentacao, chave: string) =>
  enviar(`${U}/regras`, corpo, esquemaGravado, chave);

export interface NovoItemApresentacao {
  regraId: number;
  grupoFaturamentoId: number | null;
  itemFaturavelId: number | null;
  funcaoEquipeCobrancaId: number | null;
  setorFuncionalId: number | null;
  profissionalId: number | null;
  tipoGuia: string | null;
  codigoApresentacao: string | null;
  descricaoApresentacao: string | null;
  agrupa: boolean;
  agrupamentoData: string | null;
  naoExporta: boolean;
}
export const incluirItemApresentacao = (corpo: NovoItemApresentacao, chave: string) =>
  enviar(`${U}/itens`, corpo, esquemaGravado, chave);
export const desativarItemApresentacao = (id: number, versao: number, chave: string) =>
  enviar(`${U}/itens/${id}/desativacao`, { versao }, esquemaGravado, chave);

export interface NovoPadraoCampo {
  fontePagadoraId: number;
  estabelecimentoProprio: boolean;
  regraId: number | null;
  campo: string;
  valor: string;
  regimeAtendimentoId: number | null;
  origemEntradaAtendimentoId: number | null;
  itemFaturavelId: number | null;
  sobrepoe: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export const incluirPadraoCampo = (corpo: NovoPadraoCampo, chave: string) =>
  enviar(`${U}/valores-padrao`, corpo, esquemaGravado, chave);
export const encerrarPadraoCampo = (id: number, versao: number, vigenciaFim: string, chave: string) =>
  enviar(`${U}/valores-padrao/${id}/encerramento`, { versao, vigenciaFim }, esquemaGravado, chave);
