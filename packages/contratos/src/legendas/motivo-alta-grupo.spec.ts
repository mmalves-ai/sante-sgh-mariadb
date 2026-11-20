// Regra 13 do M14: motivo de alta com o grupo do indicador (Anexo A §A.4; cap-05a §5.4). Os 55 motivos do
// domínio oficial têm grupo (a regra dá grupo a qualquer código: o que não está nas faixas é alta domiciliar).
import { describe, expect, it } from 'vitest';
import { GRUPOS_MOTIVO_ALTA, grupoMotivoAlta, ROTULO_GRUPO_MOTIVO_ALTA } from './legendas.js';

describe('motivo de alta: grupo do indicador', () => {
  it('óbito 40 a 46, 52 a 54 e 65 a 67', () => {
    for (const c of [40, 41, 42, 43, 44, 45, 46, 52, 53, 54, 65, 66, 67])
      expect(grupoMotivoAlta(c)).toBe('obito');
    for (const c of [39, 47, 51, 55, 64, 68]) expect(grupoMotivoAlta(c)).not.toBe('obito');
  });
  it('transferência externa 31; internação domiciliar 10, 29 e 32; evasão ou a pedido 14 e 16; administrativo 51', () => {
    expect(grupoMotivoAlta(31)).toBe('transferencia-externa');
    for (const c of [10, 29, 32]) expect(grupoMotivoAlta(c)).toBe('internacao-domiciliar');
    for (const c of [14, 16]) expect(grupoMotivoAlta(c)).toBe('evasao-ou-a-pedido');
    expect(grupoMotivoAlta(51)).toBe('encerramento-administrativo');
    expect(grupoMotivoAlta(11)).toBe('alta-domiciliar');
  });
  it('55 motivos, todos com grupo e rótulo', () => {
    const codigos = Array.from({ length: 55 }, (_, i) => i + 11);
    const grupos = codigos.map(grupoMotivoAlta);
    expect(grupos.every((g) => GRUPOS_MOTIVO_ALTA.includes(g))).toBe(true);
    for (const g of GRUPOS_MOTIVO_ALTA) expect(ROTULO_GRUPO_MOTIVO_ALTA[g]).toBeTruthy();
  });
});
