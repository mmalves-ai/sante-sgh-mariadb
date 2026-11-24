// Leitura dos catálogos oficiais nas tabelas PRÓPRIAS do banco do cliente (ficha do M13, seções 4 e 7): a consulta
// paginada no servidor (código exato ou trecho da descrição), a edição que o banco tem (painel de cargas) e o
// histórico de competências SIGTAP de um procedimento. Só tabelas de referência (nenhum dado de pessoa). Os catálogos
// valem para a rede inteira: as tabelas não têm estabelecimento (um banco por cliente), por isso não há filtro por
// estabelecimento aqui.
// SQL parametrizado; tabela, colunas e ordem vêm só da lista branca CONSULTAS (nunca da entrada).
// Melhoria: a busca pela descrição usa a colação do banco (sem diferença de maiúsculas e acentos), e o código aceita a
//   máscara (pontos, hífen e espaços) pelos dígitos.
// Entidades do contrato sem tabela própria mapeada aqui respondem 404 (a lista cresce com o mapa ao modelo próprio).
import { type CodigoCatalogo, entidadeConsultaCatalogo } from '@sgh/contratos';
import { LEIAUTE_CEP_PADRAO } from '@sgh/dominio-catalogo';
import type { Leitor, Linha } from '@sgh/nucleo';
import type { CamposCatalogo, ConsultaCatalogo, HistoricoSigtap } from './fonte.js';
import { tabelaSigtapDoProcedimento } from './sigtap-tabela-propria.js';

interface Coluna {
  readonly campo: string;
  readonly rotulo: string;
  readonly sql: string;
}

interface ConsultaPropria {
  readonly titulo: string;
  readonly de: string;
  readonly colunas: readonly Coluna[];
  /** Expressão do código (busca exata) e da descrição (trecho). */
  readonly codigo: string;
  readonly descricao: string;
  readonly ordem: string;
  /** O código só tem dígitos: a busca aceita a máscara e compara os dígitos. */
  readonly soDigitos?: boolean;
  /** Filtro pela competência SUS (AAAAMM): condição sobre o primeiro dia da competência (dois parâmetros). */
  readonly competencia?: string;
}

const c = (campo: string, rotulo: string, sql: string): Coluna => ({ campo, rotulo, sql });

/** Lista branca: entidade do contrato → tabela própria. */
export const CONSULTAS: Readonly<Record<string, ConsultaPropria>> = Object.freeze({
  cid10: {
    titulo: 'CID-10',
    de: "termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id AND g.codigo = 'cid10'",
    colunas: [
      c('codigo', 'Código', 't.codigo_termo'),
      c('nome', 'Descrição', 't.descricao'),
      c('ativo', 'Ativo', 't.ativo'),
    ],
    codigo: "REPLACE(t.codigo_termo, '.', '')",
    descricao: 't.descricao',
    ordem: 't.codigo_termo',
  },
  procedimento: {
    titulo: 'Procedimentos SIGTAP',
    de: 'procedimento_sigtap p',
    colunas: [
      c('codigo', 'Código', 'p.codigo_sigtap'),
      c('nome', 'Descrição', 'p.descricao'),
      c('sexo', 'Sexo', 'p.sexo'),
      c('idadeMinimaMeses', 'Idade mínima (meses)', 'p.idade_minima_meses'),
      c('idadeMaximaMeses', 'Idade máxima (meses)', 'p.idade_maxima_meses'),
      c('quantidadeMaxima', 'Quantidade máxima', 'p.quantidade_maxima'),
      c('permanenciaDias', 'Permanência (dias)', 'p.permanencia_dias'),
      c('competencia', 'Competência', 'p.versao_fonte'),
      c('ativo', 'Ativo', 'p.ativo'),
    ],
    codigo: 'p.codigo_sigtap',
    descricao: 'p.descricao',
    ordem: 'p.codigo_sigtap',
    soDigitos: true,
    competencia: 'p.vigencia_inicio <= ? AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= ?)',
  },
  valorSigtap: {
    titulo: 'Valores por competência',
    de: 'procedimento_sigtap_valor v JOIN procedimento_sigtap p ON p.id = v.procedimento_sigtap_id',
    colunas: [
      c('procedimento', 'Procedimento', 'p.codigo_sigtap'),
      c('nome', 'Descrição', 'p.descricao'),
      c('competencia', 'Competência', "DATE_FORMAT(v.vigencia_inicio, '%Y%m')"),
      c('valorSh', 'Serviço hospitalar', 'v.valor_servico_hospitalar'),
      c('valorSp', 'Serviço profissional', 'v.valor_servico_profissional'),
      c('valorSa', 'Serviço ambulatorial', 'v.valor_servico_ambulatorial'),
    ],
    codigo: 'p.codigo_sigtap',
    descricao: 'p.descricao',
    ordem: 'p.codigo_sigtap, v.vigencia_inicio DESC',
    soDigitos: true,
    competencia: 'v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)',
  },
  cep: {
    titulo: 'CEP',
    de: 'logradouro_cep l JOIN municipio_ibge m ON m.id = l.municipio_ibge_id JOIN unidade_federativa u ON u.id = l.unidade_federativa_id',
    colunas: [
      c('cep', 'CEP', 'l.codigo_cep'),
      c('logradouro', 'Logradouro', 'l.logradouro'),
      c('complemento', 'Complemento', 'l.complemento'),
      c('cidade', 'Cidade', 'm.nome'),
      c('uf', 'UF', 'u.sigla'),
      c('ibge', 'IBGE', 'm.codigo_ibge'),
    ],
    codigo: 'l.codigo_cep',
    descricao: 'l.logradouro',
    ordem: 'l.codigo_cep',
    soDigitos: true,
  },
  municipio: {
    titulo: 'Municípios (IBGE)',
    de: 'municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id',
    colunas: [
      c('codigo', 'Código IBGE', 'm.codigo_ibge'),
      c('nome', 'Município', 'm.nome'),
      c('uf', 'UF', 'u.sigla'),
      c('ativo', 'Ativo', 'm.ativo'),
    ],
    codigo: 'm.codigo_ibge',
    descricao: 'm.nome',
    ordem: 'm.nome, m.codigo_ibge',
    soDigitos: true,
  },
  cbo: {
    titulo: 'CBO',
    de: 'ocupacao_cbo o',
    colunas: [
      c('codigo', 'Código', 'o.codigo_cbo'),
      c('nome', 'Ocupação', 'o.descricao'),
      c('areaSaude', 'Área da saúde', 'o.area_saude'),
      c('ativo', 'Ativo', 'o.ativo'),
    ],
    codigo: 'o.codigo_cbo',
    descricao: 'o.descricao',
    ordem: 'o.codigo_cbo',
    soDigitos: true,
  },
});

