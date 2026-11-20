// Reprodução dos cenários de assinatura do estoque, do almoxarifado e das compras (M28; ficha, seção 9) pelo EXECUTOR, na
// transação da captura (sempre desfeita). A preparação (antes do retrato "antes") cria o operador sintético
// (acesso.criarUsuarioIntegracao) e o seu cadastro de usuário do estoque — GEUSERS, os locais por tipo de movimento
// (GELOCUSU) e, no cenário do escopo, o centro de custo do requisitante — por INSERT na transação desfeita (é o estado
// de partida que o cadastro de usuários do estoque faria); os documentos de partida (a saída que volta na devolução, a
// requisição que é atendida, o pedido da nota e da cotação) nascem pelo próprio executor. O que nenhuma receita do marco
// grava e o cenário precisa — o item do pedido emitido (TIPO 'P'), o mês fechado do cenário de recusa — é posto por
// UPDATE/INSERT na transação desfeita, como o outro sistema faria. Os itens, os lotes, os locais, os centros de custo,
// os atendimentos, o terceiro e os fornecedores são os da cópia (só os IDs, em memória); nenhum valor de linha sai.
import { contratoSintetico } from './contrato-sintetico.js';
import {
  avancarEtapaOpmeSgh,
  type CenarioCaptura,
  ErroOperacao,
  type Escritor,
  solicitarOpmeSgh,
} from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_SUPRIMENTOS = new Set([
  'suprimentos.registrarSaida',
  'suprimentos.requisitarMaterial',
  'suprimentos.registrarDevolucao',
  'suprimentos.transferir',
  'suprimentos.registrarEntradaNF',
  'suprimentos.criarPedido',
  'suprimentos.registrarProposta',
  'suprimentos.definirVencedorCotacao',
  'suprimentos.registrarMovimentoDireto',
  'suprimentos.registrarBalanco',
  'suprimentos.fecharMes',
  'suprimentos.reabrirMes',
  'suprimentos.reporKitRastreavel',
  'suprimentos.desconsolidarDocumento',
  'suprimentos.corrigirValidadeLote',
]);

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const p2 = (n: number) => String(n).padStart(2, '0');
const isoDe = (v: unknown) =>
  v instanceof Date ? `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}` : txt(v).slice(0, 10);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** Locais da cópia usados nos cenários: a farmácia central (10) e a do centro cirúrgico (15). */
export const LOCAL_CENTRAL = 10;
export const LOCAL_SATELITE = 15;
/** Centro de custo de setor visto nas saídas (o domínio do perfil) e o técnico. */
export const CENTRO_SETOR = 300100;
export const CENTRO_TECNICO = 9999;

interface Relogio {
  hoje: string;
  ano: number;
  mes: number;
}

export async function relogio(e: Escritor): Promise<Relogio> {
  const [r] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
    teto: 1,
  });
  const hoje = txt(r?.['H']);
  return { hoje, ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
}

