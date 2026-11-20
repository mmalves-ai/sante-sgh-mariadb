// Reprodução dos cenários de assinatura da agenda de exames (M18; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o paciente sintético
// (cadastro.cadastrarPaciente, marca "SINTETICO SGH M04"), a grade de horários futura (agenda.gerarGradeExame) numa
// agenda de exames ativa da cópia (só o ID e o nome em memória) e as marcações de partida; o cenário executa só a
// receita sob teste. O que nenhuma receita do marco grava (a senha de atendimento do check-in, da recepção, M19; o
// horário ocupado "por fora", o escritor do outro sistema simulado) é posto por comando na transação desfeita.
import type { GerarGradeExameEntrada } from '@sgh/contratos';
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';
import { feriadoNaData, pascoa, semanaDaData } from '@sgh/dominio-agenda';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_EXAME = new Set([
  'agenda.agendarExame',
  'agenda.cancelarExame',
  'agenda.remarcarExame',
  'agenda.gerarGradeExame',
  'agenda.definirCoberturaExame',
  'agenda.agendarExameSemProntuario',
]);

export const MARCA_M18 = 'SINTETICO SGH M18';
const OBS_ACENTUADA = `${MARCA_M18}: jejum de 8 horas — “preparo” do exame (ação, informação)`;

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown) => Number(v ?? 0);
let seq = 0;

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function hoje(e: Escritor): Promise<string> {
  const [r] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
    teto: 1,
  });
  return txt(r?.['H']);
}

async function feriados(e: Escritor, de: string, ate: string) {
  const linhas = await e.consultar(
    `SELECT CAST(DATA AS VARCHAR(10)) D, NOME FROM TBFERIAD WHERE EXTRACT(YEAR FROM DATA) = 9999 OR (DATA BETWEEN CAST(CAST(? AS VARCHAR(10)) AS DATE) AND CAST(CAST(? AS VARCHAR(10)) AS DATE))`,
    [de, ate],
    { teto: 1_000 },
  );
  return linhas.map((x) => ({ data: txt(x['D']), nome: txt(x['NOME']) }));
}

export interface AgendaExameEscolhida {
  id: number;
  nome: string;
  exame: string;
  convenios: number[];
}

/**
 * Agenda de exames ativa da cópia, CRM 0, nome único, com a lista de convênios (as 19 ativas têm 44); `semEscala`:
 * sem linha no modelo da escala (a geração inclui as linhas, nunca altera as de outra agenda).
 */
export async function agendaExameLivre(e: Escritor, semEscala = false): Promise<AgendaExameEscolhida> {
  const linhas = await e.consultar(
    `SELECT a.ID, a.NOME, a.EXAME FROM SIAGENDA a WHERE a.ATIVA = 'S' AND a.CRM = 0 AND a.EXAME IN ('E', 'U', 'O')
        ${semEscala ? 'AND NOT EXISTS (SELECT 1 FROM SICTRAGE t WHERE t.AGENDA = a.NOME AND t.CRM = a.CRM)' : ''}
        AND (SELECT COUNT(*) FROM SIAGENDA x WHERE x.NOME = a.NOME) = 1
        AND EXISTS (SELECT 1 FROM SIAGENDA_TBCONVEN c WHERE c.ID_SIAGENDA = a.ID AND c.ID_TBCONVEN = 306)
      ORDER BY a.ID`,
    [],
    { teto: 100 },
  );
  const x = linhas[0];
  if (!x) throw new Error('Nenhuma agenda de exames ativa elegível na cópia.');
  const id = num(x['ID']);
  const conv = await e.consultar('SELECT ID_TBCONVEN C FROM SIAGENDA_TBCONVEN WHERE ID_SIAGENDA = ?', [id], {
    teto: 1_000,
  });
  return { id, nome: txt(x['NOME']), exame: txt(x['EXAME']), convenios: conv.map((c) => num(c['C'])) };
}

