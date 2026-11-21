// Entradas das operações do estoque, do almoxarifado e das compras (M28; ficha, seções 5 e 7), validadas na tela, na
// API e no executor (o mesmo Zod). Vocabulário do novo: o item é o código do cadastro de itens; o local é o código do
// local de armazenagem; o centro de custo, o código do cadastro de centros de custo; o atendimento, o número do
// atendimento (internação ou externo). Número de documento e valor de saída nunca vêm da tela (o banco numera e os
// gatilhos valorizam); data e hora gravadas vêm do relógio do banco.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_DESTINO_DEVOLUCAO,
  CODIGOS_ORIGEM_SAIDA,
  CODIGOS_TIPO_COMPRA,
  CODIGOS_TIPO_MOVIMENTO,
} from './vocabulario.js';
import { esquemaContratoDoVinculo } from './contrato.js';
import { esquemaManipulacaoNaSaida } from './manipulacao.js';
import { esquemaOpmeNaDevolucao, esquemaOpmeNaSaida } from './opme-entradas.js';

const id = z.number().int().positive().max(2_147_483_647);
const smallint = z.number().int().positive().max(32_767);
const local = z.number().int().min(1).max(99);
const quantidade = z
  .number()
  .positive('A quantidade tem de ser maior que zero.')
  .max(999_999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });
const valor = z.number().min(0).max(999_999_999);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
/** Motivo e justificativa (vão à trilha e ao registro do novo). */
export const esquemaMotivoSuprimentos = textoCp1252(250)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(10, 'Escreva o motivo (ao menos 10 caracteres).'));


/** O lote de um item rastreável (lote e validade; a quantidade daquele lote). */
export const esquemaLoteItem = z
  .object({ lote: livre(30).pipe(z.string().min(1, 'Informe o lote.')), validade: dataIso, quantidade })
  .strict();
export type LoteItem = z.infer<typeof esquemaLoteItem>;

// ── suprimentos.registrarSaida ────────────────────────────────────────────────────────────────────────

export const esquemaItemSaida = z
  .object({
    item: id,
    quantidade,
    /** Item rastreável: os lotes (a soma é a quantidade; a tela sugere o que vence primeiro). */
    lotes: z.array(esquemaLoteItem).max(50).default([]),
    /** Item da Portaria 344: o prescritor (vínculo × CBO) do controlado. */
    prescritorControlado: id.optional(),
    /** Na saída que atende requisição: a sequência do item pedido. */
    seq: smallint.optional(),
  })
  .strict();

export const esquemaRegistrarSaida = z
  .object({
    destino: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
    origem: z.enum(CODIGOS_ORIGEM_SAIDA).default('E'),
    local,
    centroCusto: id,
    /** Local de consumo (o do centro de custo, por padrão). */
    localConsumo: smallint,
    /** Atendimento do paciente (destinos 1 e 3). */
    atendimento: id.optional(),
    /** Destino 3: o médico que pede (vínculo × CBO). */
    medico: id.optional(),
    /** Destino 5: o terceiro do cadastro de terceiros (código). */
    terceiro: id.optional(),
    observacao: livre(60).optional(),
    /** Atendimento de requisição: o id da requisição (as quantidades atendidas nos itens). */
    requisicao: id.optional(),
    itens: z.array(esquemaItemSaida).min(1, 'Inclua ao menos um item.').max(200),
    /** M46 (etapa 3): o consumo de OPME em sala (o rastreio vai na mesma transação; só a paciente internado, um item). */
    opme: esquemaOpmeNaSaida.optional(),
    /** M46 (etapa 4): a baixa do insumo da ordem de manipulação (a ordem ligada na mesma transação; um item). */
    manipulacao: esquemaManipulacaoNaSaida.optional(),
  })
  .strict()
  .refine((s) => !s.opme || (s.destino === 1 && s.itens.length === 1 && !s.requisicao), {
    message: 'O consumo de OPME é a saída de um item a paciente internado.',
    path: ['opme'],
  })
  .refine((s) => !s.manipulacao || (s.itens.length === 1 && !s.requisicao && !s.opme), {
    message: 'A baixa do insumo da manipulação é a saída de um item, sem requisição.',
    path: ['manipulacao'],
  });
export type RegistrarSaidaEntrada = z.infer<typeof esquemaRegistrarSaida>;

// ── suprimentos.requisitarMaterial ────────────────────────────────────────────────────────────────────

