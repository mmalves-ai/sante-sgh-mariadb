// Permissões do M28 (ficha, seção 7; convencoes.md §12): estoque, almoxarifado e compras. Quem tem a opção no menu de
// origem tem a permissão (regra 1 do M06); a correspondência está em conector/mapa/permissoes.tsv. Os números em
// OPCOES_* ficam até a etapa coordenada que tira a procedência da declaração (padroes.md da F2.4, seção 5).
// As alçadas do usuário do estoque concedem as ações de alçada: autorizar requisição, autorizar pedido e desbloquear o
// fechamento; os locais de estoque do usuário por tipo de movimento são escopo (`localEstoque`), conferido no servidor.
import type { DeclaracaoPermissao, FlagLegado } from './tipos.js';

export const OPCOES_SUPRIMENTOS = {
  modulo: 4251,
  tabelas: 1641,
  parametros: 1642,
  itens: 1643,
  itensGerenciamento: 1644,
  limitesPorLocal: 1664,
  codigoBarras: 1720,
  grupos: 1724,
  subgrupos: 1725,
  referencias: 1726,
  nomeComercial: 1727,
  nomeComercialGerenciamento: 1728,
  locais: 1734,
  locaisGerenciamento: 5563,
  usuarios: 1738,
  kits: 1739,
  tabelaKits: 1740,
  itensPorKit: 1741,
  itensKitAlterar: 1742,
  itensKitIncluir: 1743,
  kitRastreavel: 4478,
  destinosCompra: 1764,
  condicoesPagamento: 1765,
  transportadoras: 1766,
  movimentos: 1785,
  inventario: 1786,
  estoqueInicial: 1787,
  balanco: 1791,
  balancoManutencao: 1792,
  contagem: 1800,
  contagemManutencao: 1801,
  entradas: 1806,
  entradaNota: 5722,
  entradaManutencao: 1807,
  relacaoNotas: 1810,
  saidas: 1840,
  saidaInterno: 5733,
  saidaExterno: 5734,
  saidaCdc: 1843,
  saidaListagem: 1845,
  devolucoes: 1873,
  devolucaoInterno: 5735,
  devolucaoExterno: 5737,
  devolucaoCdc: 1876,
  devolucaoListagem: 1879,
  transferencias: 1887,
  transferenciaManutencao: 1888,
  transferenciaConferencia: 1889,
  requisicoes: 1894,
  requisicaoSaida: 1895,
  requisicaoInterno: 1896,
  requisicaoExterno: 1897,
  requisicaoCdc: 1898,
  requisicaoTransferencia: 1908,
  requisicaoTransferenciaManutencao: 1909,
  vendaExterna: 1911,
  vendaTerceiros: 1913,
  lancamentos: 1929,
  lancamentoInterno: 5736,
  lancamentoExterno: 5738,
  relatorios: 1955,
  movimentoCdcSintetico: 1964,
  movimentoCdcAnalitico: 1982,
  rastreabilidade: 2055,
  curvaAbc: 2029,
  curvaXyz: 4486,
  validadeMedicamentos: 2033,
  gestaoCompras: 2058,
  ultimasCompras: 2087,
  necessidadeCompra: 2091,
  necessidadeGeracao: 2092,
  necessidadeManutencao: 2093,
  necessidadeAutorizacao: 4487,
  estoqueMinimo: 2063,
  consumoMedio: 2080,
  pedidos: 2123,
  pedidoManutencao: 2124,
  definicaoVencedores: 2125,
  mapaCotacao: 2160,
  telaCotacao: 2165,
  autorizacaoPedidos: 4491,
  portalCompras: 4492,
  bionexo: 4489,
  utilitarios: 2166,
  desconsolidacao: 2167,
  desconsolidacaoNota: 5723,
  fechamentoMensal: 2168,
  cancelarFechamento: 2169,
  rastreabilidadeAcerto: 2178,
  atualizaLoteValidade: 4494,
  gerarSaldo: 2177,
  calculoEstoque: 2187,
  estoqueSeguranca: 2188,
  pontoPedido: 4497,
} as const;

const O = OPCOES_SUPRIMENTOS;

const flag = (coluna: string): FlagLegado => ({ tabela: 'GEUSERS', coluna });

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

// Os escopos do módulo (ESCOPOS_DO_MODULO): o local de estoque do usuário e o centro de custo do requisitante.
const ESCOPO_LOCAL = { escopos: ['localEstoque', 'centroCusto'] as const };

