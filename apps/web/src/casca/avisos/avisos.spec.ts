// Regra 6 do M27: só o risco grave (alergia, dose acima do limite, paciente errado) interrompe; o resto vai à central.
import type { Aviso } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { apresentacaoDoAviso, avisosQueInterrompem, ordenarCentral, seloDoSino } from './avisos.js';

const aviso = (o: Partial<Aviso>): Aviso => ({
  id: 1,
  tipo: 'mensagem',
  gravidade: 'informacao',
  modulo: 'acesso',
  titulo: 'Aviso',
  link: null,
  estado: 'novo',
  criadoEm: '2026-10-22T08:00:00.000',
  ...o,
});

describe('higiene de alertas', () => {
  it('interrompe só alergia, dose acima do limite e paciente errado, quando graves', () => {
    for (const tipo of ['alergia', 'dose-acima-do-limite', 'paciente-errado'])
      expect(apresentacaoDoAviso({ tipo, gravidade: 'grave' })).toBe('interromper');
    expect(apresentacaoDoAviso({ tipo: 'alergia', gravidade: 'atencao' })).toBe('central');
    expect(apresentacaoDoAviso({ tipo: 'resultado-critico', gravidade: 'grave' })).toBe('central');
    expect(apresentacaoDoAviso({ tipo: 'ciencia-pendente', gravidade: 'atencao' })).toBe('central');
  });
  it('o que interrompe aparece uma vez (o já mostrado e o lido não voltam)', () => {
    const avisos = [
      aviso({ id: 1, tipo: 'alergia', gravidade: 'grave' }),
      aviso({ id: 2, tipo: 'paciente-errado', gravidade: 'grave', estado: 'lido' }),
      aviso({ id: 3, tipo: 'dose-acima-do-limite', gravidade: 'grave' }),
      aviso({ id: 4 }),
    ];
    expect(avisosQueInterrompem(avisos, new Set([3])).map((a) => a.id)).toEqual([1]);
  });
  it('o selo soma os avisos novos e as mensagens não lidas; a central em ordem de estado e data', () => {
    expect(seloDoSino({ avisos: [], novos: 2, versao: 0 }, 3)).toBe(5);
    expect(seloDoSino(undefined, -1)).toBe(0);
    const o = ordenarCentral([
      aviso({ id: 1, estado: 'resolvido', criadoEm: '2026-10-22T10:00:00.000' }),
      aviso({ id: 2, estado: 'novo', criadoEm: '2026-10-22T07:00:00.000' }),
      aviso({ id: 3, estado: 'lido', criadoEm: '2026-10-22T09:00:00.000' }),
      aviso({ id: 4, estado: 'novo', criadoEm: '2026-10-22T08:00:00.000' }),
    ]);
    expect(o.map((a) => a.id)).toEqual([4, 2, 3, 1]);
  });
});
