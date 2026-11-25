// Módulo do estoque, do almoxarifado e das compras (M28), com o OPME e a manipulação (M46), na API migrada (F2.2):
// as portas próprias (MariaDB pelo @sgh/nucleo) quando o núcleo existe; as de memória só em dev/ci com as fontes
// sintéticas; fora disso, as indisponíveis (503 em tudo, falha fechada) — a mesma regra do F2-L.
// O OPME e a manipulação leem o agendamento, a sala e o estado da porta do centro cirúrgico (PORTA_CIRURGIA): os
// controllers deles entram só com o módulo cirurgia pedido em API_MODULOS (sem ele, a rota não existe, nada em
// silêncio: o motivo fica no log de subida).
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
import { PORTA_SLA_CONTRATO, portaSlaContratoIndisponivel } from './sla-contrato.js';
import { ManipulacaoController } from './manipulacao.controller.js';
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
      'OPME e manipulação fora do ar: dependem do módulo cirurgia em API_MODULOS (a porta do centro cirúrgico).',
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
      ConsignadoController,
      TaxaConsignacaoController,
      SlaContratoController,
      ContratoController,
      ...(comCirurgia ? [OpmeController, ManipulacaoController] : []),
    ],
    providers: [
      ...(configuracaoMemoria ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracaoMemoria }] : []),
      { provide: PORTA_SUPRIMENTOS, useValue: suprimentos },
      { provide: PORTA_OPME, useValue: opme },
      { provide: PORTA_MANIPULACAO, useValue: manipulacao },
      { provide: PORTA_CADASTRO_ESTOQUE, useValue: cadastroEstoque },
      { provide: PORTA_VINCULO_REFERENCIA, useValue: vinculoReferencia },
      { provide: PORTA_CONSIGNADO, useValue: consignado },
      { provide: PORTA_TAXA_CONSIGNACAO, useValue: taxaConsignacao },
      { provide: PORTA_SLA_CONTRATO, useValue: slaContrato },
      { provide: PORTA_CONTRATO, useValue: contrato },
    ],
    exports: [PORTA_SUPRIMENTOS, PORTA_OPME, PORTA_MANIPULACAO, PORTA_CONSIGNADO],
  };
}
