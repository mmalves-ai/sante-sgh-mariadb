// Serviço do vigia do banco próprio (lote F2.2 05-17; no lugar do vigia do banco de origem, M09): a cada VIGIA_BANCO_MS
// coleta as transações abertas (vigia-banco.ts), o estado dos pools e a saúde da plataforma; exporta as métricas
// OpenTelemetry (painel "Banco" do Grafana) e alerta no log (só códigos, contagens e durações). Também mede a saúde dos
// serviços do Compose (Gotenberg; o S3 saiu pelo ADR 0004) para o painel "Técnico". Desligado por VIGIA_BANCO=desligado.
// Melhoria: um único núcleo para todos os clientes (um pool por banco de cliente), em vez de uma conexão por hospital
// configurado no ambiente.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { type EstadoPool, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker } from './clientes-worker.js';
import { logger } from './logger.js';
import { RegistroRotinasProprio } from './rotinas-registro-proprio.js';
import { RegistradorRotinas, ROTINAS_WORKER } from './rotinas-worker.js';
import {
  type AlertaVigiaBanco,
  alertasDaColeta,
  type ColetaTransacoes,
  coletarTransacoes,
  lerConfiguracaoVigiaBanco,
} from './vigia-banco.js';

export type NucleoVigiaBanco = Pick<NucleoProprio, 'saude' | 'lerPlataforma' | 'encerrar'>;
export type Sondagem = () => Promise<ReadonlyMap<string, number>>;

/** Gotenberg respondendo (1) ou não (0). */
export async function sondarServicos(env: NodeJS.ProcessEnv = process.env): Promise<Map<string, number>> {
  const alvos: [string, string][] = [
    ['gotenberg', `${env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318'}/health`],
  ];
  const r = new Map<string, number>();
  for (const [nome, url] of alvos) {
    try {
      const x = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      r.set(nome, x.ok ? 1 : 0);
    } catch {
      r.set(nome, 0);
    }
  }
  return r;
}

export interface RodadaVigiaBanco {
  readonly plataforma: boolean;
  readonly neutralizacao: boolean;
  readonly pools: readonly EstadoPool[];
  /** null: sem permissão para ver as transações (ou a leitura falhou). */
  readonly transacoes: ColetaTransacoes | null;
  readonly alertas: readonly AlertaVigiaBanco[];
  readonly duracaoMs: number;
}

