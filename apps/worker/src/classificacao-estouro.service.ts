// Estouro do tempo-alvo da classificação de risco no `worker` (M44, etapa 1; ficha, regra 4; lote F2.2 05-15): a cada
// minuto, por cliente e estabelecimento com a chave `pa.classificacao` ligada, lê os atendimentos abertos do pronto
// atendimento (as etapas reais) e as classificações pela porta própria; a classificação vigente que passou do prazo sem
// o atendimento médico iniciado recebe UM aviso (aviso_estouro_classificacao, chave única) com a trilha, numa operação
// por aviso. Com dois consumidores, a chave única faz o segundo desistir sem erro: nunca aviso duplicado. A
// reclassificação obrigatória aparece na hora nas telas (o quadro calcula do relógio); o aviso é o registro do estouro
// para os indicadores e a auditoria. O relógio é injetado nos testes. Ligado fora de dev/ci; em dev/ci só com
// CLASSIFICACAO_ESTOURO=ligado. Log só com contagens.
// Melhoria: a classificação sem cor do protocolo no cadastro do nível de prioridade é contada e avisada no log.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { chaveAvisoEstouro, classificacaoVigente, reclassificacaoObrigatoria } from '@sgh/dominio-recepcao';
import { NucleoProprio } from '@sgh/nucleo';
import {
  type EstouroPendente,
  type PortaEstouro,
  PortaEstouroPropria,
} from './classificacao-estouro-propria.js';
import { logger } from './logger.js';
import {
  type AlvoEstabelecimento,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';

export type { EstouroPendente };

export function estouroLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'CLASSIFICACAO_ESTOURO');
}

const ETAPAS_FIM = new Set(['decisao', 'saida']);

/** Os estourados ainda não avisados (só leitura) no relógio dado. */
export async function estourosPendentes(
  porta: PortaEstouro,
  est: AlvoEstabelecimento,
  agora: Date,
): Promise<{ ligada: boolean; agora: string; pendentes: EstouroPendente[]; semCor: number }> {
  const instante = agora.toISOString();
  const ligada = await porta.ligada(est, agora);
  if (!ligada) return { ligada, agora: instante, pendentes: [], semCor: 0 };
  const abertos = (await porta.abertos(est)).filter((a) => !a.etapas.some((x) => ETAPAS_FIM.has(x.etapa)));
  const linhas = await porta.classificacoes(
    est,
    abertos.map((a) => a.id),
  );
  const r: EstouroPendente[] = [];
  let semCor = 0;
  for (const a of abertos) {
    const v = classificacaoVigente(linhas.filter((x) => x.atendimento === a.id));
    const medico = a.etapas.find((x) => x.etapa === 'atendimento_medico')?.em ?? null;
    if (!v || !reclassificacaoObrigatoria(v, instante, medico)) continue;
    if (v.cor === null) {
      semCor++;
      continue;
    }
    r.push({
      chave: chaveAvisoEstouro(est.codigo, v.id),
      classificacao: v.id,
      atendimento: a.id,
      prazoEm: new Date(Date.parse(v.classificadoEm) + v.tempoAlvoMin * 60_000).toISOString(),
      cor: v.cor,
    });
  }
  const ja = await porta.avisosGravados(r.map((x) => x.chave));
  return { ligada, agora: instante, pendentes: r.filter((x) => !ja.has(x.chave)), semCor };
}

/** Um ciclo num estabelecimento: os avisos gravados por este consumidor. */
export async function cicloEstouro(
  porta: PortaEstouro,
  est: AlvoEstabelecimento,
  agora: Date = new Date(),
): Promise<{ ligada: boolean; pendentes: number; avisados: number; semCor: number }> {
  const p = await estourosPendentes(porta, est, agora);
  let avisados = 0;
  for (const x of p.pendentes) if (await porta.registrarAviso(est, x)) avisados++;
  return { ligada: p.ligada, pendentes: p.pendentes.length, avisados, semCor: p.semCor };
}

export type FabricaPortaEstouro = (cliente: string) => PortaEstouro;

@Injectable()
export class ClassificacaoEstouroService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaEstouro | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo e a porta sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaEstouro): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!estouroLigado(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaEstouroPropria(nucleo, cliente));
      this.temporizador = setInterval(() => void this.ciclo(), 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error(
        { erro: e instanceof Error ? e.message : 'erro' },
        'aviso de estouro da classificação não subiu',
      );
    }
  }

  async ciclo(
    agora: Date = new Date(),
  ): Promise<{ cliente: string; estabelecimento: string; avisados: number }[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'classificacao-estouro',
        fabrica,
        (porta, est) => cicloEstouro(porta, est, agora),
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'aviso de estouro falhou',
          ),
      );
      for (const v of voltas) {
        if (v.resultado.avisados > 0)
          logger.info(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, avisados: v.resultado.avisados },
            'estouros avisados',
          );
        if (v.resultado.semCor > 0)
          logger.warn(
            { cliente: v.cliente, estabelecimento: v.estabelecimento, semCor: v.resultado.semCor },
            'classificação estourada sem cor do protocolo no nível de prioridade (sem aviso)',
          );
      }
      return voltas.map((v) => ({
        cliente: v.cliente,
        estabelecimento: v.estabelecimento,
        avisados: v.resultado.avisados,
      }));
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
