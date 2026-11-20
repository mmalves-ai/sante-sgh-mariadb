// Serviço da vigia diária das tabelas vazias (M14, regra 14; correção do M14): a cada VIGIA_VAZIAS_MS (padrão
// 10 min) confere a janela fora do pico (VIGIA_VAZIAS_JANELA, padrão 02:00-05:00) e, uma vez por dia civil e por
// estabelecimento configurado, roda a vigia (cicloVigiaVazias). Ligado fora de dev/ci; em dev/ci só com
// VIGIA_VAZIAS=ligado (a cópia é compartilhada: a vigia é provada pela integração, com ROLLBACK). O retrato das
// povoadas vem de VIGIA_VAZIAS_POVOADAS_DIR (padrão tools/matriz/dados). Log só com códigos e contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerJanela } from '@sgh/dominio-catalogo';
import { lerCodigos, lerConfiguracaoNucleo, lerInteiroAmbiente, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';
import { minutosCivis } from './publicador-catalogos.service.js';
import { cicloVigiaVazias, diaCivil, lerPovoadas } from './vigia-vazias.js';

/** A vigia roda? Fora de dev/ci, sempre (salvo desligada); em dev/ci, só com VIGIA_VAZIAS=ligado. */
export function vigiaVaziasLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['VIGIA_VAZIAS'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

@Injectable()
export class VigiaVaziasService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private readonly ultimas = new Map<string, string>();

  onApplicationBootstrap(): void {
    if (!vigiaVaziasLigada(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'VIGIA_VAZIAS_MS', 600_000, 10_000, 3_600_000);
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
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia das tabelas vazias não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    const nucleo = this.nucleo;
    const pasta = resolve(process.cwd(), process.env['VIGIA_VAZIAS_POVOADAS_DIR'] ?? 'tools/matriz/dados');
    try {
      const r = await cicloVigiaVazias({
        rede: nucleo.rede,
        hospitais: lerCodigos(process.env),
        povoadas: (h) => lerPovoadas(pasta, h),
        ler: (h, fn) => nucleo.lerSomente({ rede: nucleo.rede, hospital: h, traceId: 'vigia-vazias' }, fn),
        gravarSgh: (h, fn) =>
          nucleo.gravarSgh({ rede: nucleo.rede, hospital: h, traceId: 'vigia-vazias' }, fn),
        janela: lerJanela(process.env['VIGIA_VAZIAS_JANELA'] ?? '02:00-05:00'),
        agoraMinutos: () => minutosCivis(),
        hoje: () => diaCivil(),
        ultimas: this.ultimas,
      });
      for (const x of r)
        if (x.situacao === 'feita')
          logger.info(
            {
              estabelecimento: x.hospital,
              verificadas: x.resultado?.verificadas,
              vazias: x.resultado?.vazias,
              comDados: x.resultado?.comDados.length,
              novas: x.resultado?.novasComDados.length,
            },
            'vigia das tabelas vazias',
          );
        else if (x.situacao === 'falhou' || x.situacao === 'sem-retrato')
          logger.warn(
            { estabelecimento: x.hospital, situacao: x.situacao, erro: x.erro },
            'vigia das tabelas vazias',
          );
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
