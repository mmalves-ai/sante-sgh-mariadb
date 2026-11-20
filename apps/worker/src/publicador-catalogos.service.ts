// Serviço do publicador das cargas de catálogo no worker (ficha do M13): a cada CATALOGO_PUBLICADOR_MS (padrão
// 30 s), por estabelecimento, o lote seguinte das cargas aprovadas, na janela fora do pico
// (CATALOGO_JANELA_PUBLICACAO, padrão 22:00-06:00). Ligado fora de dev/ci; em dev/ci só com
// CATALOGO_PUBLICADOR=ligado (a cópia é compartilhada: a publicação é provada pelos testes de integração, com
// ROLLBACK). Fora de produção, CATALOGO_PUBLICAR_FORA_DA_JANELA=sim publica a qualquer hora. Log só com códigos e
// contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerJanela } from '@sgh/dominio-catalogo';
import {
  fonteCatalogoArquivo,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerInteiroAmbiente,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { cicloPublicacao } from './importadores/publicador.js';
import { logger } from './logger.js';

/** O publicador roda? Fora de dev/ci, sempre (salvo desligado); em dev/ci, só com CATALOGO_PUBLICADOR=ligado. */
export function publicadorLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CATALOGO_PUBLICADOR'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** Minutos desde a meia-noite no fuso civil do Brasil (UTC−3). */
export function minutosCivis(d = new Date()): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() - 180 + 1440) % 1440;
}

@Injectable()
export class PublicadorCatalogosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (!publicadorLigado(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'CATALOGO_PUBLICADOR_MS', 30_000, 1_000, 3_600_000);
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'publicador de catálogos não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    const nucleo = this.nucleo;
    try {
      const executor = nucleo.criarExecutor({
        catalogo: fonteCatalogoArquivo(
          resolve(process.cwd(), process.env['CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo'),
        ),
      });
      const producao = (process.env['AMBIENTE'] ?? '').trim() === 'producao';
      for (const cod of lerCodigos(process.env)) {
        const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'publicador-catalogos' };
        try {
          const r = await cicloPublicacao({
            rede: nucleo.rede,
            hospital: cod,
            executor,
            ler: (fn) => nucleo.lerSomente(ctx, fn),
            gravarSgh: (fn) => nucleo.gravarSgh(ctx, fn),
            janela: lerJanela(process.env['CATALOGO_JANELA_PUBLICACAO']),
            agoraMinutos: () => minutosCivis(),
            ignorarJanela: !producao && process.env['CATALOGO_PUBLICAR_FORA_DA_JANELA'] === 'sim',
            lotesPorCiclo: lerInteiroAmbiente(process.env, 'CATALOGO_LOTES_POR_CICLO', 20, 1, 1_000),
            log: (m, c) => logger.info({ estabelecimento: cod, ...c }, m),
          });
          for (const x of r)
            if (x.lotes > 0 || x.situacao === 'falhou')
              logger.info(
                { estabelecimento: cod, carga: x.carga, lotes: x.lotes, situacao: x.situacao },
                'publicador de catálogos',
              );
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'publicador de catálogos: ciclo falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
