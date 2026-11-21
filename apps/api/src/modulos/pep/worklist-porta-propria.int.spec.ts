// Integração da porta própria da fila do médico contra o MariaDB real (cliente de teste f22_o4, onda 4 da F2.2). Massa
// SINTÉTICA do lote (prefixo l0402p; worklist-massa.spec-util.ts), montada no beforeAll e apagada no afterAll.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataHora } from './registro-porta-propria.js';
import { CLIENTE_F22_O4, limparMassaWorklist, type MassaWorklist, montarMassaWorklist } from './worklist-massa.spec-util.js';
import { PortaWorklistPropria } from './worklist-porta-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0402p';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const ctx = (hospital: string, estabelecimento: number | null = null) => ({
  cliente: CLIENTE_F22_O4,
  estabelecimento,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital,
});

describe.skipIf(SEM_BANCO)('PortaWorklistPropria contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaWorklistPropria;
  let m: MassaWorklist;
  let desde: Date;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22_O4)).banco).toBe(`cliente_${CLIENTE_F22_O4}`);
    m = await montarMassaWorklist(nucleo, P, 904_020_000);
    porta = new PortaWorklistPropria(nucleo, CLIENTE_F22_O4);
    desde = new Date(`${dataHora(new Date(m.agora.getTime() - 2 * 24 * HORA), FUSO)!.slice(0, 10)}T00:00:00Z`);
  }, 120_000);
  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `limpeza-${P}` }, (e) => limparMassaWorklist(e, P));
      await nucleo.encerrar();
    }
  });

  it('previsão de alta: só a internação do estabelecimento, não excluída e com previsão', async () => {
    const r = await porta.leituras(ctx(P), {
      login: 'medico',
      pacientes: [],
      internacoes: [m.int.a, m.int.b, m.int.x, m.int.semPrevisao, m.int.a],
      desde,
    });
    expect(r.previsoesAlta).toEqual([{ internacao: m.int.a, previsao: '2026-12-01' }]);
    expect(r.resultados).toEqual([]);
  });

  it('resultados: liberados na janela, do estabelecimento da sessão e não excluídos; data no fuso do estabelecimento', async () => {
    const r = await porta.leituras(ctx(P, m.estA), {
      login: 'medico',
      pacientes: [m.pac1, m.pac2, m.pac1],
      internacoes: [],
      desde,
    });
    const ids = r.resultados.map((x) => x.exame).sort((a, b) => a - b);
    expect(ids).toEqual([m.res.novo, m.res.pac2].sort((a, b) => a - b));
    const novo = r.resultados.find((x) => x.exame === m.res.novo)!;
    expect(novo).toEqual({
      paciente: m.pac1,
      exame: m.res.novo,
      liberadoEm: dataHora(new Date(m.agora.getTime() - HORA), FUSO)!.slice(0, 10),
      vistoPeloMedico: false,
    });
    // O outro estabelecimento só vê o resultado dele.
    const b = await porta.leituras(ctx(`${P}b`), { login: 'medico', pacientes: [m.pac1], internacoes: [], desde });
    expect(b.resultados.map((x) => x.exame)).toEqual([m.res.outroEst]);
  });

  it('prescrição a renovar: a médica vigente que vence em 6 h sem a seguinte; as demais ficam de fora', async () => {
    const agora = dataHora(m.agora, FUSO)!;
    const ate = dataHora(new Date(m.agora.getTime() + 6 * HORA), FUSO)!;
    const r = await porta.aRenovar(ctx(P), m.atd, agora, ate);
    expect(r).toEqual([{ atendimento: m.atd[0], fim: dataHora(m.fimARenovar, FUSO) }]);
    // A janela maior inclui a de 10 h (atendimento 3); a do outro estabelecimento, a excluída e a de enfermagem, nunca.
    const ate12 = dataHora(new Date(m.agora.getTime() + 12 * HORA), FUSO)!;
    const r12 = await porta.aRenovar(ctx(P), m.atd, agora, ate12);
    expect(r12.map((x) => x.atendimento)).toEqual([m.atd[0], m.atd[2]]);
    expect(await porta.aRenovar(ctx(P), [], agora, ate)).toEqual([]);
  });

  it('recusa: estabelecimento inexistente (404) e hora fora do formato (422)', async () => {
    await expect(
      porta.leituras(ctx('l0402zz'), { login: 'x', pacientes: [m.pac1], internacoes: [], desde }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    const e = await porta.aRenovar(ctx(P), [m.atd[0]], 'ontem', 'amanhã').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroOperacao);
    expect(e).toMatchObject({ problema: { status: 422 } });
  });
});
