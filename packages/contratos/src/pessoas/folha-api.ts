// Entradas e respostas da API da interface com a folha externa (M53-F0; ficha do M53, seções 4 a 7, regras 3 a 6): o
// apoio da tela, a lista de lotes, a geração do lote da competência (com as pendências que o barram), a importação do
// retorno (com a conferência e o plano de títulos) e o afastamento do colaborador, que a exportação leva. Nenhuma
// resposta traz CPF ou nome: só vínculo (ID), matrícula, contagens e somas (convencoes.md §11). O arquivo do lote, com o
// CPF, só sai pela rota de download, com permissão sensível e trilha.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { DivergenciaLoteFolha, ResumoLoteFolha, SituacaoLoteFolha } from './folha-interface.js';

/** Chave de liberação da interface com a folha externa (SGH_CFG_LIBERACAO; nasce desligada, POL-3; D-CHAVE-531). */
export const CHAVE_PESSOAS_FOLHA_EXTERNA = 'pessoas.folhaExterna';

/** Situação do afastamento (SGH_PES_AFASTAMENTO.SITUACAO): o cancelado fica para a trilha, nunca é apagado. */
export const SITUACOES_AFASTAMENTO = { ativo: 'Em vigor', cancelado: 'Cancelado' } as const;
export type SituacaoAfastamento = keyof typeof SITUACOES_AFASTAMENTO;

/**
 * Pendências que barram a geração do lote (a tela traduz por `folha.interface.pendencia.<codigo>`):
 * - ponto-nao-fechado: vínculo da folha ativo na competência sem o período de ponto fechado;
 * - cpf-ilegivel: o CPF cifrado do vínculo não pôde ser lido (chave trocada ou registro danificado);
 * - evento-indisponivel: o período fechado traz um tipo de integração que não está mais cadastrado;
 * - sem-colaboradores: nenhum vínculo da folha na competência;
 * - competencia-lancada: a competência já tem títulos lançados (o lote não é refeito);
 * - competencia-futura: a competência ainda não começou.
 */
export const CODIGOS_PENDENCIA_EXPORTACAO = [
  'ponto-nao-fechado',
  'cpf-ilegivel',
  'evento-indisponivel',
  'sem-colaboradores',
  'competencia-lancada',
  'competencia-futura',
] as const;
export type CodigoPendenciaExportacao = (typeof CODIGOS_PENDENCIA_EXPORTACAO)[number];

/** Pendência da exportação: o código, quantos vínculos e os IDs deles (nunca nome nem CPF). */
export interface PendenciaExportacaoFolha {
  readonly codigo: CodigoPendenciaExportacao;
  readonly vinculos: readonly number[];
  /** O valor que explica a pendência (o tipo de integração ausente; zero quando não se aplica). */
  readonly valor: number;
}

/** Recusas do retorno antes da conferência (a tela traduz por `folha.interface.recusa.<codigo>`). */
export const CODIGOS_RECUSA_RETORNO = [
  'leiaute',
  'campo-assistencial',
  'lote-inexistente',
  'lote-substituido',
  'competencia-lancada',
] as const;
export type CodigoRecusaRetorno = (typeof CODIGOS_RECUSA_RETORNO)[number];

const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const smallint = z.coerce.number().int().min(0).max(32_767);
const id = z.coerce.number().int().positive();

/** Filtro da lista de lotes (`GET /api/pessoas/folha/lotes`). */
export const esquemaFiltroLotesFolha = z
  .object({
    empresa: smallint.optional(),
    competencia: competencia.optional(),
  })
  .strict();
export type FiltroLotesFolha = z.infer<typeof esquemaFiltroLotesFolha>;

/** Filtro dos afastamentos (`GET /api/pessoas/folha/afastamentos`). */
export const esquemaFiltroAfastamentos = z
  .object({
    competencia: competencia.optional(),
    vinculo: id.optional(),
  })
  .strict()
  .refine((f) => f.competencia !== undefined || f.vinculo !== undefined, {
    message: 'Informe a competência ou o colaborador.',
    path: ['competencia'],
  });
export type FiltroAfastamentos = z.infer<typeof esquemaFiltroAfastamentos>;

