// Reprodução dos cenários de assinatura da prescrição (M24; ficha, seção 9) pelo EXECUTOR, na transação da captura
// (sempre desfeita). A prescrição é de um PROFISSIONAL da cópia (o executor confere que o usuário da sessão é o dono
// do CBO ativo; login e CBO só em memória, nunca impressos), num atendimento aberto existente (paciente e retratos só
// por ID, em memória), para o período SEGUINTE pela regra do horário de medicação da unidade (todos os horários da
// grade caem no período, então a forma de cada cenário é exata). Os itens saem do cadastro da cópia (produtos sem
// princípio ligado, para a alergia e a duplicidade só aparecerem onde o cenário pede), montados pelo MESMO domínio da
// aplicação (montarItem, documento, horários previstos). Nenhum dado de pessoa sai daqui.
import { condicaoLoginDoProfissional, parametrosLogin } from '@sgh/legado';
import { createHash } from 'node:crypto';
import { type ItemPrescricao, esquemaItemPrescricao } from '@sgh/contratos';
import {
  documentoPrescricao,
  type ItemDocumento,
  type ItemMontado,
  kitQueCasa,
  montarItem,
  periodos,
  regraDaUnidade,
} from '@sgh/dominio-pep';
import {
  atendimentoDaPrescricao,
  cabecalhoDocumento,
  type CenarioCaptura,
  ErroOperacao,
  type Escritor,
  FORMA_COPIA,
  FORMAS_PRESCREVER,
  type FormaItem,
  type GravacaoPrescricao,
  HORARIOS_PREPARO_ITEM,
  kitsDoProduto,
  regrasDeHorario,
  retratosAtuais,
} from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_PRESCRICAO = new Set([
  'pep.prescrever',
  'pep.copiarPrescricao',
  'pep.renovarPrescricao',
  'pep.incluirItem',
  'pep.suspenderItem',
  'pep.suspenderPrescricao',
]);

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? NaN));
const txt = (v: unknown): string => String(v ?? '').trim();
const MARCA = 'SINTETICO M24';

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** O mais frequente de uma coluna em uso (cadastro realmente usado pelo legado; só o código, em memória). */
async function maisUsado(e: Escritor, sql: string, p: readonly unknown[] = []): Promise<string | null> {
  const [r] = await e.consultar(sql, p, { teto: 1, tempoMaximoMs: 120_000 });
  const v = r?.['V'];
  return v === null || v === undefined ? null : txt(v);
}

export interface Prescritor {
  readonly login: string;
  readonly cbo: number;
}

/** Profissional com CBO ativo da família pedida e login único (só em memória). */
export async function prescritorDaCopia(
  e: Escritor,
  familia: string,
  exceto?: Prescritor,
): Promise<Prescritor> {
  const ls = await e.consultar(
    `SELECT FIRST 40 r.ID CBO, u.NOME LOGIN FROM TBCBOPRO r JOIN TBCBOSUS s ON s.ID = r.ID_TBCBOSUS
       JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')}
      WHERE COALESCE(r.ATIVO, 'T') <> 'F' AND s.COD STARTING WITH ? ORDER BY r.ID DESC`,
    [familia],
    { teto: 40 },
  );
  for (const l of ls) {
    const p = { login: txt(l['LOGIN']), cbo: num(l['CBO']) };
    if (exceto && p.login === exceto.login) continue;
    const [n] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [p.login], { teto: 1 });
    const [m] = await e.consultar(
      `SELECT COUNT(*) N FROM TBCBOPRO r JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS WHERE ${condicaoLoginDoProfissional('p')} AND COALESCE(r.ATIVO, 'T') <> 'F'`,
      parametrosLogin(p.login),
      { teto: 1 },
    );
    if (num(n?.['N']) === 1 && num(m?.['N']) >= 1) return p;
  }
  throw new Error(`Nenhum profissional com CBO ${familia} ativo na cópia.`);
}

