// W0-02 (programa CRUD completo, diretriz 1 do dono: todo recurso tem inclusão, alteração e exclusão): o PORTÃO do I/A/E
// dos domínios do CRUD genérico. Todo domínio `editavel` declara `criar`, `editar` e (`inativar` ou `excluir`), ou traz
// `semInclusao`/`semExclusao` com o motivo. Nasce em MODO RELATÓRIO (a lista dos domínios sem I/A/E completo vai ao
// relatório da onda) e fica obrigatório no W4-01 (PORTAO_IAE_OBRIGATORIO). Também exige, de todo domínio com `excluir`, a
// categoria da matriz, e recusa SEMPRE a ação `excluir` em domínio marcado como regra de apoio à decisão ou formulário
// (matriz: só inativação, com nova versão). A lista de referências lógicas (parte física, com nome de tabela) é conferida
// no portão gêmeo de packages/legado (nucleo/crud/motor-w002.spec.ts).
import { CATEGORIAS_SEM_EXCLUSAO, type DominioPublico } from './tipos.js';

/** W4-01 liga: o portão passa de relatório a obrigatório (a lista de lacunas tem de estar vazia). */
export const PORTAO_IAE_OBRIGATORIO = false;

export type FaltaIae = 'criar' | 'editar' | 'inativar-ou-excluir';

export interface LacunaIae {
  readonly dominio: string;
  readonly rotulo: string;
  readonly marco: string;
  readonly faltas: readonly FaltaIae[];
}

/** As lacunas de I/A/E de um domínio editável (vazio: completo, ou com o motivo declarado). */
export function faltasIae(d: DominioPublico): FaltaIae[] {
  if (d.natureza !== 'editavel') return [];
  const r: FaltaIae[] = [];
  if (!d.acoes.includes('criar') && !d.semInclusao?.trim()) r.push('criar');
  if (!d.acoes.includes('editar')) r.push('editar');
  if (!d.acoes.includes('inativar') && !d.acoes.includes('excluir') && !d.semExclusao?.trim())
    r.push('inativar-ou-excluir');
  return r;
}

/** A lista dos domínios editáveis sem I/A/E completo (ordem do id). */
export function lacunasIae(dominios: readonly DominioPublico[]): LacunaIae[] {
  return dominios
    .map((d) => ({
      dominio: `${d.modulo}.${d.recurso}`,
      rotulo: d.rotulo.plural,
      marco: d.marco,
      faltas: faltasIae(d),
    }))
    .filter((x) => x.faltas.length > 0)
    .sort((a, b) => a.dominio.localeCompare(b.dominio));
}

/** Violações que valem SEMPRE (não esperam o W4-01): `excluir` sem categoria, ou em regra/formulário. */
export function violacoesExclusao(dominios: readonly DominioPublico[]): string[] {
  const r: string[] = [];
  for (const d of dominios) {
    if (!d.acoes.includes('excluir')) continue;
    const id = `${d.modulo}.${d.recurso}`;
    if (!d.categoria) r.push(`${id}: declara excluir sem a categoria da matriz`);
    else if (CATEGORIAS_SEM_EXCLUSAO.includes(d.categoria))
      r.push(`${id}: ${d.categoria} não aceita excluir (só inativação, com nova versão)`);
  }
  return r;
}

/** O relatório da onda (Markdown): totais por natureza e a lista dos domínios editáveis sem I/A/E completo. */
export function relatorioIae(dominios: readonly DominioPublico[], data: string): string {
  const lac = lacunasIae(dominios);
  const editaveis = dominios.filter((d) => d.natureza === 'editavel').length;
  const porNatureza = new Map<string, number>();
  for (const d of dominios) porNatureza.set(d.natureza, (porNatureza.get(d.natureza) ?? 0) + 1);
  const porFalta = (f: FaltaIae) => lac.filter((x) => x.faltas.includes(f)).length;
  return [
    `# Portão do I/A/E dos domínios do CRUD genérico (W0-02, modo ${PORTAO_IAE_OBRIGATORIO ? 'obrigatório' : 'relatório'})`,
    '',
    `Gerado em ${data} por \`pnpm crud:portao-iae\` (packages/contratos/src/dominios/portao-iae.ts). Fica obrigatório no W4-01.`,
    '',
    `- Domínios declarados: ${dominios.length} (${[...porNatureza.entries()].map(([k, v]) => `${k}: ${v}`).join(', ')}).`,
    `- Editáveis: ${editaveis}; sem I/A/E completo: **${lac.length}** (sem incluir nem motivo: ${porFalta('criar')}; sem alterar: ${porFalta('editar')}; sem inativar nem excluir nem motivo: ${porFalta('inativar-ou-excluir')}).`,
    `- Violações que valem sempre (excluir sem categoria, ou em regra/formulário): ${violacoesExclusao(dominios).length}.`,
    '',
    '| Domínio | Rótulo | Marco | Falta |',
    '| --- | --- | --- | --- |',
    ...lac.map((x) => `| \`${x.dominio}\` | ${x.rotulo} | ${x.marco} | ${x.faltas.join(', ')} |`),
    '',
  ].join('\n');
}
