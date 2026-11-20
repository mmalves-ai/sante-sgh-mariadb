// Sessão "como" no núcleo (ADR 0021; docs/modulos/acesso.md › Suporte técnico e login como). A API marca a
// requisição feita numa sessão "como" (contextoComo, AsyncLocalStorage) e TODA escrita confirmada do núcleo
// (executor do M04/M08 e transações SGH_) passa por `comImagens`: para cada registro afetado, a imagem ANTES e
// DEPOIS vai à SGH_SUP_IMAGEM NA MESMA TRANSAÇÃO da escrita, ligada à sessão, à escrita (SGH_SUP_ACAO) e ao ator
// real. Se a imagem não puder ser registrada (comando que não se sabe retratar, tabela sem chave primária,
// erro), a escrita não acontece: fail-closed. Não é bloqueio de uso (o "como" faz tudo o que o alvo faz); é a
// condição para a escrita poder ser corrigida depois ("Corrigir"/"Desfazer", suporte/correcao.ts).
// As tabelas técnicas (trilhas, outbox, idempotência, as próprias tabelas do suporte) ficam fora: nunca são
// compensadas. Nenhum valor de linha vai a log.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Linha } from './driver.js';
import { type Escritor, type Leitor, repassarEsperaCurta } from './transacao.js';

export interface MarcaComo {
  /** SGH_SUP_SESSAO.ID */
  readonly sessao: string;
  /** SGH_SUP_ACAO.ID da escrita em curso (null fora de uma escrita HTTP: não acontece em produção). */
  readonly acao: string | null;
  readonly atorTipo: 'plataforma' | 'suporte';
  /** SGH_PLAT_CONTA.ID do ator real (nunca nome nem e-mail). */
  readonly idConta: string;
  /** TBUSERS.NOME do alvo. */
  readonly alvo: string;
}

export const contextoComo = new AsyncLocalStorage<MarcaComo>();

/** A marca da requisição em curso, ou null fora de uma sessão "como". */
export function marcaComoAtual(): MarcaComo | null {
  return contextoComo.getStore() ?? null;
}

/** Roda `fn` (e tudo o que ela encadear) marcado como sessão "como". */
export function executarComo<T>(marca: MarcaComo, fn: () => T): T {
  return contextoComo.run(marca, fn);
}

/**
 * ORIGEM da SGH_TRILHA dentro do "como": o ator real por tipo e número da conta e a sessão (sem nome, e-mail
 * nem IP). Para o hospital, toda linha com este prefixo aparece como "Suporte técnico".
 */
export function origemSuporte(m: Pick<MarcaComo, 'atorTipo' | 'idConta' | 'sessao'>): string {
  return `SUPORTE:${m.atorTipo}:${m.idConta}:S${m.sessao}`.slice(0, 100);
}

export const PREFIXO_ORIGEM_SUPORTE = 'SUPORTE:';

/** A imagem não pôde ser registrada: a escrita não acontece (o executor traduz em 503). */
export class ErroImagemComo extends Error {
  override readonly name = 'ErroImagemComo';
}

/**
 * Tabelas técnicas que não recebem imagem (nunca são compensadas). As do módulo de suporte vão uma a uma: o prefixo
 * SGH_SUP_ é também o das tabelas de suprimentos (SGH_SUP_OPME_*, SGH_SUP_INVENTARIO…), que são escrita de negócio e
 * levam a imagem como qualquer outra (o Corrigir as alcança).
 */
const SEM_IMAGEM =
  /^(?:SGH_TRILHA|SGH_OUTBOX|SGH_IDEMPOTENCIA|SGH_VERSAO_SCRIPT|SGH_SUP_(?:SESSAO|ACAO|LEITURA|IMAGEM|CORRECAO)|SGH_PLAT_[A-Z0-9_]+|TBCABTRILHA|TBLANTRILHASGH)$/;
const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;
/** Teto de registros retratados por comando (UPDATE/DELETE sem chave): acima disso, a escrita não acontece. */
export const TETO_IMAGENS_POR_COMANDO = 500;

