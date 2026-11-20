// Serviço da vigilância diária de gravação em produção (ficha do M38, campo 1): a cada VIGIA_GRAVACAO_MS (padrão
// 10 min) confere a janela (VIGIA_GRAVACAO_JANELA, padrão 03:00-05:00) e, uma vez por dia civil e estabelecimento,
// vigia o dia anterior (cicloVigiaGravacao). Ligado fora de dev/ci; em dev/ci só com VIGIA_GRAVACAO=ligado (a cópia
// é compartilhada: a vigilância é provada pela integração, com ROLLBACK). Amostra por operação: COEX_VIGIA_AMOSTRA
// (padrão 50). Log só com códigos e contagens.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AMOSTRA_VIGIA_PADRAO } from '@sgh/contratos';
import { lerJanela } from '@sgh/dominio-catalogo';
import {
  fonteCatalogoArquivo,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerInteiroAmbiente,
  NucleoLegado,
  OPERACOES,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';
import { minutosCivis } from './publicador-catalogos.service.js';
import { diaCivil } from './vigia-vazias.js';
import { cicloVigiaGravacao } from './vigia-gravacao.js';

export function vigiaGravacaoLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['VIGIA_GRAVACAO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** As operações do protocolo com o grupo (pasta das assinaturas). */
export function operacoesComGrupo(): Record<string, { grupo: string }> {
  return Object.fromEntries(Object.entries(OPERACOES).map(([n, o]) => [n, { grupo: o.receita.grupo }]));
}

@Injectable()
export class VigiaGravacaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private readonly ultimas = new Map<string, string>();

  onApplicationBootstrap(): void {
    if (!vigiaGravacaoLigada(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'VIGIA_GRAVACAO_MS', 600_000, 10_000, 3_600_000);
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
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigilância de gravação não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo) return;
    this.rodando = true;
    const nucleo = this.nucleo;
    try {
      const r = await cicloVigiaGravacao({
        rede: nucleo.rede,
        hospitais: lerCodigos(process.env),
        catalogo: fonteCatalogoArquivo(
          resolve(process.cwd(), process.env['SGH_CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo'),
        ),
        operacoes: operacoesComGrupo(),
        pastaSrc: resolve(process.cwd(), 'packages/legado/src'),
        tamanho: lerInteiroAmbiente(process.env, 'COEX_VIGIA_AMOSTRA', AMOSTRA_VIGIA_PADRAO, 1, 10_000),
        ler: (h, fn) => nucleo.lerSomente({ rede: nucleo.rede, hospital: h, traceId: 'vigia-gravacao' }, fn),
        gravarSgh: (h, fn) =>
          nucleo.gravarSgh({ rede: nucleo.rede, hospital: h, traceId: 'vigia-gravacao' }, fn),
        janela: lerJanela(process.env['VIGIA_GRAVACAO_JANELA'] ?? '03:00-05:00'),
        agoraMinutos: () => minutosCivis(),
        hoje: () => diaCivil(),
        ultimas: this.ultimas,
      });
      for (const x of r)
        if (x.situacao === 'feita')
          logger.info(
            {
              estabelecimento: x.hospital,
              dia: x.data,
              operacoes: x.resultado?.resultados.length ?? 0,
              amostradas: x.resultado?.resultados.reduce((s, y) => s + y.amostradas, 0) ?? 0,
              divergentes: x.resultado?.resultados.reduce((s, y) => s + y.divergentes, 0) ?? 0,
              semLocalizador: x.resultado?.semLocalizador.length ?? 0,
            },
            'vigilância diária de gravação',
          );
        else if (x.situacao === 'falhou')
          logger.warn({ estabelecimento: x.hospital, erro: x.erro }, 'vigilância diária de gravação falhou');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
