// Reprodução dos cenários de assinatura da internação, dos leitos, da higienização e do SAME (M21; ficha, seção 9) pelo
// EXECUTOR, na transação da captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio
// executor o operador sintético, o paciente sintético (cadastro.cadastrarPaciente) e, quando o cenário parte de uma
// internação, a admissão (internacao.internar), a alta, a solicitação de limpeza ou os movimentos de partida; o cenário
// executa só a receita sob teste. O que nenhuma receita do marco grava e o cenário precisa como estado de partida — a
// conta parcial que o faturamento abre (RICONTAS) — é posto por INSERT na transação desfeita, como o faturamento faria.
// O convênio, a especialidade, os médicos, o CID, o procedimento e o centro de custo são os de uma internação recente
// da cópia (só os IDs, em memória); o leito é um leito livre do mapa. Nenhum valor de linha sai: só IDs em memória.
import type { InternarEntrada } from '@sgh/contratos';
import {
  type CenarioCaptura,
  ErroOperacao,
  type Escritor,
  registrarAltaMedica,
  registrarReservaSgh,
  solicitarLeitoSgh,
  somenteSgh,
  transicionarSolicitacaoSgh,
} from '@sgh/legado';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_INTERNACAO = new Set([
  'internacao.internar',
  'internacao.transferirLeito',
  'internacao.darAlta',
  'internacao.preInternar',
  'internacao.corrigirPreInternacao',
  'internacao.trocarConvenio',
  'internacao.trocarClinica',
  'internacao.trocarEspecialidade',
  'internacao.trocarMedico',
  'internacao.registrarGuia',
  'internacao.cancelarAlta',
  'internacao.excluirInternacao',
  'hotelaria.solicitarLimpeza',
  'hotelaria.avancarLimpeza',
  'hotelaria.liberarLeito',
  'same.movimentarProntuario',
  'same.excluirMovimento',
]);

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
let seq = 0;

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/**
 * M44 (cenários "vinda-nir"): a solicitação do NIR com o leito reservado, na MESMA transação desfeita (só SGH_; o
 * monitoramento das tabelas do legado não muda). A operação sob teste a conclui pela admissão ou pela transferência.
 */
async function solicitacaoReservada(
  e0: Escritor,
  hospital: string,
  o: {
    paciente: number;
    origem: 'pa' | 'internado';
    atendimento?: number;
    internacao?: number;
    leito: { bloco: string; acomodacao: string; leito: string };
    intensiva: boolean;
  },
): Promise<number> {
  const e = somenteSgh(e0);
  const id = await solicitarLeitoSgh(e, {
    hospital,
    origem: o.origem,
    paciente: o.paciente,
    atendimento: o.atendimento ?? null,
    cabecalho: null,
    internacao: o.internacao ?? null,
    cirurgia: null,
    prioridade: 'urgente',
    prazoMin: 240,
    perfil: { intensiva: o.intensiva, precaucao: null, tiposAcomodacao: [] },
    clinica: 'M',
    especialidade: null,
    cid: null,
    justificativa: 'Indicacao de internacao SINTETICA M44 (cenario de assinatura)',
    situacaoLegado: 7,
    vinculo: 1,
    usuario: 'SGH.ASSINATURA',
  });
  const reserva = await registrarReservaSgh(e, {
    hospital,
    solicitacao: id,
    leito: o.leito,
    validadeMin: 120,
    excecao: null,
    usuario: 'SGH.ASSINATURA',
  });
  await transicionarSolicitacaoSgh(e, {
    hospital,
    solicitacao: id,
    acao: 'reservar',
    de: 'solicitado',
    para: 'reservado',
    situacaoLegado: 5,
    reserva,
    usuario: 'SGH.ASSINATURA',
  });
  return id;
}

/** Convênios das internações recentes (todos com a guia pelo número: TBTISS.GNGINR 2). */
const CONVENIOS_VISTOS = [306, 320, 612, 610, 625, 340, 325];
/** Centros de custo vistos nas internações da janela (o domínio do perfil). */
const CENTROS_VISTOS = [300100, 300211, 300212];

export interface ApoioInternacao {
  readonly convenio: number;
  readonly outroConvenio: number;
  readonly especialidade: number;
  readonly outraEspecialidade: number;
  readonly solicitante: number;
  readonly assistente: number;
  readonly outroMedico: number;
  readonly cid: number;
  readonly cidSecundario: number;
  readonly procedimento: number;
  readonly centroCusto: number;
}

