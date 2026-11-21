// Leituras das telas de consulta do acesso (M06, ficha seção 7) sobre o banco do cliente, pelo @sgh/nucleo (só
// leitura): os perfis de acesso do estabelecimento (e os da rede inteira) com o número de usuários e de ações
// concedidas, e o mapa módulo → ação permissionável do catálogo do produto. Usuários ativos só em faixa (0, "<5" ou o
// número a partir de 5): nenhum login sai. O catálogo (módulos e ações) fica em memória por 10 min.
// Melhoria: o que era a árvore de opções do sistema de origem passa a ser o catálogo de ações do próprio produto
//   (acao_sistema, por módulo), e o grupo passa a ser o perfil de acesso (perfil_acesso + perfil_acao + usuario_perfil),
//   com a vigência das atribuições conferida no dia.
// Pendência (saida/02-03.json): o nome deste arquivo e dos campos herdados (opcoesLegado) muda junto com a tela de
//   consulta (consulta.controller.ts, do lote 02-01) e o contrato da tela.
import type { Leitor } from '@sgh/nucleo';

/** O que a leitura usa do NucleoProprio (os testes trocam). */
export interface NucleoLeituraAcesso {
  /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
  readonly cliente: string;
  lerSomente<T>(
    ctx: { readonly cliente: string; readonly correlacao: string },
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
  /** Ações atribuídas ao perfil (permitidas ou negadas). */
  readonly opcoesLegado: number;
  /** Ações ativas permitidas ao perfil. */
  readonly permissoesNovo: number;
  readonly destino: string;
  readonly perfil: string | null;
  readonly nivel: string | null;
  readonly motivo: string | null;
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

interface ModuloLido {
  readonly id: number;
  readonly nome: string;
  readonly sistema: string;
}
interface AcaoLida {
  readonly id: number;
  readonly modulo: number | null;
  readonly codigo: string;
  readonly titulo: string;
  readonly ordem: number;
  readonly ativa: boolean;
  readonly permissionavel: boolean;
}
interface Catalogo {
  readonly em: number;
  readonly modulos: readonly ModuloLido[];
  readonly acoes: readonly AcaoLida[];
}

const VALIDADE_MS = 10 * 60_000;
const TETO_ACOES = 100_000;
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Vigência de uma atribuição no dia (tabela com vigencia_inicio e vigencia_fim). */
const vigente = (a: string) =>
  `${a}.vigencia_inicio <= CURRENT_DATE AND (${a}.vigencia_fim IS NULL OR ${a}.vigencia_fim >= CURRENT_DATE)`;

export class LeituraAcesso {
  private catalogoLido: Promise<Catalogo> | null = null;
  constructor(
    private readonly nucleo: NucleoLeituraAcesso,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.nucleo.cliente, correlacao: 'acesso-consulta' }, fn);
  }

