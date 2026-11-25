import { describe, expect, it } from 'vitest';
import {
  type AchadoMama,
  alertasLaudoAnatomopatologico,
  alertasLaudoMama,
  amostraMudou,
  categoriaMaisGrave,
  condutaDaCategoria,
  conferirLaudoAnatomopatologico,
  conferirLaudoMama,
  fichaSiscanMamografia,
  type LaudoAnatomopatologico,
  type LaudoMama,
} from './laudos.js';

const achado = (x: Partial<AchadoMama> = {}): AchadoMama => ({
  lateralidade: 'direita',
  quadrante: 'superior_lateral',
  tipo: 'nodulo',
  categoria: '4B',
  tamanhoMm: 12,
  posicaoHoraria: 10,
  distanciaMamiloMm: 30,
  forma: 'irregular',
  contorno: 'espiculado',
  densidade: 'alta',
  morfologiaCalcificacao: null,
  distribuicaoCalcificacao: null,
  correlacaoUltrassom: false,
  descricao: null,
  ...x,
});
const mama = (x: Partial<LaudoMama> = {}): LaudoMama => ({
  tipoMamografia: 'diagnostica',
  noduloPalpavel: false,
  historicoFamiliar: false,
  mamografiaAnterior: false,
  mamografiaAnteriorAno: null,
  composicaoDireita: 'fibroglandular_esparsa',
  composicaoEsquerda: 'fibroglandular_esparsa',
  categoriaDireita: '4B',
  categoriaEsquerda: '1',
  recomendacao: 'biopsia',
  intervaloControleMeses: null,
  conclusao: 'Nódulo suspeito na mama direita.',
  laudista: 7,
  achados: [achado()],
  ...x,
});
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('laudo de mamografia', () => {
  it('categoria mais grave segue a ordem padronizada (0 acima de 6; 5 a mais grave)', () => {
    expect(categoriaMaisGrave(['1', '3', '2'])).toBe('3');
    expect(categoriaMaisGrave(['6', '0'])).toBe('0');
    expect(categoriaMaisGrave(['4C', '4A', '5'])).toBe('5');
    expect(categoriaMaisGrave([null, 'x'])).toBeNull();
    expect(condutaDaCategoria('3')).toEqual({ recomendacao: 'controle_radiologico', intervaloMeses: 6 });
    expect(condutaDaCategoria('0')?.recomendacao).toBe('complementacao');
  });

  it('o laudo completo libera; o rascunho vazio grava', () => {
    expect(conferirLaudoMama(mama(), 'liberar', 2030)).toEqual([]);
    const rascunho = mama({
      categoriaDireita: null,
      categoriaEsquerda: null,
      composicaoDireita: null,
      composicaoEsquerda: null,
      recomendacao: null,
      conclusao: null,
      laudista: null,
      achados: [],
    });
    expect(conferirLaudoMama(rascunho, 'rascunho', 2030)).toEqual([]);
    expect(campos(conferirLaudoMama(rascunho, 'liberar', 2030))).toEqual(
      expect.arrayContaining(['categoriaDireita', 'recomendacao', 'conclusao', 'laudista']),
    );
  });

  it('categoria final menos grave que o achado da mesma mama é recusada até no rascunho', () => {
    const p = conferirLaudoMama(mama({ categoriaDireita: '3' }), 'rascunho', 2030);
    expect(campos(p)).toEqual(['categoriaDireita']);
  });

  it('a recomendação decorre da categoria mais grave; controle exige o intervalo', () => {
    expect(campos(conferirLaudoMama(mama({ recomendacao: 'rotina' }), 'liberar', 2030))).toEqual([
      'recomendacao',
    ]);
    const tres = mama({
      categoriaDireita: '3',
      achados: [achado({ categoria: '3', forma: 'oval', contorno: 'circunscrito' })],
      recomendacao: 'controle_radiologico',
    });
    expect(campos(conferirLaudoMama(tres, 'liberar', 2030))).toEqual(['intervaloControleMeses']);
    expect(conferirLaudoMama({ ...tres, intervaloControleMeses: 6 }, 'liberar', 2030)).toEqual([]);
  });

  it('nódulo exige forma, contorno e tamanho; calcificação a morfologia e a distribuição', () => {
    const p = conferirLaudoMama(
      mama({
        achados: [
          achado({ forma: null, contorno: null, tamanhoMm: null }),
          achado({ tipo: 'calcificacao', forma: null, contorno: null, densidade: null, categoria: '4A' }),
        ],
      }),
      'liberar',
      2030,
    );
    expect(campos(p)).toEqual([
      'achados.0.forma',
      'achados.0.contorno',
      'achados.0.tamanhoMm',
      'achados.1.morfologiaCalcificacao',
      'achados.1.distribuicaoCalcificacao',
    ]);
    const descritor = conferirLaudoMama(
      mama({ achados: [achado({ tipo: 'calcificacao', categoria: '4A' })] }),
      'rascunho',
      2030,
    );
    expect(campos(descritor)).toEqual(['achados.0.forma']);
  });

  it('faixas: posição em horas, ano da mamografia anterior e achado sem categoria final da mama', () => {
    const p = conferirLaudoMama(
      mama({
        mamografiaAnteriorAno: 2020,
        categoriaEsquerda: null,
        composicaoEsquerda: null,
        achados: [
          achado(),
          achado({
            lateralidade: 'esquerda',
            posicaoHoraria: 13,
            categoria: '2',
            tipo: 'linfonodo',
            forma: null,
            contorno: null,
            densidade: null,
          }),
        ],
      }),
      'liberar',
      2030,
    );
    expect(campos(p)).toEqual(['mamografiaAnteriorAno', 'achados.1.posicaoHoraria', 'categoriaEsquerda']);
  });

  it('alertas: categoria suspeita, inconclusivo, nódulo palpável no rastreamento e mama densa', () => {
    expect(alertasLaudoMama(mama())).toHaveLength(1);
    expect(
      alertasLaudoMama(
        mama({
          categoriaDireita: '0',
          tipoMamografia: 'rastreamento',
          noduloPalpavel: true,
          composicaoEsquerda: 'extremamente_densa',
        }),
      ),
    ).toHaveLength(3);
  });

  it('ficha do SISCAN: categoria por mama, contagem de achados e recomendação', () => {
    const f = fichaSiscanMamografia({ ...mama(), liberadoEm: '2030-03-10T12:00:00.000Z' });
    expect(f.direita).toMatchObject({ avaliada: true, categoria: '4B', nodulos: 1, microcalcificacoes: 0 });
    expect(f.esquerda).toMatchObject({ avaliada: true, categoria: '1', nodulos: 0 });
    expect(f.recomendacao).toBe('biopsia');
  });
});