export interface AtendimentoAberto {
  readonly id: number;
  readonly paciente: number;
  readonly tipo: string;
  readonly retratos: { readonly htAtendimento: number; readonly htPaciente: number };
  readonly grade: ReadonlyMap<number, readonly string[]>;
  readonly vigencias: { atual: { inicio: string; fim: string }; seguinte: { inicio: string; fim: string } };
  readonly agora: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const localSeg = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

/** Um atendimento aberto (internação de preferência) do paciente sem nenhuma prescrição ativa nos próximos dias. */
export async function atendimentoAberto(
  e: Escritor,
  exceto: readonly number[] = [],
): Promise<AtendimentoAberto> {
  const ls = await e.consultar(
    `SELECT FIRST 30 a.ID, a.ID_RICADPAC P FROM ATCABECATEND a
      WHERE a.DATA_HORA_SAIDA_EFETIVA IS NULL AND COALESCE(a.ATIVO, 'T') <> 'F' AND a.TP_ATENDIMENTO IN ('I', 'E')
        AND EXISTS (SELECT 1 FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID)
        AND NOT EXISTS (SELECT 1 FROM PRPRESC x WHERE x.ID_ATCABECATEND_INTEGRACAO = a.ID AND x.DATA_HORA_FINAL_VIGENCIA > CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM PRALERGIAPAC g JOIN PRCABEVOL c ON c.ID_CABEVOL = g.ID_PRCABEVOL
                         JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE WHERE h.ID_RICADPAC = a.ID_RICADPAC)
      ORDER BY CASE WHEN a.TP_ATENDIMENTO = 'I' THEN 0 ELSE 1 END, a.ID DESC`,
    [],
    { teto: 30, tempoMaximoMs: 120_000 },
  );
  const { regras, porBloco } = await regrasDeHorario(e);
  const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
  const agora = localSeg(ag?.['T'] as Date);
  for (const l of ls) {
    const id = num(l['ID']);
    if (exceto.includes(id)) continue;
    const paciente = num(l['P']);
    const r = await retratosAtuais(e, id, paciente);
    const a = await atendimentoDaPrescricao(e, id);
    if (!r?.doPaciente || !a?.aberto) continue;
    const regra = regraDaUnidade(regras, porBloco, a.bloco, a.tipo === 'I' ? 'I' : 'E');
    if (!regra) continue;
    const grade = regras.find((x) => x.id === regra.id)?.grade ?? new Map();
    // O externo (vigência a partir do minuto) também serve; a internação é a preferida (16:01 às 16:00).
    return {
      id,
      paciente,
      tipo: a.tipo,
      retratos: { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente },
      grade,
      vigencias: periodos(regra, agora.slice(0, 16)),
      agora,
    };
  }
  throw new Error('Nenhum atendimento aberto sem prescrição ativa na cópia.');
}

/**
 * M27 (jornada J2): um atendimento escolhido (o do pronto atendimento aberto na jornada), com os retratos, a grade da
 * unidade e as vigências, como `atendimentoAberto` monta para o primeiro da cópia.
 */
export async function atendimentoParaPrescrever(e: Escritor, id: number): Promise<AtendimentoAberto> {
  const [l] = await e.consultar('SELECT ID_RICADPAC P FROM ATCABECATEND WHERE ID = ?', [id], { teto: 1 });
  if (!l) throw new Error('Atendimento da jornada não encontrado.');
  const paciente = num(l['P']);
  const { regras, porBloco } = await regrasDeHorario(e);
  const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
  const agora = localSeg(ag?.['T'] as Date);
  const r = await retratosAtuais(e, id, paciente);
  const a = await atendimentoDaPrescricao(e, id);
  if (!r?.doPaciente || !a?.aberto) throw new Error('Atendimento da jornada sem retratos ou fechado.');
  const regra = regraDaUnidade(regras, porBloco, a.bloco, a.tipo === 'I' ? 'I' : 'E');
  if (!regra) throw new Error('Unidade do atendimento da jornada sem regra de horário.');
  return {
    id,
    paciente,
    tipo: a.tipo,
    retratos: { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente },
    grade: regras.find((x) => x.id === regra.id)?.grade ?? new Map(),
    vigencias: periodos(regra, agora.slice(0, 16)),
    agora,
  };
}

/** Produto padronizado (ou não) sem princípio ligado e sem kit, com a unidade do cadastro (só o código). */
async function produtoSimples(
  e: Escritor,
  opcoes: { padronizado?: boolean; comKit?: boolean; exceto?: readonly number[] } = {},
): Promise<{ produto: number; unidade: string; nome: string }> {
  const ls = await e.consultar(
    `SELECT FIRST 60 g.COD, g.UNI_CON, g.NOME FROM GEITENS g JOIN TBUNICON u ON u.COD = g.UNI_CON
      WHERE g.COD > 0 AND g.PADRONIZADO = ? AND COALESCE(g.ANTIMI, 'F') <> 'T' AND COALESCE(g.PSICO, 'F') <> 'T'
        AND NOT EXISTS (SELECT 1 FROM GEITENS_TBPRINC x WHERE x.ID_GEITENS = g.COD)
        AND ${opcoes.comKit ? '' : 'NOT '}EXISTS (SELECT 1 FROM PRKITMED k WHERE k.ID_GEITENS = g.COD)
      ORDER BY g.COD`,
    [opcoes.padronizado === false ? 'F' : 'T'],
    { teto: 60 },
  );
  for (const l of ls) {
    const cod = num(l['COD']);
    if (opcoes.exceto?.includes(cod)) continue;
    return { produto: cod, unidade: txt(l['UNI_CON']), nome: txt(l['NOME']) };
  }
  throw new Error('Nenhum produto do cadastro para o cenário.');
}

/** O kit de medicamento com exatamente dois materiais (e o produto, a via, a unidade e uma dose da faixa). */
async function kitDeDois(
  e: Escritor,
): Promise<{ produto: number; via: string; unidade: string; dose: number }> {
  const ls = await e.consultar(
    `SELECT FIRST 50 k.ID, k.ID_GEITENS G, k.ID_GETABVIA V, k.ID_TBUNICON_UNI_PRESC U, k.INTERVALO_INICIAL_DOSE A,
            k.INTERVALO_FINAL_DOSE B, k.TP_ATENDIMENTO T
       FROM PRKITMED k WHERE COALESCE(k.ATIVO, 'T') = 'T'
        AND (SELECT COUNT(*) FROM PRITENSKITMED i WHERE i.ID_PRKITMED = k.ID) = 2
        AND NOT EXISTS (SELECT 1 FROM GEITENS_TBPRINC x WHERE x.ID_GEITENS = k.ID_GEITENS)
      ORDER BY k.ID`,
    [],
    { teto: 50 },
  );
  // O kit que a montagem escolhe para o produto, a via, a unidade e a dose tem de ser este (dois materiais): com
  // outros kits do mesmo produto, vale o mais específico.
  for (const l of ls) {
    const t = txt(l['T']);
    if (t !== '' && t !== 'A' && t !== 'I') continue;
    const a = num(l['A']);
    const b = num(l['B']);
    const pedido = {
      produto: num(l['G']),
      via: txt(l['V']),
      unidade: txt(l['U']),
      dose: b > a ? (a + b) / 2 : Math.max(a, 1),
    };
    const escolhido = kitQueCasa(await kitsDoProduto(e, pedido.produto), { ...pedido, tipoAtendimento: 'I' });
    if (escolhido.length === 2) return pedido;
  }
  throw new Error('Nenhum kit de medicamento com dois materiais na cópia.');
}

export interface CadastrosCenario {
  readonly via: string;
  readonly viaDieta: string;
  readonly procedimento: number;
  readonly motivo: number;
  readonly relativos: readonly { id: number; horario: string }[];
  readonly dietaOral: number;
  readonly dietaEnteral: number;
  readonly viaAdmDieta: number;
  readonly unidadeDieta: string;
  readonly tipoInfusaoDieta: number;
  readonly unidadeInfusaoDieta: number;
  readonly tipoInfusaoSolucao: number;
  readonly unidadeInfusaoSolucao: number;
  readonly viaSolucao: string;
  readonly viaAerea: number;
  readonly modoVmi: number;
  readonly modoVni: number;
  readonly unidadeVolume: string;
  readonly unidadePressao: number;
  readonly unidadeFio2: number;
  readonly hemo: { ato: number; codigo: string };
  readonly unidadeHemo: string;
  readonly tipoInfusaoHemo: number;
  readonly protocolo: number;
  readonly htcid: number;
}

/** Os códigos de cadastro mais usados pelo legado em cada tipo (só códigos, em memória). */
export async function cadastrosDoCenario(e: Escritor): Promise<CadastrosCenario> {
  const exigir = (v: string | null, o: string): string => {
    if (v === null || v === '') throw new Error(`Cadastro ausente na cópia: ${o}.`);
    return v;
  };
  const rec =
    'FROM PRLANGERAL l JOIN PRPRESC p ON p.ID = l.ID_PRPRESC WHERE p.DATA_HORA_GRAVACAO >= DATEADD(-365 DAY TO CURRENT_DATE)';
  const ultimo = 'p.DATA_HORA_GRAVACAO >= DATEADD(-365 DAY TO CURRENT_DATE)';
  const via = exigir(
    await maisUsado(
      e,
      `SELECT FIRST 1 l.ID_GETABVIA V ${rec} AND l.ID_PRTPLAN = 6 AND l.ID_GETABVIA IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
    ),
    'via do medicamento',
  );
  const viaDieta = exigir(
    await maisUsado(
      e,
      `SELECT FIRST 1 l.ID_GETABVIA V ${rec} AND l.ID_PRTPLAN = 3 AND l.ID_GETABVIA IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
    ),
    'via da dieta',
  );
  const viaSolucao = exigir(
    await maisUsado(
      e,
      `SELECT FIRST 1 l.ID_GETABVIA V ${rec} AND l.ID_PRTPLAN = 7 AND l.ID_GETABVIA IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
    ),
    'via da solução',
  );
  const procedimento = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 x.ID_TBPROENF V FROM PRPRESCPROCED x JOIN PRLANGERAL l ON l.ID = x.ID_PRLANGERAL JOIN PRPRESC p ON p.ID = l.ID_PRPRESC WHERE ${ultimo} AND l.ID_PRTPLAN = 13 AND NOT EXISTS (SELECT 1 FROM PRITENSGERAL g WHERE g.ID_PRLANGERAL = l.ID) GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'cuidado',
    ),
  );
  const relativos = (
    await e.consultar('SELECT FIRST 2 ID, HORARIO FROM PRHRRELATIVA ORDER BY ID', [], { teto: 2 })
  ).map((r) => {
    const d = r['HORARIO'] as Date;
    return { id: num(r['ID']), horario: `${p2(d.getHours())}${p2(d.getMinutes())}` };
  });
  const dietaOral = num(
    exigir(
      await maisUsado(
        e,
        "SELECT FIRST 1 h.ID_TBDIETAS V FROM PRHORPAD h WHERE h.SITUACAO = 'T' AND h.ID_TBDIETAS > 0 GROUP BY 1 HAVING COUNT(*) = 6 ORDER BY 1",
      ),
      'dieta com seis horários',
    ),
  );
  const dietaEnteral = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 d.ID_TBDIETAS V FROM PRPRESCDIETA d JOIN PRLANGERAL l ON l.ID = d.ID_PRLANGERAL JOIN PRPRESC p ON p.ID = l.ID_PRPRESC WHERE ${ultimo} AND l.ID_PRTPLAN = 4 AND NOT EXISTS (SELECT 1 FROM PRHORPAD h WHERE h.ID_TBDIETAS = d.ID_TBDIETAS AND h.SITUACAO = 'T') GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'dieta enteral',
    ),
  );
  const enteral = `FROM PRPRESCDIETA d JOIN PRLANGERAL l ON l.ID = d.ID_PRLANGERAL JOIN PRPRESC p ON p.ID = l.ID_PRPRESC WHERE ${ultimo} AND l.ID_PRTPLAN = 4`;
  const viaAdmDieta = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 d.ID_PRVIAADMIN V ${enteral} AND d.ID_PRVIAADMIN IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'via da enteral',
    ),
  );
  const unidadeDieta = exigir(
    await maisUsado(
      e,
      `SELECT FIRST 1 d.ID_TBUNICON_UNI_PRESC V ${enteral} AND d.ID_TBUNICON_UNI_PRESC IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
    ),
    'unidade da enteral',
  );
  const tipoInfusaoDieta = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 d.ID_PRTPINFUSAO V ${enteral} AND d.ID_PRTPINFUSAO IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'tipo de infusão da enteral',
    ),
  );
  const unidadeInfusaoDieta = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 d.ID_PRUNIDINFUSAO V ${enteral} AND d.ID_PRUNIDINFUSAO IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'unidade da velocidade da enteral',
    ),
  );
  const tipoInfusaoSolucao = num(
    exigir(
      await maisUsado(
        e,
        `SELECT FIRST 1 s.ID_PRTPINFUSAO V FROM PRPRESCSOL s JOIN PRLANGERAL l ON l.ID = s.ID_PRLANGERAL JOIN PRPRESC p ON p.ID = l.ID_PRPRESC WHERE ${ultimo} GROUP BY 1 ORDER BY COUNT(*) DESC`,
      ),
      'tipo de infusão da solução',
    ),
  );
  const unidadeInfusaoSolucao = num(
    exigir(
      await maisUsado(
        e,
        'SELECT FIRST 1 v.ID_PRUNIDINFUSAO V FROM PRVELOCINFUSAO v WHERE v.ID_PRUNIDINFUSAO IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC',
      ),
      'unidade da velocidade da solução',
    ),
  );
  const viaAerea = num(
    exigir(
      await maisUsado(
        e,
        'SELECT FIRST 1 v.ID_PRVIAAEREA V FROM PRPRESCVI v GROUP BY 1 ORDER BY COUNT(*) DESC',
      ),
      'via aérea',
    ),
  );
  const modoVmi = num(
    exigir(
      await maisUsado(e, 'SELECT FIRST 1 m.ID V FROM PRMODOVENT m WHERE m.ID_PRTPLAN = 12 ORDER BY m.ID'),
      'modo VMI',
    ),
  );
  const modoVni = num(
    exigir(
      await maisUsado(e, 'SELECT FIRST 1 m.ID V FROM PRMODOVENT m WHERE m.ID_PRTPLAN = 11 ORDER BY m.ID'),
      'modo VNI',
    ),
  );
  const unidadeVolume = exigir(
    await maisUsado(
      e,
      'SELECT FIRST 1 v.ID_TBUNICON_UNI_PRESC V FROM PRPRESCVI v GROUP BY 1 ORDER BY COUNT(*) DESC',
    ),
    'unidade do volume',
  );
  const unidadePressao = num(
    exigir(
      await maisUsado(
        e,
        'SELECT FIRST 1 v.ID_PRUNIDRESPOSTA_PRESSAO V FROM PRPRESCVI v WHERE v.ID_PRUNIDRESPOSTA_PRESSAO IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC',
      ),
      'unidade da pressão',
    ),
  );
  const unidadeFio2 = num(
    exigir(
      await maisUsado(
        e,
        'SELECT FIRST 1 v.ID_PRUNIDRESPOSTA_FIO2 V FROM PRPRESCVI v WHERE v.ID_PRUNIDRESPOSTA_FIO2 IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC',
      ),
      'unidade da FiO2',
    ),
  );
  const [h] = await e.consultar(
    'SELECT FIRST 1 x.ATO_SITABPRO ATO, x.CODALF_SITABPRO CODALF FROM PRPRESCHEMO x WHERE x.CODALF_SITABPRO IS NOT NULL GROUP BY 1, 2 ORDER BY COUNT(*) DESC',
    [],
    { teto: 1 },
  );
  if (!h) throw new Error('Cadastro ausente na cópia: hemocomponente.');
  const unidadeHemo = exigir(
    await maisUsado(
      e,
      'SELECT FIRST 1 x.ID_TBUNICON_UNI_PRESC V FROM PRPRESCHEMO x GROUP BY 1 ORDER BY COUNT(*) DESC',
    ),
    'unidade da hemoterapia',
  );
  const tipoInfusaoHemo = num(
    exigir(
      await maisUsado(
        e,
        'SELECT FIRST 1 x.ID_PRTPINFUSAO V FROM PRPRESCHEMO x GROUP BY 1 ORDER BY COUNT(*) DESC',
      ),
      'tipo de infusão da hemoterapia',
    ),
  );
  const protocolo = num(
    exigir(
      await maisUsado(
        e,
        "SELECT FIRST 1 p.ID_PROTGERAL V FROM PRPROTGERAL p WHERE p.ATIVO = 'T' ORDER BY p.ID_PROTGERAL",
      ),
      'protocolo',
    ),
  );
  const htcid = num(
    exigir(await maisUsado(e, 'SELECT FIRST 1 h.ID V FROM HTCID h ORDER BY h.ID DESC'), 'retrato de CID'),
  );
  const motivo = num(
    exigir(
      await maisUsado(e, 'SELECT FIRST 1 ID V FROM PRSENECESSARIO ORDER BY ID'),
      'condição do "se necessário"',
    ),
  );
  return {
    via,
    viaDieta,
    procedimento,
    motivo,
    relativos,
    dietaOral,
    dietaEnteral,
    viaAdmDieta,
    unidadeDieta,
    tipoInfusaoDieta,
    unidadeInfusaoDieta,
    tipoInfusaoSolucao,
    unidadeInfusaoSolucao,
    viaSolucao,
    viaAerea,
    modoVmi,
    modoVni,
    unidadeVolume,
    unidadePressao,
    unidadeFio2,
    hemo: { ato: num(h['ATO']), codigo: txt(h['CODALF']) },
    unidadeHemo,
    tipoInfusaoHemo,
    protocolo,
    htcid,
  };
}

