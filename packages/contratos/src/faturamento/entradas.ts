// Entradas das gravações da conta do paciente (M30; ficha, seção 5): o que as telas mandam e o executor valida (o mesmo
// Zod). A tela nunca manda número de item, total da conta, situação gravada nem data do fechamento: o banco e os gatilhos
// fazem. A versão é o carimbo DATA_HORA_ULTIMA_ATUALIZACAO como a tela leu (controle otimista; cap-10 §10.5).
import { z } from 'zod';
import { esquemaHora } from '../formatacao/hora.js';
import { esquemaRegraFaturabilidade } from './regras/faturabilidade.js';
import { FORMAS_PAGAMENTO } from './regras/particular.js';
import { idBanco } from '../validacao/id-banco.js';

/** Id de linha do banco (conta_hospitalar.id, conta_hospitalar_item.id...; BIGINT UNSIGNED). */
const id = idBanco;
/**
 * Código de negócio do item faturável (item_faturavel.codigo, VARCHAR(20) numérico, único no cliente): NÃO é id de
 * linha. A gravação busca por `codigo = ?`. Inteiro positivo seguro (o código vai ao banco como texto).
 */
const codigoItem = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const versao = z.string().min(10).max(40);
const texto = (max: number) => z.string().trim().max(max);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaFecharConta = z.object({ conta: id, versao }).strict();
export type FecharContaEntrada = z.infer<typeof esquemaFecharConta>;

export const esquemaReabrirConta = z
  .object({ conta: id, versao, motivo: texto(250).pipe(z.string().min(5)) })
  .strict();
export type ReabrirContaEntrada = z.infer<typeof esquemaReabrirConta>;

/** Conferência item a item ou em bloco (lotes curtos de até 200 itens). */
export const esquemaConferirItem = z
  .object({
    conta: id,
    itens: z.array(z.object({ id, versao }).strict()).min(1).max(200),
  })
  .strict();
export type ConferirItemEntrada = z.infer<typeof esquemaConferirItem>;

export const esquemaLancarItem = z
  .object({
    conta: id,
    tipo: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    /** Código do item no grupo: procedimento (2 e 3), operação da diária ou taxa (1), item de mat/med (4). */
    codigo: codigoItem,
    quantidade: z.number().positive().max(99_999),
    /** AAAA-MM-DD; a data-base do preço (regra 9). */
    data: z.string().regex(DATA),
    /** Hora do lançamento, "HH:MM" no fuso do estabelecimento. */
    hora: esquemaHora,
    local: z.number().int().min(0).max(9999),
    ato: z.number().int().min(0).max(999),
    executante: z.number().int().positive().nullable().default(null),
    /** Função do executor na equipe (funcao_equipe_cobranca); sem ela, a produção do repasse usa a função titular. */
    funcao: z.number().int().positive().nullable().default(null),
    /** Cirurgia múltipla: via de acesso cirúrgico e ordem do procedimento no ato (1 = principal), para a regra do acordo. */
    via: z
      .object({ acesso: z.number().int().positive(), ordem: z.number().int().min(1).max(99) })
      .strict()
      .nullable()
      .optional(),
    /** Preço manual (só com faturamento.preco.manual e dentro da faixa, ou com aprovação; regra 12). */
    precoManual: z
      .object({
        unitario: z.number().min(0).max(9_999_999),
        justificativa: texto(250),
        aprovador: texto(31).nullable(),
      })
      .strict()
      .nullable()
      .default(null),
    /** Documento de origem quando o fato é gravado pelo novo (prescrição, dispensação, laudo, nota de sala). */
    origem: z
      .object({
        tipo: z.enum(['prescricao', 'dispensacao', 'laudo', 'nota-sala', 'manual']),
        id: z.number().int().min(0),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type LancarItemEntrada = z.infer<typeof esquemaLancarItem>;

// ── Só no novo (SGH_) ─────────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarPendencia = z
  .object({
    conta: id,
    /** Tipo da pendência (0 = tipo próprio do produto: regra de faturabilidade, item sem preço). */
    tipo: z.number().int().min(0),
    descricao: texto(250).pipe(z.string().min(3)),
    bloqueante: z.boolean().default(true),
  })
  .strict();
export type RegistrarPendenciaEntrada = z.infer<typeof esquemaRegistrarPendencia>;

export const esquemaResolverPendencia = z
  .object({ id, resolucao: texto(250).pipe(z.string().min(3)) })
  .strict();

export const esquemaEtapaConta = z
  .object({
    conta: id,
    etapa: z.enum(['conferencia', 'auditoria']),
    acao: z.enum(['iniciar', 'concluir']),
    observacao: texto(250).default(''),
  })
  .strict();
export type EtapaContaEntrada = z.infer<typeof esquemaEtapaConta>;

export const DECISOES_LANCAMENTO_TARDIO = ['reabrir', 'complementar', 'descartar'] as const;
export const esquemaDecidirLancamentoTardio = z
  .object({
    /** A entrada da fila do lançamento após o fechamento. */
    registro: id,
    decisao: z.enum(DECISOES_LANCAMENTO_TARDIO),
    motivo: texto(250).pipe(z.string().min(5)),
  })
  .strict();
export type DecidirLancamentoTardioEntrada = z.infer<typeof esquemaDecidirLancamentoTardio>;

export const esquemaEditarRegraFaturabilidade = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    regra: esquemaRegraFaturabilidade,
    ativa: z.boolean().default(true),
  })
  .strict();
export type EditarRegraFaturabilidadeEntrada = z.infer<typeof esquemaEditarRegraFaturabilidade>;

export const esquemaEditarPacote = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    convenio: z.number().int().min(0),
    codigo: codigoItem,
    nome: texto(80).pipe(z.string().min(3)),
    valor: z.number().min(0).max(99_999_999),
    inicio: z.string().regex(DATA),
    fim: z.string().regex(DATA).nullable().default(null),
    itens: z
      .array(z.object({ codigo: codigoItem, quantidade: z.number().positive().max(9999) }).strict())
      .max(300),
    ativo: z.boolean().default(true),
  })
  .strict()
  .refine((p) => p.fim === null || p.fim >= p.inicio, { message: 'O fim é antes do início.', path: ['fim'] });
