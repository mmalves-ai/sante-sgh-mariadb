// Rotina da carga diária do data mart pseudonimizado no `worker` (01-ADM L115; F8): por cliente e estabelecimento
// ativo, uma vez por dia civil do fuso dele e depois da hora da carga (regra pura do domínio), abre o registro da carga
// (carga_data_mart, em execução), roda o carregador do arquivo do estabelecimento e fecha o registro com as etapas por
// dimensão e fato (carga_data_mart_etapa), a situação e as linhas; a falha fica registrada com a mensagem sem valores
// de dados e não se repete no mesmo dia. A análise ad hoc (tabela dinâmica, cubo, filtros salvos) é da ferramenta de
// BI ligada ao arquivo só para leitura (docs/implantacao/ligacao-bi-data-mart.md); o produto não guarda análises.
// A cada 5 minutos (pedidos manuais da administração, 01-REL L113; a agendada uma vez por dia); ligado fora de
// dev/ci; em dev/ci só com DATAMART_CARGA_DIARIA=ligado. Log só com contagens.
// Ao fim do ciclo, o cliente em que alguma carga concluiu tem o arquivo da Rede remontado e registrado
// (datamart-rede-propria: remontadorRedeProprio).
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { cargaDevida, fecharCarga, type ObjetoCarregado } from '@sgh/dominio-relatorio';
import { NucleoProprio } from '@sgh/nucleo';
import { type PortaDataMart, PortaDataMartPropria } from './datamart-carga-propria.js';
import { carregadorProprio, opcoesDoAmbiente, pastaDoAmbiente } from './datamart-carregador-proprio.js';
import { type RemontadorRede, remontadorRedeProprio } from './datamart-rede-propria.js';
import { logger } from './logger.js';
import {
  type AlvoEstabelecimento,
  diaEHoraLocal,
  instanteLocal,
  type NucleoServico,
  servicoLigado,
  voltaPorEstabelecimento,
} from './servico-worker.js';

export function cargaDataMartLigada(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'DATAMART_CARGA_DIARIA');
}

/** Carrega o arquivo pseudonimizado do estabelecimento e devolve as contagens por objeto (dimensão ou fato). */
export type CarregadorDataMart = (cliente: string, est: AlvoEstabelecimento) => Promise<ObjetoCarregado[]>;

/**
 * Carregador que recusa (testes e configuração inválida): a recusa fica no registro da carga como falha, visível ao
 * administrador, e não se repete no mesmo dia. O carregador real é o carregadorProprio (datamart-carregador-proprio).
 */
export const carregadorIndisponivel: CarregadorDataMart = async () => {
  throw new Error(
    'leituras da carga do data mart no banco próprio indisponíveis (movimento da internação em vocabulário neutro e leituras agregadas por estabelecimento)',
  );
};

export interface ResultadoCargaDataMart {
  readonly devida: boolean;
  readonly carga: number | null;
  readonly situacao: string | null;
  readonly linhas: number;
}

/** Um ciclo num estabelecimento: devida? abre, carrega, fecha (a falha do carregador vira o registro da falha). */
export async function cicloDataMart(
  porta: PortaDataMart,
  cliente: string,
  est: AlvoEstabelecimento,
  carregador: CarregadorDataMart,
  agora: Date = new Date(),
  relogio: () => Date = () => new Date(),
): Promise<ResultadoCargaDataMart> {
  const local = diaEHoraLocal(agora, est.fuso);
  const ultima = await porta.ultimaIniciada(est);
  const devida = cargaDevida({
    hoje: local.data,
    hora: Number(local.hora.slice(0, 2)),
    ultimaIniciadaNoDia: ultima === null ? null : diaEHoraLocal(ultima, est.fuso).data,
  });
  if (!devida) return { devida: false, carga: null, situacao: null, linhas: 0 };
  const carga = await porta.abrir(est, agora, instanteLocal(local.data, 0, est.fuso));
  if (carga === null) return { devida: true, carga: null, situacao: null, linhas: 0 };
  return executarCarga(porta, cliente, est, carga, carregador, agora, relogio);
}

/**
 * Os pedidos manuais da administração (01-REL L113): cada um que aguarda é assumido (o segundo consumidor desiste),
 * carregado e fechado como a carga agendada, com as etapas e a situação; a falha fica registrada.
 */
export async function pedidosDataMart(
  porta: PortaDataMart,
  cliente: string,
  est: AlvoEstabelecimento,
  carregador: CarregadorDataMart,
  relogio: () => Date = () => new Date(),
): Promise<ResultadoCargaDataMart[]> {
  const feitos: ResultadoCargaDataMart[] = [];
  for (const carga of await porta.pedidosAguardando(est)) {
    if (!(await porta.assumir(est, carga))) continue;
    feitos.push(await executarCarga(porta, cliente, est, carga, carregador, relogio(), relogio));
  }
  return feitos;
}

