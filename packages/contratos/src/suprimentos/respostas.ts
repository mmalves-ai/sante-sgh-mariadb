// Respostas das telas do estoque, do almoxarifado e das compras (M28; ficha, seções 4 e 7): o que a API devolve e a
// tela valida (o mesmo Zod). Valores e saldos são os que o banco tem (produzidos pelos gatilhos); a tela só mostra.
// O nome do paciente só aparece nas telas com a permissão e com o evento de leitura auditada (rastreio de lote,
// saída a paciente, devolução).
import { z } from 'zod';

const n = z.number();
const dataIso = z.string();
const texto = z.string();

export const esquemaChaveDocumentoLida = z.object({ ano: n, mes: n, doc: n });

export const esquemaLoteSaldo = z.object({
  id: n,
  lote: texto,
  validade: dataIso,
  quantidade: n,
  diasParaVencer: n,
  /** vencido, vence (dentro da antecedência do parâmetro), suspeita (validade com dígitos trocados) ou nenhum. */
  alerta: z.enum(['vencido', 'vence', 'suspeita', 'nenhum']),
});
export type LoteSaldo = z.infer<typeof esquemaLoteSaldo>;

export const esquemaSaldoItem = z.object({
  item: n,
  nome: texto,
  unidade: texto,
  local: n,
  localNome: texto,
  quantidade: n,
  valor: n,
  /** Quantidade e valor do item na empresa (o custo médio é valor / quantidade, do gatilho). */
  estoqueEmpresa: n,
  valorEmpresa: n,
  custoMedio: n,
  minimo: n.nullable(),
  maximo: n.nullable(),
  rastreavel: z.boolean(),
  controlado: z.boolean(),
  lotes: z.array(esquemaLoteSaldo),
});
export type SaldoItem = z.infer<typeof esquemaSaldoItem>;

export const esquemaListaSaldos = z.object({
  competencia: z.object({ ano: n, mes: n }),
  itens: z.array(esquemaSaldoItem),
  cortada: z.boolean(),
});
export type ListaSaldos = z.infer<typeof esquemaListaSaldos>;

/** A ficha do item (GEITENS com a classe e o grupo): as unidades por uso e os fatores de conversão. */
export const esquemaFichaItem = z.object({
  item: n,
  classe: z.object({ codigo: n, nome: texto }).nullable(),
  grupo: z.object({ codigo: n, nome: texto }).nullable(),
  unidades: z.object({ compra: texto, armazenamento: texto, consumo: texto, prescricao: texto }),
  /** CONVER (unidade de compra → de consumo) e FATOR_CONV (de consumo → de prescrição), como gravados. */
  fatores: z.object({ compraConsumo: n.nullable(), consumoPrescricao: n.nullable() }),
});
export type FichaItem = z.infer<typeof esquemaFichaItem>;

export const esquemaPosicaoMensal = z.object({
  item: n,
  nome: texto,
  meses: z.array(z.object({ ano: n, mes: n, quantidade: n, valor: n })),
  porLocal: z.array(z.object({ local: n, localNome: texto, quantidade: n, valor: n })),
});
export type PosicaoMensal = z.infer<typeof esquemaPosicaoMensal>;

export const esquemaPacienteDocumento = z.object({ atendimento: n, nome: texto }).nullable();

export const esquemaDocumentoEstoque = z.object({
  tipo: z.enum(['saida', 'devolucao', 'transferencia', 'nota', 'balanco', 'requisicao']),
  id: n,
  chave: esquemaChaveDocumentoLida,
  data: dataIso,
  hora: texto,
  local: n,
  localNome: texto,
  /** Transferência: o local de destino. */
  localDestino: n.nullable(),
  destino: n.nullable(),
  centroCusto: n.nullable(),
  consolidado: z.boolean(),
  usuario: texto,
  itens: n,
  valor: n,
  paciente: esquemaPacienteDocumento,
  /** Nota: fornecedor, número e série. */
  nota: z.object({ fornecedor: n, fornecedorNome: texto, numero: n, serie: texto }).nullable(),
});
export type DocumentoEstoque = z.infer<typeof esquemaDocumentoEstoque>;

