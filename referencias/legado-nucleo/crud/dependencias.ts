// W0-02 / D-CRUD-ORFAOS (REGRAS-CRUD.md, regra 4 do dono: nenhum dado órfão): o VERIFICADOR DE DEPENDÊNCIAS comum, que
// todo pacote do programa CRUD completo reutiliza antes de excluir (ou trocar código de) uma linha de tabela do legado.
// Duas fontes, somadas:
//   1. as FKs de ENTRADA declaradas no banco, lidas do catálogo na hora (RDB$RELATION_CONSTRAINTS × RDB$REF_CONSTRAINTS ×
//      RDB$INDEX_SEGMENTS), com qualquer regra de exclusão (CASCADE inclusive: apagaria junto dado que não é do item) e
//      de qualquer número de colunas (a chave composta das tabelas de ligação; D-CRUD-1). Os valores vêm da LINHA lida
//      (a FK pode apontar para um índice único que não é a chave do domínio);
//   2. as REFERÊNCIAS LÓGICAS do MAPA DE DEPENDÊNCIAS (`MapaDependencias`): colunas que o programa lê só por código, sem
//      FK, levantadas no código e nos dados e versionadas em packages/legado (na declaração do domínio, `exclusao`).
// Para cada referência, conta as linhas dependentes e tira uma amostra das chaves delas (até 5, pela chave primária da
// tabela dependente). Fail-closed: a referência que não se consegue contar conta como 1 vínculo (a exclusão é recusada).
// As FKs que são linhas do PRÓPRIO item (`proprias`) ficam fora — só quando a regra da FK no catálogo é CASCADE (revisão
// do W0-02): a "própria" em RESTRICT/NO ACTION/SET NULL conta como vínculo (recusa legível, nunca o erro cru da FK nem a
// filha mudada sem retrato). As filhas próprias em CASCADE são retratadas antes do DELETE (`fksProprias` + o retrato
// na exclusão). A própria linha (autorreferência) não conta.
// A recusa (409 `com-dependentes`) diz quantos e quais e, quando o domínio tem situação, oferece a inativação.
import type { DeclaracaoDominio, ReferenciaDerivada, ReferenciaLogica } from '@sgh/contratos';
import type { Linha } from '../driver.js';
import type { Leitor } from '../transacao.js';

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Grupo de produto pela família da tabela (só para a mensagem; a tabela nunca vai à tela). */
export function grupoDaTabela(tabela: string): string {
  const t = tabela.toUpperCase();
  const regras: readonly (readonly [RegExp, string])[] = [
    [/^SGH_(PEP|ENF)_|^PR|^PE[A-Z]/, 'Prontuário (evoluções, prescrições, documentos)'],
    [/^SGH_CC_|^CC/, 'Centro cirúrgico'],
    [/^SGH_AGE_|^AG|^RE(AG|PAC)|^CV/, 'Agenda'],
    [/^SGH_ATD_|^AT|^HTATEND/, 'Atendimentos'],
    [/^SGH_INT_|^RI/, 'Internação'],
    [/^SGH_SADT_|^SI|^LA|^EX/, 'Exames e serviços (SADT)'],
    [/^REP|^SGH_REP_|^MF|^TBREP/, 'Repasse e honorários'],
    [/^FA|^FT|^CT|^SGH_FAT_|^TBGUIA|^GU/, 'Contas e faturamento'],
    [/^GE|^ES|^SGH_SUP_|^CM|^CO/, 'Estoque e suprimentos'],
    [/^FP|^SGH_PES_|^ESOC|^TBPROFCBOFOLHA|^TBPARAM_VIGOR/, 'Pessoas e folha'],
    [/^TBUSERS|^TBUSUCPL/, 'Login do sistema'],
    [/^SGH_CAD_PROF_EVENTO$/, 'Histórico do login do sistema'],
  ];
  for (const [re, g] of regras) if (re.test(t)) return g;
  return 'Outros cadastros e movimentos';
}

