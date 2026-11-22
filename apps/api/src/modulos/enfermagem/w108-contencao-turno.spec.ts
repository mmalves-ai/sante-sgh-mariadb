// W1-08 (mercado: contenção mecânica): a ordem gera no aprazamento do turno da enfermagem as checagens de perfusão e
// pele, a tela da contenção agrupa os horários por turno, e a ordem vencida sem renovação aparece no alerta do turno, na
// tela e no indicador (numerador e denominador impressos). Porta em memória.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTEXTO_SINTETICO, criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { VigiaContencao } from './contencao-servico.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-25 08:00 em São Paulo. */
let relogio = Date.parse('2026-10-25T11:00:00Z');
const agora = () => new Date(relogio);
const avancar = (min: number) => {
  relogio += min * 60_000;
};

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria({ agora });
  const escores = new PortaEscoresMemoria({ agora });
  const app: NestFastifyApplication = await criarAppComEnfermagem(env, {
    trilha,
    enfermagem,
    escores,
    vigiaEnfermagem: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
    vigia: new VigiaContencao(escores, enfermagem, [CONTEXTO_SINTETICO]),
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': `teste-w108-cont-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;
let a: Montado;
beforeAll(async () => {
  a = await montar();
});
afterAll(async () => {
  await a.app.close();
});

const DOIS = { paciente: 25002, atendimento: 25102 };
const ORDEM = {
  motivo: 'riscoDispositivo',
  justificativa: 'Tentou retirar o tubo orotraqueal duas vezes',
  tipo: 'leito',
  membros: ['msd', 'mse'],
  prazoHoras: 2,
  intervaloMinutos: 60,
};

interface NoTurno {
  ordem: number;
  atendimento: number;
  previsto: string;
  estado: string;
  achados: string[];
  ordemVencida: boolean;
}

describe('W1-08: contenção no aprazamento do turno', () => {
  it('a ordem gera as checagens de perfusão e pele no turno; vencida sem renovação alerta no turno, na tela e no indicador', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(enf, '/enfermagem/contencao', { ...DOIS, ...ORDEM });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;

    // O turno diurno da unidade (07:00–19:00) traz os dois horários da ordem, com perfusão e pele.
    let turno = await a.get(enf, '/enfermagem/turno?unidade=UTI');
    expect(turno.statusCode).toBe(200);
    let doTurno = (turno.json().contencoes as NoTurno[]).filter((x) => x.ordem === id);
    expect(doTurno.map((x) => [x.previsto, x.estado, x.ordemVencida])).toEqual([
      ['2026-10-25T09:00', 'pendente', false],
      ['2026-10-25T10:00', 'pendente', false],
    ]);
    for (const x of doTurno) expect(x.achados).toEqual(['perfusao', 'pele']);
    expect(doTurno[0]!.atendimento).toBe(DOIS.atendimento);

    // A tela da contenção agrupa os horários por turno.
    let tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    let pac = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === DOIS.atendimento);
    expect(pac.ordem.turnos).toEqual([
      {
        turno: 'diurno',
        inicio: '2026-10-25T07:00',
        fim: '2026-10-25T19:00',
        previstas: 2,
        feitas: 0,
        atrasadas: 0,
        pendentes: 2,
        canceladas: 0,
        achados: ['perfusao', 'pele'],
        horarios: ['2026-10-25T09:00', '2026-10-25T10:00'],
      },
    ]);

    // Três horas depois, sem renovação nem retirada: vencida no turno (alerta em cada horário), na tela e no indicador.
    avancar(180);
    turno = await a.get(enf, '/enfermagem/turno?unidade=UTI');
    doTurno = (turno.json().contencoes as NoTurno[]).filter((x) => x.ordem === id);
    expect(doTurno.map((x) => [x.estado, x.ordemVencida])).toEqual([
      ['atrasada', true],
      ['atrasada', true],
    ]);
    tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    pac = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === DOIS.atendimento);
    expect(pac.ordem.situacao).toBe('vencida');
    expect(tela.vencidas).toBeGreaterThanOrEqual(1);
    const ind = await a.get(enf, '/enfermagem/contencao/indicador?unidade=UTI&de=2026-10-25&ate=2026-10-25');
    expect(ind.statusCode).toBe(200);
    expect(ind.json().vencidasSemRenovacao).toEqual({
      numerador: 1,
      denominador: 1,
      percentual: 100,
      emAberto: 1,
    });
    expect(ind.json().impressao).toContain(
      'Vencidas sem renovação nem retirada no prazo: 1 / 1 = 100% (1 ainda sem retirada)',
    );

    // A retirada (tardia) tira o alerta aberto, mas a ordem segue contada como vencida sem renovação no indicador.
    const ret = await a.post(enf, `/enfermagem/contencao/${id}/retirar`, {
      motivo: 'Paciente calmo, colaborativo e sem risco ao tubo',
    });
    expect(ret.statusCode).toBe(200);
    turno = await a.get(enf, '/enfermagem/turno?unidade=UTI');
    doTurno = (turno.json().contencoes as NoTurno[]).filter((x) => x.ordem === id);
    expect(doTurno.every((x) => !x.ordemVencida)).toBe(true);
    const ind2 = (
      await a.get(enf, '/enfermagem/contencao/indicador?unidade=UTI&de=2026-10-25&ate=2026-10-25')
    ).json();
    expect(ind2.vencidasSemRenovacao).toMatchObject({ numerador: 1, denominador: 1, emAberto: 0 });
  });
});