/** A competência mais recente com saldo por local na cópia (o dump termina antes do relógio). */
async function competenciaSaldo(e: Escritor, r: Relogio): Promise<{ ano: number; mes: number }> {
  let { ano, mes } = r;
  for (let k = 0; k < 13; k += 1) {
    const [x] = await e.consultar('SELECT FIRST 1 1 U FROM GEARMLOC WHERE ANO = ? AND MES = ?', [ano, mes], {
      teto: 1,
    });
    if (x) return { ano, mes };
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  throw new Error('Nenhuma competência com saldo na cópia.');
}

interface ItemCopia {
  item: number;
  saldo: number;
}

/** Um item sem lote, não controlado, não consignado, com saldo no local e valor em estoque. */
export async function itemComSaldo(
  e: Escritor,
  o: {
    local: number;
    minimo: number;
    excluir?: readonly number[];
    controlado?: boolean;
    rastreavel?: boolean;
    /** M46 (etapa 3): só itens da classe (50: OPME). */
    classe?: number;
  },
): Promise<ItemCopia> {
  const c = await competenciaSaldo(e, await relogio(e));
  const ls = await e.consultar(
    `SELECT FIRST 50 a.ITEM, a.QTDE FROM GEARMLOC a JOIN GEITENS i ON i.COD = a.ITEM LEFT JOIN GEREFER r ON r.COD = i.REF
      WHERE a.ANO = ? AND a.MES = ? AND a.LOCAL = ? AND a.QTDE >= ? AND i.ESTOQUE >= ? AND i.TOTAL > 0
        AND COALESCE(i.RASTREAR, 0) = ? AND COALESCE(r.CONSIG, 'F') <> 'T'
        AND ${o.controlado ? "COALESCE(i.PORTARIA, '') <> ''" : "COALESCE(i.PORTARIA, '') = '' AND COALESCE(i.PSICO, 'F') <> 'T'"}
        ${o.classe ? 'AND i.CLASSIF = ?' : ''}
      ORDER BY a.ITEM`,
    [c.ano, c.mes, o.local, o.minimo, o.minimo, o.rastreavel ? 1 : 0, ...(o.classe ? [o.classe] : [])],
    { teto: 50, tempoMaximoMs: 120_000 },
  );
  const x = ls.find((l) => !(o.excluir ?? []).includes(num(l['ITEM'])));
  if (!x) throw new Error(`Nenhum item com saldo no local ${o.local} na cópia.`);
  return { item: num(x['ITEM']), saldo: num(x['QTDE']) };
}

interface LoteCopia {
  id: number;
  lote: string;
  validade: string;
  saldo: number;
}

/** Um item rastreável com `n` lotes válidos (saldo ≥ 1, não vencidos) no local e saldo no local. */
export async function itemComLotes(
  e: Escritor,
  local: number,
  n: number,
  controlado = false,
): Promise<{ item: number; lotes: LoteCopia[] }> {
  const r = await relogio(e);
  const c = await competenciaSaldo(e, r);
  const ls = await e.consultar(
    `SELECT FIRST 50 v.ITEM FROM GEVALMEM v JOIN GEITENS i ON i.COD = v.ITEM LEFT JOIN GEREFER rf ON rf.COD = i.REF
      WHERE v.LOCAL = ? AND v.QTDE >= 1 AND v.DATA > ? AND v.DATA < DATE '2099-01-01' AND i.RASTREAR = 1 AND i.TOTAL > 0
        AND COALESCE(rf.CONSIG, 'F') <> 'T' AND ${controlado ? "COALESCE(i.PORTARIA, '') <> ''" : "COALESCE(i.PORTARIA, '') = ''"}
        AND EXISTS (SELECT 1 FROM GEARMLOC a WHERE a.ANO = ? AND a.MES = ? AND a.LOCAL = v.LOCAL AND a.ITEM = v.ITEM AND a.QTDE >= ?)
      GROUP BY v.ITEM HAVING COUNT(*) >= ? ORDER BY v.ITEM`,
    [local, new Date(r.ano, r.mes - 1, Number(r.hoje.slice(8, 10))), c.ano, c.mes, n, n],
    { teto: 50, tempoMaximoMs: 120_000 },
  );
  for (const x of ls) {
    const item = num(x['ITEM']);
    const [it] = await e.consultar('SELECT ESTOQUE FROM GEITENS WHERE COD = ?', [item], { teto: 1 });
    if (num(it?.['ESTOQUE']) < n) continue;
    const vs = await e.consultar(
      'SELECT ID, LOTE, DATA, QTDE FROM GEVALMEM WHERE ITEM = ? AND LOCAL = ? AND QTDE >= 1 AND DATA > ? ORDER BY DATA, ID',
      [item, local, new Date(r.ano, r.mes - 1, Number(r.hoje.slice(8, 10)))],
      { teto: 10 },
    );
    if (vs.length >= n)
      return {
        item,
        lotes: vs.slice(0, n).map((v) => ({
          id: num(v['ID']),
          lote: txt(v['LOTE']),
          validade: isoDe(v['DATA']),
          saldo: num(v['QTDE']),
        })),
      };
  }
  throw new Error(`Nenhum item rastreável com ${n} lotes válidos no local ${local}.`);
}

export async function localConsumo(e: Escritor, cdc: number): Promise<number> {
  const [c] = await e.consultar('SELECT LOCCON FROM TBCENCUS WHERE COD = ?', [cdc], { teto: 1 });
  return num(c?.['LOCCON']) || 11;
}

/** Internação com conta de convênio (não SUS) aberta hoje. */
export async function internacaoComConta(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 k.REG FROM RICONTAS k JOIN RICADINT i ON i.REG = k.REG
      WHERE k.DATAFIN < DATE '1900-01-01' AND k.DATAINI <= CURRENT_DATE AND k.CONV <> 1 AND i.ALTA < DATE '1900-01-01'
        AND EXISTS (SELECT 1 FROM RICADPAC p WHERE p.PRONT = i.PRONT)
      ORDER BY k.REG DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhuma internação com conta aberta na cópia.');
  return num(x['REG']);
}

/** Internação já encerrada, sem conta no período de hoje. */
export async function internacaoSemConta(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 i.REG FROM RICADINT i
      WHERE i.ALTA > DATE '1900-01-01' AND i.ALTA < DATE '2026-01-01'
        AND NOT EXISTS (SELECT 1 FROM RICONTAS k WHERE k.REG = i.REG AND (k.DATAFIN < DATE '1900-01-01' OR k.DATAFIN >= CURRENT_DATE))
      ORDER BY i.REG DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhuma internação encerrada na cópia.');
  return num(x['REG']);
}

/** Atendimento externo recente (não SUS) com o paciente no cadastro. */
async function atendimentoExterno(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 r.REG FROM RECADATE r WHERE r.DT_ATE >= DATE '2026-06-01' AND r.CONV <> 1
        AND EXISTS (SELECT 1 FROM RICADPAC p WHERE p.PRONT = r.PRONT) ORDER BY r.REG DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhum atendimento externo recente na cópia.');
  return num(x['REG']);
}

/** Um vínculo profissional com conselho (o médico das saídas a externo). */
async function medicoComConselho(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    'SELECT FIRST 1 c.ID_TBCBOPRO FROM GECADSAI c WHERE c.ANO = 2026 AND c.MES = 6 AND c.DEST = 3 AND c.CRM > 0',
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhum médico com conselho nas saídas da cópia.');
  return num(x['ID_TBCBOPRO']);
}

async function fornecedores(e: Escritor, n: number): Promise<number[]> {
  const ls = await e.consultar(
    `SELECT FIRST ${n} c.FORN FROM GECADPED c WHERE c.ANO = 2026 AND c.OQUE = 'P' AND c.FORN > 0 GROUP BY c.FORN ORDER BY COUNT(*) DESC`,
    [],
    { teto: n },
  );
  if (ls.length < n) throw new Error('Fornecedores insuficientes na cópia.');
  return ls.map((x) => num(x['FORN']));
}

/** O usuário do estoque do operador sintético (estado de partida do cadastro de usuários do estoque). */
export async function usuarioEstoque(
  e: Escritor,
  login: string,
  o: { centros?: readonly number[]; autorizarPedido?: boolean; desbloquear?: boolean } = {},
) {
  await e.executar(
    `INSERT INTO GEUSERS (USUARIO, NOME, PERMITIR_AUTORIZAR_PEDIDO, PERMITIR_DESBLOQUEIO_FECHAMENTO) VALUES (?, ?, ?, ?)`,
    [login, 'USUARIO SINTETICO', o.autorizarPedido ? 'T' : 'F', o.desbloquear ? 'T' : 'F'],
  );
  for (const local of [LOCAL_CENTRAL, LOCAL_SATELITE, 80])
    for (const tipo of ['S', 'E', 'D', 'TO', 'TD', 'R', 'I', 'V'])
      await e.executar('INSERT INTO GELOCUSU (USUARIO, ARM, TIPO_MOV) VALUES (?, ?, ?)', [
        login,
        local,
        tipo,
      ]);
  for (const c of o.centros ?? [])
    await e.executar('INSERT INTO GEUSERS_TBCENCUS (USUARIO_GEUSERS, ID_TBCENCUS) VALUES (?, ?)', [login, c]);
}

// ── M46 (etapa 3): OPME ─────────────────────────────────────────────────────────────────────────────────────────

/** O agendamento SINTÉTICO do consumo de OPME (só nas tabelas SGH_; nenhuma linha da agenda é lida). */
export const AGENDA_OPME_SINTETICA = 999_463_001;

/** O bloco `opme` da saída: o rastreio sintético da embalagem (lote, fabricante e registro na Anvisa fictícios). */
export function opmeDaSaida(o: {
  solicitacao: number | null;
  versaoVista: number | null;
  semAutorizacaoPor?: string;
  consignado?: boolean;
}) {
  return {
    agendamento: AGENDA_OPME_SINTETICA,
    sala: 1,
    dataHora: '2026-10-26T08:00',
    solicitacao: o.solicitacao,
    versaoVista: o.versaoVista,
    lote: 'L-SINT-463',
    serie: 'SN-SINT-1',
    fabricante: 'Fabricante Sintetico',
    modelo: 'MOD-1',
    registroAnvisa: '80000000001',
    validade: '2030-12-31',
    consignado: o.consignado ?? false,
    semAutorizacao: o.semAutorizacaoPor
      ? { por: o.semAutorizacaoPor, motivo: 'Cenario de assinatura sem a autorizacao da operadora.' }
      : null,
  };
}

/** A solicitação de OPME autorizada (SGH_ só; agendamento SINTÉTICO) para o consumo em sala. */
export async function solicitacaoOpmeAutorizada(
  e: Escritor,
  o: { item: number; reg: number; quantidade: number; usuario: string },
): Promise<{ id: number; versao: number }> {
  const s = await solicitarOpmeSgh(e, {
    hospital: 'pc',
    agendamento: AGENDA_OPME_SINTETICA,
    sala: 1,
    dataHora: '2026-10-26T08:00',
    reg: o.reg,
    paciente: null,
    item: o.item,
    tuss: '70000014',
    quantidade: o.quantidade,
    fornecedor: null,
    justificativa: 'Cenario de assinatura: material especial da cirurgia.',
    consignado: false,
    em: '2026-10-25T10:00',
    usuario: o.usuario,
    chave: null,
  });
  const a = await avancarEtapaOpmeSgh(e, {
    hospital: 'pc',
    solicitacao: s.id,
    versaoVista: s.versao,
    etapa: 'autorizacao',
    em: '2026-10-25T11:00',
    quantidade: o.quantidade,
    senha: 'SINT-SENHA',
    guia: 'SINT-GUIA',
    validade: '2030-12-31',
    usuario: o.usuario,
    chave: null,
    mudanca: {
      situacao: 'autorizada',
      autorizada: o.quantidade,
      senha: 'SINT-SENHA',
      guia: 'SINT-GUIA',
      validade: '2030-12-31',
    },
  });
  return { id: s.id, versao: a.versao };
}

export function cenarioSuprimentos(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura & { entradasDaPreparacao(): Record<string, unknown> } {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const docs: { tabela: string; chave: Record<string, unknown> }[] = [];
  const itens = new Set<number>();
  const centros = new Set<number>();
  const pedidos: { ano: number; doc: number }[] = [];
  const kits = new Set<number>();
  const lotesIds = new Set<number>();
  let r: Relogio = { hoje: '', ano: 0, mes: 0 };
  let chaves: Record<string, Record<string, unknown>[]> = {};
  const extras: Record<string, unknown[]> = {
    DOC: [],
    NUM_PROCESSO_ADMINISTRATIVO: [],
    ID_GECADSAI: [],
    ULT_NUM_DOC_GERADO: [],
    ANO_MES: [],
  };
  const anotarDoc = (doc: number, ano?: number, mes?: number) => {
    extras['DOC']?.push(doc);
    extras['ULT_NUM_DOC_GERADO']?.push(doc);
    if (ano && mes) extras['ANO_MES']?.push(ano * 100 + mes);
  };

  const lerAlvos = async (e: Escritor) => {
    const a: Record<string, Record<string, unknown>[]> = {
      GECADSAI: [],
      GELANSAI: [],
      GELANSAIREQ: [],
      GECADDEV: [],
      GELANDEV: [],
      GECADTRA: [],
      GELANTRA: [],
      GECADNFS: [],
      GELANNFS: [],
      GERASVALSAIDLOTE: [],
      GERASVALDEVLOTE: [],
      GERASVALTRANSFLOTE: [],
      GERASVALNFS: [],
      GEQTDELOTEVALLOTEDOCSAIDA: [],
      GEULTDOCGER: [],
      GESALDOS: [],
      GEKONCDC: [],
      GECONITL: [],
      GEVALMEM: [],
      GECADPED: [],
      GELANPED: [],
      GELANPAC: [],
      GECADBAL: [],
      GELANBAL: [],
      GEITEMKITRAS: [],
      GESALDOKITRAS: [],
      GEITEMKITRAS_GELANSAI: [],
      GEITEMKITRAS_GELANDEV: [],
      GEDISPHOR: [],
    };
    for (const tipo of [1, 2, 3, 4, 5])
      a['GEULTDOCGER']?.push({ ID_GETPLANCTO: tipo, ANO_MES: r.ano * 100 + r.mes });
    for (const d of docs) {
      a[d.tabela]?.push(d.chave);
      if (d.tabela === 'GECADSAI') {
        const k = d.chave as { ANO: number; MES: number; DOC: number };
        a['GELANSAI']?.push(k);
        a['GELANSAIREQ']?.push(k);
        const ls = await e.consultar(
          'SELECT ID_GELANSAI FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ?',
          [k.ANO, k.MES, k.DOC],
          {
            teto: 300,
          },
        );
        for (const l of ls) {
          a['GERASVALSAIDLOTE']?.push({ ID_GELANSAI: num(l['ID_GELANSAI']) });
          a['GEITEMKITRAS_GELANSAI']?.push({ ID_GELANSAI: num(l['ID_GELANSAI']) });
          a['GEDISPHOR']?.push({ ID_GELANSAI: num(l['ID_GELANSAI']) });
          a['GELANDEV']?.push({ ID_GELANSAI: num(l['ID_GELANSAI']) });
          const rs = await e.consultar(
            'SELECT ID FROM GERASVALSAIDLOTE WHERE ID_GELANSAI = ?',
            [num(l['ID_GELANSAI'])],
            { teto: 50 },
          );
          for (const x of rs) a['GEQTDELOTEVALLOTEDOCSAIDA']?.push({ ID_GERASVALSAIDLOTE: num(x['ID']) });
        }
      }
      if (d.tabela === 'GECADDEV') {
        const ds = await e.consultar(
          'SELECT ID_GELANDEV FROM GELANDEV WHERE ID_GECADDEV = ?',
          [d.chave['ID']],
          { teto: 300 },
        );
        for (const x of ds) {
          a['GERASVALDEVLOTE']?.push({ ID_GELANDEV: num(x['ID_GELANDEV']) });
          a['GEITEMKITRAS_GELANDEV']?.push({ ID_GELANDEV: num(x['ID_GELANDEV']) });
        }
      }
      if (d.tabela === 'GECADTRA') {
        a['GELANTRA']?.push({ ID_GECADTRA: d.chave['ID'] });
        const ts = await e.consultar(
          'SELECT ID_GELANTRA FROM GELANTRA WHERE ID_GECADTRA = ?',
          [d.chave['ID']],
          { teto: 300 },
        );
        for (const x of ts) a['GERASVALTRANSFLOTE']?.push({ ID_GELANTRA: num(x['ID_GELANTRA']) });
      }
      if (d.tabela === 'GECADNFS') {
        const k = d.chave as { ANO: number; MES: number; DOC: number };
        a['GELANNFS']?.push(k);
        const ns = await e.consultar(
          'SELECT ID_GELANNFS FROM GELANNFS WHERE ANO = ? AND MES = ? AND DOC = ?',
          [k.ANO, k.MES, k.DOC],
          {
            teto: 300,
          },
        );
        for (const x of ns) a['GERASVALNFS']?.push({ ID_GELANNFS: num(x['ID_GELANNFS']) });
      }
      if (d.tabela === 'GECADBAL') a['GELANBAL']?.push(d.chave);
    }
    for (const i of itens) {
      a['GESALDOS']?.push({ ITEM: i });
      a['GEVALMEM']?.push({ ITEM: i });
      a['GECONITL']?.push({ ANO: r.ano, MES: r.mes, ITEM: i });
      a['GELANPAC']?.push({ ITEM: i, DATA: new Date(r.ano, r.mes - 1, Number(r.hoje.slice(8, 10))) });
    }
    for (const c of centros) a['GEKONCDC']?.push({ ANO: r.ano, MES: r.mes, CDC: c });
    for (const p of pedidos) {
      a['GECADPED']?.push({ ANO: p.ano, OQUE: 'P', DOC: p.doc });
      a['GELANPED']?.push({ DOC: p.doc, ANO: p.ano });
    }
    for (const k of kits) a['GEITEMKITRAS']?.push({ ID_GEKITRAS: k });
    for (const k of kits) {
      const ks = await e.consultar('SELECT ID FROM GEITEMKITRAS WHERE ID_GEKITRAS = ?', [k], { teto: 300 });
      for (const x of ks) a['GESALDOKITRAS']?.push({ ID_GEITEMKITRAS: num(x['ID']) });
    }
    void lotesIds;
    chaves = a;
  };

  /** Registra o documento criado (para as chaves-alvo e para o número como entrada). */
  const registrarDoc = async (e: Escritor, tabela: string, res: Record<string, unknown>) => {
    const id = num(res['id']);
    const ano = num(res['ano']);
    const mes = num(res['mes']);
    const doc = num(res['doc']);
    if (tabela === 'GECADDEV' || tabela === 'GECADTRA') docs.push({ tabela, chave: { ID: id } });
    else if (tabela === 'GECADPED') pedidos.push({ ano, doc });
    else docs.push({ tabela, chave: { ANO: ano, MES: mes, DOC: doc } });
    if (tabela === 'GECADSAI') extras['ID_GECADSAI']?.push(id);
    anotarDoc(doc, ano, mes);
    void e;
  };

  const saidaEntrada = (o: {
    destino: 1 | 2 | 3 | 5;
    local: number;
    cdc: number;
    cons: number;
    item: number;
    quantidade: number;
    lotes?: { lote: string; validade: string; quantidade: number }[];
    atendimento?: number;
    medico?: number;
    terceiro?: number;
    prescritor?: number;
    opme?: ReturnType<typeof opmeDaSaida>;
  }) => ({
    destino: o.destino,
    origem: 'E',
    local: o.local,
    centroCusto: o.cdc,
    localConsumo: o.cons,
    ...(o.atendimento ? { atendimento: o.atendimento } : {}),
    ...(o.medico ? { medico: o.medico } : {}),
    ...(o.terceiro ? { terceiro: o.terceiro } : {}),
    ...(o.opme ? { opme: o.opme } : {}),
    itens: [
      {
        item: o.item,
        quantidade: o.quantidade,
        lotes: o.lotes ?? [],
        ...(o.prescritor ? { prescritorControlado: o.prescritor } : {}),
      },
    ],
  });

  /** Uma saída consolidada de partida (para a devolução e o kit), pelo executor. */
  const saidaDePartida = async (
    e: Escritor,
    o: Parameters<typeof saidaEntrada>[0],
  ): Promise<{ ano: number; mes: number; doc: number; lancamento: number; loteSaida: number | null }> => {
    const res = await executarOutra(e, 'suprimentos.registrarSaida', saidaEntrada(o));
    const k = {
      ano: num(res.resultado['ano']),
      mes: num(res.resultado['mes']),
      doc: num(res.resultado['doc']),
    };
    await registrarDoc(e, 'GECADSAI', res.resultado);
    const [l] = await e.consultar(
      'SELECT ID_GELANSAI FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ?',
      [k.ano, k.mes, k.doc],
      {
        teto: 1,
      },
    );
    const lanc = num(l?.['ID_GELANSAI']);
    const [lt] = await e.consultar('SELECT FIRST 1 ID FROM GERASVALSAIDLOTE WHERE ID_GELANSAI = ?', [lanc], {
      teto: 1,
    });
    return { ...k, lancamento: lanc, loteSaida: lt ? num(lt['ID']) : null };
  };

  const pedidoDePartida = async (
    e: Escritor,
    o: { fornecedores: number[]; itens: { item: number; quantidade: number }[] },
  ): Promise<{ ano: number; doc: number }> => {
    const res = await executarOutra(e, 'suprimentos.criarPedido', {
      centroCusto: CENTRO_SETOR,
      tipoCompra: 'P',
      fornecedores: o.fornecedores,
      itens: o.itens,
    });
    const p = { ano: num(res.resultado['ano']), doc: num(res.resultado['doc']) };
    pedidos.push(p);
    return p;
  };

  const propostas = async (e: Escritor, p: { ano: number; doc: number }, item: number) =>
    e.consultar(
      "SELECT ID, FORN FROM GELANPED WHERE DOC = ? AND ANO = ? AND OQUE = 'P' AND ITEM = ? AND FORN > 0 ORDER BY FORN",
      [p.doc, p.ano, item],
      { teto: 20 },
    );

  const preparar = async (e: Escritor) => {
    r = await relogio(e);
    const login = await operadorSintetico(e);
    const cons = await localConsumo(e, CENTRO_SETOR);
    switch (nome) {
      case 'suprimentos.registrarSaida': {
        await usuarioEstoque(e, login);
        const base1 = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 });
        itens.add(base1.item);
        const cdc = cenario === 'centro-tecnico' ? CENTRO_TECNICO : CENTRO_SETOR;
        centros.add(cdc);
        if (cenario === 'centro-de-custo' || cenario === 'centro-tecnico') {
          entrada = saidaEntrada({
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc,
            cons: await localConsumo(e, cdc),
            item: base1.item,
            quantidade: 1,
          });
        } else if (cenario === 'paciente-interno-com-conta') {
          entrada = saidaEntrada({
            destino: 1,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: 1,
            atendimento: await internacaoComConta(e),
          });
        } else if (cenario === 'paciente-externo') {
          entrada = saidaEntrada({
            destino: 3,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: 1,
            atendimento: await atendimentoExterno(e),
            medico: await medicoComConselho(e),
          });
        } else if (cenario === 'terceiro') {
          const [t] = await e.consultar('SELECT FIRST 1 COD FROM GECADTER ORDER BY COD', [], { teto: 1 });
          entrada = saidaEntrada({
            destino: 5,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: 1,
            terceiro: num(t?.['COD']),
          });
        } else if (cenario === 'item-com-dois-lotes') {
          const x = await itemComLotes(e, LOCAL_CENTRAL, 2);
          itens.add(x.item);
          entrada = saidaEntrada({
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: x.item,
            quantidade: 2,
            lotes: x.lotes.map((l) => ({ lote: l.lote, validade: l.validade, quantidade: 1 })),
          });
        } else if (cenario === 'item-controlado') {
          // Na cópia, todo item controlado com saldo é rastreável: a saída leva o lote que vence primeiro.
          const x = await itemComLotes(e, LOCAL_CENTRAL, 1, true);
          itens.add(x.item);
          entrada = saidaEntrada({
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: x.item,
            quantidade: 1,
            lotes: x.lotes.map((l) => ({ lote: l.lote, validade: l.validade, quantidade: 1 })),
            prescritor: await medicoComConselho(e),
          });
        } else if (cenario === 'atende-requisicao-parcial') {
          const b = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2, excluir: [base1.item] });
          itens.add(b.item);
          const req = await executarOutra(e, 'suprimentos.requisitarMaterial', {
            destino: 2,
            local: LOCAL_CENTRAL,
            centroCusto: cdc,
            localConsumo: cons,
            itens: [
              { item: base1.item, quantidade: 2 },
              { item: b.item, quantidade: 1 },
            ],
          });
          await registrarDoc(e, 'GECADSAI', req.resultado);
          entrada = {
            ...saidaEntrada({ destino: 2, local: LOCAL_CENTRAL, cdc, cons, item: base1.item, quantidade: 1 }),
            requisicao: {
              ano: num(req.resultado['ano']),
              mes: num(req.resultado['mes']),
              doc: num(req.resultado['doc']),
            },
            itens: [{ item: base1.item, quantidade: 1, lotes: [], seq: 1 }],
          };
        } else if (
          cenario === 'opme-em-sala' ||
          cenario === 'opme-em-sala-consignado' ||
          cenario === 'opme-recusa-conta'
        ) {
          // M46 (etapa 3): um item da classe 50 (OPME) com saldo no almoxarifado central, ao internado do bloco.
          // Saldo de ao menos 2 (a saída de 1 não zera o item: o retrato do saldo fica na classe da entrada).
          const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2, classe: 50 });
          itens.add(x.item);
          const reg =
            cenario === 'opme-recusa-conta' ? await internacaoSemConta(e) : await internacaoComConta(e);
          let opme: ReturnType<typeof opmeDaSaida>;
          let quantidade = 1;
          if (cenario === 'opme-em-sala') {
            const sol = await solicitacaoOpmeAutorizada(e, {
              item: x.item,
              reg,
              quantidade: 1,
              usuario: login,
            });
            opme = opmeDaSaida({ solicitacao: sol.id, versaoVista: sol.versao });
          } else {
            // O consignado: a referência do item marcada como consignada (só nesta transação, desfeita no fim) e a saída
            // acima do saldo, que o gatilho aceita para o item consignado (TRG_GELANSAI_BIU).
            if (cenario === 'opme-em-sala-consignado') {
              const [rf] = await e.consultar(
                "SELECT FIRST 1 COD FROM GEREFER WHERE CONSIG = 'T' ORDER BY COD",
                [],
                {
                  teto: 1,
                },
              );
              if (!rf) throw new Error('Nenhuma referência consignada na cópia.');
              await e.executar('UPDATE GEITENS SET REF = ? WHERE COD = ?', [num(rf['COD']), x.item]);
              quantidade = x.saldo + 1;
            }
            opme = opmeDaSaida({
              solicitacao: null,
              versaoVista: null,
              semAutorizacaoPor: login,
              consignado: cenario === 'opme-em-sala-consignado',
            });
          }
          entrada = saidaEntrada({
            destino: 1,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: x.item,
            quantidade,
            atendimento: reg,
            opme,
          });
          if (cenario === 'opme-recusa-conta') recusaEsperada = 'sem-conta-convenio';
        } else if (cenario === 'saldo-insuficiente') {
          entrada = saidaEntrada({
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: base1.saldo + 1_000,
          });
          recusaEsperada = 'saldo-insuficiente';
        } else if (cenario === 'sem-conta-convenio') {
          entrada = saidaEntrada({
            destino: 1,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: 1,
            atendimento: await internacaoSemConta(e),
          });
          recusaEsperada = 'sem-conta-convenio';
        } else if (cenario === 'mes-fechado') {
          await e.executar('INSERT INTO GEFECMES (ANO, MES, EXPORTADO) VALUES (?, ?, ?)', [
            r.ano,
            r.mes,
            'F',
          ]);
          entrada = saidaEntrada({
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc,
            cons,
            item: base1.item,
            quantidade: 1,
          });
          recusaEsperada = 'mes-fechado';
        }
        return;
      }
      case 'suprimentos.requisitarMaterial': {
        await usuarioEstoque(e, login, cenario === 'centro-fora-do-escopo' ? { centros: [200100] } : {});
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        const b = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1, excluir: [a.item] });
        itens.add(a.item);
        itens.add(b.item);
        if (cenario === 'paciente')
          entrada = {
            destino: 1,
            local: LOCAL_CENTRAL,
            centroCusto: CENTRO_SETOR,
            localConsumo: cons,
            atendimento: await internacaoComConta(e),
            itens: [{ item: a.item, quantidade: 1 }],
          };
        else
          entrada = {
            destino: 2,
            local: LOCAL_CENTRAL,
            centroCusto: CENTRO_SETOR,
            localConsumo: cons,
            itens: [
              { item: a.item, quantidade: 2 },
              { item: b.item, quantidade: 1 },
            ],
          };
        if (cenario === 'centro-fora-do-escopo') recusaEsperada = 'centro-fora-do-escopo';
        return;
      }
      case 'suprimentos.registrarDevolucao': {
        await usuarioEstoque(e, login);
        centros.add(CENTRO_SETOR);
        if (cenario === 'item-com-lote') {
          const x = await itemComLotes(e, LOCAL_CENTRAL, 1);
          itens.add(x.item);
          const l = x.lotes[0]!;
          const s = await saidaDePartida(e, {
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc: CENTRO_SETOR,
            cons,
            item: x.item,
            quantidade: 1,
            lotes: [{ lote: l.lote, validade: l.validade, quantidade: 1 }],
          });
          entrada = {
            saida: { ano: s.ano, mes: s.mes, doc: s.doc },
            local: LOCAL_CENTRAL,
            itens: [
              {
                lancamentoSaida: s.lancamento,
                item: x.item,
                quantidade: 1,
                lotes: [{ loteSaida: s.loteSaida, quantidade: 1 }],
              },
            ],
          };
          return;
        }
        if (cenario === 'kit-rastreavel') {
          const [k] = await e.consultar(
            `SELECT FIRST 1 t.ID, t.ID_GEKITRAS, t.ID_GEITENS FROM GEITEMKITRAS t JOIN GEITENS i ON i.COD = t.ID_GEITENS
              JOIN GESALDOKITRAS s ON s.ID_GEITEMKITRAS = t.ID
              WHERE COALESCE(i.RASTREAR, 0) = 0 AND i.TOTAL > 0 AND i.ESTOQUE >= 1 AND COALESCE(i.PORTARIA, '') = ''
                AND EXISTS (SELECT 1 FROM GEARMLOC a WHERE a.ANO = 2026 AND a.MES = 7 AND a.LOCAL = ? AND a.ITEM = t.ID_GEITENS AND a.QTDE >= 1)
              ORDER BY t.ID DESC`,
            [LOCAL_CENTRAL],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          if (!k) throw new Error('Nenhum item de kit rastreável com saldo na cópia.');
          itens.add(num(k['ID_GEITENS']));
          kits.add(num(k['ID_GEKITRAS']));
          const s = await saidaDePartida(e, {
            destino: 2,
            local: LOCAL_CENTRAL,
            cdc: CENTRO_SETOR,
            cons,
            item: num(k['ID_GEITENS']),
            quantidade: 1,
          });
          await executarOutra(e, 'suprimentos.reporKitRastreavel', {
            kit: num(k['ID_GEKITRAS']),
            saida: { ano: s.ano, mes: s.mes, doc: s.doc },
            itens: [{ itemKit: num(k['ID']), lancamentoSaida: s.lancamento }],
          });
          entrada = {
            saida: { ano: s.ano, mes: s.mes, doc: s.doc },
            local: LOCAL_CENTRAL,
            itens: [
              {
                lancamentoSaida: s.lancamento,
                item: num(k['ID_GEITENS']),
                quantidade: 1,
                lotes: [],
                itemKit: num(k['ID']),
              },
            ],
          };
          return;
        }
        if (cenario === 'opme') {
          // M46 (etapa 3): o OPME consumido em sala (com o rastreio) e devolvido sem uso.
          const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2, classe: 50 });
          itens.add(x.item);
          const reg = await internacaoComConta(e);
          const s = await saidaDePartida(e, {
            destino: 1,
            local: LOCAL_CENTRAL,
            cdc: CENTRO_SETOR,
            cons,
            item: x.item,
            quantidade: 1,
            atendimento: reg,
            opme: opmeDaSaida({ solicitacao: null, versaoVista: null, semAutorizacaoPor: login }),
          });
          const [ras] = await e.consultar(
            'SELECT CAST(ID AS VARCHAR(20)) ID FROM SGH_SUP_OPME_RASTREIO WHERE ID_GELANSAI = ?',
            [s.lancamento],
            { teto: 1 },
          );
          if (!ras) throw new Error('O consumo de OPME de partida não gravou o rastreio.');
          entrada = {
            saida: { ano: s.ano, mes: s.mes, doc: s.doc },
            local: LOCAL_CENTRAL,
            itens: [{ lancamentoSaida: s.lancamento, item: x.item, quantidade: 1, lotes: [] }],
            opme: { consumo: Number(ras['ID']), motivo: 'Cenario de assinatura: o material nao foi usado.' },
          };
          return;
        }
        const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 });
        itens.add(x.item);
        const s =
          cenario === 'paciente-com-estorno-na-conta'
            ? await saidaDePartida(e, {
                destino: 1,
                local: LOCAL_CENTRAL,
                cdc: CENTRO_SETOR,
                cons,
                item: x.item,
                quantidade: 2,
                atendimento: await internacaoComConta(e),
              })
            : await saidaDePartida(e, {
                destino: 2,
                local: LOCAL_CENTRAL,
                cdc: CENTRO_SETOR,
                cons,
                item: x.item,
                quantidade: 2,
              });
        entrada = {
          saida: { ano: s.ano, mes: s.mes, doc: s.doc },
          local: LOCAL_CENTRAL,
          itens: [
            {
              lancamentoSaida: s.lancamento,
              item: x.item,
              quantidade: cenario === 'quantidade-maior-que-a-saida' ? 3 : 1,
              lotes: [],
            },
          ],
        };
        if (cenario === 'quantidade-maior-que-a-saida') recusaEsperada = 'quantidade-maior-que-a-saida';
        return;
      }
      case 'suprimentos.transferir': {
        await usuarioEstoque(e, login);
        if (cenario === 'item-com-lote') {
          const x = await itemComLotes(e, LOCAL_CENTRAL, 1);
          itens.add(x.item);
          const l = x.lotes[0]!;
          // O destino sem o lote (o gatilho cria o lote no destino): o centro cirúrgico, ou a UTI.
          const [tem] = await e.consultar(
            'SELECT COUNT(*) N FROM GEVALMEM WHERE ITEM = ? AND LOCAL = ? AND LOTE = ?',
            [x.item, LOCAL_SATELITE, l.lote],
            { teto: 1 },
          );
          entrada = {
            origem: LOCAL_CENTRAL,
            destino: num(tem?.['N']) > 0 ? 80 : LOCAL_SATELITE,
            itens: [
              { item: x.item, quantidade: 1, lotes: [{ lote: l.lote, validade: l.validade, quantidade: 1 }] },
            ],
          };
          return;
        }
        const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        itens.add(x.item);
        entrada = {
          origem: cenario === 'local-fora-do-escopo' ? 20 : LOCAL_CENTRAL,
          destino: LOCAL_SATELITE,
          itens: [{ item: x.item, quantidade: 1, lotes: [] }],
        };
        if (cenario === 'local-fora-do-escopo') recusaEsperada = 'local-fora-do-escopo';
        return;
      }
      case 'suprimentos.registrarEntradaNF': {
        await usuarioEstoque(e, login);
        const f = (await fornecedores(e, 1))[0]!;
        const numero = 900_000_000 + (Date.now() % 90_000_000);
        const comum = { fornecedor: f, numero, serie: '1', emissao: r.hoje, local: LOCAL_CENTRAL };
        if (cenario === 'dois-lotes' || cenario === 'validade-no-passado') {
          const x = await itemComLotes(e, LOCAL_CENTRAL, 1);
          itens.add(x.item);
          const [a, m] = [r.ano + 1, r.mes];
          entrada = {
            ...comum,
            itens: [
              {
                item: x.item,
                quantidade: 2,
                valorUnitario: 1.5,
                lotes:
                  cenario === 'dois-lotes'
                    ? [
                        { lote: `SINT${numero % 100_000}A`, validade: `${a}-${p2(m)}-01`, quantidade: 1 },
                        { lote: `SINT${numero % 100_000}B`, validade: `${a}-${p2(m)}-15`, quantidade: 1 },
                      ]
                    : [{ lote: `SINT${numero % 100_000}V`, validade: `${r.ano - 1}-01-01`, quantidade: 2 }],
              },
            ],
          };
          if (cenario === 'validade-no-passado') recusaEsperada = 'validade-no-passado';
          return;
        }
        if (cenario === 'consignado') {
          // M46 (etapa 4): a nota de reposição do consignado: um item da classe 50 (OPME) com a referência marcada como
          // consignada só nesta transação (desfeita no fim; nenhum item da classe 50 da cópia tem referência consignada).
          const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1, classe: 50 });
          itens.add(x.item);
          const [rf] = await e.consultar(
            "SELECT FIRST 1 COD FROM GEREFER WHERE CONSIG = 'T' ORDER BY COD",
            [],
            {
              teto: 1,
            },
          );
          if (!rf) throw new Error('Nenhuma referência consignada na cópia.');
          await e.executar('UPDATE GEITENS SET REF = ? WHERE COD = ?', [num(rf['COD']), x.item]);
          entrada = { ...comum, itens: [{ item: x.item, quantidade: 1, valorUnitario: 950, fator: 0 }] };
          return;
        }
        const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        itens.add(x.item);
        if (cenario === 'com-pedido-completo' || cenario === 'com-pedido-parcial') {
          const p = await pedidoDePartida(e, {
            fornecedores: [f],
            itens: [{ item: x.item, quantidade: 10 }],
          });
          const [prop] = await propostas(e, p, x.item);
          await executarOutra(e, 'suprimentos.registrarProposta', {
            pedido: p,
            proposta: num(prop?.['ID']),
            valorUnitario: 2,
          });
          await executarOutra(e, 'suprimentos.definirVencedorCotacao', {
            pedido: p,
            item: x.item,
            seq: 1,
            vencedoras: [num(prop?.['ID'])],
          });
          // O pedido emitido no outro sistema (o item vencedor passa a pendente de entrega, TIPO 'P').
          await e.executar("UPDATE GELANPED SET TIPO = 'P' WHERE ID = ?", [num(prop?.['ID'])]);
          const [conv] = await e.consultar('SELECT CONVER FROM GEITENS WHERE COD = ?', [x.item], { teto: 1 });
          const fator = num(conv?.['CONVER']) > 0 ? num(conv?.['CONVER']) : 1;
          entrada = {
            ...comum,
            pedido: { ano: p.ano, doc: p.doc },
            itens: [
              {
                item: x.item,
                quantidade: cenario === 'com-pedido-completo' ? 10 * fator : 4 * fator,
                valorUnitario: 2,
                fator: 0,
              },
            ],
          };
          return;
        }
        entrada = {
          ...comum,
          itens: [
            {
              item: x.item,
              quantidade: cenario === 'fator-de-unidade' ? 2 : 3,
              valorUnitario: 12,
              fator: cenario === 'fator-de-unidade' ? 10 : 0,
            },
          ],
        };
        return;
      }
      case 'suprimentos.criarPedido': {
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        const b = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1, excluir: [a.item] });
        if (cenario === 'varios-itens')
          entrada = {
            centroCusto: CENTRO_SETOR,
            tipoCompra: 'P',
            fornecedores: await fornecedores(e, 2),
            itens: [
              { item: a.item, quantidade: 10 },
              { item: b.item, quantidade: 5 },
            ],
          };
        else if (cenario === 'com-contrato') {
          // M55 (etapa 3): o pedido ao fornecedor do contrato sintético (só SGH_, desfeito no fim), ligado na mesma
          // transação; as linhas do pedido têm de ser as do pedido sem contrato.
          const [f] = await fornecedores(e, 1);
          const contrato = await contratoSintetico(e, {
            hospital: 'pc',
            fornecedor: f!,
            usuario: 'SINTETICO',
          });
          entrada = {
            centroCusto: CENTRO_SETOR,
            tipoCompra: 'P',
            fornecedores: [f!],
            itens: [
              { item: a.item, quantidade: 10 },
              { item: b.item, quantidade: 5 },
            ],
            contrato: { contrato },
          };
        } else if (cenario === 'recusa-item-repetido') {
          entrada = {
            centroCusto: CENTRO_SETOR,
            tipoCompra: 'P',
            itens: [
              { item: a.item, quantidade: 1 },
              { item: a.item, quantidade: 2 },
            ],
          };
          recusaEsperada = 'item-repetido';
        } else
          entrada = { centroCusto: CENTRO_SETOR, tipoCompra: 'P', itens: [{ item: a.item, quantidade: 10 }] };
        return;
      }
      case 'suprimentos.registrarProposta': {
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        const p = await pedidoDePartida(e, {
          fornecedores: await fornecedores(e, 1),
          itens: [{ item: a.item, quantidade: 10 }],
        });
        const [prop] = await propostas(e, p, a.item);
        if (cenario === 'recusa-linha-mestre') {
          const [m] = await e.consultar(
            "SELECT ID FROM GELANPED WHERE DOC = ? AND ANO = ? AND OQUE = 'P' AND FORN = 0",
            [p.doc, p.ano],
            {
              teto: 1,
            },
          );
          entrada = { pedido: p, proposta: num(m?.['ID']), valorUnitario: 3.25, marca: 'MARCA SINTETICA' };
          recusaEsperada = 'linha-mestre';
        } else
          entrada = { pedido: p, proposta: num(prop?.['ID']), valorUnitario: 3.25, marca: 'MARCA SINTETICA' };
        return;
      }
      case 'suprimentos.definirVencedorCotacao': {
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        const p = await pedidoDePartida(e, {
          fornecedores: await fornecedores(e, 2),
          itens: [{ item: a.item, quantidade: 10 }],
        });
        const ps = await propostas(e, p, a.item);
        const [x, y] = [num(ps[0]?.['ID']), num(ps[1]?.['ID'])];
        await executarOutra(e, 'suprimentos.registrarProposta', { pedido: p, proposta: x, valorUnitario: 2 });
        await executarOutra(e, 'suprimentos.registrarProposta', {
          pedido: p,
          proposta: y,
          valorUnitario: 2.5,
        });
        const comum = { pedido: p, item: a.item, seq: 1 };
        if (cenario === 'rateio-dois-vencedores') entrada = { ...comum, vencedoras: [x, y] };
        else if (cenario === 'troca-de-vencedor') {
          await executarOutra(e, 'suprimentos.definirVencedorCotacao', { ...comum, vencedoras: [x] });
          entrada = {
            ...comum,
            vencedoras: [y],
            justificativa: 'prazo de entrega melhor do segundo fornecedor',
          };
        } else if (cenario === 'recusa-linha-mestre') {
          const [m] = await e.consultar(
            "SELECT ID FROM GELANPED WHERE DOC = ? AND ANO = ? AND OQUE = 'P' AND FORN = 0",
            [p.doc, p.ano],
            {
              teto: 1,
            },
          );
          entrada = { ...comum, vencedoras: [num(m?.['ID'])] };
          recusaEsperada = 'linha-mestre';
        } else entrada = { ...comum, vencedoras: [x] };
        return;
      }
      case 'suprimentos.registrarMovimentoDireto': {
        await usuarioEstoque(e, login, cenario === 'centro-fora-do-escopo' ? { centros: [200100] } : {});
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        itens.add(a.item);
        entrada =
          cenario === 'recusa-sem-atendimento'
            ? {
                para: 'paciente',
                centroCusto: CENTRO_SETOR,
                local: cons,
                itens: [{ item: a.item, quantidade: 1 }],
              }
            : {
                para: 'paciente',
                atendimento: await internacaoComConta(e),
                centroCusto: CENTRO_SETOR,
                local: cons,
                itens: [{ item: a.item, quantidade: 1 }],
              };
        if (cenario === 'recusa-sem-atendimento') recusaEsperada = 'sem-paciente';
        if (cenario === 'centro-fora-do-escopo') recusaEsperada = 'centro-fora-do-escopo';
        return;
      }
      case 'suprimentos.registrarBalanco': {
        const a = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 });
        itens.add(a.item);
        const [v] = await e.consultar(
          'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_INVENTARIO AS VARCHAR(20)) ID FROM RDB$DATABASE',
          [],
          { teto: 1 },
        );
        const inv = num(v?.['ID']);
        await e.executar(
          `INSERT INTO SGH_SUP_INVENTARIO (ID, HOSPITAL, LOCAL_ESTOQUE, TIPO, SITUACAO, LIMITE_PCT, ABERTO_POR)
            VALUES (?, 'pc', ?, 'geral', ?, 2, 'SGH.REPRODUCAO')`,
          [inv, LOCAL_CENTRAL, cenario === 'recusa-nao-aprovado' ? 'contagem' : 'aprovado'],
        );
        await e.executar(
          'INSERT INTO SGH_SUP_INV_ITEM (ID_INVENTARIO, ITEM, SALDO_SISTEMA) VALUES (?, ?, ?)',
          [inv, a.item, a.saldo],
        );
        for (const [ordem, contador] of [
          [1, 'CONTADOR.A'],
          [2, 'CONTADOR.B'],
        ] as const)
          await e.executar(
            `INSERT INTO SGH_SUP_INV_CONTAGEM (ID, ID_INVENTARIO, ITEM, ORDEM, QUANTIDADE, CONTADOR)
              VALUES (NEXT VALUE FOR SGH_GEN_SUP_INV_CONTAGEM, ?, ?, ?, ?, ?)`,
            [inv, a.item, ordem, Math.max(0, a.saldo - 1), contador],
          );
        entrada = { inventario: inv };
        if (cenario === 'recusa-nao-aprovado') recusaEsperada = 'inventario-nao-aprovado';
        return;
      }
      case 'suprimentos.fecharMes': {
        const [u] = await e.consultar(
          'SELECT FIRST 1 ANO, MES FROM GEFECMES ORDER BY ANO DESC, MES DESC',
          [],
          { teto: 1 },
        );
        const ua = num(u?.['ANO']);
        const um = num(u?.['MES']);
        entrada =
          cenario === 'recusa-mes-fechado'
            ? { ano: ua, mes: um }
            : um === 12
              ? { ano: ua + 1, mes: 1 }
              : { ano: ua, mes: um + 1 };
        if (cenario === 'recusa-mes-fechado') recusaEsperada = 'mes-fechado';
        return;
      }
      case 'suprimentos.reabrirMes': {
        await usuarioEstoque(e, login, { desbloquear: cenario !== 'recusa-sem-permissao' });
        const [u] = await e.consultar(
          'SELECT FIRST 1 ANO, MES FROM GEFECMES ORDER BY ANO DESC, MES DESC',
          [],
          { teto: 1 },
        );
        entrada = {
          ano: num(u?.['ANO']),
          mes: num(u?.['MES']),
          motivo: 'conferência do inventário do mês na cópia',
        };
        if (cenario === 'recusa-sem-permissao') recusaEsperada = 'sem-permissao-reabrir';
        return;
      }
      case 'suprimentos.reporKitRastreavel': {
        await usuarioEstoque(e, login);
        const [k] = await e.consultar(
          `SELECT FIRST 1 t.ID, t.ID_GEKITRAS, t.ID_GEITENS FROM GEITEMKITRAS t JOIN GEITENS i ON i.COD = t.ID_GEITENS
            JOIN GESALDOKITRAS s ON s.ID_GEITEMKITRAS = t.ID
            WHERE COALESCE(i.RASTREAR, 0) = 0 AND i.TOTAL > 0 AND i.ESTOQUE >= 1 AND COALESCE(i.PORTARIA, '') = ''
              AND EXISTS (SELECT 1 FROM GEARMLOC a WHERE a.ANO = 2026 AND a.MES = 7 AND a.LOCAL = ? AND a.ITEM = t.ID_GEITENS AND a.QTDE >= 1)
            ORDER BY t.ID DESC`,
          [LOCAL_CENTRAL],
          { teto: 1, tempoMaximoMs: 120_000 },
        );
        if (!k) throw new Error('Nenhum item de kit rastreável com saldo na cópia.');
        kits.add(num(k['ID_GEKITRAS']));
        itens.add(num(k['ID_GEITENS']));
        const s = await saidaDePartida(e, {
          destino: 2,
          local: LOCAL_CENTRAL,
          cdc: CENTRO_SETOR,
          cons,
          item: num(k['ID_GEITENS']),
          quantidade: 1,
        });
        const [outro] = await e.consultar(
          'SELECT FIRST 1 ID FROM GEITEMKITRAS WHERE ID_GEKITRAS <> ? ORDER BY ID',
          [num(k['ID_GEKITRAS'])],
          {
            teto: 1,
          },
        );
        entrada = {
          kit: num(k['ID_GEKITRAS']),
          saida: { ano: s.ano, mes: s.mes, doc: s.doc },
          itens: [
            {
              itemKit: cenario === 'recusa-item-de-outro-kit' ? num(outro?.['ID']) : num(k['ID']),
              lancamentoSaida: s.lancamento,
            },
          ],
        };
        if (cenario === 'recusa-item-de-outro-kit') recusaEsperada = 'item-de-outro-kit';
        return;
      }
      case 'suprimentos.desconsolidarDocumento': {
        await usuarioEstoque(e, login);
        if (cenario === 'recusa-saida') {
          entrada = {
            tipo: 'saida',
            documento: { ano: r.ano, mes: r.mes, doc: 1 },
            motivo: 'saída lançada errada na cópia',
          };
          recusaEsperada = 'nao-desconsolida';
          return;
        }
        const x = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 1 });
        itens.add(x.item);
        const f = (await fornecedores(e, 1))[0]!;
        const res = await executarOutra(e, 'suprimentos.registrarEntradaNF', {
          fornecedor: f,
          numero: 800_000_000 + (Date.now() % 90_000_000),
          serie: '1',
          emissao: r.hoje,
          local: LOCAL_CENTRAL,
          itens: [{ item: x.item, quantidade: 1, valorUnitario: 1 }],
        });
        await registrarDoc(e, 'GECADNFS', res.resultado);
        entrada = {
          tipo: 'nota',
          documento: {
            ano: num(res.resultado['ano']),
            mes: num(res.resultado['mes']),
            doc: num(res.resultado['doc']),
          },
          motivo: 'nota lançada com o fornecedor errado',
        };
        return;
      }
      case 'suprimentos.corrigirValidadeLote': {
        const [v] = await e.consultar(
          cenario === 'recusa-validade-correta'
            ? "SELECT FIRST 1 ID, ITEM FROM GEVALMEM WHERE DATA > DATE '2027-01-01' AND DATA < DATE '2030-01-01' ORDER BY ID"
            : "SELECT FIRST 1 ID, ITEM FROM GEVALMEM WHERE DATA > DATE '2099-12-31' OR (DATA > DATE '1900-01-01' AND DATA < DATE '1990-01-01') ORDER BY ID",
          [],
          { teto: 1 },
        );
        if (!v) throw new Error('Nenhum lote para o cenário na cópia.');
        itens.add(num(v['ITEM']));
        entrada = {
          lote: num(v['ID']),
          validade: '2027-06-30',
          motivo: 'validade digitada com os dígitos trocados',
        };
        if (cenario === 'recusa-validade-correta') recusaEsperada = 'validade-correta';
        return;
      }
    }
    throw new Error(`Operação ${nome} sem reprodução.`);
  };

  return {
    ...base,
    alvosNasTabelasMedias: true,
    entradasDaPreparacao: () => ({ ...extras }),
    chavesAlvo: () => chaves,
    async preparar(e) {
      await preparar(e);
      await lerAlvos(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else {
        const res = await executar(e, entrada);
        const tabela =
          nome === 'suprimentos.registrarSaida' || nome === 'suprimentos.requisitarMaterial'
            ? 'GECADSAI'
            : nome === 'suprimentos.registrarDevolucao'
              ? 'GECADDEV'
              : nome === 'suprimentos.transferir'
                ? 'GECADTRA'
                : nome === 'suprimentos.registrarEntradaNF'
                  ? 'GECADNFS'
                  : nome === 'suprimentos.criarPedido'
                    ? 'GECADPED'
                    : nome === 'suprimentos.registrarBalanco'
                      ? 'GECADBAL'
                      : null;
        if (tabela) await registrarDoc(e, tabela, res.resultado);
        if (tabela === 'GECADPED') extras['NUM_PROCESSO_ADMINISTRATIVO']?.push(num(res.resultado['doc']));
      }
      await lerAlvos(e);
    },
  };
}
