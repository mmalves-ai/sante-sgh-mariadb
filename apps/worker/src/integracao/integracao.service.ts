// Serviço das integrações no worker (M34; ficha, regras 8 a 11): a cada ciclo, por cliente e estabelecimento, a vigia
// dos fatos (leitura incremental → fila comum), a entrega das mensagens prontas aos parceiros (retentativa e fila de
// mortos) e o alerta da fila de mortos sem tratamento acima do limite (regra 10: o log `alerta das integrações`, que
// a regra de alerta da observabilidade conta). Desligado por INTEGRACAO=desligado. Log só com contagens e códigos.
// Melhoria: o banco é o próprio de cada cliente (NucleoProprio); os clientes vêm da plataforma (implantação,
// homologação e produção) ou da lista INTEGRACAO_CLIENTES, e os estabelecimentos do banco de cada um.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { LIMITE_MORTO_SEM_TRATAMENTO_MIN } from '@sgh/contratos';
import { alertasDeMortos } from '@sgh/dominio-integracao';
import { FORMATO_CLIENTE, lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { logger } from '../logger.js';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import { cicloEntrega, type Enviador } from './entrega.js';
import { criarEnviador } from './enviadores.js';
import { lerEstabelecimentos, lerMortos } from './porta-propria.js';
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

/** Os clientes do ciclo: a lista do ambiente, ou os clientes em uso na plataforma. */
export function clientesDoAmbiente(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => FORMATO_CLIENTE.test(c));
}

interface DoCliente {
  readonly acesso: AcessoIntegracao;
  readonly enviador: Enviador;
}

@Injectable()
export class IntegracaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoProprio | null = null;
  private readonly clientes = new Map<string, DoCliente>();
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private ultimoAlerta = 0;

  onApplicationBootstrap(): void {
    if (process.env['INTEGRACAO'] === 'desligado') return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'INTEGRACAO_INTERVALO_MS', 15_000, 1_000, 3_600_000);
      this.nucleo = new NucleoProprio({ env: process.env });
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'integrações: não subiu');
    }
  }

  private doCliente(nucleo: NucleoProprio, cliente: string): DoCliente {
    const ja = this.clientes.get(cliente);
    if (ja) return ja;
    const acesso = acessoDoNucleo(nucleo, cliente, 'integracao');
    const enviador = criarEnviador({
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
      ler: (h, fn) => acesso.ler(h, fn),
      agora: () => new Date(),
    });
    const c = { acesso, enviador };
    this.clientes.set(cliente, c);
    return c;
  }

  private async clientesAtivos(nucleo: NucleoProprio): Promise<string[]> {
    const lista = clientesDoAmbiente(process.env['INTEGRACAO_CLIENTES']);
    if (lista.length > 0) return lista;
    const linhas = await nucleo.lerPlataforma('integracao', (l) =>
      l.consultar(
        "SELECT codigo FROM cliente WHERE situacao IN ('implantacao', 'homologacao', 'producao') ORDER BY codigo",
        [],
        { teto: 1000 },
      ),
    );
    return linhas.map((x) => String(x['codigo'])).filter((c) => FORMATO_CLIENTE.test(c));
  }

  async ciclo(): Promise<void> {
    const nucleo = this.nucleo;
    if (this.rodando || !nucleo) return;
    this.rodando = true;
    try {
      const lote = lerInteiroAmbiente(process.env, 'INTEGRACAO_LOTE_FATOS', 200, 10, 5_000);
      const alertar = Date.now() - this.ultimoAlerta > 300_000;
      if (alertar) this.ultimoAlerta = Date.now();
      for (const cliente of await this.clientesAtivos(nucleo)) {
        const { acesso, enviador } = this.doCliente(nucleo, cliente);
        let estabelecimentos: string[] = [];
        try {
          estabelecimentos = await nucleo.lerSomente(
            { cliente, correlacao: 'integracao' },
            lerEstabelecimentos,
          );
        } catch (e) {
          logger.warn(
            { cliente, erro: e instanceof Error ? e.name : 'erro' },
            'integrações: cliente indisponível',
          );
        }
        for (const cod of estabelecimentos) {
          try {
            const v = await cicloVigiaFatos(acesso, cod, lote);
            for (const x of v)
              if (x.eventos > 0) logger.info({ cliente, estabelecimento: cod, ...x }, 'integrações: fatos');
            const r = await cicloEntrega(acesso, cod, enviador, {
              agora: () => new Date(),
              tempoPorParceiroMs: 20_000,
            });
            if (r.prontas > 0) logger.info({ cliente, estabelecimento: cod, ...r }, 'integrações: entrega');
            // A regra 10 a cada 5 minutos (o log é o sinal da regra de alerta).
            if (alertar)
              await verificarAlertasMortos(acesso, cod, LIMITE_MORTO_SEM_TRATAMENTO_MIN, new Date(), (a) =>
                logger.warn({ cliente, ...a }, 'alerta das integrações: fila de mortos sem tratamento'),
              );
          } catch (e) {
            logger.warn(
              { cliente, estabelecimento: cod, erro: e instanceof Error ? e.name : 'erro' },
              'integrações: ciclo falhou',
            );
          }
        }
      }
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'integrações: ciclo falhou');
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
