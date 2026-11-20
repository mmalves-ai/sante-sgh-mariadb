// Reprodução dos cenários de assinatura do financeiro (M32; ficha, seção 9) pelo EXECUTOR, na transação da captura
// (sempre desfeita). Credores, contas bancárias, classificações, retenções, profissionais e contas do faturamento são os
// da cópia (só os códigos e IDs, em memória; nenhum valor de linha sai); o documento é sintético (faixa 19xxxxxxxx).
//   - criarTituloPagar: fornecedor (1 e 3 parcelas), com retenção, médico; excluir o título em aberto criado pelo
//     executor; as recusas: excluir título pago da cópia e a chave natural repetida;
//   - baixarTitulo: o título criado pelo executor, lançado por outra pessoa e aprovado por uma terceira na alçada
//     sintética (SGH_ na mesma transação desfeita); a conta da cópia no escopo do operador (MFCTAUSU na transação);
//     pagar sem e com borderô, receber manual um título a receber em aberto da cópia; as recusas: sem aprovação e o
//     título baixado "no outro sistema" depois da leitura (UPDATE na transação, versão lida antes);
//   - criarTituloReceber: duas contas apresentadas de um convênio e competência sem título; uma do particular externo;
//     a recusa na conta já titulada;
//   - lancarMovimento: os cinco tipos nas contas da cópia (no escopo do operador); a recusa fora do escopo.
//   - M53.9: criarTituloPagar, ação incluir-folha: o líquido da folha mensal (`origem-folha`) e dois encargos, INSS e
//     FGTS (`origem-encargo`), de um período sintético (origem e período fora de qualquer folha real; o registro em
//     SGH_PES_FOLHA_* e na SGH_OUTBOX desfeito junto); a recusa da folha repetida (a mesma origem lançada duas vezes).
import { contratoSintetico } from './contrato-sintetico.js';
import { type CenarioCaptura, ErroOperacao, type Escritor, versaoDaLinhaFaturamento } from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (e: Escritor, operacao: string, entrada: unknown) => Promise<unknown>;

export const OPERACOES_REPRODUCAO_FINANCEIRO = new Set([
  'financeiro.criarTituloPagar',
  'financeiro.baixarTitulo',
  'financeiro.criarTituloReceber',
  'financeiro.lancarMovimento',
]);

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const p2 = (n: number) => String(n).padStart(2, '0');
const dia = (v: unknown) =>
  v instanceof Date ? `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}` : txt(v).slice(0, 10);
const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

async function um(
  e: Escritor,
  sql: string,
  o: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> {
  const [r] = await e.consultar(sql, params, { teto: 1, tempoMaximoMs: 120_000 });
  if (!r) throw new Error(`Cenário sem dado na cópia: ${o}.`);
  return r;
}

/** Documento sintético livre para o credor (faixa alta, nunca usada pelo outro sistema). */
async function documentoLivre(e: Escritor, credor: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const doc = 1_900_000_000 + ((Date.now() + i * 7_919) % 99_999_999);
    const [r] = await e.consultar(
      'SELECT COUNT(*) N FROM MFCONPAG WHERE FORN = ? AND DOC = ?',
      [credor, doc],
      {
        teto: 1,
      },
    );
    if (num(r?.['N']) === 0) return doc;
  }
  throw new Error('Sem documento sintético livre.');
}

/** Fornecedor com título manual recente (o cadastro existe). */
const SQL_FORNECEDOR = `SELECT FIRST 1 c.FORN FROM MFCONPAG c WHERE c.ONDE = 'F' AND c.TIPO = 'F' AND c.EMISSAO >= '2026-01-01'
  AND EXISTS (SELECT 1 FROM TBFORNEC f WHERE f.COD = c.FORN) ORDER BY c.ID DESC`;
/** Classificação gerencial recente de título a pagar (existe em TBITEDES). */
const SQL_CLASSIFICACAO = `SELECT FIRST 1 g.GRUPO, g.SUBGRUPO, g.ITEM FROM MFLANGSI g WHERE g.TP_LAN = 0 AND g.DATA >= '2026-01-01'
  AND EXISTS (SELECT 1 FROM TBITEDES t WHERE t.GRUPO = g.GRUPO AND t.SUBGRUPO = g.SUBGRUPO AND t.ITEM = g.ITEM) ORDER BY g.DATA DESC`;
