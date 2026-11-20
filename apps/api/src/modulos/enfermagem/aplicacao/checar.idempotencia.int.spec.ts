// Regra 9 do M25 (ficha, seção 8; cap-09 §9.6): a mesma Idempotency-Key reenviada devolve o resultado original sem nova
// gravação; a mesma chave com outro pedido é recusada. Pela HTTP, com a porta em memória (dados sintéticos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
} from '../enfermagem.spec-util.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

describe('regra 9: idempotência da checagem', () => {
  it('a mesma chave duas vezes: um ato só, a segunda resposta "repetida"; outra entrada com a chave: 422', async () => {
    const s = await a.entrar('SINT.TECNICO.ENF');
    const t = await horariosDaUti(a, s);
    const h = t.horarios.find((x) => x.descricao.startsWith('DIPIRONA') && x.estado === 'pendente')!;
    const chave = 'ato-tablet-0001-idempotencia';
    const r1 = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25001, 25201), chave);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().repetida).toBe(false);
    const r2 = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25001, 25201), chave);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().repetida).toBe(true);
    const d = (await a.get(s, `/enfermagem/horarios/${h.id}`)).json();
    expect(d.atos).toHaveLength(1);
    const outra = await a.post(
      s,
      `/enfermagem/horarios/${h.id}/checar`,
      checagemPadrao(25001, 25201, { quantidade: 0.5 }),
      chave,
    );
    expect(outra.statusCode).toBe(422);
  });
  it('na sincronização, cada ato com a chave dele: reenviar o lote não grava de novo', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const h = t.horarios.find(
      (x) => x.descricao.startsWith('OMEPRAZOL') || x.descricao.startsWith('CURATIVO'),
    )!;
    const lote = {
      dispositivo: 'tablet-teste',
      atos: [
        {
          tipo: 'checagem',
          chave: 'ato-offline-curativo-01',
          horario: h.id,
          checagem: { ...checagemPadrao(25001, 25201), horaReal: '2026-10-22T12:50' },
        },
        {
          tipo: 'sinal',
          chave: 'ato-offline-sinal-01',
          paciente: 25001,
          sinal: { tipo: 'fc', valor: 77, horaReal: '2026-10-22T12:51' },
        },
      ],
    };
    const r1 = (await a.post(s, '/enfermagem/sincronizar', lote)).json();
    expect(r1.resultados.map((x: { ok: boolean }) => x.ok)).toEqual([true, true]);
    const r2 = (await a.post(s, '/enfermagem/sincronizar', lote)).json();
    expect(r2.resultados[0]).toMatchObject({ ok: true, codigo: 'repetido' });
  });
});
