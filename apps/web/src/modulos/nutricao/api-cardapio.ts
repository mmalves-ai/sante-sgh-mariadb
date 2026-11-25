// Cardápio do serviço de nutrição e dietética (F8, 04-HOT linha 141): preparações com a ficha técnica, planejamento por
// refeição e dieta aprovado por nutricionista, previsão da produção do dia e a escolha do paciente. A recusa do servidor
// vem em `problema` (ErroNutricao).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const C = '/api/nutricao/cardapio';
const n = z.number();
const ni = z.number().int();
const item = z.object({ id: ni, descricao: z.string() });

const esquemaCadastros = z.object({
  refeicoes: z.array(item),
  alternativas: z.array(item),
  modalidades: z.array(item),
  unidades: z.array(item),
  tipos: z.array(z.string()),
});
export type CadastrosCardapio = z.infer<typeof esquemaCadastros>;

const esquemaGenero = z.object({
  id: ni,
  codigo: z.string(),
  nome: z.string(),
  unidade: ni,
  sigla: z.string(),
});
export type GeneroAlimenticio = z.infer<typeof esquemaGenero>;

const esquemaResumo = z.object({
  id: ni,
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string(),
  ativo: z.boolean(),
  ingredientes: ni,
  custoPorcao: n.nullable(),
  versao: ni,
});
export type PreparacaoResumo = z.infer<typeof esquemaResumo>;

const esquemaIngrediente = z.object({
  insumo: ni,
  nome: z.string(),
  unidade: ni,
  sigla: z.string(),
  perCapitaBruto: n,
  fatorCorrecao: n,
  perCapitaLiquido: n,
  fatorCoccao: n.nullable(),
  custoPerCapita: n.nullable(),
  custoUnidade: n.nullable(),
});
export type IngredienteFicha = z.infer<typeof esquemaIngrediente>;

const esquemaPreparacao = z.object({
  id: ni,
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string(),
  modoPreparo: z.string().nullable(),
  rendimentoPorcoes: n.nullable(),
  pesoPorcaoGramas: n.nullable(),
  ativo: z.boolean(),
  versao: ni,
  ficha: z.array(esquemaIngrediente),
});
export type Preparacao = z.infer<typeof esquemaPreparacao>;

const esquemaPlanoResumo = z.object({
  id: ni,
  descricao: z.string(),
  periodoInicio: z.string(),
  periodoFim: z.string(),
  situacao: z.string(),
  publico: z.string(),
  refeicao: ni,
  refeicaoDescricao: z.string(),
  modalidade: z.string().nullable(),
  itens: ni,
  aprovado: z.boolean(),
  versao: ni,
});
export type PlanejamentoResumo = z.infer<typeof esquemaPlanoResumo>;

const esquemaPlano = z.object({
  id: ni,
  descricao: z.string(),
  periodoInicio: z.string(),
  periodoFim: z.string(),
  refeicao: ni,
  modalidade: ni.nullable(),
  publico: z.string(),
  porcoesPrevistas: ni.nullable(),
  situacao: z.string(),
  observacao: z.string().nullable(),
  aprovador: z.string().nullable(),
  versao: ni,
  itens: z.array(
    z.object({
      data: z.string(),
      alternativa: ni.nullable(),
      alternativaDescricao: z.string().nullable(),
      preparacao: ni,
      nome: z.string(),
      tipo: z.string(),
      porcoes: n,
    }),
  ),
});
export type Planejamento = z.infer<typeof esquemaPlano>;

const esquemaProducao = z.object({
  data: z.string(),
  situacao: z.string(),
  comensaisMapa: ni,
  preparacoes: z.array(
    z.object({
      preparacao: ni,
      alternativa: ni.nullable(),
      porcoes: n,
      base: z.enum(['escolha', 'mapa', 'planejado']),
      nome: z.string(),
    }),
  ),
  generos: z.array(
    z.object({ insumo: ni, quantidade: n, custo: n.nullable(), nome: z.string(), sigla: z.string() }),
  ),
  custoTotal: n.nullable(),
});
export type ProducaoDoDia = z.infer<typeof esquemaProducao>;