export function semImagem(tabela: string): boolean {
  return SEM_IMAGEM.test(tabela.toUpperCase());
}

// ── Análise do comando ───────────────────────────────────────────────────────────────────────────

interface Segmento {
  readonly palavra: string;
  readonly inicio: number;
}

/** Palavras-chave no nível de cima (fora de aspas e de parênteses), com a posição. */
function palavrasDeCima(sql: string, procuradas: readonly string[]): Segmento[] {
  const r: Segmento[] = [];
  let nivel = 0;
  let aspa: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string;
    if (aspa) {
      if (c === aspa) aspa = sql[i + 1] === aspa ? (i++, aspa) : null;
      continue;
    }
    if (c === "'" || c === '"') {
      aspa = c;
      continue;
    }
    if (c === '(') nivel++;
    else if (c === ')') nivel--;
    else if (nivel === 0 && /[A-Za-z]/.test(c) && (i === 0 || /[\s)]/.test(sql[i - 1] as string))) {
      for (const p of procuradas) {
        const trecho = sql.slice(i, i + p.length).toUpperCase();
        const depois = sql[i + p.length];
        if (trecho === p && (depois === undefined || /[\s(]/.test(depois))) r.push({ palavra: p, inicio: i });
      }
    }
  }
  return r;
}

/** Marcadores de parâmetro (?) fora de aspas. */
export function contarParametros(trecho: string): number {
  let n = 0;
  let aspa: string | null = null;
  for (let i = 0; i < trecho.length; i++) {
    const c = trecho[i];
    if (aspa) {
      if (c === aspa) aspa = trecho[i + 1] === aspa ? (i++, aspa) : null;
    } else if (c === "'" || c === '"') aspa = c;
    else if (c === '?') n++;
  }
  return n;
}

export type EscritaAnalisada =
  | { readonly acao: 'INSERT'; readonly tabela: string; readonly retorna: readonly string[] | null }
  | {
      readonly acao: 'UPDATE';
      readonly tabela: string;
      readonly apelido: string | null;
      readonly set: string;
      readonly where: string | null;
      readonly parametrosSet: number;
      readonly parametrosWhere: number;
    }
  | {
      readonly acao: 'DELETE';
      readonly tabela: string;
      readonly apelido: string | null;
      readonly where: string | null;
      readonly parametrosWhere: number;
    }
  | { readonly acao: 'OUTRA'; readonly tabela: string | null };

const RESERVADAS = new Set(['SET', 'WHERE', 'RETURNING', 'VALUES', 'AS']);

