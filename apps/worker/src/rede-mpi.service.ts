// MPI da Rede no `worker` (M57, etapa 1; ficha, seção 4 e regra 4; lote F2.2 05-16): de madrugada (janela noturna, fora
// do pico), por cliente, o pareamento dos cadastros entre os estabelecimentos em lotes (a mesma orquestração da tela,
// @sgh/dominio-rede) e o relatório de divergência com o reparo. Só os estabelecimentos com a chave `rede.mpi` ligada
// para o estabelecimento inteiro e os pré-requisitos cumpridos (POL-3), e só com dois ou mais. Além da chave, o worker
// só roda com REDE_MPI_NOTURNO=ligado. Log só com contagens.
// Um banco por cliente: os estabelecimentos moram no mesmo banco e o par suspeito é a linha de `suspeita_duplicidade`
// (a mesma fila do cadastro). O adaptador do índice sobre o banco próprio é o da API (apps/api/src/modulos/rede: a
// PortaRedePropria e o `indice()` do serviço); os apps não se importam, então o worker recebe a porta por uma fábrica.
// PENDÊNCIA (saida/05-16.json): mover o adaptador do índice para um pacote comum e ligá-lo aqui; até lá, com
// REDE_MPI_NOTURNO=ligado o serviço avisa no log que o pareamento noturno está indisponível no worker (o pareamento pela
// tela continua).
// Melhoria: os estabelecimentos vêm do banco do cliente (sem lista de bancos com scripts aplicados); a chave é lida pela
// porta própria (liberacao_chave e recurso_prerequisito) e o banco que não responde fica fora (falha fechada).
import { randomUUID } from 'node:crypto';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CHAVE_LIBERACAO_MPI_REDE, EVENTOS_AUDITAVEIS, recursoDesligado } from '@sgh/contratos';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { cicloPareamentoRede, divergenciasRede, type PortaIndiceRede, repararIndiceRede } from '@sgh/dominio-rede';
import { type Leitor, NucleoProprio } from '@sgh/nucleo';
import { clientesDoWorker, codigosDosEstabelecimentos } from './clientes-worker.js';
import { lerChavesLiberacao, lerPrerequisitos } from './integracao/porta-propria.js';
import { logger } from './logger.js';

/** Quem o pareamento automático registra como autor (processo do worker). */
export const USUARIO_REDE = 'worker.rede';
/** Lote noturno por estabelecimento e ciclo e o teto de ciclos por noite. */
export const LOTE_NOTURNO_REDE = 2000;
export const CICLOS_POR_NOITE_REDE = 30;
/** Janela noturna (hora local do servidor): começa às 2 h. */
export const HORA_NOTURNA_REDE = 2;

export function noturnoLigado(env: NodeJS.ProcessEnv): boolean {
  return (env['REDE_MPI_NOTURNO'] ?? '').trim() === 'ligado';
}

export interface ResumoNoite {
  readonly ciclos: number;
  readonly lidos: number;
  readonly automaticos: number;
  readonly naFila: number;
  readonly divergencias: number;
  readonly reparados: number;
  readonly manuais: number;
}

/** Uma noite: ciclos em lote até ler tudo (ou o teto) e o relatório de divergência com o reparo. */
export async function noiteDaRede(
  porta: PortaIndiceRede,
  ests: readonly string[],
  o: { lote?: number; ciclos?: number; agora?: () => Date } = {},
): Promise<ResumoNoite> {
  const agora = o.agora ?? (() => new Date());
  let ciclos = 0;
  let lidos = 0;
  let automaticos = 0;
  let naFila = 0;
  const antes = new Map<string, number>();
  for (const e of ests) antes.set(e, (await porta.marca(e))?.ultimoId ?? 0);
  for (; ciclos < (o.ciclos ?? CICLOS_POR_NOITE_REDE); ) {
    const r = await cicloPareamentoRede(porta, ests, {
      lote: o.lote ?? LOTE_NOTURNO_REDE,
      por: USUARIO_REDE,
      em: agora().toISOString(),
      usuarioAutomatico: USUARIO_REDE,
      novaPessoa: () => randomUUID(),
      eventoCiclo: EVENTOS_AUDITAVEIS.redeFilaAtualizada.codigo,
      aviso: (m) => logger.warn({}, m),
    });
    ciclos++;
    lidos += r.lidos;
    automaticos += r.automaticos;
    naFila += r.naFila;
    // Nenhuma marca andou (só os alterados desde o carimbo, ou nada): a carga por ID terminou nesta noite.
    const andou = r.marcas.some((m) => m.ultimoId > (antes.get(m.estabelecimento) ?? 0));
    for (const m of r.marcas) antes.set(m.estabelecimento, m.ultimoId);
    if (!andou) break;
  }
  const divergencias = (await divergenciasRede(porta, ests)).length;
  const reparo =
    divergencias > 0
      ? await repararIndiceRede(porta, ests, EVENTOS_AUDITAVEIS.redeIndiceReparado.codigo, (m) => logger.warn({}, m))
      : { reparados: 0, pendentes: 0, manuais: [] };
  return {
    ciclos,
    lidos,
    automaticos,
    naFila,
    divergencias,
    reparados: reparo.reparados,
    manuais: reparo.manuais.length,
  };
}

