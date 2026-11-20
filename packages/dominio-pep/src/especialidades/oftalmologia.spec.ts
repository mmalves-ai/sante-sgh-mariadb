// Oftalmologia (M45, etapa 6): acuidade pelo rótulo do cadastro, classificação da visão pelo melhor olho, alertas da
// pressão intraocular e a recusa de valor nunca visto (regra 15). Cadastro SINTÉTICO com os rótulos do formato da cópia.
import { esquemaRegistrarExameOftalmologico } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroEspecialidade } from './comum.js';
import {
  alertasPio,
  type CadastroOftalmologia,
  classificarVisao,
  conferirExameOftalmologico,
  decimalDaAcuidade,
} from './oftalmologia.js';

const CADASTRO: CadastroOftalmologia = {
  exames: new Map([
    [2, 'Tonometria non contact'],
    [6, 'Acuidade visual sem correcao'],
    [33, 'Gonioscopia'],
  ]),
  acuidades: new Map([
    [1, '20/20 (1,0)'],
    [4, '20/40 (0,5)'],
    [5, '20/50 (0,4)'],
    [6, '20/60 (0,3)'],
    [10, '20/200 (0,1)'],
    [12, '20/400 (0,05)'],
    [13, 'CD (conta dedos) a 15cm'],
    [21, 'NPL'],
    [24, 'Menor que 20/200 (0,1)'],
    [30, '20/25'],
  ]),
  graduacoes: new Map([
    [1, 'Ângulo fechado'],
    [4, 'Ângulo aberto'],
  ]),
};

const exame = (x: Record<string, unknown>) =>
  esquemaRegistrarExameOftalmologico.parse({ internacao: 1, od: {}, oe: {}, ...x });

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroEspecialidade ? e.codigo : 'outro';
  }
  return 'passou';
};

describe('acuidade visual', () => {
  it('lê o decimal do rótulo, o "menor que" abaixo dele, o Snellen sem decimal e as qualitativas', () => {
    expect(decimalDaAcuidade('20/20 (1,0)')).toEqual({ decimal: 1, qualitativa: false });
    expect(decimalDaAcuidade('20/30 (0,66)').decimal).toBeCloseTo(0.66);
    expect(decimalDaAcuidade('Menor que 20/200 (0,1)').decimal).toBeCloseTo(0.09);
    expect(decimalDaAcuidade('20/25').decimal).toBeCloseTo(0.8);
    expect(decimalDaAcuidade('CD (conta dedos) a 1m')).toEqual({ decimal: null, qualitativa: true });
    expect(decimalDaAcuidade('Percepção luminosa sem projeção').qualitativa).toBe(true);
  });

  it('classifica pelo melhor olho com a melhor correção (Decreto 5.296/2004 e OMS)', () => {
    const olho = (sc: number | null, cc: number | null) => ({
      acuidadeSemCorrecao: sc,
      acuidadeComCorrecao: cc,
      pio: null,
      gonioscopia: null,
    });
    expect(classificarVisao(olho(10, 1), olho(10, null), CADASTRO)).toBe('normal');
    expect(classificarVisao(olho(5, null), olho(10, null), CADASTRO)).toBe('reduzida');
    expect(classificarVisao(olho(6, null), olho(13, null), CADASTRO)).toBe('baixa-visao');
    expect(classificarVisao(olho(24, null), olho(null, null), CADASTRO)).toBe('baixa-visao');
    expect(classificarVisao(olho(12, null), olho(21, null), CADASTRO)).toBe('cegueira');
    expect(classificarVisao(olho(13, null), olho(null, null), CADASTRO)).toBe('cegueira');
    expect(classificarVisao(olho(null, null), olho(null, null), CADASTRO)).toBe('sem-dado');
    expect(classificarVisao(olho(99, null), olho(null, null), CADASTRO)).toBe('sem-dado');
    expect(classificarVisao(olho(30, null), olho(null, null), CADASTRO)).toBe('normal');
  });
});

describe('pressão intraocular', () => {
  it('alerta acima do limite e a assimetria de 5 mmHg ou mais', () => {
    expect(alertasPio(18, 19, 21)).toEqual([]);
    expect(alertasPio(26, 19, 21)).toEqual([
      'Pressão intraocular do olho direito acima de 21 mmHg (26 mmHg): hipertensão ocular.',
      'Assimetria da pressão intraocular entre os olhos de 7 mmHg.',
    ]);
    expect(alertasPio(null, 24, 21)).toHaveLength(1);
    expect(alertasPio(21, 21, 21)).toEqual([]);
  });
});

describe('conferência do exame (regra 15)', () => {
  it('aceita o exame completo e devolve a classificação e os alertas', () => {
    const r = conferirExameOftalmologico(
      exame({
        od: { acuidadeSemCorrecao: 10, acuidadeComCorrecao: 4, pio: 23, gonioscopia: 4 },
        oe: { acuidadeSemCorrecao: 6, pio: 17 },
        metodoPio: 'aplanacao',
        exames: [{ exame: 33, lado: 'ao', resultado: 'Ângulo aberto nos quatro quadrantes' }],
      }),
      CADASTRO,
      21,
    );
    expect(r.classificacao).toBe('normal');
    expect(r.alertas).toHaveLength(2);
  });

  it('recusa acuidade, graduação e exame fora do cadastro', () => {
    expect(
      erro(() => conferirExameOftalmologico(exame({ od: { acuidadeSemCorrecao: 99 } }), CADASTRO, 21)),
    ).toBe('valor-desconhecido');
    expect(erro(() => conferirExameOftalmologico(exame({ oe: { gonioscopia: 9 } }), CADASTRO, 21))).toBe(
      'valor-desconhecido',
    );
    expect(
      erro(() =>
        conferirExameOftalmologico(
          exame({ exames: [{ exame: 77, lado: 'od', resultado: 'x' }] }),
          CADASTRO,
          21,
        ),
      ),
    ).toBe('valor-desconhecido');
  });

  it('recusa o exame vazio, o exame repetido no mesmo olho e a pressão sem o método', () => {
    expect(erro(() => conferirExameOftalmologico(exame({}), CADASTRO, 21))).toBe('exame-vazio');
    expect(
      erro(() =>
        conferirExameOftalmologico(
          exame({
            exames: [
              { exame: 2, lado: 'od', resultado: 'a' },
              { exame: 2, lado: 'od', resultado: 'b' },
            ],
          }),
          CADASTRO,
          21,
        ),
      ),
    ).toBe('exame-repetido');
    expect(erro(() => conferirExameOftalmologico(exame({ od: { pio: 15 } }), CADASTRO, 21))).toBe(
      'metodo-pio-ausente',
    );
    expect(
      erro(() =>
        conferirExameOftalmologico(
          exame({ exames: [{ exame: 2, lado: 'oe', resultado: 'ok' }] }),
          CADASTRO,
          21,
        ),
      ),
    ).toBe('passou');
  });
});
