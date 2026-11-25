// Cliente da consolidação gerencial (C2-101, 07-FIN linha 127, F8): o grupo de consolidação com os estabelecimentos,
// o plano gerencial comum, o de-para das contas, a prévia da apuração mensal com a eliminação entre empresas (CPC 36),
// a apuração e a liberação da competência e a DRE e o balanço consolidados. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção); as respostas são conferidas na forma pelo zod.
import type { Balanco, Dre } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-contabil.js';

const P = '/api/contabil/consolidacao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export type MetodoConsolidacaoTela = 'integral' | 'proporcional' | 'equivalencia_patrimonial';
export type TipoContaGerencial = 'sintetica' | 'analitica';

const esquemaApoio = z.object({
  estabelecimentos: z.array(z.object({ id: z.number(), nome: z.string() })),
  grupos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      nome: z.string(),
      situacao: z.string(),
      membros: z.number(),
    }),
  ),
  metodos: z.array(z.string()),
  naturezas: z.array(z.string()),
});
export type ApoioConsolidacao = z.infer<typeof esquemaApoio>;

const esquemaDetalhe = z.object({
  grupo: z.object({
    id: z.number(),
    codigo: z.string(),
    nome: z.string(),
    vigenciaInicio: z.string(),
    vigenciaFim: z.string().nullable(),
    eliminaEntreEmpresas: z.boolean(),
    situacao: z.string(),
    observacao: z.string().nullable(),
    versao: z.number(),
  }),
  membros: z.array(
    z.object({
      estabelecimento: z.number(),
      nome: z.string(),
      percentual: z.number(),
      metodo: z.string(),
      consolidadora: z.boolean(),
    }),
  ),
  gerenciais: z.array(
    z.object({
      id: z.number(),
      classificacao: z.string(),
      descricao: z.string(),
      natureza: z.string(),
      tipo: z.string(),
      nivel: z.number(),
    }),
  ),
  depara: z.array(
    z.object({
      conta: z.number(),
      estabelecimento: z.number(),
      classificacao: z.string(),
      descricao: z.string(),
      natureza: z.string(),
      gerencial: z.number().nullable(),
    }),
  ),
  apuracoes: z.array(
    z.object({
      id: z.number(),
      competencia: z.string(),
      situacao: z.string(),
      eliminado: z.number(),
      liberadoEm: z.string().nullable(),
      versao: z.number(),
    }),
  ),
});
export type DetalheGrupo = z.infer<typeof esquemaDetalhe>;

const esquemaPrevia = z.object({
  competencia: z.string(),
  rodadaVigente: z.object({ id: z.number(), situacao: z.string(), versao: z.number() }).nullable(),
  totais: z.array(
    z.object({
      gerencial: z.number(),
      classificacao: z.string(),
      descricao: z.string(),
      anterior: z.number(),
      debitos: z.number(),
      creditos: z.number(),
      final: z.number(),
      eliminado: z.number(),
    }),
  ),
  eliminacoes: z.array(
    z.object({
      sequencia: z.number(),
      transacao: z.number(),
      valor: z.number(),
      origemNome: z.string(),
      contraparteNome: z.string(),
      debitoNome: z.string(),
      creditoNome: z.string(),
    }),
  ),
  pendencias: z.array(
    z.object({
      tipo: z.string(),
      estabelecimentoNome: z.string(),
      contaNome: z.string(),
      transacao: z.number().nullable(),
      valor: z.number(),
    }),
  ),
  totalEliminado: z.number(),
  conferencia: z.string(),
});
export type PreviaConsolidacao = z.infer<typeof esquemaPrevia>;

const esquemaDemonstracoes = z.object({
  competencia: z.string(),
  rodada: z.object({ id: z.number(), situacao: z.string(), versao: z.number() }).nullable(),
  dre: confiar<Omit<Dre, 'empresa' | 'de' | 'ate'>>(),
  balanco: confiar<Omit<Balanco, 'empresa' | 'competencia' | 'data'>>(),
});
export type DemonstracoesConsolidadas = z.infer<typeof esquemaDemonstracoes>;

const esquemaGravacao = z.object({
  mensagem: z.string(),
  repetida: z.boolean(),
  resultado: z.record(z.string(), z.unknown()),
});
export type GravacaoConsolidacao = z.infer<typeof esquemaGravacao>;

export const lerApoioConsolidacao = () => ler(`${P}/apoio`, esquemaApoio);
export const lerGrupoConsolidacao = (grupo: number, exercicio: number) =>
  ler(`${P}/grupos/${grupo}${qs({ exercicio })}`, esquemaDetalhe);
export const lerPreviaConsolidacao = (grupo: number, competencia: string) =>
  ler(`${P}/grupos/${grupo}/previa${qs({ competencia })}`, esquemaPrevia);
export const lerDemonstracoesConsolidadas = (grupo: number, competencia: string) =>
  ler(`${P}/grupos/${grupo}/demonstracoes${qs({ competencia })}`, esquemaDemonstracoes);

export interface MembroTela {
  readonly estabelecimento: number;
  readonly percentual: number;
  readonly metodo: MetodoConsolidacaoTela;
  readonly consolidadora: boolean;
}
export interface GrupoTela {
  readonly grupo: number | null;
  readonly versao: number | null;
  readonly codigo: string;
  readonly nome: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly eliminaEntreEmpresas: boolean;
  readonly observacao: string | null;
  readonly membros: readonly MembroTela[];
}
export const salvarGrupoConsolidacao = (g: GrupoTela) =>
  enviar(`${P}/grupos`, g, esquemaGravacao, novaChave('consolidacao-grupo'));

export interface ContaGerencialTela {
  readonly exercicio: number;
  readonly classificacao: string;
  readonly descricao: string;
  readonly natureza: string;
  readonly tipo: TipoContaGerencial;
}
export const incluirContaGerencial = (c: ContaGerencialTela) =>
  enviar(`${P}/contas-gerenciais`, c, esquemaGravacao, novaChave('consolidacao-conta'));

export const salvarDeParaConsolidacao = (
  grupo: number,
  itens: readonly { conta: number; gerencial: number | null }[],
) => enviar(`${P}/grupos/${grupo}/depara`, { itens }, esquemaGravacao, novaChave('consolidacao-depara'));

export const apurarConsolidacao = (grupo: number, competencia: string) =>
  enviar(`${P}/grupos/${grupo}/apurar`, { competencia }, esquemaGravacao, novaChave('consolidacao-apurar'));

export const liberarConsolidacao = (apuracao: number, versao: number) =>
  enviar(
    `${P}/apuracoes/${apuracao}/liberar`,
    { versao },
    esquemaGravacao,
    novaChave('consolidacao-liberar'),
  );
