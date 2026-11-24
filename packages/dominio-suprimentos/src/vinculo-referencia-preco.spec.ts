// F3.6 (05-SUP linha 28): vínculo do item com a referência de preço (linha do tempo por publicação, fator, nada antes de
// hoje, encerramento e a escolha do vínculo pela conta).
import { describe, expect, it } from 'vitest';
import {
  conferirEncerramentoVinculoReferencia,
  escolherVinculoDaConta,
  fatorReferenciaValido,
  fatorSugeridoReferencia,
  planejarVinculoReferenciaPreco,
  vespera,
  type VinculoReferenciaPrecoVigencia,
} from '@sgh/contratos/regras-suprimentos';

const v1: VinculoReferenciaPrecoVigencia = {
  id: 1,
  referencia: 10,
  fonte: 'simpro',
  fator: 1,
  inicio: '2026-01-01',
  fim: null,
};
const CTX = { fonte: 'simpro', hoje: '2026-01-01' };
const codigos = (p: ReturnType<typeof planejarVinculoReferenciaPreco>) => p.recusas.map((r) => r.codigo);

describe('planejarVinculoReferenciaPreco', () => {
  it('o primeiro vínculo do item entra sem fechar nada', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 10, edicao: null, fator: 1, inicio: '2026-03-01' },
      [],
      CTX,
    );
    expect(p).toEqual({ recusas: [], encerrar: [] });
  });

  it('a troca de referência fecha o vigente na véspera (o histórico fica)', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 11, edicao: 5, fator: 20, inicio: '2026-03-01' },
      [v1],
      CTX,
    );
    expect(p.recusas).toEqual([]);
    expect(p.encerrar).toEqual([{ id: 1, fim: '2026-02-28' }]);
  });

  it('o mesmo item com outro fator também vale (troca de embalagem)', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 10, edicao: null, fator: 10, inicio: '2026-03-01' },
      [v1],
      CTX,
    );
    expect(codigos(p)).toEqual([]);
  });

  it('recusa a mesma referência com o mesmo fator', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 10, edicao: null, fator: 1, inicio: '2026-03-01' },
      [v1],
      CTX,
    );
    expect(codigos(p)).toEqual(['vinculo-sem-mudanca']);
  });

  it('recusa o início no dia ou antes do último vínculo', () => {
    for (const inicio of ['2026-01-01', '2025-12-31'])
      expect(
        codigos(
          planejarVinculoReferenciaPreco({ referencia: 11, edicao: null, fator: 1, inicio }, [v1], CTX),
        ),
      ).toEqual(['vinculo-retroativo']);
  });

  it('fecha também o vínculo encerrado no futuro que se sobrepõe', () => {
    const fut = { ...v1, fim: '2026-12-31' };
    const p = planejarVinculoReferenciaPreco(
      { referencia: 11, edicao: null, fator: 1, inicio: '2026-06-01' },
      [fut],
      CTX,
    );
    expect(p.encerrar).toEqual([{ id: 1, fim: '2026-05-31' }]);
    const antigo = { ...v1, fim: '2026-02-01' };
    expect(
      planejarVinculoReferenciaPreco(
        { referencia: 11, edicao: null, fator: 1, inicio: '2026-06-01' },
        [antigo],
        CTX,
      ).encerrar,
    ).toEqual([]);
  });

  it('recusa fator e data inválidos com o campo', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 10, edicao: null, fator: 0, inicio: '2026-02-30' },
      [],
      CTX,
    );
    expect(codigos(p)).toEqual(['fator-invalido', 'data-invalida']);
    expect(p.recusas.flatMap((r) => r.campos ?? [])).toEqual(['fator', 'inicio']);
  });
});

describe('fator e datas', () => {
  it('fator: positivo, até o máximo, até 8 casas', () => {
    expect(fatorReferenciaValido(0.00000001)).toBe(true);
    expect(fatorReferenciaValido(1_000_000)).toBe(true);
    expect(fatorReferenciaValido(-1)).toBe(false);
    expect(fatorReferenciaValido(1_000_001)).toBe(false);
    expect(fatorReferenciaValido(0.000000001)).toBe(false);
    expect(fatorReferenciaValido(Number.NaN)).toBe(false);
  });

  it('véspera atravessa mês e ano', () => {
    expect(vespera('2026-03-01')).toBe('2026-02-28');
    expect(vespera('2026-01-01')).toBe('2025-12-31');
  });

  it('fator sugerido pela unidade', () => {
    expect(fatorSugeridoReferencia(1, 1, [])).toBe(1);
    expect(fatorSugeridoReferencia(1, 2, [{ unidade: 2, fator: 10 }])).toBe(10);
    expect(fatorSugeridoReferencia(1, 3, [{ unidade: 2, fator: 10 }])).toBeNull();
    expect(fatorSugeridoReferencia(1, null, [])).toBeNull();
  });
});

