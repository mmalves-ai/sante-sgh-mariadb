// Módulo do estoque, do almoxarifado e das compras (M28), com o OPME e a manipulação (M46), na API migrada (F2.2):
// as portas próprias (MariaDB pelo @sgh/nucleo) quando o núcleo existe; as de memória só em dev/ci com as fontes
// sintéticas; fora disso, as indisponíveis (503 em tudo, falha fechada) — a mesma regra do F2-L.
// O OPME lê o agendamento, a sala e o estado da porta do centro cirúrgico (PORTA_CIRURGIA): o controller dele entra
// só com o módulo cirurgia pedido em API_MODULOS (sem ele, a rota não existe, nada em silêncio: o motivo fica no log
// de subida). A manipulação e a produção interna não dependem do centro cirúrgico e sobem sempre (ADR 0002, C1-124).
// A liberação por chave e os parâmetros vêm da FONTE_CONFIGURACAO global do módulo de configuração (na memória, a
// funcionalidade vale ligada, como na sessão sintética).
import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { type ContextoModulo, modulosPedidos } from '../registro.js';
import { CadastroEstoqueController } from './cadastro-estoque.controller.js';
import {
  PORTA_CADASTRO_ESTOQUE,
  type PortaCadastroEstoque,
  portaCadastroEstoqueIndisponivel,
} from './cadastro-estoque-porta.js';
import { ConsignadoController } from './consignado.controller.js';
import { PORTA_CONSIGNADO, type PortaConsignado } from './consignado-porta.js';
import { PortaConsignadoMemoria } from './consignado-porta-memoria.js';
import { TaxaConsignacaoController } from './consignado-taxa.controller.js';
import { ContratoController } from './contrato.controller.js';
import { PORTA_CONTRATO } from './contrato-porta.js';
import { PORTA_TAXA_CONSIGNACAO, portaTaxaConsignacaoIndisponivel } from './consignado-taxa.js';
import { SlaContratoController } from './sla-contrato.controller.js';
import { HomologacaoFornecedorController } from './homologacao-fornecedor.controller.js';
import {
  PORTA_HOMOLOGACAO_FORNECEDOR,
  portaHomologacaoFornecedorIndisponivel,
} from './homologacao-fornecedor.js';
import { PORTA_SLA_CONTRATO, portaSlaContratoIndisponivel } from './sla-contrato.js';
import { RomaneioEntregaController } from './romaneio-entrega.controller.js';
import { PORTA_ROMANEIO_ENTREGA, portaRomaneioEntregaIndisponivel } from './romaneio-entrega.js';
import { ManipulacaoController } from './manipulacao.controller.js';
import { ProducaoInternaController } from './producao-interna.controller.js';
import { PORTA_PRODUCAO_INTERNA, portaProducaoInternaIndisponivel } from './producao-interna.js';
import { PORTA_MANIPULACAO, type PortaManipulacao } from './manipulacao-porta.js';
import { PortaManipulacaoMemoria } from './manipulacao-porta-memoria.js';
import { OpmeController } from './opme.controller.js';
import { PORTA_OPME, type PortaOpme } from './opme-porta.js';
import { PedidoGestaoController } from './pedido-gestao.controller.js';
import { PortaOpmeMemoria } from './opme-porta-memoria.js';
import { PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';
import { type ContratosDoPedidoMemoria, PortaSuprimentosMemoria } from './porta-memoria.js';
import { SuprimentosController } from './suprimentos.controller.js';
import { VinculoReferenciaPrecoController } from './vinculo-referencia-preco.controller.js';
import { PORTA_VINCULO_REFERENCIA, portaVinculoReferenciaIndisponivel } from './vinculo-referencia-preco.js';
import { EnderecamentoController } from './enderecamento.controller.js';
import { PORTA_ENDERECAMENTO, portaEnderecamentoIndisponivel } from './enderecamento.js';
import { AtaEmpenhoController } from './ata-empenho.controller.js';
import { PORTA_ATA_EMPENHO, portaAtaEmpenhoIndisponivel } from './ata-empenho.js';
import { EntradaDoacaoController } from './entrada-doacao.controller.js';
import { PORTA_ENTRADA_DOACAO, portaEntradaDoacaoIndisponivel } from './entrada-doacao.js';

export interface OpcoesModuloSuprimentos {
  /** Testes: as portas já montadas. */
  readonly suprimentos?: PortaSuprimentos;
  readonly opme?: PortaOpme;
  readonly manipulacao?: PortaManipulacao;
  /** Testes: a porta do consignado já montada. */
  readonly consignado?: PortaConsignado;
  /** Testes: a porta do cadastro do estoque (F3.6) já montada. */
  readonly cadastroEstoque?: PortaCadastroEstoque;
  /** Testes: as chaves de liberação da memória sem estas (a funcionalidade desligada fica em consulta). */
  readonly semChaves?: readonly string[];
}

/** As portas do módulo pela regra do F2-L. */
export async function portasDeSuprimentos(
  ctx: ContextoModulo,
): Promise<{ suprimentos: PortaSuprimentos; opme: PortaOpme; manipulacao: PortaManipulacao }> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const { PortaSuprimentosPropria } = await import('./porta-propria.js');
    const { PortaOpmePropria } = await import('./opme-porta-propria.js');
    const { PortaManipulacaoPropria } = await import('./manipulacao-porta-propria.js');
    return {
      suprimentos: new PortaSuprimentosPropria(ctx.nucleo),
      opme: new PortaOpmePropria(ctx.nucleo),
      manipulacao: new PortaManipulacaoPropria(ctx.nucleo),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return {
      suprimentos: new PortaSuprimentosMemoria(null),
      opme: new PortaOpmeMemoria(),
      manipulacao: new PortaManipulacaoMemoria(),
    };
  const { portaSuprimentosIndisponivel } = await import('./porta-propria.js');
  const { portaOpmeIndisponivel } = await import('./opme-porta-propria.js');
  const { portaManipulacaoIndisponivel } = await import('./manipulacao-porta-propria.js');
  return {
    suprimentos: portaSuprimentosIndisponivel(),
    opme: portaOpmeIndisponivel(),
    manipulacao: portaManipulacaoIndisponivel(),
  };
}

@Module({})
class ModuloSuprimentos {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloSuprimentos = {},
): Promise<DynamicModule> {
  const todas =
    opcoes.suprimentos && opcoes.opme && opcoes.manipulacao ? null : await portasDeSuprimentos(ctx);
  const suprimentos = opcoes.suprimentos ?? todas!.suprimentos;
  const opme = opcoes.opme ?? todas!.opme;
  const manipulacao = opcoes.manipulacao ?? todas!.manipulacao;
  const pedidos = (() => {
    try {
      return modulosPedidos(ctx.env);
    } catch {
      return [] as readonly string[];
    }
  })();
  const comCirurgia = pedidos.includes('cirurgia');
  if (!comCirurgia)
    new Logger('suprimentos').warn(
      'OPME fora do ar: depende do módulo cirurgia em API_MODULOS (a porta do centro cirúrgico).',
    );
  // O cadastro do estoque (F3.6) grava no banco próprio; sem o núcleo, a memória só em dev/ci com as fontes
  // sintéticas (a mesma regra do F2-L); fora disso, 503 em tudo.
  const cadastroEstoque =
    opcoes.cadastroEstoque ??
    (ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./cadastro-estoque-porta-propria.js')).PortaCadastroEstoquePropria(ctx.nucleo)
      : !ctx.nucleo && fontesSinteticas(ctx.env)
        ? new (await import('./cadastro-estoque-porta-memoria.js')).PortaCadastroEstoqueMemoria()
        : portaCadastroEstoqueIndisponivel());
  // F3.6 (05-SUP linha 28): o vínculo do item com a referência de preço grava só no banco próprio; sem o núcleo, 503.
  const vinculoReferencia =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./vinculo-referencia-preco.js')).PortaVinculoReferenciaPropria(ctx.nucleo)
      : portaVinculoReferenciaIndisponivel();
  // F8 (05-SUP linha 4): o endereçamento do armazém e a reserva para a separação gravam só no banco próprio (503 sem o núcleo).
  const enderecamento =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./enderecamento.js')).PortaEnderecamentoPropria(ctx.nucleo)
      : portaEnderecamentoIndisponivel();
  // C1-126 (09-AREA linha 79): a entrada por doação grava só no banco próprio (503 sem o núcleo).
  const entradaDoacao =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./entrada-doacao.js')).PortaEntradaDoacaoPropria(ctx.nucleo)
      : portaEntradaDoacaoIndisponivel();
  // 05-SUP linha 24: o consignado grava no banco próprio; sem o núcleo, a memória só em dev/ci com as fontes sintéticas;
  // fora disso, 503 em tudo. A taxa por faixa de valor grava só no banco próprio.
  const consignado =
    opcoes.consignado ??
    (ctx.nucleo && ctx.configuracao.clientePadrao
      ? (await import('./consignado-porta-propria.js')).portaConsignadoPropria(ctx.nucleo)
      : !ctx.nucleo && fontesSinteticas(ctx.env)
        ? new PortaConsignadoMemoria(opme instanceof PortaOpmeMemoria ? opme : null)
        : (await import('./consignado-porta-propria.js')).portaConsignadoIndisponivel());
  // 09-AREA linha 88: o SLA do contrato com fornecedor grava só no banco próprio (503 sem o núcleo).
  const slaContrato =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./sla-contrato.js')).PortaSlaContratoPropria(ctx.nucleo)
      : portaSlaContratoIndisponivel();
  // 09-AREA linha 77 (C1-120): o romaneio de entrega entre unidades grava só no banco próprio (503 sem o núcleo).
  const romaneioEntrega =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./romaneio-entrega.js')).PortaRomaneioEntregaPropria(ctx.nucleo)
      : portaRomaneioEntregaIndisponivel();
  // 09-AREA linha 66: a homologação do fornecedor por questionário grava só no banco próprio (503 sem o núcleo).
  const homologacaoFornecedor =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./homologacao-fornecedor.js')).PortaHomologacaoFornecedorPropria(ctx.nucleo)
      : portaHomologacaoFornecedorIndisponivel();
  const taxaConsignacao =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./consignado-taxa.js')).PortaTaxaConsignacaoPropria(ctx.nucleo)
      : portaTaxaConsignacaoIndisponivel();
  // 05-SUP linha 27: os contratos com fornecedores gravam no banco próprio; sem o núcleo, a memória só em dev/ci com as
  // fontes sintéticas; fora disso, 503 em tudo. Na memória, o pedido de compra com contrato grava o vínculo nela.
  const ligarContratosMemoria = <T extends ContratosDoPedidoMemoria>(porta: T): T => {
    if (suprimentos instanceof PortaSuprimentosMemoria) suprimentos.ligarContratos(porta);
    return porta;
  };
  const contrato =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? (await import('./contrato-porta-propria.js')).portaContratoPropria(ctx.nucleo)
      : !ctx.nucleo && fontesSinteticas(ctx.env)
        ? ligarContratosMemoria(new (await import('./contrato-porta-memoria.js')).PortaContratoMemoria())
        : (await import('./contrato-porta-propria.js')).portaContratoIndisponivel();
  // C1-124 (05-SUP linha 12): a produção interna (lote produzido da ordem e kit montado) grava só no banco próprio.
  const producaoInterna =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./producao-interna.js')).PortaProducaoInternaPropria(ctx.nucleo)
      : portaProducaoInternaIndisponivel();
  // C2-030 (05-SUP linha 26): a ata de registro de preços e o empenho gravam só no banco próprio (503 sem o núcleo).
  const ataEmpenho =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new (await import('./ata-empenho.js')).PortaAtaEmpenhoPropria(ctx.nucleo)
      : portaAtaEmpenhoIndisponivel();
  const memoria = suprimentos.destino === 'memoria';
  const configuracaoMemoria =
    memoria && !pedidos.includes('config')
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: () =>
            chavesIniciaisSinteticas().filter((c) => !(opcoes.semChaves ?? []).includes(c.chave)),
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null;
  return {
    module: ModuloSuprimentos,
    controllers: [
      SuprimentosController,
      CadastroEstoqueController,
      // F3.6 (05-SUP linha 20): a gestão do pedido emitido.
      PedidoGestaoController,
      VinculoReferenciaPrecoController,
      EnderecamentoController,
      EntradaDoacaoController,
      ConsignadoController,
      TaxaConsignacaoController,
      SlaContratoController,
      RomaneioEntregaController,
      HomologacaoFornecedorController,
      ContratoController,
      AtaEmpenhoController,
      ManipulacaoController,
      ProducaoInternaController,
      ...(comCirurgia ? [OpmeController] : []),
    ],
    providers: [
      ...(configuracaoMemoria ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracaoMemoria }] : []),
      { provide: PORTA_SUPRIMENTOS, useValue: suprimentos },
      { provide: PORTA_OPME, useValue: opme },
      { provide: PORTA_MANIPULACAO, useValue: manipulacao },
      { provide: PORTA_CADASTRO_ESTOQUE, useValue: cadastroEstoque },
      { provide: PORTA_VINCULO_REFERENCIA, useValue: vinculoReferencia },
      { provide: PORTA_ENDERECAMENTO, useValue: enderecamento },
      { provide: PORTA_ENTRADA_DOACAO, useValue: entradaDoacao },
      { provide: PORTA_CONSIGNADO, useValue: consignado },
      { provide: PORTA_TAXA_CONSIGNACAO, useValue: taxaConsignacao },
      { provide: PORTA_SLA_CONTRATO, useValue: slaContrato },
      { provide: PORTA_ROMANEIO_ENTREGA, useValue: romaneioEntrega },
      { provide: PORTA_HOMOLOGACAO_FORNECEDOR, useValue: homologacaoFornecedor },
      { provide: PORTA_CONTRATO, useValue: contrato },
      { provide: PORTA_ATA_EMPENHO, useValue: ataEmpenho },
      { provide: PORTA_PRODUCAO_INTERNA, useValue: producaoInterna },
    ],
    exports: [PORTA_SUPRIMENTOS, PORTA_OPME, PORTA_MANIPULACAO, PORTA_CONSIGNADO],
  };
}
