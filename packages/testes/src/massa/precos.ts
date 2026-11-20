// Massa sintética do M12 (convênios e preços): escolhe na cópia, dentro da transação desfeita da reprodução,
// convênios e itens de tabela que servem a cada cenário (só códigos e valores em memória; nada impresso nem
// gravado em arquivo) e monta as entradas das operações. Escrita direta só para PREPARAR uma recusa (valor
// mudado por fora; diária de acompanhante inválida), sempre na transação desfeita, nunca confirmada.
import type { ComponentesPreco, ReajustarEntrada } from '@sgh/contratos';
import { dataParam, decodificarCp1252, type Escritor, type Leitor } from '@sgh/legado';

export const MARCA_M12 = 'SGH M12 SINTETICO';

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown): string =>
  v === null || v === undefined ? '' : (Buffer.isBuffer(v) ? decodificarCp1252(v) : String(v)).trim();

let seq = 0;
export const loteSintetico = (prefixo: string) =>
  `${prefixo}-${Date.now().toString(36)}-${(seq++).toString(36)}`.slice(0, 40);

export async function hojeDoBanco(l: Leitor): Promise<string> {
  const [r] = await l.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
    teto: 1,
  });
  return s(r?.['H']);
}

/** Convênio na situação pedida e com a diária de acompanhante válida (ou sem) para o trigger aceitar. */
export async function convenioNaSituacao(l: Leitor, situacao: 'A' | 'I'): Promise<number> {
  const linhas = await l.consultar(
    `SELECT FIRST 1 c.COD FROM TBCONVEN c LEFT JOIN TBTABDTH d ON d.ID = c.ID_TBTABDTH_COB_DIARIA_ACOMP
      WHERE c.SITUACAO = ? AND (d.ID IS NULL OR (d.TIPO = 1 AND d.SUBTIPO = 5)) ORDER BY c.COD`,
    [situacao],
    { teto: 1 },
  );
  if (!linhas[0]) throw new Error(`Nenhum convênio ${situacao} com diária de acompanhante válida.`);
  return n(linhas[0]['COD']);
}

/** Convênio cuja diária de acompanhante o trigger recusa; sem nenhum, invalida uma (na transação desfeita). */
export async function convenioComDiariaInvalida(e: Escritor): Promise<{ codigo: number; situacao: string }> {
  const [r] = await e.consultar(
    `SELECT FIRST 1 c.COD, c.SITUACAO FROM TBCONVEN c JOIN TBTABDTH d ON d.ID = c.ID_TBTABDTH_COB_DIARIA_ACOMP
      WHERE d.TIPO <> 1 OR d.SUBTIPO <> 5 ORDER BY c.COD`,
    [],
    { teto: 1 },
  );
  if (r) return { codigo: n(r['COD']), situacao: s(r['SITUACAO']) };
  const [c] = await e.consultar(
    `SELECT FIRST 1 c.COD, c.SITUACAO, c.ID_TBTABDTH_COB_DIARIA_ACOMP D FROM TBCONVEN c
      WHERE c.ID_TBTABDTH_COB_DIARIA_ACOMP IS NOT NULL ORDER BY c.COD`,
    [],
    { teto: 1 },
  );
  if (!c) throw new Error('Nenhum convênio com diária de acompanhante.');
  await e.executar('UPDATE TBTABDTH SET SUBTIPO = 4 WHERE ID = ?', [n(c['D'])]);
  return { codigo: n(c['COD']), situacao: s(c['SITUACAO']) };
}

export interface ContratoLido {
  readonly codigo: number;
  readonly nome: string;
  readonly validaCarteira: string;
  readonly retornoDias: number;
  readonly prazoPagamentoDias: number;
}

