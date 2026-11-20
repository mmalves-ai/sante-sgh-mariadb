// Agenda de consultas sobre a cópia (ficha do M17, seção 10), sempre em transação desfeita e sob a trava da cópia:
// a grade futura gerada pelo executor numa agenda ativa; a marcação com o recado acentuado relido em CP1252; a
// disputa do mesmo horário (o segundo recebe "ocupado"); o emoji recusado antes do banco; a senha de atendimento
// ligada recusa o cancelamento; o encaixe com o minuto tomado; a remarcação e o cancelamento; o LOCK TIMEOUT com a
// agenda travada por outra conexão (registro em edição); o ROLLBACK devolve as maiores chaves e as contagens.
// Massa sintética marcada; saída só com contagens e códigos (nenhum nome, telefone ou documento).
import { esquemaAgendarConsulta } from '@sgh/contratos';
import {
  buscarVagas,
  carregarDominiosVistos,
  contagensIndicadores,
  ErroOperacao,
  lerMarcacao,
  operacao,
  teleconsultaDaMarcacao,
  teleconsultaPorId,
} from '@sgh/legado';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agendaLivre,
  convenioAceito,
  diaUtil,
  entradaGrade,
  legadoOcupaHorario,
  MARCA_M17,
  relogio,
  senhaDeAtendimento,
} from '../massa/reproducao-agenda.js';
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
  raiz,
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