export const esquemaListaDocumentos = z.object({
  itens: z.array(esquemaDocumentoEstoque),
  pagina: n,
  cortada: z.boolean(),
});
export type ListaDocumentos = z.infer<typeof esquemaListaDocumentos>;

export const esquemaItemDocumento = z.object({
  id: n,
  seq: n,
  item: n,
  nome: texto,
  quantidade: n,
  valor: n,
  consolidado: z.boolean(),
  lotes: z.array(z.object({ id: n, lote: texto, validade: dataIso, quantidade: n })),
  /** Devolução: o que já voltou deste item da saída. */
  devolvido: n,
});

export const esquemaDocumentoDetalhe = esquemaDocumentoEstoque.extend({
  observacao: texto,
  itensDetalhe: z.array(esquemaItemDocumento),
  /** Ocorrências do novo (estorno, desconsolidação, divergência), com autor e data. */
  ocorrencias: z.array(z.object({ tipo: texto, motivo: texto, autor: texto, em: texto })),
});
export type DocumentoDetalhe = z.infer<typeof esquemaDocumentoDetalhe>;

export const esquemaRequisicaoPendente = z.object({
  chave: esquemaChaveDocumentoLida,
  id: n,
  data: dataIso,
  hora: texto,
  local: n,
  localNome: texto,
  destino: n,
  centroCusto: n,
  centroCustoNome: texto,
  usuario: texto,
  paciente: esquemaPacienteDocumento,
  itens: z.array(
    z.object({ seq: n, item: n, nome: texto, quantidade: n, saldoLocal: n, rastreavel: z.boolean() }),
  ),
  /** A autorização registrada no novo (quem tem "autoriza requisição" no usuário do estoque); null se não houver. */
  autorizacao: z.object({ por: texto, em: texto }).nullable(),
});
export type RequisicaoPendente = z.infer<typeof esquemaRequisicaoPendente>;

export const esquemaListaRequisicoesEstoque = z.object({
  itens: z.array(esquemaRequisicaoPendente),
  cortada: z.boolean(),
});
export type ListaRequisicoesEstoque = z.infer<typeof esquemaListaRequisicoesEstoque>;

export const esquemaMovimentoLote = z.object({
  tipo: z.enum(['entrada', 'saida', 'devolucao', 'transferencia', 'balanco', 'inicial']),
  chave: esquemaChaveDocumentoLida,
  data: dataIso,
  quantidade: n,
  local: n,
  destino: n.nullable(),
  centroCusto: n.nullable(),
  paciente: esquemaPacienteDocumento,
  fornecedor: texto.nullable(),
});

export const esquemaRastreioLote = z.object({
  item: n,
  nome: texto,
  lote: texto,
  validade: dataIso.nullable(),
  saldos: z.array(z.object({ local: n, localNome: texto, quantidade: n })),
  movimentos: z.array(esquemaMovimentoLote),
  pacientes: n,
  cortada: z.boolean(),
});
export type RastreioLote = z.infer<typeof esquemaRastreioLote>;

export const esquemaLotesDoPaciente = z.object({
  atendimento: n,
  itens: z.array(
    z.object({
      item: n,
      nome: texto,
      lote: texto,
      validade: dataIso,
      quantidade: n,
      data: dataIso,
      chave: esquemaChaveDocumentoLida,
    }),
  ),
});
export type LotesDoPaciente = z.infer<typeof esquemaLotesDoPaciente>;

