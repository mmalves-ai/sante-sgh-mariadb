// Reprodução dos cenários de assinatura da agenda de consultas (M17; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o paciente sintético
// (cadastro.cadastrarPaciente, marca "SINTETICO SGH M04"), a grade de horários futura (agenda.gerarGrade) numa agenda
// ativa da cópia (só o ID e o nome em memória), as marcações, os encaixes e os bloqueios de partida; o cenário
// executa só a receita sob teste. O que nenhuma receita do marco grava (a senha de atendimento do check-in, que é
// da recepção, M19) é posto por INSERT na transação desfeita, como a recepção faria. A falta usa uma marcação
// passada da cópia sem chegada (só o ID em memória; a situação muda só na transação desfeita).
import type { GerarGradeEntrada } from '@sgh/contratos';
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';
import { feriadoNaData, pascoa, planejarGrade, semanaDaData as semanaDaDataIso } from '@sgh/dominio-agenda';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_AGENDA = new Set([
  'agenda.gerarGrade',
  'agenda.reverterGrade',
  'agenda.agendarConsulta',
  'agenda.encaixar',
  'agenda.desfazerEncaixe',
  'agenda.cancelarConsulta',
  'agenda.remarcarConsulta',
  'agenda.definirCobertura',
  'agenda.confirmarConsulta',
  'agenda.registrarFalta',
  'agenda.bloquearHorarios',
  'agenda.incluirAgenda',
  'agenda.alterarAgenda',
  'agenda.definirEspecialidade',
]);

export const MARCA_M17 = 'SINTETICO SGH M17';

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
const sufixo = () =>
  `${Date.now().toString(36).toUpperCase().slice(-4)}${(seq++ % 36).toString(36).toUpperCase()}`;

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

interface Relogio {
  hoje: string;
  hhmm: string;
}

export async function relogio(e: Escritor): Promise<Relogio> {
  const [r] = await e.consultar(
    `SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H, LPAD(EXTRACT(HOUR FROM CURRENT_TIME), 2, '0') || LPAD(EXTRACT(MINUTE FROM CURRENT_TIME), 2, '0') M FROM RDB$DATABASE`,
    [],
    { teto: 1 },
  );
  return { hoje: txt(r?.['H']), hhmm: txt(r?.['M']) };
}

async function feriados(e: Escritor, de: string, ate: string) {
  const linhas = await e.consultar(
    `SELECT CAST(DATA AS VARCHAR(10)) D, NOME FROM TBFERIAD WHERE EXTRACT(YEAR FROM DATA) = 9999 OR (DATA BETWEEN CAST(CAST(? AS VARCHAR(10)) AS DATE) AND CAST(CAST(? AS VARCHAR(10)) AS DATE))`,
    [de, ate],
    { teto: 1_000 },
  );
  return linhas.map((x) => ({ data: txt(x['D']), nome: txt(x['NOME']) }));
}

export interface AgendaEscolhida {
  id: number;
  nome: string;
  duracao: string;
  convenios: number[];
}

/**
 * Agenda ativa da cópia, CRM 0 e nome único, com a duração cadastrada no domínio visto; `semEscala`: sem nenhuma linha
 * no modelo da escala (a geração da reprodução inclui as linhas, nunca altera as de outra agenda). Só datas futuras:
 * a grade da cópia acaba em 2026-09.
 */
export async function agendaLivre(
  e: Escritor,
  o: { lista?: boolean | null; semEscala?: boolean } = {},
): Promise<AgendaEscolhida> {
  const semEscala = o.semEscala ?? true;
  const linhas = await e.consultar(
    `SELECT a.ID, a.NOME, a.DURACAO, (SELECT COUNT(*) FROM REAGENDA_TBCONVEN c WHERE c.ID_REAGENDA = a.ID) NC
       FROM REAGENDA a WHERE a.ATIVA = 'S' AND a.CRM = 0 AND a.DURACAO IN ('0010', '0015', '0020', '0030')
        ${semEscala ? 'AND NOT EXISTS (SELECT 1 FROM RECTRAGE t WHERE t.AGENDA = a.NOME AND t.CRM = a.CRM)' : ''}
        AND (SELECT COUNT(*) FROM REAGENDA x WHERE x.NOME = a.NOME) = 1
      ORDER BY a.ID`,
    [],
    { teto: 500 },
  );
  const cand = linhas.filter((x) =>
    o.lista === undefined || o.lista === null ? true : o.lista ? num(x['NC']) > 1 : num(x['NC']) === 0,
  );
  const x = cand[0];
  if (!x) throw new Error('Nenhuma agenda ativa elegível na cópia.');
  const id = num(x['ID']);
  const conv = await e.consultar('SELECT ID_TBCONVEN C FROM REAGENDA_TBCONVEN WHERE ID_REAGENDA = ?', [id], {
    teto: 1_000,
  });
  return { id, nome: txt(x['NOME']), duracao: txt(x['DURACAO']), convenios: conv.map((c) => num(c['C'])) };
}