const limpar = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/** Uma FK de entrada (filha → tabela-mãe), com as colunas da filha e as da mãe na ordem dos segmentos. */
export interface FkDeEntrada {
  readonly nome: string;
  readonly tabela: string;
  readonly colunas: readonly string[];
  readonly colunasMae: readonly string[];
  readonly regra: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT';
}

/**
 * O MAPA DE DEPENDÊNCIAS de uma tabela (formato versionado em packages/legado; um por tabela que o pacote exclui): as
 * referências lógicas (sem FK) com a evidência, as linhas próprias do item e a justificativa quando não há referência
 * lógica. As FKs não entram no mapa versionado: são lidas do catálogo na hora (uma FK nova entra sozinha).
 */
export interface MapaDependencias {
  readonly tabela: string;
  /** Colunas da chave da tabela, na ordem em que as referências lógicas as guardam. */
  readonly chave: readonly string[];
  readonly referenciasLogicas: readonly ReferenciaLogica[];
  /** W1-04: vínculos sem igualdade de coluna (condição fixa com os `?` tirados da linha do item). */
  readonly derivadas?: readonly ReferenciaDerivada[];
  readonly semReferenciasLogicas?: string;
  /** FKs de entrada que são linhas do próprio item (`TABELA.COLUNA[+COLUNA]`). */
  readonly proprias?: readonly string[];
}

/** O mapa de dependências que a declaração do domínio traz (vazio quando o domínio não exclui). */
export function mapaDoDominio(d: DeclaracaoDominio): MapaDependencias {
  return {
    tabela: d.tabela,
    chave: d.chaveComposta ?? [d.chave],
    referenciasLogicas: d.exclusao?.referenciasLogicas ?? [],
    ...(d.exclusao?.derivadas?.length ? { derivadas: d.exclusao.derivadas } : {}),
    ...(d.exclusao?.semReferenciasLogicas ? { semReferenciasLogicas: d.exclusao.semReferenciasLogicas } : {}),
    ...(d.exclusao?.proprias ? { proprias: d.exclusao.proprias } : {}),
  };
}

/** Confere o formato do mapa (nomes, colunas na quantidade da chave, evidência, justificativa da lista vazia). */
export function conferirMapa(m: MapaDependencias): string[] {
  const erros: string[] = [];
  if (!NOME.test(m.tabela)) erros.push(`tabela inválida (${m.tabela})`);
  for (const r of m.referenciasLogicas) {
    if (!NOME.test(r.tabela) || r.colunas.some((c) => !NOME.test(c)))
      erros.push(`${r.tabela}: nome inválido`);
    if (r.colunas.length !== m.chave.length)
      erros.push(
        `${r.tabela}.${r.colunas.join('+')}: ${r.colunas.length} coluna(s) para a chave de ${m.chave.length}`,
      );
    if (!r.evidencia.trim()) erros.push(`${r.tabela}.${r.colunas.join('+')}: sem evidência`);
  }
  for (const p of m.proprias ?? []) {
    const [t, cols] = p.split('.');
    if (!t || !NOME.test(t) || !cols || cols.split('+').some((c) => !NOME.test(c)))
      erros.push(`própria inválida (${p}): use TABELA.COLUNA[+COLUNA]`);
  }
  for (const d of m.derivadas ?? []) {
    if (!NOME.test(d.tabela) || [...d.amostra, ...d.de].some((c) => !NOME.test(c)))
      erros.push(`${d.tabela}: nome inválido na derivada`);
    if ((d.onde.match(/\?/g) ?? []).length !== d.de.length)
      erros.push(`${d.tabela}: derivada com ${d.de.length} coluna(s) para os parâmetros da condição`);
    if (/;|--|\/\*/.test(d.onde)) erros.push(`${d.tabela}: derivada com separador na condição`);
    if (!d.evidencia.trim()) erros.push(`${d.tabela}: derivada sem evidência`);
  }
  if (m.referenciasLogicas.length === 0 && !m.semReferenciasLogicas?.trim())
    erros.push('lista de referências lógicas vazia sem a justificativa (semReferenciasLogicas)');
  return erros;
}

