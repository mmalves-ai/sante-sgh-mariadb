// Regra 10 (ficha do M29; DP-47.5 (b)): a farmácia ambulatorial com SNGPC é construída e fica desligada; com a chave
// desligada, nenhuma escrita (a recusa vem antes da transação; a porta em memória e a API provam que nada foi gravado).
import { describe, expect, it } from 'vitest';
import {
  conferirChaveSngpc,
  conferirDispensacaoAmbulatorial,
  montarEnvioSngpc,
} from '@sgh/contratos/regras-suprimentos';

describe('SNGPC desligado (regra 10)', () => {
  it('chave desligada: recusa com o que falta; ligada: segue', () => {
    const r = conferirChaveSngpc(false);
    expect(r?.codigo).toBe('farmacia-ambulatorial-desligada');
    expect(r?.mensagem).toMatch(/CNAE de farmácia.*SNGPC/);
    expect(conferirChaveSngpc(true)).toBeNull();
  });
  it('dispensação ambulatorial: quantidade, lote; controlado com receita válida (30 dias)', () => {
    const b = {
      portaria: null,
      receitaNumero: null,
      receitaData: null,
      hoje: '2026-10-23',
      lote: 'L1',
      quantidade: 1,
    };
    expect(conferirDispensacaoAmbulatorial(b)).toBeNull();
    expect(conferirDispensacaoAmbulatorial({ ...b, quantidade: 0 })?.codigo).toBe('quantidade-invalida');
    expect(conferirDispensacaoAmbulatorial({ ...b, lote: ' ' })?.codigo).toBe('sem-lote');
    const c = { ...b, portaria: 'B1' };
    expect(conferirDispensacaoAmbulatorial(c)?.codigo).toBe('sem-receita');
    expect(conferirDispensacaoAmbulatorial({ ...c, receitaNumero: 'RJ123' })?.codigo).toBe('receita-data');
    expect(
      conferirDispensacaoAmbulatorial({ ...c, receitaNumero: 'RJ123', receitaData: '2026-10-24' })?.codigo,
    ).toBe('receita-data');
    expect(
      conferirDispensacaoAmbulatorial({ ...c, receitaNumero: 'RJ123', receitaData: '2026-09-20' })?.codigo,
    ).toBe('receita-vencida');
    expect(
      conferirDispensacaoAmbulatorial({ ...c, receitaNumero: 'RJ123', receitaData: '2026-10-01' }),
    ).toBeNull();
  });
  it('lote de envio: as não escrituradas, somadas por item e lote', () => {
    const e = montarEnvioSngpc([
      { id: 1, item: 7, lote: 'L1', quantidade: 1, escriturada: false },
      { id: 2, item: 7, lote: 'L1', quantidade: 2.5, escriturada: false },
      { id: 3, item: 7, lote: 'L2', quantidade: 1, escriturada: false },
      { id: 4, item: 8, lote: 'L1', quantidade: 1, escriturada: true },
    ]);
    expect(e.dispensacoes).toEqual([1, 2, 3]);
    expect(e.porItemLote).toEqual([
      { item: 7, lote: 'L1', quantidade: 3.5 },
      { item: 7, lote: 'L2', quantidade: 1 },
    ]);
  });
});