/** O apoio de uma internação recente da cópia (convênio ativo, médicos com CPF e vínculo ativo, unidade 4). */
export async function apoioDaInternacao(e: Escritor): Promise<ApoioInternacao> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 c.CONV, c.ESPEC, c.ID_TBCBOPROMEDSOL S, c.ID_TBCBOPRO_MEDASS A, c.ID_TBCID10_PRINCIPAL P,
        c.ID_TBCID10_SECUNDARIO Q, c.PROCED, c.CDC
       FROM RICADINT c JOIN TBCONVEN v ON v.COD = c.CONV
       JOIN TBCBOPRO bs ON bs.ID = c.ID_TBCBOPROMEDSOL JOIN TBPROFIS ps ON ps.ID = bs.ID_TBPROFIS
       JOIN TBCBOPRO ba ON ba.ID = c.ID_TBCBOPRO_MEDASS JOIN TBPROFIS pa ON pa.ID = ba.ID_TBPROFIS
      WHERE c.DATA_HORA_INCLUSAO >= '2026-01-01' AND c.UNID = 4 AND v.SITUACAO = 'A'
        AND c.CONV IN (${CONVENIOS_VISTOS.join(', ')}) AND c.CDC IN (${CENTROS_VISTOS.join(', ')})
        AND c.ID_TBCID10_SECUNDARIO <> c.ID_TBCID10_PRINCIPAL AND c.PROCED > 0
        AND COALESCE(bs.ATIVO, 'T') <> 'F' AND bs.COD > 0 AND ps.PESSOA = 'F' AND ps.CNPJ_CPF > 0
        AND COALESCE(ba.ATIVO, 'T') <> 'F' AND ba.COD > 0 AND pa.PESSOA = 'F' AND pa.CNPJ_CPF > 0
        AND ba.ID <> bs.ID
      ORDER BY c.REG DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhuma internação recente elegível na cópia.');
  const convenio = num(x['CONV']);
  const [o] = await e.consultar(
    `SELECT FIRST 1 COD FROM TBCONVEN WHERE SITUACAO = 'A' AND COD IN (${CONVENIOS_VISTOS.join(', ')}) AND COD <> ?
      ORDER BY COD`,
    [convenio],
    { teto: 1 },
  );
  const [esp] = await e.consultar(
    `SELECT FIRST 1 c.ESPEC FROM RICADINT c WHERE c.DATA_HORA_INCLUSAO >= '2026-01-01' AND c.ESPEC <> ? AND c.ESPEC > 0
      ORDER BY c.REG DESC`,
    [num(x['ESPEC'])],
    { teto: 1 },
  );
  return {
    convenio,
    outroConvenio: num(o?.['COD']),
    especialidade: num(x['ESPEC']),
    outraEspecialidade: num(esp?.['ESPEC']),
    solicitante: num(x['S']),
    assistente: num(x['A']),
    outroMedico: num(x['S']),
    cid: num(x['P']),
    cidSecundario: num(x['Q']),
    procedimento: num(x['PROCED']),
    centroCusto: num(x['CDC']),
  };
}

export interface LeitoLivre {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
}

/**
 * Um leito livre do mapa no tipo de acomodação pedido (1 enfermaria, 2 apartamento, 3 terapia intensiva), ativo, sem
 * período aberto, com o espelho e numa acomodação sem paciente em isolamento; `mesmaAcomodacao`: outro leito da
 * acomodação dada; `excluir`: os já usados.
 */