/** Os estabelecimentos do MPI: os do cliente, ou só os de REDE_MPI_ESTABELECIMENTOS quando a lista vier. */
export function estabelecimentosDoMpi(env: NodeJS.ProcessEnv, doCliente: readonly string[]): string[] {
  const lista = (env['REDE_MPI_ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return lista.length === 0 ? [...doCliente] : doCliente.filter((c) => lista.includes(c));
}

export interface NucleoLeituraRede {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
}

/**
 * A chave `rede.mpi` de cada estabelecimento (liberacao_chave e os pré-requisitos): só os ligados para o estabelecimento
 * inteiro, com os pré-requisitos cumpridos, ficam. Leitura que falha deixa o estabelecimento fora (falha fechada).
 */
export async function estabelecimentosLiberadosMpi(
  nucleo: NucleoLeituraRede,
  cliente: string,
  ests: readonly string[],
  agora: Date = new Date(),
): Promise<string[]> {
  const declarados = recursoDesligado(CHAVE_LIBERACAO_MPI_REDE)?.prerequisitos ?? [];
  const r: string[] = [];
  for (const est of ests) {
    const ligada = await nucleo
      .lerSomente({ cliente, correlacao: 'rede-mpi-noturno' }, async (l) => {
        const chaves = (await lerChavesLiberacao(l, est, CHAVE_LIBERACAO_MPI_REDE))
          .filter((c) => c.tipo === 'recurso' && c.ligada !== null)
          .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
        const registrados = await lerPrerequisitos(l, est, CHAVE_LIBERACAO_MPI_REDE);
        return recursoLigadoNoEstabelecimento(
          chaves as Parameters<typeof recursoLigadoNoEstabelecimento>[0],
          declarados,
          registrados as unknown as Parameters<typeof recursoLigadoNoEstabelecimento>[2],
          agora,
        );
      })
      .catch(() => false);
    if (ligada === true) r.push(est);
  }
  return r;
}

export interface NucleoRede extends NucleoLeituraRede {
  lerPlataforma: NucleoProprio['lerPlataforma'];
  encerrar(): Promise<void>;
}

/** A porta do índice sobre o banco do cliente (a fábrica vem do adaptador comum; ver a pendência no cabeçalho). */
export type FabricaPortaIndice = (cliente: string) => PortaIndiceRede;

@Injectable()
export class RedeMpiService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoRede | null = null;
  private fabrica: FabricaPortaIndice | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private ultimaNoite = '';

  /** Teste (e a ligação do adaptador comum): o núcleo e a fábrica da porta do índice. */
  usar(nucleo: NucleoRede, fabrica: FabricaPortaIndice | null): void {
    this.nucleo = nucleo;
    this.fabrica = fabrica;
  }

  onApplicationBootstrap(): void {
    if (!noturnoLigado(process.env)) return;
    logger.error(
      { pendencia: 'f22-05-16-indice-rede' },
      'MPI da Rede noturno indisponível no worker: o adaptador do índice sobre o banco próprio ainda não está num pacote comum (o pareamento pela tela continua)',
    );
  }

  /** Roda uma vez por noite, na janela noturna (a primeira verificação depois das 2 h). */
  async talvez(agora: Date): Promise<ResumoNoite[] | null> {
    const dia = `${agora.getFullYear()}-${agora.getMonth() + 1}-${agora.getDate()}`;
    if (agora.getHours() < HORA_NOTURNA_REDE || agora.getHours() >= 6 || this.ultimaNoite === dia) return null;
    this.ultimaNoite = dia;
    return this.noite();
  }

  async noite(): Promise<ResumoNoite[] | null> {
    const nucleo = this.nucleo;
    if (this.rodando || !nucleo) return null;
    this.rodando = true;
    const r: ResumoNoite[] = [];
    try {
      for (const cliente of await clientesDoWorker(nucleo, process.env, 'rede-mpi-noturno')) {
        try {
          const doCliente = await nucleo.lerSomente(
            { cliente, correlacao: 'rede-mpi-noturno' },
            codigosDosEstabelecimentos,
          );
          const ests = await estabelecimentosLiberadosMpi(nucleo, cliente, estabelecimentosDoMpi(process.env, doCliente));
          if (ests.length < 2) {
            logger.info(
              { cliente, estabelecimentos: ests.length },
              'MPI da Rede: menos de dois estabelecimentos com a funcionalidade liberada; nada a parear',
            );
            continue;
          }
          if (!this.fabrica) {
            logger.error({ cliente, pendencia: 'f22-05-16-indice-rede' }, 'MPI da Rede: porta do índice indisponível no worker');
            continue;
          }
          const x = await noiteDaRede(this.fabrica(cliente), ests);
          r.push(x);
          logger.info({ cliente, ...x }, 'MPI da Rede: noite concluída');
        } catch (e) {
          logger.warn({ cliente, erro: e instanceof Error ? e.name : 'erro' }, 'MPI da Rede: noite falhou');
        }
      }
      return r;
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'MPI da Rede: clientes indisponíveis');
      return null;
    } finally {
      this.rodando = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.nucleo?.encerrar();
  }
}