export const esquemaRequisitarMaterial = z
  .object({
    destino: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    /** Local de estoque que vai atender. */
    local,
    centroCusto: id,
    localConsumo: smallint,
    atendimento: id.optional(),
    observacao: livre(60).optional(),
    itens: z
      .array(z.object({ item: id, quantidade }).strict())
      .min(1, 'Inclua ao menos um item.')
      .max(200),
  })
  .strict();
export type RequisitarMaterialEntrada = z.infer<typeof esquemaRequisitarMaterial>;

// ── suprimentos.registrarDevolucao ────────────────────────────────────────────────────────────────────

export const esquemaItemDevolucao = z
  .object({
    /** O item da saída que volta (ID do lançamento da saída). */
    lancamentoSaida: id,
    item: id,
    quantidade,
    /** Lotes que voltam (os da saída original: o lote da saída e a quantidade). */
    lotes: z
      .array(z.object({ loteSaida: id, quantidade }).strict())
      .max(50)
      .default([]),
    /** Item de kit rastreável (o item do kit que volta). */
    itemKit: id.optional(),
  })
  .strict();

export const esquemaRegistrarDevolucao = z
  .object({
    /** O id do documento da saída devolvida. */
    saida: id,
    /** Local de estoque que recebe a devolução. */
    local,
    observacao: livre(60).optional(),
    itens: z.array(esquemaItemDevolucao).min(1, 'Inclua ao menos um item.').max(200),
    /** M46 (etapa 3): a devolução do OPME não usado (o consumo e o motivo; a etapa vai na mesma transação). */
    opme: esquemaOpmeNaDevolucao.optional(),
  })
  .strict()
  .refine((d) => !d.opme || d.itens.length === 1, {
    message: 'A devolução de OPME é de um item.',
    path: ['opme'],
  });
export type RegistrarDevolucaoEntrada = z.infer<typeof esquemaRegistrarDevolucao>;

// ── suprimentos.transferir ────────────────────────────────────────────────────────────────────────────

export const esquemaItemTransferencia = z
  .object({ item: id, quantidade, lotes: z.array(esquemaLoteItem).max(50).default([]) })
  .strict();

export const esquemaTransferir = z
  .object({
    origem: local,
    destino: local,
    observacao: livre(60).optional(),
    /** O envio registrado no novo (transferência em dois passos): o recebimento o fecha. */
    envio: id.optional(),
    itens: z.array(esquemaItemTransferencia).min(1, 'Inclua ao menos um item.').max(200),
  })
  .strict()
  .refine((t) => t.origem !== t.destino, {
    message: 'A origem e o destino são o mesmo local.',
    path: ['destino'],
  });
export type TransferirEntrada = z.infer<typeof esquemaTransferir>;

/** O envio (1º passo, só no novo): os itens e os lotes que saem; o saldo fica na origem até o recebimento. */
export const esquemaEnviarTransferencia = z
  .object({
    origem: local,
    destino: local,
    observacao: livre(60).optional(),
    itens: z.array(esquemaItemTransferencia).min(1).max(200),
  })
  .strict()
  .refine((t) => t.origem !== t.destino, {
    message: 'A origem e o destino são o mesmo local.',
    path: ['destino'],
  });
export type EnviarTransferenciaEntrada = z.infer<typeof esquemaEnviarTransferencia>;

/** O recebimento (2º passo): as quantidades recebidas por item; a divergência leva o motivo. */
export const esquemaReceberTransferencia = z
  .object({
    recebidos: z.array(z.object({ item: id, quantidade: z.number().min(0) }).strict()).min(1),
    motivoDivergencia: livre(250).optional(),
  })
  .strict();
export type ReceberTransferenciaEntrada = z.infer<typeof esquemaReceberTransferencia>;

// ── suprimentos.registrarEntradaNF ────────────────────────────────────────────────────────────────────

export const esquemaItemNota = z
  .object({
    item: id,
    quantidade,
    valorUnitario: valor,
    /** Fator da unidade de compra (embalagem com N unidades de estoque); 0 ou 1: a mesma unidade. */
    fator: z.number().min(0).max(100_000).default(0),
    marca: livre(25).optional(),
    lotes: z.array(esquemaLoteItem).max(50).default([]),
  })
  .strict();

