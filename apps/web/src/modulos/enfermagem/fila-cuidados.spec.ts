// A checagem dos cuidados sem rede (M45, etapa 4; regra 8 do M25 no aparelho): a fila é do dono, na ordem do ato, sem
// repetir a chave; na volta da rede vai na ordem com a MESMA chave; a falha de rede para e mantém o resto; o ato
// recusado pelo servidor sai da fila com o erro.
import { describe, expect, it } from 'vitest';
import { apagarCofreLocal } from './cofre-local.js';
import { type CuidadoNaFila, enviarFilaCuidados, guardarCuidado, lerFilaCuidados } from './fila-cuidados.js';

const DONO = { rede: 'sint', estabelecimento: 'aa', login: 'SINT.TECNICO.ENF' };
const OUTRO = { ...DONO, login: 'SINT.ENF.PLANTAO' };
const ato = (chave: string): CuidadoNaFila => ({
  chave,
  atendimento: 25_103,
  atividade: 7,
  previsto: '2026-10-22T12:00',
  feita: true,
  motivo: null,
  horaReal: '2026-10-22T12:05',
  rotulo: 'Mudar o decúbito',
});
const SEM_REDE = new TypeError('Failed to fetch');
const semRede = (e: unknown) => e instanceof TypeError;

describe('fila dos cuidados (sem rede)', () => {
  it('guarda na ordem, sem repetir a chave, só para o dono', async () => {
    await apagarCofreLocal();
    await guardarCuidado(DONO, ato('cuidado-00000001'), 12);
    await guardarCuidado(DONO, ato('cuidado-00000002'), 12);
    await guardarCuidado(DONO, ato('cuidado-00000001'), 12);
    expect((await lerFilaCuidados(DONO, 12)).map((a) => a.chave)).toEqual([
      'cuidado-00000001',
      'cuidado-00000002',
    ]);
    expect(await lerFilaCuidados(OUTRO, 12)).toEqual([]);
  });

  it('envia na ordem com a mesma chave; a falha de rede para e mantém o resto; o recusado sai', async () => {
    await apagarCofreLocal();
    for (const k of ['cuidado-00000001', 'cuidado-00000002', 'cuidado-00000003'])
      await guardarCuidado(DONO, ato(k), 12);
    const enviados: string[] = [];
    const r1 = await enviarFilaCuidados(
      DONO,
      12,
      async (a) => {
        if (a.chave === 'cuidado-00000002') throw SEM_REDE;
        enviados.push(a.chave);
      },
      semRede,
    );
    expect(enviados).toEqual(['cuidado-00000001']);
    expect(r1.resto.map((a) => a.chave)).toEqual(['cuidado-00000002', 'cuidado-00000003']);
    const recusa = new Error('ja-checado');
    const r2 = await enviarFilaCuidados(
      DONO,
      12,
      async (a) => {
        if (a.chave === 'cuidado-00000002') throw recusa;
        enviados.push(a.chave);
      },
      semRede,
    );
    expect(r2.resultados).toEqual([
      { chave: 'cuidado-00000002', ok: false, erro: recusa },
      { chave: 'cuidado-00000003', ok: true },
    ]);
    expect(r2.resto).toEqual([]);
    expect(await lerFilaCuidados(DONO, 12)).toEqual([]);
  });
});
