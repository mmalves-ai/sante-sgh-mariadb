// Agenda de exames e centro cirúrgico sobre a cópia (ficha do M18, seção 10), sempre em transação desfeita e sob a
// trava da cópia: o exame marcado pelo executor com o recado acentuado relido em CP1252, a disputa (duas sessões e o
// escritor legado simulado no mesmo horário), o check-in que recusa o cancelamento, o cancelamento e a remarcação
// relidos pelas leituras novas; a cirurgia na sala com duas sessões disputando a mesma sala (a segunda espera a trava
// e recebe "registro em edição"), o escritor legado ocupando a sala por fora (a gravação relê sob a trava e recusa a
// sobreposição), o par de profissional inválido recusado em português antes do gatilho, a DURACAO 1899-12-30 HH:MM
// em ida e volta e a lacuna do generator depois do ROLLBACK; e as contagens das leituras novas (resíduo, casamento,
// sobreposição) para a evidência. Massa sintética marcada; saída só com contagens e códigos (nenhum nome).
import {
  agendamentosDoPeriodo,
  carregarDominiosVistos,
  ErroOperacao,
  horariosExame,
  lerAgendamento,
  lerMarcacaoExame,
  operacao,
  realizadasDoPeriodo,
  residuoExame,
  salasCirurgicas,
  vagasExame,
} from '@sgh/legado';
import { casar, resumirCasamentos, sobreposicoesNoMapa } from '@sgh/dominio-cirurgia';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agendaExameLivre,
  diaUtilLivreExame,
  entradaGradeExame,
  legadoOcupaHorarioExame,
  MARCA_M18,
  senhaDoExame,
} from '../massa/reproducao-exame.js';
import {
  diaLivreDaSala,
  legadoOcupaSala,
  MARCA_CC_M18,
  profissionais,
} from '../massa/reproducao-cirurgia.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}
async function detalhe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.detail ?? '') : (e as Error).message;
  }
}

