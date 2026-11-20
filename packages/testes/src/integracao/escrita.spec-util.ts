// Partida comum dos testes de integração de ESCRITA do M04 sobre a cópia compartilhada: só com a trava da
// cópia (o flock da copia.lock que envolve o comando, provado em /proc/locks), AMBIENTE=dev e loopback; toda gravação
// em transação desfeita (ROLLBACK). Massa sintética marcada (../massa); saída só com contagens e códigos.
import { resolve } from 'node:path';
import { recursoDesligado } from '@sgh/contratos';
import {
  ambienteEfetivo,
  aplicarLoteLiberacao,
  caminhoArquivoAmbiente,
  type ContextoOperacao,
  type Escritor,
  type Executor,
  fonteCatalogoArquivo,
  gravarPrerequisito,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerEstabelecimentos,
  NucleoLegado,
  PORTAS_OCUPADAS,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

export const raiz = resolve(import.meta.dirname, '../../../..');
export const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
export const codigos = lerCodigos(env);
/**
 * A trava da cópia é DESTE processo (ou de um ancestral: o flock que envolve o comando)? Conferida em
 * /proc/locks e na cadeia de processos pais (a mesma prova do sgh:aplicar e do assinatura:*). O teste antigo
 * (`flock -n` sai 1) dava verdadeiro sempre que ALGUÉM segurava a trava, inclusive outro marco.
 */
export const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);
if (!PODE_ESCREVER) {
  console.warn(
    '[integração M04] gravações na cópia não executadas: rode sob o flock da trava da cópia (copia.lock).',
  );
}

export const CATALOGO = resolve(raiz, 'docs/operacoes/catalogo');

function conferirAlvos(e: Record<string, string | undefined>): void {
  if ((e['AMBIENTE']?.trim() || 'dev') !== 'dev') throw new Error('Integração só em AMBIENTE=dev.');
  for (const x of lerEstabelecimentos(e)) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(x.host) || PORTAS_OCUPADAS.includes(x.porta)) {
      throw new Error(`${x.codigo}: só a cópia do projeto em loopback.`);
    }
  }
}

export function criarNucleo(extra: Record<string, string> = {}): NucleoLegado {
  const e = { ...env, ...extra };
  conferirAlvos(e);
  return new NucleoLegado({
    env: e,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(e).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
}

export interface Ambiente {
  readonly nucleo: NucleoLegado;
  readonly executor: Executor;
  readonly cod: string;
}

export async function prepararAmbiente(extra: Record<string, string> = {}): Promise<Ambiente> {
  const nucleo = criarNucleo({ FB_POOL_TETO: '3', ...extra });
  const cod = codigos[0] as string;
  await nucleo.verificarSchema(cod);
  return { nucleo, executor: nucleo.criarExecutor({ catalogo: fonteCatalogoArquivo(CATALOGO) }), cod };
}

export const ctx = (a: Ambiente) => ({ rede: a.nucleo.rede, hospital: a.cod, traceId: 'integracao-m04' });

let seq = 0;
export function ctxOperacao(a: Ambiente, usuario: string, chave?: string): ContextoOperacao {
  return {
    ...ctx(a),
    usuarioLegado: usuario,
    idempotencyKey: chave ?? `int-m04-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    reautenticadoEm: Date.now(),
  };
}

export const num = (v: unknown): number => Number(v ?? NaN);

/** Contagem numa transação. */
export async function contar(
  e: Pick<Escritor, 'consultar'>,
  sql: string,
  p: readonly unknown[] = [],
): Promise<number> {
  const [r] = await e.consultar(sql, p, { teto: 1 });
  return num(r?.['N']);
}

/**
 * M61 (liberação full na instalação; ADR 0034): a cópia de dev pode estar com as chaves ligadas pelo
 * `pnpm liberacao:ligar-tudo` e os pré-requisitos dispensados. O teste que parte do "sem decisão" (nenhuma linha da chave
 * decide e os pré-requisitos declarados pendentes) o monta NA PRÓPRIA transação desfeita: as linhas da chave passam a
 * herdar (nula) e os pré-requisitos voltam a pendente. Nada fica na cópia.
 */
export async function partirSemDecisao(
  e: Escritor,
  p: {
    readonly rede: string;
    readonly hospital: string;
    readonly chave: string;
    readonly tipo?: 'recurso' | 'operacao';
  },
): Promise<void> {
  const tipo = p.tipo ?? 'recurso';
  const trilha = {
    rede: p.rede,
    hospital: p.hospital,
    usuario: 'SGH.TESTE',
    evento: 'config.liberacao.alterada',
    recurso: 'config.liberacao',
    operacao: 'int.partirSemDecisao',
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: 'SGH-TESTE:integracao',
    correlacao: 'integracao-m61-sem-decisao',
  };
  await aplicarLoteLiberacao(
    e,
    {
      hospital: p.hospital,
      tipo,
      chave: p.chave,
      planejar: ({ chaves }) =>
        chaves
          .filter((c) => c.ligada !== null)
          .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: null, antes: c.ligada })),
      justificativa: 'SGH integração: parte sem decisão (transação desfeita)',
      autor: 'SGH.TESTE',
    },
    trilha,
  );
  if (tipo !== 'recurso') return;
  for (const t of new Set((recursoDesligado(p.chave)?.prerequisitos ?? []).map((d) => d.tipo)))
    await gravarPrerequisito(
      e,
      {
        hospital: p.hospital,
        recurso: p.chave,
        tipo: t,
        situacao: 'pendente',
        validade: null,
        evidencia: null,
        autor: 'SGH.TESTE',
      },
      { ...trilha, evento: 'config.prerequisito.registrado' },
    );
}
