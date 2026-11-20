// Reprodução dos cenários de assinatura do atendimento externo (M20; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o operador sintético, o
// paciente sintético (cadastro.cadastrarPaciente), a senha do dia (recepcao.emitirSenha) e, quando o cenário parte de
// um atendimento aberto, a ficha (atendimento.abrirAtendimento) e os eventos de partida; o cenário executa só a receita
// sob teste. O que nenhuma receita grava e o cenário precisa como estado de partida — a marcação do dia (a cópia não
// tem grade de hoje: uma marcação antiga, sem ficha, é trazida para hoje e para o paciente sintético) e a conta fechada
// pelo faturamento — é posto por UPDATE na transação desfeita, como o outro sistema faria. O profissional, a unidade,
// o centro de custo, o CID e o solicitante são os de uma ficha recente da cópia (só os IDs, em memória). Nenhum valor de
// linha sai: só IDs em memória.
import { HERANCAS } from '@sgh/contratos';
import {
  abrirSalaTeleconsulta,
  agendarTeleconsulta,
  type CenarioCaptura,
  entrarSalaEspera,
  ErroOperacao,
  type Escritor,
  versaoDaHeranca,
} from '@sgh/legado';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';
import { geradorLivre } from './reproducao-recepcao.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_ATENDIMENTO = new Set([
  'atendimento.abrirAtendimento',
  'atendimento.alterarSegurado',
  'atendimento.alterarAtendimento',
  'atendimento.lancarProcedimentoExtra',
  'atendimento.estornarProcedimentoExtra',
  'atendimento.corrigirProcedimentoExtra',
  'atendimento.conduzirNoConsultorio',
  'atendimento.encerrarAtendimento',
  'atendimento.cancelarAtendimento',
  'atendimento.alterarHeranca',
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

/** Convênios vistos na janela com a tabela do procedimento e valor (o primeiro ativo). */
const CONVENIOS_VISTOS = [306, 320, 612, 340, 610, 325, 308, 625];

export interface ApoioFicha {
  readonly convenio: number;
  readonly profissional: number;
  readonly especialidade: number;
  readonly unidade: number;
  readonly centroCusto: number;
  readonly procedimento: number;
  readonly cid: number;
}

/** Um convênio ativo com o procedimento na tabela de valores (com valor) e a ficha recente da cópia que o usou. */
export async function apoioDaFicha(
  e: Escritor,
  o: { tipoAte: number; particular?: boolean },
): Promise<ApoioFicha> {
  const convs = o.particular ? [10] : CONVENIOS_VISTOS;
  for (const conv of convs) {
    const [x] = await e.consultar(
      `SELECT FIRST 1 r.ID_TBCBOPROCRM P, r.ESPEC E, r.UNIDADE U, r.CDC C, r.PROCED X, r.ID_TBCID10_PRINCIPAL D
         FROM RECADATE r JOIN TBCONVEN c ON c.COD = r.CONV JOIN TBCBOPRO b ON b.ID = r.ID_TBCBOPROCRM
        WHERE r.CONV = ? AND r.TIPO_ATE = ? AND r.LAB = 'N' AND r.ID_TBCID10_PRINCIPAL IS NOT NULL AND c.SITUACAO = 'A'
          AND COALESCE(b.ATIVO, 'T') <> 'F' AND b.COD > 0
          AND EXISTS (SELECT 1 FROM TBVLRTHM v WHERE v.TAB = c.THM_E AND v.COD = r.PROCED AND v.VALOR_CH > 0)
          AND r.DATA_HORA_INCLUSAO >= '2026-03-01'
        ORDER BY r.REG DESC`,
      [conv, o.tipoAte],
      { teto: 1, tempoMaximoMs: 120_000 },
    );
    if (x)
      return {
        convenio: conv,
        profissional: num(x['P']),
        especialidade: num(x['E']),
        unidade: num(x['U']),
        centroCusto: num(x['C']),
        procedimento: num(x['X']),
        cid: num(x['D']),
      };
  }
  throw new Error(`Nenhuma ficha recente do tipo ${o.tipoAte} com convênio elegível na cópia.`);
}

