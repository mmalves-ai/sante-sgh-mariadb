// Ciclo da contabilidade no `worker` (M54; lote F2.2 05-12): a cada 5 minutos, dentro da janela fora do pico
// (CONTABIL_JANELA_LEITURA, padrão 22:00-06:00), por cliente e por estabelecimento com o recurso `contabil` liberado,
// conta os fatos por situação (fato_contabil) e contabiliza os pendentes (M54.2, `contabilizacao.ts`), lote a lote.
// Ligado fora de dev/ci; em dev/ci só com CONTABIL_LEITURA=ligado; fora de produção, CONTABIL_LER_FORA_DA_JANELA=sim
// roda a qualquer hora; CONTABIL_CONTABILIZAR=desligado só conta. Log só com códigos e contagens.
// Melhoria: o worker passa por todos os clientes da plataforma (um banco por cliente) e por todos os estabelecimentos
// de cada um, sem lista fixa de hospitais nem número de empresa no ambiente.
// Melhoria: os fatos nascem na transação do módulo que os publica (fato_contabil); a leitura incremental por faixa de
// chave das tabelas de outro sistema saiu (convivência, ADR 0003).
// Melhoria: falha de leitura num estabelecimento fica nele (resultado com o código) e o ciclo segue nos demais.
// Melhoria: operação indisponível no banco (recusa `modelo-pendente`) vai ao log com o código, uma vez por
// estabelecimento e ciclo, e o ciclo segue; nunca vira "zero lançamentos" calado.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { dentroDaJanela, lerJanela } from '@sgh/dominio-catalogo';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, diaCivil, type NucleoClientes } from '../clientes-worker.js';
import { logger } from '../logger.js';
import { minutosCivis } from '../publicador-catalogos.service.js';
import { contabilizarPendentes, type ResumoContabilizacao } from './contabilizacao.js';
import { contabilLigadaPor, type PortaContabilWorker, PortaContabilWorkerPropria } from './porta-propria.js';

const INTERVALO_MS = 5 * 60_000;

export function leituraLigada(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['CONTABIL_LEITURA'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** A contabilização roda depois da contagem (CONTABIL_CONTABILIZAR=desligado só conta). */
export function contabilizacaoLigada(env: NodeJS.ProcessEnv): boolean {
  return (env['CONTABIL_CONTABILIZAR'] ?? '').trim() !== 'desligado';
}

/**
 * O dia do ciclo no fuso civil do Brasil (UTC−3): com TZ=UTC nos processos, a hora UTC já marca o dia seguinte depois
 * das 21:00 e jogaria o estorno do último dia do mês na competência seguinte.
 */
export function hojeDoCiclo(agora: Date): string {
  return diaCivil(agora);
}

/** O código da recusa (ErroOperacao) ou o nome do erro, para o log. */
export function codigoDaFalha(e: unknown): string {
  if (e instanceof ErroOperacao) return String(e.problema.codigo ?? e.name);
  return e instanceof Error ? e.name : 'erro';
}

export interface ResultadoEstabelecimento {
  readonly cliente: string;
  readonly estabelecimento: string;
  readonly pendentes: number;
  readonly lancamentos: number;
  /** Código da falha da contabilização (ex.: `modelo-pendente`); null: rodou ou não foi pedida. */
  readonly falha: string | null;
}

/** Um ciclo de um cliente: por estabelecimento liberado, conta os fatos e contabiliza os pendentes. */
export async function cicloDoCliente(
  porta: PortaContabilWorker,
  cliente: string,
  agora: Date,
  env: NodeJS.ProcessEnv,
): Promise<ResultadoEstabelecimento[]> {
  const r: ResultadoEstabelecimento[] = [];
  for (const est of await porta.estabelecimentos()) {
    // Isolamento: a falha de leitura num estabelecimento (tempo esgotado, teto, conexão) fica registrada nele e o laço
    // segue para os próximos, sem perder os resultados já acumulados.
    try {
      if (!contabilLigadaPor(await porta.liberacao(est.id), agora)) continue;
      const contagem = await porta.fatosPorSituacao(est.id);
      let lancamentos = 0;
      let falha: string | null = null;
      if (contabilizacaoLigada(env) && contagem.pendente > 0)
        try {
          const z: ResumoContabilizacao = await contabilizarPendentes(porta, { estabelecimento: est.id });
          lancamentos = z.lancamentos;
          logger.info(
            {
              cliente,
              estabelecimento: est.codigo,
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
          falha = codigoDaFalha(e);
          logger.warn(
            { cliente, estabelecimento: est.codigo, pendentes: contagem.pendente, codigo: falha },
            'contabilização dos fatos indisponível ou falhou',
          );
        }
      r.push({ cliente, estabelecimento: est.codigo, pendentes: contagem.pendente, lancamentos, falha });
    } catch (e) {
      const falha = codigoDaFalha(e);
      logger.warn({ cliente, estabelecimento: est.codigo, codigo: falha }, 'leitura dos fatos contábeis falhou');
      r.push({ cliente, estabelecimento: est.codigo, pendentes: 0, lancamentos: 0, falha });
    }
  }
  return r;
}

export interface NucleoContabil extends NucleoClientes {
  encerrar(): Promise<void>;
}

export type FabricaPortaContabil = (cliente: string) => PortaContabilWorker;

@Injectable()
export class LeituraFatosContabeisService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoContabil | null = null;
  private fabrica: FabricaPortaContabil | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoContabil, fabrica: FabricaPortaContabil): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!leituraLigada(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaContabilWorkerPropria(nucleo, cliente));
      this.temporizador = setInterval(() => void this.ciclo(), INTERVALO_MS);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'ciclo da contabilidade não subiu');
    }
  }

  /** Dentro da janela fora do pico (ou fora de produção com a liberação explícita). */
  naJanela(agora: Date, env: NodeJS.ProcessEnv = process.env): boolean {
    const producao = (env['AMBIENTE'] ?? '').trim() === 'producao';
    if (!producao && env['CONTABIL_LER_FORA_DA_JANELA'] === 'sim') return true;
    return dentroDaJanela(lerJanela(env['CONTABIL_JANELA_LEITURA']), minutosCivis(agora));
  }

  async ciclo(agora = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ResultadoEstabelecimento[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica || !this.naJanela(agora, env)) return [];
    this.rodando = true;
    const r: ResultadoEstabelecimento[] = [];
    try {
      for (const cliente of await clientesDoWorker(nucleo, env, 'contabil-worker'))
        try {
          r.push(...(await cicloDoCliente(fabrica(cliente), cliente, agora, env)));
        } catch (e) {
          logger.warn({ cliente, codigo: codigoDaFalha(e) }, 'ciclo da contabilidade falhou no cliente');
        }
    } catch (e) {
      logger.warn({ codigo: codigoDaFalha(e) }, 'ciclo da contabilidade: clientes indisponíveis');
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
