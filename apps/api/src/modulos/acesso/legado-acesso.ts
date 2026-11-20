// Leituras das telas de consulta do acesso (M06, ficha seção 7): os grupos do legado com o perfil proposto e
// o mapa opção do legado → permissão do Sante SGH, ao vivo pelo núcleo (READ ONLY). Usuários ativos só em
// faixa (0, "<5" ou o número a partir de 5): nenhum login sai. A árvore e o catálogo ficam em memória por 10 min.
import {
  type CatalogoGerado,
  construirCatalogo,
  destinoDoGrupo,
  type OpcaoArvore,
} from '@sgh/dominio-acesso';
import {
  type ContextoLegado,
  type Leitor,
  lerDescricoesGrupos,
  lerGruposLegado,
  lerModulosLegado,
  lerOpcoesLegado,
  lerPermissoesGrupos,
  type ModuloLegado,
} from '@sgh/legado';

export interface NucleoLeituraAcesso {
  readonly rede: string;
  lerSomente<T>(
    ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export const NUCLEO_ACESSO = Symbol('NUCLEO_ACESSO');

export type Faixa = number | '<5';
const faixa = (n: number): Faixa => (n === 0 ? 0 : n < 5 ? '<5' : n);

export interface GrupoTela {
  readonly grupo: string;
  readonly ativo: boolean;
  readonly usuariosAtivos: Faixa;
  readonly opcoesLegado: number;
  readonly permissoesNovo: number;
  readonly destino: string;
  readonly perfil: string | null;
  readonly nivel: string | null;
  readonly motivo: string | null;
  /** W1-01 (parte 4c): a descrição vigente do grupo (SGH_ACESSO_GRUPO_DESCR) e a versão dela. */
  readonly descricao: string | null;
  readonly descricaoVersao: number | null;
}

export interface NoMapaTela {
  readonly opcao: number;
  readonly pai: number | null;
  readonly nivel: number;
  readonly titulo: string;
  readonly permissao: string | null;
  readonly exclusao: string | null;
}

interface Arvore {
  readonly em: number;
  readonly opcoes: readonly OpcaoArvore[];
  readonly modulos: readonly ModuloLegado[];
  readonly catalogo: CatalogoGerado;
}

const VALIDADE_MS = 10 * 60_000;

export class LeituraAcesso {
  private readonly arvores = new Map<string, Promise<Arvore>>();
  constructor(private readonly nucleo: NucleoLeituraAcesso) {}

  private ctx(hospital: string) {
    return { rede: this.nucleo.rede, hospital, traceId: 'acesso-consulta' };
  }

  private arvore(hospital: string): Promise<Arvore> {
    const atual = this.arvores.get(hospital);
    const p = (async () => {
      const a = await atual?.catch(() => null);
      if (a && Date.now() - a.em < VALIDADE_MS) return a;
      const { opcoes, modulos } = await this.nucleo.lerSomente(this.ctx(hospital), async (l) => ({
        opcoes: await lerOpcoesLegado(l),
        modulos: await lerModulosLegado(l),
      }));
      return { em: Date.now(), opcoes, modulos, catalogo: construirCatalogo(opcoes, modulos) };
    })();
    this.arvores.set(hospital, p);
    p.catch(() => this.arvores.delete(hospital));
    return p;
  }

  async grupos(hospital: string): Promise<GrupoTela[]> {
    const a = await this.arvore(hospital);
    const { grupos, perm, descr } = await this.nucleo.lerSomente(this.ctx(hospital), async (l) => ({
      grupos: await lerGruposLegado(l),
      perm: await lerPermissoesGrupos(l),
      descr: await lerDescricoesGrupos(l),
    }));
    const porGrupo = new Map<string, Set<number>>();
    for (const p of perm) porGrupo.set(p.grupo, (porGrupo.get(p.grupo) ?? new Set()).add(p.opcao));
    return grupos.map((g) => {
      const opts = porGrupo.get(g.nome) ?? new Set<number>();
      const codigos = new Set([...opts].flatMap((o) => a.catalogo.permissaoDaOpcao.get(o) ?? []));
      const d = destinoDoGrupo(g.nome);
      return {
        grupo: g.nome,
        ativo: g.ativo,
        usuariosAtivos: faixa(g.usuariosAtivos),
        opcoesLegado: opts.size,
        permissoesNovo: codigos.size,
        destino: d.tipo,
        perfil: d.tipo === 'perfil' ? d.perfil : null,
        nivel: d.tipo === 'perfil' ? d.nivel : null,
        motivo: d.tipo === 'perfil' ? null : d.motivo,
        descricao: descr.get(g.nome)?.descricao ?? null,
        descricaoVersao: descr.get(g.nome)?.versao ?? null,
      };
    });
  }

  async modulos(hospital: string): Promise<{ id: number; nome: string; sistema: string; opcoes: number }[]> {
    const a = await this.arvore(hospital);
    const n = new Map<number, number>();
    for (const o of a.opcoes) n.set(o.modulo, (n.get(o.modulo) ?? 0) + 1);
    return a.modulos.map((m) => ({ id: m.id, nome: m.nome, sistema: m.sistema, opcoes: n.get(m.id) ?? 0 }));
  }

  async mapa(hospital: string, modulo: number): Promise<NoMapaTela[]> {
    const a = await this.arvore(hospital);
    const exclusao = new Map(a.catalogo.exclusoes.map((e) => [e.opcao, e.motivo]));
    return a.opcoes
      .filter((o) => o.modulo === modulo)
      .sort((x, y) => x.indice - y.indice || x.id - y.id)
      .map((o) => ({
        opcao: o.id,
        pai: a.catalogo.arvore.get(o.id)?.pai ?? null,
        nivel: o.nivel,
        titulo: o.titulo || o.nome,
        permissao: a.catalogo.permissaoDaOpcao.get(o.id) ?? null,
        exclusao: exclusao.get(o.id) ?? null,
      }));
  }
}