/** Roda o carregador da carga aberta e a fecha (a falha do carregador vira o registro da falha). */
async function executarCarga(
  porta: PortaDataMart,
  cliente: string,
  est: AlvoEstabelecimento,
  carga: number,
  carregador: CarregadorDataMart,
  agora: Date,
  relogio: () => Date,
): Promise<ResultadoCargaDataMart> {
  let objetos: ObjetoCarregado[] = [];
  let erro: unknown = null;
  try {
    objetos = await carregador(cliente, est);
  } catch (e) {
    erro = e;
  }
  let f: ReturnType<typeof fecharCarga>;
  try {
    f = fecharCarga(objetos, erro);
  } catch (e) {
    // Contagem inválida do carregador vira falha registrada (nunca a carga presa em execução).
    f = fecharCarga([], e);
  }
  const fim = relogio();
  await porta.concluir(est, carga, f, fim.getTime() < agora.getTime() ? agora : fim);
  return { devida: true, carga, situacao: f.situacao, linhas: f.linhasGravadas };
}

export type FabricaPortaDataMart = (cliente: string) => PortaDataMart;

@Injectable()
export class DataMartCargaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaDataMart | null = null;
  private carregador: CarregadorDataMart = carregadorIndisponivel;
  private remontador: RemontadorRede | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;

  /** Teste: o núcleo, a porta e o carregador sem subir o banco. */
  usar(
    nucleo: NucleoServico,
    fabrica: FabricaPortaDataMart,
    carregador?: CarregadorDataMart,
    remontador?: RemontadorRede,
  ): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    if (carregador) this.carregador = carregador;
    if (remontador) this.remontador = remontador;
  }

  onApplicationBootstrap(): void {
    if (!cargaDataMartLigada(process.env)) return;
    try {
      const nucleo = new NucleoProprio({ env: process.env });
      // O carregador real (banco próprio → arquivo do estabelecimento); sem a chave fora de dev, cada carga falha
      // registrada com o motivo.
      let carregador: CarregadorDataMart;
      try {
        carregador = carregadorProprio(nucleo, opcoesDoAmbiente(process.env));
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'configuração do data mart inválida';
        carregador = async () => {
          throw new Error(motivo);
        };
      }
      this.usar(
        nucleo,
        (cliente) => new PortaDataMartPropria(nucleo, cliente),
        carregador,
        remontadorRedeProprio(nucleo, { pasta: pastaDoAmbiente(process.env) }),
      );
      void this.ciclo();
      // A cada 5 minutos: o pedido manual da administração começa logo; a agendada segue uma vez por dia (regra).
      this.temporizador = setInterval(() => void this.ciclo(), 300_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'carga do data mart não subiu');
    }
  }

  async ciclo(
    agora: Date = new Date(),
  ): Promise<{ cliente: string; estabelecimento: string; situacao: string | null }[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    // Os clientes com alguma carga concluída neste ciclo (agendada ou manual): o arquivo da Rede é remontado no fim.
    const concluidos = new Set<string>();
    const anotar = (cliente: string, situacao: string | null) => {
      if (situacao === 'concluida' || situacao === 'concluida_com_rejeicao') concluidos.add(cliente);
    };
    try {
      const voltas = await voltaPorEstabelecimento(
        nucleo,
        process.env,
        'datamart-carga',
        fabrica,
        async (porta, est) => {
          // Primeiro os pedidos da administração; depois a carga agendada do dia.
          const manuais = await pedidosDataMart(porta, est.cliente, est, this.carregador);
          for (const m of manuais) anotar(est.cliente, m.situacao);
          for (const m of manuais)
            logger.info(
              { cliente: est.cliente, estabelecimento: est.codigo, situacao: m.situacao, linhas: m.linhas },
              'carga manual do data mart registrada',
            );
          const r = await cicloDataMart(porta, est.cliente, est, this.carregador, agora);
          anotar(est.cliente, r.situacao);
          return r;
        },
        (cliente, estabelecimento, e) =>
          logger.warn(
            { cliente, estabelecimento, erro: e instanceof Error ? e.name : 'erro' },
            'carga do data mart falhou',
          ),
      );
      for (const v of voltas)
        if (v.resultado.carga !== null)
          logger.info(
            {
              cliente: v.cliente,
              estabelecimento: v.estabelecimento,
              situacao: v.resultado.situacao,
              linhas: v.resultado.linhas,
            },
            'carga do data mart registrada',
          );
      for (const cliente of concluidos) await this.remontarRede(cliente, agora);
      return voltas.map((v) => ({
        cliente: v.cliente,
        estabelecimento: v.estabelecimento,
        situacao: v.resultado.situacao,
      }));
    } finally {
      this.rodando = false;
    }
  }

  /** Remonta o arquivo da Rede do cliente; a falha da junção fica registrada pelo remontador (o log só com contagens). */
  private async remontarRede(cliente: string, agora: Date): Promise<void> {
    if (!this.remontador) return;
    try {
      const r = await this.remontador(cliente, agora);
      logger.info(
        {
          cliente,
          situacao: r.situacao,
          estabelecimentos: r.estabelecimentos.length,
          foraDoBi: r.foraDoBi,
          linhas: r.linhas,
        },
        'arquivo da Rede do data mart registrado',
      );
    } catch (e) {
      logger.warn(
        { cliente, erro: e instanceof Error ? e.name : 'erro' },
        'arquivo da Rede do data mart falhou',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
