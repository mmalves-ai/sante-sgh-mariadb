// W0-02 / D-CRUD-SEM-GATILHO (REGRAS-CRUD.md): a base da VIGIA DE RECONCILIAÇÃO. A matriz recomenda gatilhos AFTER DELETE
// nas tabelas do legado para capturar o que o sistema anterior apaga; eles NÃO são criados (a regra-mãe da convivência
// proíbe alterar objeto do legado). No lugar, a vigia lê, por tabela de domínio, a CONTAGEM de linhas, um CHECKSUM das
// chaves (soma dos HASH das chaves, módulo 1.000.000.007) e a lista das chaves (até o teto da tabela de domínio), e
// guarda o retrato em SGH_CRUD_VIGIA_RETRATO (1171_crud_vigia.sql). Na leitura seguinte, as chaves que sumiram e que o
// Sante não excluiu (sem linha na SGH_CRUD_EVENTO 'excluido' nem na SGH_HIST_EXCLUSAO desde o retrato anterior) viram
// uma linha em SGH_CRUD_VIGIA_ACHADO, que alimenta o relatório "exclusões feitas fora do Sante". Só leitura no legado;
// as gravações são só em SGH_ (inclusão). Ligada pelo parâmetro `crud.vigiaReconciliacao` (SGH_CFG_PARAMETRO).
// Revisão do W0-02: o instante do retrato (LIDO_EM) é o do banco ANTES da leitura da tabela, e a busca das exclusões do
// Sante recua MARGEM_VIGIA_MS antes dele: o evento gravado por uma transação ainda aberta quando a tabela foi lida (a
// linha ainda aparecia) tem CRIADO_EM anterior ao retrato e não pode virar "exclusão feita fora". A lista de chaves do
// achado cabe inteira em CHAVES (as chaves que não cabem ficam fora, nunca o JSON cortado) e o relatório não cai por
// uma linha ilegível. A rodada periódica e a rota do relatório ficam na API (config/vigia-reconciliacao.ts).
import type { DeclaracaoDominio } from '@sgh/contratos';
import { jsonAscii } from '../como.js';
import type { Escritor, Leitor } from '../transacao.js';
import { chavesDe } from '../crud/declaracao.js';

export const PARAMETRO_VIGIA = 'crud.vigiaReconciliacao';
export const MODULO_CHECKSUM = 1_000_000_007;
/** Teto das chaves guardadas no retrato (as tabelas de domínio têm até ~10 mil linhas). */
export const TETO_CHAVES_VIGIA = 20_000;
/**
 * Recuo da busca das exclusões do Sante antes do retrato anterior: maior que a duração de uma transação de exclusão do
 * executor (que trava a linha e grava em segundos). Risco residual aceito: a chave excluída pelo Sante dentro do recuo,
 * incluída de novo e apagada por fora antes da rodada seguinte conta como do Sante.
 */
export const MARGEM_VIGIA_MS = 30 * 60_000;
/** Tamanho de SGH_CRUD_VIGIA_ACHADO.CHAVES (VARCHAR(4000)). */
export const TAMANHO_CHAVES_ACHADO = 4000;

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

export interface RetratoVigia {
  readonly tabela: string;
  readonly contagem: number;
  readonly checksum: number;
  /** As chaves (texto; composta com "|"), em ordem; vazio quando a tabela passa do teto. */
  readonly chaves: readonly string[];
}

/** A expressão da chave em texto no SQL (composta: as colunas com "|"). */
function expressaoChave(colunas: readonly string[]): string {
  return colunas.map((c) => `COALESCE(CAST(${c} AS VARCHAR(60)), '')`).join(" || '|' || ");
}

