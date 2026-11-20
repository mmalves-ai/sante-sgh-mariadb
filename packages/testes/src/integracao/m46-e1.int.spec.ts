// Etapa 1 do M46 sobre a cópia (ficha, seções 4, 6, 10 e 11), sempre em transação desfeita e sob a trava:
//   - os domínios da ficha lidos da cópia (tipo de anestesia, posição, modo respiratório, função na equipe com a de
//     anestesista achada pelo nome) e o tempo da leitura do contexto da APA em agendamentos recentes (só contagens e
//     tempos; nenhum nome sai daqui);
//   - a seção 10: a cirurgia agendada pelo executor, a APA, a ficha anestésica (marcos, sinais, fármaco, gás, fluido) e a
//     SRPA gravadas em SGH_; o cancelamento pelo caminho do outro sistema (a cópia e a exclusão da CCAGENDA pela
//     receita compatível) PASSA, e os registros SGH_ ficam com a chave natural (sala, data e hora) — a prova da regra
//     12 (nenhuma PRFA_* tocada, a FK restritiva delas teria recusado);
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import {
  abrirFichaSgh,
  apasDoAgendamento,
  contextoAnestesia,
  dominiosFicha,
  ErroOperacao,
  escritasDaTransacao,
  fichaDoAgendamento,
  funcaoAnestesista,
  gravarLigacaoCirurgia,
  lancarFichaSgh,
  lerAgendamento,
  operacao,
  registrarApaSgh,
  registrarSrpaSgh,
  srpaDoAgendamento,
  subirVersaoFichaSgh,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { carregarDominiosVistos } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diaLivreDaSala, MARCA_CC_M18, profissionais } from '../massa/reproducao-cirurgia.js';
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
const USUARIO = 'SGH.TESTE.M46';