const esquemaDia = z.object({
  opcoes: z.array(z.object({ alternativa: ni, descricao: z.string(), preparacoes: z.array(z.string()) })),
  escolhas: z.array(
    z.object({
      id: ni,
      comensal: z.string(),
      acompanhante: ni.nullable(),
      alternativa: ni,
      descricao: z.string(),
      quantidade: ni,
      situacao: z.string(),
      escolhidoEm: z.string(),
      versao: ni,
    }),
  ),
});
export type CardapioDoDia = z.infer<typeof esquemaDia>;

export interface IngredienteEnvio {
  insumo: number;
  unidade: number;
  perCapitaBruto: number;
  fatorCorrecao: number | null;
  fatorCoccao: number | null;
  custoUnidade: number | null;
}
export interface PreparacaoEnvio {
  id?: number;
  versao?: number;
  codigo: string;
  nome: string;
  tipo: string;
  modoPreparo: string | null;
  rendimentoPorcoes: number | null;
  pesoPorcaoGramas: number | null;
  ficha: IngredienteEnvio[];
}
export interface PlanejamentoEnvio {
  id?: number;
  versao?: number;
  descricao: string;
  periodoInicio: string;
  periodoFim: string;
  refeicao: number;
  modalidade: number | null;
  publico: string;
  observacao: string | null;
  itens: { data: string; alternativa: number | null; preparacao: number; porcoes: number }[];
}

const comId = z.object({ id: ni }).passthrough();

export const lerCadastrosCardapio = (): Promise<CadastrosCardapio> => ler(`${C}/cadastros`, esquemaCadastros);
export const buscarGeneros = (termo: string): Promise<GeneroAlimenticio[]> =>
  ler(`${C}/generos${qs({ termo })}`, z.object({ itens: z.array(esquemaGenero) })).then((r) => r.itens);
export const lerPreparacoes = (termo = ''): Promise<PreparacaoResumo[]> =>
  ler(`${C}/preparacoes${qs({ termo })}`, z.object({ itens: z.array(esquemaResumo) })).then((r) => r.itens);
export const lerPreparacao = (id: number): Promise<Preparacao> =>
  ler(`${C}/preparacoes/${id}`, esquemaPreparacao);
export const salvarPreparacao = (corpo: PreparacaoEnvio, chave: string) =>
  enviar(
    `${C}/preparacoes`,
    corpo,
    z.object({ id: ni, custoPorcao: n.nullable(), mensagem: z.string() }),
    chave,
  );
export const lerPlanejamentos = (de: string, ate: string): Promise<PlanejamentoResumo[]> =>
  ler(`${C}/planejamentos${qs({ de, ate })}`, z.object({ itens: z.array(esquemaPlanoResumo) })).then(
    (r) => r.itens,
  );
export const lerPlanejamento = (id: number): Promise<Planejamento> =>
  ler(`${C}/planejamentos/${id}`, esquemaPlano);
export const salvarPlanejamento = (corpo: PlanejamentoEnvio, chave: string) =>
  enviar(`${C}/planejamentos`, corpo, comId, chave);
export const agirPlanejamento = (
  id: number,
  corpo: { acao: 'enviar' | 'devolver' | 'publicar' | 'cancelar'; versao: number; motivo?: string | null },
  chave: string,
) => enviar(`${C}/planejamentos/${id}/acao`, corpo, comId, chave);
export const aprovarPlanejamento = (id: number, versao: number, chave: string) =>
  enviar(`${C}/planejamentos/${id}/aprovar`, { versao }, comId, chave);
export const lerProducao = (id: number, data: string, margem: number): Promise<ProducaoDoDia> =>
  ler(`${C}/planejamentos/${id}/producao${qs({ data, margem })}`, esquemaProducao);
export const lerCardapioDoDia = (
  data: string,
  refeicao: number,
  internacao: number | null,
): Promise<CardapioDoDia> => ler(`${C}/dia${qs({ data, refeicao, internacao })}`, esquemaDia);
export const registrarEscolha = (
  corpo: { internacao: number; data: string; refeicao: number; alternativa: number; quantidade: number },
  chave: string,
) => enviar(`${C}/escolhas`, corpo, z.object({ id: ni, substituida: ni.nullable() }), chave);
export const cancelarEscolha = (id: number, versao: number, chave: string) =>
  enviar(`${C}/escolhas/${id}/cancelar`, { versao }, comId, chave);
