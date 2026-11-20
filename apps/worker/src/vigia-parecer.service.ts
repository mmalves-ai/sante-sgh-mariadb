// Vigia do parecer pedido no outro sistema (ficha do M23, regra 10; só SGH_, no worker): de tempos em tempos
// (PEP_VIGIA_PARECER_MS, padrão 5 min), por estabelecimento, lê os registros de pedido de parecer (modelo de
// solicitação de parecer) acima da marca de onde parou (SGH_PEP_VIGIA_MARCA, relendo uma janela para trás; leitura
// incremental, READ ONLY) e inclui na fila do parecer (SGH_PEP_FLUXO, origem "legado", transação só SGH_ com a
// SGH_TRILHA) os que não estão nela e não têm resposta. Na primeira execução a marca nasce no maior registro clínico
// existente: o histórico anterior fica na linha do tempo, fora da fila. Ligado fora de dev/ci; em dev/ci só com
// PEP_VIGIA_PARECER=ligado (a cópia é compartilhada). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  lerCodigos,
  lerConfiguracaoNucleo,
  lerInteiroAmbiente,
  cicloVigiaParecer,
  NucleoLegado,
  USUARIO_VIGIA,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export function vigiaParecerLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PEP_VIGIA_PARECER'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

export type NucleoVigiaParecer = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

/** Um ciclo num estabelecimento: os pedidos novos do outro sistema entram na fila (sem repetir, com a trilha). */
export async function trazerPareceresDoLegado(
  nucleo: NucleoVigiaParecer,
  cod: string,
  teto = 200,
): Promise<{ lidos: number; incluidos: number }> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'vigia-parecer', usuarioLegado: USUARIO_VIGIA };
  const r = await cicloVigiaParecer(
    (fn) => nucleo.lerSomente(ctx, fn),
    (fn) => nucleo.gravarSgh(ctx, fn),
    ctx,
    teto,
  );
  return { lidos: r.lidos, incluidos: r.incluidos };
}

@Injectable()
export class VigiaParecerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoVigiaParecer | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoVigiaParecer): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!vigiaParecerLigada(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'PEP_VIGIA_PARECER_MS', 300_000, 30_000, 86_400_000);
      process.env['SGH_PROCESSO'] ??= 'worker';
      this.nucleo = new NucleoLegado({
        env: process.env,
        driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(process.env).bibliotecaCliente }),
        pastaHomologada: resolve(
          process.cwd(),
          process.env['SCHEMA_HOMOLOGADO_DIR'] ?? 'tools/schema-check/homologado',
        ),
        aviso: (m, c) => logger.warn(c, m),
      });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
      setTimeout(() => void this.ciclo(), 45_000).unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia do parecer não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          const r = await trazerPareceresDoLegado(this.nucleo, cod);
          if (r.incluidos > 0)
            logger.info({ estabelecimento: cod, ...r }, 'parecer: pedidos trazidos à fila');
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'parecer: ciclo falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar().catch(() => undefined);
  }
}
