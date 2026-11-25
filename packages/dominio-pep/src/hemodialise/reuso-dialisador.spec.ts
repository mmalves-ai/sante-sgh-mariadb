// Reuso do dialisador (03-PEP linha 146): abertura com o teto do método e o volume inicial, avaliação do
// reprocessamento (volume de 80%, teste do desinfetante antes e depois do enxágue, limite de reusos), descarte,
// desativação e cancelamento. Valores SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  avaliarReprocessamento,
  conferirAberturaDialisador,
  conferirCancelamentoReuso,
  conferirDesativacaoDialisador,
  conferirDescarteDialisador,
  type DialisadorParaReuso,
  limitePadraoReusos,
  type Reprocessamento,
} from './reuso-dialisador.js';

const d = (x: Partial<DialisadorParaReuso> = {}): DialisadorParaReuso => ({
  situacao: 'em_uso',
  metodo: 'automatizado',
  limiteReusos: 20,
  reusosRealizados: 0,
  volumeInicialMl: 100,
  ...x,
});
const r = (x: Partial<Reprocessamento> = {}): Reprocessamento => ({
  metodo: 'automatizado',
  volumeAtualMl: 95,
  testePreEnxague: 'positivo',
  testePosEnxague: 'negativo',
  ...x,
});
const campos = (e: { campo: string }[]) => e.map((x) => x.campo);

describe('abertura do dialisador', () => {
  it('teto pelo método: 20 automatizado, 12 manual, 0 uso único', () => {
    expect(limitePadraoReusos('automatizado')).toBe(20);
    expect(limitePadraoReusos('manual')).toBe(12);
    expect(limitePadraoReusos('uso_unico')).toBe(0);
  });

  it('aceita a abertura com volume e limite padrão; recusa limite acima do teto e sem volume', () => {
    const base = {
      identificacao: 'D-01',
      metodo: 'manual' as const,
      limiteReusos: null,
      volumeInicialMl: 90,
    };
    expect(conferirAberturaDialisador(base, 0)).toEqual([]);
    expect(campos(conferirAberturaDialisador({ ...base, limiteReusos: 13 }, 0))).toEqual(['limiteReusos']);
    expect(campos(conferirAberturaDialisador({ ...base, volumeInicialMl: null }, 0))).toEqual([
      'volumeInicialMl',
    ]);
    expect(campos(conferirAberturaDialisador({ ...base, identificacao: '  ' }, 0))).toEqual([
      'identificacao',
    ]);
  });

  it('uso único: sem reuso e sem exigir volume; um dialisador em uso por paciente', () => {
    expect(
      conferirAberturaDialisador(
        { identificacao: 'U1', metodo: 'uso_unico', limiteReusos: null, volumeInicialMl: null },
        0,
      ),
    ).toEqual([]);
    expect(
      campos(
        conferirAberturaDialisador(
          { identificacao: 'U1', metodo: 'uso_unico', limiteReusos: 3, volumeInicialMl: null },
          0,
        ),
      ),
    ).toEqual(['limiteReusos']);
    expect(
      campos(
        conferirAberturaDialisador(
          { identificacao: 'D2', metodo: 'automatizado', limiteReusos: 20, volumeInicialMl: 80 },
          1,
        ),
      ),
    ).toEqual(['paciente']);
  });
});