/** Registrar um afastamento (`pessoas.afastamento.registrar`). */
export const esquemaRegistrarAfastamento = z
  .object({
    vinculo: id,
    motivo: smallint,
    inicio: data,
    fim: data.nullable(),
    // Texto livre gravado no banco em CP1252: o caractere que não cabe é recusado com mensagem (não vira erro interno).
    observacao: textoCp1252(400).trim().nullable().default(null),
  })
  .strict();
export type RegistrarAfastamentoEntrada = z.infer<typeof esquemaRegistrarAfastamento>;

/** Encerrar (informar o fim) ou cancelar um afastamento, com a versão lida. */
export const esquemaAlterarAfastamento = z
  .object({
    versao: z.number().int().min(0),
    acao: z.enum(['encerrar', 'cancelar']),
    fim: data.nullable().default(null),
    motivo: textoCp1252(400).trim().nullable().default(null),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.acao === 'encerrar' && !x.fim)
      ctx.addIssue({ code: 'custom', message: 'Informe a data de fim.', path: ['fim'] });
    if (x.acao === 'cancelar' && !x.motivo)
      ctx.addIssue({ code: 'custom', message: 'Informe o motivo do cancelamento.', path: ['motivo'] });
  });
export type AlterarAfastamentoEntrada = z.infer<typeof esquemaAlterarAfastamento>;

export interface OpcaoFolha {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Apoio da tela `/pessoas/folha` (parte F0). */
export interface ApoioFolhaInterface {
  readonly hoje: string;
  /** A competência sugerida (a anterior à de hoje: a que o ponto acabou de fechar). */
  readonly competenciaSugerida: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly exportar: boolean;
    readonly importar: boolean;
    readonly afastamento: boolean;
    readonly motivo: string | null;
    /** Quem tem a busca da gestão de pessoas filtra os afastamentos por colaborador (e vê o nome do escolhido). */
    readonly buscarColaborador: boolean;
  };
  readonly empresas: readonly OpcaoFolha[];
  readonly eventosPonto: readonly OpcaoFolha[];
  readonly motivosAfastamento: readonly OpcaoFolha[];
  /** Remessas antigas do outro sistema (só leitura). */
  readonly remessas: readonly {
    readonly id: number;
    readonly empresa: number;
    readonly competencia: string;
    readonly tipoFolha: string;
    readonly fechada: boolean;
  }[];
}

export interface ListaLotesFolha {
  readonly itens: readonly ResumoLoteFolha[];
  readonly limitado: boolean;
}

/** Resultado da geração: o lote gravado (situação `gerado`) ou as pendências que o barraram (nada gravado). */
export interface ResultadoExportacaoFolha {
  readonly gerado: boolean;
  readonly lote: ResumoLoteFolha | null;
  readonly pendencias: readonly PendenciaExportacaoFolha[];
  /** A conta impressa dos totais: "12 colaboradores; ponto 4 eventos = 9.600 min; plantões 2 = 1.440 min". */
  readonly conta: string;
  /** O lote anterior da mesma empresa e competência que virou `substituido`. */
  readonly substituido: number | null;
}

/** Resultado da importação do retorno: o lote recebido, a conferência e o plano de títulos (o lançamento é do F8). */
export interface ResultadoImportacaoFolha {
  readonly lote: ResumoLoteFolha;
  readonly situacao: SituacaoLoteFolha;
  readonly divergencias: readonly DivergenciaLoteFolha[];
  readonly podeLancar: boolean;
  /** "líquido R$ x + INSS R$ y + … = R$ total" (as parcelas impressas). */
  readonly contaTitulos: string;
  readonly totalTitulos: number;
  /** Linhas gravadas em SGH_PES_FOLHA_RESUMO (só quando conferido). */
  readonly linhasResumo: number;
}

export interface AfastamentoResposta {
  readonly id: number;
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly motivo: number;
  readonly motivoRotulo: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly observacao: string | null;
  readonly situacao: SituacaoAfastamento;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
}

export interface ListaAfastamentos {
  readonly itens: readonly AfastamentoResposta[];
}

export interface ResultadoFolha {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}