export interface ItemDoCenario {
  readonly tela: ItemPrescricao;
  readonly nomes: { produto: string; plano: string };
}

/** O item da tela de cada forma (os códigos do cadastro da cópia; textos sintéticos). */
export async function itemDaForma(
  e: Escritor,
  f: FormaItem,
  k: number,
  c: CadastrosCenario,
  usados: number[],
): Promise<ItemPrescricao> {
  const chave = `item-${k + 1}`;
  // A observação para a enfermagem fica vazia: nenhum cenário a declara (a referência espera a coluna vazia).
  const observacaoEnfermagem: string | undefined = undefined;
  let detalhe: unknown;
  switch (f.tipo) {
    case 'medicamento': {
      const kit = f.kit ? await kitDeDois(e) : null;
      const p = kit
        ? { produto: kit.produto, unidade: kit.unidade }
        : await produtoSimples(e, { padronizado: !f.naoPadronizado, exceto: usados });
      usados.push(p.produto);
      detalhe = {
        tipo: 'medicamento',
        item: {
          produto: p.produto,
          ...(f.naoPadronizado
            ? { naoPadronizado: { justificativa: `Justificativa ${MARCA} do item`, cid: 'A09' } }
            : {}),
        },
        dose: kit ? kit.dose : 1,
        unidade: p.unidade,
        via: kit ? kit.via : c.via,
        frequencia: f.frequencia,
        relativos: f.relativos ? c.relativos.map((r) => r.id) : [],
        ...(f.seNecessario ? { seNecessario: { motivos: [c.motivo], intervaloMinimoHoras: 6 } } : {}),
        iniciarAgora: f.agora ?? false,
        naoAjustar: false,
      };
      break;
    }
    case 'procedimento':
      detalhe = {
        tipo: 'procedimento',
        procedimento: c.procedimento,
        frequencia: f.frequencia,
        iniciarAgora: false,
        naoAjustar: false,
      };
      break;
    case 'glicemia': {
      const ins = await produtoSimples(e, { exceto: usados });
      usados.push(ins.produto);
      detalhe = {
        tipo: 'glicemia',
        procedimento: c.procedimento,
        frequencia: f.frequencia,
        faixas: [
          { de: 161, ate: 180, produto: ins.produto, dose: 2, unidade: ins.unidade, via: c.via },
          { de: 181, ate: 200, produto: ins.produto, dose: 4, unidade: ins.unidade, via: c.via },
        ].slice(0, f.faixas ?? 2),
        iniciarAgora: false,
        naoAjustar: false,
      };
      break;
    }
    case 'dieta-oral':
      detalhe = {
        tipo: 'dieta-oral',
        dieta: c.dietaOral,
        frequencia: null,
        via: c.viaDieta,
        quantidade: 1,
        caracteristicas: [],
      };
      break;
    case 'dieta-enteral':
      detalhe = {
        tipo: 'dieta-enteral',
        dieta: c.dietaEnteral,
        frequencia: f.frequencia,
        viaDieta: c.viaAdmDieta,
        quantidade: 300,
        unidade: c.unidadeDieta,
        tipoInfusao: c.tipoInfusaoDieta,
        velocidade: 50,
        unidadeInfusao: c.unidadeInfusaoDieta,
        caracteristicas: [],
      };
      break;
    case 'solucao': {
      const a = await produtoSimples(e, { exceto: usados });
      usados.push(a.produto);
      const b = await produtoSimples(e, { exceto: usados });
      usados.push(b.produto);
      detalhe = {
        tipo: 'solucao',
        via: c.viaSolucao,
        frequencia: f.frequencia,
        unidade: a.unidade,
        tipoInfusao: c.tipoInfusaoSolucao,
        componentes: [
          { produto: a.produto, dose: 500, unidade: a.unidade, principal: true },
          { produto: b.produto, dose: 10, unidade: b.unidade, principal: false },
        ].slice(0, f.componentes ?? 2),
        etapas: [{ etapa: 1, velocidade: 21, unidadeInfusao: c.unidadeInfusaoSolucao }],
        iniciarAgora: false,
        naoAjustar: false,
      };
      break;
    }
    case 'vmi':
      detalhe = {
        tipo: 'vmi',
        viaAerea: c.viaAerea,
        modo: c.modoVmi,
        frequencia: f.frequencia,
        fio2: 40,
        pressaoInspiratoria: 14,
        peep: 8,
        volumeCorrente: 400,
        frequenciaRespiratoria: 12,
      };
      break;
    case 'vni':
      detalhe = {
        tipo: 'vni',
        viaAerea: c.viaAerea,
        modo: c.modoVni,
        frequencia: f.frequencia,
        fio2: 30,
        pressaoInspiratoria: 10,
      };
      break;
    case 'hemoterapia':
      detalhe = {
        tipo: 'hemoterapia',
        hemocomponente: c.hemo,
        dose: 1,
        unidade: c.unidadeHemo,
        frequencia: f.frequencia,
        indicacao: `Indicacao clinica ${MARCA} sem dado real`,
        iniciarAgora: false,
      };
      break;
  }
  return esquemaItemPrescricao.parse({
    chave,
    detalhe,
    ...(observacaoEnfermagem ? { observacaoEnfermagem } : {}),
  });
}

