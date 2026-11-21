// Retrato diário da validade do conselho no `worker` (M52.1; ficha do M52, seção 4: "Validade do conselho: agregado
// diário no worker"; regra 3; lote F2.2 05-16): por cliente, lê as inscrições no conselho dos colaboradores ativos com
// a validade conferida (validade_conselho) ou a da inscrição; conta os vencidos, os a vencer na janela do parâmetro
// `pessoas.alertaConselhoDias` e os sem validade; grava só as contagens no retrato do dia (refaz o dia se rodar de
// novo). A cada hora. Ligado fora de dev/ci; em dev/ci só com PESSOAS_CONSELHO_DIARIO=ligado. Log só com contagens.
// Melhoria: a validade conferida pertence à inscrição (chave estrangeira), não a um número digitado: a conferência
// feita para outro número não vale por construção.
// Melhoria: o retrato é do cliente inteiro (o colaborador e a inscrição no conselho são do cliente, não do
// estabelecimento), um por dia.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { JANELA_ALERTA_CONSELHO_DIAS } from '@sgh/contratos';
import { alertasDeConselho } from '@sgh/dominio-pessoas';
import { NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, diaCivil } from './clientes-worker.js';
import { logger } from './logger.js';
import {
  type PortaConselho,
  PortaConselhoPropria,
  type RegistroConselho,
  type RetratoConselho,
} from './pessoas-conselho-propria.js';

export function retratoConselhoLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['PESSOAS_CONSELHO_DIARIO'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' ? pedido === 'ligado' : true;
}

/** As contagens do dia (regra do domínio sobre o que foi lido): só os registros ativos entram. */
export function contarAlertas(
  registros: readonly RegistroConselho[],
  hoje: string,
  janelaDias: number,
): Pick<RetratoConselho, 'registros' | 'vencidos' | 'aVencer' | 'semValidade'> {
  const alertas = alertasDeConselho(registros, hoje, janelaDias);
  return {
    registros: registros.filter((r) => r.ativo !== false).length,
    vencidos: alertas.filter((a) => a.situacao === 'vencida').length,
    aVencer: alertas.filter((a) => a.situacao === 'aVencer').length,
    semValidade: alertas.filter((a) => a.situacao === 'semValidade').length,
  };
}

export interface RetratoGravado extends RetratoConselho {
  /** false: o retrato não foi gravado (tabela do retrato ausente no banco; DDL pedido no lote 05-16). */
  readonly gravado: boolean;
}

/** Lê e grava o retrato do dia do cliente. `agora`: o relógio injetado nos testes. */
export async function retratoDoCliente(
  porta: PortaConselho,
  cliente: string,
  agora: Date = new Date(),
): Promise<RetratoGravado> {
  const dia = diaCivil(agora);
  const registros = await porta.registrosAtivos();
  const v = await porta.janelaDias(agora);
  const janelaDias = v !== null && Number.isInteger(v) && v > 0 ? v : JANELA_ALERTA_CONSELHO_DIAS;
  const retrato: RetratoConselho = { cliente, dia, janelaDias, ...contarAlertas(registros, dia, janelaDias) };
  return { ...retrato, gravado: await porta.gravarRetrato(retrato) };
}

export interface NucleoConselho {
  lerPlataforma: NucleoProprio['lerPlataforma'];
  encerrar(): Promise<void>;
}

export type FabricaPortaConselho = (cliente: string) => PortaConselho;

@Injectable()
export class PessoasConselhoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoConselho | null = null;
  private fabrica: FabricaPortaConselho | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoConselho, fabrica: FabricaPortaConselho): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!retratoConselhoLigado(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaConselhoPropria(nucleo, cliente));
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), 3_600_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'retrato diário do conselho não subiu');
    }
  }

  async ciclo(agora: Date = new Date()): Promise<RetratoGravado[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    const r: RetratoGravado[] = [];
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'pessoas-conselho')) {
        try {
          const x = await retratoDoCliente(fabrica(cliente), cliente, agora);
          r.push(x);
          logger.info(
            {
              cliente,
              registros: x.registros,
              vencidos: x.vencidos,
              aVencer: x.aVencer,
              semValidade: x.semValidade,
              gravado: x.gravado,
            },
            x.gravado ? 'retrato do conselho' : 'retrato do conselho calculado sem gravar (tabela do retrato ausente)',
          );
        } catch (e) {
          logger.warn({ cliente, erro: e instanceof Error ? e.name : 'erro' }, 'retrato do conselho falhou');
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'retrato do conselho: clientes indisponíveis');
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
