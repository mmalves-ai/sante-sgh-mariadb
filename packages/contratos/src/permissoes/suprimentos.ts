// Permissões do M28 (ficha, seção 7; convencoes.md §12): estoque, almoxarifado e compras. Quem tem a opção no menu de
// origem tem a permissão (regra 1 do M06); a correspondência está em conector/mapa/permissoes.tsv.
// As alçadas do usuário do estoque concedem as ações de alçada: autorizar requisição, autorizar pedido e desbloquear o
// fechamento; os locais de estoque do usuário por tipo de movimento são escopo (`localEstoque`), conferido no servidor.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

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
  ),
  p(
    'suprimentos.item.editar',
    'Incluir e alterar itens de estoque, grupos, nomes comerciais e códigos de barras',
  ),
  p('suprimentos.fornecedor.ler', 'Consultar fornecedores e terceiros (dados bancários mascarados)'),
  p(
    'suprimentos.fornecedor.editar',
    'Incluir e alterar fornecedores, telefones e terceiros',

    {
      criticidade: 'sensivel',
    },
  ),
  p('suprimentos.local.ler', 'Consultar os locais de armazenagem e o estoque mínimo e máximo por item'),
  p('suprimentos.local.editar', 'Manter os locais de armazenagem e o estoque mínimo e máximo por item'),
  p(
    'acesso.escopo.ler',
    'Consultar os usuários do estoque: locais por tipo de movimento, centros de custo e marcas',

    { categoria: 'tecnica' },
  ),
  p('suprimentos.pedido.ler', 'Consultar necessidades e pedidos de compra'),
  p(
    'suprimentos.pedido.criar',
    'Gerar a necessidade e criar o pedido de compra (itens e fornecedores convidados)',
  ),
  p(
    'suprimentos.pedido.aprovar',
    'Aprovar ou reprovar o pedido de compra pela alçada de valor',

    {
      criticidade: 'sensivel',
      categoria: 'financeira',
    },
  ),
  p('suprimentos.cotacao.ler', 'Consultar o mapa de cotação (propostas, rateio, envios ao portal)'),
  p(
    'suprimentos.cotacao.escolher',
    'Registrar propostas e escolher o vencedor da cotação (com justificativa)',

    { criticidade: 'sensivel', categoria: 'financeira' },
  ),
  p('suprimentos.compra.ler', 'Consultar o histórico de compras por item'),
  p('suprimentos.compra.exportar', 'Exportar o histórico de compras por item'),
  p('suprimentos.nota.ler', 'Consultar as notas fiscais de entrada'),
  p(
    'suprimentos.nota.registrar',
    'Registrar a entrada por nota fiscal (itens, lotes, validade, fator e conferência)',

    ESCOPO_LOCAL,
  ),
  p('suprimentos.requisicao.ler', 'Consultar as requisições do setor por local'),
  p('suprimentos.requisicao.criar', 'Requisitar material ao estoque (setor ou paciente)'),
  p('suprimentos.requisicao.autorizar', 'Autorizar a requisição do setor', {
    criticidade: 'sensivel',
  }),
  p(
    'suprimentos.requisicao.atender',
    'Atender a requisição (total ou em parte) com a saída',

    ESCOPO_LOCAL,
  ),
  p('suprimentos.saida.ler', 'Consultar saídas e movimentos diretos por local e período'),
  p(
    'suprimentos.saida.registrar',
    'Registrar a saída (setor, paciente internado ou externo, terceiro) e o movimento direto',

    ESCOPO_LOCAL,
  ),
  p('suprimentos.transferencia.ler', 'Consultar as transferências entre locais'),
  p(
    'suprimentos.transferencia.enviar',
    'Enviar a transferência entre locais',

    ESCOPO_LOCAL,
  ),
  p(
    'suprimentos.transferencia.receber',
    'Receber a transferência (conferência e divergência)',

    ESCOPO_LOCAL,
  ),
  p('suprimentos.devolucao.ler', 'Consultar as devoluções'),
  p(
    'suprimentos.devolucao.registrar',
    'Registrar a devolução ao estoque (setor ou paciente)',

    ESCOPO_LOCAL,
  ),
  p('suprimentos.saldo.ler', 'Consultar saldos, lotes e validades por item e local'),
  p(
    'suprimentos.lote.corrigir',
    'Corrigir a validade digitada errada de um lote (saneamento)',

    {
      criticidade: 'sensivel',
    },
  ),
  p(
    'suprimentos.lote.rastrear',
    'Rastrear o lote até o setor ou o paciente (leitura auditada)',

    {
      criticidade: 'sensivel',
      categoria: 'clinica',
    },
  ),
  p('suprimentos.kit.ler', 'Consultar kits e carrinhos de parada rastreáveis'),
  p('suprimentos.kit.editar', 'Manter kits e itens por kit'),
  p('suprimentos.kit.repor', 'Repor e conferir o carrinho de parada (lacre e checklist)'),
  p('suprimentos.inventario.ler', 'Consultar inventários, balanços e o estoque inicial'),
  p('suprimentos.inventario.contar', 'Registrar a contagem cega do inventário'),
  p(
    'suprimentos.inventario.aprovar',
    'Aprovar o ajuste do inventário (vira o balanço)',

    {
      criticidade: 'sensivel',
    },
  ),
  p('suprimentos.consumo.ler', 'Consultar o consumo por local e por centro de custo'),
  p('suprimentos.consumo.exportar', 'Exportar o consumo por local e por centro de custo'),
  p('suprimentos.fechamento.ler', 'Consultar os fechamentos mensais do estoque'),
  p('suprimentos.fechamento.fechar', 'Fechar o mês do estoque', {
    criticidade: 'sensivel',
  }),
  p(
    'suprimentos.fechamento.reabrir',
    'Reabrir o mês fechado do estoque (com motivo)',

    {
      criticidade: 'critica',
    },
  ),
  p('suprimentos.recalculo.ler', 'Consultar os recálculos de saldo feitos'),
  p('suprimentos.sugestao.ler', 'Consultar o ponto de pedido e a sugestão de compra (curvas ABC e XYZ)'),
  p('suprimentos.sugestao.gerarPedido', 'Gerar o pedido de compra a partir da sugestão'),
  p(
    'suprimentos.documento.desconsolidar',
    'Desconsolidar documento de estoque (com motivo; a correção padrão é a devolução)',

    { criticidade: 'critica' },
  ),
];

export const PERMISSOES_SUPRIMENTOS_CODIGOS = Object.fromEntries(
  PERMISSOES_SUPRIMENTOS_M28.map((x) => [x.codigo, x.codigo]),
) as Readonly<Record<string, string>>;