export const esquemaRegistrarEntradaNF = z
  .object({
    fornecedor: id,
    numero: id,
    serie: livre(3).default('1'),
    emissao: dataIso,
    local,
    desconto: valor.default(0),
    frete: valor.default(0),
    outros: valor.default(0),
    observacao: livre(60).optional(),
    pedido: z
      .object({ ano: z.number().int().min(2000).max(2100), doc: id })
      .strict()
      .optional(),
    itens: z.array(esquemaItemNota).min(1, 'Inclua ao menos um item.').max(300),
    /** Fora da tolerância do pedido: a aprovação do comprador (o motivo; quem aprova é a sessão). */
    aprovacaoComprador: esquemaMotivoSuprimentos.optional(),
    /** As tolerâncias do parâmetro do estabelecimento (a API resolve e manda; padrão 5%, 2% e 3 dias). */
    tolerancias: z
      .object({
        quantidadePct: z.number().int().min(0).max(100),
        precoPct: z.number().int().min(0).max(100),
        prazoDias: z.number().int().min(0).max(180),
      })
      .strict()
      .default({ quantidadePct: 5, precoPct: 2, prazoDias: 3 }),
  })
  .strict();
export type RegistrarEntradaNFEntrada = z.infer<typeof esquemaRegistrarEntradaNF>;

/** Pré-preenchimento pelo XML da NF-e (só leitura: monta os itens pelo de-para fornecedor × item). */
export const esquemaXmlNota = z.object({ xml: z.string().min(50).max(2_000_000) }).strict();

// ── suprimentos.criarPedido, definirVencedorCotacao e aprovarPedido ──────────────────────────────────

export const esquemaCriarPedido = z
  .object({
    centroCusto: id,
    tipoCompra: z.enum(CODIGOS_TIPO_COMPRA).default('P'),
    /** Fornecedores convidados à cotação (cada um ganha a linha de proposta de cada item). */
    fornecedores: z.array(id).max(20).default([]),
    itens: z
      .array(z.object({ item: id, quantidade }).strict())
      .min(1, 'Inclua ao menos um item.')
      .max(300),
    /** 1 Aberto (sem cotação) ou 2 Em andamento (com fornecedores convidados). */
    situacao: z.union([z.literal(1), z.literal(2)]).optional(),
    /** M55 (etapa 3): o contrato com o fornecedor que o pedido consome (o vínculo na mesma transação, só no novo). */
    contrato: esquemaContratoDoVinculo.optional(),
  })
  .strict()
  .refine((p) => !p.contrato || p.contrato.pedidoDeOrigem === null, {
    message: 'O pedido de origem é só do título.',
    path: ['contrato'],
  });
export type CriarPedidoEntrada = z.infer<typeof esquemaCriarPedido>;

/** A proposta de um fornecedor para um item (preço e marca), digitada no mapa de cotação. */
export const esquemaRegistrarProposta = z
  .object({
    pedido: z.object({ ano: z.number().int(), doc: id }).strict(),
    proposta: id,
    valorUnitario: valor,
    marca: livre(25).optional(),
  })
  .strict();
export type RegistrarPropostaEntrada = z.infer<typeof esquemaRegistrarProposta>;

export const esquemaDefinirVencedor = z
  .object({
    pedido: z.object({ ano: z.number().int().min(2000).max(2100), doc: id }).strict(),
    item: id,
    seq: z.number().int().min(0).max(32_767),
    /** As propostas escolhidas (IDs das linhas de proposta); mais de uma é rateio. */
    vencedoras: z.array(id).min(1).max(20),
    /** Obrigatória quando a escolhida não é a menor proposta. */
    justificativa: livre(250).optional(),
  })
  .strict();
export type DefinirVencedorEntrada = z.infer<typeof esquemaDefinirVencedor>;

export const esquemaAprovarPedido = z
  .object({
    pedido: z.object({ ano: z.number().int().min(2000).max(2100), doc: id }).strict(),
    decisao: z.enum(['aprovado', 'reprovado']),
    justificativa: livre(250).default(''),
  })
  .strict();
export type AprovarPedidoEntrada = z.infer<typeof esquemaAprovarPedido>;

// ── P2: movimento direto, balanço, fechamento, kit, desconsolidação e validade ────────────────────────

