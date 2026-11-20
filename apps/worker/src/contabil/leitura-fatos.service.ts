// Leitura incremental dos fatos contábeis no `worker` (M54.1; ficha, regra 1): a cada 5 minutos, dentro da janela fora
// do pico (CONTABIL_JANELA_LEITURA, padrão 22:00-06:00), por estabelecimento com a chave `contabil` valendo, um ciclo por
// fonte (ciclo.ts). As leituras das fontes e dos fatos já registrados vão em transações curtas READ ONLY; a gravação
// (fatos, estado da fonte e o evento `contabil.fatos.lidos`) vai numa transação SGH_ só (somenteSgh: nada fora de SGH_).
// Ligado fora de dev/ci; em dev/ci só com CONTABIL_LEITURA=ligado (a cópia é compartilhada); fora de produção,
// CONTABIL_LER_FORA_DA_JANELA=sim lê a qualquer hora. A empresa contábil do estabelecimento é CONTABIL_EMPRESA (padrão
// 1). Log só com contagens. Depois da leitura, os fatos pendentes viram lançamentos (M54.2, `contabilizacao.ts`), no
// mesmo ciclo e em transações SGH_ próprias; CONTABIL_CONTABILIZAR=desligado só lê.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CHAVE_CONTABIL, FONTES_FATO, recursoDesligado } from '@sgh/contratos';
import { dentroDaJanela, lerJanela } from '@sgh/dominio-catalogo';
import { cicloDaFonte, type ResumoCiclo } from '@sgh/dominio-contabil';
import { recursoLigado } from '@sgh/dominio-config';
import {
  acessoCicloFatos,
  acessoContabilizacao,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerPrerequisitos,
  NucleoLegado,
  USUARIO_CONTABIL,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from '../logger.js';
import { minutosCivis } from '../publicador-catalogos.service.js';
import { diaCivil } from '../vigia-vazias.js';
import { contabilizarPendentes, type ResumoContabilizacao } from './contabilizacao.js';

export { USUARIO_CONTABIL };
const INTERVALO_MS = 5 * 60_000;

export function leituraLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CONTABIL_LEITURA'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** As fontes do ciclo, na ordem do vocabulário (as 9 da seção 4, com a folha do M53). */
export const TABELAS_DO_CICLO: readonly string[] = FONTES_FATO.map((f) => f.tabela);

export type NucleoContabil = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

/** A chave `contabil` vale no estabelecimento (com os pré-requisitos registrados). */
export async function contabilLigada(nucleo: NucleoContabil, cod: string, agora: Date): Promise<boolean> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'contabil-leitura' };
  const cfg = await nucleo.lerSomente(ctx, async (l) => ({
    chaves: await lerChavesLiberacao(l, cod),
    prerequisitos: await lerPrerequisitos(l, cod),
  }));
  const chaves = cfg.chaves
    .filter((c) => c.chave === CHAVE_CONTABIL && c.tipo === 'recurso' && c.ligada !== null)
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
  const declarados = recursoDesligado(CHAVE_CONTABIL)?.prerequisitos ?? [];
  const registrados = cfg.prerequisitos.filter((p) => p.recurso === CHAVE_CONTABIL);
  return recursoLigado(chaves, declarados, registrados, { pessoa: USUARIO_CONTABIL }, agora);
}

/** Um ciclo de todas as fontes de um estabelecimento (uma fonte que falha não para as outras). */
export async function cicloDoEstabelecimento(
  nucleo: NucleoContabil,
  cod: string,
  c: { empresa: number; hoje: string },
): Promise<{ resumos: ResumoCiclo[]; falhas: string[] }> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'contabil-leitura' };
  const acesso = acessoCicloFatos(
    (fn) => nucleo.lerSomente(ctx, fn),
    (fn) => nucleo.gravarSgh(ctx, fn),
    { rede: nucleo.rede, hospital: cod },
  );
  const resumos: ResumoCiclo[] = [];
  const falhas: string[] = [];
  for (const tabela of TABELAS_DO_CICLO) {
    try {
      resumos.push(await cicloDaFonte(acesso, tabela, c));
    } catch (e) {
      falhas.push(tabela);
      logger.warn(
        { estabelecimento: cod, fonte: tabela, erro: e instanceof Error ? e.name : 'erro' },
        'leitura dos fatos contábeis falhou na fonte',
      );
    }
  }
  return { resumos, falhas };
}

