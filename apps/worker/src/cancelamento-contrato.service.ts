// Rotina diária de efetivação dos cancelamentos de contrato de plano vencidos no `worker` (08-SGO L94, C2-108): por
// cliente e estabelecimento em atividade, efetiva os pedidos com a data de efeito alcançada pela porta própria (a mesma
// efetivação da API: baixa cadastral de cada beneficiário e crédito ao contratante). A cada hora (o pedido só entra no
// dia do efeito; o efetivado sai da lista, então o ciclo seguinte não repete). Ligado fora de dev/ci; em dev/ci só com
// CANCELAMENTO_CONTRATO_DIARIO=ligado. Log só com contagens.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import {
  efetivarVencidosDoEstabelecimento,
  type PortaCancelamentoContrato,
  PortaCancelamentoContratoPropria,
} from './cancelamento-contrato-propria.js';
import { logger } from './logger.js';
import { type NucleoServico, servicoLigado, voltaPorEstabelecimento } from './servico-worker.js';

export function efetivacaoCancelamentoLigada(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'CANCELAMENTO_CONTRATO_DIARIO');
}

export type FabricaPortaCancelamento = (cliente: string) => PortaCancelamentoContrato;

@Injectable()
export class CancelamentoContratoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaCancelamento | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaCancelamento): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!efetivacaoCancelamentoLigada(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaCancelamentoContratoPropria(nucleo, cliente));
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 3_600_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'efetivação dos cancelamentos de contrato não subiu',
      );
    }
  }

  async ciclo(): Promise<
    { cliente: string; estabelecimento: string; efetivados: number; baixados: number; recusados: number }[]
  > {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'cancelamento-contrato',
        fabrica,
        (porta, est) => efetivarVencidosDoEstabelecimento(porta, est),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'efetivação dos cancelamentos de contrato falhou',
          ),
      );
      const out = voltas.map((v) => ({
        cliente: v.cliente,
        estabelecimento: v.estabelecimento,
        efetivados: v.resultado.efetivados.length,
        baixados: v.resultado.baixados,
        recusados: v.resultado.recusados.length,
      }));
      for (const x of out)
        if (x.efetivados > 0 || x.recusados > 0)
          logger.info(x, 'cancelamentos de contrato vencidos efetivados');
      return out;
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