/** Lê a contagem, o checksum e as chaves de uma tabela (só leitura). */
export async function lerRetratoVigia(
  l: Leitor,
  tabela: string,
  colunasChave: readonly string[],
): Promise<RetratoVigia> {
  if (!NOME.test(tabela) || colunasChave.some((c) => !NOME.test(c))) throw new Error('Tabela inválida.');
  const k = expressaoChave(colunasChave);
  const [x] = await l.consultar(
    `SELECT COUNT(*) N, COALESCE(SUM(MOD(HASH(${k}), ${MODULO_CHECKSUM})), 0) S FROM ${tabela}`,
    [],
    { teto: 1, tempoMaximoMs: 30_000 },
  );
  const contagem = Number(x?.['N'] ?? 0);
  const checksum = Number(x?.['S'] ?? 0) % MODULO_CHECKSUM;
  const chaves =
    contagem <= TETO_CHAVES_VIGIA
      ? (
          await l.consultar(`SELECT ${k} K FROM ${tabela} ORDER BY 1`, [], {
            teto: TETO_CHAVES_VIGIA,
            tempoMaximoMs: 30_000,
          })
        ).map((y) => txt(y['K']))
      : [];
  return { tabela, contagem, checksum, chaves };
}

export interface AchadoVigia {
  readonly tabela: string;
  readonly contagemAntes: number;
  readonly contagemDepois: number;
  /** Chaves que sumiram e que o Sante excluiu (registro do evento ou retrato). */
  readonly peloSante: readonly string[];
  /** Chaves que sumiram sem passar pelo Sante: a linha do relatório. */
  readonly foraDoSante: readonly string[];
}

/**
 * Compara dois retratos (puro): as chaves que sumiram, separadas entre as que o Sante excluiu e as de fora. Sem as
 * chaves (tabela acima do teto), a queda da contagem além das exclusões do Sante conta como exclusão de fora.
 */
export function compararRetratos(
  antes: RetratoVigia,
  depois: RetratoVigia,
  excluidasPeloSante: ReadonlySet<string>,
): AchadoVigia | null {
  if (antes.contagem === depois.contagem && antes.checksum === depois.checksum) return null;
  let sumidas: string[];
  if (antes.chaves.length === antes.contagem && depois.chaves.length === depois.contagem) {
    const agora = new Set(depois.chaves);
    sumidas = antes.chaves.filter((c) => !agora.has(c));
  } else {
    const n = Math.max(0, antes.contagem - depois.contagem - excluidasPeloSante.size);
    sumidas = [...excluidasPeloSante, ...Array.from({ length: n }, (_, i) => `?${i + 1}`)];
  }
  const peloSante = sumidas.filter((c) => excluidasPeloSante.has(c));
  const foraDoSante = sumidas.filter((c) => !excluidasPeloSante.has(c));
  if (foraDoSante.length === 0) return null;
  return {
    tabela: antes.tabela,
    contagemAntes: antes.contagem,
    contagemDepois: depois.contagem,
    peloSante,
    foraDoSante,
  };
}

/** O último retrato guardado da tabela (ou null). */
export async function ultimoRetratoVigia(
  l: Leitor,
  hospital: string,
  tabela: string,
): Promise<(RetratoVigia & { readonly id: string; readonly lidoEm: Date | null }) | null> {
  const [x] = await l.consultar(
    `SELECT FIRST 1 CAST(ID AS VARCHAR(20)) ID, CONTAGEM, CHECKSUM, CHAVES, LIDO_EM FROM SGH_CRUD_VIGIA_RETRATO
      WHERE HOSPITAL = ? AND TABELA = ? ORDER BY ID DESC`,
    [hospital, tabela],
    { teto: 1 },
  );
  if (!x) return null;
  const bruto = x['CHAVES'];
  const texto =
    bruto === null || bruto === undefined
      ? '[]'
      : typeof bruto === 'string'
        ? bruto
        : (await l.lerBlob(bruto)).toString('latin1');
  return {
    id: txt(x['ID']),
    tabela,
    contagem: Number(x['CONTAGEM']),
    checksum: Number(x['CHECKSUM']),
    chaves: JSON.parse(texto || '[]') as string[],
    lidoEm: x['LIDO_EM'] instanceof Date ? x['LIDO_EM'] : null,
  };
}

/**
 * As chaves que cabem inteiras na coluna CHAVES (JSON ASCII ≤ `tamanho`): tira chaves do fim até caber (nunca corta o
 * texto do JSON, que ficaria ilegível).
 */
export function chavesQueCabem(chaves: readonly string[], tamanho = TAMANHO_CHAVES_ACHADO): string[] {
  const r: string[] = [];
  for (const c of chaves) {
    if (jsonAscii([...r, c]).length > tamanho) break;
    r.push(c);
  }
  return r;
}