/** A requisição de laboratório recente da cópia (executante, setor, unidade, solicitante, procedimento). */
async function apoioDaRequisicao(e: Escritor): Promise<ApoioFicha & { solicitante: number }> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 r.CONV V, r.ID_TBCBOPROCRM P, r.UNIDADE U, r.CDC C, r.PROCED X, r.ID_TBMEDSOL S
       FROM RECADATE r JOIN TBCONVEN c ON c.COD = r.CONV JOIN TBCBOPRO b ON b.ID = r.ID_TBCBOPROCRM
      WHERE r.LAB = 'S' AND r.ID_TBMEDSOL IS NOT NULL AND r.CONV > 1 AND c.SITUACAO = 'A'
        AND COALESCE(b.ATIVO, 'T') <> 'F' AND r.DATA_HORA_INCLUSAO >= '2026-03-01'
      ORDER BY r.REG DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhuma requisição de laboratório recente na cópia.');
  return {
    convenio: num(x['V']),
    profissional: num(x['P']),
    especialidade: 0,
    unidade: num(x['U']),
    centroCusto: num(x['C']),
    procedimento: num(x['X']),
    cid: 0,
    solicitante: num(x['S']),
  };
}

/**
 * Uma marcação de consulta da cópia sem ficha e sem senha, trazida para HOJE e para o paciente sintético (marcação e
 * horário da grade), só na transação desfeita: a cópia não tem grade de hoje (acaba em 2026-09), e a data de hoje não
 * colide com nenhum horário existente.
 */
