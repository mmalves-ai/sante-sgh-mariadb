import { describe, expect, it } from 'vitest';
import {
  carenciasComPortabilidade,
  cptRestringe,
  type DadosDeclaracao,
  imcDaDeclaracao,
  mesesCompletos,
  passoDaDeclaracao,
  passoDaPortabilidade,
  permanenciaMinimaMeses,
  planoDaCpt,
  prazoRespostaPortabilidade,
  problemasDaAprovacaoPortabilidade,
  problemasDaDeclaracaoSaude,
  problemasDaDecisaoDlp,
  problemasDaPortabilidade,
  problemasDoEncerramentoCpt,
} from './declaracao-saude.js';

const cod = (ps: readonly { codigo: string }[]) => ps.map((x) => x.codigo);
const base: DadosDeclaracao = {
  preenchidaEm: '2026-03-01',
  hoje: '2026-03-02',
  pesoKg: 80,
  alturaM: 1.8,
  entrevistaQualificada: false,
  medicoOrientador: null,
  dispensouOrientacao: true,
  respostas: [
    { pergunta: 1, afirmativa: false, texto: null, complemento: null },
    { pergunta: 2, afirmativa: false, texto: null, complemento: null },
  ],
  obrigatorias: [1, 2],
  perguntas: [1, 2, 3],
  doencas: [],
};

describe('declaração de saúde', () => {
  it('aceita a declaração sem doença e calcula o IMC', () => {
    expect(problemasDaDeclaracaoSaude(base)).toEqual([]);
    expect(imcDaDeclaracao(80, 1.8)).toBe(24.7);
    expect(imcDaDeclaracao(null, 1.8)).toBeNull();
  });
  it('entrevista qualificada exige médico e não combina com a orientação dispensada', () => {
    expect(cod(problemasDaDeclaracaoSaude({ ...base, entrevistaQualificada: true }))).toEqual([
      'medico-orientador',
      'orientacao-contraditoria',
    ]);
    expect(
      problemasDaDeclaracaoSaude({
        ...base,
        entrevistaQualificada: true,
        medicoOrientador: 9,
        dispensouOrientacao: false,
      }),
    ).toEqual([]);
  });
  it('resposta sim pede detalhe e CID; obrigatória sem resposta é recusada', () => {
    const r = problemasDaDeclaracaoSaude({
      ...base,
      respostas: [{ pergunta: 1, afirmativa: true, texto: null, complemento: ' ' }],
    });
    expect(cod(r)).toEqual(['complemento-obrigatorio', 'resposta-obrigatoria', 'doenca-nao-informada']);
    expect(
      problemasDaDeclaracaoSaude({
        ...base,
        respostas: [
          { pergunta: 1, afirmativa: true, texto: null, complemento: 'hipertensão desde 2020' },
          { pergunta: 2, afirmativa: false, texto: null, complemento: null },
        ],
        doencas: [{ termo: 5, inicio: '2020-01-01', forma: 'declarada' }],
      }),
    ).toEqual([]);
  });
  it('recusa pergunta de fora, resposta repetida, data futura, doença repetida e posterior', () => {
    const r = problemasDaDeclaracaoSaude({
      ...base,
      preenchidaEm: '2026-03-05',
      pesoKg: 0,
      alturaM: 3,
      respostas: [
        ...base.respostas,
        { pergunta: 1, afirmativa: false, texto: null, complemento: null },
        { pergunta: 9, afirmativa: false, texto: null, complemento: null },
      ],
      doencas: [
        { termo: 5, inicio: '2026-04-01', forma: 'declarada' },
        { termo: 5, inicio: '2020-01-01', forma: 'outra' },
      ],
    });
    expect(cod(r)).toEqual([
      'data-futura',
      'peso-invalido',
      'altura-invalida',
      'resposta-repetida',
      'pergunta-de-outro-questionario',
      'inicio-depois-da-declaracao',
      'doenca-repetida',
      'forma-invalida',
    ]);
  });
  it('passos da declaração', () => {
    expect(passoDaDeclaracao('preenchida', 'analisada')).toBeNull();
    expect(passoDaDeclaracao('analisada', 'cancelada')?.codigo).toBe('passo-invalido');
    expect(passoDaDeclaracao('x', 'analisada')?.codigo).toBe('situacao-invalida');
  });
});