/** O início da busca das exclusões do Sante para comparar com o retrato lido em `lidoEm` (com o recuo). */
export function inicioDaBusca(lidoEm: Date | null): Date | null {
  return lidoEm ? new Date(lidoEm.getTime() - MARGEM_VIGIA_MS) : null;
}

/** As chaves que o Sante excluiu da tabela desde o instante (registro do evento e retrato D-CRUD-SNAP). */
export async function excluidasPeloSanteDesde(
  l: Leitor,
  hospital: string,
  tabela: string,
  desde: Date | null,
): Promise<Set<string>> {
  const r = new Set<string>();
  const p = desde ? [hospital, tabela, desde] : [hospital, tabela];
  for (const sql of [
    `SELECT CHAVE FROM SGH_CRUD_EVENTO WHERE HOSPITAL = ? AND TABELA = ? AND EVENTO = 'excluido'${desde ? ' AND CRIADO_EM >= ?' : ''}`,
    `SELECT CHAVE FROM SGH_HIST_EXCLUSAO WHERE HOSPITAL = ? AND TABELA = ?${desde ? ' AND EXCLUIDO_EM >= ?' : ''}`,
  ])
    for (const x of await l.consultar(sql, p, { teto: 50_000 })) r.add(txt(x['CHAVE']));
  return r;
}

async function gravarRetratoVigia(
  es: Pick<Escritor, 'executarRetornando'>,
  hospital: string,
  r: RetratoVigia,
  lidoEm: Date | null,
) {
  const x = await es.executarRetornando(
    lidoEm
      ? `INSERT INTO SGH_CRUD_VIGIA_RETRATO (ID, HOSPITAL, TABELA, CONTAGEM, CHECKSUM, CHAVES, LIDO_EM)
     VALUES (NEXT VALUE FOR SGH_GEN_CRUD_VIGIA_RETRATO, ?, ?, ?, ?, ?, ?) RETURNING ID`
      : `INSERT INTO SGH_CRUD_VIGIA_RETRATO (ID, HOSPITAL, TABELA, CONTAGEM, CHECKSUM, CHAVES)
     VALUES (NEXT VALUE FOR SGH_GEN_CRUD_VIGIA_RETRATO, ?, ?, ?, ?, ?) RETURNING ID`,
    [
      hospital,
      r.tabela,
      r.contagem,
      r.checksum,
      Buffer.from(jsonAscii(r.chaves), 'ascii'),
      ...(lidoEm ? [lidoEm] : []),
    ],
  );
  return txt(x['ID']);
}

/** A vigia está ligada? O valor vigente do parâmetro no estabelecimento ou na rede; sem valor, o padrão (desligada). */
export async function vigiaLigada(l: Leitor, hospital: string): Promise<boolean> {
  const linhas = await l.consultar(
    `SELECT FIRST 1 VALOR FROM SGH_CFG_PARAMETRO
      WHERE HOSPITAL = ? AND CHAVE = ? AND NIVEL IN ('estabelecimento', 'rede')
        AND VIGENTE_DESDE <= CURRENT_TIMESTAMP AND (VIGENTE_ATE IS NULL OR VIGENTE_ATE > CURRENT_TIMESTAMP)
      ORDER BY CASE NIVEL WHEN 'estabelecimento' THEN 0 ELSE 1 END, VIGENTE_DESDE DESC`,
    [hospital, PARAMETRO_VIGIA],
    { teto: 1 },
  );
  return txt(linhas[0]?.['VALOR']).toLowerCase() === 'sim';
}

export interface ResultadoVigiaReconciliacao {
  readonly ligada: boolean;
  readonly tabelas: number;
  readonly achados: readonly AchadoVigia[];
}

/**
 * Uma rodada da vigia nos domínios declarados: para cada tabela, compara o retrato atual com o último guardado, grava o
 * achado (exclusões feitas fora do Sante) e o retrato novo. Desligada pelo parâmetro: nada é lido nem gravado.
 */
