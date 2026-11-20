// W0-06, parte 6 (programa CRUD completo, M3 de mercado): as solicitações do autoatendimento do colaborador e a fila de
// aprovação do gestor. O mesmo Zod vale na tela e no servidor; as regras que dependem do estado (dias no passado, dias
// do atestado, quem decide e quem desiste) ficam em @sgh/dominio-pessoas e o banco confere de novo (script 1067).
//   - o colaborador pede (`pessoas.autoatendimento.solicitar`, toda pessoa, só o próprio vínculo) férias, abono, ajuste
//     de ponto, alteração cadastral ou atestado, e desiste com motivo enquanto pendente (só quem pediu);
//   - o gestor ou o RH (`pessoas.autoatendimento.aprovar`) aprova ou recusa com motivo; a aprovação grava o efeito na
//     mesma transação (férias programadas, ajustes do ponto, correção do cadastro com o valor anterior);
//   - o atestado (dado de saúde, LGPD arts. 11 e 46) só se lê com finalidade, e cada leitura fica na trilha; o CID só com
//     `pessoas.atestado.verCid` (restrita) e pedido expresso (D-W006-ATESTADO-LGPD).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaInstanteEscala } from './escala-entradas.js';
import { CODIGOS_TIPO_AJUSTE, type TipoAjuste } from './ponto-vocabulario.js';

export const TIPOS_SOLICITACAO_PESSOA = {
  ferias: 'Férias',
  abono: 'Abono de falta ou atraso',
  ajuste_ponto: 'Ajuste de ponto',
  alteracao_cadastral: 'Alteração cadastral',
  atestado: 'Atestado',
} as const;
export type TipoSolicitacaoPessoaContrato = keyof typeof TIPOS_SOLICITACAO_PESSOA;
export const CODIGOS_TIPO_SOLICITACAO_PESSOA = Object.keys(
  TIPOS_SOLICITACAO_PESSOA,
) as TipoSolicitacaoPessoaContrato[];

export const SITUACOES_SOLICITACAO_PESSOA = {
  pendente: 'Aguardando o gestor',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  desistida: 'Desistência',
} as const;
export type SituacaoSolicitacaoPessoaContrato = keyof typeof SITUACOES_SOLICITACAO_PESSOA;
export const CODIGOS_SITUACAO_SOLICITACAO_PESSOA = Object.keys(
  SITUACOES_SOLICITACAO_PESSOA,
) as SituacaoSolicitacaoPessoaContrato[];

/** O que o colaborador pode pedir para corrigir: só o que o cadastro do colaborador guarda (D-W006-SOLIC-CADASTRO). */
export const CAMPOS_ALTERACAO_CADASTRAL_PESSOA = { nome: 'Nome' } as const;
export type CampoAlteracaoCadastralPessoa = keyof typeof CAMPOS_ALTERACAO_CADASTRAL_PESSOA;

export const TIPOS_ARQUIVO_ATESTADO = ['application/pdf', 'image/jpeg', 'image/png'] as const;
/** 10 MB (CHECK do banco). */
export const TETO_ARQUIVO_ATESTADO = 10_485_760;

const id = z.number().int().positive();
const idTexto = z.coerce.number().int().positive();
const versao = z.number().int().min(0);
const data = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Data no formato AAAA-MM-DD.');
const motivo = textoCp1252(400).pipe(z.string().trim().min(10, 'Explique com pelo menos 10 caracteres.'));
const observacaoOpcional = textoCp1252(400)
  .transform((s) => s.trim() || null)
  .nullable()
  .default(null);
const codigoDominio = z.number().int().min(0).max(99_999);
/** CID-10: letra, dois dígitos e, se houver, a subcategoria (A09, J11.1, F320). */
export const esquemaCid10 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/, 'CID-10 no formato A00 ou A00.0.');

/** O vínculo, quando a pessoa tem mais de um (senão o servidor usa o do login). Nunca de outra pessoa. */
const vinculo = id.nullable().default(null);

const ferias = z
  .object({
    tipo: z.literal('ferias'),
    vinculo,
    inicio: data,
    diasGozo: z
      .number()
      .int()
      .min(5, 'As férias têm pelo menos 5 dias.')
      .max(30, 'As férias vão até 30 dias.'),
    diasAbono: z.number().int().min(0).max(10, 'O abono pecuniário vai até 10 dias.').default(0),
    adiantaDecimo: z.boolean().default(false),
    observacao: observacaoOpcional,
  })
  .strict();

