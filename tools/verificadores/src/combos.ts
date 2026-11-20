// Combos com busca (decisão do dono, 23/10/2026: "todos os combos com listagem grande têm de ter busca";
// ADR 0027). A busca mora num lugar só: `SanteSelecao` liga a caixa de busca sozinho quando a lista passa de
// LIMIAR_BUSCA opções. Para a regra valer em todas as telas, este portão falha se um `.vue` fora do @sgh/ui
// (1) usa `<select>` cru, (2) desliga a busca com `:busca="false"` ou (3) importa um combo da biblioteca de
// base (select, dropdown, listbox, autocomplete etc.) em vez do embrulho. Exceção só nominal (arquivo + trecho)
// e justificada; exceção que não casa mais com nada também falha.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ExcecaoCombo {
  readonly arquivo: string;
  readonly trecho: string;
  readonly justificativa: string;
}

/** Hoje nenhuma. Para acrescentar uma, diga por que aquele combo não pode ser um `SanteSelecao`. */
export const EXCECOES: readonly ExcecaoCombo[] = [];

export interface AchadoCombo {
  readonly arquivo: string;
  readonly linha: number;
  readonly trecho: string;
  readonly motivo: string;
}

const REGRAS: readonly { padrao: RegExp; motivo: string }[] = [
  {
    padrao: /<select\b[^>]*>?/gi,
    motivo: '<select> cru: use SanteSelecao (busca automática em lista grande)',
  },
  { padrao: /:busca=["']false["']/g, motivo: 'busca desligada à força num combo' },
  {
    padrao:
      /from\s+['"](?:openvue|primevue)\/(?:select|dropdown|listbox|autocomplete|cascadeselect|treeselect|multiselect)['"]/g,
    motivo: 'combo da biblioteca de base: use o embrulho do @sgh/ui',
  },
];

/** Só o template e o script contam; comentários HTML saem (preservando as linhas). */
function semComentariosHtml(conteudo: string): string {
  return conteudo.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function verificarCombos(
  arquivos: readonly { arquivo: string; conteudo: string }[],
  excecoes: readonly ExcecaoCombo[] = EXCECOES,
): { achados: AchadoCombo[]; excecoesSemUso: ExcecaoCombo[] } {
  const usadas = new Set<ExcecaoCombo>();
  const achados: AchadoCombo[] = [];
  for (const { arquivo, conteudo } of arquivos) {
    const codigo = semComentariosHtml(conteudo);
    for (const { padrao, motivo } of REGRAS) {
      for (const m of codigo.matchAll(padrao)) {
        const linha = codigo.slice(0, m.index).split('\n').length;
        const texto = codigo.split('\n')[linha - 1]?.trim() ?? m[0];
        const ex = excecoes.find((e) => e.arquivo === arquivo && texto.includes(e.trecho));
        if (ex) {
          usadas.add(ex);
          continue;
        }
        achados.push({ arquivo, linha, trecho: texto, motivo });
      }
    }
  }
  return { achados, excecoesSemUso: excecoes.filter((e) => !usadas.has(e)) };
}

/** Os `.vue` versionados de apps/ e packages/, menos os do @sgh/ui (onde mora o embrulho). */
/** Nos E2E o combo se escolhe pelo auxiliar e2e/combos.ts (abre a lista e clica), nunca por selectOption. */
export const REGRAS_E2E: readonly { padrao: RegExp; motivo: string }[] = [
  { padrao: /\.selectOption\(/g, motivo: 'selectOption: use escolher() de e2e/combos.ts' },
  {
    padrao: /locator\(\s*['"`]option\b/g,
    motivo: "locator('option'): use rotulosDoCombo()/esperarOpcoes() de e2e/combos.ts",
  },
  {
    padrao: /locator\(\s*['"`]select\b/g,
    motivo: "locator('select'): use escolher()/esperarValor() de e2e/combos.ts",
  },
];

export function verificarE2e(arquivos: readonly { arquivo: string; conteudo: string }[]): AchadoCombo[] {
  const achados: AchadoCombo[] = [];
  for (const { arquivo, conteudo } of arquivos) {
    for (const { padrao, motivo } of REGRAS_E2E) {
      for (const m of conteudo.matchAll(padrao)) {
        const linha = conteudo.slice(0, m.index).split('\n').length;
        achados.push({ arquivo, linha, trecho: conteudo.split('\n')[linha - 1]!.trim(), motivo });
      }
    }
  }
  return achados;
}

/** Specs e auxiliares do E2E do web, menos o próprio auxiliar dos combos. */
export function arquivosDeE2e(raiz: string): string[] {
  const saida = execFileSync('git', ['ls-files', '-z', '--', 'apps/web/e2e'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  return saida.split('\0').filter((f) => f.endsWith('.ts') && f !== 'apps/web/e2e/combos.ts');
}

export function arquivosDeCombo(raiz: string): string[] {
  const saida = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  return saida.split('\0').filter((f) => f.endsWith('.vue') && !f.startsWith('packages/ui/'));
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const arquivos = arquivosDeCombo(raiz).map((arquivo) => ({
    arquivo,
    conteudo: readFileSync(resolve(raiz, arquivo), 'utf8'),
  }));
  const { achados: dasTelas, excecoesSemUso } = verificarCombos(arquivos);
  const e2e = arquivosDeE2e(raiz).map((arquivo) => ({
    arquivo,
    conteudo: readFileSync(resolve(raiz, arquivo), 'utf8'),
  }));
  const achados = [...dasTelas, ...verificarE2e(e2e)];
  for (const a of achados) console.error(`[combos] ${a.arquivo}:${a.linha}: ${a.motivo}: ${a.trecho}`);
  for (const e of excecoesSemUso)
    console.error(`[combos] exceção sem uso (tire da lista): ${e.arquivo} "${e.trecho}"`);
  const ok = achados.length === 0 && excecoesSemUso.length === 0;
  console.log(
    `[combos] ${arquivos.length} arquivo(s) .vue e ${e2e.length} do E2E; ${achados.length} achado(s) → ${ok ? 'verde' : 'VERMELHO'}`,
  );
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(principal());