describe('avaliação do reprocessamento', () => {
  it('aprova com volume a 95% e os dois testes certos; conta o reuso', () => {
    const a = avaliarReprocessamento(d(), r());
    expect(a).toMatchObject({
      erros: [],
      aprovado: true,
      descartar: false,
      fracaoVolume: 0.95,
      reusosDepois: 1,
    });
    expect(a.ultimoReuso).toBe(false);
  });

  it('volume abaixo de 80% descarta na hora; 80% exato segue', () => {
    const a = avaliarReprocessamento(d(), r({ volumeAtualMl: 79 }));
    expect(a.aprovado).toBe(false);
    expect(a.descartar).toBe(true);
    expect(a.motivoDescarte).toMatch(/79%/);
    expect(a.reusosDepois).toBe(0);
    expect(avaliarReprocessamento(d(), r({ volumeAtualMl: 80 })).aprovado).toBe(true);
  });

  it('desinfetante ausente antes ou presente depois do enxágue reprova sem descartar', () => {
    const pre = avaliarReprocessamento(d(), r({ testePreEnxague: 'negativo' }));
    expect(pre).toMatchObject({ aprovado: false, descartar: false });
    expect(pre.reprovacoes[0]).toMatch(/antes do enxágue/);
    const pos = avaliarReprocessamento(d(), r({ testePosEnxague: 'positivo' }));
    expect(pos).toMatchObject({ aprovado: false, descartar: false });
    expect(pos.reprovacoes[0]).toMatch(/Resíduo/);
  });

  it('limite: recusa depois do teto; o manual limita a 12 mesmo no dialisador automatizado; avisa o último', () => {
    expect(campos(avaliarReprocessamento(d({ reusosRealizados: 20 }), r()).erros)).toEqual(['dialisador']);
    expect(
      campos(avaliarReprocessamento(d({ reusosRealizados: 12 }), r({ metodo: 'manual' })).erros),
    ).toEqual(['dialisador']);
    const ultimo = avaliarReprocessamento(d({ reusosRealizados: 19 }), r());
    expect(ultimo).toMatchObject({ aprovado: true, ultimoReuso: true, reusosDepois: 20 });
  });

  it('recusa sem medidas, uso único e dialisador fora de uso; nada se descarta com erro', () => {
    const a = avaliarReprocessamento(
      d(),
      r({ volumeAtualMl: null, testePreEnxague: null, testePosEnxague: null }),
    );
    expect(campos(a.erros)).toEqual(['volumeAtualMl', 'testePreEnxague', 'testePosEnxague']);
    expect(a.aprovado).toBe(false);
    expect(campos(avaliarReprocessamento(d({ metodo: 'uso_unico', limiteReusos: 0 }), r()).erros)).toContain(
      'dialisador',
    );
    const fora = avaliarReprocessamento(d({ situacao: 'descartado' }), r({ volumeAtualMl: 50 }));
    expect(fora.descartar).toBe(false);
    expect(campos(fora.erros)).toEqual(['dialisador']);
  });
});

describe('saída de uso e cancelamento', () => {
  it('descarte com motivo só do dialisador em uso', () => {
    expect(conferirDescarteDialisador('em_uso', 'Fibras rompidas')).toEqual([]);
    expect(campos(conferirDescarteDialisador('descartado', 'abc'))).toEqual(['dialisador', 'motivo']);
  });

  it('desativação só do aberto por engano (sem reprocessamento válido)', () => {
    expect(conferirDesativacaoDialisador('em_uso', 0, 'Etiqueta trocada')).toEqual([]);
    expect(campos(conferirDesativacaoDialisador('em_uso', 2, 'Etiqueta trocada'))).toEqual(['dialisador']);
  });

  it('cancela só o último válido, com o dialisador em uso e motivo', () => {
    const ok = {
      situacao: 'valido' as const,
      ehUltimoValido: true,
      situacaoDialisador: 'em_uso' as const,
      motivo: 'Lançado no paciente errado',
    };
    expect(conferirCancelamentoReuso(ok)).toEqual([]);
    expect(campos(conferirCancelamentoReuso({ ...ok, ehUltimoValido: false }))).toEqual(['reprocessamento']);
    expect(campos(conferirCancelamentoReuso({ ...ok, situacao: 'cancelado' }))).toEqual(['reprocessamento']);
    expect(
      campos(conferirCancelamentoReuso({ ...ok, situacaoDialisador: 'descartado', motivo: 'x' })),
    ).toEqual(['dialisador', 'motivo']);
  });
});
