// Prova dos 42 grupos (ficha do M06, regra 4 e critério de aceite): para cada grupo com permissões, o
// conjunto de opções que o legado concede (TBPERUSU) e o que as permissões do novo cobrem têm de bater.
// Ganho (opção que o grupo passa a ter no novo) só se justifica por agrupamento da MESMA função em outro
// executável do mesmo módulo do Sante SGH (regra 2: recepção interna e externa); perda (opção do legado sem
// permissão no novo) só por opção inativa ou de sistema SGO/SGS sem uso. Qualquer outra diferença reprova.
// O relatório leva só o nome do grupo e contagens.
import type { CatalogoGerado, MotivoExclusao, OpcaoArvore } from './catalogo.js';

export type MotivoGanho = 'agrupamento-executavel';
export type MotivoPerda = Extract<MotivoExclusao, 'opcao-inativa' | 'sistema-sgo-sgs'>;

export interface ProvaGrupo {
  readonly grupo: string;
  readonly opcoesLegado: number;
  readonly permissoesNovo: number;
  readonly ganhosJustificados: number;
  readonly perdasJustificadas: number;
  readonly naoJustificadas: number;
  readonly motivos: Readonly<Record<string, number>>;
}

export interface ResultadoProva {
  readonly grupos: readonly ProvaGrupo[];
  readonly gruposComPermissao: number;
  readonly naoJustificadas: number;
}

const normal = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function provarGrupos(
  catalogo: CatalogoGerado,
  opcoes: readonly OpcaoArvore[],
  permissoesGrupos: readonly (readonly [string, number])[],
): ResultadoProva {
  const porId = new Map(opcoes.map((o) => [o.id, o]));
  const perm = new Map(catalogo.permissoes.map((p) => [p.codigo, p]));
  const exclusao = new Map(catalogo.exclusoes.map((e) => [e.opcao, e.motivo]));
  const doGrupo = new Map<string, Set<number>>();
  for (const [g, o] of permissoesGrupos) {
    const s = doGrupo.get(g) ?? new Set<number>();
    s.add(o);
    doGrupo.set(g, s);
  }
  const grupos: ProvaGrupo[] = [];
  for (const [grupo, opts] of [...doGrupo].sort((a, b) => a[0].localeCompare(b[0]))) {
    const motivos: Record<string, number> = {};
    const conta = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
    const codigos = new Set<string>();
    let perdas = 0;
    let naoJust = 0;
    for (const o of opts) {
      const c = catalogo.permissaoDaOpcao.get(o);
      if (c) {
        codigos.add(c);
        continue;
      }
      const m = exclusao.get(o);
      if (m === 'opcao-inativa' || m === 'sistema-sgo-sgs') {
        perdas++;
        conta(m);
      } else {
        naoJust++;
        conta(m ?? 'opcao-inexistente');
      }
    }
    let ganhos = 0;
    for (const c of codigos) {
      const p = perm.get(c);
      if (!p) continue;
      const doGrupoNaPermissao = p.opcoesLegado.filter((x) => opts.has(x)).map((x) => porId.get(x));
      for (const x of p.opcoesLegado) {
        if (opts.has(x)) continue;
        const ganha = porId.get(x);
        // Justificado: a mesma função (mesmo título e nível) em outro executável do mesmo módulo.
        const mesmaFuncao =
          !!ganha &&
          doGrupoNaPermissao.some(
            (t) =>
              !!t &&
              t.modulo !== ganha.modulo &&
              t.nivel === ganha.nivel &&
              (t.nivel === 0 || normal(t.titulo) === normal(ganha.titulo)),
          );
        if (mesmaFuncao) {
          ganhos++;
          conta('agrupamento-executavel');
        } else {
          naoJust++;
          conta('ganho-sem-justificativa');
        }
      }
    }
    grupos.push({
      grupo,
      opcoesLegado: opts.size,
      permissoesNovo: codigos.size,
      ganhosJustificados: ganhos,
      perdasJustificadas: perdas,
      naoJustificadas: naoJust,
      motivos,
    });
  }
  return {
    grupos,
    gruposComPermissao: grupos.length,
    naoJustificadas: grupos.reduce((s, g) => s + g.naoJustificadas, 0),
  };
}
