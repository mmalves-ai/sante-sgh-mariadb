// Laudos específicos da APAC e sessões (F7, 06-SUS linha 56). Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import {
  type ApacParaSessao,
  familiaDoLaudoEspecifico,
  familiaLaudoDoProcedimento,
  type LaudoAuditivaApac,
  type LaudoMedicamentoApac,
  type LaudoOdontologiaApac,
  type LaudoOncologiaApac,
  laudoEspecificoDaFamilia,
  competenciasDoPeriodoApac,
  problemasDaSessao,
  problemasDoComplemento,
} from './apac-laudos-especificos.js';

const HOJE = '2026-03-20';
const campos = (p: readonly { campo: string }[]) => p.map((x) => x.campo);

const onco: LaudoOncologiaApac = {
  tipoTratamento: 'quimioterapia',
  localizacaoPrimaria: 1,
  topografiaCid: null,
  estadiamentoTnm: 'T2N0M0',
  grauHistopatologico: 'G2',
  dataDiagnostico: '2026-01-10',
  dataIdentificacaoPatologica: '2026-01-12',
  linfonodosInvadidos: false,
  metastase: false,
  metastaseLocal: null,
  finalidade: 2,
  esquema: 3,
  areaIrradiada: null,
  camposInsercao: null,
  dataInicioTratamento: '2026-02-01',
  continuidadeTratamento: false,
  tratamentoAnterior: false,
  tipoTratamentoAnterior: null,
  inicioTratamentoAnterior: null,
  fimTratamentoAnterior: null,
  observacao: null,
};
const auditiva: LaudoAuditivaApac = {
  cidCausaBasica: 'H90.3',
  cidCausaAssociada: null,
  justificativa: null,
  dificuldadeAuditiva: true,
  ouvidoDireito: true,
  ouvidoEsquerdo: false,
  evolucao: 'estavel',
  zumbido: false,
  tontura: false,
  causas: ['presbiacusia'],
  outrasCausas: null,
  examesRealizados: 'audiometria',
  aparelhoIndicado: null,
  acompanhamento: null,
};
const medicamento: LaudoMedicamentoApac = {
  medicamento: '0604010010',
  cidPrincipal: 'E230',
  cidSecundario: null,
  pesoKg: 70,
  alturaCm: 170,
  dosePrescrita: '1 por dia',
  quantidades: [30, 30, 30],
  periodoInicio: '2026-03-01',
  periodoFim: '2026-05-31',
};
const odonto: LaudoOdontologiaApac = {
  anomaliaCraniofacial: false,
  descricaoAnomalia: null,
  marcas: ['implante_metalico', 'desdentado_parcial'],
  justificativaTrocaAparelho: null,
  especificacaoDentes: null,
  quantidadeImplantes: 2,
  condicaoBucal: null,
  tratamentoProposto: 'implante',
};

describe('família do laudo pelo procedimento', () => {
  it('separa oncologia (radio e quimio), terapia renal, auditiva, medicamento e odontologia', () => {
    expect(familiaLaudoDoProcedimento('03.04.01.009-0')).toBe('oncologia_radioterapia');
    expect(familiaLaudoDoProcedimento('0304020010')).toBe('oncologia_quimioterapia');
    expect(familiaLaudoDoProcedimento('0305010107')).toBe('nefrologia');
    expect(familiaLaudoDoProcedimento('0701030011')).toBe('saude_auditiva');
    expect(familiaLaudoDoProcedimento('0211070017')).toBe('saude_auditiva');
    expect(familiaLaudoDoProcedimento('0604010010')).toBe('medicamento');
    expect(familiaLaudoDoProcedimento('0307040011')).toBe('odontologia');
    expect(familiaLaudoDoProcedimento('0899990001')).toBe('outro');
    expect(laudoEspecificoDaFamilia('oncologia_radioterapia')).toBe('oncologia');
    expect(laudoEspecificoDaFamilia('outro')).toBeNull();
    expect(familiaDoLaudoEspecifico('oncologia', 'radioterapia')).toBe('oncologia_radioterapia');
    expect(familiaDoLaudoEspecifico('auditiva')).toBe('saude_auditiva');
  });
});

