// Sobreposição: no estabelecimento (qualquer vínculo e tipo) e, pela regra 7, na Rede (só os intervalos; sem a escala
// alheia). Outro estabelecimento sem resposta: o plantão entra com o alerta (D-REDE-52).
import { describe, expect, it } from 'vitest';
import { conferirSobreposicaoLocal, conferirSobreposicaoRede } from './sobreposicao.js';

const novo = { inicio: '2026-11-02T19:00', fim: '2026-11-03T07:00' };

describe('sobreposição', () => {
  it('local: recusa o plantão que cruza outro da mesma pessoa; encostar passa', () => {
    expect(
      conferirSobreposicaoLocal(novo, [{ inicio: '2026-11-02T07:00', fim: '2026-11-02T19:00' }]).ok,
    ).toBe(true);
    expect(
      conferirSobreposicaoLocal(novo, [{ inicio: '2026-11-03T06:00', fim: '2026-11-03T12:00' }]),
    ).toMatchObject({
      ok: false,
      codigo: 'sobreposicao',
    });
  });

  it('Rede (regra 7): recusa sem dizer setor nem escala do outro estabelecimento', () => {
    const r = conferirSobreposicaoRede(novo, {
      intervalos: [{ inicio: '2026-11-02T22:00', fim: '2026-11-03T04:00' }],
      semResposta: 0,
    });
    expect(r).toMatchObject({ ok: false, codigo: 'sobreposicao-rede' });
    expect(r.ok ? '' : r.mensagem).toBe(
      'O colaborador já tem plantão neste horário em outro estabelecimento da Rede.',
    );
  });

  it('Rede: sem conflito passa; sem resposta de algum, passa com o alerta', () => {
    expect(conferirSobreposicaoRede(novo, { intervalos: [], semResposta: 0 })).toEqual({ ok: true });
    expect(conferirSobreposicaoRede(novo, { intervalos: [], semResposta: 1 })).toEqual({
      ok: true,
      alerta: 'rede-nao-conferida',
    });
  });
});
