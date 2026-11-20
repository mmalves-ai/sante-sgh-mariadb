// Partida comum dos testes de integração do M27 na API sobre a cópia compartilhada: só com a trava da cópia, AMBIENTE=dev
// e loopback; toda gravação em transação DESFEITA (ROLLBACK). Os logins e os pacientes da cópia ficam só em memória
// (nunca impressos); a saída é só de contagens e tempos.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  type Executor,
  fonteCatalogoArquivo,
  type Leitor,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
export const codigos = lerCodigos(env);
export const NA_COPIA = codigos.length > 0;
/** A trava da cópia é deste processo (ou de um ancestral): sem ela, nenhuma gravação na cópia. */
export const PODE_ESCREVER = NA_COPIA && travaDaCopiaSegura(process.pid);
export const caminhoCatalogo = resolve(raiz, 'docs/operacoes/catalogo');

export interface AmbienteM27 {
  readonly nucleo: NucleoLegado;
  readonly executor: Executor;
  readonly cod: string;
  readonly c: { rede: string; hospital: string };
}

export async function ambienteM27(): Promise<AmbienteM27> {
  const nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const cod = codigos[0] as string;
  await nucleo.verificarSchema(cod);
  return {
    nucleo,
    executor: nucleo.criarExecutor({ catalogo: fonteCatalogoArquivo(caminhoCatalogo) }),
    cod,
    c: { rede: nucleo.rede, hospital: cod },
  };
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/** Dois usuários ativos da cópia (só em memória) e um grupo com usuários ativos. */
export async function usuariosAtivos(
  l: Leitor,
): Promise<{ a: string; b: string; grupo: string; doGrupo: number }> {
  const us = await l.consultar(
    "SELECT FIRST 2 NOME FROM TBUSERS WHERE STATUS = 'T' AND BLOQUEADO = 'F' AND GRUPO IS NOT NULL ORDER BY ID_TBUSERS DESC",
    [],
    { teto: 2 },
  );
  const [g] = await l.consultar(
    `SELECT FIRST 1 GRUPO, COUNT(*) N FROM TBUSERS WHERE STATUS = 'T' AND BLOQUEADO = 'F' AND GRUPO IS NOT NULL
      GROUP BY GRUPO HAVING COUNT(*) BETWEEN 2 AND 200 ORDER BY 2`,
    [],
    { teto: 1 },
  );
  if (us.length < 2 || !g) throw new Error('A cópia não tem usuários ativos suficientes.');
  return {
    a: txt(us[0]?.['NOME']),
    b: txt(us[1]?.['NOME']),
    grupo: txt(g['GRUPO']),
    doGrupo: Number(g['N']),
  };
}

/** Percentil (0 a 100) dos tempos. */
export function percentil(xs: readonly number[], p: number): number {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)] ?? 0;
}
