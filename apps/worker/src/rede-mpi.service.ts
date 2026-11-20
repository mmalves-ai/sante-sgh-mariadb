// MPI da Rede no `worker` (M57, etapa 1; ficha, seção 4 e regra 4): de madrugada (janela noturna, fora do pico), a carga
// dos cadastros em lotes por banco (a mesma orquestração da tela, @sgh/dominio-rede: lotes por ID acima da marca d'água
// e os alterados desde o último carimbo, candidatos procurados em cada outro banco, nunca junção entre bancos) e, em
// seguida, o relatório diário de divergência entre os índices com o reparo idempotente. Uma transação SGH_ por banco,
// com a trilha junto; nenhuma tabela do cadastro é gravada (regra 1). Só os estabelecimentos da rede configurados com
// os scripts SGH_REDE_* aplicados (HS-1: o do catálogo) E com a chave `rede.mpi` ligada para o estabelecimento inteiro,
// com os pré-requisitos dele cumpridos (POL-3; a mesma regra da API, lida no banco de cada um a cada noite), e só com
// dois ou mais. Além da chave, o worker só roda com REDE_MPI_NOTURNO=ligado. Log só com contagens.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CHAVE_LIBERACAO_MPI_REDE, EVENTOS_AUDITAVEIS, recursoDesligado } from '@sgh/contratos';
import { CATALOGO_LEGADO_ORIGEM } from '@sgh/contratos/catalogo-legado';
import { recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import {
  cicloPareamentoRede,
  divergenciasRede,
  type GravadorIndiceRede,
  type PortaIndiceRede,
  repararIndiceRede,
} from '@sgh/dominio-rede';
import {
  executarEscritasIndiceRede,
  gravarCandidatosRede,
  gravarMarcaRede,
  gravarParesDuplicidade,
  gravarTrilha,
  lerCadastrosAlteradosRede,
  lerCadastrosRedePorIds,
  lerChavesLiberacao,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerLoteCadastrosRede,
  lerLoteVinculosRede,
  lerMarcaRede,
  lerPrerequisitos,
  NucleoLegado,
  pessoasDosCadastrosRede,
  procurarCandidatosRede,
  situacoesCandidatosRede,
  somenteSgh,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { logger } from './logger.js';

export const USUARIO_REDE = 'SGH.REDE';
/** Lote noturno por banco e ciclo (o teto do repositório) e o teto de ciclos por noite. */
export const LOTE_NOTURNO_REDE = 2000;
export const CICLOS_POR_NOITE_REDE = 30;
/** Janela noturna (hora local do servidor): começa às 2 h. */
export const HORA_NOTURNA_REDE = 2;

export function noturnoLigado(env: NodeJS.ProcessEnv): boolean {
  return (env['REDE_MPI_NOTURNO'] ?? '').trim() === 'ligado';
}

export type NucleoRede = Pick<NucleoLegado, 'lerSomente' | 'gravarSgh' | 'rede' | 'encerrar'>;

/** A porta do domínio sobre o núcleo: cada chamada lê ou grava SÓ no banco do estabelecimento dado. */
export function portaIndiceNucleo(nucleo: NucleoRede): PortaIndiceRede {
  const ctx = (est: string) => ({ rede: nucleo.rede, hospital: est, traceId: 'rede-mpi-noturno' });
  const ler = <T>(est: string, fn: Parameters<NucleoRede['lerSomente']>[1]) =>
    nucleo.lerSomente(ctx(est), fn) as Promise<T>;
  return {
    marca: (est) => ler(est, (l) => lerMarcaRede(l)),
    loteCadastros: (est, depois, n) => ler(est, (l) => lerLoteCadastrosRede(l, depois, n)),
    cadastrosAlterados: (est, desde, depois, n) =>
      ler(est, (l) => lerCadastrosAlteradosRede(l, desde, depois, n)),
    procurarCandidatos: (est, ch) => ler(est, (l) => procurarCandidatosRede(l, ch)),
    cadastrosPorIds: (est, ids) => ler(est, (l) => lerCadastrosRedePorIds(l, ids)),
    situacoes: (est, chaves) => ler(est, (l) => situacoesCandidatosRede(l, chaves)),
    pessoasDosCadastros: (est, ids) => ler(est, (l) => pessoasDosCadastrosRede(l, ids)),
    loteVinculos: (est, depois, n) => ler(est, (l) => lerLoteVinculosRede(l, depois, n)),
    gravar: (est, fn, rot) =>
      nucleo.gravarSgh(ctx(est), async (e0) => {
        const e = somenteSgh(e0);
        const g: GravadorIndiceRede = {
          escritas: (ws) => executarEscritasIndiceRede(e, ws),
          candidatos: (cs) => gravarCandidatosRede(e, cs),
          marca: (m, por) => gravarMarcaRede(e, m, por),
          duplicidadesLocais: (pares) => gravarParesDuplicidade(e, est, pares),
        };
        const r = await fn(g);
        await gravarTrilha(e, {
          rede: nucleo.rede,
          hospital: est,
          usuario: USUARIO_REDE,
          evento: rot.evento,
          recurso: 'rede.mpi',
          operacao: rot.operacao,
          tabelaAlvo: 'SGH_REDE_VINCULO',
          idAlvo: rot.pessoa,
          chaveNaturalAlvo: rot.chave.slice(0, 80),
          resultado: 'sucesso',
          estacao: 'SGH-WORKER:rede',
          correlacao: `rede-noturno-${rot.operacao}`.slice(0, 64),
          origem: 'SGH-WORKER:rede',
        });
        return r;
      }),
  };
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
  for (; ciclos < (o.ciclos ?? CICLOS_POR_NOITE_REDE);) {
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
      ? await repararIndiceRede(porta, ests, EVENTOS_AUDITAVEIS.redeIndiceReparado.codigo, (m) =>
          logger.warn({}, m),
        )
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

/** Os estabelecimentos do MPI no worker: os configurados que têm os scripts do índice (HS-1: o do catálogo). */
export function estabelecimentosDoMpi(env: NodeJS.ProcessEnv): string[] {
  const liberados = new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]);
  const extra = (env['REDE_MPI_ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const x of extra) liberados.add(x);
  return lerCodigos(env).filter((c) => liberados.has(c));
}

/**
 * A chave `rede.mpi` de cada estabelecimento, lida no banco DELE (SGH_CFG_LIBERACAO e os pré-requisitos): só os ligados
 * para o estabelecimento inteiro, com os pré-requisitos cumpridos, ficam. Banco que não responde fica fora (falha
 * fechada).
 */
export async function estabelecimentosLiberadosMpi(
  nucleo: Pick<NucleoRede, 'lerSomente' | 'rede'>,
  ests: readonly string[],
  agora: Date = new Date(),
): Promise<string[]> {
  const declarados = recursoDesligado(CHAVE_LIBERACAO_MPI_REDE)?.prerequisitos ?? [];
  const r: string[] = [];
  for (const est of ests) {
    const ligada = await Promise.resolve()
      .then(() =>
        nucleo.lerSomente({ rede: nucleo.rede, hospital: est, traceId: 'rede-mpi-noturno' }, async (l) => {
          const chaves = (await lerChavesLiberacao(l, est))
            .filter((c) => c.chave === CHAVE_LIBERACAO_MPI_REDE && c.tipo === 'recurso' && c.ligada !== null)
            .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
          const registrados = (await lerPrerequisitos(l, est)).filter(
            (p) => p.recurso === CHAVE_LIBERACAO_MPI_REDE,
          );
          return recursoLigadoNoEstabelecimento(chaves, declarados, registrados, agora);
        }),
      )
      .catch(() => false);
    if (ligada === true) r.push(est);
  }
  return r;
}

@Injectable()
export class RedeMpiService implements OnApplicationBootstrap, OnApplicationShutdown {
  private nucleo: NucleoRede | null = null;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private ultimaNoite = '';

  /** Teste: o núcleo sem subir o driver. */
  usar(nucleo: NucleoRede): void {
    this.nucleo = nucleo;
  }

  onApplicationBootstrap(): void {
    if (!noturnoLigado(process.env)) return;
    try {
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
      this.temporizador = setInterval(() => void this.talvez(new Date()), 10 * 60_000);
      this.temporizador.unref();
    } catch (e) {
      logger.error({ erro: e instanceof Error ? e.message : 'erro' }, 'MPI da Rede noturno não subiu');
    }
  }

  /** Roda uma vez por noite, na janela noturna (a primeira verificação depois das 2 h). */
  async talvez(agora: Date): Promise<ResumoNoite | null> {
    const dia = `${agora.getFullYear()}-${agora.getMonth() + 1}-${agora.getDate()}`;
    if (agora.getHours() < HORA_NOTURNA_REDE || agora.getHours() >= 6 || this.ultimaNoite === dia)
      return null;
    this.ultimaNoite = dia;
    return this.noite();
  }

  async noite(): Promise<ResumoNoite | null> {
    if (this.rodando || !this.nucleo) return null;
    this.rodando = true;
    try {
      const ests = await estabelecimentosLiberadosMpi(this.nucleo, estabelecimentosDoMpi(process.env));
      if (ests.length < 2) {
        logger.info(
          { estabelecimentos: ests.length },
          'MPI da Rede: menos de dois estabelecimentos com a funcionalidade liberada; nada a parear',
        );
        return null;
      }
      const r = await noiteDaRede(portaIndiceNucleo(this.nucleo), ests);
      logger.info({ ...r }, 'MPI da Rede: noite concluída');
      return r;
    } catch (e) {
      logger.warn({ erro: e instanceof Error ? e.name : 'erro' }, 'MPI da Rede: noite falhou');
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