/** Lê o comando de escrita (INSERT … VALUES, UPDATE … SET … WHERE, DELETE FROM … WHERE). */
export function analisarEscrita(sqlBruto: string): EscritaAnalisada {
  const sql = sqlBruto.trim();
  const ins = /^INSERT\s+INTO\s+"?([A-Za-z0-9_$]+)"?\s*\(/i.exec(sql);
  if (ins) {
    const tabela = (ins[1] as string).toUpperCase();
    const p = palavrasDeCima(sql, ['VALUES', 'SELECT', 'RETURNING', 'MATCHING']);
    if (
      !p.some((x) => x.palavra === 'VALUES') ||
      p.some((x) => x.palavra !== 'VALUES' && x.palavra !== 'RETURNING')
    )
      return { acao: 'OUTRA', tabela };
    const ret = p.find((x) => x.palavra === 'RETURNING');
    const retorna = ret
      ? sql
          .slice(ret.inicio + 'RETURNING'.length)
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      : null;
    return { acao: 'INSERT', tabela, retorna };
  }
  const upd = /^UPDATE\s+"?([A-Za-z0-9_$]+)"?(?:\s+([A-Za-z_][A-Za-z0-9_$]*))?\s+SET\s/i.exec(sql);
  if (upd && !/^UPDATE\s+OR\s+INSERT\b/i.test(sql)) {
    const tabela = (upd[1] as string).toUpperCase();
    const apelido = upd[2] && !RESERVADAS.has(upd[2].toUpperCase()) ? upd[2] : null;
    const p = palavrasDeCima(sql, ['SET', 'WHERE', 'RETURNING']);
    const set = p.find((x) => x.palavra === 'SET');
    const where = p.find((x) => x.palavra === 'WHERE');
    const ret = p.find((x) => x.palavra === 'RETURNING');
    if (!set) return { acao: 'OUTRA', tabela };
    const fimSet = where?.inicio ?? ret?.inicio ?? sql.length;
    const trechoSet = sql.slice(set.inicio + 3, fimSet);
    const trechoWhere = where ? sql.slice(where.inicio + 5, ret?.inicio ?? sql.length) : null;
    return {
      acao: 'UPDATE',
      tabela,
      apelido,
      set: trechoSet.trim(),
      where: trechoWhere?.trim() ?? null,
      parametrosSet: contarParametros(trechoSet),
      parametrosWhere: trechoWhere ? contarParametros(trechoWhere) : 0,
    };
  }
  const del = /^DELETE\s+FROM\s+"?([A-Za-z0-9_$]+)"?(?:\s+([A-Za-z_][A-Za-z0-9_$]*))?(?:\s|$)/i.exec(sql);
  if (del) {
    const tabela = (del[1] as string).toUpperCase();
    const apelido = del[2] && !RESERVADAS.has(del[2].toUpperCase()) ? del[2] : null;
    const p = palavrasDeCima(sql, ['WHERE', 'RETURNING']);
    const where = p.find((x) => x.palavra === 'WHERE');
    const ret = p.find((x) => x.palavra === 'RETURNING');
    const trechoWhere = where ? sql.slice(where.inicio + 5, ret?.inicio ?? sql.length) : null;
    return {
      acao: 'DELETE',
      tabela,
      apelido,
      where: trechoWhere?.trim() ?? null,
      parametrosWhere: trechoWhere ? contarParametros(trechoWhere) : 0,
    };
  }
  const outra =
    /^(?:UPDATE\s+OR\s+INSERT\s+INTO|MERGE\s+INTO|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([A-Za-z0-9_$]+)"?/i.exec(
      sql,
    );
  return { acao: 'OUTRA', tabela: outra?.[1]?.toUpperCase() ?? null };
}

/** SET que atribui alguma coluna da chave (o legado recusa mudar chave; aqui a imagem não a seguiria). */
export function setMudaChave(set: string, chave: readonly string[]): boolean {
  return chave.some((c) => new RegExp(`(?:^|[\\s,.])"?${c}"?\\s*=`, 'i').test(set));
}

// ── Valores da imagem (JSON só ASCII, sem perda) ─────────────────────────────────────────────────

export type ValorSerial =
  | null
  | string
  | number
  | boolean
  | { readonly $d: string }
  | { readonly $b: string }
  | { readonly $n: string };

export type LinhaSerial = Record<string, ValorSerial>;

/** Valor da linha → JSON (data como ISO, bytes em base64, inteiro grande como texto). */
export async function serializarValor(v: unknown, leitor?: Pick<Leitor, 'lerBlob'>): Promise<ValorSerial> {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return { $d: v.toISOString() };
  if (typeof v === 'bigint') return { $n: v.toString() };
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $b: Buffer.from(v).toString('base64') };
  if (leitor && typeof v === 'object') return { $b: (await leitor.lerBlob(v)).toString('base64') };
  throw new ErroImagemComo('Valor de coluna que a imagem não sabe guardar.');
}

/** JSON → valor de parâmetro do driver. */
export function valorDoSerial(v: ValorSerial): unknown {
  if (v === null || typeof v !== 'object') return v;
  if ('$d' in v) return new Date(v.$d);
  if ('$b' in v) return Buffer.from(v.$b, 'base64');
  return BigInt(v.$n);
}

