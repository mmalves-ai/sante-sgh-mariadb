// OpenTelemetry da API (M09; cap-09 §9.11): rastros e métricas por OTLP/HTTP para o coletor do Compose
// (OTEL_EXPORTER_URL, só loopback fora de produção pela trava de saídas). Sem a chave, nada é exportado (a
// API de telemetria fica no-op). Métrica HTTP por rota (latência e erros) para os painéis "Técnico" e
// "Jornadas"; as consultas ao Firebird são rastreadas no adaptador (packages/legado, sem valor de parâmetro).
import { metrics, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface Telemetria {
  encerrar(): Promise<void>;
}

export function iniciarTelemetria(servico: string, env: NodeJS.ProcessEnv = process.env): Telemetria | null {
  const url = env['OTEL_EXPORTER_URL']?.trim().replace(/\/+$/, '');
  if (!url) return null;
  const resource = resourceFromAttributes({
    'service.name': servico,
    'deployment.environment.name': env['AMBIENTE'] ?? 'dev',
    'sgh.rede': env['REDE_PADRAO'] ?? '',
  });
  const rastros = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${url}/v1/traces` }))],
  });
  const medidor = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${url}/v1/metrics` }),
        exportIntervalMillis: Number(env['OTEL_INTERVALO_MS'] ?? 10_000),
      }),
    ],
  });
  trace.setGlobalTracerProvider(rastros);
  metrics.setGlobalMeterProvider(medidor);
  return {
    async encerrar() {
      await Promise.allSettled([rastros.shutdown(), medidor.shutdown()]);
    },
  };
}

let histograma: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;

/** Registra a duração de uma resposta HTTP por rota (padrão da rota, nunca a URL com valores). */
export function registrarResposta(rota: string, metodo: string, status: number, segundos: number): void {
  histograma ??= metrics.getMeter('sgh-api').createHistogram('sgh.http.duracao', {
    unit: 's',
    description: 'Duração das respostas da API por rota',
    advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
  });
  histograma.record(segundos, { rota, metodo, classe: `${Math.floor(status / 100)}xx` });
}

let conversao: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;

/** Duração de cada conversão HTML → PDF/A no Gotenberg (painel "Técnico": p95 de conversão). */
export function registrarConversaoPdf(segundos: number): void {
  conversao ??= metrics.getMeter('sgh-api').createHistogram('sgh.gotenberg.conversao.duracao', {
    unit: 's',
    description: 'Duração da conversão HTML em PDF/A-2b no Gotenberg',
    advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30] },
  });
  conversao.record(segundos);
}