export async function contratoAtivo(l: Leitor): Promise<ContratoLido> {
  const cod = await convenioNaSituacao(l, 'A');
  const [r] = await l.consultar(
    'SELECT COD, NOME, VAL_CART, RETORNO, PRAZO_PGTO FROM TBCONVEN WHERE COD = ?',
    [cod],
    {
      teto: 1,
    },
  );
  return {
    codigo: cod,
    nome: s(r?.['NOME']),
    validaCarteira: s(r?.['VAL_CART']),
    retornoDias: n(r?.['RETORNO']),
    prazoPagamentoDias: n(r?.['PRAZO_PGTO']),
  };
}

export interface ItemSintetico {
  readonly codigo: number;
  readonly vigencia: string;
  readonly valores: ComponentesPreco;
}

/**
 * Itens ativos da tabela com CH = 0 (ou ≠ 0, para a recusa do modelo AMB), com vigência anterior a hoje, sem
 * linha hoje e com os componentes além do CH zerados (a forma que o perfil viu em 100% da janela).
 */
export async function itensDaTabela(
  l: Leitor,
  tabela: number,
  quantos: number,
  comCh = false,
): Promise<ItemSintetico[]> {
  const linhas = await l.consultar(
    `SELECT FIRST ${quantos} t.COD, CAST(v.DATA AS VARCHAR(10)) VIG, v.VALOR_CH, v.VALOR_CO, v.VALOR_FILME, v.VALOR_ANES, v.VALOR_OUTROS
       FROM TBTABTHM t
       JOIN TBVLRTHM v ON v.TAB = t.TAB AND v.COD = t.COD AND v.DATA = (SELECT MAX(v2.DATA) FROM TBVLRTHM v2
         WHERE v2.TAB = t.TAB AND v2.COD = t.COD AND v2.DATA <= CURRENT_DATE)
      WHERE t.TAB = ? AND t.SITUACAO = 'A' AND ${comCh ? 't.CH <> 0' : 't.CH = 0'}
        AND v.DATA < CURRENT_DATE AND v.VALOR_CH > 0 AND v.VALOR_CO = 0 AND v.VALOR_FILME = 0 AND v.VALOR_ANES = 0
        AND v.VALOR_OUTROS = 0
        AND NOT EXISTS (SELECT 1 FROM TBVLRTHM f WHERE f.TAB = t.TAB AND f.COD = t.COD AND f.DATA >= CURRENT_DATE)
      ORDER BY t.COD`,
    [tabela],
    { teto: quantos, tempoMaximoMs: 120_000 },
  );
  if (linhas.length < quantos)
    throw new Error(`Tabela ${tabela}: só ${linhas.length} item(ns) para o cenário.`);
  return linhas.map((r) => ({
    codigo: n(r['COD']),
    vigencia: s(r['VIG']).slice(0, 10),
    valores: {
      ch: n(r['VALOR_CH']),
      co: n(r['VALOR_CO']),
      filme: n(r['VALOR_FILME']),
      anes: n(r['VALOR_ANES']),
      outros: n(r['VALOR_OUTROS']),
    },
  }));
}

/** Itens ativos com CH ≠ 0 (modelo AMB), com ou sem vigência: só para a recusa do veto. */
export async function itensModeloCh(l: Leitor, tabela: number, quantos: number): Promise<ItemSintetico[]> {
  const linhas = await l.consultar(
    `SELECT FIRST ${quantos} t.COD FROM TBTABTHM t WHERE t.TAB = ? AND t.SITUACAO = 'A' AND t.CH <> 0 ORDER BY t.COD`,
    [tabela],
    { teto: quantos },
  );
  if (linhas.length < quantos) throw new Error(`Tabela ${tabela}: sem item do modelo CH.`);
  return linhas.map((r) => ({
    codigo: n(r['COD']),
    vigencia: '',
    valores: { ch: 10, co: 0, filme: 0, anes: 0, outros: 0 },
  }));
}

