// Critério MON$ do k6: só o processo medido (api-k6, worker-k6) reprova; os outros processos do novo na cópia
// compartilhada ficam à parte, como informação.
import { describe, expect, it } from 'vitest';
import { conexaoDoK6, monVazio, reprovasMon, somarAmostra } from './k6-mon.ts';

const cx = (marca: string, maisLonga: number, escrita = 0) => ({
  anexo: 1,
  marca,
  transacoes: 1,
  transacoesEscrita: escrita,
  transacaoMaisLongaMs: maisLonga,
});

describe('critério MON$ do k6', () => {
  it('reconhece as conexões do processo medido pela marca', () => {
    expect(conexaoDoK6('sgh:rede:pc:api-k6')).toBe(true);
    expect(conexaoDoK6('sgh:rede:pc:worker-k6')).toBe(true);
    expect(conexaoDoK6('sgh:rede:pc:api')).toBe(false);
    expect(conexaoDoK6('sgh:rede:pc:worker')).toBe(false);
    expect(conexaoDoK6('sgh:rede:pc:teste-vigia')).toBe(false);
  });

  it('transação longa e escrita de outro processo do novo não reprovam; as do processo medido sim', () => {
    const m = monVazio();
    somarAmostra(
      m,
      { conexoesDoNovo: [cx('sgh:r:pc:api-k6', 40), cx('sgh:r:pc:api', 28_188, 1)], alertas: [] },
      5_000,
    );
    expect(reprovasMon(m, 5_000)).toEqual([]);
    expect(m).toMatchObject({ outrosMaisLongaMs: 28_188, outrosEscritaMax: 1, outrosAcimaDoLimite: 1 });
    expect(m.maisLongaProcesso).toBe('api-k6');
    somarAmostra(m, { conexoesDoNovo: [cx('sgh:r:pc:worker-k6', 6_000, 1)], alertas: [] }, 5_000);
    expect(m.maisLongaProcesso).toBe('worker-k6');
    expect(reprovasMon(m, 5_000)).toEqual([
      '1 transação(ões) de escrita do processo medido',
      'transação do processo medido acima de 5000 ms (6000 ms)',
    ]);
  });

  it('sem amostra ou sem conexão do processo medido: reprova (não se mediu nada)', () => {
    expect(reprovasMon(monVazio(), 5_000)).toEqual(['coletor MON$ sem amostra durante o k6']);
    const m = monVazio();
    somarAmostra(m, { conexoesDoNovo: [cx('sgh:r:pc:api', 10)], alertas: [] }, 5_000);
    expect(reprovasMon(m, 5_000)[0]).toMatch(/nenhuma conexão do processo medido/);
  });
});