/** Forma comparável (CHAR com espaço à direita igual ao sem; data pelo instante). */
export function comparavelSerial(v: ValorSerial | undefined): string {
  if (v === null || v === undefined) return '\u0000';
  if (typeof v === 'string') return `s:${v.trimEnd()}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return `${typeof v}:${String(v)}`;
}

/** Texto para a prévia (só para a pessoa autorizada; nunca vai a log). */
export function textoSerial(v: ValorSerial | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return String(v).trimEnd();
  if ('$d' in v) return v.$d;
  if ('$n' in v) return v.$n;
  return `(binário, ${Buffer.from(v.$b, 'base64').length} bytes)`;
}

export async function serializarLinha(l: Linha, leitor?: Pick<Leitor, 'lerBlob'>): Promise<LinhaSerial> {
  const r: LinhaSerial = {};
  for (const [k, v] of Object.entries(l)) r[k.trim().toUpperCase()] = await serializarValor(v, leitor);
  return r;
}

/** JSON só em ASCII (o banco é NONE): \uXXXX para o resto. */
export function jsonAscii(v: unknown): string {
  return JSON.stringify(v).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Colunas com valor diferente entre duas linhas (ordem alfabética). */
export function colunasDiferentes(a: LinhaSerial | null, b: LinhaSerial | null): string[] {
  const nomes = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...nomes].filter((c) => comparavelSerial(a?.[c]) !== comparavelSerial(b?.[c])).sort();
}

// ── Metadados (chave primária e colunas gravaveis), em cache por banco e tabela ─────────────────

export interface MetaTabela {
  readonly chave: readonly string[];
  /** Colunas físicas (sem COMPUTED BY), na ordem do catálogo. */
  readonly gravaveis: readonly string[];
  /** As que a imagem lê: as físicas menos as de credencial (nunca lidas pelo Sante SGH). */
  readonly lidas: readonly string[];
}

/**
 * Colunas de credencial que a imagem NUNCA lê (credenciais de prestador e de webservice, as mesmas da guarda
 * de colunas proibidas do M09). Não entram na imagem, na prévia nem na correção. No TBUSERS (a troca de grupo
 * do ADR 0022 grava TBUSERS dentro do "como"): senha, sal e a senha criptografada; o código de verificação
 * (recuperação de senha e segundo fator) e os instantes dele; biometria, foto e o e-mail de recuperação; o
 * segundo fator; e os dados pessoais e de log de entrada (CPF, e-mail, nascimento, IP, estação, porta) que
 * mudam a cada acesso e a prévia mostraria como conflito.
 */
export const COLUNAS_FORA_DA_IMAGEM: Readonly<Record<string, readonly string[]>> = {
  TBUSERS: [
    'SENHA',
    'SALT',
    'SENHA_CRIPTOGRAFADA',
    'CODIGO_VERIFICACAO',
    'DATA_HORA_CODIGO_VERIFICACAO',
    'DATAHORACODIGORS',
    'EMAIL_RECUPERA_SENHA',
    'DIGITAL',
    'FOTO',
    'BIOMETRIA_PREFERENCIAL',
    'HABILITAR_DOIS_FATORES',
    'CPF',
    'E_MAIL',
    'DT_NASC',
    'IPLOG',
    'PCLOG',
    'PORTA_LOG',
  ],
  TBCONVEN: ['SENHA'],
  TBTISS: ['SENHA_CERTIFICADO_DIG_WS_TISS', 'CERTIFICADO_DIG_WS_TISS'],
  TBTISSWEBSERV: ['SENHA_PRESTADOR', 'LOGIN_PRESTADOR'],
  // M19: o resumo e o prefixo do token do totem e do painel (credencial do aparelho): nunca na imagem nem na prévia.
  SGH_ACESSO_DISPOSITIVO: ['TOKEN_RESUMO', 'TOKEN_PREFIXO'],
};

const metas = new Map<string, Promise<MetaTabela>>();

export function metaDaTabela(l: Leitor, tabela: string): Promise<MetaTabela> {
  if (!NOME.test(tabela)) return Promise.reject(new ErroImagemComo('Nome de tabela inválido.'));
  const k = `${l.hospital}:${tabela}`;
  let p = metas.get(k);
  if (!p) {
    p = (async () => {
      const chave = await l.consultar(
        `SELECT TRIM(s.RDB$FIELD_NAME) C FROM RDB$RELATION_CONSTRAINTS rc
           JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
          WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
          ORDER BY s.RDB$FIELD_POSITION`,
        [tabela],
        { teto: 32 },
      );
      const colunas = await l.consultar(
        `SELECT TRIM(rf.RDB$FIELD_NAME) C FROM RDB$RELATION_FIELDS rf
           JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
          WHERE rf.RDB$RELATION_NAME = ? AND f.RDB$COMPUTED_BLR IS NULL
          ORDER BY rf.RDB$FIELD_POSITION`,
        [tabela],
        { teto: 2_000 },
      );
      const gravaveis = colunas.map((x) => String(x['C']).trim().toUpperCase());
      const fora = new Set(COLUNAS_FORA_DA_IMAGEM[tabela] ?? []);
      const meta: MetaTabela = {
        chave: chave.map((x) => String(x['C']).trim().toUpperCase()),
        gravaveis,
        lidas: gravaveis.filter((c) => !fora.has(c)),
      };
      if (meta.chave.length === 0)
        throw new ErroImagemComo(`Tabela ${tabela} sem chave primária: a imagem não identifica o registro.`);
      for (const c of [...meta.chave, ...meta.gravaveis])
        if (!NOME.test(c)) throw new ErroImagemComo('Coluna com nome fora do padrão.');
      if (meta.chave.some((c) => fora.has(c))) throw new ErroImagemComo('Chave com coluna de credencial.');
      return meta;
    })();
    metas.set(k, p);
    p.catch(() => metas.delete(k));
  }
  return p;
}

/** Limpa o cache de metadados (testes). */
export function limparMetadadosComo(): void {
  metas.clear();
}

export function chaveDe(linha: LinhaSerial, chave: readonly string[]): LinhaSerial {
  const r: LinhaSerial = {};
  for (const c of chave) {
    if (!(c in linha)) throw new ErroImagemComo('Linha sem a coluna da chave.');
    r[c] = linha[c] ?? null;
  }
  return r;
}

export async function lerPelaChave(
  l: Leitor,
  tabela: string,
  meta: MetaTabela,
  chave: LinhaSerial,
  comTrava = false,
): Promise<LinhaSerial | null> {
  const cols = Object.keys(chave);
  for (const c of cols) if (!NOME.test(c)) throw new ErroImagemComo('Coluna da chave inválida.');
  const [linha] = await l.consultar(
    `SELECT ${meta.lidas.join(', ')} FROM ${tabela} WHERE ${cols.map((c) => `${c} = ?`).join(' AND ')}${comTrava ? ' WITH LOCK' : ''}`,
    cols.map((c) => valorDoSerial(chave[c] ?? null)),
    { teto: 1 },
  );
  return linha ? serializarLinha(linha, l) : null;
}

// ── Registro da imagem ───────────────────────────────────────────────────────────────────────────

export interface ImagemNova {
  readonly tabela: string;
  readonly operacao: 'INSERT' | 'UPDATE' | 'DELETE';
  readonly chave: LinhaSerial;
  readonly antes: LinhaSerial | null;
  readonly depois: LinhaSerial | null;
}

export async function gravarImagem(
  e: Escritor,
  marca: MarcaComo,
  rede: string,
  im: ImagemNova,
): Promise<string> {
  const [g] = await e.consultar(
    'SELECT CAST(NEXT VALUE FOR SGH_GEN_PLAT AS VARCHAR(20)) ID FROM RDB$DATABASE',
    [],
    { teto: 1 },
  );
  const id = String(g?.['ID'] ?? '');
  const chave = jsonAscii(im.chave);
  if (chave.length > 500) throw new ErroImagemComo('Chave do registro grande demais para a imagem.');
  const colunas =
    im.operacao === 'UPDATE' ? colunasDiferentes(im.antes, im.depois).join(',').slice(0, 2000) : null;
  const n = await e.executar(
    `INSERT INTO SGH_SUP_IMAGEM (ID, ID_SESSAO, ID_ACAO, REDE, HOSPITAL, ATOR_TIPO, ID_CONTA, ALVO_LOGIN, TABELA,
       OPERACAO, CHAVE, COLUNAS, ANTES, DEPOIS)
     VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), CAST(CAST(? AS VARCHAR(20)) AS BIGINT),
       CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      marca.sessao,
      marca.acao,
      rede,
      e.hospital,
      marca.atorTipo,
      marca.idConta,
      marca.alvo,
      im.tabela,
      im.operacao,
      chave,
      colunas,
      im.antes ? Buffer.from(jsonAscii(im.antes), 'ascii') : null,
      im.depois ? Buffer.from(jsonAscii(im.depois), 'ascii') : null,
    ],
  );
  if (n !== 1) throw new ErroImagemComo('Imagem não registrada.');
  return id;
}