describe.skipIf(!PODE_ESCREVER)('agenda de consultas na cópia (transação desfeita)', () => {
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

  /** Retrato agregado das tabelas da agenda (maior chave e contagens; nenhum dado de linha). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      repacagd: await contar(l, 'SELECT MAX(ID) N FROM REPACAGD'),
      recanage: await contar(l, 'SELECT MAX(PROTOCOLO) N FROM RECANAGE'),
      reagecri: await contar(l, 'SELECT COUNT(*) N FROM REAGECRI'),
      rectrage: await contar(l, 'SELECT COUNT(*) N FROM RECTRAGE'),
      repacagi: await contar(l, 'SELECT COUNT(*) N FROM REPACAGI WHERE DATA >= CURRENT_DATE'),
      ext: await contar(l, 'SELECT COUNT(*) N FROM SGH_AGE_MARCACAO_EXT'),
      cancel: await contar(l, 'SELECT COUNT(*) N FROM SGH_AGE_CANCELAMENTO'),
      geracao: await contar(l, 'SELECT COUNT(*) N FROM SGH_AGE_GERACAO'),
      tele: await contar(l, 'SELECT COUNT(*) N FROM SGH_ATD_TELECONSULTA'),
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

  it('grade, marcação com recado CP1252, disputa, emoji, senha ligada, encaixe, remarcação e cancelamento', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const ag = await agendaLivre(e);
      const hoje = (await relogio(e)).hoje;
      const dia = await diaUtil(e, ag, somar(hoje, 7));
      const g = entradaGrade(ag, dia);
      await exec('agenda.gerarGrade', g);
      const pac = await paciente(e, usuario);
      const outro = await paciente(e, usuario);
      const conv = await convenioAceito(e, ag);
      const obs = `${MARCA_M17}: ação, informação — “recado” çãé`;
      const base = {
        agenda: ag.id,
        data: dia,
        hora: '0700',
        paciente: pac,
        convenio: conv,
        retorno: false,
        canal: 'telefone',
      };
      const m = await exec('agenda.agendarConsulta', { ...base, observacao: obs });
      const id = num(m.resultado['marcacao']);
      const lida = await lerMarcacao(e, id);
      const disputa = await codigo(exec('agenda.agendarConsulta', { ...base, paciente: outro }));
      const emoji = esquemaAgendarConsulta.safeParse({
        ...base,
        hora: '0715',
        observacao: 'recado 😀',
      }).success;
      const enc = await codigo(
        exec('agenda.encaixar', { ...base, paciente: outro, motivo: 'Encaixe no minuto tomado' }),
      );
      const encaixe = await exec('agenda.encaixar', {
        ...base,
        hora: '0707',
        paciente: outro,
        motivo: 'Encaixe SINTETICO',
      });
      await senhaDeAtendimento(e, id, usuario);
      const comSenha = await codigo(
        exec('agenda.cancelarConsulta', { marcacao: id, motivo: 'PAC-DESISTIU', solicitante: 'paciente' }),
      );
      const desfeito = await exec('agenda.desfazerEncaixe', { marcacao: num(encaixe.resultado['marcacao']) });
      const m2 = await exec('agenda.agendarConsulta', { ...base, hora: '0730', paciente: outro });
      const rem = await exec('agenda.remarcarConsulta', {
        marcacao: num(m2.resultado['marcacao']),
        destino: { agenda: ag.id, data: dia, hora: '0745' },
        modo: 'liberar',
        canal: 'telefone',
      });
      const can = await exec('agenda.cancelarConsulta', {
        marcacao: num(rem.resultado['marcacao']),
        motivo: 'PAC-OUTRA-DATA',
        solicitante: 'paciente',
      });
      return {
        recadoIgual: (lida?.contato.observacao ?? '') === obs,
        disputa,
        emojiAceito: emoji,
        encaixeTomado: enc,
        comSenha,
        desfeito: num(desfeito.resultado['protocolo']) > 0,
        cancelado: num(can.resultado['protocolo']) > 0,
        vagosDepois: await contar(
          e,
          "SELECT COUNT(*) N FROM REPACAGI WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE) AND (PACIENTE IS NULL OR PACIENTE = '')",
          [ag.nome, dia],
        ),
      };
    });
    expect(r).toEqual({
      recadoIgual: true,
      disputa: 'horario-ocupado',
      emojiAceito: false,
      encaixeTomado: 'minuto-ocupado',
      comSenha: 'paciente-com-senha',
      desfeito: true,
      cancelado: true,
      vagosDepois: 3,
    });
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[${a.cod}] agenda: ${JSON.stringify(r)}; retrato igual depois do ROLLBACK: ${JSON.stringify(depois) === JSON.stringify(antes)}`,
    );
  });

  it('M50.4: a teleconsulta nasce, muda e é cancelada na transação da marcação (portal e central)', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const ag = await agendaLivre(e);
      const hoje = (await relogio(e)).hoje;
      const dia = await diaUtil(e, ag, somar(hoje, 7));
      await exec('agenda.gerarGrade', entradaGrade(ag, dia));
      const pac = await paciente(e, usuario);
      const conv = await convenioAceito(e, ag);
      const base = {
        agenda: ag.id,
        data: dia,
        hora: '0700',
        paciente: pac,
        convenio: conv,
        retorno: false,
        canal: 'portal',
        teleconsulta: { conta: 2_000_070_999 },
      };
      // Pela central (outro canal) a teleconsulta é recusada e nada fica.
      const centralComTele = await codigo(exec('agenda.agendarConsulta', { ...base, canal: 'telefone' }));
      const m = await exec('agenda.agendarConsulta', base);
      const marcacao = num(m.resultado['marcacao']);
      const nasceu = await teleconsultaDaMarcacao(e, a.cod, marcacao);
      // A central remarca: a teleconsulta vai junto (agendada de novo, na marcação nova).
      const rem = await exec('agenda.remarcarConsulta', {
        marcacao,
        destino: { agenda: ag.id, data: dia, hora: '0745' },
        modo: 'liberar',
        canal: 'telefone',
      });
      const nova = num(rem.resultado['marcacao']);
      const movida = nasceu ? await teleconsultaPorId(e, a.cod, nasceu.id) : null;
      // A central cancela: a teleconsulta é cancelada na mesma transação.
      await exec('agenda.cancelarConsulta', {
        marcacao: nova,
        motivo: 'PAC-DESISTIU',
        solicitante: 'paciente',
      });
      const cancelada = nasceu ? await teleconsultaPorId(e, a.cod, nasceu.id) : null;
      return {
        centralComTele,
        nasceu: [nasceu?.situacao, nasceu?.conta, nasceu?.marcacaoVigente],
        movida: [movida?.situacao, movida?.marcacao === nova, movida?.hora, movida?.marcacaoVigente],
        cancelada: [cancelada?.situacao, cancelada?.marcacaoVigente],
      };
    });
    expect(r).toEqual({
      centralComTele: 'canal',
      nasceu: ['agendada', 2_000_070_999, true],
      movida: ['agendada', true, '0745', true],
      cancelada: ['cancelada', false],
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] teleconsulta na transação da agenda: ${JSON.stringify(r)}`);
  });

  it('disputa: duas sessões do novo e o escritor legado simulado no mesmo horário, sem dupla marcação', async () => {
    const antes = await retrato();
    let segundaSessao = '';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const ag = await agendaLivre(e);
      const hoje = (await relogio(e)).hoje;
      const dia = await diaUtil(e, ag, somar(hoje, 7));
      await exec('agenda.gerarGrade', entradaGrade(ag, dia));
      const conv = await convenioAceito(e, ag);
      const [p1, p2] = [await paciente(e, usuario), await paciente(e, usuario)];
      const base = { agenda: ag.id, data: dia, retorno: false, canal: 'telefone', convenio: conv };
      // Sessão 1 marca 07:00 e segura a agenda (a trava do executor) até o fim da transação; a sessão 2, noutra
      // conexão e noutra transação, tenta o mesmo horário: espera a trava e recebe "registro em edição".
      const m1 = await exec('agenda.agendarConsulta', { ...base, hora: '0700', paciente: p1 });
      segundaSessao = await codigo(
        a.executor.executar(
          operacao('agenda.agendarConsulta'),
          a.cod,
          { ...base, hora: '0700', paciente: p2 },
          ctxOperacao(a, usuario),
          { desfazer: true },
        ),
      );
      // O escritor legado simulado ocupa 07:15 depois de o novo ler as vagas: a gravação relê sob a trava e recusa.
      const vagasLidas = (await buscarVagas(e, { agendas: [ag.id], de: dia, ate: dia })).itens.map(
        (v) => v.hora,
      );
      await legadoOcupaHorario(e, ag, dia, '0715', usuario);
      const contraLegado = await codigo(
        exec('agenda.agendarConsulta', { ...base, hora: '0715', paciente: p2 }),
      );
      const marcacoes = await contar(
        e,
        'SELECT COUNT(*) N FROM REPACAGD WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE)',
        [ag.nome, dia],
      );
      // O horário confirmado e depois cancelado volta a ser vaga (relido pela busca de vagas).
      await exec('agenda.confirmarConsulta', { marcacao: num(m1.resultado['marcacao']) });
      await exec('agenda.cancelarConsulta', {
        marcacao: num(m1.resultado['marcacao']),
        motivo: 'PAC-DESISTIU',
        solicitante: 'paciente',
      });
      const m2 = await exec('agenda.agendarConsulta', { ...base, hora: '0730', paciente: p1 });
      await exec('agenda.confirmarConsulta', { marcacao: num(m2.resultado['marcacao']) });
      await exec('agenda.remarcarConsulta', {
        marcacao: num(m2.resultado['marcacao']),
        destino: { agenda: ag.id, data: dia, hora: '0745' },
        modo: 'liberar',
        canal: 'telefone',
      });
      const vagasDepois = (await buscarVagas(e, { agendas: [ag.id], de: dia, ate: dia })).itens.map(
        (v) => v.hora,
      );
      return {
        vagasLidasTinham0715: vagasLidas.includes('0715'),
        contraLegado,
        marcacoesNoDia: marcacoes,
        vagasDepois: vagasDepois.sort(),
      };
    });
    expect(segundaSessao).toBe('registro-em-edicao');
    expect(r).toEqual({
      vagasLidasTinham0715: true,
      contraLegado: 'horario-ocupado',
      marcacoesNoDia: 1,
      vagasDepois: ['0700', '0730'],
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] disputa: segunda sessão ${segundaSessao}; ${JSON.stringify(r)}`);
  });

  it('LOCK TIMEOUT: agenda travada por outra conexão → registro em edição, nada gravado', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar("SELECT FIRST 1 ID FROM REAGENDA WHERE ATIVA = 'S' ORDER BY ID", [], {
        teto: 1,
      });
      return num(x?.['ID']);
    });
    const antes = await retrato();
    let resultado = '';
    await a.nucleo.desfazendoNaCopia(ctx(a), async (trava) => {
      await trava.consultar('SELECT ID FROM REAGENDA WHERE ID = ? WITH LOCK', [alvo], { teto: 1 });
      resultado = await codigo(
        a.executor.executar(
          operacao('agenda.encaixar'),
          a.cod,
          {
            agenda: alvo,
            data: '2027-01-04',
            hora: '0707',
            paciente: 1,
            convenio: 10,
            retorno: false,
            canal: 'telefone',
            motivo: 'Encaixe SINTETICO travado',
          },
          ctxOperacao(a, 'SGH.M17'),
          { desfazer: true },
        ),
      );
    });
    expect(resultado).toBe('registro-em-edicao');
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] agenda travada: ${resultado}`);
  });

  // Ficha, seção 10: os indicadores iguais aos de gestao-agenda.js (sante-api) no mesmo período na mesma cópia.
  // Só leitura; o código da sante-api é lido do repositório vizinho e rodado num contexto isolado, com as duas
  // dependências dele trocadas por dublês (pct e o parse do nome, que estes agrupamentos não usam): nada da
  // configuração nem do ambiente da sante-api é carregado. Sem o repositório, o caso é pulado.
  const GESTAO = ['../sante-api', '../../sante-api']
    .map((d) => resolve(raiz, d, 'src/services/gestao-agenda.js'))
    .find((f) => existsSync(f));
  it.skipIf(!GESTAO)('indicadores iguais aos de gestao-agenda.js no mesmo período', async () => {
    const modulo = { exports: {} as unknown };
    const dubles: Record<string, unknown> = {
      './gestao-comum': { pct: (p: number, t: number) => (t ? Math.round((p / t) * 1000) / 10 : 0) },
      '../utils/sgh': {
        parseAgendaNome: (n: string) => ({ procedimento: n.split('-')[0]?.trim() ?? n }),
        somarDias: (d: string) => d,
      },
    };
    runInNewContext(readFileSync(GESTAO as string, 'utf8'), {
      module: modulo,
      exports: modulo.exports,
      require: (m: string) => {
        if (!(m in dubles)) throw new Error(`dependência não prevista: ${m}`);
        return dubles[m];
      },
    });
    const gestao = modulo.exports as {
      funil(db: unknown, f: { de: string; ate: string }): Promise<Record<string, number>>;
      ocupacao(db: unknown, f: Record<string, unknown>): Promise<{ slots: number; ocupados: number }>;
      absenteismo(
        db: unknown,
        f: Record<string, unknown>,
      ): Promise<{
        marcados: number;
        compareceu: number;
        linhas: { chave: string; marcados: number; compareceu: number }[];
      }>;
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const db = {
        query: async (sql: string, p: readonly unknown[] = []) =>
          (
            await l.consultar(sql.replace(/\?/g, 'CAST(CAST(? AS VARCHAR(10)) AS DATE)'), p, { teto: 5_000 })
          ).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k.toLowerCase(), v]))),
      };
      const [m] = await l.consultar(
        'SELECT CAST(MAX(DATA) AS VARCHAR(10)) D FROM REPACAGD WHERE DATA <= CURRENT_DATE',
        [],
        { teto: 1 },
      );
      const ate = String(m?.['D'] ?? '');
      const de = somar(ate, -29);
      const nosso = await contagensIndicadores(l, de, ate);
      const fun = await gestao.funil(db, { de, ate });
      const oc = await gestao.ocupacao(db, { de, ate, agrupadoPor: 'agenda', limite: 1_000 });
      const ab = await gestao.absenteismo(db, { de, ate, agrupadoPor: 'antecedencia', limite: 1_000 });
      const somaOcup = nosso.ocupacao.reduce((s2, x) => ({ h: s2.h + x.horarios, o: s2.o + x.ocupados }), {
        h: 0,
        o: 0,
      });
      const faixa: Record<string, string> = {
        'mesmo dia': 'mesmo-dia',
        'ate 7 dias': 'ate-7',
        'de 8 a 30 dias': 'de-8-a-30',
        'mais de 30 dias': 'mais-de-30',
        'nao informada': 'nao-informada',
      };
      const delesAnt = Object.fromEntries(
        ab.linhas.map((x) => [faixa[x.chave] ?? x.chave, { marcados: x.marcados, compareceu: x.compareceu }]),
      );
      const nossoAnt = Object.fromEntries(
        nosso.porAntecedencia.map((x) => [x.chave, { marcados: x.marcados, compareceu: x.compareceu }]),
      );
      return {
        periodo: { de, ate },
        funil: {
          nosso: {
            horarios: nosso.funil.horarios,
            livres: nosso.funil.livres,
            marcados: nosso.funil.marcados,
            compareceu: nosso.funil.compareceu,
            cancelados: nosso.funil.cancelados,
          },
          deles: {
            horarios: fun['slotsOfertados'],
            livres: fun['nuncaPreenchidos'],
            marcados: fun['marcados'],
            compareceu: fun['compareceu'],
            cancelados: fun['cancelados'],
          },
        },
        ocupacao: { nosso: somaOcup, deles: { h: oc.slots, o: oc.ocupados } },
        antecedencia: { nosso: nossoAnt, deles: delesAnt },
      };
    });
    console.log(`[${a.cod}] indicadores x gestao-agenda.js: ${JSON.stringify(r)}`);
    expect(r.funil.nosso).toEqual(r.funil.deles);
    expect(r.ocupacao.nosso).toEqual(r.ocupacao.deles);
    expect(r.antecedencia.nosso).toEqual(r.antecedencia.deles);
  });
});
