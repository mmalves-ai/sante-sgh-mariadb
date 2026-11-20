// Regra 6 (ficha do M28): destinos 1, 2, 3, 5; origens E, B (setor), P só da dispensação; I recusado; paciente e conta
// só em 1 e 3; TCE C no 3; terceiro no 5.
import { describe, expect, it } from 'vitest';
import {
  colunasDoDestino,
  conferirDestinoOrigem,
  ROTULO_DESTINO,
  ROTULO_ORIGEM,
} from '@sgh/contratos/regras-suprimentos';

const cod = (c: Parameters<typeof conferirDestinoOrigem>[0], o?: { dispensacao?: boolean }) =>
  conferirDestinoOrigem(c, o).map((r) => r.codigo);

describe('destino e origem (regra 6)', () => {
  it('aceita os quatro destinos com os campos certos', () => {
    expect(cod({ destino: 1, origem: 'E', paciente: 5, conta: 9 })).toEqual([]);
    expect(cod({ destino: 2, origem: 'E' })).toEqual([]);
    expect(cod({ destino: 2, origem: 'B' })).toEqual([]);
    expect(cod({ destino: 3, origem: 'E', paciente: 5 })).toEqual([]);
    expect(cod({ destino: 5, origem: 'E', terceiro: 'X' })).toEqual([]);
  });
  it('recusa destino 4, origem I, P fora da dispensação e B fora do setor', () => {
    expect(cod({ destino: 4, origem: 'E' })).toContain('destino-invalido');
    expect(cod({ destino: 2, origem: 'I' })).toEqual(['origem-invalida']);
    expect(cod({ destino: 3, origem: 'P', paciente: 5 })).toEqual(['origem-da-dispensacao']);
    expect(cod({ destino: 3, origem: 'P', paciente: 5 }, { dispensacao: true })).toEqual([]);
    expect(cod({ destino: 1, origem: 'B', paciente: 5 })).toEqual(['origem-baixa-so-setor']);
  });
  it('paciente só em 1 e 3; terceiro só em 5', () => {
    expect(cod({ destino: 1, origem: 'E' })).toEqual(['sem-paciente']);
    expect(cod({ destino: 2, origem: 'E', paciente: 5 })).toEqual(['paciente-fora-do-destino']);
    expect(cod({ destino: 5, origem: 'E' })).toEqual(['sem-terceiro']);
    expect(cod({ destino: 2, origem: 'E', terceiro: 'X' })).toEqual(['terceiro-fora-do-destino']);
  });
  it('as colunas por destino: TCE C só no 3', () => {
    expect(colunasDoDestino({ destino: 3, origem: 'E', paciente: 5, conta: 8 })).toEqual({
      PAC: 5,
      CONTA: 8,
      TCE: 'C',
      TERCEIRO: '',
      atendimento: 'E',
    });
    expect(colunasDoDestino({ destino: 2, origem: 'E', paciente: 5 })).toMatchObject({
      PAC: 0,
      TCE: '',
      atendimento: null,
    });
    expect(colunasDoDestino({ destino: 5, origem: 'E', terceiro: '  Ana  ' }).TERCEIRO).toBe('Ana');
    expect(colunasDoDestino({ destino: 1, origem: 'E', paciente: 2 })).toMatchObject({
      CONTA: 0,
      atendimento: 'I',
    });
  });
  it('rótulos com "a confirmar" nos códigos de baixa confiança', () => {
    expect(ROTULO_ORIGEM.B).toContain('a confirmar');
    expect(ROTULO_DESTINO[5]).toBe('Terceiro');
  });
});
