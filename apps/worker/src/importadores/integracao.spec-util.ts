// Partida dos testes de integração do publicador de catálogos na cópia compartilhada (M13): só com a trava da
// cópia (flock da copia.lock, provado em /proc/locks), AMBIENTE=dev e loopback; tudo numa transação desfeita.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  type Escritor,
  fonteCatalogoArquivo,
  gravarCargaCatalogo,
  lerCodigos,
  lerConfiguracaoNucleo,
  mudarSituacaoCargaCatalogo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { JANELA_PADRAO } from '@sgh/dominio-catalogo';
import type { DependenciasPublicador } from './publicador.js';

export const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
export const codigos = lerCodigos(env);
export const PODE_ESCREVER =
  codigos.length > 0 && (env['AMBIENTE'] ?? 'dev').trim() === 'dev' && travaDaCopiaSegura(process.pid);

export function criarNucleo(): NucleoLegado {
  return new NucleoLegado({
    env: { ...env, SGH_DEV_PERMITIR_SYSDBA: 'sim', FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
}

/** O publicador sobre o escritor da transação desfeita. */
export function dependencias(n: NucleoLegado, e: Escritor, hospital: string): DependenciasPublicador {
  return {
    rede: n.rede,
    hospital,
    executor: n.criarExecutor({
      catalogo: fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo')),
    }),
    ler: (fn) => fn(e),
    gravarSgh: (fn) => fn(e),
    janela: JANELA_PADRAO,
    agoraMinutos: () => 23 * 60,
    ignorarJanela: false,
    lotesPorCiclo: 5,
    escritor: e,
  };
}

/** Carga aprovada de 1 lote com as linhas dadas (na transação desfeita). */
export async function cargaAprovada(
  e: Escritor,
  hospital: string,
  rede: string,
  catalogo: string,
  edicao: string | null,
  linhas: {
    entidade: string;
    chave: string;
    comparacao: 'novo' | 'alterado';
    depois: Record<string, string | number | null>;
  }[],
): Promise<number> {
  const t = {
    rede,
    hospital,
    usuario: 'SGH.M13',
    evento: 'catalogo.carga.preparada',
    recurso: 'catalogo.carga',
    operacao: 'catalogo.carga.preparar',
    chaveNaturalAlvo: null,
    resultado: 'sucesso',
    estacao: null,
    correlacao: 'integracao-m13',
  };
  const { id } = await gravarCargaCatalogo(
    e,
    {
      hospital,
      catalogo,
      arquivo: 'SGH M13.txt',
      sha256: 'ab'.repeat(32),
      bytes: 1,
      arquivoS3: null,
      situacao: 'comparada',
      edicao,
      responsavel: 'SGH.M13',
      motivo: null,
      totais: {
        linhas: linhas.length,
        validas: linhas.length,
        erros: 0,
        novos: 0,
        removidos: 0,
        alterados: 0,
        iguais: 0,
      },
      lotes: { total: 1, tamanho: 500 },
      linhas: linhas.map((l, i) => ({
        linha: i + 1,
        ...l,
        resultado: 'valida',
        antes: null,
        motivo: null,
        lote: 1,
      })),
    },
    t,
  );
  await mudarSituacaoCargaCatalogo(
    e,
    { hospital, id, versao: 1, de: ['comparada'], para: 'aprovada', aprovador: 'SGH.M13', motivo: null },
    t,
  );
  return id;
}