/** A gravação como a API monta (montagem do domínio, documento com os marcadores, prova). */
export async function gravacaoDe(
  e: Escritor,
  at: AtendimentoAberto,
  prescritor: Prescritor,
  itens: readonly ItemPrescricao[],
  c: CadastrosCenario,
  extra: {
    periodo?: 'seguinte' | 'depois';
    protocolos?: number[];
    origem?: GravacaoPrescricao['origem'];
    decisoes?: GravacaoPrescricao['sgh']['decisoes'];
  } = {},
): Promise<GravacaoPrescricao> {
  const base = at.vigencias.seguinte;
  const desloca = (s: string) => {
    const d = new Date(`${s}:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 16);
  };
  const vigencia =
    extra.periodo === 'depois' ? { inicio: desloca(base.inicio), fim: desloca(base.fim) } : base;
  const horariosDieta = new Map<number, string[]>();
  for (const r of await e.consultar(
    "SELECT ID_TBDIETAS D, HORARIO H FROM PRHORPAD WHERE SITUACAO = 'T'",
    [],
    { teto: 500 },
  ))
    horariosDieta.set(num(r['D']), [...(horariosDieta.get(num(r['D'])) ?? []), txt(r['H'])]);
  const kits = new Map<number, Awaited<ReturnType<typeof kitsDoProduto>>>();
  for (const i of itens)
    if (i.detalhe.tipo === 'medicamento')
      kits.set(i.detalhe.item.produto, await kitsDoProduto(e, i.detalhe.item.produto));
  const ctx = {
    vigencia,
    agora: at.agora.slice(0, 16),
    grade: at.grade,
    relativos: new Map(c.relativos.map((r) => [r.id, r.horario])),
    horariosDieta: (d: number) => horariosDieta.get(d) ?? [],
    kit: (produto: number, via: string, unidade: string, dose: number) =>
      kitQueCasa(kits.get(produto) ?? [], { produto, via, unidade, dose, tipoAtendimento: at.tipo }),
    retratoCid: () => c.htcid,
  };
  const padroes = {
    unidadeVolume: c.unidadeVolume,
    unidadePressao: c.unidadePressao,
    unidadeFio2: c.unidadeFio2,
    tipoInfusaoHemoterapia: c.tipoInfusaoHemo,
    unidadeHemoterapia: c.unidadeHemo,
  };
  const montados: ItemMontado[] = itens.map((i) => montarItem(i, ctx, padroes));
  const cab = await cabecalhoDocumento(e, at.retratos, prescritor.cbo, 3);
  const docItens: ItemDocumento[] = montados.map((m) => ({
    chave: m.chave,
    plano: m.plano,
    planoNome: `Tipo ${m.plano}`,
    numDoses: m.numDose,
    frequencia: m.frequencia === null ? null : { id: m.frequencia, nome: `Frequencia ${m.frequencia}` },
    via: m.via === null ? null : { id: m.via, nome: m.via },
    detalhe: detalheDoDocumento(m),
  }));
  const documento = documentoPrescricao(
    {
      hospital: cab.hospital,
      paciente: cab.paciente,
      atendimento: cab.atendimento,
      profissional: cab.profissional,
      tipoAssinatura: 'Prescrição Geral',
    },
    docItens,
  );
  return {
    paciente: at.paciente,
    atendimento: at.id,
    cbo: prescritor.cbo,
    retratos: at.retratos,
    dataHora: at.agora,
    vigencia,
    justificativaRetroativo: null,
    observacaoGeral: null,
    protocolos: extra.protocolos ?? [],
    itens: montados,
    origem: extra.origem ?? null,
    documento,
    hashConteudo: createHash('sha256').update(JSON.stringify(montados)).digest('hex'),
    sgh: {
      prioridade: 'rotina',
      nota: null,
      coassinaturaExigida: false,
      origemModo: extra.origem?.modo ?? (extra.protocolos?.length ? 'protocolo' : null),
      origemId: extra.origem?.prescricao ?? extra.protocolos?.[0] ?? null,
      itens: [],
      decisoes: extra.decisoes ?? [],
      fichas: [],
      futuras: [],
      comoSuporte: false,
    },
  };
}

function horariosDoc(m: ItemMontado, sufixo = (i: number) => `${m.chave}:${i}`) {
  return m.horarios.map((h, i) => ({
    chave: sufixo(i),
    dataHora: h.dataHora,
    relativo: h.relativo === null ? null : { id: h.relativo, nome: `Ancora ${h.relativo}` },
  }));
}

function detalheDoDocumento(m: ItemMontado): ItemDocumento['detalhe'] {
  const d = m.detalhe;
  switch (d.tipo) {
    case 'medicamento':
      return {
        tipo: 'medicamento',
        produto: d.produto,
        nome: `Produto ${d.produto}`,
        dose: d.dose,
        unidade: d.unidade,
        agora: d.agora,
        horarios: horariosDoc(m),
        kit: d.kit.map((k, j) => ({
          ...k,
          nome: `Material ${k.produto}`,
          horarios: horariosDoc(m, (i) => `${m.chave}:${i}:kit${j}`),
        })),
      };
    case 'procedimento':
      return {
        tipo: 'procedimento',
        procedimento: d.procedimento,
        nome: `Cuidado ${d.procedimento}`,
        agora: d.agora,
        horarios: horariosDoc(m),
      };
    case 'dieta':
      return {
        tipo: 'dieta',
        dieta: d.dieta,
        nome: `Dieta ${d.dieta}`,
        quantidade: d.quantidade,
        unidade: d.unidade,
        horarios: horariosDoc(m),
      };
    case 'solucao':
      return {
        tipo: 'solucao',
        unidade: d.unidade,
        tipoInfusao: { id: d.tipoInfusao, nome: `Infusao ${d.tipoInfusao}` },
        agora: d.agora,
        componentes: d.componentes.map((cp, i) => ({
          ...cp,
          nome: `Produto ${cp.produto}`,
          horario: { chave: `${m.chave}:esq${i}`, dataHora: d.etapas[0]?.inicio ?? '', relativo: null },
        })),
      };
    case 'vmi':
    case 'vni':
      return { tipo: 'ventilacao', modo: { id: d.modo, nome: `Modo ${d.modo}` }, horarios: horariosDoc(m) };
    case 'hemoterapia':
      return {
        tipo: 'hemoterapia',
        codigo: d.codigo,
        nome: d.codigo,
        dose: d.dose,
        unidade: d.unidade,
        horarios: horariosDoc(m),
      };
  }
}

/** Cenário de captura de uma operação da prescrição. */
export function cenarioPrescricao(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const alvos: Record<string, Record<string, unknown>[]> = {};
  let prescricaoDaCorrecao: number | null = null;
  const rodar = async (e: Escritor) => {
    if (recusaEsperada) return exigirRecusa(executar(e, entrada), recusaEsperada);
    await executar(e, entrada);
  };
  const comum = async (e: Escritor) => {
    const medico = await prescritorDaCopia(e, '2251');
    const at = await atendimentoAberto(e);
    const c = await cadastrosDoCenario(e);
    definirOperador(medico.login);
    return { medico, at, c };
  };
  const prescreverPreparo = async (
    e: Escritor,
    p: { medico: Prescritor; at: AtendimentoAberto; c: CadastrosCenario },
    formas: readonly FormaItem[],
    periodo: 'seguinte' | 'depois' = 'seguinte',
  ) => {
    const usados: number[] = [];
    const itens = [];
    for (const [k, f] of formas.entries()) itens.push(await itemDaForma(e, f, k, p.c, usados));
    const g = await gravacaoDe(e, p.at, p.medico, itens, p.c, { periodo });
    const r = await executarOutra(e, 'pep.prescrever', g, p.medico.login);
    const prescricao = num(r.resultado['prescricao']);
    const ids = (
      await e.consultar('SELECT ID FROM PRLANGERAL WHERE ID_PRPRESC = ? ORDER BY ID', [prescricao], {
        teto: 100,
      })
    ).map((x) => num(x['ID']));
    return { prescricao, itens: ids, gravacao: g, telas: itens, usados };
  };
  const suspensaoBase = (p: { medico: Prescritor; at: AtendimentoAberto }, prescricao: number) => ({
    prescricao,
    paciente: p.at.paciente,
    atendimento: p.at.id,
    cbo: p.medico.cbo,
    justificativa: `Suspensao ${MARCA} por troca de conduta`,
    documento:
      '<?xml version="1.0" encoding="Windows-1252" standalone="no"?><documento><versaoXML>1</versaoXML></documento>',
    hashConteudo: createHash('sha256').update(`${MARCA}:${prescricao}`).digest('hex'),
    comoSuporte: false,
  });

  if (nome === 'pep.prescrever') {
    return {
      ...base,
      async preparar(e) {
        const p = await comum(e);
        const forma = FORMAS_PRESCREVER[cenario];
        if (forma) {
          const prescritor =
            forma.prescritor === 'nutricionista'
              ? await prescritorDaCopia(e, '2237')
              : forma.prescritor === 'enfermeiro'
                ? await prescritorDaCopia(e, '2235')
                : p.medico;
          definirOperador(prescritor.login);
          const usados: number[] = [];
          const itens: ItemPrescricao[] = [];
          for (const [k, f] of forma.itens.entries()) itens.push(await itemDaForma(e, f, k, p.c, usados));
          let decisoes: GravacaoPrescricao['sgh']['decisoes'] = [];
          if (cenario === 'alergia-justificada') {
            // A alergia ativa do paciente ao princípio do produto (linhas do outro sistema, na transação desfeita).
            const med = itens[0]!.detalhe as Extract<ItemPrescricao['detalhe'], { tipo: 'medicamento' }>;
            await alergiaSintetica(e, p.at, med.item.produto);
            decisoes = [
              {
                chave: itens[0]!.chave,
                alerta: `alergia:${med.item.produto}:0`,
                tipo: 'alergia',
                nivel: 'justificar',
                regra: 'alergia',
                versaoRegra: 1,
                decisao: 'mantido',
                justificativa: `Justificativa ${MARCA}: reacao leve antiga`,
              },
            ];
            itens[0] = {
              ...itens[0]!,
              decisoes: decisoes.map((d) => ({
                alerta: d.alerta,
                decisao: 'mantido',
                justificativa: d.justificativa ?? '',
              })),
            };
          }
          entrada = await gravacaoDe(e, p.at, prescritor, itens, p.c, {
            ...(forma.protocolo ? { protocolos: [p.c.protocolo] } : {}),
            decisoes,
          });
          return;
        }
        if (cenario === 'recusa-outra-ativa') {
          const pre = await prescreverPreparo(e, p, [{ tipo: 'medicamento', frequencia: 9, horarios: 3 }]);
          recusaEsperada = 'outra-ativa-no-periodo';
          entrada = pre.gravacao;
        } else if (cenario === 'recusa-duplicidade') {
          const usados: number[] = [];
          const a = await itemDaForma(e, { tipo: 'medicamento', frequencia: 9, horarios: 3 }, 0, p.c, usados);
          const b = { ...a, chave: 'item-2' };
          recusaEsperada = 'alerta-sem-justificativa';
          entrada = await gravacaoDe(e, p.at, p.medico, [a, b], p.c);
        } else if (cenario === 'recusa-nutricionista') {
          const nutri = await prescritorDaCopia(e, '2237');
          definirOperador(nutri.login);
          const a = await itemDaForma(e, { tipo: 'medicamento', frequencia: 9, horarios: 3 }, 0, p.c, []);
          recusaEsperada = 'categoria-nao-prescreve';
          entrada = await gravacaoDe(e, p.at, nutri, [a], p.c);
        } else throw new Error(`Cenário ${cenario} sem reprodução.`);
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.copiarPrescricao' || nome === 'pep.renovarPrescricao') {
    const copia = nome === 'pep.copiarPrescricao';
    return {
      ...base,
      async preparar(e) {
        const p = await comum(e);
        // Origem com três itens (medicamento A, medicamento B, cuidado C), num período livre; B suspenso depois.
        const origemNoPeriodo = copia ? 'depois' : 'seguinte';
        const o = await prescreverPreparo(
          e,
          p,
          [
            { tipo: 'medicamento', frequencia: 9, horarios: 3 },
            { tipo: 'medicamento', frequencia: 9, horarios: 3 },
            { tipo: 'procedimento', frequencia: 11, horarios: 4 },
          ],
          origemNoPeriodo,
        );
        await executarOutra(
          e,
          'pep.suspenderItem',
          { ...suspensaoBase(p, o.prescricao), item: o.itens[1], correcao: null },
          p.medico.login,
        );
        const itensTela = [
          o.telas[0]!,
          { ...o.telas[2]!, detalhe: { ...o.telas[2]!.detalhe, naoAjustar: true } } as ItemPrescricao,
        ].map((t, k) => ({
          ...t,
          chave: `item-${k + 1}`,
          origem: { item: k === 0 ? o.itens[0]! : o.itens[2]!, alterado: k === 1 },
        }));
        const vistos = [
          { item: o.itens[0]!, ativo: true },
          { item: o.itens[2]!, ativo: true },
        ];
        if (cenario === 'recusa-origem-suspensa') {
          // A tela abriu antes da suspensão de B: o usuário confirmou B, que foi suspenso no outro terminal.
          vistos.push({ item: o.itens[1]!, ativo: true });
          recusaEsperada = 'origem-alterada';
        }
        const destino = copia ? 'seguinte' : 'depois';
        if (cenario === 'recusa-periodo-ocupado') {
          const g1 = await gravacaoDe(e, p.at, p.medico, itensTela, p.c, {
            periodo: destino,
            origem: { prescricao: o.prescricao, modo: 'renovacao', itens: vistos },
          });
          await executarOutra(e, nome, g1, p.medico.login);
          recusaEsperada = 'periodo-ocupado';
        }
        entrada = await gravacaoDe(e, p.at, p.medico, itensTela, p.c, {
          periodo: destino,
          origem: { prescricao: o.prescricao, modo: copia ? 'copia' : 'renovacao', itens: vistos },
        });
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.incluirItem') {
    return {
      ...base,
      async preparar(e) {
        const p = await comum(e);
        const o = await prescreverPreparo(e, p, [{ tipo: 'medicamento', frequencia: 11, horarios: 4 }]);
        if (cenario === 'recusa-suspensa') {
          await executarOutra(e, 'pep.suspenderPrescricao', suspensaoBase(p, o.prescricao), p.medico.login);
          recusaEsperada = 'prescricao-nao-vigente';
        }
        const item = await itemDaForma(
          e,
          { tipo: 'medicamento', frequencia: 9, horarios: 3 },
          1,
          p.c,
          o.usados,
        );
        const g = await gravacaoDe(e, p.at, p.medico, [item], p.c);
        entrada = {
          prescricao: o.prescricao,
          paciente: p.at.paciente,
          atendimento: p.at.id,
          cbo: p.medico.cbo,
          item: g.itens[0],
          documento: g.documento,
          hashConteudo: g.hashConteudo,
          sgh: g.sgh,
        };
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.suspenderItem') {
    return {
      ...base,
      chavesAlvo: () => alvos,
      async preparar(e) {
        const p = await comum(e);
        const o = await prescreverPreparo(e, p, [
          { tipo: 'medicamento', frequencia: 9, horarios: HORARIOS_PREPARO_ITEM },
        ]);
        alvos['PRCHKGERAL'] = [{ ID_PRLANGERAL: o.itens[0] }];
        alvos['PRLANGERAL'] = [{ ID: o.itens[0] }];
        let correcao = null;
        if (cenario === 'correcao') {
          const item = await itemDaForma(
            e,
            { tipo: 'medicamento', frequencia: 9, horarios: 3 },
            1,
            p.c,
            o.usados,
          );
          const g = await gravacaoDe(e, p.at, p.medico, [item], p.c);
          correcao = g.itens[0];
        }
        entrada = { ...suspensaoBase(p, o.prescricao), item: o.itens[0], correcao };
        if (cenario === 'correcao') prescricaoDaCorrecao = o.prescricao;
        if (cenario === 'recusa-ja-suspenso') {
          await executarOutra(e, 'pep.suspenderItem', entrada, p.medico.login);
          recusaEsperada = 'item-nao-ativo';
        }
      },
      async executar(e) {
        await rodar(e);
        // Correção: o item novo (chave gerada) e os horários dele entram nas chaves-alvo pedidas depois da execução.
        if (prescricaoDaCorrecao === null) return;
        const novos = await e.consultar(
          'SELECT ID FROM PRLANGERAL WHERE ID_PRPRESC = ? ORDER BY ID',
          [prescricaoDaCorrecao],
          {
            teto: 50,
          },
        );
        alvos['PRLANGERAL'] = novos.map((x) => ({ ID: num(x['ID']) }));
        alvos['PRCHKGERAL'] = novos.map((x) => ({ ID_PRLANGERAL: num(x['ID']) }));
      },
    };
  }
  if (nome === 'pep.suspenderPrescricao') {
    let preparada: number | null = null;
    return {
      ...base,
      chavesAlvo: () => alvos,
      // A prescrição nasce na preparação e é retratada por impressão: o "antes" dela é lido dentro da transação.
      chavesDaPreparacao: () => (preparada === null ? {} : { PRPRESC: [String(preparada)] }),
      async preparar(e) {
        const p = await comum(e);
        const o = await prescreverPreparo(e, p, [
          { tipo: 'medicamento', frequencia: 9, horarios: 3 },
          { tipo: 'procedimento', frequencia: 11, horarios: 4 },
        ]);
        alvos['PRCHKGERAL'] = o.itens.map((i) => ({ ID_PRLANGERAL: i }));
        alvos['PRPRESC'] = [{ ID: o.prescricao }];
        preparada = o.prescricao;
        entrada = suspensaoBase(p, o.prescricao);
        if (cenario === 'recusa-incompleta') {
          entrada = { ...(entrada as object), justificativa: '          ' };
          recusaEsperada = 'suspensao-incompleta';
        }
      },
      executar: rodar,
    };
  }
  throw new Error(`Operação ${nome} sem reprodução da prescrição.`);
}

/**
 * Alergia ativa SINTÉTICA do paciente ao princípio do produto: as linhas que o outro sistema grava (o princípio ligado ao
 * produto, a alergia no registro clínico do paciente e o princípio da alergia), na transação desfeita da captura.
 */
async function alergiaSintetica(e: Escritor, at: AtendimentoAberto, produto: number): Promise<void> {
  const [pr] = await e.consultar("SELECT FIRST 1 COD FROM TBPRINC WHERE ATIVO = 'T' ORDER BY COD", [], {
    teto: 1,
  });
  const [al] = await e.consultar(
    "SELECT FIRST 1 ID FROM TBALERGIA WHERE COALESCE(ATIVO, 'T') <> 'F' ORDER BY ID",
    [],
    { teto: 1 },
  );
  const [cv] = await e.consultar(
    `SELECT FIRST 1 c.ID_CABEVOL FROM PRCABEVOL c JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE
      WHERE h.ID_RICADPAC = ? AND c.DATA_HORA_SUSPENSAO IS NULL ORDER BY c.ID_CABEVOL DESC`,
    [at.paciente],
    { teto: 1 },
  );
  if (!pr || !al || !cv)
    throw new Error('Sem princípio, alergia ou registro clínico do paciente para a alergia sintética.');
  await e.executar('INSERT INTO GEITENS_TBPRINC (ID_GEITENS, ID_TBPRINC) VALUES (?, ?)', [
    produto,
    num(pr['COD']),
  ]);
  const a = await e.executarRetornando(
    "INSERT INTO PRALERGIAPAC (ID_PRCABEVOL, ID_TBALERGIA, RETIRAR_VINCULO_PACIENTE) VALUES (?, ?, 'F') RETURNING ID",
    [num(cv['ID_CABEVOL']), num(al['ID'])],
  );
  await e.executar('INSERT INTO PRALERGIAPAC_TBPRINC (ID_PRALERGIAPAC, ID_TBPRINC) VALUES (?, ?)', [
    num(a['ID']),
    num(pr['COD']),
  ]);
}

export { FORMA_COPIA };

/**
 * O estado que o ROLLBACK tem de devolver (só números): as maiores chaves das tabelas da prescrição e dos documentos;
 * as contagens das tabelas SGH_ do marco e da trilha e do outbox das operações da prescrição; e, para os UPDATE, as
 * linhas recentes suspensas (PRPRESC), corrigidas (PRLANGERAL) e com horário suspenso (PRCHKGERAL), contadas na
 * janela das últimas chaves (pela chave primária: nada de varrer a tabela inteira).
 */
export async function estadoPrescricao(l: Pick<Escritor, 'consultar'>): Promise<number[]> {
  const sqls = [
    'SELECT MAX(ID) N FROM PRPRESC',
    'SELECT MAX(ID) N FROM PRLANGERAL',
    'SELECT MAX(ID) N FROM PRCHKGERAL',
    'SELECT MAX(ID) N FROM PRPRESCMED',
    'SELECT MAX(ID) N FROM PRPRESCPROCED',
    'SELECT MAX(ID) N FROM PRASSINATURA_CAB',
    'SELECT MAX(ID) N FROM PRASSINATURA_DOC',
    'SELECT COUNT(*) N FROM SGH_PEP_PRESC_DOC',
    'SELECT COUNT(*) N FROM SGH_PEP_PRESC_EXT',
    'SELECT COUNT(*) N FROM SGH_PEP_ALERTA_DECISAO',
    'SELECT COUNT(*) N FROM SGH_PEP_FICHA_ANTIMICRO',
    'SELECT COUNT(*) N FROM SGH_PEP_PRESC_FUTURA',
    // A trilha e o outbox só das operações da prescrição (a cópia é compartilhada: outras telas gravam leituras).
    `SELECT COUNT(*) N FROM SGH_TRILHA WHERE OPERACAO IN ('pep.prescrever', 'pep.copiarPrescricao',
       'pep.renovarPrescricao', 'pep.incluirItem', 'pep.suspenderItem', 'pep.suspenderPrescricao')`,
    `SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO IN ('pep.prescricao.assinada', 'pep.item.incluido',
       'pep.item.suspenso', 'pep.prescricao.suspensa')`,
    `SELECT COUNT(*) N FROM PRPRESC WHERE ID > (SELECT MAX(ID) - 20000 FROM PRPRESC)
       AND DATA_HORA_SUSPENSAO IS NOT NULL`,
    `SELECT COUNT(*) N FROM PRLANGERAL WHERE ID > (SELECT MAX(ID) - 100000 FROM PRLANGERAL)
       AND DATA_HORA_SUSP_CORRECAO IS NOT NULL`,
    `SELECT COUNT(*) N FROM PRCHKGERAL WHERE ID > (SELECT MAX(ID) - 300000 FROM PRCHKGERAL)
       AND SITUACAO_CHECAGEM = 'S'`,
  ];
  const r: number[] = [];
  for (const s of sqls) {
    const [x] = await l.consultar(s, [], { teto: 1 });
    r.push(num(x?.['N']));
  }
  return r;
}