/** Entidades com consulta própria (as demais do contrato respondem 404). */
export const ENTIDADES_PROPRIAS: readonly string[] = Object.freeze([
  ...Object.keys(CONSULTAS),
  'leiautePosicao',
]);

const valorDe = (v: unknown): string | number | null =>
  v === null || v === undefined
    ? null
    : typeof v === 'number'
      ? v
      : typeof v === 'bigint'
        ? Number(v)
        : v instanceof Date
          ? v.toISOString().slice(0, 10)
          : String(v);

/** Primeiro dia da competência AAAAMM (data ISO). */
const inicioDaCompetencia = (cmp: string): string => `${cmp.slice(0, 4)}-${cmp.slice(4, 6)}-01`;

/** Posições do leiaute de CEP (o do produto, versionado no domínio), como linhas de consulta. */
function consultaLeiaute(f: { busca: string | null; pagina: number; porPagina: number }): ConsultaCatalogo {
  const todas: CamposCatalogo[] = [];
  for (const s of LEIAUTE_CEP_PADRAO)
    for (const [campo, [inicio, fim]] of Object.entries(s.campos))
      todas.push({ secao: s.cabecalho, campo, inicio, fim });
  const b = (f.busca ?? '').trim().toUpperCase();
  const filtradas = b ? todas.filter((x) => `${x['secao']} ${x['campo']}`.toUpperCase().includes(b)) : todas;
  return {
    titulo: 'Posições do leiaute de CEP',
    colunas: [
      { campo: 'secao', rotulo: 'Seção' },
      { campo: 'campo', rotulo: 'Campo' },
      { campo: 'inicio', rotulo: 'Posição inicial' },
      { campo: 'fim', rotulo: 'Posição final' },
    ],
    itens: filtradas.slice(f.pagina * f.porPagina, (f.pagina + 1) * f.porPagina),
    total: filtradas.length,
  };
}