describe('conferência do laudo complementar', () => {
  const apac = (procedimento: string, situacao: 'solicitada' | 'encerrada' = 'solicitada') => ({
    situacao,
    procedimento,
    dataSolicitacao: '2026-03-01',
  });

  it('aceita os quatro laudos completos', () => {
    expect(problemasDoComplemento(apac('0304020010'), { laudo: 'oncologia', dados: onco }, HOJE)).toEqual([]);
    expect(problemasDoComplemento(apac('0701030011'), { laudo: 'auditiva', dados: auditiva }, HOJE)).toEqual(
      [],
    );
    expect(
      problemasDoComplemento(apac('0604010010'), { laudo: 'medicamento', dados: medicamento }, HOJE),
    ).toEqual([]);
    expect(problemasDoComplemento(apac('0307040011'), { laudo: 'odontologia', dados: odonto }, HOJE)).toEqual(
      [],
    );
  });

  it('recusa o laudo de outra família e a APAC encerrada', () => {
    const p = problemasDoComplemento(
      apac('0304020010', 'encerrada'),
      { laudo: 'auditiva', dados: auditiva },
      HOJE,
    );
    expect(campos(p)).toEqual(['situacao', 'laudo']);
    // Procedimento sem família exigida aceita qualquer laudo complementar.
    expect(problemasDoComplemento(apac('0899990001'), { laudo: 'auditiva', dados: auditiva }, HOJE)).toEqual(
      [],
    );
  });

  it('oncologia: radioterapia pede área e campos; metástase, datas e tratamento anterior coerentes', () => {
    const p = problemasDoComplemento(
      apac('0304010090'),
      {
        laudo: 'oncologia',
        dados: {
          ...onco,
          tipoTratamento: 'radioterapia',
          esquema: null,
          metastaseLocal: 4,
          dataInicioTratamento: '2026-01-01',
          dataDiagnostico: '2026-12-01',
          tratamentoAnterior: true,
          inicioTratamentoAnterior: '2025-06-01',
          fimTratamentoAnterior: '2025-05-01',
        },
      },
      HOJE,
    );
    expect(campos(p)).toEqual([
      'dataDiagnostico',
      'dataInicioTratamento',
      'metastaseLocal',
      'areaIrradiada',
      'camposInsercao',
      'tipoTratamentoAnterior',
      'fimTratamentoAnterior',
    ]);
    const q = problemasDoComplemento(
      apac('0304020010'),
      { laudo: 'oncologia', dados: { ...onco, esquema: null, dataInicioTratamento: '2026-01-01' } },
      HOJE,
    );
    expect(campos(q)).toEqual(['dataInicioTratamento', 'esquema']);
  });

  it('auditiva: ouvido, CID e causa', () => {
    const p = problemasDoComplemento(
      apac('0701030011'),
      {
        laudo: 'auditiva',
        dados: { ...auditiva, ouvidoDireito: false, cidCausaBasica: 'XX', causas: [] },
      },
      HOJE,
    );
    expect(campos(p)).toEqual(['cidCausaBasica', 'ouvido', 'causas']);
  });

  it('medicamento: grupo 06, peso, quantidade do 1º mês e período de até 3 competências', () => {
    const p = problemasDoComplemento(
      apac('0604010010'),
      {
        laudo: 'medicamento',
        dados: {
          ...medicamento,
          medicamento: '0304020010',
          pesoKg: 0,
          quantidades: [null, 10, -1],
          periodoFim: '2026-06-01',
        },
      },
      HOJE,
    );
    expect(campos(p)).toEqual(['medicamento', 'pesoKg', 'quantidades', 'quantidades', 'periodo']);
    expect(competenciasDoPeriodoApac('2026-01-15', '2026-03-10')).toBe(3);
  });

  it('odontologia: implantes, troca, dentes, osteotomia e tratamento proposto', () => {
    const p = problemasDoComplemento(
      apac('0307040011'),
      {
        laudo: 'odontologia',
        dados: {
          ...odonto,
          marcas: [
            'troca_aparelho',
            'dente_incluso',
            'com_osteotomia',
            'desdentado_total',
            'desdentado_parcial',
          ],
          quantidadeImplantes: 2,
          tratamentoProposto: null,
        },
      },
      HOJE,
    );
    expect(campos(p)).toEqual([
      'justificativaTrocaAparelho',
      'especificacaoDentes',
      'marcas',
      'marcas',
      'quantidadeImplantes',
      'tratamentoProposto',
    ]);
    const q = problemasDoComplemento(
      apac('0307040011'),
      { laudo: 'odontologia', dados: { ...odonto, quantidadeImplantes: 4 } },
      HOJE,
    );
    expect(campos(q)).toEqual(['quantidadeImplantes']);
  });
});

describe('sessão da APAC', () => {
  const a: ApacParaSessao = {
    situacao: 'autorizada',
    procedimento: '0305010107',
    dataSolicitacao: '2026-01-05',
    validadeInicio: '2026-01-01',
    validadeFim: '2026-03-31',
    dataEncerramento: null,
  };
  const s = {
    data: '2026-03-10',
    procedimento: '',
    quantidade: 1,
    comparecimento: 'compareceu' as const,
    modalidade: 'hemodialise' as const,
    kits: null,
  };

  it('aceita a sessão de diálise na validade', () => {
    expect(problemasDaSessao(a, s, HOJE)).toEqual([]);
    expect(problemasDaSessao(a, { ...s, modalidade: 'capd', kits: 30 }, HOJE)).toEqual([]);
    expect(problemasDaSessao(a, { ...s, comparecimento: 'faltou', modalidade: null }, HOJE)).toEqual([]);
  });

  it('recusa fora da validade, futura, depois do encerramento e na APAC não autorizada', () => {
    expect(campos(problemasDaSessao(a, { ...s, data: '2025-12-31' }, HOJE))).toEqual(['data']);
    expect(campos(problemasDaSessao(a, { ...s, data: '2026-03-25' }, HOJE))).toEqual(['data']);
    expect(
      campos(problemasDaSessao({ ...a, dataEncerramento: '2026-02-28' }, { ...s, data: '2026-03-01' }, HOJE)),
    ).toEqual(['data']);
    expect(campos(problemasDaSessao({ ...a, situacao: 'solicitada' }, s, HOJE))).toEqual(['situacao']);
    expect(campos(problemasDaSessao(a, { ...s, data: '2026-02-30x' }, HOJE))).toEqual(['data']);
  });

  it('modalidade só na terapia renal (e exigida quando compareceu); kits só na peritoneal', () => {
    expect(campos(problemasDaSessao(a, { ...s, modalidade: null }, HOJE))).toEqual(['modalidade']);
    expect(campos(problemasDaSessao(a, { ...s, kits: 3 }, HOJE))).toEqual(['kits']);
    expect(
      campos(problemasDaSessao({ ...a, procedimento: '0304010090' }, { ...s, quantidade: 0 }, HOJE)),
    ).toEqual(['quantidade', 'modalidade']);
  });
});
