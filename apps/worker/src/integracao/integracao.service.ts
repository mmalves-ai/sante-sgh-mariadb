// Serviço das integrações novas no worker (M34; ficha, regras 8 a 11): a cada ciclo, por estabelecimento, a vigia dos
// fatos do legado (leitura incremental → SGH_OUTBOX), a entrega das mensagens prontas aos parceiros (retentativa e fila
// de mortos) e o alerta da fila de mortos sem tratamento acima do limite (regra 10: o log `alerta das integrações`,
// que a regra de alerta da observabilidade conta). Desligado por INTEGRACAO=desligado. Log só com contagens e códigos.
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { LIMITE_MORTO_SEM_TRATAMENTO_MIN } from '@sgh/contratos';
import { alertasDeMortos } from '@sgh/dominio-integracao';
import { lerCodigos, lerConfiguracaoNucleo, lerInteiroAmbiente, lerMortos, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from '../logger.js';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import { cicloEntrega, type Enviador } from './entrega.js';
import { criarEnviador } from './enviadores.js';
import { cicloVigiaFatos } from './vigia-fatos.js';

/** A verificação da regra 10: os mortos sem tratamento acima do limite, um log de alerta por mensagem. */
export async function verificarAlertasMortos(
  acesso: AcessoIntegracao,
  hospital: string,
  limiteMinutos: number,
  agora: Date,
  alertar: (a: { estabelecimento: string; envio: string; parceiro: string; minutos: number }) => void,
): Promise<number> {
  const mortos = await acesso.ler(hospital, (l) => lerMortos(l, hospital, 200));
  const alertas = alertasDeMortos(
    mortos
      .filter((m) => m.mortoEm && !m.tratamento)
      .map((m) => ({ id: m.id, parceiro: m.parceiro, mortoEm: m.mortoEm!, tratado: false })),
    limiteMinutos,
    agora,
  );
  for (const a of alertas)
    alertar({ estabelecimento: hospital, envio: a.id, parceiro: a.parceiro, minutos: a.minutos });
  return alertas.length;
}

@Injectable()
export class IntegracaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoLegado | null = null;
  private acesso: AcessoIntegracao | null = null;
  private enviador: Enviador | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private ultimoAlerta = 0;

  onApplicationBootstrap(): void {
    if (process.env['INTEGRACAO'] === 'desligado') return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'INTEGRACAO_INTERVALO_MS', 15_000, 1_000, 3_600_000);
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
      this.acesso = acessoDoNucleo(this.nucleo, 'integracao');
      const nucleo = this.nucleo;
      this.enviador = criarEnviador({
        ambiente: process.env['AMBIENTE']?.trim() ?? 'dev',
        produto: process.env['PRODUTO_NOME']?.trim() || 'SGH',
        hostMllp: process.env['OIE_MLLP_HOST']?.trim() || '127.0.0.1',
        simuladorRnds: process.env['RNDS_SIMULADOR_URL']?.trim() || null,
        // W0-03 (M6): o parâmetro de credencial da RNDS (homologação autorizada e o certificado do estabelecimento).
        // O cliente com o certificado entra com o credenciamento (DP do dono); sem ele, nada sai fora do simulador.
        rnds: {
          homologacaoAutorizada: process.env['RNDS_HOMOLOGACAO_AUTORIZADA'] === 'sim',
          credencial: !!process.env['RNDS_CERTIFICADO_PFX']?.trim(),
        },
        destinoApi: (codigo) =>
          process.env[`INTEGRACAO_DESTINO_${codigo.toUpperCase().replace(/-/g, '_')}`]?.trim() || null,
        ler: (h, fn) => nucleo.lerSomente({ rede: nucleo.rede, hospital: h, traceId: 'integracao' }, fn),
        agora: () => new Date(),
      });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'integrações novas: não subiu');
    }
  }

  async ciclo(): Promise<void> {
    if (this.rodando || !this.nucleo || !this.acesso || !this.enviador) return;
    this.rodando = true;
    try {
      const lote = lerInteiroAmbiente(process.env, 'INTEGRACAO_LOTE_FATOS', 200, 10, 5_000);
      for (const cod of lerCodigos(process.env)) {
        try {
          const v = await cicloVigiaFatos(this.acesso, this.nucleo.rede, cod, lote);
          for (const x of v)
            if (x.eventos > 0) logger.info({ estabelecimento: cod, ...x }, 'integrações: fatos');
          const r = await cicloEntrega(this.acesso, cod, this.enviador, {
            agora: () => new Date(),
            tempoPorParceiroMs: 20_000,
          });
          if (r.prontas > 0) logger.info({ estabelecimento: cod, ...r }, 'integrações: entrega');
          // A regra 10 a cada 5 minutos (o log é o sinal da regra de alerta).
          if (Date.now() - this.ultimoAlerta > 300_000) {
            this.ultimoAlerta = Date.now();
            await verificarAlertasMortos(this.acesso, cod, LIMITE_MORTO_SEM_TRATAMENTO_MIN, new Date(), (a) =>
              logger.warn(a, 'alerta das integrações: fila de mortos sem tratamento'),
            );
          }
        } catch (e) {
          logger.warn(
            { estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
            'integrações: ciclo falhou',
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
