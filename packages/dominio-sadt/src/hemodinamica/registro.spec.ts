import { describe, expect, it } from 'vitest';
import {
  type AchadoHemodinamica,
  achadoMudou,
  alertasHemodinamica,
  conferirRegistroHemodinamica,
  itemEmExecucaoHemodinamica,
  lesaoSignificativa,
  podeRefazerHemodinamica,
  type RegistroHemodinamica,
  registroOcupaExame,
  vasosComLesaoSignificativa,
} from './registro.js';

const achado = (x: Partial<AchadoHemodinamica> = {}): AchadoHemodinamica => ({
  vaso: 'Descendente anterior',
  segmento: 'proximal',
  tipo: 'estenose',
  grauPercentual: 80,
  fluxoTimi: 3,
  calcificacao: 'leve',
  comprimentoMm: 12,
  bifurcacao: false,
  conduta: 'angioplastia',
  stentImplantado: true,
  observacao: null,
  ...x,
});

const base = (x: Partial<RegistroHemodinamica> = {}): RegistroHemodinamica => ({
  inicioEm: '2030-03-10T10:00:00.000Z',
  fimEm: '2030-03-10T11:00:00.000Z',
  viaAcesso: 'radial_direita',
  introdutorFrench: 6,
  anestesia: 'local',
  contrasteNome: 'Contraste iodado fictício',
  contrasteVolumeMl: 120,
  heparinaUi: 5000,
  tempoFluoroscopiaSegundos: 420,
  kermaReferenciaMgy: 800,
  produtoDoseAreaGycm2: 45,
  dominancia: 'direita',
  fracaoEjecao: 55,
  pressaoDiastolicaFinalVe: 12,
  hemostasia: 'pulseira_compressiva',
  complicacoes: null,
  conclusao: 'Lesão uniarterial tratada.',
  condutaIndicada: 'angioplastia',
  primeiroOperador: 1,
  segundoOperador: 2,
  anestesista: null,
  achados: [achado()],
  ...x,
});
const campos = (r: RegistroHemodinamica, m: 'rascunho' | 'concluir') =>
  conferirRegistroHemodinamica(r, m).map((p) => p.campo);

describe('conferirRegistroHemodinamica', () => {
  it('aceita o registro completo na conclusão', () => {
    expect(conferirRegistroHemodinamica(base(), 'concluir')).toEqual([]);
  });

  it('o rascunho só exige via, início e primeiro operador', () => {
    const r = base({
      fimEm: null,
      hemostasia: null,
      conclusao: null,
      condutaIndicada: null,
      achados: [],
      tempoFluoroscopiaSegundos: null,
      kermaReferenciaMgy: null,
      produtoDoseAreaGycm2: null,
    });
    expect(campos(r, 'rascunho')).toEqual([]);
    expect(campos({ ...r, viaAcesso: null, primeiroOperador: null, inicioEm: null }, 'rascunho')).toEqual([
      'viaAcesso',
      'primeiroOperador',
      'inicioEm',
    ]);
  });

  it('a conclusão exige fim, hemostasia, conclusão, conduta, achado e a dose (RDC 611/2022)', () => {
    const r = base({
      fimEm: null,
      hemostasia: null,
      conclusao: ' ',
      condutaIndicada: null,
      achados: [],
      tempoFluoroscopiaSegundos: null,
      kermaReferenciaMgy: null,
      produtoDoseAreaGycm2: null,
    });
    expect(campos(r, 'concluir')).toEqual([
      'fimEm',
      'hemostasia',
      'conclusao',
      'condutaIndicada',
      'achados',
      'tempoFluoroscopiaSegundos',
      'kermaReferenciaMgy',
    ]);
    // Basta um dos dois indicadores de dose (kerma de referência ou produto dose-área).
    expect(campos(base({ kermaReferenciaMgy: null }), 'concluir')).toEqual([]);
  });

  it('recusa tempos fora de ordem e procedimento de mais de 24 horas', () => {
    expect(campos(base({ fimEm: '2030-03-10T09:00:00.000Z' }), 'rascunho')).toEqual(['fimEm']);
    expect(campos(base({ fimEm: '2030-03-11T11:00:00.000Z' }), 'rascunho')).toEqual(['fimEm']);
    expect(campos(base({ inicioEm: 'ontem' }), 'rascunho')).toEqual(['inicioEm']);
  });

  it('equipe: segundo operador e anestesista são outras pessoas; anestesia geral exige anestesista', () => {
    expect(campos(base({ segundoOperador: 1 }), 'rascunho')).toEqual(['segundoOperador']);
    expect(campos(base({ anestesia: 'geral' }), 'rascunho')).toEqual(['anestesista']);
    expect(campos(base({ anestesia: 'geral', anestesista: 1 }), 'rascunho')).toEqual(['anestesista']);
    expect(campos(base({ anestesia: 'geral', anestesista: 3 }), 'rascunho')).toEqual([]);
  });

  it('faixas: introdutor, contraste, fração de ejeção, pressão e valores de lista', () => {
    expect(
      campos(
        base({
          introdutorFrench: 40,
          contrasteVolumeMl: -1,
          fracaoEjecao: 120,
          pressaoDiastolicaFinalVe: 90,
          viaAcesso: 'jugular',
          dominancia: 'mista',
        }),
        'rascunho',
      ),
    ).toEqual([
      'viaAcesso',
      'introdutorFrench',
      'contrasteVolumeMl',
      'dominancia',
      'fracaoEjecao',
      'pressaoDiastolicaFinalVe',
    ]);
    expect(campos(base({ contrasteNome: null }), 'rascunho')).toEqual(['contrasteNome']);
  });

  it('achados: grau coerente com o tipo, TIMI, stent só com angioplastia, vaso e segmento sem repetição', () => {
    const r = base({
      achados: [
        achado({ grauPercentual: null }),
        achado({ vaso: 'Circunflexa', tipo: 'oclusao', grauPercentual: 90, fluxoTimi: 3 }),
        achado({ vaso: 'Coronária direita', tipo: 'normal', grauPercentual: 30, stentImplantado: true }),
        achado({ vaso: 'Diagonal', fluxoTimi: 4, conduta: 'nenhuma' }),
        achado({ vaso: 'Descendente anterior', segmento: 'Proximal ' }),
        achado({ vaso: ' ', grauPercentual: 100 }),
      ],
    });
    expect(campos(r, 'rascunho')).toEqual([
      'achados.0.grauPercentual',
      'achados.1.grauPercentual',
      'achados.1.fluxoTimi',
      'achados.2.grauPercentual',
      'achados.2.stentImplantado',
      'achados.3.fluxoTimi',
      'achados.3.stentImplantado',
      'achados.4.segmento',
      'achados.5.vaso',
      'achados.5.grauPercentual',
    ]);
  });

  it('a conclusão recusa conduta só clínica quando há achado tratado por angioplastia', () => {
    expect(campos(base({ condutaIndicada: 'tratamento_clinico' }), 'concluir')).toEqual(['condutaIndicada']);
    expect(campos(base({ condutaIndicada: 'tratamento_clinico' }), 'rascunho')).toEqual([]);
  });
});