describe('doença preexistente e CPT', () => {
  const dec = {
    decisaoAtual: 'em_analise',
    decisao: 'cobertura_parcial_temporaria',
    prazoMeses: 24,
    percentualAgravo: null,
    adesao: '2026-03-01',
    hoje: '2026-03-10',
    tipoContratacao: 'individual_familiar',
    participantesNoContrato: 1,
  };
  it('CPT de até 24 meses da adesão; fim na véspera', () => {
    expect(problemasDaDecisaoDlp(dec)).toEqual([]);
    expect(planoDaCpt('2026-03-01', 24)).toEqual({ inicio: '2026-03-01', fimPrevisto: '2028-02-29' });
    expect(cod(problemasDaDecisaoDlp({ ...dec, prazoMeses: 25 }))).toEqual(['prazo-invalido']);
    expect(cod(problemasDaDecisaoDlp({ ...dec, prazoMeses: 6, hoje: '2026-10-01' }))).toEqual([
      'cpt-vencida',
    ]);
  });
  it('agravo com percentual; decisão única; coletivo empresarial com 30 ou mais só sem restrição', () => {
    expect(cod(problemasDaDecisaoDlp({ ...dec, decisao: 'agravo' }))).toEqual(['agravo-invalido']);
    expect(problemasDaDecisaoDlp({ ...dec, decisao: 'agravo', percentualAgravo: 15 })).toEqual([]);
    expect(cod(problemasDaDecisaoDlp({ ...dec, decisaoAtual: 'agravo', decisao: 'em_analise' }))).toEqual([
      'ja-decidida',
      'decisao-invalida',
    ]);
    const emp = { ...dec, tipoContratacao: 'coletivo_empresarial', participantesNoContrato: 30 };
    expect(cod(problemasDaDecisaoDlp(emp))).toEqual(['cpt-nao-cabe']);
    expect(problemasDaDecisaoDlp({ ...emp, decisao: 'sem_restricao' })).toEqual([]);
    expect(problemasDaDecisaoDlp({ ...emp, participantesNoContrato: 29 })).toEqual([]);
  });
  it('a CPT restringe o CID e a categoria só na vigência', () => {
    const cpts = [{ codigoCid: 'I10', inicio: '2026-03-01', fimPrevisto: '2028-02-29', situacao: 'vigente' }];
    expect(cptRestringe(cpts, 'I10', '2026-05-01')).toBe(true);
    expect(cptRestringe([{ ...cpts[0]!, codigoCid: 'E11' }], 'E11.9', '2026-05-01')).toBe(true);
    expect(cptRestringe(cpts, 'I10', '2028-03-01')).toBe(false);
    expect(cptRestringe([{ ...cpts[0]!, situacao: 'encerrada' }], 'I10', '2026-05-01')).toBe(false);
    expect(cptRestringe(cpts, 'J45', '2026-05-01')).toBe(false);
  });
  it('encerramento da CPT', () => {
    expect(
      problemasDoEncerramentoCpt({
        situacao: 'vigente',
        inicio: '2026-03-01',
        data: '2026-06-01',
        motivo: 'perícia',
      }),
    ).toEqual([]);
    expect(
      cod(
        problemasDoEncerramentoCpt({
          situacao: 'encerrada',
          inicio: '2026-03-01',
          data: '2026-02-01',
          motivo: null,
        }),
      ),
    ).toEqual(['cpt-nao-vigente', 'data-antes-do-inicio', 'motivo-obrigatorio']);
  });
});

describe('portabilidade de carências', () => {
  it('pedido: registro, datas e prazo de resposta de 10 dias', () => {
    const ok = {
      direcao: 'recebida',
      modalidade: 'ordinaria',
      registroAnsOrigem: '123456',
      vinculoInicio: '2023-01-10',
      solicitadoEm: '2026-03-01',
      hoje: '2026-03-01',
    };
    expect(problemasDaPortabilidade(ok)).toEqual([]);
    expect(
      cod(
        problemasDaPortabilidade({
          ...ok,
          direcao: 'x',
          registroAnsOrigem: '12',
          vinculoInicio: '2026-04-01',
        }),
      ),
    ).toEqual(['direcao-invalida', 'registro-ans-invalido', 'vinculo-depois-do-pedido']);
    expect(prazoRespostaPortabilidade('2026-03-01')).toBe('2026-03-11');
    expect(passoDaPortabilidade('recebida', 'aprovada')).toBeNull();
    expect(passoDaPortabilidade('aprovada', 'recusada')?.codigo).toBe('passo-invalido');
  });
  it('requisitos: adimplência, permanência (24, 36 com CPT, 12 nas seguintes) e faixa na ordinária', () => {
    expect(mesesCompletos('2024-03-02', '2026-03-01')).toBe(23);
    expect(mesesCompletos('2024-03-01', '2026-03-01')).toBe(24);
    expect(permanenciaMinimaMeses({ cumpriuCptNaOrigem: true, jaPortouAntes: false })).toBe(36);
    expect(permanenciaMinimaMeses({ cumpriuCptNaOrigem: true, jaPortouAntes: true })).toBe(12);
    const r = {
      modalidade: 'ordinaria',
      vinculoInicio: '2024-03-01',
      solicitadoEm: '2026-03-01',
      adimplente: true,
      faixaPrecoCompativel: true,
      cumpriuCptNaOrigem: false,
      jaPortouAntes: false,
    };
    expect(problemasDaAprovacaoPortabilidade(r)).toEqual([]);
    expect(
      cod(
        problemasDaAprovacaoPortabilidade({
          ...r,
          adimplente: false,
          cumpriuCptNaOrigem: true,
          faixaPrecoCompativel: false,
        }),
      ),
    ).toEqual(['inadimplente', 'permanencia-insuficiente', 'faixa-incompativel']);
    expect(
      problemasDaAprovacaoPortabilidade({
        ...r,
        modalidade: 'extraordinaria',
        vinculoInicio: null,
        faixaPrecoCompativel: false,
      }),
    ).toEqual([]);
  });
  it('aprovada, toda carência é aproveitada', () => {
    expect(carenciasComPortabilidade([{ id: 3, inicio: '2026-03-01', dias: 180 }])).toEqual([
      { id: 3, aproveitados: 180, cumpridaEm: '2026-03-01' },
    ]);
  });
});