/** A contabilização roda depois da leitura (CONTABIL_CONTABILIZAR=desligado só lê). */
export function contabilizacaoLigada(env: NodeJS.ProcessEnv): boolean {
  return (env['CONTABIL_CONTABILIZAR'] ?? '').trim() !== 'desligado';
}

/** Contabiliza os fatos pendentes do estabelecimento (lote a lote, cada um numa transação SGH_ com a trilha). */
export function contabilizarDoEstabelecimento(
  nucleo: NucleoContabil,
  cod: string,
  c: { empresa: number; maxLotes?: number },
): Promise<ResumoContabilizacao> {
  const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'contabil-contabilizacao' };
  const acesso = acessoContabilizacao(
    (fn) => nucleo.lerSomente(ctx, fn),
    (fn) => nucleo.gravarSgh(ctx, fn),
    { rede: nucleo.rede, hospital: cod },
  );
  return contabilizarPendentes(acesso, c);
}

/**
 * O dia do ciclo no fuso civil do Brasil (UTC−3), como os vigias: com TZ=UTC nos processos (manual de implantação §3.3),
 * a hora UTC já marca o dia seguinte depois das 21:00 e jogaria o estorno do último dia do mês na competência seguinte.
 */
export function hojeDoCiclo(agora: Date): string {
  return diaCivil(agora);
}

@Injectable()
export class LeituraFatosContabeisService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoContabil | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoContabil): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!leituraLigada(process.env)) return;
    try {
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
      this.temporizador = setInterval(() => void this.ciclo(), INTERVALO_MS);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'leitura dos fatos contábeis não subiu',
      );
    }
  }

  /** Dentro da janela fora do pico (ou fora de produção com a liberação explícita). */
  naJanela(agora: Date, env: NodeJS.ProcessEnv = process.env): boolean {
    const producao = (env['AMBIENTE'] ?? '').trim() === 'producao';
    if (!producao && env['CONTABIL_LER_FORA_DA_JANELA'] === 'sim') return true;
    return dentroDaJanela(lerJanela(env['CONTABIL_JANELA_LEITURA']), minutosCivis(agora));
  }

  async ciclo(
    agora = new Date(),
  ): Promise<{ estabelecimento: string; gravados: number; falhas: number; lancamentos: number }[]> {
    if (this.rodando || !this.nucleo || !this.naJanela(agora)) return [];
    this.rodando = true;
    const r: { estabelecimento: string; gravados: number; falhas: number; lancamentos: number }[] = [];
    const empresa = Math.max(1, Math.trunc(Number(process.env['CONTABIL_EMPRESA'] ?? 1)) || 1);
    const hoje = hojeDoCiclo(agora);
    try {
      for (const cod of lerCodigos(process.env)) {
        try {
          if (!(await contabilLigada(this.nucleo, cod, agora))) continue;
          const x = await cicloDoEstabelecimento(this.nucleo, cod, { empresa, hoje });
          const gravados = x.resumos.reduce((s, y) => s + y.gravados, 0);
          if (gravados > 0 || x.falhas.length > 0)
            logger.info(
              { estabelecimento: cod, gravados, fontes: x.resumos.length, falhas: x.falhas.length },
              'fatos contábeis lidos',
            );
          let lancamentos = 0;
          if (contabilizacaoLigada(process.env))
            try {
              const z = await contabilizarDoEstabelecimento(this.nucleo, cod, { empresa });
              lancamentos = z.lancamentos;
              if (z.fatos > 0)
                logger.info(
                  {
                    estabelecimento: cod,
                    fatos: z.fatos,
                    lancamentos: z.lancamentos,
                    semRegra: z.semRegra,
                    semConta: z.semConta,
                    movidos: z.movidos,
                    restam: z.restam,
                  },
                  'fatos contábeis contabilizados',
                );
            } catch (e) {
              logger.warn(
                { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
                'contabilização dos fatos falhou',
              );
            }
          r.push({ estabelecimento: cod, gravados, falhas: x.falhas.length, lancamentos });
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'leitura dos fatos contábeis falhou',
          );
        }
      }
    } finally {
      this.rodando = false;
    }
    return r;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