export async function leitoLivre(
  e: Escritor,
  o: { tipo: number; mesmaAcomodacao?: LeitoLivre; excluir?: readonly LeitoLivre[] },
): Promise<LeitoLivre> {
  const linhas = await e.consultar(
    `SELECT l.BLOCO, l.ACOMOD, l.LEITO FROM RILEITOS l JOIN RIACOMOD a ON a.BLOCO = l.BLOCO AND a.ACOMOD = l.ACOMOD
      WHERE l.STATUS = 'A' AND l.REG = 0 AND a.TIPO = ?
        AND l.BLOCO IN ('INT-1', 'INT-2', 'INT-3', 'INT-T', 'UTI-1', 'UTI-2', 'UTI-V')
        AND NOT EXISTS (SELECT 1 FROM RICTRLOC t WHERE t.BLOCO = l.BLOCO AND t.ACOMOD = l.ACOMOD AND t.LEITO = l.LEITO
                          AND t.SAIDA = DATE '1899-12-30')
        AND NOT EXISTS (SELECT 1 FROM RILEITOS x JOIN RICADINT c ON c.REG = x.REG
                         WHERE x.BLOCO = l.BLOCO AND x.ACOMOD = l.ACOMOD AND c.ISOLACAO = 'T' AND c.ALTA = DATE '1899-12-30')
        AND EXISTS (SELECT 1 FROM TBLEITO m JOIN TBACOMODLEITO ta ON ta.ID = m.ID_TBACOMODLEITO
                     WHERE ta.ID_RIBLOCOS = l.BLOCO AND ta.COD_ACOMODACAO = l.ACOMOD AND ta.TP_ATENDIMENTO = 'I'
                       AND m.COD_LEITO = l.LEITO)
      ORDER BY l.BLOCO, l.ACOMOD, l.LEITO`,
    [o.tipo],
    { teto: 500 },
  );
  const k = (x: LeitoLivre) => `${x.bloco}|${x.acomodacao}|${x.leito}`;
  const usados = new Set((o.excluir ?? []).map(k));
  const candidatos = linhas
    .map((l) => ({ bloco: txt(l['BLOCO']), acomodacao: txt(l['ACOMOD']), leito: txt(l['LEITO']) }))
    .filter((l) => !usados.has(k(l)))
    .filter(
      (l) =>
        !o.mesmaAcomodacao ||
        (l.bloco === o.mesmaAcomodacao.bloco && l.acomodacao === o.mesmaAcomodacao.acomodacao),
    );
  const l = candidatos[0];
  if (!l) throw new Error(`Nenhum leito livre do tipo ${o.tipo} na cópia.`);
  return l;
}

/** As chaves-alvo das linhas do cenário nas tabelas médias e grandes (lidas na transação da captura; só IDs). */
interface Alvos {
  readonly internacoes: Set<number>;
  readonly pacientes: Set<number>;
  readonly solicitacoes: Set<number>;
  readonly movimentos: Set<number>;
}