const abono = z
  .object({
    tipo: z.literal('abono'),
    vinculo,
    inicio: data,
    fim: data,
    /** O tipo de movimento do ponto (falta justificada, folga...); o gestor pode trocar na aprovação. */
    movimento: codigoDominio.nullable().default(null),
    justificativa: codigoDominio.nullable().default(null),
    observacao: motivo,
  })
  .strict();

const ajustePonto = z
  .object({
    tipo: z.literal('ajuste_ponto'),
    vinculo,
    dia: data,
    ajuste: z.enum(CODIGOS_TIPO_AJUSTE as [TipoAjuste, ...TipoAjuste[]]),
    marcacao: id.nullable().default(null),
    instante: esquemaInstanteEscala.nullable().default(null),
    movimento: codigoDominio.nullable().default(null),
    justificativa: codigoDominio.nullable().default(null),
    periodo: codigoDominio.nullable().default(null),
    minutos: z.number().int().min(1).max(1440).nullable().default(null),
    observacao: motivo,
  })
  .strict();

const alteracaoCadastral = z
  .object({
    tipo: z.literal('alteracao_cadastral'),
    vinculo,
    campo: z.enum(Object.keys(CAMPOS_ALTERACAO_CADASTRAL_PESSOA) as [CampoAlteracaoCadastralPessoa]),
    valorNovo: textoCp1252(70).pipe(z.string().trim().min(3, 'Informe o valor correto.')),
    observacao: motivo,
  })
  .strict();

export const esquemaArquivoAtestado = z
  .object({
    chave: textoCp1252(200).pipe(z.string().min(1)),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 em hexadecimal.'),
    tipo: z.enum(TIPOS_ARQUIVO_ATESTADO),
    tamanho: z.number().int().min(1).max(TETO_ARQUIVO_ATESTADO, 'O arquivo vai até 10 MB.'),
  })
  .strict();

const atestado = z
  .object({
    tipo: z.literal('atestado'),
    vinculo,
    inicio: data,
    fim: data,
    movimento: codigoDominio.nullable().default(null),
    atestado: z
      .object({
        emitidoEm: data,
        dias: z.number().int().min(1).max(365),
        /** Opcional: só quem tem `pessoas.atestado.verCid` vê depois, e cada leitura fica na trilha. */
        cid: esquemaCid10.nullable().default(null),
        emitente: textoCp1252(80).pipe(z.string().trim().min(3, 'Informe quem emitiu o atestado.')),
        registroConselho: textoCp1252(30)
          .transform((s) => s.trim() || null)
          .nullable()
          .default(null),
        arquivo: esquemaArquivoAtestado.nullable().default(null),
      })
      .strict(),
    observacao: observacaoOpcional,
  })
  .strict();

export const esquemaIncluirSolicitacao = z
  .discriminatedUnion('tipo', [ferias, abono, ajustePonto, alteracaoCadastral, atestado])
  .superRefine((s, ctx) => {
    if ((s.tipo === 'abono' || s.tipo === 'atestado') && s.fim < s.inicio)
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O último dia vem depois do primeiro.' });
    if (s.tipo === 'ajuste_ponto') {
      if (s.ajuste === 'inclusao' && !s.instante)
        ctx.addIssue({
          code: 'custom',
          path: ['instante'],
          message: 'Informe o horário da marcação que faltou.',
        });
      if (s.ajuste === 'desconsiderar' && s.marcacao === null)
        ctx.addIssue({ code: 'custom', path: ['marcacao'], message: 'Escolha a marcação a desconsiderar.' });
      if (s.ajuste === 'justificativa' && s.movimento === null)
        ctx.addIssue({ code: 'custom', path: ['movimento'], message: 'Escolha o tipo da justificativa.' });
    }
  });
export type IncluirSolicitacaoEntrada = z.infer<typeof esquemaIncluirSolicitacao>;

export const esquemaDesistirSolicitacao = z.object({ solicitacao: id, versao, motivo }).strict();
export type DesistirSolicitacaoEntrada = z.infer<typeof esquemaDesistirSolicitacao>;

export const esquemaDecidirSolicitacao = z
  .object({
    solicitacao: id,
    versao,
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: textoCp1252(400)
      .transform((s) => s.trim() || null)
      .nullable()
      .default(null),
    /** Abono e atestado: o tipo de movimento do ponto que o gestor confirma (obrigatório na aprovação sem o do pedido). */
    movimento: codigoDominio.nullable().default(null),
    justificativa: codigoDominio.nullable().default(null),
    /** Férias: a empresa da folha (sem ela, a única que houver) e o período aquisitivo (sem ele, o mais antigo com saldo). */
    empresa: z.number().int().min(0).max(32_767).nullable().default(null),
    aquisitivoInicio: data.nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.decisao === 'recusar' && (d.motivo ?? '').length < 10)
      ctx.addIssue({
        code: 'custom',
        path: ['motivo'],
        message: 'Explique a recusa com pelo menos 10 caracteres.',
      });
  });
