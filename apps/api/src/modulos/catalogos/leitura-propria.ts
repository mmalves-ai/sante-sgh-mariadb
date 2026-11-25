// Leitura do banco para a comparação da carga de catálogo (ficha do M13, seção 7): o mapa de cada entidade do contrato
// (@sgh/contratos catalogo/definicoes.ts) à tabela própria e a normalização ao vocabulário do contrato, para que a regra
// pura de @sgh/dominio-catalogo (prepararCarga e compararEdicao) compare o arquivo com o que o banco tem.
//   - Só entram no registro de cada item os campos que o modelo guarda no mesmo vocabulário do contrato. A comparação
//     do domínio só compara os campos presentes no item atual (camposAlterados), por isso campo que o modelo guarda
//     diferente (sexo por chave estrangeira, complexidade e financiamento por domínio) nunca vira "alterado" falso.
//   - O campo que a definição corta (truncar) é cortado do mesmo jeito no valor lido, para não acusar diferença que o
//     arquivo não tem.
//   - Entidade sem mapa recusa a comparação com o motivo (409 catalogo-sem-mapa), só quando o arquivo traz itens dela;
//     catálogo sem nenhuma entidade mapeada recusa de saída.
// Os catálogos valem para a rede inteira (um banco por cliente, tabelas sem estabelecimento): sem filtro por
// estabelecimento. SQL parametrizado; tabela, colunas e condições vêm só da lista branca MAPAS.
// Melhoria: a última competência do banco considera só versões no formato AAAAMM (versão de teste ou de outra fonte
//   não decide a vigência da carga).
// Melhoria: a referência dos pares (procedimento, CID-10, CBO) é conferida na tabela própria antes da publicação.
import {
  type CodigoCatalogo,
  definicaoCatalogo,
  type EntidadeCatalogo,
  type TabelaReferenciaCatalogo,
} from '@sgh/contratos';
import {
  type AtuaisDaEntidade,
  camposDaChave,
  chaveEquivalencia,
  type EquivalenciasDoCampo,
  type LeituraDoBanco,
  type ValorItem,
} from '@sgh/dominio-catalogo';
import type { Leitor, Linha } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';

/** Mapa de uma entidade do contrato à tabela própria (chave natural de um campo só). */
interface MapaEntidade {
  /** FROM (com as junções), literal. */
  readonly de: string;
  /** Campo da chave no contrato e a expressão dele na tabela. */
  readonly chave: string;
  readonly expr: string;
  /** Campo do contrato → expressão (só os que o modelo guarda no mesmo vocabulário). */
  readonly campos: Readonly<Record<string, string>>;
  /** Condição do item vigente (os removidos são as chaves vigentes que faltam no arquivo). */
  readonly vigente: string;
  /** Escopo dos removidos pela UF do arquivo (a base de CEP vem por UF). */
  readonly uf?: string;
  /**
   * Campo guardado por referência a um catálogo → consulta (literal) das linhas ativas dele, com `id`, `sigla`,
   * `descricao` e `canonico` (o valor que `campos` lê). O arquivo pode trazer a sigla ou a descricao.
   */
  readonly equivalencias?: Readonly<Record<string, string>>;
}

const UF = 'JOIN unidade_federativa u ON u.id';

export const MAPAS: Readonly<Record<string, MapaEntidade>> = Object.freeze({
  cid10: {
    de: "termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id AND g.codigo = 'cid10'",
    chave: 'codigo',
    expr: 't.codigo_termo',
    campos: { nome: 't.descricao' },
    vigente: 't.ativo = TRUE',
  },
  procedimento: {
    de: 'procedimento_sigtap p',
    chave: 'codigo',
    expr: 'p.codigo_sigtap',
    campos: {
      nome: 'p.descricao',
      quantidadeMaxima: 'p.quantidade_maxima',
      permanencia: 'p.permanencia_dias',
      pontos: 'p.pontos',
      idadeMinima: 'p.idade_minima_meses',
      idadeMaxima: 'p.idade_maxima_meses',
    },
    vigente: 'p.ativo = TRUE',
  },
  // A espécie do logradouro (rua, avenida…) entra na comparação: o CEP gravado sem espécie, ou com outra, vira
  // alteração e a publicação a regrava; o arquivo traz a sigla ou a descrição, comparadas pela equivalência.
  cep: {
    de: `logradouro_cep l JOIN municipio_ibge m ON m.id = l.municipio_ibge_id ${UF} = l.unidade_federativa_id
      LEFT JOIN especie_logradouro el ON el.id = l.especie_logradouro_id`,
    chave: 'cep',
    expr: 'l.codigo_cep',
    campos: {
      uf: 'u.sigla',
      cidade: 'm.nome',
      logradouro: 'l.logradouro',
      ibge: 'm.codigo_ibge',
      tipoLogradouro: 'el.descricao',
    },
    vigente: 'l.ativo = TRUE',
    uf: 'u.sigla',
    equivalencias: {
      tipoLogradouro:
        'SELECT id, sigla, descricao, descricao AS canonico FROM especie_logradouro WHERE ativo = TRUE',
    },
  },
  municipio: {
    de: `municipio_ibge m ${UF} = m.unidade_federativa_id`,
    chave: 'ibge',
    expr: 'm.codigo_ibge',
    campos: { nome: 'm.nome', uf: 'u.sigla' },
    vigente: 'm.ativo = TRUE',
  },
  cbo: {
    de: 'ocupacao_cbo o',
    chave: 'codigo',
    expr: 'o.codigo_cbo',
    campos: { nome: 'o.descricao' },
    vigente: 'o.ativo = TRUE',
  },
});