describe.skipIf(!PODE_ESCREVER)('agenda de exames e centro cirúrgico na cópia (transação desfeita)', () => {
  let a: Ambiente;
  const tiposLogradouro =
    carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
    new Set<string>();

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      sipacagd: await contar(l, 'SELECT MAX(ID) N FROM SIPACAGD'),
      sicanage: await contar(l, 'SELECT COUNT(*) N FROM SICANAGE'),
      sipacagi: await contar(l, 'SELECT COUNT(*) N FROM SIPACAGI WHERE DATA >= CURRENT_DATE'),
      siagecri: await contar(l, 'SELECT COUNT(*) N FROM SIAGECRI'),
      ccagenda: await contar(l, 'SELECT MAX(ID) N FROM CCAGENDA'),
      cchisage: await contar(l, 'SELECT COUNT(*) N FROM CCHISAGE'),
      exccanc: await contar(l, 'SELECT COUNT(*) N FROM CCAGENDA_EXC_CANC'),
      cccadcir: await contar(l, 'SELECT MAX(ID) N FROM CCCADCIR'),
      salasUsuarios: await contar(l, 'SELECT COUNT(*) N FROM CCSALAS_TBUSERS'),
      extExame: await contar(l, 'SELECT COUNT(*) N FROM SGH_AGE_EXAME_PROCED'),
      estado: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_AGENDA_ESTADO'),
      ligacao: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_LIGACAO'),
    }));

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    return login;
  }
  async function paciente(e: Escritor, usuario: string): Promise<number> {
    const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
    const cep = await cepCompleto(e, tiposLogradouro);
    const r = await a.executor.executar(
      operacao('cadastro.cadastrarPaciente'),
      a.cod,
      pacienteSintetico('com-cep', cpf, cep),
      ctxOperacao(a, usuario),
      { escritor: e },
    );
    return num(r.resultado['idPaciente']);
  }
  const hojeDe = async (e: Escritor) => {
    const [r] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
      teto: 1,
    });
    return String(r?.['H'] ?? '');
  };

  it('exame: grade, marcação com recado CP1252, disputa (duas sessões e o legado), check-in, cancelamento e remarcação', async () => {
    const antes = await retrato();
    let segundaSessao = '';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const ag = await agendaExameLivre(e);
      const dia = await diaUtilLivreExame(e, ag, somar(await hojeDe(e), 7));
      await exec('agenda.gerarGradeExame', entradaGradeExame(ag, [dia]));
      const [p1, p2] = [await paciente(e, usuario), await paciente(e, usuario)];
      const obs = `${MARCA_M18}: preparo, jejum de 8 h — “recado” çãé`;
      const base = {
        agenda: ag.id,
        data: dia,
        convenio: 306,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'telefone',
      };
      const m1 = await exec('agenda.agendarExame', { ...base, hora: '0700', paciente: p1, observacao: obs });
      const id1 = num(m1.resultado['marcacao']);
      const lida = await lerMarcacaoExame(e, id1);
      // Sessão 2 noutra conexão e noutra transação, no mesmo horário: espera a trava da agenda e desiste.
      segundaSessao = await codigo(
        a.executor.executar(
          operacao('agenda.agendarExame'),
          a.cod,
          { ...base, hora: '0700', paciente: p2 },
          ctxOperacao(a, usuario),
          { desfazer: true },
        ),
      );
      const mesmoHorario = await codigo(exec('agenda.agendarExame', { ...base, hora: '0700', paciente: p2 }));
      // O balcão do outro sistema ocupa 07:15 depois de o novo ler as vagas: a gravação relê sob a trava e recusa.
      const vagasLidas = (await vagasExame(e, { agendas: [ag.id], de: dia, ate: dia })).itens.map(
        (v) => v.hora,
      );
      await legadoOcupaHorarioExame(e, ag, dia, '0715');
      const contraLegado = await codigo(exec('agenda.agendarExame', { ...base, hora: '0715', paciente: p2 }));
      const incompleta = (await horariosExame(e, ag.nome, 0, dia, dia)).itens.find((h) => h.hora === '0715');
      // Check-in feito: o cancelamento é recusado; sem ele, cancela e o horário volta a vagar.
      const m2 = await exec('agenda.agendarExame', { ...base, hora: '0730', paciente: p2 });
      await senhaDoExame(e, num(m2.resultado['marcacao']), usuario);
      const comSenha = await codigo(
        exec('agenda.cancelarExame', {
          marcacao: num(m2.resultado['marcacao']),
          motivo: 'PAC-DESISTIU',
          solicitante: 'paciente',
        }),
      );
      const rem = await exec('agenda.remarcarExame', {
        marcacao: id1,
        destino: { agenda: ag.id, data: dia, hora: '0745' },
        modo: 'transferir',
        canal: 'telefone',
      });
      const transferido = (await horariosExame(e, ag.nome, 0, dia, dia)).itens.find((h) => h.hora === '0700');
      await exec('agenda.cancelarExame', {
        marcacao: num(rem.resultado['marcacao']),
        motivo: 'PAC-OUTRA-DATA',
        solicitante: 'paciente',
      });
      const vagasDepois = (await vagasExame(e, { agendas: [ag.id], de: dia, ate: dia })).itens.map(
        (v) => v.hora,
      );
      return {
        recadoIgual: (lida?.contato.observacao ?? '') === obs,
        prontuarioNaMarcacao: (lida?.marcacao.prontuario ?? 0) > 0,
        mesmoHorario,
        vagasLidasTinham0715: vagasLidas.includes('0715'),
        contraLegado,
        incompletaSemMarcacao: incompleta?.paciente !== '' && incompleta?.marcacao === null,
        comSenha,
        transferido: transferido?.situacao,
        vagasDepois: vagasDepois.sort(),
      };
    });
    expect(segundaSessao).toBe('registro-em-edicao');
    expect(r).toEqual({
      recadoIgual: true,
      prontuarioNaMarcacao: true,
      mesmoHorario: 'horario-ocupado',
      vagasLidasTinham0715: true,
      contraLegado: 'horario-ocupado',
      incompletaSemMarcacao: true,
      comSenha: 'paciente-com-senha',
      transferido: 'T',
      vagasDepois: ['0745'],
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] exame: segunda sessão ${segundaSessao}; ${JSON.stringify(r)}`);
  });

  it('cirurgia: duas sessões na mesma sala, o legado ocupando por fora, par inválido, 1899 e a lacuna do generator', async () => {
    const antes = await retrato();
    let segundaSessao = '';
    let idDesfeito = 0;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const SALA = 1;
      await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario, acao: 'incluir' });
      const permitida = (await salasCirurgicas(e, usuario)).find((s) => s.codigo === SALA)?.permitida;
      const dia = await diaLivreDaSala(e, SALA);
      const [cir, an] = await profissionais(e, 2);
      const pac = await paciente(e, usuario);
      const pedido = (hora: string, extra: Record<string, unknown> = {}) => ({
        sala: SALA,
        data: dia,
        hora,
        duracaoMin: 90,
        intervaloMin: 0,
        paciente: pac,
        reg: 0,
        atendimento: 'I',
        especialidade: 33,
        convenio: 306,
        procedimento: 30_101_271,
        anestesia: 1,
        equipe: { cirurgiao: cir, anestesista: an },
        pediatra: null,
        recursos: [],
        procedimentosAdicionais: [],
        carater: 2,
        solicitacao: null,
        excecao: null,
        observacao: `${MARCA_CC_M18}: integração`,
        ...extra,
      });
      const a1 = await exec('cirurgia.agendarCirurgia', pedido('0700'));
      const id1 = num(a1.resultado['agendamento']);
      idDesfeito = id1;
      // Sessão 2, noutra conexão, na mesma sala: a trava da sala (CCSALAS WITH LOCK) está com a sessão 1.
      segundaSessao = await codigo(
        a.executor.executar(
          operacao('cirurgia.agendarCirurgia'),
          a.cod,
          pedido('1300'),
          ctxOperacao(a, usuario),
          {
            desfazer: true,
          },
        ),
      );
      const sobreposta = await codigo(exec('cirurgia.agendarCirurgia', pedido('0800')));
      // O outro sistema grava uma cirurgia das 08:00 direto na tabela (cópia da linha sintética, mesma sala): ela
      // cruza com a das 07:00 (o banco aceita) e o mapa mostra o par; a gravação nova das 09:00 relê e recusa.
      await legadoOcupaSala(e, id1, dia, '0800');
      const contraLegado = await codigo(exec('cirurgia.agendarCirurgia', pedido('0900')));
      const doMapa = (await agendamentosDoPeriodo(e, dia, dia, [SALA])).itens;
      const sobreposicoes = sobreposicoesNoMapa(
        doMapa.map((x) => ({
          id: x.id,
          sala: x.sala,
          inicio: x.inicio,
          duracaoMin: x.duracaoMin,
          intervaloMin: x.intervaloMin,
        })),
      ).length;
      const parInvalido = await detalhe(
        exec(
          'cirurgia.agendarCirurgia',
          pedido('1600', { equipe: { cirurgiao: { id: cir!.id, cod: cir!.cod + 1 } } }),
        ),
      );
      const lido = await lerAgendamento(e, id1);
      const [raw] = await e.consultar('SELECT DURACAO, INTERVALO FROM CCAGENDA WHERE ID = ?', [id1], {
        teto: 1,
      });
      const dur = raw?.['DURACAO'] as Date;
      // Mover para as 13:00 e cancelar pelo caminho auditável (cópia + exclusão).
      await exec('cirurgia.remarcarCirurgia', {
        agendamento: id1,
        sala: SALA,
        data: dia,
        hora: '1300',
        lido: { sala: SALA, data: dia, hora: '0700' },
        justificativa: `${MARCA_CC_M18}: integração`,
        excecao: null,
        preparoMinimoMin: 0,
      });
      const movida = (await lerAgendamento(e, id1))?.inicio;
      await exec('cirurgia.cancelarCirurgia', {
        agendamento: id1,
        motivo: 'PAC-CLINICO',
        solicitante: 'equipe',
        suspender: false,
      });
      const copia = await contar(
        e,
        "SELECT COUNT(*) N FROM CCAGENDA_EXC_CANC WHERE SALA = ? AND DATA_HORA = CAST(CAST(? AS VARCHAR(10)) || ' 13:00:00' AS TIMESTAMP)",
        [SALA, dia],
      );
      const estado = await e.consultar(
        "SELECT ESTADO, MOTIVO FROM SGH_CC_AGENDA_ESTADO WHERE HOSPITAL = ? AND SALA = ? AND DATA_HORA = CAST(CAST(? AS VARCHAR(10)) || ' 13:00:00' AS TIMESTAMP)",
        [a.cod, SALA, dia],
        { teto: 5 },
      );
      return {
        permitida,
        sobreposta,
        contraLegado,
        sobreposicoesNoMapa: sobreposicoes,
        parInvalidoEmPortugues:
          /profissional/i.test(parInvalido) && !/E_GERAL|exception|gdscode/i.test(parInvalido),
        duracao1899:
          dur instanceof Date && dur.getFullYear() === 1899 && dur.getMonth() === 11 && dur.getDate() === 30,
        duracaoMin: lido?.duracaoMin,
        movida: movida?.slice(11),
        copiaNoCancelamento: copia,
        estadoCancelado: estado.map((x) => `${String(x['ESTADO'])}:${String(x['MOTIVO'])}`),
      };
    });
    expect(segundaSessao).toBe('registro-em-edicao');
    expect(r).toEqual({
      permitida: true,
      sobreposta: 'sala-ocupada',
      contraLegado: 'sala-ocupada',
      sobreposicoesNoMapa: 1,
      parInvalidoEmPortugues: true,
      duracao1899: true,
      duracaoMin: 90,
      movida: '13:00',
      copiaNoCancelamento: 1,
      estadoCancelado: ['cancelado:PAC-CLINICO'],
    });
    const depois = await retrato();
    expect(depois).toEqual(antes);
    // Lacuna do generator: o ID usado na transação desfeita é maior que a maior chave que ficou (aceita, D-GEN-18).
    expect(idDesfeito).toBeGreaterThan(num(depois.ccagenda));
    console.log(
      `[${a.cod}] cirurgia: segunda sessão ${segundaSessao}; ${JSON.stringify(r)}; lacuna do generator: sim`,
    );
  });

  it('leituras novas na cópia: resíduo, casamento das realizadas e sobreposições (só contagens)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [m] = await l.consultar(
        'SELECT CAST(MAX(DATA) AS VARCHAR(10)) D FROM SIPACAGI WHERE DATA <= CURRENT_DATE',
        [],
        { teto: 1 },
      );
      const ate = String(m?.['D'] ?? '');
      const res = await residuoExame(l, somar(ate, -91), ate);
      const [c] = await l.consultar(
        'SELECT CAST(MAX(DATA) AS VARCHAR(10)) D FROM CCCADCIR WHERE DATA <= CURRENT_DATE',
        [],
        { teto: 1 },
      );
      const fimCir = String(c?.['D'] ?? '');
      const real = await realizadasDoPeriodo(l, { de: somar(fimCir, -30), ate: fimCir });
      const { agendamentosDosRegs } = await import('@sgh/legado');
      const ags = await agendamentosDosRegs(
        l,
        real.itens.map((x) => x.reg),
      );
      const casamentos = resumirCasamentos(
        real.itens.map((x) => casar({ id: x.id, reg: x.reg, sala: x.sala, dia: x.data }, ags)),
      );
      const ano = await agendamentosDoPeriodo(l, '2026-01-01', '2026-12-31');
      const sobre = sobreposicoesNoMapa(
        ano.itens
          .filter((x) => x.inicio)
          .map((x) => ({
            id: x.id,
            sala: x.sala,
            inicio: x.inicio,
            duracaoMin: x.duracaoMin,
            intervaloMin: x.intervaloMin,
          })),
      );
      return {
        residuo: {
          confirmadosSemPaciente: res.porAgenda.reduce((s, x) => s + x.confirmadosSemPaciente, 0),
          ocupadosSemMarcacao: res.porAgenda.reduce((s, x) => s + x.ocupadosSemMarcacao, 0),
        },
        realizadas: real.itens.length,
        casamentos,
        agendamentos2026: ano.itens.length,
        paresSobrepostos2026: sobre.length,
        cirurgiasSobrepostas2026: new Set(sobre.flatMap((p) => [p.a, p.b])).size,
      };
    });
    expect(r.realizadas).toBe(
      r.casamentos.exato +
        r.casamentos.regEDia +
        r.casamentos.soReg +
        r.casamentos.ambiguo +
        r.casamentos.nenhum,
    );
    // Contagens da cópia (dados reais): entre 1 e 4 saem como "<5" (nunca o número pequeno no log).
    console.log(
      `[${a.cod}] leituras M18: ${JSON.stringify(r, (_k, v: unknown) => (typeof v === 'number' && v > 0 && v < 5 ? '<5' : v))}`,
    );
  });
});