/** As FKs de entrada da tabela (catálogo do banco, na hora), de uma ou mais colunas. */
export async function fksDeEntrada(l: Leitor, tabela: string): Promise<FkDeEntrada[]> {
  if (!NOME.test(tabela)) throw new Error('Tabela inválida.');
  const linhas = await l.consultar(
    `SELECT TRIM(rc.RDB$CONSTRAINT_NAME) NOME, TRIM(rc.RDB$RELATION_NAME) FILHA, TRIM(s.RDB$FIELD_NAME) COLUNA,
            TRIM(sm.RDB$FIELD_NAME) MAE, TRIM(ref.RDB$DELETE_RULE) REGRA, s.RDB$FIELD_POSITION POS
       FROM RDB$RELATION_CONSTRAINTS rc
       JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
       JOIN RDB$RELATION_CONSTRAINTS uq ON uq.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
       JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
       JOIN RDB$INDEX_SEGMENTS sm ON sm.RDB$INDEX_NAME = uq.RDB$INDEX_NAME AND sm.RDB$FIELD_POSITION = s.RDB$FIELD_POSITION
      WHERE uq.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      ORDER BY 1, 6`,
    [tabela],
    { teto: 5_000 },
  );
  const regras = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']);
  const por = new Map<string, { tabela: string; colunas: string[]; mae: string[]; regra: string }>();
  for (const x of linhas) {
    const nome = limpar(x['NOME']);
    const f = por.get(nome) ?? {
      tabela: limpar(x['FILHA']),
      colunas: [],
      mae: [],
      regra: limpar(x['REGRA']),
    };
    f.colunas.push(limpar(x['COLUNA']));
    f.mae.push(limpar(x['MAE']));
    por.set(nome, f);
  }
  return [...por.entries()].map(([nome, f]) => ({
    nome,
    tabela: f.tabela,
    colunas: f.colunas,
    colunasMae: f.mae,
    regra: (regras.has(f.regra) ? f.regra : 'RESTRICT') as FkDeEntrada['regra'],
  }));
}

/** Colunas da chave primária de uma tabela (para a amostra das chaves dependentes). */
export async function chavePrimaria(l: Leitor, tabela: string): Promise<string[]> {
  const linhas = await l.consultar(
    `SELECT TRIM(s.RDB$FIELD_NAME) C FROM RDB$RELATION_CONSTRAINTS rc
       JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
      WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY s.RDB$FIELD_POSITION`,
    [tabela],
    { teto: 20 },
  );
  return linhas.map((x) => limpar(x['C'])).filter((c) => NOME.test(c));
}

/** Um grupo de registros dependentes (uma referência) com a contagem e a amostra das chaves. */
export interface DependenteContado {
  readonly tabela: string;
  readonly colunas: readonly string[];
  readonly origem: 'fk' | 'logica';
  readonly regra?: FkDeEntrada['regra'];
  readonly quantidade: number;
  /** Até 5 chaves dos registros dependentes (texto; chave composta com "|"). */
  readonly amostra: readonly string[];
  /** Rótulo de produto (o domínio declarado da tabela dependente, ou a área do sistema). */
  readonly rotulo: string;
  /** A contagem falhou (fail-closed: conta como vínculo). */
  readonly naoContado?: boolean;
}

export const TAMANHO_AMOSTRA = 5;

/** Rótulo de produto da tabela dependente (nunca o nome da tabela na tela). */
export type RotuloDaTabela = (tabela: string) => string | undefined;

