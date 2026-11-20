// Regra 3 do M24: copiar nunca sem confirmação; item suspenso na origem depois da abertura não é copiado (aviso);
// item cuja regra de alerta mudou é reavaliado.
import { describe, expect, it } from 'vitest';
import { classeDoItemCopiado, revisarCopia } from './copia.js';

describe('cópia', () => {
  const tela = [
    { id: 1, ativo: true, versoesRegras: { alergia: 1 } },
    { id: 2, ativo: true, versoesRegras: { alergia: 1 } },
    { id: 3, ativo: true, versoesRegras: {} },
  ];
  it('só os confirmados; suspenso depois da abertura não vai; regra nova reavalia', () => {
    const relidos = [tela[0]!, { ...tela[1]!, ativo: false }, tela[2]!];
    const r = revisarCopia([1, 2, 3, 3], tela, relidos, { alergia: 2 });
    expect(r.copiar).toEqual([1, 3]);
    expect(r.mudaramNaOrigem).toEqual([2]);
    expect(r.reavaliar).toEqual([1, 3]);
  });
  it('item que sumiu da origem ou não visto na tela não é copiado', () => {
    expect(revisarCopia([1, 9], tela, [], {}).mudaramNaOrigem).toEqual([1, 9]);
  });
  it('nenhum confirmado, nada copiado', () => {
    expect(revisarCopia([], tela, tela, {})).toEqual({ copiar: [], mudaramNaOrigem: [], reavaliar: [] });
  });
  it('classe da coluna do item copiado', () => {
    expect(classeDoItemCopiado(false, 'ID_PRFREQUENCIA')).toBe('copia:PRLANGERAL.ID_PRFREQUENCIA');
    expect(classeDoItemCopiado(true, 'ID_PRFREQUENCIA')).toBe('entrada');
  });
});
