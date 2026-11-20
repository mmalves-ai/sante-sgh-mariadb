// W0-06, parte 5 (programa CRUD completo, M2 de mercado): avaliação de desempenho e de competências, alerta do fim do
// período de experiência (45 e 90 dias) e o PDI ligado aos cursos do treinamento. O mesmo Zod vale na tela e no
// servidor. O modelo (competências e escala de notas) é dado do dono: nasce vazio (D-W006-AVAL-MODELO).
//   - competência (tabela de domínio): inclusão; alteração com motivo (o valor anterior fica no histórico); inativação
//     com motivo; exclusão só da nunca usada (a usada: 409 com a contagem e a oferta da inativação);
//   - ciclo: escala de notas (2 a 10), prazo e tipo (periódico ou de experiência); alteração do aberto com motivo;
//     encerrar, cancelar e reabrir com motivo; exclusão só do ciclo sem avaliação;
//   - avaliação: rascunho (notas e parecer) -> finalizada -> ciente. A finalizada é imutável: a correção é versão nova
//     com justificativa (a anterior continua visível). A ciência é do próprio colaborador ou registrada pelo RH;
//   - PDI: ação de desenvolvimento ligada à competência e ao curso, com prazo; alteração da aberta com motivo,
//     conclusão e cancelamento com motivo (não se exclui).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { OpcaoPessoas } from './respostas.js';
import type { CorrecaoResposta } from './treinamento-respostas.js';

const id = z.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().trim().min(10, 'Explique com pelo menos 10 caracteres.'));
const opcional = (n: number) =>
  textoCp1252(n)
    .transform((s) => s.trim() || null)
    .nullable()
    .default(null);

// ── Competência ────────────────────────────────────────────────────────────────────────────────────────────────

const dadosCompetencia = {
  nome: textoCp1252(80).pipe(z.string().trim().min(2, 'Informe o nome da competência.')),
  descricao: opcional(2000),
};

export const esquemaIncluirCompetencia = z.object(dadosCompetencia).strict();
export type IncluirCompetenciaEntrada = z.infer<typeof esquemaIncluirCompetencia>;

export const esquemaAlterarCompetencia = z
  .object({ ...dadosCompetencia, competencia: id, versao, motivo })
  .strict();
export type AlterarCompetenciaEntrada = z.infer<typeof esquemaAlterarCompetencia>;

export const esquemaSituacaoCompetencia = z
  .object({ competencia: id, versao, ativo: z.boolean(), motivo })
  .strict();
export type SituacaoCompetenciaEntrada = z.infer<typeof esquemaSituacaoCompetencia>;

export const esquemaExcluirCompetencia = z.object({ competencia: id, versao, motivo }).strict();
export type ExcluirCompetenciaEntrada = z.infer<typeof esquemaExcluirCompetencia>;

export const esquemaLigarCompetenciaCargo = z.object({ cargo: id, competencia: id }).strict();
export type LigarCompetenciaCargoEntrada = z.infer<typeof esquemaLigarCompetenciaCargo>;

export const esquemaDesligarCompetenciaCargo = z.object({ cargo: id, competencia: id, motivo }).strict();
export type DesligarCompetenciaCargoEntrada = z.infer<typeof esquemaDesligarCompetenciaCargo>;

// ── Ciclo ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_CICLO_AVALIACAO = ['periodico', 'experiencia'] as const;
export const SITUACOES_CICLO_AVALIACAO = ['aberto', 'encerrado', 'cancelado'] as const;

const dadosCiclo = z
  .object({
    nome: textoCp1252(80).pipe(z.string().trim().min(2, 'Informe o nome do ciclo.')),
    tipo: z.enum(TIPOS_CICLO_AVALIACAO),
    inicio: data,
    fim: data,
    prazo: data,
    notaMax: z.number().int().min(2, 'A escala vai de 1 a pelo menos 2.').max(10, 'A escala vai até 10.'),
  })
  .strict();
const datasDoCiclo = <T extends { inicio: string; fim: string; prazo: string }>(x: T, c: z.RefinementCtx) => {
  if (x.fim < x.inicio) c.addIssue({ code: 'custom', path: ['fim'], message: 'O fim é antes do início.' });
  if (x.prazo < x.inicio)
    c.addIssue({ code: 'custom', path: ['prazo'], message: 'O prazo é antes do início.' });
};

export const esquemaIncluirCiclo = dadosCiclo.superRefine(datasDoCiclo);
export type IncluirCicloEntrada = z.infer<typeof esquemaIncluirCiclo>;

export const esquemaAlterarCiclo = dadosCiclo
  .extend({ ciclo: id, versao, motivo })
  .strict()
  .superRefine(datasDoCiclo);
