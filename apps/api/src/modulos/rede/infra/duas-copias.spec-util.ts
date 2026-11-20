// Partida dos testes de integração do MPI da Rede (M57, etapa 1) sobre as DUAS cópias de dev (3351 e 3352) como dois
// estabelecimentos da rede (R1 do preparo: as duas cópias são o mesmo banco, então o cadastro X de um é a mesma pessoa
// do cadastro X do outro). O segundo estabelecimento é o código SINTÉTICO `sx`, com a conexão do `pc` na porta da
// segunda cópia (SGH_INT_REDE_PORTA2), e só existe neste processo. Só com as DUAS travas (copia.lock e
// copia2/copia.lock) e AMBIENTE=dev; toda gravação em transação DESFEITA, uma por banco. Nenhum dado de pessoa sai daqui:
// só IDs em memória, contagens e situações.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  type Escritor,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  somenteSgh,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const PORTA2 = Number(process.env['SGH_INT_REDE_PORTA2'] ?? '');
export const SEGUNDO = 'sx';
/** As duas cópias, com as travas deste processo (ou de um ancestral). */
export const DUAS_COPIAS =
  lerCodigos(env).includes('pc') &&
  Number.isInteger(PORTA2) &&
  PORTA2 > 0 &&
  PORTA2 !== Number(env['FB_PC_PORTA']) &&
  travaDaCopiaSegura(process.pid);

export interface AmbienteDuasCopias {
  readonly nucleo: NucleoLegado;
  readonly rede: string;
}

export async function ambienteDuasCopias(): Promise<AmbienteDuasCopias> {
  const doSegundo: Record<string, string> = {};
  for (const [k, v] of Object.entries(env))
    if (k.startsWith('FB_PC_') && v !== undefined) doSegundo[`FB_${SEGUNDO.toUpperCase()}_${k.slice(6)}`] = v;
  doSegundo[`FB_${SEGUNDO.toUpperCase()}_PORTA`] = String(PORTA2);
  const e = { ...env, ...doSegundo, ESTABELECIMENTOS: `pc,${SEGUNDO}`, FB_POOL_TETO: '3' };
  const nucleo = new NucleoLegado({
    env: e,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(e).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema('pc');
  return { nucleo, rede: nucleo.rede };
}

/** Uma transação DESFEITA em cada banco, abertas juntas (nenhuma cruza os bancos), com o escritor só SGH_. */
export function emDuasTransacoesDesfeitas<T>(
  a: AmbienteDuasCopias,
  fn: (transacoes: ReadonlyMap<string, Escritor>) => Promise<T>,
): Promise<T> {
  return a.nucleo.desfazendoNaCopia({ rede: a.rede, hospital: 'pc', traceId: 'int-m57-pc' }, (e1) =>
    a.nucleo.desfazendoNaCopia({ rede: a.rede, hospital: SEGUNDO, traceId: 'int-m57-sx' }, (e2) =>
      fn(
        new Map([
          ['pc', somenteSgh(e1)],
          [SEGUNDO, somenteSgh(e2)],
        ]),
      ),
    ),
  );
}