  private async estabelecimento(l: Leitor, hospital: string): Promise<number | null> {
    const r = await l.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      hospital,
    ]);
    return r ? Number(r.id) : null;
  }

  /** Módulos e ações do produto: catálogo do cliente inteiro (sem estabelecimento), relido a cada 10 min. */
  private catalogo(): Promise<Catalogo> {
    const atual = this.catalogoLido;
    const p = (async () => {
      const c = await atual?.catch(() => null);
      if (c && this.agora() - c.em < VALIDADE_MS) return c;
      return this.ler(async (l) => {
        const modulos = await l.consultar(
          'SELECT id, codigo, descricao, area FROM modulo_sistema WHERE ativo ORDER BY ordem, id',
        );
        const acoes = await l.consultar(
          `SELECT id, modulo_sistema_id, codigo, descricao, ordem, ativo, permissionavel
             FROM acao_sistema ORDER BY ordem, id`,
          [],
          { teto: TETO_ACOES },
        );
        return {
          em: this.agora(),
          modulos: modulos.map((m) => ({
            id: Number(m['id']),
            nome: texto(m['descricao']),
            sistema: texto(m['area']) || texto(m['codigo']),
          })),
          acoes: acoes.map((a) => ({
            id: Number(a['id']),
            modulo: a['modulo_sistema_id'] === null ? null : Number(a['modulo_sistema_id']),
            codigo: texto(a['codigo']),
            titulo: texto(a['descricao']),
            ordem: Number(a['ordem'] ?? 0),
            ativa: verdadeiro(a['ativo']),
            permissionavel: verdadeiro(a['permissionavel']),
          })),
        };
      });
    })();
    this.catalogoLido = p;
    p.catch(() => {
      if (this.catalogoLido === p) this.catalogoLido = null;
    });
    return p;
  }

  /** Perfis do estabelecimento e da rede inteira (estabelecimento_id nulo), com usuários e ações. */
  async grupos(hospital: string): Promise<GrupoTela[]> {
    const linhas = await this.ler(async (l) => {
      const est = await this.estabelecimento(l, hospital);
      if (est === null) return [];
      return l.consultar(
        `SELECT p.id, p.codigo, p.nome, p.descricao, p.ativo, p.administrador, p.privilegiado, p.versao,
                (SELECT COUNT(DISTINCT up.usuario_id) FROM usuario_perfil up
                   JOIN usuario u ON u.id = up.usuario_id AND u.excluido_em IS NULL AND u.situacao = 'ativo'
                  WHERE up.perfil_acesso_id = p.id AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
                    AND ${vigente('up')}) AS usuarios,
                (SELECT COUNT(*) FROM perfil_acao pa WHERE pa.perfil_acesso_id = p.id AND pa.excluido_em IS NULL)
                  AS acoes,
                (SELECT COUNT(*) FROM perfil_acao pa JOIN acao_sistema a ON a.id = pa.acao_sistema_id AND a.ativo
                  WHERE pa.perfil_acesso_id = p.id AND pa.excluido_em IS NULL AND pa.permitido) AS permitidas
           FROM perfil_acesso p
          WHERE p.excluido_em IS NULL AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)
          ORDER BY p.codigo`,
        [est, est],
        { teto: 5000 },
      );
    });
    return linhas.map((p) => ({
      grupo: texto(p['codigo']),
      ativo: verdadeiro(p['ativo']),
      usuariosAtivos: faixa(Number(p['usuarios'] ?? 0)),
      opcoesLegado: Number(p['acoes'] ?? 0),
      permissoesNovo: Number(p['permitidas'] ?? 0),
      destino: 'perfil',
      perfil: texto(p['codigo']),
      nivel: verdadeiro(p['administrador']) ? 'administrador' : verdadeiro(p['privilegiado']) ? 'privilegiado' : 'padrao',
      motivo: null,
      descricao: texto(p['descricao']) || texto(p['nome']) || null,
      descricaoVersao: p['versao'] === null || p['versao'] === undefined ? null : Number(p['versao']),
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async modulos(_hospital: string): Promise<{ id: number; nome: string; sistema: string; opcoes: number }[]> {
    const c = await this.catalogo();
    const n = new Map<number, number>();
    for (const a of c.acoes) if (a.modulo !== null) n.set(a.modulo, (n.get(a.modulo) ?? 0) + 1);
    return c.modulos.map((m) => ({ id: m.id, nome: m.nome, sistema: m.sistema, opcoes: n.get(m.id) ?? 0 }));
  }

  /** As ações do módulo, na ordem do catálogo; a inativa ou não permissionável sai com o motivo. */
  async mapa(_hospital: string, modulo: number): Promise<NoMapaTela[]> {
    const c = await this.catalogo();
    return c.acoes
      .filter((a) => a.modulo === modulo)
      .sort((x, y) => x.ordem - y.ordem || x.id - y.id)
      .map((a) => ({
        opcao: a.id,
        pai: null,
        nivel: 1,
        titulo: a.titulo || a.codigo,
        permissao: a.codigo,
        exclusao: !a.ativa ? 'Ação inativa no catálogo' : !a.permissionavel ? 'Ação não permissionável' : null,
      }));
  }
}
