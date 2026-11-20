// Regra 12 do M31: lotes e recursos anteriores ao novo aparecem com situação inferida e marcados; não servem de base
// para cobrar recurso de lote antigo sem conferência humana.
import { describe, expect, it } from 'vitest';
import { avisoInferida, ROTULO_SITUACAO_LOTE, situacaoDoLote } from '@sgh/contratos/regras-faturamento';

const l = (x: Partial<Parameters<typeof situacaoDoLote>[0]> = {}) =>
  situacaoDoLote({
    protocolo: '',
    registradoNoNovo: true,
    demonstrativos: 0,
    itensBaixados: 0,
    itensComRecurso: 0,
    itensRecursoAberto: 0,
    ...x,
  });

describe('situação do lote', () => {
  it('ordem: recurso > retorno > protocolo > gerado', () => {
    expect(l()).toEqual({ situacao: 'gerado', inferida: false });
    expect(l({ protocolo: '1' }).situacao).toBe('protocolado');
    expect(l({ protocolo: '1', itensBaixados: 3 }).situacao).toBe('com-demonstrativo');
    expect(l({ demonstrativos: 1 }).situacao).toBe('com-demonstrativo');
    expect(l({ itensComRecurso: 2, itensRecursoAberto: 1 }).situacao).toBe('com-recurso');
    expect(l({ itensComRecurso: 2, itensRecursoAberto: 0 }).situacao).toBe('encerrado');
  });
  it('lote do outro sistema: inferida, com aviso', () => {
    const s = l({ registradoNoNovo: false, protocolo: '9' });
    expect(s.inferida).toBe(true);
    expect(avisoInferida(s.inferida)).toMatch(/confira antes de cobrar recurso/);
    expect(avisoInferida(false)).toBeNull();
    expect(ROTULO_SITUACAO_LOTE[s.situacao]).toBe('Protocolado');
  });
});
