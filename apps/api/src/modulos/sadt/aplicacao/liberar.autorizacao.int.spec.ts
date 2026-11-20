// Quem libera e quem lauda sobre a cópia (ficha do M26, regra 8), em transação desfeita: a liberação do resultado de
// laboratório só pelo responsável técnico habilitado (biomédico, farmacêutico-bioquímico, patologista clínico): o médico
// de outra especialidade é recusado; o vínculo é o da sessão (o de outro login, recusado). Só contagens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteSadt, ambienteSadt, MassaSadt, PODE_ESCREVER } from './copia.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('habilitação da liberação na cópia (transação desfeita)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('o médico clínico não libera; o vínculo de outro login não vale; o responsável técnico libera', async () => {
    await a.nucleo.desfazendoNaCopia(
      { rede: a.nucleo.rede, hospital: a.cod, traceId: 'int-m26-liberar' },
      async (e) => {
        const m = new MassaSadt(a, e);
        const resp = await m.profissional(['2212', '2234', '225335']);
        const clinico = await m.profissional(['2251', '2252'], resp.login);
        const ex = await m.lancar('E', resp);
        await m.digitar(ex.id, resp, 4.2);
        await expect(
          m.executar(
            'sadt.liberarExame',
            { exames: [await m.lido(ex.id)], responsavel: clinico.vinculo },
            clinico.login,
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'sem-habilitacao' } });
        await expect(
          m.executar(
            'sadt.liberarExame',
            { exames: [await m.lido(ex.id)], responsavel: resp.vinculo },
            clinico.login,
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'vinculo-de-outro' } });
        await m.liberar(ex.id, resp);
        expect((await m.porta.exame(m.c, ex.id))?.estado).toBe('liberado');
      },
    );
  });
});