/** Dia útil (segunda a sexta, sem feriado fixo ou móvel) sem nenhum horário da agenda, a partir de `de`. */
export async function diaUtilLivreExame(
  e: Escritor,
  a: AgendaExameEscolhida,
  de: string,
  semanas?: number[],
): Promise<string> {
  const fer = await feriados(e, de, somar(de, 90));
  for (let i = 0; i < 90; i++) {
    const d = somar(de, i);
    const s = semanaDaData(d);
    if (s === 1 || s === 7 || feriadoNaData(d, fer)) continue;
    if (semanas && !semanas.includes(s)) continue;
    const p = pascoa(Number(d.slice(0, 4)));
    if ([somar(p, -47), somar(p, -2), somar(p, 60)].includes(d)) continue;
    const [x] = await e.consultar(
      'SELECT COUNT(*) N FROM SIPACAGI WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE)',
      [a.nome, d],
      { teto: 1 },
    );
    if (num(x?.['N']) === 0) return d;
  }
  throw new Error('Nenhum dia útil livre nos próximos 90 dias.');
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;

/** Prévia da grade: `porDia` horários de 15 min a partir das 07:00 em cada dia dado (uma faixa por dia). */
export function entradaGradeExame(
  a: AgendaExameEscolhida,
  dias: readonly string[],
  porDia = 4,
): GerarGradeExameEntrada {
  const fim = hhmm(7 * 60 + porDia * 15);
  const horarios = dias.flatMap((data) =>
    Array.from({ length: porDia }, (_, k) => ({ data, hora: hhmm(7 * 60 + k * 15) })),
  );
  const semanas = [...new Set(dias.map((d) => semanaDaData(d)))];
  return {
    agenda: a.id,
    de: [...dias].sort()[0] as string,
    ate: [...dias].sort().at(-1) as string,
    duracao: '0015',
    horarios,
    escala: semanas.map((s) => ({
      semana: s,
      duracao: '0015',
      horaInicio: '0700',
      horaFim: fim,
      intervaloInicio: '0000',
      intervaloFim: '0000',
    })),
    semanas: [1, 2, 3, 4, 5, 6, 7].map((x) => (semanas.includes(x) ? 'T' : 'F')) as ('T' | 'F')[],
  };
}

/** O balcão do outro sistema ocupa o horário direto na grade (como ele grava), na transação desfeita. */
export async function legadoOcupaHorarioExame(
  e: Escritor,
  a: Pick<AgendaExameEscolhida, 'nome'>,
  data: string,
  hora: string,
): Promise<void> {
  const n = await e.executar(
    `UPDATE SIPACAGI SET PACIENTE = ?, CONV = ?
      WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE) AND HORA = ? AND PACIENTE = ''`,
    [`${MARCA_M18} LEGADO`, 306, a.nome, data, hora],
  );
  if (n !== 1) throw new Error('Escritor legado simulado: o horário não estava vago.');
}

/** A senha de atendimento do check-in (da recepção, M19), ligada à marcação de exame: na transação desfeita. */
export async function senhaDoExame(e: Escritor, marcacao: number, usuario: string): Promise<void> {
  const [g] = await e.consultar('SELECT FIRST 1 ID FROM TBGERASENHA ORDER BY ID', [], { teto: 1 });
  if (!g) throw new Error('Nenhum gerador de senha na cópia.');
  const s = await e.executarRetornando(
    'INSERT INTO TBSENHAATEND (ID, ID_TBGERASENHA, SENHA, USUARIO) VALUES (0, ?, 1, ?) RETURNING ID',
    [num(g['ID']), usuario],
  );
  const n = await e.executar(
    'INSERT INTO TBSENHAATEND_SIPACAGD (ID_TBSENHAATEND, ID_SIPACAGD) VALUES (?, ?)',
    [num(s['ID']), marcacao],
  );
  if (n !== 1) throw new Error('Senha sintética não ligada à marcação de exame.');
}

/** O login com que o portal do paciente grava no legado (USUARIO_PORTAL de apps/api portal-paciente/aplicacao/servico.ts). */
export const USUARIO_PORTAL_LEGADO = 'SGH.PORTAL';

export function cenarioExame(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor, fixo?: string) => Promise<string>,
  tiposLogradouro: () => ReadonlySet<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  let operador = '';

  const paciente = async (e: Escritor) => {
    const cpf = await cpfLivre(e, (Date.now() + 6151 * ++seq) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const r = await executarOutra(e, 'cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
    return num(r.resultado['idPaciente']);
  };
  /** Grade futura de 4 horários em `dias` dias úteis livres a partir de daqui a 7 dias. */
  const gradeFutura = async (e: Escritor, a: AgendaExameEscolhida, dias = 1) => {
    const h = await hoje(e);
    const lista: string[] = [];
    let de = somar(h, 7);
    for (let i = 0; i < dias; i++) {
      const d = await diaUtilLivreExame(e, a, de);
      lista.push(d);
      de = somar(d, 1);
    }
    const g = entradaGradeExame(a, lista);
    await executarOutra(e, 'agenda.gerarGradeExame', g);
    return g;
  };
  const marcar = async (
    e: Escritor,
    a: AgendaExameEscolhida,
    data: string,
    hora: string,
    pac: number,
    canal: 'telefone' | 'portal' = 'telefone',
  ) => {
    const r = await executarOutra(e, 'agenda.agendarExame', {
      agenda: a.id,
      data,
      hora,
      paciente: pac,
      convenio: 306,
      exame: null,
      solicitante: null,
      retorno: false,
      canal,
    });
    return num(r.resultado['marcacao']);
  };

  const preparar = async (e: Escritor): Promise<void> => {
    operador = await operadorSintetico(e);
    switch (nome) {
      case 'agenda.agendarExame': {
        const a = await agendaExameLivre(e);
        const g = await gradeFutura(e, a);
        const pac = await paciente(e);
        const hora = (g.horarios[0] as { hora: string }).hora;
        const [ex] = await e.consultar(`SELECT FIRST 1 ID FROM SITABPRO WHERE ATO = 24 ORDER BY ID`, [], {
          teto: 1,
        });
        entrada =
          cenario === 'particular-retorno'
            ? {
                agenda: a.id,
                data: g.de,
                hora,
                paciente: pac,
                convenio: a.convenios.includes(10) ? 10 : 306,
                exame: ex ? num(ex['ID']) : null,
                solicitante: null,
                retorno: true,
                canal: 'presencial',
              }
            : cenario === 'portal'
              ? {
                  agenda: a.id,
                  data: g.de,
                  hora,
                  paciente: pac,
                  convenio: 306,
                  exame: null,
                  solicitante: null,
                  retorno: false,
                  canal: 'portal',
                }
              : cenario === 'obs-solicitante'
                ? {
                    agenda: a.id,
                    data: g.de,
                    hora,
                    paciente: pac,
                    convenio: 306,
                    exame: ex ? num(ex['ID']) : null,
                    solicitante: { crm: 99_999, uf: 'RJ', nome: `MEDICO ${MARCA_M18}` },
                    retorno: false,
                    observacao: OBS_ACENTUADA,
                    canal: 'telefone',
                  }
                : {
                    agenda: a.id,
                    data: g.de,
                    hora,
                    paciente: pac,
                    convenio: 306,
                    exame: null,
                    solicitante: null,
                    retorno: false,
                    canal: 'telefone',
                  };
        // Revisão do M39: 'recusa' é o horário tomado por outro terminal do NOVO (o executor marca antes); 'colisao-legado'
        // é o outro sistema ocupando o horário como ele grava (o escritor legado simulado). Os dois depois de a tela
        // ler a vaga (a entrada já tem a hora) e antes da gravação; a releitura do executor recusa.
        if (cenario === 'recusa') {
          await marcar(e, a, g.de, hora, await paciente(e));
          recusaEsperada = 'horario-ocupado';
        }
        if (cenario === 'colisao-legado') {
          await legadoOcupaHorarioExame(e, a, g.de, hora);
          recusaEsperada = 'horario-ocupado';
        }
        return;
      }
      case 'agenda.cancelarExame': {
        const a = await agendaExameLivre(e);
        const g = await gradeFutura(e, a);
        const m = await marcar(
          e,
          a,
          g.de,
          (g.horarios[1] as { hora: string }).hora,
          await paciente(e),
          cenario === 'portal' ? 'portal' : 'telefone',
        );
        entrada = {
          marcacao: m,
          motivo: cenario === 'portal' ? 'PAC-OUTRA-DATA' : 'PAC-DESISTIU',
          solicitante: 'paciente',
        };
        if (cenario === 'recusa-senha') {
          await senhaDoExame(e, m, operador);
          recusaEsperada = 'paciente-com-senha';
        }
        return;
      }
      case 'agenda.remarcarExame': {
        const a = await agendaExameLivre(e);
        const g = await gradeFutura(e, a, 2);
        const dias = [...new Set(g.horarios.map((h) => h.data))];
        const pac = await paciente(e);
        // W0-10: 'portal' é o caminho do portal do paciente (POST /api/paciente/agenda/marcacoes/exame/:id/remarcacao):
        // a marcação de origem feita pelo portal e a remarcação com o usuário do portal, modo liberar e canal portal.
        // O paciente e a grade ficam com o operador sintético (TBUSERS); a marcação e a remarcação, com o do portal.
        const portal = cenario === 'portal';
        if (portal) operador = await operadorSintetico(e, USUARIO_PORTAL_LEGADO);
        const m = await marcar(e, a, dias[0] as string, '0700', pac, portal ? 'portal' : 'telefone');
        entrada = {
          marcacao: m,
          destino: { agenda: a.id, data: dias[1], hora: '0715' },
          modo: cenario === 'transferir' ? 'transferir' : 'liberar',
          canal: portal ? 'portal' : 'telefone',
          motivo: 'PAC-OUTRA-DATA',
        };
        if (cenario === 'recusa') {
          await legadoOcupaHorarioExame(e, a, dias[1] as string, '0715');
          recusaEsperada = 'horario-ocupado';
        }
        return;
      }
      case 'agenda.gerarGradeExame': {
        const a = await agendaExameLivre(e, true);
        const h = await hoje(e);
        // Semana: terça e quinta seguintes (8 horários de 15 min cada), sem horário nem feriado.
        const terca = await diaUtilLivreExame(e, a, somar(h, 7), [3]);
        const quinta = await diaUtilLivreExame(e, a, somar(terca, 1), [5]);
        entrada = entradaGradeExame(a, [terca, quinta], 8);
        if (cenario === 'recusa') {
          const g = entrada as GerarGradeExameEntrada;
          await executarOutra(e, 'agenda.gerarGradeExame', {
            ...g,
            ate: g.de,
            horarios: [g.horarios[0]],
            escala: [g.escala[0]],
            semanas: g.semanas,
          });
          recusaEsperada = 'previa-desatualizada';
        }
        return;
      }
      case 'agenda.definirCoberturaExame': {
        const a = await agendaExameLivre(e);
        if (cenario === 'incluir-sadt') {
          const [x] = await e.consultar(
            `SELECT FIRST 1 COD FROM TBCONVEN WHERE COD > 0 AND COD NOT IN (SELECT ID_TBCONVEN FROM SIAGENDA_TBCONVEN WHERE ID_SIAGENDA = ?) ORDER BY COD`,
            [a.id],
            { teto: 1 },
          );
          if (!x) throw new Error('Nenhum convênio fora da lista da agenda de exames.');
          entrada = { agenda: a.id, convenio: num(x['COD']), acao: 'incluir' };
          return;
        }
        if (cenario === 'remover-sadt') {
          entrada = { agenda: a.id, convenio: 306, acao: 'remover' };
          return;
        }
        entrada = { agenda: a.id, convenio: 306, acao: 'incluir' };
        recusaEsperada = 'ja-aceito';
        return;
      }
      case 'agenda.agendarExameSemProntuario': {
        const a = await agendaExameLivre(e);
        const g = await gradeFutura(e, a);
        entrada = {
          agenda: a.id,
          data: g.de,
          hora: (g.horarios[0] as { hora: string }).hora,
          nome: `${MARCA_M18} SEM PRONTUARIO`,
          telefone: '21900000000',
          convenio: 306,
          canal: 'telefone',
        };
        recusaEsperada = 'operacao-pendente';
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução na agenda de exames.`);
    }
  };

  return {
    ...base,
    async preparar(e) {
      await preparar(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else await executar(e, entrada);
    },
  };
}