/** Tabela referenciada pelos pares → entidade mapeada que a guarda. */
const REFERENCIAS: Partial<Record<TabelaReferenciaCatalogo, string>> = {
  procedimentoSigtap: 'procedimento',
  cid10: 'cid10',
  cboSus: 'cbo',
};

const POR_CONSULTA = 1000;
const TETO_EXISTENTES = 5_000_000;
const TEMPO_MS = 120_000;

/** Recusa a comparação sem mapa ao modelo próprio (a carga não grava nada). */
export function semMapa(catalogo: CodigoCatalogo, entidade?: string): never {
  const def = definicaoCatalogo(catalogo);
  const titulo = def?.titulo ?? catalogo;
  const ent = entidade ? (def?.entidades.find((e) => e.codigo === entidade)?.titulo ?? entidade) : null;
  throw new ErroProblema(
    'recusa-de-negocio',
    409,
    'Catálogo sem mapa ao modelo próprio',
    ent
      ? `A comparação de ${ent} (${titulo}) com o banco ainda não tem o mapa ao modelo próprio: envie só os arquivos das entidades mapeadas, ou carregue esta pelo carregador versionado das fontes oficiais.`
      : `A comparação de ${titulo} com o banco ainda não tem o mapa das entidades ao modelo próprio; os catálogos públicos entram pelo carregador versionado das fontes oficiais.`,
    { codigo: 'catalogo-sem-mapa' },
  );
}

/** Entidades do catálogo com mapa ao modelo próprio. */
export function entidadesMapeadas(catalogo: CodigoCatalogo): string[] {
  return (definicaoCatalogo(catalogo)?.entidades ?? [])
    .map((e) => e.codigo)
    .filter((e) => Object.hasOwn(MAPAS, e));
}