export const PERMISSOES_SUPRIMENTOS_M28: readonly DeclaracaoPermissao[] = [
  p(
    'suprimentos.item.ler',
    'Consultar o cadastro de itens (classe, unidades e fatores, controlado, antimicrobiano, lote)',
    [O.itens, O.itensGerenciamento],
  ),
  p(
    'suprimentos.item.editar',
    'Incluir e alterar itens de estoque, grupos, nomes comerciais e códigos de barras',
    [O.itensGerenciamento, O.grupos, O.subgrupos, O.nomeComercialGerenciamento, O.codigoBarras],
  ),
  p('suprimentos.fornecedor.ler', 'Consultar fornecedores e terceiros (dados bancários mascarados)', [
    O.tabelas,
    O.destinosCompra,
    O.vendaTerceiros,
  ]),
  p(
    'suprimentos.fornecedor.editar',
    'Incluir e alterar fornecedores, telefones e terceiros',
    [O.tabelas, O.vendaTerceiros],
    {
      criticidade: 'sensivel',
    },
  ),
  p('suprimentos.local.ler', 'Consultar os locais de armazenagem e o estoque mínimo e máximo por item', [
    O.locais,
    O.locaisGerenciamento,
    O.limitesPorLocal,
  ]),
  p('suprimentos.local.editar', 'Manter os locais de armazenagem e o estoque mínimo e máximo por item', [
    O.locaisGerenciamento,
    O.limitesPorLocal,
  ]),
  p(
    'acesso.escopo.ler',
    'Consultar os usuários do estoque: locais por tipo de movimento, centros de custo e marcas',
    [O.usuarios],
    { categoria: 'tecnica' },
  ),
  p('suprimentos.pedido.ler', 'Consultar necessidades e pedidos de compra', [
    O.pedidos,
    O.pedidoManutencao,
    O.necessidadeCompra,
  ]),
  p(
    'suprimentos.pedido.criar',
    'Gerar a necessidade e criar o pedido de compra (itens e fornecedores convidados)',
    [O.pedidoManutencao, O.necessidadeGeracao, O.necessidadeManutencao],
  ),
  p(
    'suprimentos.pedido.aprovar',
    'Aprovar ou reprovar o pedido de compra pela alçada de valor',
    [O.autorizacaoPedidos],
    {
      flagsLegado: [flag('PERMITIR_AUTORIZAR_PEDIDO')],
      criticidade: 'sensivel',
      categoria: 'financeira',
    },
  ),
  p('suprimentos.cotacao.ler', 'Consultar o mapa de cotação (propostas, rateio, envios ao portal)', [
    O.mapaCotacao,
    O.telaCotacao,
    O.definicaoVencedores,
  ]),
  p(
    'suprimentos.cotacao.escolher',
    'Registrar propostas e escolher o vencedor da cotação (com justificativa)',
    [O.definicaoVencedores, O.telaCotacao],
    { criticidade: 'sensivel', categoria: 'financeira' },
  ),
  p('suprimentos.compra.ler', 'Consultar o histórico de compras por item', [O.ultimasCompras]),
  p('suprimentos.compra.exportar', 'Exportar o histórico de compras por item', [O.ultimasCompras]),
  p('suprimentos.nota.ler', 'Consultar as notas fiscais de entrada', [O.entradas, O.relacaoNotas]),
  p(
    'suprimentos.nota.registrar',
    'Registrar a entrada por nota fiscal (itens, lotes, validade, fator e conferência)',
    [O.entradaNota, O.entradaManutencao],
    ESCOPO_LOCAL,
  ),
  p('suprimentos.requisicao.ler', 'Consultar as requisições do setor por local', [
    O.requisicoes,
    O.requisicaoSaida,
  ]),
  p('suprimentos.requisicao.criar', 'Requisitar material ao estoque (setor ou paciente)', [
    O.requisicaoInterno,
    O.requisicaoExterno,
    O.requisicaoCdc,
  ]),
  p('suprimentos.requisicao.autorizar', 'Autorizar a requisição do setor', [O.requisicaoSaida], {
    flagsLegado: [flag('AUT_REQ')],
    criticidade: 'sensivel',
  }),
  p(
    'suprimentos.requisicao.atender',
    'Atender a requisição (total ou em parte) com a saída',
    [O.saidaInterno, O.saidaExterno, O.saidaCdc],
    ESCOPO_LOCAL,
  ),
  p('suprimentos.saida.ler', 'Consultar saídas e movimentos diretos por local e período', [
    O.saidas,
    O.saidaListagem,
    O.lancamentos,
  ]),
  p(
    'suprimentos.saida.registrar',
    'Registrar a saída (setor, paciente internado ou externo, terceiro) e o movimento direto',
    [O.saidaInterno, O.saidaExterno, O.saidaCdc, O.vendaTerceiros, O.lancamentoInterno, O.lancamentoExterno],
    ESCOPO_LOCAL,
  ),
  p('suprimentos.transferencia.ler', 'Consultar as transferências entre locais', [
    O.transferencias,
    O.transferenciaConferencia,
  ]),
  p(
    'suprimentos.transferencia.enviar',
    'Enviar a transferência entre locais',
    [O.transferenciaManutencao],
    ESCOPO_LOCAL,
  ),
  p(
    'suprimentos.transferencia.receber',
    'Receber a transferência (conferência e divergência)',
    [O.transferenciaManutencao, O.transferenciaConferencia],
    ESCOPO_LOCAL,
  ),
  p('suprimentos.devolucao.ler', 'Consultar as devoluções', [O.devolucoes, O.devolucaoListagem]),
  p(
    'suprimentos.devolucao.registrar',
    'Registrar a devolução ao estoque (setor ou paciente)',
    [O.devolucaoInterno, O.devolucaoExterno, O.devolucaoCdc],
    ESCOPO_LOCAL,
  ),
  p('suprimentos.saldo.ler', 'Consultar saldos, lotes e validades por item e local', [
    O.itens,
    O.validadeMedicamentos,
    O.saidas,
  ]),
  p(
    'suprimentos.lote.corrigir',
    'Corrigir a validade digitada errada de um lote (saneamento)',
    [O.atualizaLoteValidade, O.rastreabilidadeAcerto],
    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'suprimentos.lote.rastrear',
    'Rastrear o lote até o setor ou o paciente (leitura auditada)',
    [O.rastreabilidade],
    {
      criticidade: 'sensivel',
      categoria: 'clinica',
    },
  ),
  p('suprimentos.kit.ler', 'Consultar kits e carrinhos de parada rastreáveis', [
    O.kits,
    O.tabelaKits,
    O.itensPorKit,
  ]),
  p('suprimentos.kit.editar', 'Manter kits e itens por kit', [
    O.tabelaKits,
    O.itensKitAlterar,
    O.itensKitIncluir,
  ]),
  p('suprimentos.kit.repor', 'Repor e conferir o carrinho de parada (lacre e checklist)', [O.kitRastreavel]),
  p('suprimentos.inventario.ler', 'Consultar inventários, balanços e o estoque inicial', [
    O.inventario,
    O.balanco,
    O.estoqueInicial,
  ]),
  p('suprimentos.inventario.contar', 'Registrar a contagem cega do inventário', [
    O.contagem,
    O.contagemManutencao,
  ]),
  p(
    'suprimentos.inventario.aprovar',
    'Aprovar o ajuste do inventário (vira o balanço)',
    [O.balancoManutencao],
    {
      criticidade: 'sensivel',
    },
  ),
  p('suprimentos.consumo.ler', 'Consultar o consumo por local e por centro de custo', [
    O.movimentoCdcSintetico,
    O.movimentoCdcAnalitico,
  ]),
  p('suprimentos.consumo.exportar', 'Exportar o consumo por local e por centro de custo', [
    O.movimentoCdcSintetico,
  ]),
  p('suprimentos.fechamento.ler', 'Consultar os fechamentos mensais do estoque', [
    O.fechamentoMensal,
    O.cancelarFechamento,
  ]),
  p('suprimentos.fechamento.fechar', 'Fechar o mês do estoque', [O.fechamentoMensal], {
    criticidade: 'sensivel',
  }),
  p(
    'suprimentos.fechamento.reabrir',
    'Reabrir o mês fechado do estoque (com motivo)',
    [O.cancelarFechamento],
    {
      flagsLegado: [flag('PERMITIR_DESBLOQUEIO_FECHAMENTO')],
      criticidade: 'critica',
    },
  ),
  p('suprimentos.recalculo.ler', 'Consultar os recálculos de saldo feitos', [O.gerarSaldo]),
  p('suprimentos.sugestao.ler', 'Consultar o ponto de pedido e a sugestão de compra (curvas ABC e XYZ)', [
    O.estoqueMinimo,
    O.consumoMedio,
    O.curvaAbc,
    O.curvaXyz,
    O.pontoPedido,
  ]),
  p('suprimentos.sugestao.gerarPedido', 'Gerar o pedido de compra a partir da sugestão', [
    O.necessidadeGeracao,
    O.pontoPedido,
  ]),
  p(
    'suprimentos.documento.desconsolidar',
    'Desconsolidar documento de estoque (com motivo; a correção padrão é a devolução)',
    [O.desconsolidacao, O.desconsolidacaoNota],
    { criticidade: 'critica' },
  ),
];

export const PERMISSOES_SUPRIMENTOS_CODIGOS = Object.fromEntries(
  PERMISSOES_SUPRIMENTOS_M28.map((x) => [x.codigo, x.codigo]),
) as Readonly<Record<string, string>>;
