// Acesso de leitura à cópia para o `permissoes:verificar` (M06): .env.sante do repositório, só AMBIENTE=dev,
// só cópia em loopback (nunca a porta da sante-api), driver nativo pelo @sgh/legado. Transação READ ONLY;
// nada é gravado. Sem cópia configurada (CI), quem chama usa o retrato versionado.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerEstabelecimentos,
  lerGruposLegado,
  lerModulosLegado,
  lerOpcoesLegado,
  lerPermissoesGrupos,
  lerPermissoesPapeis,
  NucleoLegado,
  PORTAS_OCUPADAS,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import type { RetratoAcessoLegado } from './permissoes-dados.ts';
import { faixaContagem } from './permissoes-dados.ts';

const raiz = resolve(import.meta.dirname, '../../..');

/** Códigos configurados em AMBIENTE=dev com cópia em loopback; [] quando não há cópia (CI, clone). */
export function codigosDaCopia(): { codigos: string[]; env: Record<string, string | undefined> } | null {
  let env: Record<string, string | undefined>;
  try {
    env = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz)).env;
  } catch {
    return null;
  }
  if ((env['AMBIENTE']?.trim() ?? '') !== 'dev') return null;
  for (const e of lerEstabelecimentos(env)) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(e.host) || PORTAS_OCUPADAS.includes(e.porta)) return null;
  }
  return { codigos: lerCodigos(env), env };
}

/** Lê da cópia o retrato do acesso do legado (metadado e configuração; contagens em faixas). */
export async function retratarDaCopia(
  env: Record<string, string | undefined>,
  codigo: string,
): Promise<RetratoAcessoLegado> {
  const nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    aviso: () => undefined,
  });
  try {
    const ctx = { rede: nucleo.rede, hospital: codigo, traceId: 'permissoes-verificar' };
    return await nucleo.lerSomente(ctx, async (l) => {
      const grupos = await lerGruposLegado(l);
      return {
        formato: 1,
        estabelecimento: codigo,
        modulos: await lerModulosLegado(l),
        opcoes: await lerOpcoesLegado(l),
        grupos: grupos.map((g) => ({
          nome: g.nome,
          ativo: g.ativo,
          usuariosAtivos: faixaContagem(g.usuariosAtivos),
        })),
        permissoesGrupos: (await lerPermissoesGrupos(l)).map((p) => [p.grupo, p.opcao] as const),
        permissoesPapeis: (await lerPermissoesPapeis(l)).map((p) => [p.papel, p.opcao] as const),
      };
    });
  } finally {
    await nucleo.encerrar();
  }
}
