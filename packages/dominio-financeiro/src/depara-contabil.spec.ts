import { describe, expect, it } from 'vitest';
import {
  conferirRegraDePara,
  contaExterna,
  dePararFatos,
  eventosSemDePara,
  type FatoContabil,
  type RegraDeParaConta,
} from './depara-contabil.js';
import { conferirLote, montarLoteContabil } from './lote-contabil.js';

const r = (x: Partial<RegraDeParaConta>): RegraDeParaConta => ({
  id: 1,
  evento: 'fin_pagamento_titulo',
  lado: 'ambos',
  natureza: null,
  conta: '2.1.1',
  ativo: true,
  ...x,
});
const fato = (x: Partial<FatoContabil>): FatoContabil => ({
  evento: 'fin_pagamento_titulo',
  data: '2026-10-05',
  valor: 100,
  historico: 'PAGAMENTO',
  documento: '10',
  natureza: 5,
  centro: 3,
  credor: 9,
  ...x,
});

describe('de-para contábil por evento (07-FIN linha 100)', () => {
  it('a regra mais específica vence: natureza e lado exato', () => {
    const regras = [
      r({ id: 1, lado: 'ambos', conta: 'GERAL' }),
      r({ id: 2, lado: 'debito', conta: 'FORN' }),
      r({ id: 3, lado: 'credito', natureza: 5, conta: 'BANCO-5' }),
      r({ id: 4, lado: 'debito', natureza: 5, conta: 'INATIVA', ativo: false }),
    ];
    expect(contaExterna(regras, 'fin_pagamento_titulo', 'debito', 5)).toBe('FORN');
    expect(contaExterna(regras, 'fin_pagamento_titulo', 'credito', 5)).toBe('BANCO-5');
    expect(contaExterna(regras, 'fin_pagamento_titulo', 'credito', 6)).toBe('GERAL');
    expect(contaExterna(regras, 'fin_despesa_reconhecida', 'credito', 5)).toBeNull();
  });
  it('recusa evento fora do catálogo, conta mal formada e duplicata ativa', () => {
    const e = {
      id: null,
      evento: 'fin_pagamento_titulo',
      lado: 'debito' as const,
      natureza: null,
      conta: '2.1.1',
    };
    expect(conferirRegraDePara({ ...e, evento: 'x' }, [])?.codigo).toBe('evento-desconhecido');
    expect(conferirRegraDePara({ ...e, conta: 'a;b' }, [])?.codigo).toBe('conta-externa-invalida');
    expect(conferirRegraDePara(e, [r({ lado: 'ambos' })])?.codigo).toBe('de-para-duplicado');
    expect(conferirRegraDePara(e, [r({ lado: 'credito' })])).toBeNull();
    expect(conferirRegraDePara({ ...e, id: 1 }, [r({ id: 1, lado: 'debito' })])).toBeNull();
  });
  it('lote com centro e credor externos; o fato sem conta fica fora e é contado', () => {
    const regras = [r({ lado: 'debito', conta: '2.1.1' }), r({ id: 2, lado: 'credito', conta: '1.1.1' })];
    const fatos = [fato({}), fato({ evento: 'fin_despesa_reconhecida', valor: 50 })];
    const { eventos, depara } = dePararFatos(fatos, regras, new Map([[3, 'CC-30']]), new Map([[9, 'F-900']]));
    const lote = montarLoteContabil(eventos, depara);
    expect(lote.lancamentos).toBe(1);
    expect(lote.linhas[0]).toBe('2026-10-05;2.1.1;1.1.1;100.00;PAGAMENTO;10;CC-30;F-900');
    expect(lote.semDePara).toHaveLength(1);
    expect(conferirLote(lote.conteudo)).toEqual({ ok: true, lancamentos: 1, soma: 100 });
    expect(eventosSemDePara(fatos, regras)).toEqual([
      { evento: 'fin_despesa_reconhecida', natureza: 5, lado: 'debito', fatos: 1 },
      { evento: 'fin_despesa_reconhecida', natureza: 5, lado: 'credito', fatos: 1 },
    ]);
  });
});