@Injectable()
export class VigiaBancoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoVigiaBanco | null = null;
  private sondar: Sondagem = () => sondarServicos();
  private temporizador: NodeJS.Timeout | undefined;
  private coletando = false;
  private limiteMs = 5_000;
  private ultima: RodadaVigiaBanco | null = null;
  private servicos: ReadonlyMap<string, number> = new Map();
  private avisouPermissao = false;
  /** 01-SIS L95: a rodada registrada como rotina na Administração de cada cliente. */
  private registrador: RegistradorRotinas | null = null;

  /** Teste: o núcleo e a sondagem sem subir o banco. */
  usar(nucleo: NucleoVigiaBanco, sondar?: Sondagem, limiteMs = 5_000): void {
    this.nucleo = nucleo;
    if (sondar) this.sondar = sondar;
    this.limiteMs = limiteMs;
  }

  onApplicationBootstrap(): void {
    if (process.env['VIGIA_BANCO'] === 'desligado') return;
    try {
      const cfg = lerConfiguracaoVigiaBanco(process.env);
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, undefined, cfg.limiteTransacaoMs);
      this.registrador = new RegistradorRotinas((cliente) => new RegistroRotinasProprio(nucleo, cliente));
      this.registrarMetricas();
      this.temporizador = setInterval(() => void this.ciclo(), cfg.intervaloMs);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia do banco não subiu');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar().catch(() => undefined);
  }

  ultimaRodada(): RodadaVigiaBanco | null {
    return this.ultima;
  }

  /** Uma rodada: saúde, transações, serviços e alertas. */
  async ciclo(): Promise<RodadaVigiaBanco | null> {
    const nucleo = this.nucleo;
    if (!nucleo || this.coletando) return null;
    this.coletando = true;
    const inicio = Date.now();
    try {
      const saude = await nucleo.saude();
      let transacoes: ColetaTransacoes | null = null;
      try {
        transacoes = await nucleo.lerPlataforma('vigia-banco', (l) => coletarTransacoes(l, this.limiteMs));
        if (transacoes === null && !this.avisouPermissao) {
          this.avisouPermissao = true;
          logger.warn({}, 'vigia do banco: sem permissão para ver as transações abertas (PROCESS)');
        }
      } catch (e) {
        logger.warn(
          { erro: e instanceof Error ? e.name : 'erro' },
          'vigia do banco: coleta das transações falhou',
        );
      }
      this.servicos = await this.sondar();
      const alertas = alertasDaColeta(saude, transacoes, this.limiteMs);
      for (const a of alertas)
        logger.warn({ alerta: a.tipo, quantidade: a.quantidade }, `alerta do vigia: ${a.detalhe}`);
      this.ultima = {
        plataforma: saude.plataforma,
        neutralizacao: saude.neutralizacao,
        pools: saude.pools,
        transacoes,
        alertas,
        duracaoMs: Date.now() - inicio,
      };
      await this.registrarRodada(this.ultima);
      return this.ultima;
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'vigia do banco: rodada falhou');
      return null;
    } finally {
      this.coletando = false;
    }
  }

  /** A rodada vai à rotina de cada cliente: os alertas viram etapas e a execução fica com avisos. */
  private async registrarRodada(r: RodadaVigiaBanco): Promise<void> {
    const registrador = this.registrador;
    const nucleo = this.nucleo;
    if (!registrador || !nucleo) return;
    const agora = new Date();
    const clientes = await clientesDoWorker(nucleo, process.env, 'vigia-banco').catch(() => [] as string[]);
    for (const cliente of clientes)
      await registrador
        .rodar(cliente, ROTINAS_WORKER.vigiaBanco, 'vigia-banco', async () => ({
          resultado: null,
          avisos: r.alertas.length,
          etapas: r.alertas.map((a) => ({
            nome: a.tipo,
            situacao: 'concluida_com_avisos' as const,
            inicioEm: new Date(agora.getTime() - r.duracaoMs),
            fimEm: agora,
            lidos: a.quantidade,
            gravados: 0,
            rejeitados: 0,
            mensagem: a.tipo,
          })),
        }))
        .catch(() => undefined);
  }

  private registrarMetricas(): void {
    const m = metrics.getMeter('sgh-vigia-banco');
    const g = (
      nome: string,
      descricao: string,
      valor: (r: RodadaVigiaBanco) => number | null,
      unidade = '',
    ) =>
      m.createObservableGauge(nome, { description: descricao, unit: unidade }).addCallback((o) => {
        const r = this.ultima;
        const v = r ? valor(r) : null;
        if (v !== null) o.observe(v);
      });
    g('sgh.banco.plataforma', 'Banco plataforma respondendo (1) ou não (0)', (r) => (r.plataforma ? 1 : 0));
    g('sgh.banco.neutralizacao', 'Neutralização de saídas aprovada (1) ou não (0)', (r) =>
      r.neutralizacao ? 1 : 0,
    );
    g('sgh.banco.transacoes', 'Transações abertas no servidor', (r) => r.transacoes?.abertas ?? null);
    g('sgh.banco.transacoes.escrita', 'Transações de escrita abertas', (r) => r.transacoes?.escrita ?? null);
    g(
      'sgh.banco.transacoes.acima_limite',
      'Transações acima do limite',
      (r) => r.transacoes?.acimaDoLimite ?? null,
    );
    g('sgh.banco.travas.esperas', 'Transações esperando trava', (r) => r.transacoes?.esperandoTrava ?? null);
    g(
      'sgh.banco.transacao.mais_longa',
      'Idade da transação mais longa',
      (r) => (r.transacoes ? r.transacoes.maisLongaMs / 1000 : null),
      's',
    );
    g('sgh.banco.coleta.duracao', 'Duração da rodada do vigia', (r) => r.duracaoMs / 1000, 's');
    g('sgh.banco.alertas', 'Alertas na última rodada', (r) => r.alertas.length);
    g('sgh.vigia.transacao_limite', 'Limite de transação', () => this.limiteMs / 1000, 's');
    m.createObservableGauge('sgh.banco.pool.conexoes', {
      description: 'Conexões do pool por banco',
    }).addCallback((o) => {
      for (const p of this.ultima?.pools ?? []) {
        o.observe(p.ativas, { banco: p.banco, estado: 'ativas' });
        o.observe(p.ociosas, { banco: p.banco, estado: 'ociosas' });
      }
    });
    m.createObservableGauge('sgh.servico.disponivel', {
      description: 'Serviço do Compose respondendo (1) ou não (0)',
    }).addCallback((o) => {
      for (const [servico, v] of this.servicos) o.observe(v, { servico });
    });
  }
}
