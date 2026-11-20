// Regra 6 (ficha do M21): o agrupamento do motivo de alta (óbito 40-46, 52-54, 65-67; transferência externa 31;
// domiciliar 10, 29, 32; evasão ou a pedido 14, 16; encerramento administrativo 51; demais = alta domiciliar) e o
// destino codificado da alta médica que corresponde a cada grupo (a coerência é conferida na saída).
import { describe, expect, it } from 'vitest';
import { destinoDoGrupo, grupoMotivoAlta, motivoCoerente } from './adt.js';

describe('motivo de alta', () => {
  it('os grupos do Anexo A §A.3', () => {
    for (const c of [40, 41, 46, 52, 54, 65, 67]) expect(grupoMotivoAlta(c)).toBe('obito');
    expect(grupoMotivoAlta(31)).toBe('transferencia-externa');
    for (const c of [10, 29, 32]) expect(grupoMotivoAlta(c)).toBe('internacao-domiciliar');
    for (const c of [14, 16]) expect(grupoMotivoAlta(c)).toBe('evasao-ou-a-pedido');
    expect(grupoMotivoAlta(51)).toBe('encerramento-administrativo');
    for (const c of [12, 21, 47, 55]) expect(grupoMotivoAlta(c)).toBe('alta-domiciliar');
  });

  it('o destino de cada grupo e a coerência do motivo com o destino escolhido', () => {
    expect(destinoDoGrupo('obito')).toBe('obito');
    expect(destinoDoGrupo('transferencia-externa')).toBe('transferenciaExterna');
    expect(destinoDoGrupo('internacao-domiciliar')).toBe('internacaoDomiciliar');
    expect(destinoDoGrupo('evasao-ou-a-pedido')).toBe('aPedido');
    expect(destinoDoGrupo('encerramento-administrativo')).toBe('administrativo');
    expect(destinoDoGrupo('alta-domiciliar')).toBe('domicilio');
    expect(motivoCoerente(12, 'domicilio')).toBe(true);
    expect(motivoCoerente(41, 'obito')).toBe(true);
    expect(motivoCoerente(41, 'domicilio')).toBe(false);
  });
});
