// Restrições próprias do hospital no motor de alertas (03-PEP L108): ajuste renal e hepático por faixa, restrição de
// posologia por paciente e setor, configuração do alerta por setor. Massa sintética.
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { avaliarAlertas, impede } from './motor.js';
import {
  type ContextoRestricoes,
  type FaixaAjusteRenal,
  faixaDoPaciente,
  problemasFaixaRenal,
  problemasRestricao,
  type RestricaoPosologia,
} from './restricoes.js';

const P = produto({ produto: 10, doseMaxima: 1000 });
const faixa = (f: Partial<FaixaAjusteRenal>): FaixaAjusteRenal => ({
  id: 1,
  produtos: [10],
  criterio: 'depuracao_creatinina',
  faixaMinima: 10,
  faixaMaxima: 30,
  classeHepatica: null,
  modalidadeDialise: null,
  ajuste: 'reduzir_dose',
  percentualDose: null,
  doseMaxima: 500,
  intervaloHoras: null,
  comportamento: 'exigir_justificativa',
  orientacao: null,
  ...f,
});
const restricao = (r: Partial<RestricaoPosologia>): RestricaoPosologia => ({
  id: 7,
  produtos: [10],
  setor: null,
  via: null,
  sexo: null,
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  pesoMinimoKg: null,
  pesoMaximoKg: null,
  gestante: null,
  lactante: null,
  tipo: 'contraindicacao',
  doseMaxima: null,
  doseMaximaDiaria: null,
  acao: 'bloquear',
  mensagem: 'Contraindicado nesta faixa',
  ...r,
});
const rs = (r: Partial<ContextoRestricoes>): ContextoRestricoes => ({
  estabelecimento: 1,
  setor: 5,
  paciente: { idadeDias: 3650, sexo: 2, gestante: null, lactante: null, classeHepatica: null, dialise: null },
  ajustesRenais: [],
  posologia: [],
  configuracoes: [],
  ...r,
});
const avaliar = (dose: number, r: ContextoRestricoes, extra: Parameters<typeof item>[2] = {}, cl = 20) =>
  avaliarAlertas({
    itens: [item('i1', [{ produto: P, dose }], extra)],
    ctx: contexto({ paciente: { clearance: cl, pesoKg: 30 }, restricoes: r }),
    foraDaCategoria: [],
    dietas: [],
    decisoes: new Map(),
  });

describe('ajuste renal por faixa', () => {
  it('dose acima do limite da faixa do clearance: alerta com o comportamento do cadastro', () => {
    const a = avaliar(600, rs({ ajustesRenais: [faixa({})] }));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'ajuste-renal', nivel: 'justificar', id: 'ajuste-renal-faixa:10:1' });
    expect(impede(a).impede).toBe(true);
  });
  it('fora da faixa ou dose dentro do limite: nenhum alerta', () => {
    expect(avaliar(600, rs({ ajustesRenais: [faixa({})] }), {}, 50)).toHaveLength(0);
    expect(avaliar(400, rs({ ajustesRenais: [faixa({})] }))).toHaveLength(0);
  });
  it('percentual da dose usual e intervalo mínimo da faixa', () => {
    const f = faixa({
      ajuste: 'reduzir_dose_e_intervalo',
      doseMaxima: null,
      percentualDose: 50,
      intervaloHoras: 12,
    });
    const a = avaliar(600, rs({ ajustesRenais: [f] }));
    expect(a[0]!.detalhe).toContain('dose acima de 500');
    expect(a[0]!.detalhe).toContain('intervalo menor que 12 h');
  });
  it('evitar: bloqueio pelo cadastro; Child-Pugh e diálise têm precedência sobre o clearance', () => {
    const ev = faixa({ id: 2, ajuste: 'evitar', doseMaxima: null, comportamento: 'bloquear' });
    expect(avaliar(1, rs({ ajustesRenais: [ev] }))[0]!.nivel).toBe('bloqueio');
    const hep = faixa({
      id: 3,
      criterio: 'child_pugh',
      classeHepatica: 'C',
      faixaMinima: null,
      faixaMaxima: null,
    });
    const pac = {
      idadeDias: 1,
      sexo: null,
      gestante: null,
      lactante: null,
      classeHepatica: 'C' as const,
      dialise: null,
    };
    expect(faixaDoPaciente([faixa({}), hep], 10, 20, pac)?.id).toBe(3);
  });
  it('validação do cadastro na hora', () => {
    expect(problemasFaixaRenal({ ...faixa({ faixaMinima: 40, faixaMaxima: 30 }) })).toContain(
      'faixa-invertida',
    );
    expect(problemasFaixaRenal({ ...faixa({ criterio: 'child_pugh' }) })).toContain(
      'classe-hepatica-obrigatoria',
    );
    expect(problemasFaixaRenal({ ...faixa({ doseMaxima: null }) })).toContain('reducao-sem-limite');
    expect(problemasFaixaRenal({ ...faixa({ ajuste: 'aumentar_intervalo' }) })).toContain(
      'intervalo-obrigatorio',
    );
    expect(problemasFaixaRenal(faixa({}))).toEqual([]);
  });
});