// ── O escritor que retrata ──────────────────────────────────────────────────────────────────────

function tabelaComApelido(tabela: string, apelido: string | null): string {
  if (apelido && !NOME.test(apelido.toUpperCase())) throw new ErroImagemComo('Apelido inválido.');
  return apelido ? `${tabela} ${apelido}` : tabela;
}

async function linhasAfetadas(
  e: Escritor,
  tabela: string,
  meta: MetaTabela,
  apelido: string | null,
  where: string | null,
  parametros: readonly unknown[],
): Promise<LinhaSerial[]> {
  const prefixo = apelido ? `${apelido}.` : '';
  // WITH LOCK (tabela única): a imagem ANTES é a versão confirmada mais recente e ninguém a muda até o fim
  // da transação; o UPDATE/DELETE que vem a seguir trava as mesmas linhas de qualquer jeito.
  const linhas = await e.consultar(
    `SELECT ${meta.lidas.map((c) => `${prefixo}${c}`).join(', ')} FROM ${tabelaComApelido(tabela, apelido)}${where ? ` WHERE ${where}` : ''} WITH LOCK`,
    parametros,
    { teto: TETO_IMAGENS_POR_COMANDO },
  );
  const r: LinhaSerial[] = [];
  for (const l of linhas) r.push(await serializarLinha(l, e));
  return r;
}