export const esquemaConsumo = z.object({
  competencia: z.object({ ano: n, mes: n }),
  porCentroCusto: z.array(
    z.object({ centroCusto: n, nome: texto, quantidade: n, valor: n, tecnico: z.boolean() }),
  ),
  porLocal: z.array(
    z.object({ local: n, localNome: texto, saida: n, devolucao: n, valorSaida: n, valorDevolucao: n }),
  ),
  total: z.object({ valor: n, parcelas: z.array(n) }),
  fonte: z.enum(['copia-diaria', 'banco']),
});
export type ConsumoEstoque = z.infer<typeof esquemaConsumo>;

export const esquemaItemPedido = z.object({
  id: n,
  seq: n,
  item: n,
  nome: texto,
  quantidade: n,
  comprada: n,
  estado: texto,
  estadoRotulo: texto,
});

export const esquemaPropostaLida = z.object({
  id: n,
  item: n,
  seq: n,
  fornecedor: n,
  fornecedorNome: texto,
  valorUnitario: n,
  quantidade: n,
  marca: texto,
  /** 'T', 'F' ou '' (vazio é legítimo). */
  vencedor: texto,
  comprada: n,
});
export type PropostaLida = z.infer<typeof esquemaPropostaLida>;

export const esquemaPedidoResumo = z.object({
  id: n,
  ano: n,
  doc: n,
  data: dataIso,
  situacao: n.nullable(),
  situacaoRotulo: texto,
  centroCusto: n,
  centroCustoNome: texto,
  tipoCompra: texto,
  usuario: texto,
  itens: n,
  fornecedores: n,
  /** Valor pelas propostas vencedoras (as parcelas impressas). */
  valor: z.object({ total: n, parcelas: z.array(n) }),
  aprovacao: z
    .object({ decisao: z.enum(['aprovado', 'reprovado']), aprovador: texto, em: texto, nivel: n })
    .nullable(),
});
export type PedidoResumo = z.infer<typeof esquemaPedidoResumo>;

export const esquemaListaPedidosCompra = z.object({
  itens: z.array(esquemaPedidoResumo),
  cortada: z.boolean(),
});
export type ListaPedidosCompra = z.infer<typeof esquemaListaPedidosCompra>;

export const esquemaPedidoDetalhe = esquemaPedidoResumo.extend({
  itensDetalhe: z.array(esquemaItemPedido),
  propostas: z.array(esquemaPropostaLida),
  escolhas: z.array(
    z.object({ item: n, seq: n, autor: texto, em: texto, justificativa: texto, rateio: z.boolean() }),
  ),
  portal: z.array(z.object({ portal: texto, enviadoEm: texto })),
});
export type PedidoDetalhe = z.infer<typeof esquemaPedidoDetalhe>;

export const esquemaAprovacaoPendente = esquemaPedidoResumo.extend({
  faixa: z.object({ nivel: n, ate: n.nullable() }),
  podeAprovar: z.boolean(),
  motivo: texto.nullable(),
});
export type AprovacaoPendente = z.infer<typeof esquemaAprovacaoPendente>;

export const esquemaHistoricoCompra = z.object({
  item: n,
  nome: texto,
  compras: z.array(
    z.object({
      data: dataIso,
      fornecedor: n,
      fornecedorNome: texto,
      nota: n,
      quantidade: n,
      unitario: n,
      custo: n,
      marca: texto,
    }),
  ),
  ultimoCusto: n.nullable(),
  menorUnitario: n.nullable(),
  cortada: z.boolean(),
});
export type HistoricoCompra = z.infer<typeof esquemaHistoricoCompra>;

export const esquemaFechamentos = z.object({
  fechados: z.array(z.object({ ano: n, mes: n, exportado: z.boolean() })),
  proximo: z.object({ ano: n, mes: n }),
  ocorrencias: z.array(z.object({ tipo: texto, ano: n, mes: n, motivo: texto, autor: texto, em: texto })),
});
export type FechamentosEstoque = z.infer<typeof esquemaFechamentos>;