function valorDe(v: unknown): ValorItem {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Valor lido no vocabulário do contrato: número no campo numérico, texto cortado como a definição corta. */
function normalizar(e: EntidadeCatalogo, campo: string, v: unknown): ValorItem {
  const x = valorDe(v);
  const c = e.campos.find((y) => y.nome === campo);
  if (x === null || !c) return x;
  if (c.tipo === 'inteiro' || c.tipo === 'decimal') {
    const n = typeof x === 'number' ? x : Number(x);
    return Number.isFinite(n) ? n : x;
  }
  const t = String(x);
  return c.truncar && c.tamanho !== undefined ? [...t].slice(0, c.tamanho).join('').trimEnd() : t;
}

const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

/**
 * A leitura do banco para a preparação da carga de um catálogo, sobre as tabelas próprias do cliente. `ler` abre a
 * leitura (somente leitura) no banco do cliente.
 */
export function leituraPropria(
  catalogo: CodigoCatalogo,
  ler: <T>(fn: (l: Leitor) => Promise<T>) => Promise<T>,
): LeituraDoBanco {
  const def = definicaoCatalogo(catalogo);
  const mapeadas = entidadesMapeadas(catalogo);
  const mapa = (entidade: string): { e: EntidadeCatalogo; m: MapaEntidade } => {
    const e = def?.entidades.find((x) => x.codigo === entidade);
    const m = e && Object.hasOwn(MAPAS, entidade) ? MAPAS[entidade] : undefined;
    if (!e || !m) return semMapa(catalogo, entidade);
    return { e, m };
  };
  const doMapa = (e: EntidadeCatalogo, m: MapaEntidade, r: Linha): [string, Record<string, ValorItem>] => {
    const k = String(valorDe(r['k']) ?? '');
    const item: Record<string, ValorItem> = { [m.chave]: k };
    for (const campo of Object.keys(m.campos)) item[campo] = normalizar(e, campo, r[campo]);
    return [`${m.chave}=${k}`, item];
  };
  return {
    async atuais(entidade, chaves): Promise<AtuaisDaEntidade> {
      const { e, m } = mapa(entidade);
      const valores = [
        ...new Set(chaves.map((c) => camposDaChave(c)[m.chave] ?? '').filter((v) => v !== '')),
      ];
      const r = new Map<string, Record<string, ValorItem>>();
      const colunas = Object.entries(m.campos)
        .map(([campo, sql]) => `${sql} AS ${campo}`)
        .join(', ');
      await ler(async (l) => {
        for (let i = 0; i < valores.length; i += POR_CONSULTA) {
          const parte = valores.slice(i, i + POR_CONSULTA);
          const linhas = await l.consultar(
            `SELECT ${m.expr} AS k, ${colunas} FROM ${m.de} WHERE ${m.expr} IN (${marcadores(parte.length)})`,
            parte,
            { teto: POR_CONSULTA * 50, tempoMaximoMs: TEMPO_MS },
          );
          for (const linha of linhas) {
            const [chave, item] = doMapa(e, m, linha);
            r.set(chave, item);
          }
        }
      });
      return r;
    },
    async equivalencias(entidade): Promise<ReadonlyMap<string, EquivalenciasDoCampo>> {
      const r = new Map<string, EquivalenciasDoCampo>();
      const e = def?.entidades.find((x) => x.codigo === entidade);
      const m = Object.hasOwn(MAPAS, entidade) ? MAPAS[entidade] : undefined;
      if (!e || !m?.equivalencias) return r;
      await ler(async (l) => {
        for (const [campo, sql] of Object.entries(m.equivalencias ?? {})) {
          const mapa = new Map<string, string | null>();
          const dono = new Map<string, string>();
          for (const x of await l.consultar(sql, [], { teto: 10_000, tempoMaximoMs: TEMPO_MS })) {
            const id = String(x['id']);
            const canonico = normalizar(e, campo, x['canonico']);
            for (const v of [x['sigla'], x['descricao']]) {
              if (v === null || v === undefined || String(v).trim() === '') continue;
              const k = chaveEquivalencia(String(v));
              const antes = dono.get(k);
              if (antes === undefined) {
                dono.set(k, id);
                mapa.set(k, canonico === null ? null : String(canonico));
              } else if (antes !== id) mapa.set(k, null);
            }
          }
          r.set(campo, mapa);
        }
      });
      return r;
    },
    async existentes(entidade, escopo): Promise<Iterable<string> | null> {
      const { m } = mapa(entidade);
      const p: unknown[] = [];
      let onde = m.vigente;
      if (m.uf) {
        // Base de CEP: só as UFs do arquivo (sem UF no arquivo, nenhum removido a listar).
        const ufs = [...(escopo.get('uf') ?? [])];
        if (ufs.length === 0) return null;
        onde += ` AND ${m.uf} IN (${marcadores(ufs.length)})`;
        p.push(...ufs);
      }
      const linhas = await ler((l) =>
        l.consultar(`SELECT DISTINCT ${m.expr} AS k FROM ${m.de} WHERE ${onde}`, p, {
          teto: TETO_EXISTENTES,
          tempoMaximoMs: TEMPO_MS,
        }),
      );
      return linhas.map((x) => `${m.chave}=${String(valorDe(x['k']) ?? '')}`);
    },
    async edicao() {
      if (mapeadas.length === 0) return semMapa(catalogo);
      if (catalogo !== 'sigtap') return { ultima: null, versoesTiss: [] };
      const r = await ler((l) =>
        l.uma(
          "SELECT MAX(versao_fonte) AS ultima FROM procedimento_sigtap WHERE versao_fonte REGEXP '^[0-9]{6}$'",
        ),
      );
      const u = r?.['ultima'];
      return { ultima: u === null || u === undefined ? null : String(u), versoesTiss: [] };
    },
    async referencias(tabela, codigos): Promise<ReadonlySet<string>> {
      // O mês de recolhimento da TPS é domínio fixo (1 a 6), sem tabela.
      if (tabela === 'mesRecolhimentoTps') return new Set(codigos.filter((x) => /^[1-6]$/.test(x)));
      const ent = REFERENCIAS[tabela];
      const m = ent ? MAPAS[ent] : undefined;
      if (!m) return semMapa(catalogo);
      const achados = new Set<string>();
      const valores = [...new Set(codigos)];
      await ler(async (l) => {
        for (let i = 0; i < valores.length; i += POR_CONSULTA) {
          const parte = valores.slice(i, i + POR_CONSULTA);
          const linhas = await l.consultar(
            `SELECT DISTINCT ${m.expr} AS k FROM ${m.de} WHERE ${m.expr} IN (${marcadores(parte.length)})`,
            parte,
            { teto: POR_CONSULTA * 50, tempoMaximoMs: TEMPO_MS },
          );
          for (const x of linhas) achados.add(String(valorDe(x['k']) ?? ''));
        }
      });
      return achados;
    },
  };
}