describe('conferirEncerramentoVinculoReferencia', () => {
  it('fecha o vigente no dia ou depois do início', () => {
    expect(conferirEncerramentoVinculoReferencia(v1, '2026-01-01', '2026-01-01')).toEqual([]);
    expect(
      conferirEncerramentoVinculoReferencia(v1, '2025-12-31', '2025-01-01').map((r) => r.codigo),
    ).toEqual(['vigencia-invalida']);
    expect(
      conferirEncerramentoVinculoReferencia({ ...v1, fim: '2026-02-01' }, '2026-03-01', '2026-01-01').map(
        (r) => r.codigo,
      ),
    ).toEqual(['vinculo-ja-encerrado']);
    expect(conferirEncerramentoVinculoReferencia(v1, 'x', '2026-01-01').map((r) => r.codigo)).toEqual([
      'data-invalida',
    ]);
  });
});

describe('linha do tempo por publicação e nada antes de hoje', () => {
  it('o vínculo de outra publicação convive com o vigente (nada fecha)', () => {
    const p = planejarVinculoReferenciaPreco(
      { referencia: 20, edicao: null, fator: 1, inicio: '2026-03-01' },
      [v1],
      { fonte: 'brasindice', hoje: '2026-01-01' },
    );
    expect(p).toEqual({ recusas: [], encerrar: [] });
    // Mesma referência e fator, mas em outra publicação: não é "sem mudança".
    expect(
      codigos(
        planejarVinculoReferenciaPreco(
          { referencia: 10, edicao: null, fator: 1, inicio: '2026-03-01' },
          [v1],
          {
            fonte: 'brasindice',
            hoje: '2026-01-01',
          },
        ),
      ),
    ).toEqual([]);
  });

  it('recusa o início antes de hoje mesmo sem vínculo anterior e mesmo depois do último', () => {
    expect(
      codigos(
        planejarVinculoReferenciaPreco(
          { referencia: 11, edicao: null, fator: 1, inicio: '2026-05-31' },
          [v1],
          {
            fonte: 'simpro',
            hoje: '2026-06-01',
          },
        ),
      ),
    ).toEqual(['vinculo-retroativo']);
    expect(
      codigos(
        planejarVinculoReferenciaPreco({ referencia: 11, edicao: null, fator: 1, inicio: '2026-06-01' }, [], {
          fonte: 'simpro',
          hoje: '2026-06-01',
        }),
      ),
    ).toEqual([]);
  });

  it('recusa o encerramento antes de hoje', () => {
    expect(
      conferirEncerramentoVinculoReferencia(v1, '2026-05-31', '2026-06-01').map((r) => r.codigo),
    ).toEqual(['encerramento-retroativo']);
    expect(conferirEncerramentoVinculoReferencia(v1, '2026-06-01', '2026-06-01')).toEqual([]);
  });
});

describe('escolherVinculoDaConta', () => {
  const simpro = { id: 1, referencia: 10, fonte: 'simpro', inicio: '2026-01-01' };
  const brasindice = { id: 2, referencia: 20, fonte: 'brasindice', inicio: '2026-02-01' };
  it('a mesma referência do item faturável vence', () => {
    expect(
      escolherVinculoDaConta([simpro, brasindice], {
        referenciaDoFaturavel: 10,
        fonteDaTabela: 'brasindice',
      }),
    ).toBe(simpro);
  });
  it('senão a publicação da tabela de preço da conta', () => {
    expect(
      escolherVinculoDaConta([simpro, brasindice], { referenciaDoFaturavel: 99, fonteDaTabela: 'SIMPRO' }),
    ).toBe(simpro);
  });
  it('senão o de início mais recente; sem vínculo, nenhum', () => {
    expect(
      escolherVinculoDaConta([simpro, brasindice], { referenciaDoFaturavel: null, fonteDaTabela: null }),
    ).toBe(brasindice);
    expect(escolherVinculoDaConta([], { referenciaDoFaturavel: 10, fonteDaTabela: 'simpro' })).toBeNull();
  });
});