describe.skipIf(!PODE_ESCREVER)('M46 etapa 1 na cópia (transação desfeita)', () => {
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
      apa: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_APA'),
      fichas: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_FA'),
      sinais: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_FA_MONITORIZ'),
      srpa: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_SRPA'),
      ccagenda: await contar(l, 'SELECT MAX(ID) N FROM CCAGENDA'),
      exccanc: await contar(l, 'SELECT COUNT(*) N FROM CCAGENDA_EXC_CANC'),
    }));

  it('os domínios da ficha e o tempo do contexto da APA em agendamentos recentes (só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const t0 = Date.now();
      const d = await dominiosFicha(l);
      const msDominios = Date.now() - t0;
      const ids = (
        await l.consultar(
          'SELECT FIRST 20 ID FROM CCAGENDA WHERE DATA_HORA >= ? ORDER BY DATA_HORA DESC',
          [new Date(2025, 0, 1)],
          { teto: 20 },
        )
      ).map((x) => num(x['ID']));
      const tempos: number[] = [];
      let comPaciente = 0;
      for (const id of ids) {
        const t = Date.now();
        const c = await contextoAnestesia(l, id);
        tempos.push(Date.now() - t);
        if (c?.paciente !== null) comPaciente++;
      }
      tempos.sort((x, y) => x - y);
      const p95 = tempos[Math.max(0, Math.ceil(tempos.length * 0.95) - 1)] ?? 0;
      return {
        tipos: d.tiposAnestesia.length,
        posicoes: d.posicoes.length,
        modos: d.modosRespiratorios.length,
        funcoes: d.funcoesEquipe.length,
        anestesista: funcaoAnestesista(d) !== null,
        msDominios,
        amostra: ids.length,
        comPaciente,
        p95,
      };
    });
    console.log(`[${a.cod}] M46.1 leituras: ${JSON.stringify(r)}`);
    expect(r.tipos).toBeGreaterThan(0);
    expect(r.posicoes).toBeGreaterThan(0);
    expect(r.modos).toBeGreaterThan(0);
    expect(r.anestesista).toBe(true);
    // Seção 4: dados para a APA e a ficha, teto 50 e p95 < 1 s (meta a propor, Fase 5, regra 8).
    expect(r.p95).toBeLessThan(1000);
  });

  it('seção 10: APA, ficha e SRPA em SGH_; o cancelamento pelo caminho do outro sistema passa e a chave natural fica', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      const SALA = 1;
      await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario: login, acao: 'incluir' });
      const dia = await diaLivreDaSala(e, SALA);
      const [cir, an] = await profissionais(e, 2);
      const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep))).resultado[
          'idPaciente'
        ],
      );
      const ag = await exec('cirurgia.agendarCirurgia', {
        sala: SALA,
        data: dia,
        hora: '0700',
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
        observacao: `${MARCA_CC_M18}: integração M46`,
      });
      const id = num(ag.resultado['agendamento']);
      const lido = await lerAgendamento(e, id);
      const contexto = await contextoAnestesia(e, id);
      const base = {
        hospital: a.cod,
        agendamento: id,
        sala: SALA,
        dataHora: `${dia}T07:00`,
        reg: 0,
        paciente: contexto?.paciente ?? null,
      };
      const apa = await registrarApaSgh(e, {
        ...base,
        versaoVista: 0,
        avaliadoEm: `${dia}T06:00`,
        profissional: an!.id,
        asa: 2,
        emergencia: false,
        pesoKg: 70,
        alturaCm: 170,
        viaAerea: { mallampati: 2 },
        jejum: {},
        criteriosLee: [],
        leePontos: 0,
        alergiasConferidas: true,
        comorbidades: 'Comorbidade SINTÉTICA ç ã',
        medicacoes: null,
        exames: null,
        anestesiasAnteriores: null,
        plano: { tipoAnestesia: 1 },
        tipoAnestesia: 1,
        conclusao: 'apto',
        ressalvas: null,
        pendencias: ['apa', 'asa', 'jejum'],
        usuario: USUARIO,
        chave: `int-m46-apa-${Date.now()}`,
      });
      const f = await abrirFichaSgh(e, {
        ...base,
        abertura: an!.id,
        abertaEm: `${dia}T07:00`,
        usuario: USUARIO,
        chave: null,
      });
      const v = await subirVersaoFichaSgh(e, {
        ficha: f.id,
        versaoVista: f.versao,
        usuario: USUARIO,
        marco: { marco: 'entradaSala', momento: `${dia}T07:00` },
      });
      await subirVersaoFichaSgh(e, {
        ficha: f.id,
        versaoVista: v,
        usuario: USUARIO,
        marco: { marco: 'inicioAnestesia', momento: `${dia}T07:05` },
      });
      await lancarFichaSgh(e, {
        hospital: a.cod,
        ficha: f.id,
        profissional: an!.id,
        usuario: USUARIO,
        chave: null,
        lancamentos: [
          { parte: 'sinal', momento: `${dia}T07:05`, tipo: 'pas', valor: 120 },
          { parte: 'sinal', momento: `${dia}T07:05`, tipo: 'fc', valor: 80 },
          { parte: 'gas', momento: `${dia}T07:05`, fim: null, gas: 'o2', valor: 2 },
          {
            parte: 'fluido',
            momento: `${dia}T07:06`,
            fim: null,
            fluido: 'cristaloide',
            item: null,
            volumeMl: 500,
            observacao: null,
            balanco: null,
          },
        ],
      });
      // A versão vista antiga recusa (concorrência otimista).
      let mudou = '';
      try {
        await subirVersaoFichaSgh(e, { ficha: f.id, versaoVista: 1, usuario: USUARIO });
      } catch (x) {
        mudou = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      await registrarSrpaSgh(e, {
        ...base,
        cirurgia: null,
        momento: 'admissao',
        em: `${dia}T09:00`,
        aldrete: { atividade: 2, respiracao: 2, circulacao: 2, consciencia: 1, saturacao: 2 },
        dor: 2,
        nvpo: 0,
        pas: null,
        pad: null,
        fc: null,
        spo2: null,
        temperatura: null,
        observacao: null,
        destino: null,
        motivoDestino: null,
        regraVersao: null,
        ultimaVista: 0,
        profissional: null,
        usuario: USUARIO,
        chave: null,
      });
      const fichaLida = await fichaDoAgendamento(e, a.cod, id);
      // O cancelamento pelo caminho do outro sistema (a cópia e a exclusão da CCAGENDA, como o Delphi faz).
      let cancelamento = 'passou';
      try {
        await exec('cirurgia.cancelarCirurgia', {
          agendamento: id,
          motivo: 'PAC-CLINICO',
          solicitante: 'equipe',
          suspender: false,
        });
      } catch (x) {
        cancelamento =
          x instanceof ErroOperacao ? (x.problema.codigo ?? 'recusa') : (x as Error).message.slice(0, 80);
      }
      const existe = await contar(e, 'SELECT COUNT(*) N FROM CCAGENDA WHERE ID = ?', [id]);
      const [apaDepois] = await apasDoAgendamento(e, a.cod, id);
      const fichaDepois = await fichaDoAgendamento(e, a.cod, id);
      const srpaDepois = await srpaDoAgendamento(e, a.cod, id);
      const chaveNatural = await contar(
        e,
        `SELECT COUNT(*) N FROM SGH_CC_FA WHERE HOSPITAL = ? AND SALA = ? AND DATA_HORA = CAST(CAST(? AS VARCHAR(10)) || ' 07:00:00' AS TIMESTAMP)`,
        [a.cod, SALA, dia],
      );
      const escritas = await escritasDaTransacao(e);
      return {
        agendadoNaHora: lido?.inicio.slice(11) === '07:00',
        apaVersao: apa.versao,
        fichaLancamentos: fichaLida?.lancamentos.length,
        fichaMarcos: Object.keys(fichaLida?.marcos ?? {}).sort(),
        versaoAntiga: mudou,
        cancelamento,
        agendaApagada: existe === 0,
        apaFica: apaDepois?.agendamento === id,
        fichaFica: fichaDepois?.id === f.id,
        srpaFica: srpaDepois.length,
        chaveNatural,
        prfaTocada: escritas.some((w) => w.tabela.startsWith('PRFA_')),
        sghCirurgia: [
          ...new Set(escritas.filter((w) => w.tabela.startsWith('SGH_CC_')).map((w) => w.tabela)),
        ].sort(),
      };
    });
    console.log(`[${a.cod}] M46.1 seção 10: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({
      agendadoNaHora: true,
      apaVersao: 1,
      fichaLancamentos: 4,
      fichaMarcos: ['entradaSala', 'inicioAnestesia'],
      versaoAntiga: 'ficha-mudou',
      cancelamento: 'passou',
      agendaApagada: true,
      apaFica: true,
      fichaFica: true,
      srpaFica: 1,
      chaveNatural: 1,
      prfaTocada: false,
    });
    expect(r.sghCirurgia).toEqual(
      expect.arrayContaining([
        'SGH_CC_APA',
        'SGH_CC_FA',
        'SGH_CC_FA_CAD_GAS',
        'SGH_CC_FA_GANHO',
        'SGH_CC_FA_MONITORIZ',
        'SGH_CC_SRPA',
      ]),
    );
    expect(await retrato()).toEqual(antes);
  });

  it('revisão: a SRPA com o ato registrado fica ligada à cirurgia realizada; a v2 "inapto" reabre as pendências', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = (await loginLivre(e, (Date.now() + 31) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      const SALA = 1;
      await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario: login, acao: 'incluir' });
      const dia = await diaLivreDaSala(e, SALA);
      const [cir, an] = await profissionais(e, 2);
      const cpf = await cpfLivre(e, (Date.now() + 104_729) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep))).resultado[
          'idPaciente'
        ],
      );
      const ag = await exec('cirurgia.agendarCirurgia', {
        sala: SALA,
        data: dia,
        hora: '0700',
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
        observacao: `${MARCA_CC_M18}: integração M46 (revisão)`,
      });
      const id = num(ag.resultado['agendamento']);
      const contexto = await contextoAnestesia(e, id);
      const base = {
        hospital: a.cod,
        agendamento: id,
        sala: SALA,
        dataHora: `${dia}T07:00`,
        reg: 0,
        paciente: contexto?.paciente ?? null,
      };
      const apaBase = {
        ...base,
        avaliadoEm: `${dia}T06:00`,
        profissional: an!.id,
        asa: 2,
        emergencia: false,
        pesoKg: 70,
        alturaCm: 170,
        viaAerea: { mallampati: 2 },
        jejum: {},
        criteriosLee: [],
        leePontos: 0,
        alergiasConferidas: true,
        comorbidades: null,
        medicacoes: null,
        exames: null,
        anestesiasAnteriores: null,
        plano: { tipoAnestesia: 1 },
        tipoAnestesia: 1,
        ressalvas: null,
        usuario: USUARIO,
      };
      // A v1 "apto" fecha APA, ASA e jejum; a v2 "inapto" as devolve a pendente na mesma transação.
      await registrarApaSgh(e, {
        ...apaBase,
        versaoVista: 0,
        conclusao: 'apto',
        pendencias: ['apa', 'asa', 'jejum'],
        chave: `int-m46-rev-v1-${Date.now()}`,
      });
      const situacoes = () =>
        e
          .consultar(
            `SELECT p.TIPO, p.SITUACAO FROM SGH_CC_PENDENCIA p WHERE p.HOSPITAL = ? AND p.ID_CCAGENDA = ?
               AND p.TIPO IN ('apa', 'asa', 'jejum') ORDER BY p.TIPO`,
            [a.cod, id],
            { teto: 10 },
          )
          .then((l) => l.map((x) => `${String(x['TIPO']).trim()}:${String(x['SITUACAO']).trim()}`));
      const depoisV1 = await situacoes();
      await registrarApaSgh(e, {
        ...apaBase,
        versaoVista: 1,
        conclusao: 'inapto',
        pendencias: [],
        pendenciasAbertas: ['apa', 'asa', 'jejum'],
        chave: `int-m46-rev-v2-${Date.now()}`,
      });
      const depoisV2 = await situacoes();
      // O ato registrado: a ligação do novo com uma cirurgia realizada livre da cópia (só o ID).
      const [livre] = await e.consultar(
        `SELECT FIRST 1 c.ID FROM CCCADCIR c
          WHERE NOT EXISTS (SELECT 1 FROM SGH_CC_LIGACAO l WHERE l.HOSPITAL = ? AND l.ID_CCCADCIR = c.ID)
          ORDER BY c.ID DESC`,
        [a.cod],
        { teto: 1 },
      );
      const realizada = num(livre?.['ID']);
      await gravarLigacaoCirurgia(e, {
        hospital: a.cod,
        idCccadcir: realizada,
        idCcagenda: id,
        reg: 0,
        sala: SALA,
        data: dia,
        preinternacao: null,
        origem: 'registro',
        usuario: USUARIO,
      });
      const srpa = await registrarSrpaSgh(e, {
        ...base,
        cirurgia: null,
        momento: 'admissao',
        em: `${dia}T09:00`,
        aldrete: { atividade: 2, respiracao: 2, circulacao: 2, consciencia: 1, saturacao: 2 },
        dor: 2,
        nvpo: 0,
        pas: null,
        pad: null,
        fc: null,
        spo2: null,
        temperatura: null,
        observacao: null,
        destino: null,
        motivoDestino: null,
        regraVersao: null,
        ultimaVista: 0,
        profissional: null,
        usuario: USUARIO,
        chave: null,
      });
      const ligada = await contar(e, 'SELECT ID_CCCADCIR N FROM SGH_CC_SRPA WHERE ID = ?', [srpa.id]);
      return { depoisV1, depoisV2, srpaComOAto: realizada > 0 && ligada === realizada };
    });
    console.log(`[${a.cod}] M46.1 revisão: ${JSON.stringify(r)}`);
    expect(r).toEqual({
      depoisV1: ['apa:ok', 'asa:ok', 'jejum:ok'],
      depoisV2: ['apa:pendente', 'asa:pendente', 'jejum:pendente'],
      srpaComOAto: true,
    });
    expect(await retrato()).toEqual(antes);
  });
});