/**
 * Escritor que grava, na mesma transação, a imagem ANTES e DEPOIS de cada registro afetado (sessão "como").
 * Comando que não se sabe retratar (MERGE, UPDATE OR INSERT, INSERT … SELECT, procedimento), tabela sem
 * chave primária, UPDATE que muda a chave, ou mais de TETO_IMAGENS_POR_COMANDO registros: a escrita não
 * acontece (ErroImagemComo). O teto de leitura do driver vale também aqui.
 */
export function comImagens(e: Escritor, marca: MarcaComo, rede: string): Escritor {
  const retratar = async (
    sql: string,
    parametros: readonly unknown[],
    executar: (
      sql: string,
      p: readonly unknown[],
    ) => Promise<{ n: number; linha: Linha | null; contado?: boolean }>,
  ): Promise<{ n: number; linha: Linha | null; contado?: boolean }> => {
    // Ponto de salvamento do executor (escritor de quem chama): não é escrita de registro.
    if (/^\s*(?:SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO)\b/i.test(sql)) return executar(sql, parametros);
    if (/^\s*EXECUTE\b/i.test(sql))
      throw new ErroImagemComo('Procedimento ou bloco PSQL não é retratado: escrita recusada no "como".');
    const a = analisarEscrita(sql);
    if (a.tabela && semImagem(a.tabela)) return executar(sql, parametros);
    if (a.acao === 'OUTRA')
      throw new ErroImagemComo(
        `Comando de escrita que a imagem não retrata${a.tabela ? ` (${a.tabela})` : ''}: escrita recusada no "como".`,
      );
    const meta = await metaDaTabela(e, a.tabela);
    if (a.acao === 'INSERT') {
      const pedidas = a.retorna ?? [];
      const extras = meta.chave.filter((c) => !pedidas.includes(c));
      const novo =
        a.retorna === null
          ? `${sql.trim()} RETURNING ${meta.chave.join(', ')}`
          : extras.length > 0
            ? `${sql.trim()}, ${extras.join(', ')}`
            : sql;
      const r = await executar(novo, parametros);
      if (!r.linha) throw new ErroImagemComo('Inclusão sem a chave devolvida.');
      const devolvida = await serializarLinha(r.linha);
      const chave = chaveDe(devolvida, meta.chave);
      const depois = await lerPelaChave(e, a.tabela, meta, chave);
      await gravarImagem(e, marca, rede, {
        tabela: a.tabela,
        operacao: 'INSERT',
        chave,
        antes: null,
        depois,
      });
      const linha: Linha = {};
      if (a.retorna !== null)
        for (const [k, v] of Object.entries(r.linha))
          if (pedidas.includes(k.trim().toUpperCase())) linha[k] = v;
      return { n: 1, linha: a.retorna === null ? null : linha };
    }
    if (a.acao === 'UPDATE' && setMudaChave(a.set, meta.chave))
      throw new ErroImagemComo('Alteração da chave primária não é retratada: escrita recusada no "como".');
    const doWhere =
      a.acao === 'UPDATE'
        ? parametros.slice(a.parametrosSet, a.parametrosSet + a.parametrosWhere)
        : parametros.slice(0, a.parametrosWhere);
    const antes = await linhasAfetadas(e, a.tabela, meta, a.apelido, a.where, doWhere);
    const r = await executar(sql, parametros);
    // O comando tem de afetar exatamente as linhas retratadas: linha a mais (confirmada por outra estação
    // entre a leitura e o comando) ficaria sem imagem e o Corrigir não a devolveria.
    if (r.contado && r.n !== antes.length)
      throw new ErroImagemComo(
        `O comando afetou ${r.n} registro(s), e a imagem retratou ${antes.length}: escrita desfeita no "como".`,
      );
    for (const l of antes) {
      const chave = chaveDe(l, meta.chave);
      if (a.acao === 'DELETE') {
        await gravarImagem(e, marca, rede, {
          tabela: a.tabela,
          operacao: 'DELETE',
          chave,
          antes: l,
          depois: null,
        });
      } else {
        const depois = await lerPelaChave(e, a.tabela, meta, chave);
        if (!depois) throw new ErroImagemComo('Registro alterado sumiu antes da imagem.');
        if (colunasDiferentes(l, depois).length > 0)
          await gravarImagem(e, marca, rede, {
            tabela: a.tabela,
            operacao: 'UPDATE',
            chave,
            antes: l,
            depois,
          });
      }
    }
    return r;
  };
  return {
    hospital: e.hospital,
    consultar: (sql, p, o) => e.consultar(sql, p, o),
    lerBlob: (b) => e.lerBlob(b),
    async executar(sql, p = []) {
      const r = await retratar(sql, p, async (s, q) => {
        if (s !== sql) return { n: 1, linha: await e.executarRetornando(s, q) };
        return { n: await e.executar(s, q), linha: null, contado: true };
      });
      return r.n;
    },
    async executarRetornando(sql, p = []) {
      const r = await retratar(sql, p, async (s, q) => ({ n: 1, linha: await e.executarRetornando(s, q) }));
      if (!r.linha) throw new ErroImagemComo('Comando sem a linha devolvida.');
      return r.linha;
    },
    // Espera curta (elo da trilha): só em tabela que não se retrata; as demais seguem pelo `executar` retratado.
    ...repassarEsperaCurta(e, (sql) => {
      const a = analisarEscrita(sql);
      if (!a.tabela || !semImagem(a.tabela))
        throw new ErroImagemComo('Espera curta só em tabela sem imagem: escrita recusada no "como".');
    }),
  };
}