/** Convênio ativo do domínio visto da marcação, aceito pela agenda (lista vazia aceita todos), diferente do particular. */
export async function convenioAceito(e: Escritor, a: AgendaEscolhida, particular = false): Promise<number> {
  if (particular && (a.convenios.length === 0 || a.convenios.includes(10))) return 10;
  const vistos = [306, 308, 32, 251, 307, 305, 10];
  const linhas = await e.consultar(
    `SELECT COD FROM TBCONVEN WHERE SITUACAO = 'A' AND COD IN (${vistos.join(', ')})`,
    [],
    { teto: 20 },
  );
  const ativos = vistos.filter((v) => linhas.some((x) => num(x['COD']) === v));
  const c = ativos.find((v) => v !== 10 && (a.convenios.length === 0 || a.convenios.includes(v)));
  if (c === undefined) throw new Error('Nenhum convênio ativo aceito pela agenda.');
  return c;
}

/** Primeiro dia útil (segunda a sexta) a partir de `de`, que não é feriado nem móvel, sem horário da agenda. */
export async function diaUtil(e: Escritor, a: AgendaEscolhida, de: string): Promise<string> {
  const fer = await feriados(e, de, somar(de, 60));
  for (let i = 0; i < 60; i++) {
    const d = somar(de, i);
    const s = semanaDaDataIso(d);
    if (s === 1 || s === 7 || feriadoNaData(d, fer)) continue;
    const p = pascoa(Number(d.slice(0, 4)));
    if ([somar(p, -47), somar(p, -2), somar(p, 60)].includes(d)) continue;
    const [x] = await e.consultar(
      'SELECT COUNT(*) N FROM REPACAGI WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE)',
      [a.nome, d],
      { teto: 1 },
    );
    if (num(x?.['N']) === 0) return d;
  }
  throw new Error('Nenhum dia útil livre nos próximos 60 dias.');
}

/** Grade de 4 horários de 15 min das 07:00 às 08:00 num dia útil (pelo executor). */
export function entradaGrade(
  a: AgendaEscolhida,
  data: string,
  inicio = '0700',
  fim = '0800',
): GerarGradeEntrada {
  const s = semanaDaDataIso(data);
  const ini = Number(inicio.slice(0, 2)) * 60 + Number(inicio.slice(2));
  const f = Number(fim.slice(0, 2)) * 60 + Number(fim.slice(2));
  const horarios = [];
  for (let m = ini; m + 15 <= f; m += 15)
    horarios.push({
      data,
      hora: `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`,
    });
  return {
    agenda: a.id,
    de: data,
    ate: data,
    duracao: '0015',
    horarios,
    escala: [
      {
        semana: s,
        duracao: '0015',
        horaInicio: inicio,
        horaFim: fim,
        intervaloInicio: '0000',
        intervaloFim: '0000',
      },
    ],
    semanas: [1, 2, 3, 4, 5, 6, 7].map((x) => (x === s ? 'T' : 'F')) as ('T' | 'F')[],
  };
}

/**
 * Escritor legado simulado (cap-14 §14.2.2): o balcão do outro sistema ocupa o horário direto na grade (como ele
 * grava: PACIENTE, CONV e USUARIO no REPACAGI), entre a leitura das vagas no novo e a gravação. Só na transação
 * desfeita; a marca SINTETICO no nome; o usuário é o sintético da transação (USUARIO tem FK para TBUSERS).
 */
export async function legadoOcupaHorario(
  e: Escritor,
  a: Pick<AgendaEscolhida, 'nome'>,
  data: string,
  hora: string,
  usuario: string,
): Promise<void> {
  const n = await e.executar(
    `UPDATE REPACAGI SET PACIENTE = ?, CONV = ?, USUARIO = ?
      WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE) AND HORA = ? AND PACIENTE = ''`,
    [`${MARCA_M17} LEGADO`, 10, usuario, a.nome, data, hora],
  );
  if (n !== 1) throw new Error('Escritor legado simulado: o horário não estava vago.');
}