/** Retenção recente de título a pagar (a conta de MFREFDES). */
const SQL_RETENCAO = `SELECT FIRST 1 d.CONTA FROM MFDESACR d WHERE d.TP_LAN = 0 AND d.DATA >= '2026-01-01' AND d.TPDES_ACR = 6
  AND EXISTS (SELECT 1 FROM MFREFDES r WHERE r.EMPRESA = 1 AND r.COD = d.CONTA) ORDER BY d.ID DESC`;
/** Médico com título de médico vinculado (TBCBOPRO.COD = o credor). */
const SQL_MEDICO = `SELECT FIRST 1 b.ID, b.COD FROM MFCONPAG_TBCBOPRO x JOIN TBCBOPRO b ON b.ID = x.ID_TBCBOPRO
  JOIN MFCONPAG c ON c.ID = x.ID_MFCONPAG WHERE c.TIPO = 'M' AND c.FORN = b.COD AND c.EMISSAO >= '2025-06-01' ORDER BY c.ID DESC`;
/** Conta bancária que pagou títulos recentes (ativa). */
const SQL_CONTA = (n: number, uso: 'pagar' | 'bordero' | 'receber' = 'pagar') =>
  `SELECT FIRST 1 SKIP ${n} t.ID, t.ID_CTABAN FROM TBCTABAN t WHERE t.EMPRESA = 1 AND ${
    uso === 'bordero'
      ? "EXISTS (SELECT 1 FROM MFBORDER b WHERE b.ID_TBCTABAN = t.ID AND b.DATA >= '2026-01-01')"
      : uso === 'receber'
        ? "EXISTS (SELECT 1 FROM MFCTAREC r WHERE r.ID_TBCTABAN = t.ID AND r.PGTO >= '2026-01-01')"
        : "EXISTS (SELECT 1 FROM MFCONPAG c WHERE c.ID_TBCTABAN = t.ID AND c.DT_PGTO >= '2026-01-01')"
  } ORDER BY t.ID`;
/** Duas pessoas do cadastro de usuários (o lançador e o aprovador; só em memória). */
const SQL_USUARIOS = `SELECT FIRST 2 u.NOME, u.ID_TBUSERS FROM TBUSERS u WHERE u.NOME IN (SELECT FIRST 50 c.USUARIO FROM MFCONPAG c
  WHERE c.EMISSAO >= '2026-01-01' AND c.USUARIO IS NOT NULL ORDER BY c.ID DESC) ORDER BY u.ID_TBUSERS`;

