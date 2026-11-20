// Núcleo sobre a cópia do projeto para as ferramentas de leitura do M16 (indicadores:controle e datamart:carregar):
// só AMBIENTE=dev, só cópia em loopback (nunca porta de outro projeto), READ ONLY pelo chamador (DP-41). Quem chama
// encerra o núcleo.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerEstabelecimentos,
  NucleoLegado,
  PORTAS_OCUPADAS,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

const raiz = resolve(import.meta.dirname, '../../..');

export function abrirNucleoCopia(): { nucleo: NucleoLegado; codigos: string[] } {
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  if ((env['AMBIENTE']?.trim() ?? '') !== 'dev')
    throw new Error('A leitura da cópia roda só em AMBIENTE=dev (DP-41).');
  for (const e of lerEstabelecimentos(env))
    if (!['127.0.0.1', 'localhost', '::1'].includes(e.host) || PORTAS_OCUPADAS.includes(e.porta))
      throw new Error(`${e.codigo}: só cópia do projeto em loopback.`);
  const nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    aviso: () => undefined,
  });
  return { nucleo, codigos: lerCodigos(env) };
}
