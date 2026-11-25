// internacao.fecharCenso no worker (M16; ficha, seções 5 e 12; lote F2.2 05-15): a cada minuto, por cliente e
// estabelecimento, se a chave `internacao.censo.fechamento` está ligada, para o último dia do censo que já fechou na hora
// de fechamento do estabelecimento (parâmetro) e os dias dos últimos 7 que ficaram sem retrato (worker parado na hora
// de fechar), calcula o censo de cada dia pela trajetória (motor do domínio, leitura somente leitura) e grava o retrato
// pela porta própria (fechamento_censo por unidade de internação, com a trilha na mesma transação). Dia já fechado
// (outro processo foi antes): desiste em silêncio. Ligado fora de dev/ci; em dev/ci só com CENSO_FECHAMENTO=ligado.
// Log só com códigos e contagens.
// Melhoria: o relógio de parede é o do fuso do estabelecimento; o agrupamento é a unidade de internação do cadastro
// (a da acomodação do leito, sempre presente no modelo) e a terapia intensiva é a categoria da acomodação
// (categoria_acomodacao.tipo), não uma lista de códigos; a linha sem unidade é erro de integridade (vai ao log de falha).
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HORA_FECHAMENTO_PADRAO } from '@sgh/contratos';
import {
  dataDoDia,
  diaDoCenso,
  MotorInternacao,
  relogioDeParede,
  VERSAO_CALCULO_CENSO,
} from '@sgh/dominio-internacao';
import type { DisparoExecucao } from '@sgh/dominio-integracao';
import { NucleoProprio } from '@sgh/nucleo';
import { CHAVE_FECHAMENTO, type PortaCenso, PortaCensoPropria } from './censo-fechamento-propria.js';
import { logger } from './logger.js';
import { RegistroRotinasProprio } from './rotinas-registro-proprio.js';
import { RegistradorRotinas, ROTINAS_WORKER, voltaPorEstabelecimentoComRotina } from './rotinas-worker.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';

export { CHAVE_FECHAMENTO };
/** Dias para trás que cada ciclo confere (o último fechado e os que ficaram sem retrato). */
export const JANELA_FECHAMENTO_DIAS = 7;
/**
 * Dias para trás que a volta pedida à mão na Administração confere (01-SIS L95): recupera os retratos que ficaram
 * faltando depois de uma parada do worker maior que a semana da volta agendada.
 */
export const JANELA_RECUPERACAO_DIAS = 31;

/** A janela da volta pelo disparo: a manual recupera o mês; a agendada confere a semana. */
export const janelaDoFechamento = (disparo: DisparoExecucao): number =>
  disparo === 'manual' ? JANELA_RECUPERACAO_DIAS : JANELA_FECHAMENTO_DIAS;

export function fechamentoLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'CENSO_FECHAMENTO');
}

export type ResultadoFechamento =
  | { readonly situacao: 'desligado' | 'ja-fechado' | 'sem-acomodacao' }
  | {
      readonly situacao: 'fechado';
      /** O último dia fechado neste ciclo (linhas e internados dele). */
      readonly data: string;
      readonly linhas: number;
      readonly internados: number;
      /** Todos os dias fechados neste ciclo, em ordem (o último e os que tinham ficado sem retrato). */
      readonly dias: readonly string[];
    };

