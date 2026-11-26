import { describe, expect, it } from 'vitest';
import {
  conferirCriterio,
  conferirEstudo,
  conferirInclusao,
  conferirMudancaParticipante,
  conferirTransicaoEstudo,
  type CriterioAvaliavel,
  estudoRecruta,
  idadeEmAnos,
  triarPaciente,
} from './pesquisa-clinica.js';

const estudo = {
  codigo: 'EST-1',
  titulo: 'Estudo sintético',
  inicio: '2026-01-01',
  fim: null,
  numeroCaae: null,
  aprovacaoEticaEm: null,
};
const crit = (
  c: Partial<CriterioAvaliavel> & Pick<CriterioAvaliavel, 'id' | 'fonte'>,
): CriterioAvaliavel => ({
  tipo: 'inclusao',
  grupo: 1,
  descricao: 'x',
  exame: null,
  item: null,
  parametroVital: null,
  valorTexto: null,
  valorMinimo: null,
  valorMaximo: null,
  ...c,
});

describe('estudo', () => {
  it('em aprovação dispensa o CAAE; aprovado exige CAAE e data', () => {
    expect(conferirEstudo(estudo, 'em_aprovacao')).toEqual([]);
    expect(conferirEstudo(estudo, 'aprovada').map((p) => p.campo)).toEqual([
      'numeroCaae',
      'aprovacaoEticaEm',
    ]);
    expect(
      conferirEstudo({ ...estudo, numeroCaae: '123', aprovacaoEticaEm: '2026-01-02' }, 'recrutando'),
    ).toEqual([]);
  });
  it('fim antes do início é recusado', () => {
    expect(conferirEstudo({ ...estudo, fim: '2025-12-31' }, 'em_aprovacao')[0]?.campo).toBe('fim');
  });
  it('ciclo da situação e recrutamento', () => {
    expect(conferirTransicaoEstudo('em_aprovacao', 'aprovada')).toEqual([]);
    expect(conferirTransicaoEstudo('em_aprovacao', 'recrutando')).toHaveLength(1);
    expect(conferirTransicaoEstudo('encerrada', 'recrutando')).toHaveLength(1);
    expect(estudoRecruta('recrutando', true)).toBe(true);
    expect(estudoRecruta('recrutando', false)).toBe(false);
    expect(estudoRecruta('aprovada', true)).toBe(false);
  });
});

describe('critério', () => {
  it('exige a referência da fonte e faixa coerente', () => {
    expect(conferirCriterio(crit({ id: 1, fonte: 'exame' }))[0]?.campo).toBe('exame');
    expect(conferirCriterio(crit({ id: 1, fonte: 'idade' }))[0]?.campo).toBe('valorMinimo');
    expect(conferirCriterio(crit({ id: 1, fonte: 'diagnostico' }))[0]?.campo).toBe('valorTexto');
    expect(
      conferirCriterio(crit({ id: 1, fonte: 'idade', valorMinimo: 60, valorMaximo: 18 }))[0]?.campo,
    ).toBe('valorMaximo');
    expect(conferirCriterio(crit({ id: 1, fonte: 'manual' }))).toEqual([]);
  });
});

describe('triagem', () => {
  const fatos = { idadeAnos: 55, sexo: 'F', cids: ['C50.9', 'I10'] };
  it('sugere quando o grupo de inclusão é todo atendido e lista o que a equipe confere', () => {
    const r = triarPaciente(
      [
        crit({ id: 1, fonte: 'diagnostico', valorTexto: 'C50' }),
        crit({ id: 2, fonte: 'idade', valorMinimo: 18, valorMaximo: 70 }),
        crit({ id: 3, fonte: 'manual' }),
      ],
      fatos,
    );
    expect(r.sugerido).toBe(true);
    expect(r.atendidos).toEqual([
      { criterio: 1, valor: 'C509' },
      { criterio: 2, valor: '55 anos' },
    ]);
    expect(r.aConferir).toEqual([3]);
  });
  it('grupo alternativo (OU) e grupo incompleto (E)', () => {
    const cs = [
      crit({ id: 1, fonte: 'diagnostico', valorTexto: 'E11' }),
      crit({ id: 2, fonte: 'sexo', valorTexto: 'F' }),
      crit({ id: 3, fonte: 'sexo', valorTexto: 'F', grupo: 2 }),
    ];
    expect(triarPaciente(cs, fatos).atendidos).toEqual([{ criterio: 3, valor: 'F' }]);
    expect(triarPaciente(cs.slice(0, 2), fatos).sugerido).toBe(false);
  });
  it('exclusão atendida afasta; grupo só manual não sugere', () => {
    expect(
      triarPaciente(
        [
          crit({ id: 1, fonte: 'sexo', valorTexto: 'F' }),
          crit({ id: 2, tipo: 'exclusao', fonte: 'diagnostico', valorTexto: 'I10' }),
        ],
        fatos,
      ).sugerido,
    ).toBe(false);
    expect(triarPaciente([crit({ id: 1, fonte: 'manual' })], fatos).sugerido).toBe(false);
  });
  it('idade em anos completos', () => {
    expect(idadeEmAnos('1971-11-27', '2026-11-26')).toBe(54);
    expect(idadeEmAnos('1971-11-26', '2026-11-26')).toBe(55);
    expect(idadeEmAnos(null, '2026-11-26')).toBeNull();
  });
});

describe('participante', () => {
  it('inclusão exige TCLE com data e termo', () => {
    expect(conferirInclusao({ consentimentoEm: null, termoArquivo: null })).toHaveLength(2);
    expect(conferirInclusao({ consentimentoEm: '2026-11-26T10:00', termoArquivo: 9 })).toEqual([]);
  });
  it('saída exige motivo e segue o ciclo', () => {
    expect(conferirMudancaParticipante('incluido', 'retirado', null)[0]?.campo).toBe('motivo');
    expect(conferirMudancaParticipante('incluido', 'retirado', 'pedido do participante')).toEqual([]);
    expect(conferirMudancaParticipante('concluido', 'em_tratamento', null)).toHaveLength(1);
  });
});