describe('restrição de posologia', () => {
  it('contraindicação por idade: dispara dentro da faixa e não fora', () => {
    const r = restricao({ idadeMaximaDias: 4000 });
    expect(avaliar(1, rs({ posologia: [r] }))[0]).toMatchObject({
      tipo: 'restricao-posologia',
      nivel: 'bloqueio',
    });
    expect(avaliar(1, rs({ posologia: [restricao({ idadeMinimaDias: 5000 })] }))).toHaveLength(0);
  });
  it('setor, sexo, peso e gestante recortam', () => {
    expect(avaliar(1, rs({ posologia: [restricao({ setor: 6 })] }))).toHaveLength(0);
    expect(avaliar(1, rs({ posologia: [restricao({ sexo: 1 })] }))).toHaveLength(0);
    expect(avaliar(1, rs({ posologia: [restricao({ pesoMinimoKg: 40 })] }))).toHaveLength(0);
    expect(avaliar(1, rs({ posologia: [restricao({ gestante: true })] }))).toHaveLength(0);
    expect(avaliar(1, rs({ posologia: [restricao({ setor: 5, sexo: 2, pesoMaximoKg: 40 })] }))).toHaveLength(
      1,
    );
  });
  it('dose máxima por dose e no dia; via proibida pela sigla', () => {
    const d = restricao({ tipo: 'dose_maxima', doseMaxima: 100, acao: 'avisar' });
    expect(avaliar(150, rs({ posologia: [d] }))[0]!.nivel).toBe('aviso');
    expect(avaliar(90, rs({ posologia: [d] }))).toHaveLength(0);
    const dia = restricao({ tipo: 'dose_maxima', doseMaximaDiaria: 200, acao: 'exigir_justificativa' });
    expect(avaliar(90, rs({ posologia: [dia] }))[0]!.nivel).toBe('justificar');
    const via = restricao({ tipo: 'via_proibida', via: 'IM' });
    expect(avaliar(1, rs({ posologia: [via] }), { via: 'im' })).toHaveLength(1);
    expect(avaliar(1, rs({ posologia: [via] }), { via: 'EV' })).toHaveLength(0);
  });
  it('validação do cadastro na hora', () => {
    expect(problemasRestricao(restricao({ tipo: 'dose_maxima' }))).toContain('dose-obrigatoria');
    expect(problemasRestricao(restricao({ tipo: 'via_proibida' }))).toContain('via-obrigatoria');
    expect(problemasRestricao(restricao({ mensagem: ' ' }))).toContain('mensagem-obrigatoria');
    expect(problemasRestricao(restricao({ idadeMinimaDias: 9, idadeMaximaDias: 1 }))).toContain(
      'idade-invertida',
    );
  });
});

describe('configuração do alerta por setor', () => {
  const base = {
    estabelecimento: null,
    setor: null,
    gatilhoProduto: null,
    vigenciaInicio: null,
    vigenciaFim: null,
  };
  it('a mais específica vigente troca o comportamento ou desliga o alerta no setor', () => {
    const r = rs({
      ajustesRenais: [faixa({})],
      configuracoes: [
        { id: 1, tipo: 'ajuste-renal', ...base, comportamento: 'aviso', ativo: true },
        { id: 2, tipo: 'ajuste-renal', ...base, setor: 5, comportamento: 'bloqueio', ativo: true },
      ],
    });
    expect(avaliar(600, r)[0]!.nivel).toBe('bloqueio');
    const desl = rs({
      ajustesRenais: [faixa({})],
      configuracoes: [
        { id: 3, tipo: 'ajuste-renal', ...base, setor: 5, comportamento: 'aviso', ativo: false },
      ],
    });
    expect(avaliar(600, desl)).toHaveLength(0);
  });
  it('outro setor ou fora da vigência: vale a regra', () => {
    const r = rs({
      ajustesRenais: [faixa({})],
      configuracoes: [
        { id: 4, tipo: 'ajuste-renal', ...base, setor: 9, comportamento: 'aviso', ativo: true },
        {
          id: 5,
          tipo: 'ajuste-renal',
          ...base,
          vigenciaFim: '2026-01-01',
          comportamento: 'aviso',
          ativo: true,
        },
      ],
    });
    expect(avaliar(600, r)[0]!.nivel).toBe('justificar');
  });
});