export async function marcacaoDeHojeDoPaciente(e: Escritor, pront: number): Promise<number> {
  const [m] = await e.consultar(
    `SELECT FIRST 1 d.ID, d.NOME, d.CRM, d.DATA, d.HORA FROM REPACAGD d
      WHERE d.DATA BETWEEN CURRENT_DATE - 400 AND CURRENT_DATE - 1 AND COALESCE(d.REGISTRO, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM TBSENHAATEND_REPACAGD v WHERE v.ID_REPACAGD = d.ID)
        AND EXISTS (SELECT 1 FROM REPACAGI i WHERE i.NOME = d.NOME AND i.CRM = d.CRM AND i.DATA = d.DATA AND i.HORA = d.HORA)
        AND NOT EXISTS (SELECT 1 FROM REPACAGI h WHERE h.NOME = d.NOME AND h.CRM = d.CRM AND h.DATA = CURRENT_DATE AND h.HORA = d.HORA)
      ORDER BY d.DATA DESC, d.ID DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!m) throw new Error('Nenhuma marcação de consulta sem ficha na cópia.');
  const k = await e.executar(
    'UPDATE REPACAGI SET DATA = CURRENT_DATE WHERE NOME = ? AND CRM = ? AND DATA = ? AND HORA = ?',
    [m['NOME'], m['CRM'], m['DATA'], m['HORA']],
  );
  if (k !== 1) throw new Error('Horário da marcação não trazido para hoje.');
  await e.executar(
    "UPDATE REPACAGD SET DATA = CURRENT_DATE, PRONT = ?, TIPOPAC = 'I', OTMU = 'F' WHERE ID = ?",
    [pront, m['ID']],
  );
  return num(m['ID']);
}

/** O faturamento fecha a conta da ficha (o que a conferência da regra 2 precisa ver), só na transação desfeita. */
export async function faturamentoFechaConta(e: Escritor, reg: number): Promise<void> {
  const k = await e.executar("UPDATE FCCTAEXT SET FECHADA = 'S' WHERE COD = ? AND TIPO_CTA = 'E'", [reg]);
  if (k !== 1) throw new Error('Conta da ficha não fechada na preparação.');
}

export function cenarioAtendimento(
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
  const preparadas: number[] = [];
  /** As fichas (REG) cujas linhas o cenário cria, altera ou apaga, e as marcações e horários de partida. */
  const fichas = new Set<number>();
  const marcacoes: number[] = [];
  const horarios: Record<string, unknown>[] = [];
  let alvosFichas: Record<string, Record<string, unknown>[]> = {};
  /**
   * Valores da preparação que os gatilhos copiam para as linhas do cenário (o item da conta leva a hora da FICHA, aberta
   * na preparação): na reprodução são entradas do cenário, como seriam as da tela que abriu a ficha.
   */
  const extras: Record<string, unknown> = {};

  /** As chaves-alvo das linhas de cada ficha (lidas na transação da captura; só IDs em memória). */
  const lerAlvos = async (e: Escritor) => {
    const r: Record<string, Record<string, unknown>[]> = {
      RECADATE: [],
      ATCABECATEND: [],
      ATCONTA: [],
      RESEGUR: [],
      FCCTAEXT: [],
      FCDIAEXT: [],
      RECONTAS: [],
      FCLANEXT: [],
      HTATENDIMENTO: [],
      REEXCATE: [],
      REPROEXT: [],
    };
    for (const reg of fichas) {
      const [f] = await e.consultar(
        `SELECT CAST(r.ID_ATCABECATEND AS VARCHAR(20)) CAB, r.ANOPRO, r.MESPRO,
            (SELECT FIRST 1 c.ID FROM FCCTAEXT c WHERE c.COD = r.REG AND c.TIPO_CTA = 'E' AND c.ANOPRO = r.ANOPRO AND c.MESPRO = r.MESPRO) CTA
           FROM RECADATE r WHERE r.REG = ?`,
        [reg],
        { teto: 1 },
      );
      const [x] = f
        ? [f]
        : await e.consultar(
            "SELECT CAST(ID AS VARCHAR(20)) CAB FROM ATCABECATEND WHERE COD_ATENDIMENTO = ? AND TP_ATENDIMENTO = 'E'",
            [reg],
            { teto: 1 },
          );
      const cab = txt(x?.['CAB']);
      r['RECADATE']?.push({ REG: reg });
      r['RESEGUR']?.push({ REG: reg });
      r['RECONTAS']?.push({ REG: reg });
      r['REEXCATE']?.push({ REG: reg });
      r['REPROEXT']?.push({ REG: reg });
      if (cab) {
        r['ATCABECATEND']?.push({ ID: cab });
        r['ATCONTA']?.push({ ID_ATCABECATEND: cab });
        r['HTATENDIMENTO']?.push({ ID_ATCABECATEND: cab });
      }
      if (f) {
        r['FCCTAEXT']?.push({ COD: reg, TIPO_CTA: 'E', ANOPRO: num(f['ANOPRO']), MESPRO: num(f['MESPRO']) });
        r['FCDIAEXT']?.push({ COD: reg, ANOPRO: num(f['ANOPRO']), MESPRO: num(f['MESPRO']) });
        if (num(f['CTA']) > 0) r['FCLANEXT']?.push({ ID_FCCTAEXT: num(f['CTA']) });
      }
    }
    alvosFichas = r;
  };

  /** Um procedimento com valor na tabela do convênio da ficha, diferente do da ficha. */
  const procedimentoExtra = async (e: Escritor, reg: number): Promise<number> => {
    const [p] = await e.consultar(
      `SELECT FIRST 1 t.COD FROM TBTABTHM t JOIN TBCONVEN c ON c.THM_E = t.TAB JOIN RECADATE r ON r.CONV = c.COD
        WHERE r.REG = ? AND t.COD <> r.PROCED AND t.TIPOATO IN (1, 7)
          AND EXISTS (SELECT 1 FROM TBVLRTHM v WHERE v.TAB = t.TAB AND v.COD = t.COD AND v.VALOR_CH > 0)
        ORDER BY t.COD`,
      [reg],
      { teto: 1, tempoMaximoMs: 120_000 },
    );
    if (!p) throw new Error('Nenhum procedimento com valor na tabela do convênio.');
    return num(p['COD']);
  };
  /** Lança o procedimento extra pelo executor na preparação; devolve a sequência. */
  const lancarExtraNaPreparacao = async (e: Escritor, reg: number): Promise<number> => {
    const r = await executarOutra(e, 'atendimento.lancarProcedimentoExtra', {
      atendimento: reg,
      procedimento: await procedimentoExtra(e, reg),
      quantidade: 1,
    });
    return num(r.resultado['seq']);
  };

  const paciente = async (e: Escritor): Promise<{ id: number; pront: number }> => {
    const cpf = await cpfLivre(e, (Date.now() + 7919 * ++seq) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const r = await executarOutra(e, 'cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
    const id = num(r.resultado['idPaciente']);
    const [p] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [id], { teto: 1 });
    return { id, pront: num(p?.['PRONT']) };
  };
  const senhaDoDia = async (e: Escritor) => {
    const g = await geradorLivre(e, { tipo: '0' });
    const r = await executarOutra(e, 'recepcao.emitirSenha', {
      gerador: g.id,
      prioridade: '2',
      origem: 'balcao',
    });
    const id = num(r.resultado['senha']);
    preparadas.push(id);
    return { senha: id, local: g.local };
  };
  /** Entrada da abertura por tipo, com o apoio de uma ficha recente da cópia. */
  const entradaAbertura = async (
    e: Escritor,
    tipo: 'consulta' | 'pa' | 'exame' | 'requisicaoLab',
    pac: number,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    if (tipo === 'requisicaoLab') {
      const a = await apoioDaRequisicao(e);
      return {
        tipo,
        paciente: pac,
        convenio: a.convenio,
        plano: 'PLANO SINTETICO',
        matricula: '900000000001',
        validadeCarteira: '2030-12-31',
        profissional: a.profissional,
        especialidade: 0,
        unidade: a.unidade,
        centroCusto: a.centroCusto,
        procedimento: a.procedimento,
        carater: 'eletivo',
        solicitante: a.solicitante,
        dataRequisicao: '2026-01-15',
        ...extra,
      };
    }
    const tipoAte = tipo === 'consulta' ? 4 : tipo === 'pa' ? 11 : 4;
    const a = await apoioDaFicha(e, { tipoAte, particular: extra['convenio'] === 10 });
    return {
      tipo,
      paciente: pac,
      convenio: a.convenio,
      plano: 'PLANO SINTETICO',
      matricula: '900000000001',
      validadeCarteira: '2030-12-31',
      profissional: a.profissional,
      especialidade: a.especialidade,
      unidade: a.unidade,
      centroCusto: a.centroCusto,
      procedimento: a.procedimento,
      carater: tipo === 'pa' ? 'urgencia' : 'eletivo',
      cidPrincipal: a.cid,
      ...extra,
    };
  };
  /** Uma ficha aberta pelo executor na preparação (estado de partida das outras operações). */
  const fichaAberta = async (
    e: Escritor,
    o: { senha?: boolean; tipo?: 'consulta' | 'exame' } = {},
  ): Promise<{ reg: number; senha: number | null; local: number }> => {
    const pac = await paciente(e);
    const s = o.senha ? await senhaDoDia(e) : null;
    const ent = await entradaAbertura(
      e,
      o.tipo ?? 'consulta',
      pac.id,
      s ? { senha: s.senha, local: s.local } : {},
    );
    const r = await executarOutra(e, 'atendimento.abrirAtendimento', ent);
    fichas.add(num(r.resultado['reg']));
    return { reg: num(r.resultado['reg']), senha: s?.senha ?? null, local: s?.local ?? 0 };
  };

  const preparar = async (e: Escritor): Promise<void> => {
    await operadorSintetico(e);
    switch (nome) {
      case 'atendimento.abrirAtendimento': {
        const pac = await paciente(e);
        if (cenario === 'consulta-agendada') {
          const s = await senhaDoDia(e);
          const marcacao = await marcacaoDeHojeDoPaciente(e, pac.pront);
          marcacoes.push(marcacao);
          const [h] = await e.consultar(
            'SELECT NOME, CRM, DATA, HORA FROM REPACAGD WHERE ID = ?',
            [marcacao],
            {
              teto: 1,
            },
          );
          if (h) horarios.push({ NOME: h['NOME'], CRM: h['CRM'], DATA: h['DATA'], HORA: h['HORA'] });
          entrada = await entradaAbertura(e, 'consulta', pac.id, {
            senha: s.senha,
            local: s.local,
            marcacao,
            tipoGuia: 'H',
          });
          return;
        }
        // M50, etapa 4: a teleconsulta da marcação do dia (agendada pelo portal, o paciente na sala de espera com o
        // termo e o local, a sala aberta pelo médico), só em SGH_ na transação desfeita; a abertura sem senha.
        if (cenario === 'teleconsulta') {
          const marcacao = await marcacaoDeHojeDoPaciente(e, pac.pront);
          marcacoes.push(marcacao);
          const [h] = await e.consultar(
            'SELECT NOME, CRM, DATA, HORA FROM REPACAGD WHERE ID = ?',
            [marcacao],
            { teto: 1 },
          );
          if (h) horarios.push({ NOME: h['NOME'], CRM: h['CRM'], DATA: h['DATA'], HORA: h['HORA'] });
          const hospital = e.hospital;
          const t = await agendarTeleconsulta(e, {
            hospital,
            marcacao,
            agenda: 1,
            nomeAgenda: 'AGENDA SINTETICA SGH M50',
            crmAgenda: num(h?.['CRM']),
            data: new Date().toISOString().slice(0, 10),
            hora: '0800',
            paciente: pac.id,
            conta: null,
            por: 'SGH.PORTAL.C1',
          });
          const v = await entrarSalaEspera(e, hospital, t.id, 1, {
            termo: 'TELE-2026.1',
            local: { uf: 'RJ', municipio: 'PETROPOLIS', tipo: 'residencia' },
            por: 'SGH.PORTAL.C1',
          });
          const abertura = await entradaAbertura(e, 'consulta', pac.id, {
            marcacao,
            tipoGuia: 'H',
            teleconsulta: { id: t.id },
          });
          // A sala aberta pelo mesmo profissional que abre a ficha (só ele liga a ficha à teleconsulta).
          await abrirSalaTeleconsulta(e, hospital, t.id, v.versao, {
            provedor: 'simulado',
            sala: 'SIM-SALA-REPRODUCAO',
            declaracao: 'CFM-2314-2026.1',
            medico: 'SGH.ASSINATURA',
            vinculo: Number(abertura['profissional']),
            cienteAlerta: false,
          });
          entrada = abertura;
          return;
        }
        if (cenario === 'pa-espontaneo') {
          const s = await senhaDoDia(e);
          entrada = await entradaAbertura(e, 'pa', pac.id, {
            senha: s.senha,
            local: s.local,
            horarioEspecial: true,
            tipoGuia: 'E',
          });
          return;
        }
        if (cenario === 'exame') {
          entrada = await entradaAbertura(e, 'exame', pac.id, { tipoGuia: 'H' });
          return;
        }
        if (cenario === 'requisicao-lab') {
          entrada = await entradaAbertura(e, 'requisicaoLab', pac.id);
          return;
        }
        if (cenario === 'particular') {
          const ent = await entradaAbertura(e, 'consulta', pac.id, { convenio: 10, tipoGuia: 'H' });
          delete ent['matricula'];
          delete ent['validadeCarteira'];
          entrada = ent;
          return;
        }
        if (cenario === 'param-pc') {
          entrada = await entradaAbertura(e, 'consulta', pac.id, {
            tipoGuia: 'H',
            responsavel: { nome: 'RESPONSAVEL SINTETICO SGH M20', parentesco: 4, telefone: '21900000002' },
          });
          return;
        }
        // recusa: a senha já ligada a um atendimento aberto na preparação.
        const s = await senhaDoDia(e);
        const outro = await paciente(e);
        const primeira = await executarOutra(
          e,
          'atendimento.abrirAtendimento',
          await entradaAbertura(e, 'consulta', outro.id, { senha: s.senha, local: s.local }),
        );
        fichas.add(num(primeira.resultado['reg']));
        entrada = await entradaAbertura(e, 'consulta', pac.id, { senha: s.senha, local: s.local });
        recusaEsperada = 'senha-ja-atendida';
        return;
      }
      case 'atendimento.alterarSegurado': {
        const f = await fichaAberta(e);
        const [v] = await e.consultar(
          'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RECADATE WHERE REG = ?',
          [f.reg],
          { teto: 1 },
        );
        const versao = txt(v?.['V']);
        if (cenario === 'recusa-colisao') {
          entrada = { atendimento: f.reg, matricula: '900000000009', versao: '2001-01-01 00:00:00.0000' };
          recusaEsperada = 'conflito-versao';
          return;
        }
        entrada = { atendimento: f.reg, matricula: '900000000002', validadeCarteira: '2031-06-30', versao };
        return;
      }
      case 'atendimento.alterarAtendimento': {
        // W1-05: a ficha aberta na preparação (conta aberta só com o item da ficha), corrigida pelo cenário.
        const f = await fichaAberta(e);
        const [v] = await e.consultar(
          `SELECT CAST(r.DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V, r.CONV, r.PROCED, r.ID_TBCID10_PRINCIPAL CID,
                  c.THM_E
             FROM RECADATE r JOIN TBCONVEN c ON c.COD = r.CONV WHERE r.REG = ?`,
          [f.reg],
          { teto: 1 },
        );
        const versao = txt(v?.['V']);
        const justificativa = 'Correção sintética da ficha (W1-05)';
        if (cenario === 'cadastrais') {
          const [c] = await e.consultar(
            "SELECT FIRST 1 ID FROM TBCID10 WHERE ID <> ? AND COD STARTING WITH 'J'",
            [num(v?.['CID'])],
            { teto: 1 },
          );
          entrada = {
            atendimento: f.reg,
            cidPrincipal: num(c?.['ID']),
            observacao: 'OBSERVACAO SINTETICA',
            carater: 'urgencia',
            versao,
            justificativa,
          };
          return;
        }
        // O convênio de destino: ativo, o mesmo procedimento com valor e a mesma natureza na tabela dele (natureza e
        // valor como a operação os lê: TIPOATO nulo vale 1, textos aparados; valor da vigência mais recente até o dia).
        const proced = num(v?.['PROCED']);
        const natureza = async (tab: number): Promise<string | null> => {
          const [n] = await e.consultar(
            'SELECT TIPOATO, PROCMED, PANE FROM TBTABTHM WHERE TAB = ? AND COD = ?',
            [tab, proced],
            {
              teto: 1,
            },
          );
          return n ? `${num(n['TIPOATO']) || 1}|${txt(n['PROCMED'])}|${txt(n['PANE'])}` : null;
        };
        const antes = await natureza(num(v?.['THM_E']));
        let destino = 0;
        for (const c of CONVENIOS_VISTOS) {
          if (c === num(v?.['CONV'])) continue;
          const [t] = await e.consultar("SELECT THM_E FROM TBCONVEN WHERE COD = ? AND SITUACAO = 'A'", [c], {
            teto: 1,
          });
          if (!t || antes === null || (await natureza(num(t['THM_E']))) !== antes) continue;
          const [x] = await e.consultar(
            `SELECT FIRST 1 COALESCE(VALOR_CH, 0) + COALESCE(VALOR_CO, 0) + COALESCE(VALOR_FILME, 0)
                + COALESCE(VALOR_ANES, 0) + COALESCE(VALOR_OUTROS, 0) T
               FROM TBVLRTHM WHERE TAB = ? AND COD = ?
                AND DATA <= (SELECT DT_ATE FROM RECADATE WHERE REG = ?) ORDER BY DATA DESC`,
            [num(t['THM_E']), proced, f.reg],
            { teto: 1 },
          );
          if (num(x?.['T']) > 0) {
            destino = c;
            break;
          }
        }
        if (!destino) throw new Error('Nenhum convênio de destino com o procedimento da ficha.');
        entrada = { atendimento: f.reg, convenio: destino, versao, justificativa };
        if (cenario === 'recusa-fechada') {
          await faturamentoFechaConta(e, f.reg);
          recusaEsperada = 'conta-fechada';
        }
        return;
      }
      case 'atendimento.lancarProcedimentoExtra': {
        const f = await fichaAberta(e);
        entrada = { atendimento: f.reg, procedimento: await procedimentoExtra(e, f.reg), quantidade: 1 };
        const [h] = await e.consultar('SELECT HORAS FROM RECADATE WHERE REG = ?', [f.reg], { teto: 1 });
        extras['HORA'] = txt(h?.['HORAS']);
        if (cenario === 'recusa-fechada') {
          await faturamentoFechaConta(e, f.reg);
          recusaEsperada = 'conta-fechada';
        }
        return;
      }
      case 'atendimento.estornarProcedimentoExtra':
      case 'atendimento.corrigirProcedimentoExtra': {
        // W1-05: o procedimento extra lançado na preparação (conta aberta), estornado ou corrigido pelo cenário.
        const f = await fichaAberta(e);
        const sequencia = await lancarExtraNaPreparacao(e, f.reg);
        entrada =
          nome === 'atendimento.estornarProcedimentoExtra'
            ? { atendimento: f.reg, sequencia, justificativa: 'Procedimento sintético lançado por engano' }
            : {
                atendimento: f.reg,
                sequencia,
                quantidade: 2,
                justificativa: 'Quantidade sintética corrigida',
              };
        if (cenario === 'recusa-fechada') {
          await faturamentoFechaConta(e, f.reg);
          recusaEsperada = 'conta-fechada';
        }
        return;
      }
      case 'atendimento.conduzirNoConsultorio': {
        if (cenario === 'sem-senha') {
          const f = await fichaAberta(e);
          entrada = {
            atendimento: f.reg,
            local: (await geradorLivre(e, { tipo: '0' })).local,
            evento: 'chamar',
          };
          return;
        }
        const f = await fichaAberta(e, { senha: true });
        if (cenario === 'atender')
          await executarOutra(e, 'atendimento.conduzirNoConsultorio', {
            atendimento: f.reg,
            local: f.local,
            evento: 'chamar',
          });
        if (cenario === 'recusa') {
          await executarOutra(e, 'atendimento.encerrarAtendimento', {
            atendimento: f.reg,
            desfecho: 'administrativo',
          });
          recusaEsperada = 'atendimento-encerrado';
        }
        entrada = {
          atendimento: f.reg,
          local: f.local,
          evento: cenario === 'atender' ? 'atender' : 'chamar',
        };
        return;
      }
      case 'atendimento.encerrarAtendimento': {
        const f = await fichaAberta(e, { senha: cenario !== 'sem-senha' });
        if (f.senha)
          await executarOutra(e, 'atendimento.conduzirNoConsultorio', {
            atendimento: f.reg,
            local: f.local,
            evento: 'chamar',
          });
        entrada = {
          atendimento: f.reg,
          desfecho: cenario === 'sem-senha' ? 'evasao' : 'administrativo',
          ...(f.senha ? { local: f.local } : {}),
        };
        if (cenario === 'recusa') {
          await executarOutra(e, 'atendimento.encerrarAtendimento', entrada);
          recusaEsperada = 'atendimento-encerrado';
        }
        return;
      }
      case 'atendimento.cancelarAtendimento': {
        const [m] = await e.consultar('SELECT FIRST 1 COD FROM TBMOTEXC WHERE COD = 2', [], { teto: 1 });
        const motivo = num(m?.['COD']) || 2;
        // W1-05, D-EXC-AGE-20: a ficha aberta da marcação do dia (a marcação volta a não atendida com a exclusão).
        let f: { reg: number };
        if (cenario === 'com-marcacao') {
          const pac = await paciente(e);
          const marcacao = await marcacaoDeHojeDoPaciente(e, pac.pront);
          marcacoes.push(marcacao);
          const [h] = await e.consultar(
            'SELECT NOME, CRM, DATA, HORA FROM REPACAGD WHERE ID = ?',
            [marcacao],
            {
              teto: 1,
            },
          );
          if (h) horarios.push({ NOME: h['NOME'], CRM: h['CRM'], DATA: h['DATA'], HORA: h['HORA'] });
          const r = await executarOutra(
            e,
            'atendimento.abrirAtendimento',
            await entradaAbertura(e, 'consulta', pac.id, { marcacao, tipoGuia: 'H' }),
          );
          fichas.add(num(r.resultado['reg']));
          f = { reg: num(r.resultado['reg']) };
        } else f = await fichaAberta(e, { senha: cenario === 'com-senha' });
        if (cenario === 'apos-estorno') {
          // W1-05: a ficha com procedimento extra sai depois do estorno (a prévia recusa enquanto ele existe).
          const sequencia = await lancarExtraNaPreparacao(e, f.reg);
          await executarOutra(e, 'atendimento.estornarProcedimentoExtra', {
            atendimento: f.reg,
            sequencia,
            justificativa: 'Procedimento sintético lançado por engano',
          });
        }
        entrada = {
          atendimento: f.reg,
          motivo,
          justificativa: 'Ficha sintética aberta por engano na reprodução',
        };
        if (cenario === 'recusa') {
          await faturamentoFechaConta(e, f.reg);
          recusaEsperada = 'exclusao-recusada';
        }
        return;
      }
      case 'atendimento.alterarHeranca': {
        // A configuração única (REPARATE): as marcas lidas como a tela leria; o cenário inverte a carteirinha e a guia.
        const [l] = await e.consultar(
          `SELECT ${HERANCAS.map((h) => h.coluna).join(', ')} FROM REPARATE`,
          [],
          {
            teto: 1,
          },
        );
        const versao = versaoDaHeranca(l ?? {});
        const marca = (campo: string) => versao[HERANCAS.findIndex((h) => h.campo === campo)] === 'T';
        const lida =
          cenario === 'recusa-colisao' ? `${versao[0] === 'T' ? 'F' : 'T'}${versao.slice(1)}` : versao;
        entrada = { marcas: { matricula: !marca('matricula'), guia: !marca('guia') }, versao: lida };
        if (cenario === 'recusa-colisao') recusaEsperada = 'conflito-versao';
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução no atendimento.`);
    }
  };

  return {
    ...base,
    // As tabelas da ficha têm de 100 a 300 mil linhas: as linhas que o cenário cria, altera ou apaga são retratadas
    // pelas chaves-alvo (as fichas da preparação e a criada pelo cenário, lidas na transação), e o saldo da contagem
    // confere que nada mais mudou (M13; M20 nas tabelas médias).
    alvosNasTabelasMedias: true,
    entradasDaPreparacao: () => ({ ...extras }),
    chavesAlvo: () => ({
      ...alvosFichas,
      TBSENHAATEND: preparadas.map((id) => ({ ID: id })),
      REPACAGD: marcacoes.map((id) => ({ ID: id })),
      REPACAGI: horarios,
    }),
    async preparar(e) {
      await preparar(e);
      await lerAlvos(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else {
        const r = await executar(e, entrada);
        const reg = num(r.resultado['reg']);
        if (reg > 0) fichas.add(reg);
      }
      await lerAlvos(e);
    },
  };
}
