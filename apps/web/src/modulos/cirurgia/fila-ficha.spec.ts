// A ficha anestésica sem rede (M46, etapa 1): a fila é do dono, na ordem do ato, sem repetir a chave; na volta da rede
// vai na ordem com a MESMA chave; a falha de rede para e mantém o resto; o ato recusado pelo servidor sai com o erro.
import { describe, expect, it } from 'vitest';
import { apagarCofreLocal } from '../enfermagem/cofre-local.js';
import { type AtoDaFicha, enviarFilaFicha, guardarAtoFicha, lerFilaFicha } from './fila-ficha.js';

const DONO = { rede: 'sint', estabelecimento: 'aa', login: 'SINT.ANESTESISTA' };
const OUTRO = { ...DONO, login: 'SINT.ANESTESISTA2' };
const ato = (chave: string): AtoDaFicha => ({
  chave,
  agenda: 701,
  url: '/701/ficha/lancamentos',
  corpo: {
    agendamento: 701,
    lancamentos: [{ parte: 'sinal', momento: '2026-10-21T08:05', tipo: 'fc', valor: 80 }],
  },
  rotulo: 'Sinais 08:05',
});
const SEM_REDE = new TypeError('Failed to fetch');
const semRede = (e: unknown) => e instanceof TypeError;

describe('fila da ficha anestésica (sem rede)', () => {
  it('guarda na ordem, sem repetir a chave, só para o dono', async () => {
    await apagarCofreLocal();
    await guardarAtoFicha(DONO, ato('ficha-00000001'), 12);
    await guardarAtoFicha(DONO, ato('ficha-00000002'), 12);
    await guardarAtoFicha(DONO, ato('ficha-00000001'), 12);
    expect((await lerFilaFicha(DONO, 12)).map((a) => a.chave)).toEqual(['ficha-00000001', 'ficha-00000002']);
    expect(await lerFilaFicha(OUTRO, 12)).toEqual([]);
  });

  it('envia na ordem com a mesma chave; a falha de rede para; o recusado sai; vazia apaga', async () => {
    await apagarCofreLocal();
    for (const k of ['ficha-00000001', 'ficha-00000002', 'ficha-00000003'])
      await guardarAtoFicha(DONO, ato(k), 12);
    const enviados: string[] = [];
    const r1 = await enviarFilaFicha(
      DONO,
      12,
      async (a) => {
        enviados.push(a.chave);
        if (a.chave === 'ficha-00000002') throw new Error('recusado');
        if (a.chave === 'ficha-00000003') throw SEM_REDE;
      },
      semRede,
    );
    expect(enviados).toEqual(['ficha-00000001', 'ficha-00000002', 'ficha-00000003']);
    expect(r1.resultados.map((x) => x.ok)).toEqual([true, false]);
    expect(r1.resto.map((a) => a.chave)).toEqual(['ficha-00000003']);
    const r2 = await enviarFilaFicha(DONO, 12, async () => undefined, semRede);
    expect(r2.resto).toEqual([]);
    expect(await lerFilaFicha(DONO, 12)).toEqual([]);
  });
});