const OBS_ACENTUADA = `${MARCA_M17}: trazer documentos e a carteirinha — “recado” do balcão (ação, informação)`;

/** A senha de atendimento do check-in (da recepção, M19): INSERT na transação desfeita. */
export async function senhaDeAtendimento(e: Escritor, marcacao: number, usuario: string): Promise<void> {
  const [g] = await e.consultar('SELECT FIRST 1 ID FROM TBGERASENHA ORDER BY ID', [], { teto: 1 });
  if (!g) throw new Error('Nenhum gerador de senha na cópia.');
  const s = await e.executarRetornando(
    'INSERT INTO TBSENHAATEND (ID, ID_TBGERASENHA, SENHA, USUARIO) VALUES (0, ?, 1, ?) RETURNING ID',
    [num(g['ID']), usuario],
  );
  const n = await e.executar(
    'INSERT INTO TBSENHAATEND_REPACAGD (ID_TBSENHAATEND, ID_REPACAGD) VALUES (?, ?)',
    [num(s['ID']), marcacao],
  );
  if (n !== 1) throw new Error('Senha sintética não ligada à marcação.');
}

export function cenarioAgenda(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
  tiposLogradouro: () => ReadonlySet<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  let operador = '';

  const paciente = async (e: Escritor) => {
    const cpf = await cpfLivre(e, (Date.now() + 7919 * ++seq) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro());
    const r = await executarOutra(e, 'cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
    return num(r.resultado['idPaciente']);
  };
  const gradeFutura = async (e: Escritor, a: AgendaEscolhida, inicio = '0700', fim = '0800') => {
    const r = await relogio(e);
    const d = await diaUtil(e, a, somar(r.hoje, 7));
    const g = entradaGrade(a, d, inicio, fim);
    await executarOutra(e, 'agenda.gerarGrade', g);
    return g;
  };
  const marcar = async (
    e: Escritor,
    a: AgendaEscolhida,
    data: string,
    hora: string,
    pac: number,
    canal: 'telefone' | 'portal' = 'telefone',
  ) => {
    const r = await executarOutra(e, 'agenda.agendarConsulta', {
      agenda: a.id,
      data,
      hora,
      paciente: pac,
      convenio: await convenioAceito(e, a),
      retorno: false,
      canal,
    });
    return num(r.resultado['marcacao']);
  };

  const preparar = async (e: Escritor): Promise<void> => {
    operador = await operadorSintetico(e);
    switch (nome) {
      case 'agenda.gerarGrade': {
        const a = await agendaLivre(e);
        const r = await relogio(e);
        if (cenario === 'semana-com-feriado') {
          // Semana (segunda a sexta) com um feriado fixo num dia útil, a partir de daqui a 7 dias.
          const fer = await feriados(e, r.hoje, somar(r.hoje, 400));
          let segunda: string | null = null;
          for (let i = 7; i < 400 && !segunda; i++) {
            const d = somar(r.hoje, i);
            if (semanaDaDataIso(d) !== 2) continue;
            const dias = [0, 1, 2, 3, 4].map((k) => somar(d, k));
            const comFeriado = dias.filter((x) => feriadoNaData(x, fer));
            const p = pascoa(Number(d.slice(0, 4)));
            const moveis = [somar(p, -47), somar(p, -2), somar(p, 60)];
            if (comFeriado.length === 1 && !dias.some((x) => moveis.includes(x))) segunda = d;
          }
          if (!segunda) throw new Error('Nenhuma semana com feriado fixo útil.');
          const plano = planejarGrade(
            {
              de: segunda,
              ate: somar(segunda, 4),
              duracaoMinutos: 30,
              faixas: [2, 3, 4, 5, 6].map((s) => ({
                semana: s,
                inicio: '0900',
                fim: '1400',
                intervaloInicio: '1200',
                intervaloFim: '1300',
              })),
            },
            {
              relogio: r,
              agendaAtiva: true,
              feriados: fer,
              bloqueios: [],
              existentes: new Set(),
            },
          );
          entrada = {
            agenda: a.id,
            de: segunda,
            ate: somar(segunda, 4),
            duracao: plano.duracao,
            horarios: plano.horarios,
            escala: plano.escala,
            semanas: plano.semanas,
          };
          return;
        }
        // dia-unico (e a recusa): 4 horários de 15 min num dia útil, de 1 hora à frente (hoje, se couber) ou amanhã.
        const dominio = [
          '0700',
          '0730',
          '0800',
          '0830',
          '0900',
          '0930',
          '1000',
          '1030',
          '1100',
          '1130',
          '1200',
          '1230',
          '1300',
          '1330',
          '1400',
          '1430',
          '1500',
          '1530',
          '1600',
          '1630',
          '1700',
        ];
        const agoraMin = Number(r.hhmm.slice(0, 2)) * 60 + Number(r.hhmm.slice(2)) + 60;
        const hojeUtil =
          ![1, 7].includes(semanaDaDataIso(r.hoje)) &&
          !feriadoNaData(r.hoje, await feriados(e, r.hoje, r.hoje));
        let data = r.hoje;
        let inicio = dominio.find(
          (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(2)) >= agoraMin && Number(h.slice(0, 2)) < 23,
        );
        if (!hojeUtil || !inicio) {
          data = await diaUtil(e, a, somar(r.hoje, 1));
          inicio = '1500';
        }
        const ini = Number(inicio.slice(0, 2)) * 60 + Number(inicio.slice(2));
        const fim = `${String(Math.floor((ini + 60) / 60)).padStart(2, '0')}${String((ini + 60) % 60).padStart(2, '0')}`;
        entrada = entradaGrade(a, data, inicio, fim);
        if (cenario === 'recusa') {
          // Um horário da prévia aparece por fora (gerado antes, pelo executor): a geração recusa.
          const g = entrada as GerarGradeEntrada;
          await executarOutra(e, 'agenda.gerarGrade', {
            ...g,
            horarios: [g.horarios[0]],
            escala: g.escala,
          });
          recusaEsperada = 'previa-desatualizada';
        }
        return;
      }
      case 'agenda.reverterGrade': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const [x] = await e.consultar(
          `SELECT FIRST 1 ID FROM SGH_AGE_GERACAO WHERE ID_REAGENDA = ? ORDER BY ID DESC`,
          [a.id],
          { teto: 1 },
        );
        const geracao = num(x?.['ID']);
        await marcar(e, a, g.de, (g.horarios[1] as { hora: string }).hora, await paciente(e));
        entrada = { geracao };
        if (cenario === 'recusa') {
          await executarOutra(e, 'agenda.reverterGrade', entrada);
          recusaEsperada = 'geracao-revertida';
        }
        return;
      }
      case 'agenda.agendarConsulta': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const pac = await paciente(e);
        const hora = (g.horarios[0] as { hora: string }).hora;
        entrada =
          cenario === 'retorno-particular'
            ? {
                agenda: a.id,
                data: g.de,
                hora,
                paciente: pac,
                convenio: await convenioAceito(e, a, true),
                retorno: true,
                canal: 'presencial',
              }
            : {
                agenda: a.id,
                data: g.de,
                hora,
                paciente: pac,
                convenio: await convenioAceito(e, a),
                retorno: false,
                observacao: OBS_ACENTUADA,
                canal: 'telefone',
              };
        if (cenario === 'recusa') {
          await marcar(e, a, g.de, hora, await paciente(e));
          recusaEsperada = 'horario-ocupado';
        }
        // M50 (etapa 2): pelo portal (canal portal, convênio aceito pela agenda); na colisão, o outro sistema ocupa o
        // horário depois de o portal ler a vaga.
        if (cenario === 'portal-convenio' || cenario === 'portal-colisao')
          entrada = { ...(entrada as Record<string, unknown>), observacao: undefined, canal: 'portal' };
        if (cenario === 'portal-colisao') {
          await legadoOcupaHorario(e, a, g.de, hora, operador);
          recusaEsperada = 'horario-ocupado';
        }
        // M39: o outro sistema ocupa o horário como ele grava (direto na grade), depois da leitura das vagas.
        if (cenario === 'colisao-legado') {
          await legadoOcupaHorario(e, a, g.de, hora, operador);
          recusaEsperada = 'horario-ocupado';
        }
        return;
      }
      case 'agenda.encaixar': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        entrada = {
          agenda: a.id,
          data: g.de,
          hora: cenario === 'recusa' ? '0700' : '0705',
          paciente: await paciente(e),
          convenio: await convenioAceito(e, a),
          retorno: false,
          canal: 'presencial',
          motivo: `${MARCA_M17}: encaixe a pedido do profissional`,
        };
        if (cenario === 'recusa') recusaEsperada = 'minuto-ocupado';
        return;
      }
      case 'agenda.desfazerEncaixe': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const r = await executarOutra(e, 'agenda.encaixar', {
          agenda: a.id,
          data: g.de,
          hora: '0705',
          paciente: await paciente(e),
          convenio: await convenioAceito(e, a),
          retorno: false,
          canal: 'presencial',
          motivo: `${MARCA_M17}: encaixe a desfazer`,
        });
        const marcacao = num(r.resultado['marcacao']);
        entrada = { marcacao, motivo: 'ENCAIXE-DESFEITO' };
        if (cenario === 'recusa-senha') {
          await senhaDeAtendimento(e, marcacao, operador);
          recusaEsperada = 'paciente-com-senha';
        }
        return;
      }
      case 'agenda.cancelarConsulta': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const marcacao = await marcar(
          e,
          a,
          g.de,
          (g.horarios[0] as { hora: string }).hora,
          await paciente(e),
          cenario === 'portal' ? 'portal' : 'telefone',
        );
        entrada = {
          marcacao,
          motivo: cenario === 'portal' ? 'PAC-OUTRA-DATA' : 'PAC-DESISTIU',
          solicitante: 'paciente',
        };
        if (cenario === 'confirmada') await executarOutra(e, 'agenda.confirmarConsulta', { marcacao });
        if (cenario === 'recusa-senha') {
          await senhaDeAtendimento(e, marcacao, operador);
          recusaEsperada = 'paciente-com-senha';
        }
        return;
      }
      case 'agenda.remarcarConsulta': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const pac = await paciente(e);
        const portal = cenario === 'portal';
        const marcacao = await marcar(
          e,
          a,
          g.de,
          (g.horarios[0] as { hora: string }).hora,
          pac,
          portal ? 'portal' : 'telefone',
        );
        const destino = { agenda: a.id, data: g.de, hora: (g.horarios[2] as { hora: string }).hora };
        entrada = {
          marcacao,
          destino,
          modo: cenario === 'sante-api' || portal ? 'liberar' : 'transferir',
          canal: portal ? 'portal' : 'telefone',
          motivo: 'PAC-OUTRA-DATA',
        };
        if (cenario === 'recusa') {
          await marcar(e, a, destino.data, destino.hora, await paciente(e));
          recusaEsperada = 'horario-ocupado';
        }
        return;
      }
      case 'agenda.confirmarConsulta': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const marcacao = await marcar(
          e,
          a,
          g.de,
          (g.horarios[0] as { hora: string }).hora,
          await paciente(e),
        );
        entrada = { marcacao };
        if (cenario === 'recusa') {
          await executarOutra(e, 'agenda.confirmarConsulta', entrada);
          recusaEsperada = 'ja-confirmada';
        }
        return;
      }
      case 'agenda.registrarFalta': {
        if (cenario === 'recusa') {
          const a = await agendaLivre(e);
          const g = await gradeFutura(e, a);
          entrada = {
            marcacao: await marcar(e, a, g.de, (g.horarios[0] as { hora: string }).hora, await paciente(e)),
          };
          recusaEsperada = 'consulta-futura';
          return;
        }
        // Marcação passada da cópia, sem chegada, marcada, num horário normal (só o ID em memória).
        const [m] = await e.consultar(
          `SELECT FIRST 1 d.ID FROM REPACAGD d JOIN REPACAGI i ON i.NOME = d.NOME AND i.CRM = d.CRM AND i.DATA = d.DATA AND i.HORA = d.HORA
            WHERE d.DATA BETWEEN CURRENT_DATE - 120 AND CURRENT_DATE - 1 AND d.ATENDIDO = 'N' AND COALESCE(TRIM(i.SITUACAO), '') = ''
              AND i.TIPOHR = 'N' AND NOT EXISTS (SELECT 1 FROM TBSENHAATEND_REPACAGD s WHERE s.ID_REPACAGD = d.ID)
            ORDER BY d.DATA DESC`,
          [],
          { teto: 1, tempoMaximoMs: 120_000 },
        );
        if (!m) throw new Error('Nenhuma marcação passada sem chegada na cópia.');
        entrada = { marcacao: num(m['ID']) };
        return;
      }
      case 'agenda.bloquearHorarios': {
        const a = await agendaLivre(e);
        const g = await gradeFutura(e, a);
        const horarios = g.horarios.slice(0, 2);
        const base2 = { agenda: a.id, horarios, motivo: 'FERIAS', complemento: `${MARCA_M17}: férias` };
        if (cenario === 'desbloquear') {
          await executarOutra(e, 'agenda.bloquearHorarios', { ...base2, acao: 'bloquear' });
          entrada = { ...base2, acao: 'desbloquear' };
          return;
        }
        entrada = { ...base2, acao: 'bloquear' };
        if (cenario === 'recusa') {
          await marcar(e, a, g.de, (horarios[0] as { hora: string }).hora, await paciente(e));
          recusaEsperada = 'horario-ocupado';
        }
        return;
      }
      case 'agenda.definirCobertura': {
        if (cenario === 'incluir') {
          // Agenda com lista e um convênio ativo fora dela (só os códigos em memória).
          const [x] = await e.consultar(
            `SELECT FIRST 1 a.ID, (SELECT MIN(c.COD) FROM TBCONVEN c WHERE c.SITUACAO = 'A' AND c.COD > 10
                 AND c.COD NOT IN (SELECT r.ID_TBCONVEN FROM REAGENDA_TBCONVEN r WHERE r.ID_REAGENDA = a.ID)) C
               FROM REAGENDA a WHERE a.ATIVA = 'S'
                AND (SELECT COUNT(*) FROM REAGENDA_TBCONVEN r WHERE r.ID_REAGENDA = a.ID) > 1
                AND EXISTS (SELECT 1 FROM TBCONVEN c WHERE c.SITUACAO = 'A' AND c.COD > 10
                 AND c.COD NOT IN (SELECT r.ID_TBCONVEN FROM REAGENDA_TBCONVEN r WHERE r.ID_REAGENDA = a.ID))
              ORDER BY a.ID`,
            [],
            { teto: 1 },
          );
          if (!x) throw new Error('Nenhuma agenda com lista e convênio fora dela.');
          entrada = { agenda: num(x['ID']), convenio: num(x['C']), acao: 'incluir' };
          return;
        }
        // Agenda sem lista: inclui um convênio na preparação; remover a última pede a confirmação.
        const a = await agendaLivre(e, { lista: false, semEscala: false });
        const conv = await convenioAceito(e, a);
        await executarOutra(e, 'agenda.definirCobertura', { agenda: a.id, convenio: conv, acao: 'incluir' });
        entrada = {
          agenda: a.id,
          convenio: conv,
          acao: 'remover',
          confirmarAceitarTodos: cenario !== 'recusa',
        };
        if (cenario === 'recusa') recusaEsperada = 'confirmar-aceitar-todos';
        return;
      }
      case 'agenda.definirEspecialidade': {
        const a = await agendaLivre(e);
        const [s] = await e.consultar(
          `SELECT FIRST 1 COD FROM TBESPEC WHERE COD > 0 AND COD NOT IN (SELECT ID_TBESPEC FROM REAGENDA_TBESPEC WHERE ID_REAGENDA = ?) ORDER BY COD`,
          [a.id],
          { teto: 1 },
        );
        entrada = { agenda: a.id, especialidade: num(s?.['COD']), acao: 'incluir' };
        if (cenario === 'recusa') {
          await executarOutra(e, 'agenda.definirEspecialidade', entrada);
          recusaEsperada = 'ja-ligada';
        }
        return;
      }
      case 'agenda.incluirAgenda': {
        const nomeAgenda = `CLINICA SINTETICA - SGH M17 ${sufixo()}`.slice(0, 40);
        entrada = {
          nome: nomeAgenda,
          duracao: '0015',
          teleatendimento: false,
          observacao: `${MARCA_M17}: agenda de teste`,
        };
        if (cenario === 'recusa-duplicado') {
          await executarOutra(e, 'agenda.incluirAgenda', entrada);
          recusaEsperada = 'nome-existente';
        }
        return;
      }
      case 'agenda.alterarAgenda': {
        const nomeAgenda = `CLINICA SINTETICA - SGH M17 ${sufixo()}`.slice(0, 40);
        const r = await executarOutra(e, 'agenda.incluirAgenda', {
          nome: nomeAgenda,
          duracao: '0015',
          teleatendimento: false,
        });
        const id = num(r.resultado['agenda']);
        entrada = {
          agenda: id,
          lidos: {
            duracao: cenario === 'recusa-colisao' ? '0020' : '0015',
            ativa: 'S',
            teleatendimento: 'N',
          },
          valores: { ativa: 'N' },
        };
        if (cenario === 'recusa-colisao') recusaEsperada = 'conflito-versao';
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução na agenda.`);
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

/** O operador do contexto da reprodução depois da preparação (para o executor da captura). */
export type OperadorDaAgenda = string;
