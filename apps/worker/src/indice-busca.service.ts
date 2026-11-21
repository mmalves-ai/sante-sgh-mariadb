// Leitura incremental do índice de busca do cadastro (ficha do M11, seção 4; lote F2.2 05-15): a cada BUSCA_VIGIA_MS
// (padrão 5 s), por cliente, o que nasceu ou mudou no cadastro próprio (paciente, profissional e solicitante) depois da
// marca entra no índice de busca por nome (meta: em até 10 s na busca por nome); o excluído sai. Os pacientes
// reindexados vão à fila de duplicidades pela regra pura do escore (regra 6). A cada BUSCA_CONFERENCIA_MS (padrão 1 h),
// a conferência por contagem (índice × cadastro) e, quando diverge, o reparo (indexa o que falta e tira os órfãos), com
// o aviso no log. Ligado fora de dev/ci; em dev/ci só com BUSCA_VIGIA=ligado. Log só com contagens.
// O par da fila de duplicidades é avaliado pela mesma regra pura do escore da API (escoreDuplicidade e entraNaFila, com
// nome, nascimento, mãe, CPF e telefone); o candidato é o de mesma chave fonética da primeira e da última palavra do nome.
// Melhoria: a marca é por cliente e entidade (instante e id da última mudança lida), em ordem estável: dois cadastros
// com o mesmo instante não se perdem; a conferência repara em vez de só avisar.
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { entraNaFila, escoreDuplicidade } from '@sgh/dominio-cadastro';
import { lerInteiroAmbiente, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker } from './clientes-worker.js';
import {
  type AvaliarPar,
  ENTIDADES_BUSCA,
  type EntidadeBusca,
  type MarcaIndice,
  type PortaIndiceBusca,
  PortaIndiceBuscaPropria,
} from './indice-busca-propria.js';
import { logger } from './logger.js';
import { type NucleoServico, servicoLigado } from './servico-worker.js';

/** Cadastros lidos por entidade em cada ciclo. */
export const LOTE_VIGIA = 500;

/** O vigia roda? Fora de dev/ci, sempre (salvo BUSCA_VIGIA=desligado); em dev/ci, só com BUSCA_VIGIA=ligado. */
export function vigiaLigado(env: NodeJS.ProcessEnv): boolean {
  return servicoLigado(env, 'BUSCA_VIGIA');
}

/** A regra pura do escore (escoreDuplicidade e entraNaFila, as mesmas do "Atualizar a fila" da API; os candidatos diferem: aqui, a chave fonética do nome). null fica fora da fila. */
export const avaliarPar: AvaliarPar = (a, b) => {
  const e = escoreDuplicidade(a, b);
  return entraNaFila(e) ? { escore: e.escore, criterios: e.criterios } : null;
};

export interface ResultadoVigia {
  readonly cliente: string;
  readonly entidade: EntidadeBusca;
  readonly lidos: number;
  readonly palavras: number;
  readonly marca: string | null;
}

export type FabricaPortaIndice = (cliente: string) => PortaIndiceBusca;

@Injectable()
export class IndiceBuscaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoServico | null = null;
  private fabrica: FabricaPortaIndice | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private conferenciaMs = 3_600_000;
  private ultimaConferencia = 0;
  private readonly marcas = new Map<string, MarcaIndice>();

  /** Teste: o núcleo, a porta e o intervalo da conferência sem subir o banco. */
  usar(nucleo: NucleoServico, fabrica: FabricaPortaIndice, conferenciaMs = 3_600_000): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
    this.conferenciaMs = conferenciaMs;
  }

  onApplicationBootstrap(): void {
    if (!vigiaLigado(process.env)) return;
    try {
      const intervalo = lerInteiroAmbiente(process.env, 'BUSCA_VIGIA_MS', 5_000, 1_000, 600_000);
      const conferencia = lerInteiroAmbiente(process.env, 'BUSCA_CONFERENCIA_MS', 3_600_000, 60_000, 86_400_000);
      const nucleo = new NucleoProprio({ env: process.env });
      this.usar(nucleo, (cliente) => new PortaIndiceBuscaPropria(nucleo, cliente), conferencia);
      this.temporizador = setInterval(() => void this.ciclo(), intervalo);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'vigia do índice de busca não subiu');
    }
  }

  async ciclo(): Promise<ResultadoVigia[]> {
    const nucleo = this.nucleo;
    const fabrica = this.fabrica;
    if (this.rodando || !nucleo || !fabrica) return [];
    this.rodando = true;
    const r: ResultadoVigia[] = [];
    try {
      const clientes = await clientesDoWorker(nucleo, process.env, 'indice-busca');
      for (const cliente of clientes) {
        const porta = fabrica(cliente);
        for (const entidade of ENTIDADES_BUSCA) {
          try {
            const k = `${cliente}:${entidade}`;
            const marca = this.marcas.get(k) ?? { em: await porta.marcaInicial(entidade), id: 0 };
            const lidos = await porta.mudados(entidade, marca, LOTE_VIGIA);
            const palavras = await porta.indexar(entidade, lidos);
            const ultimo = lidos.at(-1);
            const nova = ultimo ? { em: ultimo.mudouEm, id: ultimo.id } : marca;
            this.marcas.set(k, nova);
            r.push({ cliente, entidade, lidos: lidos.length, palavras, marca: nova.em });
            if (lidos.length > 0)
              logger.info({ cliente, entidade, lidos: lidos.length, palavras }, 'vigia do índice de busca');
            const pacientes = entidade === 'paciente' ? lidos.filter((x) => !x.excluido).map((x) => x.id) : [];
            if (pacientes.length > 0) {
              const novos = await porta.alimentarFila(pacientes, avaliarPar);
              if (novos > 0) logger.info({ cliente, novos }, 'fila de duplicidades: pares novos');
            }
          } catch (e) {
            logger.warn({ cliente, entidade, erro: e instanceof Error ? e.name : 'erro' }, 'vigia do índice de busca: ciclo falhou');
          }
        }
      }
      await this.conferir(clientes, fabrica);
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'vigia do índice de busca: clientes indisponíveis');
    } finally {
      this.rodando = false;
    }
    return r;
  }

  /** Conferência por contagem (índice × cadastro) e reparo, no máximo uma vez por intervalo. */
  private async conferir(clientes: readonly string[], fabrica: FabricaPortaIndice): Promise<void> {
    if (Date.now() - this.ultimaConferencia < this.conferenciaMs) return;
    this.ultimaConferencia = Date.now();
    for (const cliente of clientes) {
      const porta = fabrica(cliente);
      for (const entidade of ENTIDADES_BUSCA) {
        try {
          const c = await porta.contagem(entidade);
          if (c.indice === c.cadastro) continue;
          const reparados = await porta.reparar(entidade, 1000);
          logger.warn(
            { cliente, entidade, indice: c.indice, cadastro: c.cadastro, reparados },
            'índice de busca divergia do cadastro: reparado',
          );
        } catch (e) {
          logger.warn({ cliente, entidade, erro: e instanceof Error ? e.name : 'erro' }, 'conferência do índice de busca falhou');
        }
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