describe('alertasHemodinamica e lesões', () => {
  it('sem alerta no procedimento habitual', () => {
    expect(alertasHemodinamica(base())).toEqual([]);
  });

  it('dose substancial pelo kerma (5 Gy) ou pelo produto dose-área (500 Gy·cm²)', () => {
    expect(alertasHemodinamica(base({ kermaReferenciaMgy: 5000 }))).toEqual(['dose-substancial']);
    expect(alertasHemodinamica(base({ kermaReferenciaMgy: null, produtoDoseAreaGycm2: 500 }))).toEqual([
      'dose-substancial',
    ]);
    expect(alertasHemodinamica(base({ kermaReferenciaMgy: 4999, produtoDoseAreaGycm2: 499 }))).toEqual([]);
  });

  it('fluoroscopia de uma hora, contraste acima de 300 mL e lesão do tronco', () => {
    expect(
      alertasHemodinamica(
        base({
          tempoFluoroscopiaSegundos: 3600,
          contrasteVolumeMl: 301,
          achados: [achado({ vaso: 'Tronco da coronária esquerda', grauPercentual: 50 })],
        }),
      ),
    ).toEqual(['fluoroscopia-prolongada', 'contraste-elevado', 'lesao-tronco']);
    expect(alertasHemodinamica(base({ achados: [achado({ vaso: 'TCE', grauPercentual: 40 })] }))).toEqual([]);
  });

  it('lesão significativa: 70% nos vasos, 50% no tronco, oclusão sempre; conta vasos distintos', () => {
    expect(lesaoSignificativa(achado({ grauPercentual: 69 }))).toBe(false);
    expect(lesaoSignificativa(achado({ grauPercentual: 70 }))).toBe(true);
    expect(lesaoSignificativa(achado({ vaso: 'Tronco', grauPercentual: 50 }))).toBe(true);
    expect(lesaoSignificativa(achado({ tipo: 'oclusao', grauPercentual: null }))).toBe(true);
    expect(lesaoSignificativa(achado({ tipo: 'ectasia', grauPercentual: null }))).toBe(false);
    expect(
      vasosComLesaoSignificativa([
        achado(),
        achado({ segmento: 'médio' }),
        achado({ vaso: 'Circunflexa', tipo: 'oclusao', grauPercentual: 100 }),
        achado({ vaso: 'Coronária direita', grauPercentual: 40 }),
      ]),
    ).toBe(2);
  });

  it('achadoMudou compara o conteúdo, sem diferença por espaço', () => {
    expect(achadoMudou(achado(), achado({ vaso: ' Descendente anterior ' }))).toBe(false);
    expect(achadoMudou(achado(), achado({ grauPercentual: 90 }))).toBe(true);
    expect(achadoMudou(achado(), achado({ stentImplantado: false }))).toBe(true);
  });
});

describe('desfecho do exame pedido', () => {
  it('pedido cancelado ou recusado não está em execução', () => {
    expect(itemEmExecucaoHemodinamica('solicitado')).toBe(true);
    expect(itemEmExecucaoHemodinamica('agendado')).toBe(true);
    expect(itemEmExecucaoHemodinamica('cancelado')).toBe(false);
    expect(itemEmExecucaoHemodinamica('recusado')).toBe(false);
  });
  it('o registro cancelado é histórico e não ocupa o exame; o em andamento e o concluído ocupam', () => {
    expect(registroOcupaExame('em_andamento')).toBe(true);
    expect(registroOcupaExame('concluido')).toBe(true);
    expect(registroOcupaExame('cancelado')).toBe(false);
  });
  it('refazer só depois do procedimento interrompido e com o pedido em execução', () => {
    expect(podeRefazerHemodinamica('solicitado', 'cancelado')).toBe(true);
    expect(podeRefazerHemodinamica('cancelado', 'cancelado')).toBe(false);
    expect(podeRefazerHemodinamica('solicitado', 'concluido')).toBe(false);
    expect(podeRefazerHemodinamica('solicitado', 'em_andamento')).toBe(false);
    expect(podeRefazerHemodinamica('solicitado', null)).toBe(false);
  });
});