/** Entrada de `preco.reajustar` para os itens (percentual de 5% ou valores por arquivo). */
export function entradaReajuste(
  tabela: number,
  data: string,
  itens: readonly ItemSintetico[],
  modo: 'percentual' | 'arquivo',
  confirmacoes: { tabelaCompartilhada: boolean; percentualTabela: boolean } = {
    tabelaCompartilhada: false,
    percentualTabela: false,
  },
): ReajustarEntrada {
  return {
    tabela,
    data,
    lote: loteSintetico('repro'),
    parte: 1,
    partes: 1,
    modo,
    percentual: modo === 'percentual' ? 5 : null,
    origem: modo === 'arquivo' ? 'importacao' : 'reajuste',
    carga: null,
    justificativa: `${MARCA_M12}: reprodução do cenário de assinatura`,
    confirmacoes,
    itens: itens.map((i) => ({
      codigo: i.codigo,
      base: i.vigencia ? { vigencia: i.vigencia, valores: i.valores } : null,
      novos: {
        ...i.valores,
        ch: modo === 'percentual' ? Math.round(i.valores.ch * 1.05 * 100) / 100 : i.valores.ch + 1.2345,
      },
    })),
  };
}

/** Muda por fora (na transação desfeita) o valor de uma vigência: prepara a recusa do desfazer. */
export async function mexerPorFora(e: Escritor, tabela: number, codigo: number, data: string): Promise<void> {
  await e.executar(
    'UPDATE TBVLRTHM SET VALOR_CH = VALOR_CH + 1 WHERE TAB = ? AND COD = ? AND DATA = CAST(? AS DATE)',
    [tabela, codigo, dataParam(data)],
  );
}

// ── Integração do M12 (testes na cópia, sempre em transação desfeita ou só leitura) ─────────────────────

/** Vigência inserida POR FORA (como o SPDATA faria) na transação desfeita: prepara a colisão. */
export async function inserirVigenciaPorFora(
  e: Escritor,
  tabela: number,
  codigo: number,
  data: string,
  ch: number,
): Promise<void> {
  await e.executar(
    'INSERT INTO TBVLRTHM (TAB, COD, DATA, VALOR_CH, VALOR_CO, VALOR_OUTROS, VALOR_ANES, VALOR_FILME) VALUES (?, ?, ?, ?, 0, 0, 0, 0)',
    [tabela, codigo, dataParam(data), ch],
  );
}

/** Segura o item da tabela numa segunda conexão (SELECT … WITH LOCK numa transação de escrita desfeita). */
export async function travarItemDaTabela(e: Escritor, tabela: number, codigo: number): Promise<void> {
  await e.consultar('SELECT TAB, COD FROM TBTABTHM WHERE TAB = ? AND COD = ? WITH LOCK', [tabela, codigo], {
    teto: 1,
  });
}

/** Linhas de TBVLRTHM na data para os itens (prova de que nada ficou gravado). */
export async function linhasNaData(
  l: Leitor,
  tabela: number,
  codigos: readonly number[],
  data: string,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < codigos.length; i += 200) {
    const b = codigos.slice(i, i + 200);
    const [r] = await l.consultar(
      `SELECT COUNT(*) N FROM TBVLRTHM WHERE TAB = ? AND DATA = ? AND COD IN (${b.map(() => '?').join(', ')})`,
      [tabela, dataParam(data), ...b],
      { teto: 1 },
    );
    total += n(r?.['N']);
  }
  return total;
}

/**
 * 1% dos pares (TAB, COD) de TBVLRTHM com item em TBTABTHM, sorteados de forma determinística (passo fixo
 * sobre a lista ordenada pela chave), para a prova do "valor vigente em data".
 */
export async function paresSorteados(l: Leitor, fracao = 0.01): Promise<{ tab: number; cod: number }[]> {
  const linhas = await l.consultar(
    'SELECT v.TAB, v.COD FROM TBVLRTHM v JOIN TBTABTHM t ON t.TAB = v.TAB AND t.COD = v.COD GROUP BY v.TAB, v.COD ORDER BY v.TAB, v.COD',
    [],
    { teto: 300_000, tempoMaximoMs: 300_000 },
  );
  const passo = Math.max(1, Math.round(1 / fracao));
  return linhas
    .filter((_, i) => i % passo === 7 % passo)
    .map((r) => ({ tab: n(r['TAB']), cod: n(r['COD']) }));
}