export type DecidirSolicitacaoEntrada = z.infer<typeof esquemaDecidirSolicitacao>;

export const esquemaFiltroMinhasSolicitacoes = z
  .object({
    vinculo: idTexto.optional(),
    situacao: z.enum(CODIGOS_SITUACAO_SOLICITACAO_PESSOA as [SituacaoSolicitacaoPessoaContrato]).optional(),
  })
  .strict();
export type FiltroMinhasSolicitacoes = z.infer<typeof esquemaFiltroMinhasSolicitacoes>;

export const esquemaFiltroFilaSolicitacoes = z
  .object({
    situacao: z
      .enum(CODIGOS_SITUACAO_SOLICITACAO_PESSOA as [SituacaoSolicitacaoPessoaContrato])
      .default('pendente'),
    tipo: z.enum(CODIGOS_TIPO_SOLICITACAO_PESSOA as [TipoSolicitacaoPessoaContrato]).optional(),
    unidade: z.coerce.number().int().min(0).max(32_767).optional(),
  })
  .strict();
export type FiltroFilaSolicitacoes = z.infer<typeof esquemaFiltroFilaSolicitacoes>;

/** A leitura do atestado: a finalidade fica na trilha; o CID só com pedido expresso e a permissão restrita. */
export const esquemaLerAtestado = z
  .object({
    finalidade: textoCp1252(200).pipe(z.string().trim().min(5, 'Diga para que vai ler o atestado.')),
    verCid: z.boolean().default(false),
  })
  .strict();
export type LerAtestadoEntrada = z.infer<typeof esquemaLerAtestado>;

// ── Respostas ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SolicitacaoPessoaResposta {
  readonly id: number;
  readonly vinculo: number;
  /** Nome e matrícula do colaborador (na fila do gestor). */
  readonly colaborador: string | null;
  readonly matricula: string | null;
  readonly tipo: TipoSolicitacaoPessoaContrato;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly diasGozo: number | null;
  readonly diasAbono: number | null;
  readonly adiantaDecimo: boolean | null;
  readonly movimento: number | null;
  readonly justificativa: number | null;
  readonly campo: string | null;
  readonly valorAnterior: string | null;
  readonly valorNovo: string | null;
  readonly observacao: string | null;
  readonly situacao: SituacaoSolicitacaoPessoaContrato;
  readonly pedidoPor: string;
  readonly pedidoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly motivoDecisao: string | null;
  /** As férias programadas pela aprovação. */
  readonly ferias: number | null;
  /** Os ajustes do ponto ligados (o pendente do ajuste; os aprovados do abono e do atestado). */
  readonly ajustes: readonly { readonly id: number; readonly dia: string; readonly situacao: string }[];
  readonly temAtestado: boolean;
  readonly versao: number;
  /** O que a pessoa da sessão pode fazer com ela agora. */
  readonly acoes: { readonly desistir: boolean; readonly decidir: boolean };
}

export interface ListaSolicitacoesPessoa {
  readonly hoje: string;
  readonly itens: readonly SolicitacaoPessoaResposta[];
  readonly limitado: boolean;
}

export interface ResultadoSolicitacaoPessoa {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
  readonly avisos: readonly string[];
  readonly solicitacao: SolicitacaoPessoaResposta | null;
}

export interface AtestadoPessoaResposta {
  readonly id: number;
  readonly solicitacao: number;
  readonly emitidoEm: string;
  readonly dias: number;
  /** Só com `pessoas.atestado.verCid` e `verCid`; senão null (veja `temCid`). */
  readonly cid: string | null;
  readonly temCid: boolean;
  readonly emitente: string;
  readonly registroConselho: string | null;
  readonly arquivo: { readonly tipo: string; readonly tamanho: number; readonly hash: string } | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  /** Mais de 15 dias: o RH encaminha o afastamento ao INSS (Lei 8.213, art. 60). */
  readonly avisoInss: boolean;
  /** A trilha de acesso (só para quem tem `pessoas.atestado.verCid`). */
  readonly acessos: readonly {
    readonly acessadoPor: string;
    readonly acessadoEm: string;
    readonly viuCid: boolean;
    readonly finalidade: string;
  }[];
}