export const esquemaMovimentoDireto = z
  .object({
    /** 'paciente' (atendimento) ou 'centroCusto'. */
    para: z.enum(['paciente', 'centroCusto']),
    atendimento: id.optional(),
    centroCusto: id,
    local,
    itens: z
      .array(z.object({ item: id, quantidade }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export type MovimentoDiretoEntrada = z.infer<typeof esquemaMovimentoDireto>;

export const esquemaRegistrarBalanco = z
  .object({
    /** O inventário aprovado no novo que vira o balanço. */
    inventario: id,
  })
  .strict();
export type RegistrarBalancoEntrada = z.infer<typeof esquemaRegistrarBalanco>;

export const esquemaFecharMes = z
  .object({ ano: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12) })
  .strict();
export type FecharMesEntrada = z.infer<typeof esquemaFecharMes>;

export const esquemaReabrirMes = esquemaFecharMes.extend({ motivo: esquemaMotivoSuprimentos }).strict();
export type ReabrirMesEntrada = z.infer<typeof esquemaReabrirMes>;

export const esquemaReporKit = z
  .object({
    kit: id,
    /** A saída de reposição já gravada (o id do documento) e os itens do kit repostos. */
    saida: id,
    itens: z
      .array(z.object({ itemKit: id, lancamentoSaida: id }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type ReporKitEntrada = z.infer<typeof esquemaReporKit>;

export const esquemaDesconsolidar = z
  .object({
    tipo: z.enum(['saida', 'devolucao', 'transferencia', 'nota']),
    /** O id do documento (na nota, o id da nota de entrada). */
    documento: id,
    motivo: esquemaMotivoSuprimentos,
  })
  .strict();
export type DesconsolidarEntrada = z.infer<typeof esquemaDesconsolidar>;

export const esquemaCorrigirValidade = z
  .object({ lote: id, validade: dataIso, motivo: esquemaMotivoSuprimentos })
  .strict();
export type CorrigirValidadeEntrada = z.infer<typeof esquemaCorrigirValidade>;

// ── Registros só do novo ──────────────────────────────────────────────────────────────────────────────

export const esquemaAbrirInventario = z
  .object({
    local,
    tipo: z.enum(['geral', 'ciclico']),
    /** Cíclico: a curva (A, B ou C) ou os itens escolhidos. */
    curva: z.enum(['A', 'B', 'C']).optional(),
    itens: z.array(id).max(2_000).default([]),
  })
  .strict();
export type AbrirInventarioEntrada = z.infer<typeof esquemaAbrirInventario>;

export const esquemaRegistrarContagem = z
  .object({ item: id, quantidade: z.number().min(0).max(999_999_999) })
  .strict();
export type RegistrarContagemEntrada = z.infer<typeof esquemaRegistrarContagem>;

export const esquemaDecidirInventario = z
  .object({ decisao: z.enum(['aprovado', 'cancelado']), justificativa: livre(250).default('') })
  .strict();

export const esquemaConferirCarrinho = z
  .object({
    kitRastreavel: id,
    lacre: livre(30).pipe(z.string().min(1, 'Informe o número do lacre.')),
    itensConferidos: z.array(id).max(500),
    pendencias: livre(250).optional(),
  })
  .strict();
export type ConferirCarrinhoEntrada = z.infer<typeof esquemaConferirCarrinho>;

export const esquemaPontoPedidoItem = z
  .object({
    item: id,
    local,
    prazoDias: z.number().int().min(0).max(365),
    estoqueSeguranca: z.number().min(0).max(999_999_999).optional(),
  })
  .strict();
export type PontoPedidoItemEntrada = z.infer<typeof esquemaPontoPedidoItem>;

/** Escopo do usuário do estoque (local × tipo de movimento), gravado pelo CRUD genérico do cadastro. */
export const esquemaEscopoLocal = z
  .object({ usuario: livre(31).pipe(z.string().min(1)), local, tipo: z.enum(CODIGOS_TIPO_MOVIMENTO) })
  .strict();

/** Filtro das listas de documentos por tipo, local e período. */
export const esquemaFiltroDocumentos = z
  .object({
    tipo: z.enum(['saida', 'devolucao', 'transferencia', 'nota', 'balanco', 'requisicao']),
    local: local.optional(),
    inicio: dataIso,
    fim: dataIso,
    pagina: z.number().int().min(1).max(500).default(1),
  })
  .strict();
export type FiltroDocumentos = z.infer<typeof esquemaFiltroDocumentos>;

/** O destino da devolução (o mesmo da saída). */
export const CODIGOS_DESTINO_DEV = CODIGOS_DESTINO_DEVOLUCAO;
