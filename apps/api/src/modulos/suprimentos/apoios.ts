// As funcionalidades do estoque, do almoxarifado e das compras (ficha do M28, seção 12): uma chave de liberação por
// funcionalidade (estoque, nota fiscal, compras, inventário, kits, fechamento, saneamento), cada uma um apoio de
// gravação do M18 (POL-3: completa e DESLIGADA até a conferência; o administrador liga por estabelecimento, local de
// estoque ou pessoa), com o mapa operação → permissão de agir que vale também no servidor.
import type { GravacaoSuprimentos } from '@sgh/contratos';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorSghSuprimentos, PortaSuprimentos } from './porta.js';

/** As funcionalidades, a chave de liberação, o nome nas mensagens e as operações (com a permissão de agir). */
const FUNCIONALIDADES = {
  estoque: {
    chave: 'suprimentos.estoque',
    nome: 'o estoque (saídas, requisições, devoluções e transferências)',
    operacoes: {
      'suprimentos.registrarSaida': 'suprimentos.saida.registrar',
      'suprimentos.requisitarMaterial': 'suprimentos.requisicao.criar',
      'suprimentos.registrarDevolucao': 'suprimentos.devolucao.registrar',
      'suprimentos.transferir': 'suprimentos.transferencia.receber',
      'suprimentos.registrarMovimentoDireto': 'suprimentos.saida.registrar',
    },
    extras: {
      atenderRequisicao: 'suprimentos.requisicao.atender',
      enviarTransferencia: 'suprimentos.transferencia.enviar',
    },
  },
  notaFiscal: {
    chave: 'suprimentos.notaFiscal',
    nome: 'a entrada por nota fiscal',
    operacoes: { 'suprimentos.registrarEntradaNF': 'suprimentos.nota.registrar' },
    extras: {},
  },
  compras: {
    chave: 'suprimentos.compras',
    nome: 'as compras (pedido, cotação e aprovação)',
    operacoes: {
      'suprimentos.criarPedido': 'suprimentos.pedido.criar',
      'suprimentos.registrarProposta': 'suprimentos.cotacao.escolher',
      'suprimentos.definirVencedorCotacao': 'suprimentos.cotacao.escolher',
      // F3.6 (05-SUP linha 20): a gestão do pedido emitido.
      'suprimentos.programarEntregasPedido': 'suprimentos.pedido.criar',
      'suprimentos.acompanharPedido': 'suprimentos.pedido.criar',
      'suprimentos.cancelarCompra': 'suprimentos.pedido.aprovar',
      'suprimentos.gravarMotivoCancelamentoCompra': 'suprimentos.pedido.aprovar',
    },
    extras: {
      aprovarPedido: 'suprimentos.pedido.aprovar',
      pontoPedido: 'suprimentos.sugestao.gerarPedido',
    },
  },
  inventario: {
    chave: 'suprimentos.inventario',
    nome: 'o inventário',
    operacoes: { 'suprimentos.registrarBalanco': 'suprimentos.inventario.aprovar' },
    extras: {
      abrirInventario: 'suprimentos.inventario.aprovar',
      contar: 'suprimentos.inventario.contar',
      decidir: 'suprimentos.inventario.aprovar',
    },
  },
  kits: {
    chave: 'suprimentos.kits',
    nome: 'os kits e carrinhos rastreáveis',
    operacoes: {
      'suprimentos.reporKitRastreavel': 'suprimentos.kit.repor',
      'suprimentos.gravarKitPadrao': 'suprimentos.kit.editar',
    },
    extras: { conferirCarrinho: 'suprimentos.kit.repor' },
  },
  fechamento: {
    chave: 'suprimentos.fechamento',
    nome: 'o fechamento mensal do estoque',
    operacoes: {
      'suprimentos.fecharMes': 'suprimentos.fechamento.fechar',
      'suprimentos.reabrirMes': 'suprimentos.fechamento.reabrir',
      'suprimentos.recalcularSaldos': 'suprimentos.recalculo.executar',
    },
    extras: {},
  },
  saneamento: {
    chave: 'suprimentos.saneamento',
    nome: 'o saneamento de lotes e documentos',
    operacoes: {
      'suprimentos.corrigirValidadeLote': 'suprimentos.lote.corrigir',
      'suprimentos.desconsolidarDocumento': 'suprimentos.documento.desconsolidar',
    },
    extras: {},
  },
  // M55 (etapa 3): os contratos com fornecedores (o pedido com contrato só com a chave ligada; ficha, seção 12).
  contratos: {
    chave: 'contratos',
    nome: 'os contratos com fornecedores',
    operacoes: {},
    extras: {
      editarContrato: 'suprimentos.contrato.editar',
      aditarContrato: 'suprimentos.contrato.aditar',
      avaliarContrato: 'suprimentos.contrato.avaliar',
    },
  },
} as const;

export type FuncionalidadeSuprimentos = keyof typeof FUNCIONALIDADES;

export class ApoiosSuprimentos {
  readonly apoios: Readonly<Record<FuncionalidadeSuprimentos, ApoioGravacao<GravadorSghSuprimentos>>>;

  constructor(
    readonly porta: PortaSuprimentos,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const a = (f: FuncionalidadeSuprimentos) =>
      new ApoioGravacao<GravadorSghSuprimentos>(
        {
          chave: FUNCIONALIDADES[f].chave,
          nome: FUNCIONALIDADES[f].nome,
          operacoes: FUNCIONALIDADES[f].operacoes,
        },
        porta,
        trilha,
        configuracao,
        cache,
      );
    this.apoios = {
      estoque: a('estoque'),
      notaFiscal: a('notaFiscal'),
      compras: a('compras'),
      inventario: a('inventario'),
      kits: a('kits'),
      fechamento: a('fechamento'),
      saneamento: a('saneamento'),
      contratos: a('contratos'),
    };
  }

  /** A funcionalidade da operação (o mapa vale no servidor). */
  daOperacao(op: string): ApoioGravacao<GravadorSghSuprimentos> {
    for (const [f, d] of Object.entries(FUNCIONALIDADES))
      if (op in d.operacoes) return this.apoios[f as FuncionalidadeSuprimentos];
    return this.apoios.estoque;
  }

  /** O estado de gravação das telas: cada funcionalidade e cada ação (permissão + liberação + catálogo). */
  async gravacao(s: SessaoCadastro): Promise<GravacaoSuprimentos> {
    const funcionalidades: GravacaoSuprimentos['funcionalidades'] = {};
    const operacoes: GravacaoSuprimentos['operacoes'] = {};
    await Promise.all(
      (Object.keys(FUNCIONALIDADES) as FuncionalidadeSuprimentos[]).map(async (f) => {
        const g = await this.apoios[f].gravacao(s, FUNCIONALIDADES[f].extras);
        funcionalidades[f] = { ligada: g.ligada, motivo: g.motivo };
        for (const [op, v] of Object.entries(g.operacoes))
          operacoes[op] = { ligada: v.pode, motivo: v.motivo };
      }),
    );
    return { funcionalidades, operacoes };
  }
}