/** Consulta paginada no servidor de uma entidade do contrato (null: sem tabela própria mapeada ou fora do contrato). */
export async function consultaPropria(
  l: Leitor,
  entidade: string,
  f: { busca: string | null; pagina: number; porPagina: number; competencia?: string | null },
): Promise<ConsultaCatalogo | null> {
  if (!entidadeConsultaCatalogo(entidade)) return null;
  const porPagina = Math.max(1, Math.min(500, Math.trunc(f.porPagina)));
  const pagina = Math.max(0, Math.trunc(f.pagina));
  if (entidade === 'leiautePosicao') return consultaLeiaute({ busca: f.busca, pagina, porPagina });
  const q = Object.hasOwn(CONSULTAS, entidade) ? CONSULTAS[entidade] : undefined;
  if (!q) return null;
  const w: string[] = [];
  const p: unknown[] = [];
  if (q.competencia && f.competencia && /^\d{4}(0[1-9]|1[0-2])$/.test(f.competencia)) {
    w.push(`(${q.competencia})`);
    const dia = inicioDaCompetencia(f.competencia);
    p.push(dia, dia);
  }
  const b = (f.busca ?? '').trim();
  if (b) {
    const partes: string[] = [];
    const digitos = /^[\d.\-\s/]{1,20}$/.test(b) ? b.replace(/\D/g, '') : '';
    const exato = q.soDigitos
      ? digitos
      : /^[0-9A-Za-z.\-/]{1,20}$/.test(b)
        ? b.toUpperCase().replace(/\./g, '')
        : '';
    if (exato) {
      partes.push(`${q.codigo} = ?`);
      p.push(exato);
    }
    partes.push(`${q.descricao} LIKE ?`);
    p.push(`%${b.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
    w.push(`(${partes.join(' OR ')})`);
  }
  const where = w.length ? ` WHERE ${w.join(' AND ')}` : '';
  const t = await l.uma<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q.de}${where}`, p);
  const linhas = await l.consultar(
    `SELECT ${q.colunas.map((x, i) => `${x.sql} AS c${i}`).join(', ')} FROM ${q.de}${where}
      ORDER BY ${q.ordem} LIMIT ${porPagina} OFFSET ${pagina * porPagina}`,
    p,
    { teto: porPagina, tempoMaximoMs: 30_000 },
  );
  return {
    titulo: q.titulo,
    colunas: q.colunas.map(({ campo, rotulo }) => ({ campo, rotulo })),
    itens: linhas.map((r: Linha) =>
      Object.fromEntries(q.colunas.map((x, i) => [x.campo, valorDe(r[`c${i}`])])),
    ),
    total: Number(t?.n ?? 0),
  };
}

/** Edição que o banco tem de cada catálogo (MAX e COUNT; o serviço guarda em cache por horas). */
const EDICOES: Partial<Record<CodigoCatalogo, { readonly sql: string; readonly descricao: string }>> = {
  cid: {
    sql: `SELECT (SELECT e.versao_edicao FROM terminologia g JOIN terminologia_edicao e ON e.id = g.edicao_vigente_terminologia_edicao_id
             WHERE g.codigo = 'cid10') AS ultima,
           (SELECT COUNT(*) FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id WHERE g.codigo = 'cid10') AS linhas`,
    descricao: 'edição',
  },
  sigtap: {
    sql: 'SELECT MAX(versao_fonte) AS ultima, COUNT(*) AS linhas FROM procedimento_sigtap',
    descricao: 'competência',
  },
  cep: {
    sql: 'SELECT MAX(versao_fonte) AS ultima, COUNT(*) AS linhas FROM logradouro_cep',
    descricao: 'edição',
  },
  cbo: {
    sql: 'SELECT MAX(versao_fonte) AS ultima, COUNT(*) AS linhas FROM ocupacao_cbo',
    descricao: 'edição',
  },
};

export async function edicaoPropria(
  l: Leitor,
  catalogo: CodigoCatalogo,
): Promise<{ ultima: string | null; descricao: string; linhas: number }> {
  const q = EDICOES[catalogo];
  if (!q) return { ultima: null, descricao: 'sem tabela própria', linhas: 0 };
  const r = await l.uma(q.sql);
  const ultima = r?.['ultima'];
  return {
    ultima: ultima === null || ultima === undefined ? null : String(ultima),
    descricao: q.descricao,
    linhas: Number(r?.['linhas'] ?? 0),
  };
}

/**
 * Histórico de competências SIGTAP de um procedimento: os valores por competência (procedimento_sigtap_valor) e os
 * atributos da competência mais recente (o modelo guarda os atributos da última competência carregada).
 */
export async function historicoProprio(l: Leitor, procedimento: string): Promise<HistoricoSigtap | null> {
  const p = await l.uma(
    `SELECT id, descricao, sexo, idade_minima_meses, idade_maxima_meses, quantidade_maxima, permanencia_dias, versao_fonte
       FROM procedimento_sigtap WHERE codigo_sigtap = ?`,
    [procedimento],
  );
  if (!p) return null;
  const valores = await l.consultar(
    `SELECT DATE_FORMAT(vigencia_inicio, '%Y%m') AS competencia, valor_servico_hospitalar, valor_servico_ambulatorial,
            valor_servico_profissional
       FROM procedimento_sigtap_valor WHERE procedimento_sigtap_id = ? ORDER BY vigencia_inicio DESC LIMIT 400`,
    [Number(p['id'])],
    { teto: 400 },
  );
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const atuais: CamposCatalogo = {
    sexo: valorDe(p['sexo']),
    idadeMinimaMeses: n(p['idade_minima_meses']),
    idadeMaximaMeses: n(p['idade_maxima_meses']),
    quantidadeMaxima: n(p['quantidade_maxima']),
    permanenciaDias: n(p['permanencia_dias']),
  };
  const competencias = valores.map((v, i) => ({
    competencia: String(v['competencia']),
    valorSh: n(v['valor_servico_hospitalar']),
    valorSa: n(v['valor_servico_ambulatorial']),
    valorSp: n(v['valor_servico_profissional']),
    atributos: i === 0 ? { ...atuais } : {},
  }));
  return {
    procedimento,
    nome: valorDe(p['descricao']) as string | null,
    competencias,
    ...(await tabelaSigtapDoProcedimento(l, Number(p['id']))),
  };
}