export const esquemaRecalculos = z.object({
  itens: z.array(
    z.object({
      id: n,
      inicio: texto,
      fim: texto,
      usuario: texto,
      tela: n.nullable(),
      terminado: z.boolean(),
      competencia: texto,
    }),
  ),
});
export type RecalculosEstoque = z.infer<typeof esquemaRecalculos>;

export const esquemaParametrosEstoque = z.object({
  usuario: texto,
  parametros: z.array(z.object({ chave: texto, rotulo: texto, valor: texto })),
  numeracao: z.array(z.object({ tipo: texto, competencia: texto, ultimo: n })),
  sequencias: z.array(z.object({ codigo: n, nome: texto, ano: n, proximo: n })),
});
export type ParametrosEstoque = z.infer<typeof esquemaParametrosEstoque>;

export const esquemaEscopoUsuarioEstoque = z.object({
  usuario: texto,
  nome: texto,
  locais: z.array(z.object({ local: n, localNome: texto, tipos: z.array(texto) })),
  centrosCusto: z.array(z.object({ codigo: n, nome: texto })),
  classes: z.array(z.object({ codigo: n, nome: texto })),
  flags: z.object({
    autorizarRequisicao: z.boolean(),
    autorizarPedido: z.boolean(),
    autorizarNecessidade: z.boolean(),
    desbloquearFechamento: z.boolean(),
    lancarControlado: z.boolean(),
  }),
});
export type EscopoUsuarioEstoque = z.infer<typeof esquemaEscopoUsuarioEstoque>;

export const esquemaKitRastreavel = z.object({
  id: n,
  nome: texto,
  local: n,
  localNome: texto,
  emergencial: z.boolean(),
  itens: z.array(
    z.object({
      id: n,
      item: n,
      nome: texto,
      lote: texto.nullable(),
      validade: dataIso.nullable(),
      quantidade: n,
      saldo: n,
      obrigatorio: z.boolean(),
    }),
  ),
  conferencia: z
    .object({ lacre: texto, conferente: texto, em: texto, pendencias: texto, completa: z.boolean() })
    .nullable(),
  vencendo: n,
});
export type KitRastreavel = z.infer<typeof esquemaKitRastreavel>;

export const esquemaInventarioLido = z.object({
  id: n,
  local: n,
  localNome: texto,
  tipo: z.enum(['geral', 'ciclico']),
  situacao: z.enum(['aberto', 'contagem', 'recontagem', 'aprovado', 'cancelado']),
  abertoPor: texto,
  abertoEm: texto,
  limitePct: n,
  /** Na contagem cega, sem o saldo; para o supervisor, com o saldo e a divergência. */
  itens: z.array(
    z.object({
      item: n,
      nome: texto,
      contagens: n,
      saldo: n.nullable(),
      contado: n.nullable(),
      diferenca: n.nullable(),
      divergenciaPct: n.nullable(),
      situacao: z.enum(['pendente', 'ok', 'recontar', 'divergente-confirmado']),
    }),
  ),
  balanco: esquemaChaveDocumentoLida.nullable(),
});
export type InventarioLido = z.infer<typeof esquemaInventarioLido>;

export const esquemaSugestaoCompra = z.object({
  local: n.nullable(),
  meses: n,
  itens: z.array(
    z.object({
      item: n,
      nome: texto,
      saldo: n,
      emPedido: n,
      mediaMensal: n,
      estoqueSeguranca: n,
      pontoPedido: n,
      sugestao: n,
      curvaAbc: z.enum(['A', 'B', 'C']),
      curvaXyz: z.enum(['X', 'Y', 'Z']),
      prazoDias: n,
      custo: n,
    }),
  ),
  valor: z.object({ total: n, parcelas: z.array(n) }),
  calculadoEm: texto,
});
export type SugestaoCompra = z.infer<typeof esquemaSugestaoCompra>;

