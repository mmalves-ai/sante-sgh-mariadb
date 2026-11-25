// Serviço do worker da fila com o ERP corporativo (F8, 08-INTG L136): a cada 15 minutos, por cliente e estabelecimento
// ativo, envia os lotes gerados (exportacao_erp em 'gerado') pelo adaptador do ERP e grava o retorno item a item
// (processarFilaErp, idempotente). Fora de produção o adaptador é o simulador do domínio (nada sai para fora); em
// produção, só com um adaptador configurado: sem ele o serviço não envia (os lotes ficam gerados e a tela mostra). Ligado
// fora de dev/ci; em dev/ci só com FILA_ERP_ENVIO=ligado. Log só com contagens.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { NucleoProprio } from '@sgh/nucleo';
import { logger } from '../logger.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from '../servico-worker.js';
import {
  type AdaptadorErpWorker,
  adaptadorErpSimuladoWorker,
  type CicloFilaErp,
  processarFilaErp,
} from './fila.js';
import { FonteFilaErpPropria } from './fila-propria.js';

export function filaErpLigada(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'FILA_ERP_ENVIO');
}

/** Fora de produção, sempre o simulador; em produção, nenhum até haver adaptador do ERP configurado. */
export function adaptadorErpDoAmbiente(env: NodeJS.ProcessEnv): AdaptadorErpWorker | null {
  return env['NODE_ENV'] === 'production' ? null : adaptadorErpSimuladoWorker;
}

/** Um ciclo num estabelecimento (o `hospital` da fonte é o id do estabelecimento). */
export function cicloFilaErp(
  fonte: FonteFilaErpPropria,
  adaptador: AdaptadorErpWorker,
  est: AlvoEstabelecimento,
  teto = 20,
): Promise<CicloFilaErp> {
  return processarFilaErp(fonte, adaptador, String(est.id), teto);
}

@Injectable()
export class FilaErpService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: ((cliente: string) => FonteFilaErpPropria) | null = null;
  private adaptador: AdaptadorErpWorker | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo, a fonte e o adaptador sem subir o banco. */
  usar(
    nucleo: NucleoServico,
    fabrica: (cliente: string) => FonteFilaErpPropria,
    adaptador: AdaptadorErpWorker | null,
  ): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    this.adaptador = adaptador;
  }

  onApplicationBootstrap(): void {
    if (!filaErpLigada(process.env)) return;
    const adaptador = adaptadorErpDoAmbiente(process.env);
    if (!adaptador) {
      logger.warn({}, 'fila do ERP sem adaptador neste ambiente: os lotes ficam gerados');
      return;
    }
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new FonteFilaErpPropria(nucleo, cliente), adaptador);
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 900_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'fila do ERP não subiu');
    }
  }

  async ciclo(): Promise<{ cliente: string; estabelecimento: string; resultado: CicloFilaErp }[]> {
    const { nucleo, fabrica, adaptador } = this;
    if (this.rodando || !nucleo || !fabrica || !adaptador) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'fila-erp',
        fabrica,
        (fonte, est) => cicloFilaErp(fonte, adaptador, est),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'fila do ERP falhou',
          ),
      );
      for (const v of voltas)
        if (v.resultado.enviados > 0 || v.resultado.falhas > 0)
          logger.info(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, ...v.resultado },
            'fila do ERP enviada',
          );
      return voltas;
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
