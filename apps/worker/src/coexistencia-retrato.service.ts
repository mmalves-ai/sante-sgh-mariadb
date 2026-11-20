// Serviço do retrato das conexões do outro sistema e do uso do dia (M37, regras 1 e 2): a cada COEX_RETRATO_MS (padrão
// 15 min) roda o ciclo em cada estabelecimento configurado. Ligado fora de dev/ci; em dev/ci só com COEX_RETRATO=ligado
// (a cópia é compartilhada: o ciclo é provado pela integração, com ROLLBACK). Log só com contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { lerCodigos, lerConfiguracaoNucleo, lerInteiroAmbiente, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { cicloRetrato } from './coexistencia-retrato.js';
import { logger } from './logger.js';

export function retratoLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['COEX_RETRATO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/**
 * M43 (regra 3; D-MON-43): os endereços das estações técnicas e de contingência combinadas (ESTADO.md › Autorizações),
 * separados por vírgula; as conexões do outro sistema vindas delas não contam como sessão de pessoa.
 */
export function estacoesTecnicas(env: NodeJS.ProcessEnv): string[] {
  return (env['COEX_ESTACOES_TECNICAS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

@Injectable()
export class CoexistenciaRetratoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  onApplicationBootstrap(): void {
    if (!retratoLigado(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'COEX_RETRATO_MS', 900_000, 60_000, 3_600_000);
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'retrato das conexões não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    const nucleo = this.nucleo;
    try {
      const r = await cicloRetrato({
        rede: nucleo.rede,
        hospitais: lerCodigos(process.env),
        ler: (h, fn) => nucleo.lerSomente({ rede: nucleo.rede, hospital: h, traceId: 'coex-retrato' }, fn),
        gravarSgh: (h, fn) =>
          nucleo.gravarSgh({ rede: nucleo.rede, hospital: h, traceId: 'coex-retrato' }, fn),
        estacoesTecnicas: estacoesTecnicas(process.env),
      });
      for (const x of r)
        if (x.situacao === 'feito')
          logger.info(
            {
              estabelecimento: x.hospital,
              conexoes: x.conexoes,
              mudaram: x.mudaram,
              operacoes: x.operacoes,
              conexoesOutroSistema: x.conexoesOutroSistema,
            },
            'retrato das conexões e uso do dia',
          );
        else logger.warn({ estabelecimento: x.hospital, erro: x.erro }, 'retrato das conexões falhou');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