export type AlterarCicloEntrada = z.infer<typeof esquemaAlterarCiclo>;

/** Encerrar, cancelar ou reabrir (aberto) o ciclo, com motivo. */
export const esquemaSituacaoCiclo = z
  .object({ ciclo: id, versao, situacao: z.enum(SITUACOES_CICLO_AVALIACAO), motivo })
  .strict();
export type SituacaoCicloEntrada = z.infer<typeof esquemaSituacaoCiclo>;

export const esquemaExcluirCiclo = z.object({ ciclo: id, versao, motivo }).strict();
export type ExcluirCicloEntrada = z.infer<typeof esquemaExcluirCiclo>;

// ── Avaliação ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Abre a avaliação em rascunho, com as competências ativas do cargo do colaborador. */
export const esquemaAbrirAvaliacao = z
  .object({
    ciclo: id,
    vinculo: id,
    /** Só no ciclo de experiência: o marco (45 ou 90 dias). */
    marco: z
      .union([z.literal(45), z.literal(90)])
      .nullable()
      .default(null),
    /** O login de quem avalia (vazio: quem abre). */
    avaliador: opcional(31),
  })
  .strict();
export type AbrirAvaliacaoEntrada = z.infer<typeof esquemaAbrirAvaliacao>;

export const esquemaNotasAvaliacao = z
  .object({
    avaliacao: id,
    versao,
    parecer: opcional(2000),
    notas: z
      .array(
        z
          .object({
            competencia: id,
            nota: z.number().int().min(1).max(10).nullable(),
            comentario: opcional(1000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type NotasAvaliacaoEntrada = z.infer<typeof esquemaNotasAvaliacao>;

export const esquemaFinalizarAvaliacao = z.object({ avaliacao: id, versao }).strict();
export type FinalizarAvaliacaoEntrada = z.infer<typeof esquemaFinalizarAvaliacao>;

/** A ciência do próprio colaborador (a observação registra a discordância, se houver). */
export const esquemaCienciaPropria = z.object({ avaliacao: id, versao, observacao: opcional(2000) }).strict();
export type CienciaPropriaEntrada = z.infer<typeof esquemaCienciaPropria>;

/** A ciência registrada pelo RH (colhida em papel): a observação diz como e quando foi colhida. */
export const esquemaCienciaRegistrada = z
  .object({
    avaliacao: id,
    versao,
    observacao: textoCp1252(2000).pipe(
      z.string().trim().min(10, 'Diga como e quando a ciência foi colhida (pelo menos 10 caracteres).'),
    ),
  })
  .strict();
export type CienciaRegistradaEntrada = z.infer<typeof esquemaCienciaRegistrada>;

/** Correção da finalizada: versão nova em rascunho com as notas copiadas; a anterior fica guardada. */
export const esquemaCorrigirAvaliacao = z.object({ avaliacao: id, versao, motivo }).strict();
export type CorrigirAvaliacaoEntrada = z.infer<typeof esquemaCorrigirAvaliacao>;

export const esquemaExcluirAvaliacao = z.object({ avaliacao: id, versao, motivo }).strict();
export type ExcluirAvaliacaoEntrada = z.infer<typeof esquemaExcluirAvaliacao>;

// ── PDI ────────────────────────────────────────────────────────────────────────────────────────────────────────

const dadosPdi = {
  avaliacao: id.nullable().default(null),
  competencia: id.nullable().default(null),
  curso: id.nullable().default(null),
  acao: textoCp1252(400).pipe(z.string().trim().min(5, 'Descreva a ação de desenvolvimento.')),
  prazo: data,
};

export const esquemaIncluirPdi = z.object({ ...dadosPdi, vinculo: id }).strict();
export type IncluirPdiEntrada = z.infer<typeof esquemaIncluirPdi>;

export const esquemaAlterarPdi = z.object({ ...dadosPdi, pdi: id, versao, motivo }).strict();
export type AlterarPdiEntrada = z.infer<typeof esquemaAlterarPdi>;

/** Concluir (com a data) ou cancelar a ação do PDI, com motivo. */
export const esquemaSituacaoPdi = z
  .object({
    pdi: id,
    versao,
    situacao: z.enum(['concluida', 'cancelada']),
    concluidaEm: data.nullable().default(null),
    motivo,
  })
  .strict()
  .refine((x) => x.situacao !== 'concluida' || x.concluidaEm !== null, {
    path: ['concluidaEm'],
    message: 'Informe a data da conclusão.',
  });
export type SituacaoPdiEntrada = z.infer<typeof esquemaSituacaoPdi>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CompetenciaResposta {
  readonly id: number;
  readonly nome: string;
  readonly descricao: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  /** Cargos aos quais a competência está ligada. */
  readonly cargos: readonly number[];
}

export interface CompetenciaDoCargoResposta {
  readonly cargo: number;
  readonly competencia: number;
  readonly nome: string;
  readonly ativa: boolean;
}

export interface CicloAvaliacaoResposta {
  readonly id: number;
  readonly nome: string;
  readonly tipo: (typeof TIPOS_CICLO_AVALIACAO)[number];
  readonly inicio: string;
  readonly fim: string;
  readonly prazo: string;
  readonly notaMax: number;
  readonly situacao: (typeof SITUACOES_CICLO_AVALIACAO)[number];
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  /** Avaliações em vigor (sem versão posterior) por situação. */
  readonly avaliacoes: { readonly rascunho: number; readonly finalizada: number; readonly ciente: number };
}

export interface NotaAvaliacaoResposta {
  readonly competencia: number;
  readonly nome: string;
  readonly nota: number | null;
  readonly comentario: string | null;
}

export interface AvaliacaoResposta {
  readonly id: number;
  readonly ciclo: number;
  readonly vinculo: number;
  readonly colaborador: string;
  readonly cargo: number | null;
  readonly marco: 45 | 90 | null;
  readonly avaliador: string;
  /** 1 na original; +1 a cada correção. */
  readonly numero: number;
  readonly anterior: number | null;
  readonly motivoCorrecao: string | null;
  /** Corrigida por uma versão posterior (fica guardada, fora de vigor). */
  readonly substituida: boolean;
  readonly situacao: 'rascunho' | 'finalizada' | 'ciente';
  readonly parecer: string | null;
  readonly finalizadaPor: string | null;
  readonly finalizadaEm: string | null;
  readonly cienciaPor: string | null;
  readonly cienciaEm: string | null;
  readonly cienciaModo: 'proprio' | 'registrada' | null;
  readonly cienciaObs: string | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

export interface FichaAvaliacao {
  readonly avaliacao: AvaliacaoResposta;
  readonly ciclo: CicloAvaliacaoResposta;
  readonly notas: readonly NotaAvaliacaoResposta[];
  /** Todas as versões (a original e as correções), da mais nova para a mais antiga, com as notas de cada uma. */
  readonly versoes: readonly {
    readonly avaliacao: AvaliacaoResposta;
    readonly notas: readonly NotaAvaliacaoResposta[];
  }[];
  /** O que a sessão pode fazer nesta avaliação. */
  readonly acoes: {
    readonly lancar: boolean;
    readonly finalizar: boolean;
    readonly excluir: boolean;
    readonly corrigir: boolean;
    readonly cienciaPropria: boolean;
    readonly cienciaRegistrada: boolean;
  };
}

export interface FichaCicloAvaliacao {
  readonly ciclo: CicloAvaliacaoResposta;
  readonly avaliacoes: readonly AvaliacaoResposta[];
  readonly correcoes: readonly CorrecaoResposta[];
}

export interface AlertaExperienciaResposta {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly marco: 45 | 90;
  readonly data: string;
  /** Dias até o marco (0: hoje; negativo: passou sem a avaliação daquele marco). */
  readonly dias: number;
  readonly situacao: 'proximo' | 'hoje' | 'vencido';
}

export interface PdiResposta {
  readonly id: number;
  readonly vinculo: number;
  readonly avaliacao: number | null;
  readonly competencia: number | null;
  readonly competenciaNome: string | null;
  readonly curso: number | null;
  readonly cursoTitulo: string | null;
  /** A conclusão do curso pelo colaborador numa turma (aprovado ou sem avaliação), se houver. */
  readonly cursoConcluidoEm: string | null;
  readonly acao: string;
  readonly prazo: string;
  readonly situacao: 'aberta' | 'concluida' | 'cancelada';
  readonly concluidaEm: string | null;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

/** As avaliações (todas as versões) e o PDI de um colaborador, com o histórico das correções do PDI. */
export interface AvaliacoesDoColaborador {
  readonly avaliacoes: readonly AvaliacaoResposta[];
  readonly pdi: readonly PdiResposta[];
  readonly correcoes: readonly CorrecaoResposta[];
}

export interface ApoioAvaliacao {
  readonly hoje: string;
  readonly cargos: readonly OpcaoPessoas[];
  readonly cursos: readonly OpcaoPessoas[];
  /** Liberação da chave `pessoas.colaborador` no estabelecimento e o motivo, se desligada. */
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: { readonly gerir: boolean; readonly motivo: string | null };
}

export interface ListaCompetencias {
  readonly competencias: readonly CompetenciaResposta[];
  readonly correcoes: readonly CorrecaoResposta[];
}

export interface ResultadoAvaliacaoDesempenho {
  readonly id: number;
  readonly mensagem: string;
}