export function cenarioFinanceiro(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  hospital: string,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  const chave = `${nome}/${cenario}`;
  let operador = '';
  let entrada: Record<string, unknown> = {};
  let credor = 0;
  let documento = 0;
  let tipo = 'F';
  let titulos: number[] = [];
  /** M53.9: os documentos dos títulos da folha (um por título: credor e documento próprios). */
  const docsFolha: { credor: number; documento: number }[] = [];
  let tituloReceber = 0;
  let contas: number[] = [];
  let versaoTitulo: string | null = null;
  let docReceber = 0;
  const cabecalhos: number[] = [];
  const movimentos: number[] = [];
  const recebiveis: number[] = [];
  const borderos: number[] = [];

  async function idOperador(e: Escritor): Promise<number> {
    const [u] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [operador], { teto: 1 });
    return num(u?.['ID_TBUSERS']);
  }
  async function noEscopo(e: Escritor, ctaban: number): Promise<void> {
    await e.executar('INSERT INTO MFCTAUSU (ID_TBUSERS, ID_TBCTABAN) VALUES (?, ?)', [
      await idOperador(e),
      ctaban,
    ]);
  }
  async function entradaTitulo(e: Escritor, parcelas: number): Promise<Record<string, unknown>> {
    const c = await um(e, SQL_CLASSIFICACAO, 'classificação gerencial');
    const valor = 1_234.56 * parcelas;
    const hoje = dia((await um(e, 'SELECT CURRENT_DATE H FROM RDB$DATABASE', 'data'))['H']);
    return {
      acao: 'incluir',
      tipo,
      credor,
      profissional: null,
      documento,
      serie: '1',
      emissao: hoje,
      entrada: null,
      nf: 0,
      valorDocumento: Math.round(valor * 100) / 100,
      referente: 'SINTETICO M32',
      observacao: '',
      parcelas: Array.from({ length: parcelas }, (_x, i) => ({
        parcela: i + 1,
        vencimento: somarDias(hoje, 30 * (i + 1)),
        valor: 1_234.56,
      })),
      classificacao: { grupo: num(c['GRUPO']), subgrupo: num(c['SUBGRUPO']), item: num(c['ITEM']) },
      retencoes: [],
      centroCusto: null,
      rateio: [],
    };
  }
  /** M53.9: os títulos da folha de um período sintético (um por destino, cada um com credor e documento livres). */
  async function entradaFolha(e: Escritor, destinos: readonly ('liquido-mensal' | 'inss' | 'fgts')[]) {
    const c = await um(e, SQL_CLASSIFICACAO, 'classificação gerencial');
    const hoje = dia((await um(e, 'SELECT CURRENT_DATE H FROM RDB$DATABASE', 'data'))['H']);
    const forn = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
    const rotina = { 'liquido-mensal': 4, inss: 16, fgts: 15 } as const;
    const valor = { 'liquido-mensal': 1_234_56, inss: 234_56, fgts: 98_76 } as const;
    const titulos: Record<string, unknown>[] = [];
    for (const d of destinos) {
      const doc = await documentoLivre(e, forn);
      docsFolha.push({ credor: forn, documento: doc });
      titulos.push({
        chave: `${d}:${somarDias(hoje, 20)}`,
        destino: d,
        rotina: rotina[d],
        credor: forn,
        documento: doc,
        vencimento: somarDias(hoje, 20),
        valor: valor[d],
        classificacao: { grupo: num(c['GRUPO']), subgrupo: num(c['SUBGRUPO']), item: num(c['ITEM']) },
        referente: 'SINTETICO M53.9',
      });
    }
    const liquido = destinos.includes('liquido-mensal') ? valor['liquido-mensal'] : 0;
    const total = titulos.reduce((a, t) => a + num(t['valor']), 0);
    credor = forn;
    documento = docsFolha[0]?.documento ?? 0;
    return {
      acao: 'incluir-folha',
      empresa: 1,
      origem: 'fechamento',
      // Origem e período sintéticos: nenhum fechamento real tem este ID nem este período.
      idOrigem: 1_900_000_000 + (Date.now() % 99_999_999),
      apuracao: 'mensal',
      periodo: '2099-12',
      resumo: 'e'.repeat(64),
      emissao: hoje,
      liquido,
      encargos: total - liquido,
      titulos,
      fatos: [{ rotina: 4, centroCusto: 0, natureza: 'provento', contabiliza: true, valor: total }],
    };
  }
  /** O título a pagar de partida (pelo executor), lançado por outra pessoa (o lançador da cópia). */
  async function tituloDePartida(e: Escritor, aprovado: boolean): Promise<void> {
    credor = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
    documento = await documentoLivre(e, credor);
    const r = (await executarOutra(e, 'financeiro.criarTituloPagar', await entradaTitulo(e, 1))) as {
      resultado?: Record<string, unknown>;
    };
    titulos = [num(r.resultado?.['titulo'])];
    const us = await e.consultar(SQL_USUARIOS, [], { teto: 2, tempoMaximoMs: 120_000 });
    const lancador = txt(us[0]?.['NOME']);
    const aprovador = txt(us[1]?.['NOME']);
    if (!lancador || !aprovador) throw new Error('Cenário sem usuários de partida na cópia.');
    await e.executar('UPDATE MFCONPAG SET USUARIO = ? WHERE ID = ?', [lancador, titulos[0]]);
    const [f] = await e.consultar(
      'SELECT CAST(NEXT VALUE FOR SGH_GEN_FIN_ALCADA AS VARCHAR(20)) ID FROM RDB$DATABASE',
      [],
      { teto: 1 },
    );
    const faixa = txt(f?.['ID']);
    await e.executar(
      `INSERT INTO SGH_FIN_ALCADA (ID, HOSPITAL, EMPRESA, VALOR_DE, APROVACOES, PERMISSAO, VIGENCIA_INICIO, ATIVA, ALTERADO_POR)
       VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, 1, 0, 1, 'financeiro.tituloPagar.aprovar', '2000-01-01', 'S', ?)`,
      [faixa, hospital, aprovador],
    );
    if (aprovado) {
      const [a] = await e.consultar(
        'SELECT CAST(NEXT VALUE FOR SGH_GEN_FIN_APROVACAO AS VARCHAR(20)) ID FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      await e.executar(
        `INSERT INTO SGH_FIN_APROVACAO (ID, HOSPITAL, ID_MFCONPAG, EMPRESA, FORN, DOC, PARC, TIPO, SERIE, VALOR_DOCUMENTO,
           ID_ALCADA, ORDEM, APROVADOR) VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, 1, ?, ?, 1, 'F', '1', 1234.56,
           CAST(CAST(? AS VARCHAR(20)) AS BIGINT), 1, ?)`,
        [txt(a?.['ID']), hospital, titulos[0], credor, documento, faixa, aprovador],
      );
    }
    const [v] = await e.consultar(
      'SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM MFCONPAG WHERE ID = ?',
      [titulos[0]],
      {
        teto: 1,
      },
    );
    versaoTitulo = versaoDaLinhaFaturamento(v?.['C'] ?? null);
  }
  async function cabecalhosDosTitulos(e: Escritor): Promise<void> {
    if (!credor || !documento) return;
    const docs = docsFolha.length ? docsFolha : [{ credor, documento }];
    for (const d of docs) {
      const r = await e.consultar(
        'SELECT ID, ID_MFCABECLANC FROM MFCONPAG WHERE EMPRESA = 1 AND FORN = ? AND DOC = ?',
        [d.credor, d.documento],
        { teto: 200 },
      );
      for (const x of r) {
        if (!titulos.includes(num(x['ID']))) titulos.push(num(x['ID']));
        if (!cabecalhos.includes(num(x['ID_MFCABECLANC']))) cabecalhos.push(num(x['ID_MFCABECLANC']));
      }
    }
  }

  return {
    ...base,
    alvosNasTabelasMedias: true,
    chavesAlvo: () => ({
      ...(credor && documento
        ? {
            MFCONPAG: [
              { EMPRESA: 1, FORN: credor, DOC: documento },
              ...docsFolha.map((d) => ({ EMPRESA: 1, FORN: d.credor, DOC: d.documento })),
              ...titulos.map((ID) => ({ ID })),
            ],
            MFLANGSI: [
              { EMPRESA: 1, FORN: credor, DOC: documento },
              ...docsFolha.map((d) => ({ EMPRESA: 1, FORN: d.credor, DOC: d.documento })),
            ],
            MFDESACR: [{ COD: credor, DOC: documento }],
            MFCONPAG_TBCBOPRO: titulos.map((ID_MFCONPAG) => ({ ID_MFCONPAG })),
          }
        : titulos.length
          ? { MFCONPAG: titulos.map((ID) => ({ ID })) }
          : {}),
      ...(cabecalhos.length ? { MFCABECLANC: cabecalhos.map((ID) => ({ ID })) } : {}),
      ...(nome === 'financeiro.lancarMovimento' && entrada['historico']
        ? { MFLANCTO: [{ HIST: entrada['historico'] }, ...movimentos.map((ID) => ({ ID }))] }
        : {}),
      ...(tituloReceber || recebiveis.length || docReceber
        ? {
            MFCTAREC: [
              ...(docReceber ? [{ EMPRESA: 1, DOC: docReceber }] : []),
              ...(tituloReceber ? [{ ID: tituloReceber }] : []),
              ...recebiveis.map((ID) => ({ ID })),
            ],
          }
        : {}),
      ...(contas.length ? { FCCTAEXT: contas.map((ID) => ({ ID })) } : {}),
      ...(borderos.length ? { MFBORDER: borderos.map((ID) => ({ ID })) } : {}),
    }),
    async preparar(e) {
      operador = await operadorSintetico(e);
      switch (chave) {
        case 'financeiro.criarTituloPagar/fornecedor-parcela-unica':
        case 'financeiro.criarTituloPagar/fornecedor-tres-parcelas':
        case 'financeiro.criarTituloPagar/com-retencao': {
          credor = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
          documento = await documentoLivre(e, credor);
          entrada = await entradaTitulo(e, cenario === 'fornecedor-tres-parcelas' ? 3 : 1);
          if (cenario === 'com-retencao')
            entrada['retencoes'] = [
              { codigo: num((await um(e, SQL_RETENCAO, 'retenção'))['CONTA']), valor: 18.52 },
            ];
          return;
        }
        case 'financeiro.criarTituloPagar/com-contrato': {
          // M55 (etapa 3): o título do fornecedor do contrato sintético (só SGH_, desfeito no fim), com o vínculo da
          // parcela na mesma transação; as linhas do título têm de ser as do título sem contrato.
          credor = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
          documento = await documentoLivre(e, credor);
          const contrato = await contratoSintetico(e, {
            hospital: 'pc',
            fornecedor: credor,
            usuario: 'SINTETICO',
          });
          entrada = { ...(await entradaTitulo(e, 1)), contrato: { contrato } };
          return;
        }
        case 'financeiro.criarTituloPagar/medico': {
          const m = await um(e, SQL_MEDICO, 'médico com título');
          tipo = 'M';
          credor = num(m['COD']);
          documento = await documentoLivre(e, credor);
          entrada = { ...(await entradaTitulo(e, 1)), tipo: 'M', profissional: num(m['ID']) };
          return;
        }
        case 'financeiro.criarTituloPagar/excluir-aberto':
          credor = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
          documento = await documentoLivre(e, credor);
          {
            const r = (await executarOutra(e, 'financeiro.criarTituloPagar', await entradaTitulo(e, 1))) as {
              resultado?: Record<string, unknown>;
            };
            titulos = [num(r.resultado?.['titulo'])];
          }
          await cabecalhosDosTitulos(e);
          entrada = { acao: 'excluir', titulo: titulos[0], versao: null };
          return;
        case 'financeiro.criarTituloPagar/recusa-excluir-pago': {
          const t = await um(
            e,
            "SELECT FIRST 1 c.ID FROM MFCONPAG c WHERE c.DT_PGTO >= '2026-01-01' AND c.PAGO > 0 AND c.ONDE = 'F' ORDER BY c.ID DESC",
            'título pago',
          );
          titulos = [num(t['ID'])];
          entrada = { acao: 'excluir', titulo: titulos[0], versao: null };
          return;
        }
        case 'financeiro.criarTituloPagar/origem-folha':
          entrada = await entradaFolha(e, ['liquido-mensal']);
          return;
        case 'financeiro.criarTituloPagar/origem-encargo':
          entrada = await entradaFolha(e, ['inss', 'fgts']);
          return;
        case 'financeiro.criarTituloPagar/recusa-folha-repetida':
          entrada = await entradaFolha(e, ['fgts']);
          await executarOutra(e, 'financeiro.criarTituloPagar', entrada);
          await cabecalhosDosTitulos(e);
          return;
        case 'financeiro.criarTituloPagar/recusa-duplicado':
          credor = num((await um(e, SQL_FORNECEDOR, 'fornecedor'))['FORN']);
          documento = await documentoLivre(e, credor);
          entrada = await entradaTitulo(e, 1);
          await executarOutra(e, 'financeiro.criarTituloPagar', entrada);
          await cabecalhosDosTitulos(e);
          return;
        case 'financeiro.baixarTitulo/pagar-sem-bordero':
        case 'financeiro.baixarTitulo/pagar-por-bordero':
        case 'financeiro.baixarTitulo/recusa-sem-aprovacao':
        case 'financeiro.baixarTitulo/recusa-ja-baixado': {
          await tituloDePartida(e, cenario !== 'recusa-sem-aprovacao');
          await cabecalhosDosTitulos(e);
          const c = await um(
            e,
            SQL_CONTA(0, cenario === 'pagar-por-bordero' ? 'bordero' : 'pagar'),
            'conta bancária',
          );
          await noEscopo(e, num(c['ID_CTABAN']));
          const hoje = dia((await um(e, 'SELECT CURRENT_DATE H FROM RDB$DATABASE', 'data'))['H']);
          entrada = {
            cenario: 'pagar',
            titulos: [{ titulo: titulos[0], versao: versaoTitulo }],
            conta: num(c['ID']),
            dataPagamento: hoje,
            formaPagamento: cenario === 'pagar-por-bordero' ? 0 : 1,
            porBordero: cenario === 'pagar-por-bordero',
          };
          if (cenario === 'recusa-ja-baixado')
            // Baixado "no outro sistema" depois da leitura da tela (a versão foi lida antes).
            await e.executar(
              'UPDATE MFCONPAG SET PAGO = VALOR, DT_PGTO = CURRENT_DATE, BANCO = (SELECT BANCO FROM TBCTABAN WHERE ID = ?), ID_TBCTABAN = ? WHERE ID = ?',
              [num(c['ID']), num(c['ID']), titulos[0]],
            );
          return;
        }
        case 'financeiro.baixarTitulo/receber-manual': {
          const t = await um(
            e,
            `SELECT FIRST 1 m.ID, m.VALOR, m.DATA_HORA_ULTIMA_ATUALIZACAO C FROM MFCTAREC m WHERE m.PGTO = '1899-12-30'
               AND m.VALOR > 0 AND COALESCE(m.VLR_PAG, 0) = 0 AND m.DEV IN ('E', 'I') ORDER BY m.ID DESC`,
            'título a receber em aberto',
          );
          tituloReceber = num(t['ID']);
          const c = await um(e, SQL_CONTA(0, 'receber'), 'conta bancária');
          await noEscopo(e, num(c['ID_CTABAN']));
          const hoje = dia((await um(e, 'SELECT CURRENT_DATE H FROM RDB$DATABASE', 'data'))['H']);
          entrada = {
            cenario: 'receber',
            titulo: tituloReceber,
            versao: versaoDaLinhaFaturamento(t['C'] ?? null),
            conta: num(c['ID']),
            dataRecebimento: hoje,
            valorRecebido: num(t['VALOR']),
            formaPagamento: 1,
            motivo: 'SINTETICO M32: recebimento conferido no extrato',
          };
          return;
        }
        case 'financeiro.criarTituloReceber/convenio-competencia': {
          const g = await um(
            e,
            `SELECT FIRST 1 c.CON, c.TIPO_CTA, c.ANOPRO, c.MESPRO FROM FCCTAEXT c WHERE c.FECHADA = 'A' AND c.ANOPRO >= 2026
               AND COALESCE(c.ID_MFCTAREC, 0) = 0 AND c.TOTAL_CONTA > 0 AND c.CON <> 10
               AND EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.DEV = 'C' AND m.COD = c.CON)
             GROUP BY c.CON, c.TIPO_CTA, c.ANOPRO, c.MESPRO HAVING COUNT(*) >= 2 ORDER BY c.ANOPRO DESC, c.MESPRO DESC`,
            'competência com contas apresentadas sem título',
          );
          const ls = await e.consultar(
            `SELECT FIRST 2 c.ID, c.DATA_APRES, c.DATA_FEC, c.DATA_HORA_ULTIMA_ATUALIZACAO V FROM FCCTAEXT c WHERE c.CON = ? AND c.TIPO_CTA = ?
               AND c.ANOPRO = ? AND c.MESPRO = ? AND c.FECHADA = 'A' AND COALESCE(c.ID_MFCTAREC, 0) = 0 AND c.TOTAL_CONTA > 0 ORDER BY c.ID`,
            [g['CON'], g['TIPO_CTA'], g['ANOPRO'], g['MESPRO']],
            { teto: 2, tempoMaximoMs: 120_000 },
          );
          contas = ls.map((l) => num(l['ID']));
          const apres =
            dia(ls[0]?.['DATA_APRES']) > '1900' ? dia(ls[0]?.['DATA_APRES']) : dia(ls[0]?.['DATA_FEC']);
          docReceber = 1_900_000_000 + (Date.now() % 99_999_999);
          entrada = {
            contas: ls.map((l) => ({
              conta: num(l['ID']),
              versao: versaoDaLinhaFaturamento(l['V'] ?? null),
            })),
            vencimento: somarDias(apres > '1900' ? apres : dia(new Date()), 30),
            documento: docReceber,
            referente: '',
          };
          return;
        }
        case 'financeiro.criarTituloReceber/particular-externo': {
          // A conta do particular externo sai titulada no mesmo dia (o caixa do outro sistema): a reprodução desliga uma
          // conta titulada na transação desfeita (como se o título não existisse) e o novo titula.
          const x = await um(
            e,
            `SELECT FIRST 1 c.ID FROM FCCTAEXT c JOIN MFCTAREC m ON m.ID_MFCTAREC = c.ID_MFCTAREC
              WHERE c.CON = 10 AND c.TIPO_CTA = 'E' AND c.FECHADA IN ('S', 'A') AND c.TOTAL_CONTA > 0 AND m.DEV = 'E'
                AND c.ANOPRO >= 2025 ORDER BY c.ID DESC`,
            'conta do particular externo',
          );
          // Desliga a conta e apaga o título do outro sistema (os gatilhos BD e AD deixam: a conta não está mais ligada).
          const [m] = await e.consultar(
            'SELECT ID FROM MFCTAREC WHERE ID_MFCTAREC = (SELECT ID_MFCTAREC FROM FCCTAEXT WHERE ID = ?)',
            [num(x['ID'])],
            { teto: 1 },
          );
          await e.executar('UPDATE FCCTAEXT SET ID_MFCTAREC = 0, DOC = 0 WHERE ID = ?', [num(x['ID'])]);
          if (m) await e.executar('DELETE FROM MFCTAREC WHERE ID = ?', [num(m['ID'])]);
          const c = await um(
            e,
            'SELECT c.ID, c.COD, c.DATA_APRES, c.DATA_FEC, c.DATA_HORA_ULTIMA_ATUALIZACAO V FROM FCCTAEXT c WHERE c.ID = ?',
            'conta do particular externo sem título',
            [num(x['ID'])],
          );
          contas = [num(c['ID'])];
          docReceber = num(c['COD']);
          const apres = dia(c['DATA_APRES']) > '1900' ? dia(c['DATA_APRES']) : dia(c['DATA_FEC']);
          entrada = {
            contas: [{ conta: contas[0], versao: versaoDaLinhaFaturamento(c['V'] ?? null) }],
            vencimento: apres > '1900' ? apres : dia(new Date()),
            documento: 0,
            referente: '',
          };
          return;
        }
        case 'financeiro.criarTituloReceber/recusa-conta-titulada': {
          const c = await um(
            e,
            "SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.ID_MFCTAREC > 0 AND c.FECHADA = 'A' AND c.ANOPRO = 2025 ORDER BY c.ID DESC",
            'conta titulada',
          );
          contas = [num(c['ID'])];
          entrada = {
            contas: [{ conta: contas[0], versao: null }],
            vencimento: dia(new Date()),
            documento: 1,
            referente: '',
          };
          return;
        }
        default:
          if (nome === 'financeiro.lancarMovimento') {
            const a = await um(e, SQL_CONTA(0), 'conta bancária');
            const b = await um(e, SQL_CONTA(1), 'outra conta bancária');
            if (cenario !== 'recusa-fora-escopo') {
              await noEscopo(e, num(a['ID_CTABAN']));
              await noEscopo(e, num(b['ID_CTABAN']));
            }
            const t =
              cenario === 'recusa-fora-escopo'
                ? 'O'
                : (
                    {
                      tarifa: 'O',
                      'fechamento-caixa': 'F',
                      transferencia: 'T',
                      'credito-avulso': 'C',
                      'debito-avulso': 'D',
                    } as Record<string, string>
                  )[cenario];
            if (!t) throw new Error(`Cenário ${chave} sem reprodução.`);
            const g = await um(
              e,
              `SELECT FIRST 1 l.GRUPO, l.SUBGRUPO, l.ITEM FROM MFLANCTO l WHERE l.TIPO_TRF = ? AND l.GRUPO > 0 AND l.DATA >= '2025-01-01'
                 AND EXISTS (SELECT 1 FROM TBITEDES i WHERE i.GRUPO = l.GRUPO AND i.SUBGRUPO = l.SUBGRUPO AND i.ITEM = l.ITEM) ORDER BY l.ID DESC`,
              'classificação do movimento',
              [t === 'D' ? 'O' : t],
            );
            const hoje = dia((await um(e, 'SELECT CURRENT_DATE H FROM RDB$DATABASE', 'data'))['H']);
            const duas = t === 'T' || t === 'F';
            entrada = {
              tipo: t,
              data: hoje,
              // Tarifa e débito avulso saem da conta debitada; o crédito avulso entra na que recebe; T e F, as duas.
              contaCredito: t === 'D' || t === 'O' ? null : num(a['ID']),
              contaDebito: duas || t === 'D' || t === 'O' ? num(b['ID']) : null,
              valor: 87.65,
              historico: `SINTETICO M32 ${cenario}`,
              classificacao: { grupo: num(g['GRUPO']), subgrupo: num(g['SUBGRUPO']), item: num(g['ITEM']) },
            };
            return;
          }
          throw new Error(`Cenário ${chave} sem reprodução.`);
      }
    },
    async executar(e) {
      const guardar = async (p: Promise<unknown>) => {
        const r = (await p) as { resultado?: Record<string, unknown> };
        return r.resultado ?? {};
      };
      switch (chave) {
        case 'financeiro.criarTituloPagar/recusa-excluir-pago':
          await exigirRecusa(executar(e, entrada), 'titulo-pago');
          return;
        case 'financeiro.criarTituloPagar/recusa-duplicado':
          await exigirRecusa(executar(e, entrada), 'duplicado');
          return;
        case 'financeiro.criarTituloPagar/recusa-folha-repetida':
          await exigirRecusa(executar(e, entrada), 'folha-repetida');
          return;
        case 'financeiro.baixarTitulo/recusa-sem-aprovacao':
          await exigirRecusa(executar(e, entrada), 'sem-aprovacao');
          return;
        case 'financeiro.baixarTitulo/recusa-ja-baixado':
          await exigirRecusa(executar(e, entrada), 'titulo-ja-baixado');
          return;
        case 'financeiro.criarTituloReceber/recusa-conta-titulada':
          await exigirRecusa(executar(e, entrada), 'conta-titulada');
          return;
        case 'financeiro.lancarMovimento/recusa-fora-escopo':
          await exigirRecusa(executar(e, entrada), 'fora-do-escopo');
          return;
        default:
          break;
      }
      const r = await guardar(executar(e, entrada));
      if (nome === 'financeiro.criarTituloPagar') await cabecalhosDosTitulos(e);
      if (nome === 'financeiro.baixarTitulo' && num(r['idBordero'])) borderos.push(num(r['idBordero']));
      if (nome === 'financeiro.criarTituloReceber') {
        tituloReceber = num(r['titulo']);
        const [m] = await e.consultar('SELECT ID_MFCABECLANC FROM MFCTAREC WHERE ID = ?', [tituloReceber], {
          teto: 1,
        });
        cabecalhos.push(num(m?.['ID_MFCABECLANC']));
      }
      if (nome === 'financeiro.lancarMovimento') {
        movimentos.push(num(r['movimento']));
        const [m] = await e.consultar(
          'SELECT ID_MFCABECLANC FROM MFLANCTO WHERE ID = ?',
          [num(r['movimento'])],
          {
            teto: 1,
          },
        );
        cabecalhos.push(num(m?.['ID_MFCABECLANC']));
      }
    },
  };
}