export const esquemaTransferenciaEnviada = z.object({
  id: n,
  origem: n,
  origemNome: texto,
  destino: n,
  destinoNome: texto,
  etapa: z.enum(['enviada', 'recebida', 'divergente', 'cancelada']),
  enviadaPor: texto,
  enviadaEm: texto,
  itens: z.array(z.object({ item: n, nome: texto, quantidade: n, recebida: n.nullable() })),
  documento: esquemaChaveDocumentoLida.nullable(),
});
export type TransferenciaEnviada = z.infer<typeof esquemaTransferenciaEnviada>;

export const esquemaApoioSuprimentos = z.object({
  locais: z.array(z.object({ codigo: n, nome: texto })),
  centrosCusto: z.array(z.object({ codigo: n, nome: texto, localConsumo: n, tecnico: z.boolean() })),
  situacoesPedido: z.array(z.object({ id: n, rotulo: texto })),
  hoje: dataIso,
  competencia: z.object({ ano: n, mes: n }),
  mesFechado: z.boolean(),
  /** O escopo do usuário da sessão (locais e tipos de movimento). */
  escopo: esquemaEscopoUsuarioEstoque.nullable(),
});
export type ApoioSuprimentos = z.infer<typeof esquemaApoioSuprimentos>;

export const esquemaItemBusca = z.object({
  codigo: n,
  nome: texto,
  unidade: texto,
  rastreavel: z.boolean(),
  controlado: z.boolean(),
  antimicrobiano: z.boolean(),
  consignado: z.boolean(),
  ativo: z.boolean(),
});
export type ItemBusca = z.infer<typeof esquemaItemBusca>;

export const esquemaResultadoSuprimentos = z.object({
  mensagem: texto,
  repetida: z.boolean(),
  ids: z.record(z.string(), z.union([n, texto])),
  avisos: z.array(texto),
});
export type ResultadoSuprimentos = z.infer<typeof esquemaResultadoSuprimentos>;

/** O estado de gravação das telas: cada funcionalidade e cada operação (permissão + liberação + catálogo). */
export const esquemaGravacaoSuprimentos = z.object({
  funcionalidades: z.record(z.string(), z.object({ ligada: z.boolean(), motivo: texto.nullable() })),
  operacoes: z.record(z.string(), z.object({ ligada: z.boolean(), motivo: texto.nullable() })),
});
export type GravacaoSuprimentos = z.infer<typeof esquemaGravacaoSuprimentos>;

/**
 * Fornecedor e terceiro lidos (M28, "Fornecedores e terceiros"): o documento da pessoa física sai mascarado (só os
 * dois últimos dígitos); o da jurídica, inteiro (dado de empresa). Dados bancários só como "tem conta" e os dois
 * últimos dígitos (mascarados). O cadastro (incluir, alterar, inativar) é P2 e segue desligado (POL-3).
 */
export const esquemaFornecedorLido = z.object({
  codigo: n,
  nome: texto,
  fantasia: texto,
  pessoa: z.enum(['F', 'J', '']),
  documento: texto,
  documentoValido: z.boolean(),
  cidade: texto,
  uf: texto,
  banco: texto.nullable(),
});
export type FornecedorLido = z.infer<typeof esquemaFornecedorLido>;

/** Terceiro destinatário de saída (GECADTER): só o código e o nome (a data de nascimento não sai). */
export const esquemaTerceiroLido = z.object({ codigo: n, nome: texto });
export type TerceiroLido = z.infer<typeof esquemaTerceiroLido>;

/** Colaborador ou prestador (GETABFUN): o CPF e a conta mascarados; retenções só como marca. */
export const esquemaPrestadorLido = z.object({
  codigo: n,
  empresa: n,
  nome: texto,
  documento: texto,
  documentoValido: z.boolean(),
  situacao: texto,
  banco: texto.nullable(),
});
export type PrestadorLido = z.infer<typeof esquemaPrestadorLido>;