export type EditarPacoteEntrada = z.infer<typeof esquemaEditarPacote>;

export const esquemaRegistrarVersaoAuditoria = z
  .object({
    conta: id,
    parecer: texto(1000).pipe(z.string().min(5)),
    papel: z.enum(['enfermeiro', 'medico']),
  })
  .strict();
export type RegistrarVersaoAuditoriaEntrada = z.infer<typeof esquemaRegistrarVersaoAuditoria>;

export const esquemaRegistrarOrcamento = z
  .object({
    /** Prontuário do paciente, ou 0 quando ainda sem cadastro. */
    prontuario: z.number().int().min(0),
    nome: texto(80).pipe(z.string().min(3)),
    itens: z
      .array(
        z
          .object({
            descricao: texto(80).pipe(z.string().min(2)),
            quantidade: z.number().positive().max(9999),
            unitario: z.number().min(0).max(9_999_999),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    desconto: z.number().min(0).default(0),
    validadeDias: z.number().int().min(1).max(180).default(30),
    urgencia: z.boolean().default(false),
    /** Exigir garantia antes do atendimento: recusado na urgência (regra 12). */
    exigeGarantiaAntes: z.boolean().default(false),
  })
  .strict();
export type RegistrarOrcamentoEntrada = z.infer<typeof esquemaRegistrarOrcamento>;

export const esquemaAbrirCaixa = z.object({ saldoInicial: z.number().min(0).max(999_999) }).strict();
export const esquemaFecharCaixa = z.object({ id, contado: z.number().min(0).max(9_999_999) }).strict();

export const esquemaReceberParticular = z
  .object({
    caixa: id,
    orcamento: z.number().int().positive().nullable().default(null),
    conta: z.number().int().positive().nullable().default(null),
    pagamentos: z
      .array(
        z
          .object({
            forma: z.enum(FORMAS_PAGAMENTO),
            valor: z.number().positive().max(9_999_999),
            /** Comprovante registrado à mão (NSU, autorização) quando o conector não é usado. */
            comprovante: texto(40).nullable().default(null),
            parcelas: z.number().int().min(1).max(24).default(1),
            /**
             * Cartão: a administradora e a bandeira da venda. Com elas o recebimento grava a transação e as parcelas a
             * receber da administradora (líquidas da taxa vigente, com a data prevista do crédito).
             */
            cartao: z
              .object({
                administradora: id,
                bandeira: id,
                finalCartao: z
                  .string()
                  .regex(/^\d{4}$/)
                  .nullable()
                  .default(null),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .refine((r) => r.orcamento !== null || r.conta !== null, {
    message: 'Informe o orçamento ou a conta.',
    path: ['orcamento'],
  });
export type ReceberParticularEntrada = z.infer<typeof esquemaReceberParticular>;

export const esquemaEmitirRecibo = z
  .object({
    pagamento: id,
    pagador: texto(80).pipe(z.string().min(3)),
    referente: texto(250).pipe(z.string().min(3)),
  })
  .strict();
export type EmitirReciboEntrada = z.infer<typeof esquemaEmitirRecibo>;