/** Um ciclo num estabelecimento: com a chave ligada, fecha o último dia e os dias da janela sem retrato (em ordem). */
export async function fecharCensoDoEstabelecimento(
  porta: PortaCenso,
  est: AlvoEstabelecimento,
  agoraReal: number,
  janelaDias: number = JANELA_FECHAMENTO_DIAS,
): Promise<ResultadoFechamento> {
  const cfg = await porta.configuracao(est, new Date(agoraReal));
  if (!cfg.ligada) return { situacao: 'desligado' };
  const h = cfg.horaFechamento;
  const horaFechamento = h !== null && Number.isInteger(h) && h >= 1 && h <= 24 ? h : HORA_FECHAMENTO_PADRAO;
  const intensivas = [...cfg.categoriasIntensivas];
  const agora = relogioDeParede(agoraReal, est.fuso);
  const ultimo = diaDoCenso(agora, horaFechamento) - 1;
  const ja = new Set(await porta.diasFechados(est, dataDoDia(ultimo - janelaDias + 1), dataDoDia(ultimo)));
  const pendentes: string[] = [];
  for (let d = ultimo - janelaDias + 1; d <= ultimo; d++)
    if (!ja.has(dataDoDia(d))) pendentes.push(dataDoDia(d));
  if (pendentes.length === 0) return { situacao: 'ja-fechado' };
  const motor = new MotorInternacao(await porta.movimento(est), { horaFechamento, intensivas, agora });
  const fechados: { data: string; linhas: number; internados: number }[] = [];
  let semAcomodacao = false;
  for (const data of pendentes) {
    const g = await porta.gravarDia(est, {
      data,
      horaFechamento,
      versaoCalculo: VERSAO_CALCULO_CENSO,
      linhas: motor.censoDoDia(data),
    });
    if (g === null) continue;
    if (g.unidades === 0) {
      semAcomodacao = true;
      continue;
    }
    fechados.push({ data, linhas: g.linhas, internados: g.internados });
  }
  const fim = fechados.at(-1);
  if (!fim) return { situacao: semAcomodacao ? 'sem-acomodacao' : 'ja-fechado' };
  return {
    situacao: 'fechado',
    data: fim.data,
    linhas: fim.linhas,
    internados: fim.internados,
    dias: fechados.map((f) => f.data),
  };
}

export type FabricaPortaCenso = (cliente: string) => PortaCenso;

@Injectable()
export class CensoFechamentoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaCenso | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  /** 01-SIS L95: a volta registrada como rotina na Administração (sem ele, nos testes, só a volta). */
  private registrador: RegistradorRotinas | null = null;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(
    nucleo: NucleoServico,
    fabrica: FabricaPortaCenso,
    registrador: RegistradorRotinas | null = null,
  ): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    this.registrador = registrador;
  }

  onApplicationBootstrap(): void {
    if (!fechamentoLigado(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(
        nucleo,
        (cliente) => new PortaCensoPropria(nucleo, cliente),
        new RegistradorRotinas((cliente) => new RegistroRotinasProprio(nucleo, cliente)),
      );
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'fechamento do censo não subiu');
    }
  }

  async ciclo(
    agoraReal = Date.now(),
  ): Promise<(ResultadoFechamento & { readonly cliente: string; readonly estabelecimento: string })[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const fn = (porta: PortaCenso, est: AlvoEstabelecimento, disparo: DisparoExecucao = 'agendado') =>
        fecharCensoDoEstabelecimento(porta, est, agoraReal, janelaDoFechamento(disparo));
      const falhou = (cliente: string, estabelecimento: string | null, e: unknown) =>
        logger.warn(
          { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
          'fechamento do censo falhou',
        );
      const voltas = this.registrador
        ? await voltaPorEstabelecimentoComRotina(
            this.registrador,
            ROTINAS_WORKER.censo,
            (x: ResultadoFechamento) => ({
              lidos: 0,
              gravados: x.situacao === 'fechado' ? x.dias.length : 0,
              rejeitados: 0,
            }),
            nucleo,
            process.env,
            'censo-fechamento',
            fabrica,
            fn,
            falhou,
          )
        : await voltaPorEstabelecimento(nucleo, process.env, 'censo-fechamento', fabrica, fn, falhou);
      for (const v of voltas) {
        const x = v.resultado;
        if (x.situacao === 'fechado')
          logger.info(
            {
              cliente: v.cliente,
              estabelecimento: v.estabelecimento,
              data: x.data,
              linhas: x.linhas,
              internados: x.internados,
            },
            'censo fechado',
          );
        if (x.situacao === 'sem-acomodacao')
          logger.warn(
            { cliente: v.cliente, estabelecimento: v.estabelecimento },
            'censo: estabelecimento com a chave ligada e sem acomodação de internação cadastrada (nada a fechar)',
          );
      }
      return voltas.map((v) => ({ ...v.resultado, cliente: v.cliente, estabelecimento: v.estabelecimento }));
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
