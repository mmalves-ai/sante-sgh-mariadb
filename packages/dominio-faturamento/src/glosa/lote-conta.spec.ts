// Montagem do lote, conta a conta (ficha do M31, seção 5): só contas emitidas, fechadas, fora de outro lote, do
// convênio do lote e do tipo de conta que o tipo de guia aceita (D-TIPOGUIA-31).
import { describe, expect, it } from 'vitest';
import {
  conferirContaParaLote,
  type ContaParaLote,
  destinoEnvio,
  tipoGuiaCompativel,
} from '@sgh/contratos/regras-faturamento';

const c = (x: Partial<ContaParaLote> = {}): ContaParaLote => ({
  id: 1,
  convenio: 301,
  tipoConta: 'E',
  fechada: 'S',
  indEmi: 'T',
  lotes: 0,
  ano: 2026,
  mes: 9,
  ...x,
});

describe('conta para o lote', () => {
  it('aceita a conta emitida, fechada e fora de lote', () => {
    expect(conferirContaParaLote(c(), { convenio: 301, tipoGuia: 2 })).toBeNull();
  });
  it.each([
    [{ convenio: 305 }, 'outro-convenio'],
    [{ indEmi: 'F' }, 'conta-nao-emitida'],
    [{ fechada: 'A' }, 'conta-em-lote'],
    [{ lotes: 1 }, 'conta-em-lote'],
    [{ fechada: 'N' }, 'conta-aberta'],
    [{ tipoConta: 'I' }, 'tipo-guia-incompativel'],
  ])('%j → %s', (x, codigo) => {
    expect(conferirContaParaLote(c(x), { convenio: 301, tipoGuia: 2 })?.codigo).toBe(codigo);
  });
  it('tipo de guia × tipo de conta', () => {
    expect(tipoGuiaCompativel(1, 'E')).toBe(true);
    expect(tipoGuiaCompativel(3, 'I')).toBe(true);
    expect(tipoGuiaCompativel(3, 'E')).toBe(false);
    expect(tipoGuiaCompativel(4, 'I')).toBe(true);
    expect(tipoGuiaCompativel(4, 'X')).toBe(false);
    expect(tipoGuiaCompativel(9, 'E')).toBe(false);
  });
  it('regra 13: o envio fora de produção vai ao simulador', () => {
    expect(destinoEnvio('dev')).toBe('simulador');
    expect(destinoEnvio('homologacao')).toBe('simulador');
    expect(destinoEnvio('producao')).toBe('operadora');
  });
});
