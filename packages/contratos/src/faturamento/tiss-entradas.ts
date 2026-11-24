// Entradas das gravações do pós-fechamento (M31; ficha, seção 5): o que as telas mandam e o executor valida (o mesmo
// Zod). A tela nunca manda número de lote, sequencial, data do lote nem situação da conta: o contador do outro sistema
// (sob trava) e o banco fazem. A versão de cada item é o carimbo da última atualização como a tela leu
// (controle otimista por item; cap-10 §10.5).
import { z } from 'zod';

const id = z.number().int().positive();
const versao = z.string().min(10).max(40);
const texto = (max: number) => z.string().trim().max(max);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const data = z.string().regex(DATA);
const dinheiro = z.number().min(0).max(99_999_999);
const quantidade = z.number().min(0).max(999_999);

/** faturamento.gerarLote: um convênio, um tipo de guia, 1 a 100 contas (o XSD aceita até 100 guias por lote). */
export const esquemaGerarLote = z
  .object({
    convenio: z.number().int().min(0).max(32_767),
    tipoGuia: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    contas: z.array(z.object({ id, versao }).strict()).min(1).max(100),
  })
  .strict();
export type GerarLoteEntrada = z.infer<typeof esquemaGerarLote>;

/** faturamento.registrarProtocolo: registrar ou limpar; o número normalizado no servidor (regra 5). */
export const esquemaRegistrarProtocolo = z
  .object({
    lote: id,
    acao: z.enum(['registrar', 'limpar']),
    protocolo: z.string().max(64),
    /** Data do protocolo informada (a do comprovante), a recibo e a situação TISS (1..10). */
    data: data.nullable().default(null),
    recibo: texto(60).default(''),
    situacao: z.number().int().min(1).max(10).nullable().default(null),
  })
  .strict();
export type RegistrarProtocoloEntrada = z.infer<typeof esquemaRegistrarProtocolo>;

/** faturamento.registrarGlosa: baixa e conciliação item a item (lotes curtos; controle otimista por item). */
export const esquemaRegistrarGlosa = z
  .object({
    itens: z
      .array(
        z
          .object({
            item: id,
            versao,
            valorPago: dinheiro,
            quantidadePaga: quantidade,
            /** Código do motivo de glosa (tabela 38 da TISS); 0 = não informado (só sem glosa). */
            motivo: z.number().int().min(0).max(99_999_999),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    /** Data do pagamento do demonstrativo (DT_PG). */
    dataPagamento: data,
    /** Demonstrativo importado de onde veio a baixa (opcional: digitação assistida sem demonstrativo). */
    demonstrativo: id.nullable().default(null),
  })
  .strict();
export type RegistrarGlosaEntrada = z.infer<typeof esquemaRegistrarGlosa>;

/** faturamento.registrarRecurso: VLR_RE, QTD_RE e DT_RE; DT_RE é a data do protocolo do recurso informada. */
export const esquemaRegistrarRecurso = z
  .object({
    itens: z
      .array(
        z
          .object({
            item: id,
            versao,
            valor: dinheiro.nullable().default(null),
            quantidade: quantidade.nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    dataProtocolo: data,
  })
  .strict();
export type RegistrarRecursoEntrada = z.infer<typeof esquemaRegistrarRecurso>;

/** faturamento.registrarRetornoRecurso: acatado, parcial ou negado; demonstrativo obrigatório. */
export const esquemaRegistrarRetornoRecurso = z
  .object({
    itens: z
      .array(
        z
          .object({
            item: id,
            versao,
            desfecho: z.enum(['acatado', 'parcial', 'negado']),
            valor: dinheiro.nullable().default(null),
            motivo: z.number().int().min(0).max(99_999_999).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    data,
    numeroDemonstrativo: texto(20).pipe(z.string().min(1)),
  })
  .strict();
export type RegistrarRetornoRecursoEntrada = z.infer<typeof esquemaRegistrarRetornoRecurso>;

/** faturamento.fecharCompetencia: convênio + ano + mês da competência fechada. */
export const esquemaFecharCompetencia = z
  .object({
    convenio: z.number().int().min(0).max(32_767),
    ano: z.number().int().min(2000).max(2100),
    mes: z.number().int().min(1).max(12),
  })
  .strict();
export type FecharCompetenciaEntrada = z.infer<typeof esquemaFecharCompetencia>;

/**
 * faturamento.reabrirCompetencia: motivo (a alçada é a permissão do cargo) e, quando há conta da competência já em
 * lote, a confirmação de quem reabre depois de ver o impacto (quantas contas e o valor apresentado).
 */
export const esquemaReabrirCompetencia = esquemaFecharCompetencia
  .extend({ motivo: texto(250).pipe(z.string().min(5)), confirmarImpacto: z.boolean().default(false) })
  .strict();
export type ReabrirCompetenciaEntrada = z.infer<typeof esquemaReabrirCompetencia>;

/** Item de demonstrativo digitado (digitação assistida, DP-33.8) ou lido do XML. */
export const esquemaItemDemonstrativo = z
  .object({
    numeroGuia: texto(20),
    sequencial: z.number().int().min(0).max(9_999),
    codigoProcedimento: texto(20),
    valorInformado: dinheiro,
    valorPago: dinheiro,
    quantidadePaga: quantidade,
    motivo: z.number().int().min(0).max(99_999_999),
  })
  .strict();
export type ItemDemonstrativo = z.infer<typeof esquemaItemDemonstrativo>;

/** faturamento.importarDemonstrativo (só SGH_): XML de análise de conta ou digitação assistida. */
export const esquemaImportarDemonstrativo = z
  .object({
    lote: id,
    tipo: z.enum(['analise', 'pagamento']),
    numero: texto(20).pipe(z.string().min(1)),
    dataEmissao: data,
    /** XML do demonstrativo (texto); ou os itens digitados. */
    xml: z.string().max(5_000_000).nullable().default(null),
    itens: z.array(esquemaItemDemonstrativo).max(5_000).default([]),
  })
  .strict();
export type ImportarDemonstrativoEntrada = z.infer<typeof esquemaImportarDemonstrativo>;

/** faturamento.decidirGlosa (só SGH_): aceitar (motivo) ou recorrer (justificativa, evidência do prontuário). */
export const esquemaDecidirGlosa = z
  .object({
    item: id,
    decisao: z.enum(['aceitar', 'recorrer']),
    texto: texto(2000),
    evidencia: texto(250).default(''),
  })
  .strict();
export type DecidirGlosaEntrada = z.infer<typeof esquemaDecidirGlosa>;

/** integracao.editarEndpointTiss (só SGH_): endpoint por operadora e transação com a referência ao cofre. */
export const esquemaEditarEndpointTiss = z
  .object({
    convenio: z.number().int().min(0).max(32_767),
    transacao: z.string().regex(/^[A-Z_]{3,40}$/),
    url: z.string().url().max(250),
    /** Referência da credencial no cofre (nunca a senha). */
    referenciaCofre: z.string().regex(/^cofre:[a-z0-9/_.-]{3,120}$/),
    ativo: z.boolean(),
  })
  .strict();
export type EditarEndpointTissEntrada = z.infer<typeof esquemaEditarEndpointTiss>;

/** Envio do lote (produção: outbox ao consumidor tiss-lote; fora dela: o simulador de operadora). */
export const esquemaEnviarLote = z.object({ lote: id }).strict();
export type EnviarLoteEntrada = z.infer<typeof esquemaEnviarLote>;