const ap = (x: Partial<LaudoAnatomopatologico> = {}): LaudoAnatomopatologico => ({
  tipoExame: 'histopatologia',
  coletaEm: '2030-03-10T10:00:00.000Z',
  recebidoEm: '2030-03-10T14:00:00.000Z',
  dadosClinicos: null,
  macroscopia: 'Peça de 3 cm.',
  microscopia: 'Neoplasia.',
  diagnostico: 'Carcinoma invasivo.',
  conclusao: null,
  grauHistologico: 2,
  adequabilidade: null,
  resultado: 'maligno',
  patologista: 9,
  dados: { margens: 'livres', linfonodosExaminados: 10, linfonodosComprometidos: 2, her2: '2+' },
  amostras: [
    {
      tipo: 'peca',
      identificacao: 'A',
      descricao: 'Mama',
      quantidadeFragmentos: null,
      dimensoes: '3x2',
      fixador: null,
      coloracao: null,
    },
  ],
  ...x,
});

describe('laudo anatomopatológico', () => {
  it('o laudo completo libera; o maligno exige o grau histológico', () => {
    expect(conferirLaudoAnatomopatologico(ap(), 'liberar')).toEqual([]);
    expect(campos(conferirLaudoAnatomopatologico(ap({ grauHistologico: null }), 'liberar'))).toEqual([
      'grauHistologico',
    ]);
    expect(conferirLaudoAnatomopatologico(ap({ grauHistologico: null }), 'rascunho')).toEqual([]);
  });

  it('citologia exige a adequabilidade; insatisfatória só admite indeterminado', () => {
    const cito = ap({
      tipoExame: 'citopatologia',
      macroscopia: null,
      microscopia: null,
      grauHistologico: null,
      resultado: 'negativo',
    });
    expect(campos(conferirLaudoAnatomopatologico(cito, 'liberar'))).toEqual(['adequabilidade']);
    expect(
      campos(conferirLaudoAnatomopatologico({ ...cito, adequabilidade: 'insatisfatoria' }, 'liberar')),
    ).toEqual(['resultado']);
    expect(
      conferirLaudoAnatomopatologico(
        { ...cito, adequabilidade: 'insatisfatoria', resultado: 'indeterminado' },
        'liberar',
      ),
    ).toEqual([]);
  });

  it('coerência: recebimento antes da coleta, linfonodos, percentuais e amostra repetida', () => {
    const p = conferirLaudoAnatomopatologico(
      ap({
        recebidoEm: '2030-03-09T10:00:00.000Z',
        dados: { linfonodosExaminados: 2, linfonodosComprometidos: 3, ki67Percentual: 120, her2: '4+' },
        amostras: [ap().amostras[0]!, { ...ap().amostras[0]!, identificacao: 'a' }],
      }),
      'rascunho',
    );
    expect(campos(p)).toEqual([
      'recebidoEm',
      'dados.her2',
      'dados.ki67Percentual',
      'dados.linfonodosComprometidos',
      'amostras.1.identificacao',
    ]);
  });

  it('histopatologia exige macroscopia, microscopia, amostra, patologista e diagnóstico', () => {
    const p = conferirLaudoAnatomopatologico(
      ap({
        macroscopia: null,
        microscopia: ' ',
        amostras: [],
        patologista: null,
        diagnostico: null,
        resultado: null,
        recebidoEm: null,
      }),
      'liberar',
    );
    expect(campos(p)).toEqual([
      'patologista',
      'diagnostico',
      'resultado',
      'amostras',
      'recebidoEm',
      'macroscopia',
      'microscopia',
    ]);
  });

  it('alertas e mudança de amostra', () => {
    expect(alertasLaudoAnatomopatologico({ ...ap(), dados: { margens: 'comprometidas' } })).toHaveLength(2);
    const a = ap().amostras[0]!;
    expect(amostraMudou(a, { ...a })).toBe(false);
    expect(amostraMudou(a, { ...a, descricao: 'Outra' })).toBe(true);
  });
});