export function cenarioInternacao(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
  tiposLogradouro: () => ReadonlySet<string>,
): CenarioCaptura & { entradasDaPreparacao(): Record<string, unknown> } {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const alvos: Alvos = {
    internacoes: new Set(),
    pacientes: new Set(),
    solicitacoes: new Set(),
    movimentos: new Set(),
  };
  let chaves: Record<string, Record<string, unknown>[]> = {};
  const extras: Record<string, unknown> = {};

  const lerAlvos = async (e: Escritor) => {
    const r: Record<string, Record<string, unknown>[]> = {
      RICADINT: [],
      ATCABECATEND: [],
      ATCONTA: [],
      HTATENDIMENTO: [],
      RICONTAS: [],
      RICGUIAS: [],
      RICTRLOC: [],
      RITRANSF: [],
      RICADPAC: [],
      GDPRONTMOVIM: [],
      CHSOLICITLIMP: [],
      CHSOLICITLIMP_TBLEITO: [],
      CHEXECLIMPEZA: [],
      RIEXCINT: [],
      RIALTA_EXCLUSAO: [],
    };
    for (const reg of alvos.internacoes) {
      r['RICADINT']?.push({ REG: reg });
      r['RICONTAS']?.push({ REG: reg });
      r['RICGUIAS']?.push({ REG: reg });
      r['RICTRLOC']?.push({ REG: reg });
      r['RITRANSF']?.push({ REG: reg });
      r['RIEXCINT']?.push({ REG: reg });
      const cabs = await e.consultar(
        "SELECT CAST(ID AS VARCHAR(20)) CAB FROM ATCABECATEND WHERE COD_ATENDIMENTO = ? AND TP_ATENDIMENTO = 'I'",
        [reg],
        { teto: 5 },
      );
      for (const c of cabs) {
        const cab = txt(c['CAB']);
        r['ATCABECATEND']?.push({ ID: cab });
        r['ATCONTA']?.push({ ID_ATCABECATEND: cab });
        r['HTATENDIMENTO']?.push({ ID_ATCABECATEND: cab });
        r['CHSOLICITLIMP']?.push({ ID_ATCABECATEND: cab });
        r['RIALTA_EXCLUSAO']?.push({ ID_ATCABECATEND: cab });
        const contas = await e.consultar('SELECT ID FROM ATCONTA WHERE ID_ATCABECATEND = ?', [cab], {
          teto: 20,
        });
        for (const k of contas) r['GDPRONTMOVIM']?.push({ ID_ATCONTA: num(k['ID']) });
        const sols = await e.consultar('SELECT ID FROM CHSOLICITLIMP WHERE ID_ATCABECATEND = ?', [cab], {
          teto: 20,
        });
        for (const s of sols) alvos.solicitacoes.add(num(s['ID']));
      }
    }
    for (const p of alvos.pacientes) r['RICADPAC']?.push({ ID: p });
    for (const s of alvos.solicitacoes) {
      r['CHSOLICITLIMP']?.push({ ID: s });
      r['CHSOLICITLIMP_TBLEITO']?.push({ ID_CHSOLICITLIMP: s });
      r['CHEXECLIMPEZA']?.push({ ID_CHSOLICITLIMP: s });
    }
    chaves = r;
  };

  const paciente = async (e: Escritor): Promise<{ id: number; pront: number }> => {
    const cpf = await cpfLivre(e, (Date.now() + 7919 * ++seq) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const r = await executarOutra(e, 'cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
    const id = num(r.resultado['idPaciente']);
    const [p] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [id], { teto: 1 });
    alvos.pacientes.add(id);
    return { id, pront: num(p?.['PRONT']) };
  };

  const entradaInternar = (
    a: ApoioInternacao,
    pac: number,
    leito: LeitoLivre,
    extra: Partial<InternarEntrada> = {},
  ): InternarEntrada => ({
    paciente: pac,
    leito,
    convenio: a.convenio,
    matricula: '900000000021',
    validadeCarteira: '2031-12-31',
    diariasAutorizadas: 1,
    acomodacaoPlano: 'APARTAMENTO',
    carater: 'urgencia',
    clinica: 'M',
    especialidade: a.especialidade,
    medicoAssistente: a.assistente,
    medicoSolicitante: a.solicitante,
    cidPrincipal: a.cid,
    cidSecundario: a.cidSecundario,
    procedimento: a.procedimento,
    centroCusto: a.centroCusto,
    unidade: 4,
    origem: 'ambulatorio',
    isolamento: false,
    ...extra,
  });

  /** Uma internação aberta pelo executor na preparação (estado de partida das outras operações). */
  const internacaoAberta = async (
    e: Escritor,
    o: { tipo?: number; leito?: LeitoLivre; excluir?: readonly LeitoLivre[] } = {},
  ): Promise<{
    reg: number;
    leito: LeitoLivre;
    versao: string;
    pac: { id: number; pront: number };
    a: ApoioInternacao;
  }> => {
    const a = await apoioDaInternacao(e);
    const pac = await paciente(e);
    const leito = o.leito ?? (await leitoLivre(e, { tipo: o.tipo ?? 1, excluir: o.excluir ?? [] }));
    const r = await executarOutra(e, 'internacao.internar', entradaInternar(a, pac.id, leito));
    const reg = num(r.resultado['reg']);
    alvos.internacoes.add(reg);
    return { reg, leito, versao: await versao(e, reg), pac, a };
  };
  /**
   * A alta médica decidida no novo (SGH_INT_ALTA_MEDICA, na transação desfeita): a saída a efetiva na mesma transação e
   * recusa sem ela (D-ALTA-21). Só tabela SGH_; nada do legado.
   */
  const altaMedicaDecidida = async (
    e: Escritor,
    i: { reg: number; pac: { pront: number }; a: ApoioInternacao },
    motivo: number,
  ) => {
    const destino = motivo === 41 ? 'obito' : motivo === 31 ? 'transferenciaExterna' : 'domicilio';
    await registrarAltaMedica(e, {
      hospital: e.hospital,
      reg: i.reg,
      pront: i.pac.pront,
      vinculo: i.a.assistente,
      motivo,
      destino,
      sumarioAlta: null,
      previsaoSaida: null,
      observacao: null,
      usuario: 'SGH.REPRODUCAO',
    });
  };
  const versao = async (e: Escritor, reg: number) => {
    const [v] = await e.consultar(
      'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RICADINT WHERE REG = ?',
      [reg],
      { teto: 1 },
    );
    return txt(v?.['V']);
  };
  const hojeMais = async (e: Escritor, dias: number) => {
    const [d] = await e.consultar(
      `SELECT CAST(CURRENT_DATE + ${Math.round(dias)} AS VARCHAR(10)) D FROM RDB$DATABASE`,
      [],
      {
        teto: 1,
      },
    );
    return txt(d?.['D']);
  };
  const preInternacao = async (e: Escritor, pac: number, a: ApoioInternacao, data?: string) =>
    executarOutra(e, 'internacao.preInternar', {
      paciente: pac,
      ...(data ? { dataPrevista: data } : {}),
      horaPrevista: '0700',
      convenio: a.convenio,
      plano: 'PLANO SINTETICO SGH',
      matricula: '900000000021',
      senhaConvenio: 'SENHA21',
      especialidade: a.especialidade,
      clinica: 'C',
      carater: 'eletivo',
      medicoSolicitante: a.solicitante,
      procedimento: a.procedimento,
      diariasPrevistas: 1,
    });
  /** A conta parcial que o faturamento abre (RICONTAS), na transação desfeita, para a guia da conta. */
  const contaParcial = async (e: Escritor, reg: number, k: number): Promise<number> => {
    const conta = reg * 100 + k;
    const inicio = await hojeMais(e, k);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Error('Data da conta parcial inválida na preparação.');
    const n = await e.executar(
      `INSERT INTO RICONTAS (REG, DATAINI, HORAINI, CONTA, MESPRO, ANOPRO, CONV, VALIDADE, DATA, HORA, DATAFIN, HORAFIN,
         USUARIO, CRIADA, MATRIC, CIDP, CIDS, CLINICA, CRM, ID_TBESPEC, ID_TBCENCUS, ID_TBCBOPRO_SOLICITANTE, TRFLANC)
       SELECT REG, DATE '${inicio}', '0000', ?, MESPRO, ANOPRO, CONV, 0, CURRENT_DATE, '0000', DATE '1899-12-30', '0000',
         USERINT, 'P', MATRIC, '', '', CLINICA, (SELECT b.COD FROM TBCBOPRO b WHERE b.ID = r.ID_TBCBOPROMEDSOL), ESPEC, CDC,
         ID_TBCBOPROMEDSOL, 'F' FROM RICADINT r WHERE REG = ?`,
      [conta, reg],
    );
    if (n !== 1) throw new Error('Conta parcial não aberta na preparação.');
    return conta;
  };

  const preparar = async (e: Escritor): Promise<void> => {
    await operadorSintetico(e);
    switch (nome) {
      case 'internacao.internar': {
        const a = await apoioDaInternacao(e);
        const pac = await paciente(e);
        if (cenario === 'urgencia-pa') {
          const [pa] = await e.consultar(
            'SELECT FIRST 1 REG FROM RECADATE WHERE TIPO_ATE = 11 ORDER BY REG DESC',
            [],
            {
              teto: 1,
            },
          );
          const leito = await leitoLivre(e, { tipo: 1 });
          entrada = entradaInternar(a, pac.id, leito, {
            origem: 'pa',
            atendimentoOrigem: num(pa?.['REG']) || 1,
            acomodacaoPlano: 'ENFERMARIA',
            nivelCuidado: 'intermediario',
          });
          return;
        }
        if (cenario === 'recusa-nir-outro-paciente') {
          // M44 (regra 11): a solicitação reservada é de outro paciente (sintético, só no SGH_): recusada inteira.
          const leito = await leitoLivre(e, { tipo: 1 });
          const solicitacaoNir = await solicitacaoReservada(e, e.hospital, {
            paciente: 990_000_046,
            origem: 'pa',
            atendimento: 1,
            leito,
            intensiva: false,
          });
          entrada = { ...entradaInternar(a, pac.id, leito), solicitacaoNir };
          recusaEsperada = 'solicitacao-de-outro-paciente';
          return;
        }
        if (cenario === 'vinda-nir') {
          // M44: a admissão vinda do NIR (a mesma gravação da urgência do PA; a solicitação reservada no novo).
          const [pa] = await e.consultar(
            'SELECT FIRST 1 REG FROM RECADATE WHERE TIPO_ATE = 11 ORDER BY REG DESC',
            [],
            { teto: 1 },
          );
          const leito = await leitoLivre(e, { tipo: 1 });
          const reg = num(pa?.['REG']) || 1;
          const solicitacaoNir = await solicitacaoReservada(e, e.hospital, {
            paciente: pac.id,
            origem: 'pa',
            atendimento: reg,
            leito,
            intensiva: false,
          });
          entrada = {
            ...entradaInternar(a, pac.id, leito, {
              origem: 'pa',
              atendimentoOrigem: reg,
              acomodacaoPlano: 'ENFERMARIA',
              nivelCuidado: 'intermediario',
            }),
            solicitacaoNir,
          };
          return;
        }
        if (cenario === 'eletiva-pre') {
          await preInternacao(e, pac.id, a, await hojeMais(e, 1));
          const leito = await leitoLivre(e, { tipo: 2 });
          entrada = entradaInternar(a, pac.id, leito, {
            origem: 'eletiva',
            carater: 'eletivo',
            clinica: 'C',
            senhaConvenio: 'SENHA21',
            validadeSenha: '2031-12-31',
          });
          return;
        }
        if (cenario === 'uti') {
          const leito = await leitoLivre(e, { tipo: 3 });
          entrada = entradaInternar(a, pac.id, leito, {
            origem: 'transferenciaExterna',
            nivelCuidado: 'intensivo',
            responsavel: {
              nome: 'RESPONSAVEL SINTETICO SGH M21',
              parentesco: 5,
              sexo: 'M',
              nascimento: '1980-05-05',
              identidade: '900000021',
              telefone: '21900000021',
            },
          });
          return;
        }
        // recusa-ocupado: o leito é ocupado por outra internação (outro terminal) antes da gravação.
        const leito = await leitoLivre(e, { tipo: 1 });
        await internacaoAberta(e, { leito });
        entrada = entradaInternar(a, pac.id, leito);
        recusaEsperada = 'leito-ocupado';
        return;
      }
      case 'internacao.transferirLeito': {
        if (cenario === 'mesma-uti') {
          const i = await internacaoAberta(e, { tipo: 3 });
          const destino = await leitoLivre(e, { tipo: 3, mesmaAcomodacao: i.leito, excluir: [i.leito] });
          entrada = { internacao: i.reg, destino, versao: i.versao };
          return;
        }
        const i = await internacaoAberta(e, { tipo: 1 });
        const destino = await leitoLivre(e, { tipo: 3 });
        if (cenario === 'vinda-nir') {
          // M44: a transferência vinda do NIR (para a terapia intensiva, com o leito reservado no novo).
          const solicitacaoNir = await solicitacaoReservada(e, e.hospital, {
            paciente: i.pac.id,
            origem: 'internado',
            internacao: i.reg,
            leito: destino,
            intensiva: true,
          });
          entrada = { internacao: i.reg, destino, versao: await versao(e, i.reg), solicitacaoNir };
          return;
        }
        if (cenario === 'recusa-nir-outro-paciente') {
          // M44 (regra 11): a solicitação reservada é de outra internação (sintética, só no SGH_): recusada inteira.
          const solicitacaoNir = await solicitacaoReservada(e, e.hospital, {
            paciente: i.pac.id,
            origem: 'internado',
            internacao: 990_000_047,
            leito: destino,
            intensiva: true,
          });
          entrada = { internacao: i.reg, destino, versao: await versao(e, i.reg), solicitacaoNir };
          recusaEsperada = 'solicitacao-de-outro-paciente';
          return;
        }
        if (cenario === 'recusa-ocupado') {
          await internacaoAberta(e, { leito: destino });
          recusaEsperada = 'leito-ocupado';
        }
        entrada = { internacao: i.reg, destino, versao: await versao(e, i.reg) };
        return;
      }
      case 'internacao.darAlta': {
        const i = await internacaoAberta(e, { tipo: 1 });
        const motivo = cenario === 'obito' ? 41 : cenario === 'transferencia' ? 31 : 12;
        entrada = { internacao: i.reg, motivo, medicoAlta: i.a.assistente, versao: i.versao };
        await altaMedicaDecidida(e, i, motivo);
        if (cenario === 'recusa') {
          await executarOutra(e, 'internacao.darAlta', entrada);
          entrada = { ...(entrada as object), versao: await versao(e, i.reg) };
          recusaEsperada = 'internacao-com-alta';
        }
        return;
      }
      case 'internacao.preInternar': {
        const a = await apoioDaInternacao(e);
        const pac = await paciente(e);
        const data = cenario === 'sem-data' ? undefined : await hojeMais(e, 7);
        entrada = {
          paciente: pac.id,
          ...(data ? { dataPrevista: data } : {}),
          horaPrevista: '0700',
          convenio: a.convenio,
          plano: 'PLANO SINTETICO SGH',
          matricula: '900000000021',
          senhaConvenio: 'SENHA21',
          especialidade: a.especialidade,
          clinica: 'C',
          carater: 'eletivo',
          medicoSolicitante: a.solicitante,
          procedimento: a.procedimento,
          diariasPrevistas: 1,
        };
        if (cenario === 'recusa-existente') {
          await executarOutra(e, 'internacao.preInternar', entrada);
          recusaEsperada = 'pre-internacao-existente';
        }
        return;
      }
      case 'internacao.corrigirPreInternacao': {
        const a = await apoioDaInternacao(e);
        const pac = await paciente(e);
        await preInternacao(e, pac.id, a, '3031-01-01');
        entrada = {
          paciente: pac.id,
          dataPrevista: await hojeMais(e, 5),
          lida: cenario === 'recusa-colisao' ? '2026-01-01' : '3031-01-01',
        };
        if (cenario === 'recusa-colisao') recusaEsperada = 'conflito-versao';
        return;
      }
      case 'internacao.trocarConvenio': {
        const i = await internacaoAberta(e);
        entrada = {
          internacao: i.reg,
          convenio: cenario === 'recusa' ? i.a.convenio : i.a.outroConvenio,
          versao: i.versao,
        };
        if (cenario === 'recusa') recusaEsperada = 'mesmo-destino';
        return;
      }
      case 'internacao.trocarClinica': {
        const i = await internacaoAberta(e);
        entrada = { internacao: i.reg, clinica: cenario === 'recusa' ? 'M' : 'C', versao: i.versao };
        if (cenario === 'recusa') recusaEsperada = 'mesmo-destino';
        return;
      }
      case 'internacao.trocarEspecialidade': {
        const i = await internacaoAberta(e);
        entrada = {
          internacao: i.reg,
          especialidade: cenario === 'recusa' ? i.a.especialidade : i.a.outraEspecialidade,
          versao: i.versao,
        };
        if (cenario === 'recusa') recusaEsperada = 'mesmo-destino';
        return;
      }
      case 'internacao.trocarMedico': {
        const i = await internacaoAberta(e);
        entrada = {
          internacao: i.reg,
          tipo: 'S',
          medico: cenario === 'recusa' ? i.a.solicitante : i.a.assistente,
          versao: i.versao,
        };
        if (cenario === 'recusa') recusaEsperada = 'mesmo-destino';
        return;
      }
      case 'internacao.registrarGuia': {
        const i = await internacaoAberta(e);
        if (cenario === 'recusa') {
          entrada = { internacao: i.reg, conta: i.reg, guia: 'G900021', validadeDias: 3 };
          recusaEsperada = 'conta-principal';
          return;
        }
        const primeira = await contaParcial(e, i.reg, 1);
        if (cenario === 'prorrogacao') {
          await executarOutra(e, 'internacao.registrarGuia', {
            internacao: i.reg,
            conta: primeira,
            guia: 'G900021',
            senha: 'S900021',
            validadeDias: 3,
          });
          const segunda = await contaParcial(e, i.reg, 4);
          entrada = { internacao: i.reg, conta: segunda, guia: 'G900022', senha: 'S900022', validadeDias: 5 };
          return;
        }
        entrada = { internacao: i.reg, conta: primeira, guia: 'G900021', senha: 'S900021', validadeDias: 3 };
        return;
      }
      case 'internacao.cancelarAlta': {
        const i = await internacaoAberta(e);
        await altaMedicaDecidida(e, i, 12);
        await executarOutra(e, 'internacao.darAlta', {
          internacao: i.reg,
          motivo: 12,
          medicoAlta: i.a.assistente,
          versao: i.versao,
        });
        entrada = { internacao: i.reg, justificativa: 'Alta dada por engano na reprodução sintética' };
        if (cenario === 'recusa') {
          await internacaoAberta(e, { leito: i.leito });
          recusaEsperada = 'leito-ocupado';
        }
        return;
      }
      case 'internacao.excluirInternacao': {
        const i = await internacaoAberta(e);
        const [m] = await e.consultar('SELECT FIRST 1 ID FROM TBMOTCANCCAD ORDER BY ID', [], { teto: 1 });
        entrada = {
          internacao: i.reg,
          ...(m ? { motivo: num(m['ID']) } : {}),
          justificativa: 'Internação sintética aberta por engano',
          confirmaApagarConta: true,
          confirmaApagarPeriodos: true,
        };
        if (cenario === 'recusa') {
          await altaMedicaDecidida(e, i, 12);
          await executarOutra(e, 'internacao.darAlta', {
            internacao: i.reg,
            motivo: 12,
            medicoAlta: i.a.assistente,
            versao: i.versao,
          });
          recusaEsperada = 'exclusao-recusada';
        }
        return;
      }
      case 'hotelaria.solicitarLimpeza': {
        const leito = await leitoLivre(e, { tipo: 1 });
        entrada = { leito, tipoLimpeza: 3, origem: 'manual' };
        if (cenario === 'recusa') {
          const r = await executarOutra(e, 'hotelaria.solicitarLimpeza', entrada);
          alvos.solicitacoes.add(num(r.resultado['solicitacao']));
          recusaEsperada = 'limpeza-em-aberto';
        }
        return;
      }
      case 'hotelaria.avancarLimpeza':
      case 'hotelaria.liberarLeito': {
        const leito = await leitoLivre(e, { tipo: 1 });
        const r = await executarOutra(e, 'hotelaria.solicitarLimpeza', {
          leito,
          tipoLimpeza: 4,
          origem: 'manual',
        });
        const solicitacao = num(r.resultado['solicitacao']);
        alvos.solicitacoes.add(solicitacao);
        if (nome === 'hotelaria.avancarLimpeza') {
          entrada = { solicitacao, situacao: cenario === 'recusa-nunca-visto' ? 3 : 2 };
          if (cenario === 'recusa-nunca-visto') recusaEsperada = 'situacao-nunca-vista';
          return;
        }
        entrada = { solicitacao };
        if (cenario === 'recusa') {
          await executarOutra(e, 'hotelaria.liberarLeito', entrada);
          recusaEsperada = 'ja-liberado';
        }
        return;
      }
      case 'same.movimentarProntuario':
      case 'same.excluirMovimento': {
        const i = await internacaoAberta(e);
        const [c] = await e.consultar(
          `SELECT FIRST 1 t.ID FROM ATCONTA t JOIN ATCABECATEND a ON a.ID = t.ID_ATCABECATEND
            WHERE a.COD_ATENDIMENTO = ? AND a.TP_ATENDIMENTO = 'I' AND t.COD_CONTA = ?`,
          [i.reg, i.reg],
          { teto: 1 },
        );
        const conta = num(c?.['ID']);
        const [r] = await e.consultar(
          'SELECT FIRST 1 ID FROM GDPRONTMOVIM WHERE ID_ATCONTA = ? ORDER BY ID',
          [conta],
          {
            teto: 1,
          },
        );
        const registro = num(r?.['ID']);
        const mov = (o: number, de: number, para: number, extra: Record<string, unknown> = {}) => ({
          conta,
          operacao: o,
          setorOrigem: de,
          setorDestino: para,
          responsavel: 'RESPONSAVEL SINTETICO SGH',
          ...extra,
        });
        const saida = () => executarOutra(e, 'same.movimentarProntuario', mov(2, 1, 5, { motivo: 1 }));
        if (nome === 'same.excluirMovimento') {
          const s = await saida();
          const id = num(s.resultado['movimento']);
          entrada = { movimento: id, motivo: 'Saída lançada por engano na reprodução sintética' };
          if (cenario === 'recusa') {
            await executarOutra(e, 'same.excluirMovimento', entrada);
            recusaEsperada = 'ja-excluido';
          }
          return;
        }
        if (cenario === 'registro') {
          await executarOutra(e, 'same.excluirMovimento', {
            movimento: registro,
            motivo: 'Registro sintético refeito na reprodução',
          });
          entrada = mov(1, 1, 1);
          return;
        }
        if (cenario === 'saida') {
          entrada = mov(2, 1, 5, { motivo: 1 });
          return;
        }
        if (cenario === 'recebimento') {
          await saida();
          entrada = mov(6, 1, 5);
          return;
        }
        if (cenario === 'transferencia') {
          await saida();
          await executarOutra(e, 'same.movimentarProntuario', mov(6, 1, 5));
          entrada = mov(5, 5, 9, { motivo: 1 });
          return;
        }
        // recusa: o recebimento no setor 9 do que foi enviado ao 5 (não enviado a ele).
        await saida();
        entrada = mov(6, 1, 9);
        recusaEsperada = 'nao-enviado';
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução na internação.`);
    }
  };

  return {
    ...base,
    // As tabelas da internação e do atendimento têm de 10 mil a 2 milhões de linhas: as linhas que o cenário cria,
    // altera ou apaga são retratadas pelas chaves-alvo (as internações da preparação e a criada pelo cenário, lidas na
    // transação), e o saldo da contagem confere que nada mais mudou (M20 nas tabelas médias).
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
        const r = await executar(e, entrada);
        const reg = num(r.resultado['reg']);
        if (reg > 0) alvos.internacoes.add(reg);
        const sol = num(r.resultado['solicitacao']);
        if (sol > 0) alvos.solicitacoes.add(sol);
      }
      await lerAlvos(e);
    },
  };
}
