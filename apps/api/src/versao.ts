import type { Versao } from '@sgh/contratos';

export interface DadosDeBuild {
  readonly versao: string;
  readonly commit: string | null;
  readonly construidoEm: string;
}

/** Dados gravados no build (vite.config.ts); fora do build (testes), versão de desenvolvimento. */
export function dadosDoBuild(agora: Date = new Date()): DadosDeBuild {
  return {
    versao: typeof __SGH_VERSAO__ === 'string' ? __SGH_VERSAO__ : '0.0.0-dev',
    commit: typeof __SGH_COMMIT__ === 'string' ? __SGH_COMMIT__ : null,
    construidoEm: typeof __SGH_CONSTRUIDO_EM__ === 'string' ? __SGH_CONSTRUIDO_EM__ : agora.toISOString(),
  };
}

/**
 * Identificação rastreável (cap-14 §14.10): `<versão>+<commit>` ou, sem git, `<versão>+build.<carimbo>` (carimbo: data e hora UTC em 14 dígitos, ano a segundo).
 */
export function identificar(dados: DadosDeBuild): string {
  if (dados.commit) return `${dados.versao}+${dados.commit}`;
  const carimbo = dados.construidoEm.replace(/[-:T]/g, '').slice(0, 14);
  return `${dados.versao}+build.${carimbo}`;
}

export function montarVersao(produto: string, dados: DadosDeBuild): Versao {
  return { produto, ...dados, identificacao: identificar(dados) };
}

/**
 * Commit do build: o hash curto, com `-dirty` quando a árvore tinha alteração não commitada
 * (`git status --porcelain` não vazio), para um build sujo nunca se passar por um build limpo.
 */
export function marcarCommit(hash: string, porcelana: string): string | null {
  const curto = hash.trim();
  if (!curto) return null;
  return porcelana.trim() ? `${curto}-dirty` : curto;
}
