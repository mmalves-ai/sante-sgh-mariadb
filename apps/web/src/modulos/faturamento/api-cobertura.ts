// Cliente da restrição de cobertura por fonte pagadora e da compatibilidade entre procedimentos (F7, 09-AREA linha 76).
// A validação do cadastro vem de @sgh/dominio-faturamento (a mesma regra da API), para o erro aparecer na hora;
// o servidor confere de novo. Na prescrição a conferência só avisa: o ato assistencial nunca é impedido.
import {
  TIPOS_ATENDIMENTO_COBERTURA,
  TIPOS_CRITERIO_COBERTURA,
  TIPOS_RELACAO_PROCEDIMENTO,
  TIPOS_RESTRICAO_COBERTURA,
  type CriterioCobertura,
} from '@sgh/dominio-faturamento';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

export {
  validarExcecaoCobertura,
  validarParCompatibilidade,
  validarRestricaoCobertura,
} from '@sgh/dominio-faturamento';

const U = '/api/faturamento/cobertura';
const textoN = z.string().nullable();
const numN = z.number().nullable();

const esquemaCriterio = z.object({
  tipo: z.enum(TIPOS_CRITERIO_COBERTURA),
  setorId: numN.optional(),
  idadeMinima: numN.optional(),
  idadeMaxima: numN.optional(),
  horaInicio: textoN.optional(),
  horaFim: textoN.optional(),
  diaSemana: numN.optional(),
  profissionalId: numN.optional(),
  prestadorId: numN.optional(),
  prestadorProfissionalId: numN.optional(),
  planoId: numN.optional(),
  empresaId: numN.optional(),
  quantidadeMaxima: numN.optional(),
  periodo: z.enum(['dia', 'semana', 'mes', 'ano', 'atendimento']).nullable().optional(),
  tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_COBERTURA).nullable().optional(),
});

const esquemaRestricao = z.object({
  id: z.number(),
  versao: z.number().optional(),
  descricao: z.string(),
  estabelecimentoId: numN,
  fontePagadoraId: z.number(),
  planoId: numN,
  itemId: numN,
  grupoId: numN,
  tabelaId: numN,
  tipo: z.enum(TIPOS_RESTRICAO_COBERTURA),
  acao: z.enum(['bloquear', 'alertar']),
  tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_COBERTURA).nullable(),
  valorLimite: numN,
  quantidadeLimite: numN,
  mensagem: textoN,
  vigenciaInicio: z.string(),
  vigenciaFim: textoN,
  ativo: z.boolean(),
  criterios: z.array(esquemaCriterio),
  fonteNome: z.string(),
  planoDescricao: textoN,
  itemCodigo: textoN,
  itemDescricao: textoN,
  grupoDescricao: textoN,
  tabelaDescricao: textoN,
});
export type RestricaoPainel = z.infer<typeof esquemaRestricao>;

const esquemaPar = z.object({
  id: z.number(),
  versao: z.number().optional(),
  fontePagadoraId: numN,
  itemId: z.number(),
  relacionadoId: z.number(),
  tipo: z.enum(TIPOS_RELACAO_PROCEDIMENTO),
  exigeItem: z.boolean(),
  quantidadeLimite: numN,
  validadeDias: numN,
  vigenciaInicio: z.string(),
  vigenciaFim: textoN,
  ativo: z.boolean(),
  itemCodigo: z.string(),
  itemDescricao: z.string(),
  relacionadoCodigo: z.string(),
  relacionadoDescricao: z.string(),
  fonteNome: textoN,
});
export type ParPainel = z.infer<typeof esquemaPar>;

const opcao = z.object({ id: z.number(), descricao: z.string() });
const opcaoNome = z.object({ id: z.number(), nome: z.string() });
const esquemaPainel = z.object({
  restricoes: z.array(esquemaRestricao),
  pares: z.array(esquemaPar),
  opcoes: z.object({
    justificativas: z.array(
      z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), textoPadrao: textoN }),
    ),
    fontes: z.array(opcaoNome),
    planos: z.array(opcao),
    setores: z.array(opcaoNome),
    grupos: z.array(opcao),
    tabelas: z.array(opcao),
    prestadores: z.array(opcaoNome),
  }),
});
export type PainelCobertura = z.infer<typeof esquemaPainel>;

const esquemaItem = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  grupoId: numN,
});
export type ItemCobertura = z.infer<typeof esquemaItem>;

