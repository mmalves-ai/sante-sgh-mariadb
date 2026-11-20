// Vigia do Firebird no worker (regra 13 da ficha do M09; cap-09 §9.11, cap-10 §10.11): a cada 15 s, uma
// coleta MON$ por estabelecimento disponível (transação curta somente leitura), exportada como métricas
// OpenTelemetry para o painel "Banco e coexistência" do Grafana, e alerta direto no log (com a conexão
// responsável) quando uma transação do novo passa do limite (VIGIA_TRANSACAO_LIMITE_MS, padrão 5 s), quando
// o schema-check reprova ou (M03) quando uma assinatura diverge. Nunca o texto SQL de outra conexão.
// Também mede a saúde dos serviços do Compose (Gotenberg, S3) para o painel "Técnico".
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  alertaSchema,
  type Coleta,
  coletar,
  type ConfiguracaoVigia,
  LIMITE_TRANSACAO_PADRAO_MS,
  INTERVALO_COLETA_MS,
  lerConfiguracaoNucleo,
  lerConfiguracaoVigia,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

@Injectable()
export class VigiaFirebirdService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private readonly ultimas = new Map<string, Coleta>();
  private readonly servicos = new Map<string, number>();
  private coletando = false;
  private limiteMs = LIMITE_TRANSACAO_PADRAO_MS;
  private intervaloMs = INTERVALO_COLETA_MS;

  onApplicationBootstrap(): void {
    if (process.env['VIGIA_FIREBIRD'] === 'desligado') return;
    try {
      // Faixas validadas (configuração inválida: o vigia não sobe e o log diz a chave).
      const cfg: ConfiguracaoVigia = lerConfiguracaoVigia(process.env);
      this.limiteMs = cfg.limiteTransacaoMs;
      this.intervaloMs = cfg.intervaloMs;
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
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'vigia do Firebird sem núcleo do legado',
      );
      return;
    }
    this.registrarMetricas();
    const nucleo = this.nucleo;
    // Banco fora na partida: a nova tentativa periódica (FB_REVERIFICACAO_MS, pendência do M02) devolve o
    // estabelecimento ao vigia sem reiniciar o worker; o ciclo já pula quem estiver desconectado.
    const iniciarCiclo = () => {
      nucleo.reverificarPeriodicamente(nucleo.config.reverificacaoMs);
      void this.ciclo();
      this.temporizador = setInterval(() => void this.ciclo(), this.intervaloMs);
      this.temporizador.unref();
    };
    void nucleo.partida().then(iniciarCiclo, (e: unknown) => {
      logger.error({ erro: e instanceof Error ? e.name : 'erro' }, 'partida do núcleo no vigia falhou');
      iniciarCiclo();
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }

  /** Uma rodada: coleta MON$ de cada estabelecimento disponível e sonda dos serviços. */
  async ciclo(): Promise<void> {
    if (!this.nucleo || this.coletando) return;
    this.coletando = true;
    try {
      for (const s of this.nucleo.saude()) {
        const externos = [alertaSchema(s.codigo, s.schema?.estado ?? null)].filter((a) => a !== null);
        if (!s.conectado) continue;
        try {
          const c = await this.nucleo.lerSomente(
            { rede: this.nucleo.rede, hospital: s.codigo, traceId: 'vigia' },
            (l) =>
              coletar(l, {
                estabelecimento: s.codigo,
                limiteTransacaoMs: this.limiteMs,
                alertasExternos: externos,
              }),
          );
          this.ultimas.set(s.codigo, c);
          for (const a of c.alertas) {
            logger.warn(
              {
                alerta: a.tipo,
                estabelecimento: a.estabelecimento,
                anexo: a.anexo,
                marca: a.marca,
                duracaoMs: a.duracaoMs,
              },
              `alerta do vigia: ${a.detalhe}`,
            );
          }
        } catch (e) {
          logger.warn(
            { estabelecimento: s.codigo, erro: e instanceof Error ? e.name : 'erro' },
            'coleta MON$ falhou',
          );
        }
      }
      await this.sondarServicos();
    } finally {
      this.coletando = false;
    }
  }

  private async sondarServicos(): Promise<void> {
    const alvos: [string, string][] = [
      ['gotenberg', `${process.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318'}/health`],
      ['s3', `${process.env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318'}/healthz`],
    ];
    for (const [nome, url] of alvos) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
        this.servicos.set(nome, r.ok ? 1 : 0);
      } catch {
        this.servicos.set(nome, 0);
      }
    }
  }

  ultimaColeta(codigo: string): Coleta | undefined {
    return this.ultimas.get(codigo);
  }

  private registrarMetricas(): void {
    const m = metrics.getMeter('sgh-vigia-firebird');
    const porSistema = (
      nome: string,
      descricao: string,
      valor: (s: Coleta['porSistema'][number]) => number,
      unidade = '',
    ) => {
      m.createObservableGauge(nome, { description: descricao, unit: unidade }).addCallback((r) => {
        for (const c of this.ultimas.values()) {
          for (const s of c.porSistema)
            r.observe(valor(s), { estabelecimento: c.estabelecimento, sistema: s.sistema });
        }
      });
    };
    porSistema('sgh.firebird.conexoes', 'Conexões por sistema (MON$ATTACHMENTS)', (s) => s.conexoes);
    porSistema(
      'sgh.firebird.transacoes',
      'Transações abertas por sistema (MON$TRANSACTIONS)',
      (s) => s.transacoes,
    );
    porSistema(
      'sgh.firebird.transacoes.escrita',
      'Transações de escrita abertas por sistema',
      (s) => s.transacoesEscrita,
    );
    porSistema(
      'sgh.firebird.comandos.ativos',
      'Comandos executando por sistema (MON$STATEMENTS, MON$STATE = 1)',
      (s) => s.comandosAtivos,
    );
    porSistema(
      'sgh.firebird.comandos.parados',
      'Comandos parados por sistema (MON$STATEMENTS, MON$STATE = 2: cursor não buscado até o fim)',
      (s) => s.comandosParados,
    );
    porSistema(
      'sgh.firebird.travas',
      'Travas de registro pedidas por sistema (MON$RECORD_LOCKS, acumulado das conexões abertas)',
      (s) => s.travas,
    );
    porSistema(
      'sgh.firebird.travas.esperas',
      'Esperas por trava de registro por sistema (MON$RECORD_WAITS, acumulado)',
      (s) => s.esperasPorTrava,
    );
    porSistema(
      'sgh.firebird.travas.conflitos',
      'Conflitos de atualização por sistema (MON$RECORD_CONFLICTS, acumulado)',
      (s) => s.conflitos,
    );
    porSistema(
      'sgh.firebird.transacao.mais_longa',
      'Idade da transação mais longa por sistema',
      (s) => s.transacaoMaisLongaMs / 1000,
      's',
    );
    const doBanco = (nome: string, descricao: string, valor: (c: Coleta) => number, unidade = '') =>
      m.createObservableGauge(nome, { description: descricao, unit: unidade }).addCallback((r) => {
        for (const c of this.ultimas.values()) r.observe(valor(c), { estabelecimento: c.estabelecimento });
      });
    doBanco(
      'sgh.firebird.folga_oit',
      'Próxima transação menos OIT (lixo que o GC ainda não limpa)',
      (c) => c.banco.folgaOit,
    );
    doBanco('sgh.firebird.folga_oat', 'Próxima transação menos OAT', (c) => c.banco.folgaOat);
    doBanco('sgh.firebird.proxima_transacao', 'MON$NEXT_TRANSACTION', (c) => c.banco.proxima);
    doBanco('sgh.firebird.coleta.duracao', 'Duração da coleta MON$', (c) => c.duracaoMs / 1000, 's');
    doBanco('sgh.firebird.alertas', 'Alertas diretos na última coleta', (c) => c.alertas.length);
    doBanco(
      'sgh.firebird.transacao_novo.mais_longa',
      'Transação mais longa do novo (alvo: abaixo do limite)',
      (c) => Math.max(0, ...c.conexoesDoNovo.map((x) => x.transacaoMaisLongaMs)) / 1000,
      's',
    );
    m.createObservableGauge('sgh.vigia.transacao_limite', {
      description: 'Limite de transação do novo',
      unit: 's',
    }).addCallback((r) => r.observe(this.limiteMs / 1000));
    m.createObservableGauge('sgh.servico.disponivel', {
      description: 'Serviço do Compose respondendo (1) ou não (0)',
    }).addCallback((r) => {
      for (const [servico, v] of this.servicos) r.observe(v, { servico });
    });
  }
}