async function contar(
  l: Leitor,
  tabela: string,
  colunas: readonly string[],
  valores: readonly unknown[],
  semAPropria: { colunas: readonly string[]; valores: readonly unknown[] } | null,
): Promise<{ quantidade: number; amostra: string[]; naoContado?: boolean }> {
  if (!NOME.test(tabela) || colunas.some((c) => !NOME.test(c)))
    return { quantidade: 1, amostra: [], naoContado: true };
  if (valores.some((v) => v === null || v === undefined)) return { quantidade: 0, amostra: [] };
  const onde = colunas.map((c) => `"${c}" = ?`).join(' AND ');
  const fora = semAPropria ? ` AND NOT (${semAPropria.colunas.map((c) => `"${c}" = ?`).join(' AND ')})` : '';
  const params = [...valores, ...(semAPropria?.valores ?? [])];
  try {
    const [x] = await l.consultar(`SELECT COUNT(*) N FROM "${tabela}" WHERE ${onde}${fora}`, params, {
      teto: 1,
      tempoMaximoMs: 10_000,
    });
    const quantidade = Number(x?.['N'] ?? 0);
    if (quantidade === 0) return { quantidade, amostra: [] };
    const pk = await chavePrimaria(l, tabela);
    if (pk.length === 0) return { quantidade, amostra: [] };
    const linhas = await l.consultar(
      `SELECT FIRST ${TAMANHO_AMOSTRA} ${pk.map((c) => `"${c}"`).join(', ')} FROM "${tabela}" WHERE ${onde}${fora} ORDER BY ${pk.map((c) => `"${c}"`).join(', ')}`,
      params,
      { teto: TAMANHO_AMOSTRA, tempoMaximoMs: 10_000 },
    );
    return { quantidade, amostra: linhas.map((y) => pk.map((c) => textoDaChave(y[c])).join('|')) };
  } catch {
    return { quantidade: 1, amostra: [], naoContado: true };
  }
}

/**
 * W1-04: conta um vínculo derivado (condição fixa do mapa, parâmetros da linha do item) e tira a amostra das colunas
 * declaradas. Parâmetro nulo: nada a contar. Fail-closed: a contagem que falha conta como 1 vínculo.
 */
export async function contarDerivada(
  l: Leitor,
  d: ReferenciaDerivada,
  linha: Linha,
): Promise<{ quantidade: number; amostra: string[]; naoContado?: boolean }> {
  if (
    !NOME.test(d.tabela) ||
    [...d.amostra, ...d.de].some((c) => !NOME.test(c)) ||
    (d.onde.match(/\?/g) ?? []).length !== d.de.length ||
    /;|--|\/\*/.test(d.onde)
  )
    return { quantidade: 1, amostra: [], naoContado: true };
  const params = d.de.map((c) => linha[c]);
  if (params.some((v) => v === null || v === undefined)) return { quantidade: 0, amostra: [] };
  try {
    const [x] = await l.consultar(`SELECT COUNT(*) N FROM "${d.tabela}" WHERE ${d.onde}`, params, {
      teto: 1,
      tempoMaximoMs: 10_000,
    });
    const quantidade = Number(x?.['N'] ?? 0);
    if (quantidade === 0 || d.amostra.length === 0) return { quantidade, amostra: [] };
    const cols = d.amostra.map((c) => `CAST("${c}" AS VARCHAR(80)) "${c}"`).join(', ');
    const linhas = await l.consultar(
      `SELECT FIRST ${TAMANHO_AMOSTRA} ${cols} FROM "${d.tabela}" WHERE ${d.onde}`,
      params,
      { teto: TAMANHO_AMOSTRA, tempoMaximoMs: 10_000 },
    );
    return { quantidade, amostra: linhas.map((y) => d.amostra.map((c) => limpar(y[c])).join(' ')) };
  } catch {
    return { quantidade: 1, amostra: [], naoContado: true };
  }
}

function textoDaChave(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return limpar(v);
}

export interface PedidoVerificacao {
  readonly mapa: MapaDependencias;
  /** A linha inteira do item (SELECT * pela chave), de onde saem os valores de cada FK. */
  readonly linha: Linha;
  /** Valores da chave na ordem de `mapa.chave` (para as referências lógicas). */
  readonly chave: readonly unknown[];
  readonly rotulo?: RotuloDaTabela;
  /** Só as referências sem FK (a recontagem antes do COMMIT: as FKs o próprio banco recusa). */
  readonly soLogicas?: boolean;
}

