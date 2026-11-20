// M60, etapa 2: o artefato de release (D-PACOTE-60.2). Um .tar.gz por versão, construído no Ubuntu 24.04 descartável com
// `pnpm install --frozen-lockfile` e os builds da api, do worker e das telas, depois podado para as dependências de
// produção (`pnpm install --prod --frozen-lockfile --offline`). Leva o Node fixado (binário oficial conferido pelo
// SHASUMS256) para o servidor não depender de rede nem de pacote do Node. O manifesto lista cada arquivo com o sha256 e
// o hash do conjunto; o instalador confere o .tar.gz pelo .sha256 ao lado e o manifesto depois de desempacotar.
import { createHash } from 'node:crypto';

/** Versão do Node fixada no pacote (a mesma do ambiente da obra, tools/ambiente.sh). */
export const NODE_VERSAO = '24.22.0';

/**
 * O que entra no pacote, relativo à raiz do repositório. A API e o worker leem em tempo de execução arquivos da árvore
 * (catálogo das operações, scripts SGH_ para a conferência, registros em docs/, impressões homologadas), e a migração
 * (`sgh:aplicar`) roda das fontes: vai a árvore de produção inteira, sem o que é só da obra.
 */
export const CONTEUDO_PACOTE: readonly string[] = [
  'apps/api/dist',
  'apps/worker/dist',
  'apps/web/dist',
  'packages',
  'tools/schema-check',
  'tools/verificadores/src/caminhos-sgh.ts',
  'tools/matriz/dados',
  'tools/assinatura/resultados',
  'tools/instalacao',
  'docs/operacoes',
  'docs/coexistencia',
  'docs/homologacao',
  'docs/prontidao',
  'docs/implantacao',
  'respostas',
  'planejamento/ESTADO.md',
  'deploy/ubuntu',
  'node_modules',
  'node',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
];

/** Nunca no pacote: segredos, a configuração da obra e o que é só de teste. */
export const FORA_DO_PACOTE: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.git(\/|$)/,
  /\.spec\.ts$/,
  /\.spec-util\.ts$/,
  /(^|\/)e2e(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /\.(pem|key|p12|pfx)$/,
];

export function foraDoPacote(caminho: string): boolean {
  return FORA_DO_PACOTE.some((r) => r.test(caminho));
}

export interface ArquivoManifesto {
  readonly caminho: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface Manifesto {
  readonly produto: string;
  readonly versao: string;
  readonly commit: string | null;
  readonly identificacao: string;
  readonly construidoEm: string;
  readonly node: string;
  readonly scriptsSgh: { readonly quantidade: number; readonly ultimo: string | null };
  readonly arquivos: number;
  readonly bytes: number;
  /** sha256 das linhas "sha256  caminho" ordenadas pelo caminho (o hash do conjunto). */
  readonly sha256Conjunto: string;
}

export function hashDoConjunto(arquivos: readonly ArquivoManifesto[]): string {
  const linhas = [...arquivos]
    .sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0))
    .map((a) => `${a.sha256}  ${a.caminho}\n`)
    .join('');
  return createHash('sha256').update(linhas).digest('hex');
}

export function montarManifesto(
  dados: Omit<Manifesto, 'arquivos' | 'bytes' | 'sha256Conjunto'>,
  arquivos: readonly ArquivoManifesto[],
): Manifesto {
  return {
    ...dados,
    arquivos: arquivos.length,
    bytes: arquivos.reduce((s, a) => s + a.bytes, 0),
    sha256Conjunto: hashDoConjunto(arquivos),
  };
}

/** Confere a árvore desempacotada contra o manifesto: arquivos a menos, a mais e alterados. */
export function conferirArvore(
  esperado: readonly ArquivoManifesto[],
  achado: readonly ArquivoManifesto[],
): { faltam: string[]; sobram: string[]; alterados: string[] } {
  const e = new Map(esperado.map((a) => [a.caminho, a.sha256]));
  const a = new Map(achado.map((x) => [x.caminho, x.sha256]));
  return {
    faltam: [...e.keys()].filter((k) => !a.has(k)).sort(),
    sobram: [...a.keys()].filter((k) => !e.has(k)).sort(),
    alterados: [...e.keys()].filter((k) => a.has(k) && a.get(k) !== e.get(k)).sort(),
  };
}

/** Nome do artefato: sante-sgh-<versão>-<commit>.tar.gz (o commit identifica a versão rastreável). */
export function nomeDoArtefato(versao: string, commit: string | null): string {
  const v = versao.replace(/[^0-9A-Za-z.+-]/g, '-');
  return `sante-sgh-${v}${commit ? `-${commit.replace(/[^0-9a-f]/g, '').slice(0, 12)}` : ''}.tar.gz`;
}

/** A pasta da versão no servidor: o nome do artefato sem a extensão. */
export function pastaDaVersao(nomeArtefato: string): string {
  if (!/^sante-sgh-[0-9A-Za-z.+-]+\.tar\.gz$/.test(nomeArtefato))
    throw new Error('Nome de artefato fora do formato sante-sgh-<versão>[-<commit>].tar.gz.');
  return nomeArtefato.replace(/\.tar\.gz$/, '');
}