const esquemaExcecao = z.object({
  id: z.number(),
  versao: z.number(),
  restricaoId: numN,
  restricaoDescricao: textoN,
  itemId: numN,
  itemCodigo: textoN,
  itemDescricao: textoN,
  grupoDescricao: textoN,
  quantidadeAutorizada: numN,
  numeroGuia: textoN,
  observacao: textoN,
  justificativa: z.string(),
  autor: z.string(),
  autorizadoEm: z.string(),
  revogada: z.boolean(),
  tiposAtendimento: z.array(z.enum(TIPOS_ATENDIMENTO_COBERTURA)),
});
export type ExcecaoAtendimento = z.infer<typeof esquemaExcecao>;
const esquemaExcecoes = z.object({
  atendimentoId: z.number(),
  fontePagadoraId: z.number(),
  tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_COBERTURA),
  excecoes: z.array(esquemaExcecao),
  restricoes: z.array(z.object({ id: z.number(), descricao: z.string(), itemId: numN, grupoId: numN })),
});
export type ExcecoesAtendimento = z.infer<typeof esquemaExcecoes>;

const esquemaAchado = z.object({
  origem: z.enum(['restricao', 'compatibilidade']),
  id: z.number(),
  efeito: z.enum(['bloqueio', 'alerta', 'liberado']),
  motivo: z.string(),
  excecaoId: numN,
});
const esquemaConferencia = z.object({
  atendimentoId: z.number(),
  fontePagadoraId: z.number(),
  itens: z.array(
    z.object({
      codigo: textoN,
      itemId: numN,
      situacao: z.enum(['livre', 'alerta', 'bloqueio']),
      achados: z.array(esquemaAchado),
    }),
  ),
});
export type ConferenciaCobertura = z.infer<typeof esquemaConferencia>;

const esquemaGravado = z.record(z.string(), z.unknown());

export interface PedidoRestricao {
  id: number | null;
  versao: number | null;
  descricao: string;
  fontePagadoraId: number;
  planoId: number | null;
  itemId: number | null;
  grupoId: number | null;
  tabelaId: number | null;
  tipo: (typeof TIPOS_RESTRICAO_COBERTURA)[number];
  acao: 'bloquear' | 'alertar';
  tipoAtendimento: (typeof TIPOS_ATENDIMENTO_COBERTURA)[number] | null;
  valorLimite: number | null;
  quantidadeLimite: number | null;
  mensagem: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
  criterios: CriterioCobertura[];
}
export interface PedidoPar {
  id: number | null;
  versao: number | null;
  fontePagadoraId: number | null;
  itemId: number;
  relacionadoId: number;
  tipo: (typeof TIPOS_RELACAO_PROCEDIMENTO)[number];
  exigeItem: boolean;
  quantidadeLimite: number | null;
  validadeDias: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
}
export interface PedidoExcecao {
  restricaoId: number | null;
  itemId: number | null;
  grupoId: number | null;
  justificativaId: number;
  quantidadeAutorizada: number | null;
  numeroGuia: string | null;
  observacao: string | null;
  tiposAtendimento: (typeof TIPOS_ATENDIMENTO_COBERTURA)[number][];
}
export interface PedidoConferencia {
  atendimentoId: number;
  data: string;
  hora: string;
  setorId?: number | null;
  profissionalId?: number | null;
  itens: { codigo?: string; itemId?: number; quantidade: number }[];
}

export const lerPainelCobertura = (fonte: number | null) =>
  ler(`${U}${fonte ? `?fonte=${fonte}` : ''}`, esquemaPainel);
export const buscarItensCobertura = (termo: string) =>
  ler(`${U}/itens?termo=${encodeURIComponent(termo)}`, z.array(esquemaItem));
export const gravarRestricao = (p: PedidoRestricao, chave: string) =>
  enviar(`${U}/restricoes`, p, esquemaGravado, chave);
export const gravarPar = (p: PedidoPar, chave: string) => enviar(`${U}/pares`, p, esquemaGravado, chave);
export const gravarJustificativa = (
  p: { codigo: string; descricao: string; textoPadrao: string | null },
  chave: string,
) => enviar(`${U}/justificativas`, p, esquemaGravado, chave);
export const lerExcecoesAtendimento = (atendimento: number) =>
  ler(`${U}/atendimentos/${atendimento}/excecoes`, esquemaExcecoes);
export const liberarExcecao = (atendimento: number, p: PedidoExcecao, chave: string) =>
  enviar(`${U}/atendimentos/${atendimento}/excecoes`, p, esquemaGravado, chave);
export const revogarExcecao = (id: number, versao: number, chave: string) =>
  enviar(`${U}/excecoes/${id}/revogacao`, { versao }, esquemaGravado, chave);
/** Aviso na prescrição (só leitura; o bloqueio do faturamento vira alerta). */
export const conferirCoberturaPrescricao = (p: PedidoConferencia, chave: string) =>
  enviar(`${U}/conferencia`, p, esquemaConferencia, chave);
/** Prévia do lançamento na conta (o que bloquearia e o que avisaria), só leitura. */
export const previaCoberturaLancamento = (p: PedidoConferencia, chave: string) =>
  enviar(`${U}/previa`, p, esquemaConferencia, chave);