export async function rodarVigia(
  e: Escritor,
  hospital: string,
  declaracoes: readonly DeclaracaoDominio[],
): Promise<ResultadoVigiaReconciliacao> {
  if (!(await vigiaLigada(e, hospital))) return { ligada: false, tabelas: 0, achados: [] };
  const tabelas = new Map<string, readonly string[]>();
  for (const d of declaracoes) if (!tabelas.has(d.tabela)) tabelas.set(d.tabela, chavesDe(d));
  const achados: AchadoVigia[] = [];
  for (const [tabela, chave] of tabelas) {
    const anterior = await ultimoRetratoVigia(e, hospital, tabela);
    // O instante do banco ANTES de ler a tabela (o retrato vale a partir dele).
    const lidoEm = await instanteDoBanco(e);
    const atual = await lerRetratoVigia(e, tabela, chave);
    const idNovo = await gravarRetratoVigia(e, hospital, atual, lidoEm);
    if (!anterior) continue;
    const peloSante = await excluidasPeloSanteDesde(e, hospital, tabela, inicioDaBusca(anterior.lidoEm));
    const a = compararRetratos(anterior, atual, peloSante);
    if (!a) continue;
    achados.push(a);
    await e.executar(
      `INSERT INTO SGH_CRUD_VIGIA_ACHADO (ID, HOSPITAL, TABELA, CONTAGEM_ANTES, CONTAGEM_DEPOIS, PELO_SANTE, FORA_DO_SANTE,
         CHAVES, ID_RETRATO_ANTES, ID_RETRATO_DEPOIS)
       VALUES (NEXT VALUE FOR SGH_GEN_CRUD_VIGIA_ACHADO, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hospital,
        tabela,
        a.contagemAntes,
        a.contagemDepois,
        a.peloSante.length,
        a.foraDoSante.length,
        jsonAscii(chavesQueCabem(a.foraDoSante.slice(0, 100))),
        anterior.id,
        idNovo,
      ],
    );
  }
  return { ligada: true, tabelas: tabelas.size, achados };
}

export interface LinhaRelatorioExclusoesFora {
  readonly tabela: string;
  /** Rótulo de produto (o domínio declarado), para a tela e o relatório; nunca o nome do sistema anterior. */
  readonly rotulo: string;
  readonly detectadoEm: string;
  readonly contagemAntes: number;
  readonly contagemDepois: number;
  readonly foraDoSante: number;
  readonly chaves: readonly string[];
}

/** O relatório "exclusões feitas fora do Sante" (os achados do período, do mais recente ao mais antigo). */
export async function relatorioExclusoesFora(
  l: Leitor,
  hospital: string,
  rotulo: (tabela: string) => string | undefined,
  desde?: Date,
): Promise<LinhaRelatorioExclusoesFora[]> {
  const linhas = await l.consultar(
    `SELECT FIRST 500 TABELA, CONTAGEM_ANTES, CONTAGEM_DEPOIS, FORA_DO_SANTE, CHAVES, DETECTADO_EM
       FROM SGH_CRUD_VIGIA_ACHADO WHERE HOSPITAL = ?${desde ? ' AND DETECTADO_EM >= ?' : ''} ORDER BY ID DESC`,
    desde ? [hospital, desde] : [hospital],
    { teto: 500 },
  );
  return linhas.map((x) => ({
    tabela: txt(x['TABELA']),
    rotulo: rotulo(txt(x['TABELA'])) ?? 'Cadastro',
    detectadoEm: x['DETECTADO_EM'] instanceof Date ? x['DETECTADO_EM'].toISOString() : txt(x['DETECTADO_EM']),
    contagemAntes: Number(x['CONTAGEM_ANTES']),
    contagemDepois: Number(x['CONTAGEM_DEPOIS']),
    foraDoSante: Number(x['FORA_DO_SANTE']),
    chaves: chavesDoAchado(txt(x['CHAVES'])),
  }));
}

/** As chaves gravadas no achado; o texto ilegível (linha antiga cortada) não derruba o relatório: lista vazia. */
export function chavesDoAchado(texto: string): string[] {
  try {
    const v: unknown = JSON.parse(texto || '[]');
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** O relógio do banco (CURRENT_TIMESTAMP), ou null quando a leitura não o devolve como data. */
async function instanteDoBanco(l: Leitor): Promise<Date | null> {
  const [x] = await l.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
  return x?.['T'] instanceof Date ? x['T'] : null;
}