/**
 * O valor vigente pela regra da sante-api (src/services/valores.js): a linha de TBVLRTHM com DATA = MAX(DATA)
 * até a data, e o total = soma dos cinco componentes. Independente do repositório do novo.
 */
export async function valorPelaRegraSanteApi(
  l: Leitor,
  tabela: number,
  codigo: number,
  data: string,
): Promise<number | null> {
  const [r] = await l.consultar(
    `SELECT v.VALOR_CH, v.VALOR_CO, v.VALOR_FILME, v.VALOR_ANES, v.VALOR_OUTROS FROM TBVLRTHM v
      WHERE v.TAB = ? AND v.COD = ? AND v.DATA = (SELECT MAX(v2.DATA) FROM TBVLRTHM v2
        WHERE v2.TAB = v.TAB AND v2.COD = v.COD AND v2.DATA <= ?)`,
    [tabela, codigo, dataParam(data)],
    { teto: 1 },
  );
  // valores.js soma em JavaScript com Number(): componente NULL conta 0 (no SQL, a soma daria NULL).
  return r
    ? Number(r['VALOR_CH']) +
        Number(r['VALOR_CO']) +
        Number(r['VALOR_FILME']) +
        Number(r['VALOR_ANES']) +
        Number(r['VALOR_OUTROS'])
    : null;
}

const um = async (l: Pick<Leitor, 'consultar'>, sql: string, p: readonly unknown[] = []): Promise<number> => {
  const [r] = await l.consultar(sql, p, { teto: 1 });
  return n(r?.['N']);
};

/**
 * Contagens das tabelas que o M12 toca, filtradas pelo que o teste grava (o usuário de teste, as tabelas de
 * preço sintéticas e os eventos do marco): igualdade antes e depois prova que o ROLLBACK não deixou nada.
 */
export async function contagensM12(
  l: Pick<Leitor, 'consultar'>,
  usuario: string,
): Promise<Record<string, number>> {
  return {
    TBVLRTHM: await um(l, 'SELECT COUNT(*) N FROM TBVLRTHM WHERE TAB IN (305, 306, 307)'),
    HTCONVEN: await um(l, 'SELECT COUNT(*) N FROM HTCONVEN'),
    'TBCONVEN:A': await um(l, "SELECT COUNT(*) N FROM TBCONVEN WHERE SITUACAO = 'A'"),
    SGH_PRECO_AUTORIA: await um(l, 'SELECT COUNT(*) N FROM SGH_PRECO_AUTORIA WHERE AUTOR = ?', [usuario]),
    SGH_TRILHA: await um(l, 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE USUARIO = ?', [usuario]),
    SGH_IDEMPOTENCIA: await um(l, 'SELECT COUNT(*) N FROM SGH_IDEMPOTENCIA WHERE USUARIO = ?', [usuario]),
    SGH_OUTBOX: await um(
      l,
      "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO STARTING WITH 'preco.' OR TIPO STARTING WITH 'convenio.'",
    ),
  };
}

/** O convênio está na situação (TBCONVEN.SITUACAO)? */
export async function convenioEstaNaSituacao(l: Pick<Leitor, 'consultar'>, cod: number, situacao: string) {
  return (
    (await um(l, 'SELECT COUNT(*) N FROM TBCONVEN WHERE COD = ? AND SITUACAO = ?', [cod, situacao])) === 1
  );
}

/** Retratos do convênio em HTCONVEN (o TRG_TBCONVEN_AIU grava um quando muda NOME ou CLASSIF_C). */
export function retratosDoConvenio(l: Pick<Leitor, 'consultar'>, cod: number): Promise<number> {
  return um(l, 'SELECT COUNT(*) N FROM HTCONVEN WHERE ID_TBCONVEN = ?', [cod]);
}
