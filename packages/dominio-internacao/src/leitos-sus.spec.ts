import { describe, expect, it } from 'vitest';
import {
  capacidadeVigente,
  competenciaDe,
  conferirCapacidadeSus,
  conferirFimVinculo,
  conferirHabilitacaoLeitoSus,
  conferirTetoDiarias,
  conferirVinculoLeitoPrograma,
  type HabilitacaoLeitoSus,
  type LinhaCapacidadeSus,
  tetoDiariasEspeciais,
} from './leitos-sus.js';

const hab: HabilitacaoLeitoSus = {
  codigo: '2601',
  nome: 'UTI adulto tipo II',
  numeroPortaria: '100/2025',
  dataPortaria: '2025-01-10',
  vigenciaInicio: '2025-02-01',
  vigenciaFim: null,
  quantidadeLeitosHabilitados: 2,
  tipoAtendimento: 'internacao',
  permiteUsoForaPrograma: false,
  avisaUsuario: false,
};
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('habilitação de leitos do sistema público', () => {
  it('aceita a habilitação completa', () => {
    expect(conferirHabilitacaoLeitoSus(hab)).toEqual([]);
  });
  it('recusa vigência invertida, portaria pela metade, quantidade zero e aviso sem uso de fora', () => {
    const p = conferirHabilitacaoLeitoSus({
      ...hab,
      vigenciaFim: '2025-01-01',
      dataPortaria: null,
      quantidadeLeitosHabilitados: 0,
      avisaUsuario: true,
    });
    expect(campos(p)).toEqual([
      'vigenciaFim',
      'numeroPortaria',
      'quantidadeLeitosHabilitados',
      'avisaUsuario',
    ]);
  });
  it('recusa portaria posterior ao fim da vigência', () => {
    const p = conferirHabilitacaoLeitoSus({ ...hab, vigenciaFim: '2025-01-05' });
    expect(campos(p)).toContain('dataPortaria');
  });
});

describe('leitos no programa', () => {
  const base = { habilitacao: hab, habilitacaoAtiva: true };
  it('aceita o leito dentro da vigência e da quantidade', () => {
    expect(
      conferirVinculoLeitoPrograma({
        ...base,
        vinculos: [{ leito: 1, vigenciaInicio: '2025-02-01', vigenciaFim: null }],
        novo: { leito: 2, vigenciaInicio: '2025-03-01', vigenciaFim: null },
      }),
    ).toEqual([]);
  });
  it('recusa passar da quantidade habilitada, leito repetido, fora da vigência e habilitação inativa', () => {
    const vinculos = [
      { leito: 1, vigenciaInicio: '2025-02-01', vigenciaFim: null },
      { leito: 2, vigenciaInicio: '2025-02-01', vigenciaFim: null },
    ];
    expect(
      conferirVinculoLeitoPrograma({
        ...base,
        vinculos,
        novo: { leito: 3, vigenciaInicio: '2025-03-01', vigenciaFim: null },
      })[0]?.mensagem,
    ).toMatch(/permite 2 leito/);
    expect(
      campos(
        conferirVinculoLeitoPrograma({
          ...base,
          habilitacaoAtiva: false,
          vinculos,
          novo: { leito: 1, vigenciaInicio: '2025-01-01', vigenciaFim: null },
        }),
      ),
    ).toEqual(['habilitacao', 'vigenciaInicio', 'leito']);
  });
  it('o leito que saiu do programa libera a vaga', () => {
    expect(
      conferirVinculoLeitoPrograma({
        ...base,
        vinculos: [
          { leito: 1, vigenciaInicio: '2025-02-01', vigenciaFim: '2025-02-28' },
          { leito: 2, vigenciaInicio: '2025-02-01', vigenciaFim: null },
        ],
        novo: { leito: 3, vigenciaInicio: '2025-03-01', vigenciaFim: null },
      }),
    ).toEqual([]);
  });
  it('confere a saída do programa', () => {
    const v = { leito: 1, vigenciaInicio: '2025-02-01', vigenciaFim: null };
    expect(conferirFimVinculo(v, '2025-03-01')).toEqual([]);
    expect(conferirFimVinculo(v, '2025-01-01')).toHaveLength(1);
    expect(conferirFimVinculo({ ...v, vigenciaFim: '2025-02-10' }, '2025-03-01')).toHaveLength(1);
  });
});