/**
 * Os dependentes da linha: FKs de entrada (catálogo), referências lógicas e derivadas (mapa); só os que têm alguma linha.
 */
export async function verificarDependencias(l: Leitor, p: PedidoVerificacao): Promise<DependenteContado[]> {
  const { mapa, linha } = p;
  const proprias = new Set(mapa.proprias ?? []);
  const rotulo = (t: string) => p.rotulo?.(t) ?? grupoDaTabela(t);
  const r: DependenteContado[] = [];
  if (!p.soLogicas)
    for (const f of await fksDeEntrada(l, mapa.tabela)) {
      if (proprias.has(`${f.tabela}.${f.colunas.join('+')}`) && f.regra === 'CASCADE') continue;
      const valores = f.colunasMae.map((c) => linha[c]);
      // Autorreferência (hierarquia na própria tabela): a própria linha não é dependente dela mesma.
      const propria =
        f.tabela === mapa.tabela ? { colunas: mapa.chave, valores: mapa.chave.map((c) => linha[c]) } : null;
      const c = await contar(l, f.tabela, f.colunas, valores, propria);
      if (c.quantidade > 0)
        r.push({
          tabela: f.tabela,
          colunas: f.colunas,
          origem: 'fk',
          regra: f.regra,
          rotulo: rotulo(f.tabela),
          ...c,
        });
    }
  for (const ref of mapa.referenciasLogicas) {
    const propria = ref.tabela === mapa.tabela ? { colunas: mapa.chave, valores: [...p.chave] } : null;
    const c = await contar(l, ref.tabela, ref.colunas, p.chave, propria);
    if (c.quantidade > 0)
      r.push({
        tabela: ref.tabela,
        colunas: ref.colunas,
        origem: 'logica',
        rotulo: ref.rotulo ?? rotulo(ref.tabela),
        ...c,
      });
  }
  // W1-04: os vínculos derivados (sem FK; contados também na recontagem antes do COMMIT).
  for (const d of mapa.derivadas ?? []) {
    const c = await contarDerivada(l, d, linha);
    if (c.quantidade > 0)
      r.push({
        tabela: d.tabela,
        colunas: d.de,
        origem: 'logica',
        rotulo: d.rotulo ?? rotulo(d.tabela),
        ...c,
      });
  }
  return r;
}

/**
 * Revisão do W0-02: as FKs de entrada declaradas `proprias` que o catálogo diz CASCADE (as filhas que o DELETE leva
 * junto), com os valores tirados da linha do item, para o retrato antes da exclusão. As de outra regra não entram: o
 * verificador já as contou como vínculo.
 */
export async function fksProprias(
  l: Leitor,
  mapa: MapaDependencias,
  linha: Linha,
): Promise<{ readonly fk: FkDeEntrada; readonly valores: readonly unknown[] }[]> {
  const proprias = new Set(mapa.proprias ?? []);
  if (proprias.size === 0) return [];
  return (await fksDeEntrada(l, mapa.tabela))
    .filter((f) => f.regra === 'CASCADE' && proprias.has(`${f.tabela}.${f.colunas.join('+')}`))
    .map((fk) => ({ fk, valores: fk.colunasMae.map((c) => linha[c]) }));
}

/** A frase da recusa: "N registros em <rótulo> (amostra: …)", uma por grupo, e a saída. */
export function frasesDosDependentes(v: readonly DependenteContado[], oQue: string, saida: string): string {
  const total = v.reduce((s, x) => s + x.quantidade, 0);
  const lista = v
    .map(
      (x) =>
        `${x.quantidade} ${x.quantidade === 1 ? 'registro' : 'registros'} em ${x.rotulo}${x.amostra.length ? ` (amostra: ${x.amostra.join(', ')})` : ''}`,
    )
    .join('; ');
  return `${oQue} tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${lista}. ${saida}`.trim();
}