describe('capacidade contratada e teto de diárias especiais', () => {
  const l = (o: Partial<LinhaCapacidadeSus>): LinhaCapacidadeSus => ({
    id: 1,
    especialidade: 7,
    competencia: '2025-03-01',
    quantidadeLeitos: 10,
    criticaLiberada: false,
    operacao: 'inclusao',
    ocorridoEm: '2025-03-01T10:00:00.000Z',
    ...o,
  });
  it('competência é o primeiro dia do mês', () => {
    expect(competenciaDe('2025-03')).toBe('2025-03-01');
    expect(competenciaDe('2025-03-17')).toBe('2025-03-01');
    expect(competenciaDe('2025-13')).toBeNull();
  });
  it('a vigente é a última linha da competência; a exclusão zera', () => {
    const h = [
      l({}),
      l({ id: 2, quantidadeLeitos: 12, operacao: 'alteracao', ocorridoEm: '2025-03-05T10:00:00.000Z' }),
    ];
    expect(capacidadeVigente(h, 7, '2025-03-01')?.quantidadeLeitos).toBe(12);
    expect(
      capacidadeVigente(
        [...h, l({ id: 3, operacao: 'exclusao', ocorridoEm: '2025-03-06T00:00:00.000Z' })],
        7,
        '2025-03-01',
      ),
    ).toBeNull();
    expect(capacidadeVigente(h, 8, '2025-03-01')).toBeNull();
  });
  it('a nova linha é inclusão, alteração ou exclusão, e recusa o que não muda', () => {
    const base = { competencia: '2025-03-01', quantidadeLeitos: 10, criticaLiberada: false, excluir: false };
    expect(conferirCapacidadeSus({ ...base, vigente: null }).operacao).toBe('inclusao');
    expect(conferirCapacidadeSus({ ...base, quantidadeLeitos: 11, vigente: l({}) }).operacao).toBe(
      'alteracao',
    );
    expect(conferirCapacidadeSus({ ...base, vigente: l({}) }).problemas).toHaveLength(1);
    expect(conferirCapacidadeSus({ ...base, excluir: true, vigente: l({}) }).operacao).toBe('exclusao');
    expect(conferirCapacidadeSus({ ...base, excluir: true, vigente: null }).operacao).toBeNull();
    expect(
      campos(
        conferirCapacidadeSus({ ...base, competencia: '2025-03-02', quantidadeLeitos: -1, vigente: null })
          .problemas,
      ),
    ).toEqual(['competencia', 'quantidadeLeitos']);
  });
  it('teto = leitos × dias do mês; acima sem liberação é crítica', () => {
    expect(tetoDiariasEspeciais(10, '2024-02-01')).toBe(290);
    expect(conferirTetoDiarias({ diarias: 300, vigente: l({}), competencia: '2025-03-01' })).toEqual({
      teto: 310,
      excedente: 0,
      situacao: 'dentro',
    });
    expect(conferirTetoDiarias({ diarias: 320, vigente: l({}), competencia: '2025-03-01' }).situacao).toBe(
      'critica',
    );
    expect(
      conferirTetoDiarias({ diarias: 320, vigente: l({ criticaLiberada: true }), competencia: '2025-03-01' })
        .situacao,
    ).toBe('liberado');
    expect(conferirTetoDiarias({ diarias: 1, vigente: null, competencia: '2025-03-01' }).situacao).toBe(
      'sem_capacidade',
    );
  });
});
