import { describe, expect, it } from 'vitest';
import {
  cobertura,
  errosAberturaObra,
  errosAgregacao,
  errosApolice,
  errosApropriacao,
  errosBemSegurado,
  errosCancelamentoObra,
  errosDesagregacao,
  type ObraParaRegra,
  planejarAtivacao,
  proximaSequencia,
  situacaoDaApolice,
  situacaoOrcamento,
  totalSegurado,
  valorAgregadoNaCompetencia,
} from './complementos.js';

const HOJE = '2026-11-25';
const bem = { id: 1, situacao: 'ativo', dataAquisicao: '2025-01-10', temMarcoAjuste: false };
const nova = {
  tipo: 'melhoria',
  bemAgregado: null,
  descricao: 'Troca do motor por um de maior potência',
  data: '2026-03-10',
  valorCent: 5_000_00,
  agregaValor: true,
};

describe('agregação de valor ao bem (CPC 27: gasto posterior soma ao custo)', () => {
  it('aceita a melhoria com valor e recusa a sem valor que soma ao custo', () => {
    expect(errosAgregacao(nova, { bem, agregado: null, hoje: HOJE })).toEqual([]);
    expect(errosAgregacao({ ...nova, valorCent: 0 }, { bem, agregado: null, hoje: HOJE })).toEqual([
      'sem-valor',
    ]);
    expect(
      errosAgregacao({ ...nova, valorCent: 0, agregaValor: false }, { bem, agregado: null, hoje: HOJE }),
    ).toEqual([]);
  });

  it('o componente precisa de outro bem, ativo e livre', () => {
    const c = { ...nova, tipo: 'componente' };
    expect(errosAgregacao(c, { bem, agregado: null, hoje: HOJE })).toEqual(['componente-sem-bem']);
    expect(errosAgregacao({ ...c, bemAgregado: 1 }, { bem, agregado: null, hoje: HOJE })).toEqual([
      'componente-proprio',
    ]);
    expect(
      errosAgregacao(
        { ...c, bemAgregado: 2 },
        { bem, agregado: { id: 2, situacao: 'baixado', jaAgregadoEm: 9 }, hoje: HOJE },
      ),
    ).toEqual(['componente-baixado', 'componente-ja-agregado']);
    expect(
      errosAgregacao(
        { ...c, bemAgregado: 2 },
        { bem, agregado: { id: 2, situacao: 'ativo', jaAgregadoEm: null }, hoje: HOJE },
      ),
    ).toEqual([]);
  });

  it('datas, bem baixado e o marco de ajuste vigente', () => {
    expect(errosAgregacao({ ...nova, data: '2024-12-31' }, { bem, agregado: null, hoje: HOJE })).toEqual([
      'data-antes-aquisicao',
    ]);
    expect(errosAgregacao({ ...nova, data: '2026-12-01' }, { bem, agregado: null, hoje: HOJE })).toEqual([
      'data-futura',
    ]);
    expect(
      errosAgregacao(nova, {
        bem: { ...bem, situacao: 'baixado', temMarcoAjuste: true },
        agregado: null,
        hoje: HOJE,
      }),
    ).toEqual(['bem-baixado', 'ajuste-vigente']);
    expect(
      errosAgregacao({ ...nova, tipo: 'x', descricao: 'ab' }, { bem, agregado: null, hoje: HOJE }),
    ).toEqual(['tipo-invalido', 'descricao-curta']);
  });

  it('entra na base da competência seguinte e sai na retirada (prospectivo)', () => {
    const lista = [
      { sequencia: 1, data: '2026-03-10', valorCent: 5_000_00, agregaValor: true, dataDesagregacao: null },
      {
        sequencia: 2,
        data: '2026-04-01',
        valorCent: 1_000_00,
        agregaValor: true,
        dataDesagregacao: '2026-07-15',
      },
      { sequencia: 3, data: '2026-01-05', valorCent: 700_00, agregaValor: false, dataDesagregacao: null },
    ];
    expect(valorAgregadoNaCompetencia(lista, '2026-03')).toBe(0);
    expect(valorAgregadoNaCompetencia(lista, '2026-04')).toBe(5_000_00);
    expect(valorAgregadoNaCompetencia(lista, '2026-05')).toBe(6_000_00);
    expect(valorAgregadoNaCompetencia(lista, '2026-07')).toBe(6_000_00);
    expect(valorAgregadoNaCompetencia(lista, '2026-08')).toBe(5_000_00);
    expect(proximaSequencia(lista)).toBe(4);
    expect(proximaSequencia([])).toBe(1);
  });

  it('a retirada registra a data uma vez só, com motivo', () => {
    const a = { data: '2026-03-10', dataDesagregacao: null };
    expect(errosDesagregacao(a, { data: '2026-05-01', motivo: 'Componente substituído' }, HOJE)).toEqual([]);
    expect(
      errosDesagregacao({ ...a, dataDesagregacao: '2026-04-01' }, { data: '2026-03-01', motivo: 'x' }, HOJE),
    ).toEqual(['ja-desagregado', 'data-antes', 'motivo-curto']);
  });
});

const obra: ObraParaRegra = {
  situacao: 'em_andamento',
  dataInicio: '2026-01-10',
  acumuladoCent: 90_000_00,
  valorOrcadoCent: 100_000_00,
  apropriacoes: [{ data: '2026-06-30', titulo: 7, nota: null, valorCent: 90_000_00 }],
};

describe('imobilizado em andamento (CPC 27: não deprecia até a ativação)', () => {
  it('abertura valida descrição, datas e orçamento', () => {
    expect(
      errosAberturaObra(
        {
          descricao: 'Reforma do centro cirúrgico',
          dataInicio: '2026-01-10',
          dataPrevista: '2026-12-31',
          valorOrcadoCent: 1,
        },
        HOJE,
      ),
    ).toEqual([]);
    expect(
      errosAberturaObra(
        { descricao: 'ab', dataInicio: '2026-12-10', dataPrevista: '2026-12-01', valorOrcadoCent: -1 },
        HOJE,
      ),
    ).toEqual(['descricao-curta', 'data-futura', 'previsao-antes-inicio', 'orcado-negativo']);
  });

  it('apropriação liga o documento, não repete e não deixa o acumulado negativo', () => {
    expect(
      errosApropriacao(obra, { data: '2026-07-01', titulo: 8, nota: null, valorCent: 5_000_00 }, HOJE),
    ).toEqual([]);
    expect(
      errosApropriacao(obra, { data: '2026-07-01', titulo: null, nota: null, valorCent: 0 }, HOJE),
    ).toEqual(['sem-documento', 'valor-zero']);
    expect(
      errosApropriacao(obra, { data: '2026-07-01', titulo: 7, nota: null, valorCent: 90_000_00 }, HOJE),
    ).toEqual(['documento-repetido']);
    expect(
      errosApropriacao(obra, { data: '2025-12-01', titulo: 7, nota: null, valorCent: -90_000_01 }, HOJE),
    ).toEqual(['data-antes-inicio', 'acumulado-negativo']);
    expect(
      errosApropriacao(
        { ...obra, situacao: 'ativado' },
        { data: '2026-07-01', titulo: 9, nota: null, valorCent: 1 },
        HOJE,
      ),
    ).toEqual(['nao-em-andamento']);
  });

  it('orçamento: dentro, alerta a partir de 90% e estouro', () => {
    expect(situacaoOrcamento(null, 1)).toEqual({ percentual: null, estado: 'sem-orcamento' });
    expect(situacaoOrcamento(100_00, 50_00).estado).toBe('dentro');
    expect(situacaoOrcamento(100_00, 90_00)).toEqual({ percentual: 90, estado: 'alerta' });
    expect(situacaoOrcamento(100_00, 120_00)).toEqual({ percentual: 120, estado: 'estourado' });
  });

  it('ativação gera o bem pelo custo acumulado e deprecia do mês seguinte', () => {
    const r = planejarAtivacao(obra, { data: '2026-08-15', vidaUtilMeses: 300 }, HOJE);
    expect(r).toEqual({
      plano: {
        valorCent: 90_000_00,
        dataAquisicao: '2026-08-15',
        inicioDepreciacao: '2026-09',
        vidaUtilMeses: 300,
        estouroCent: 0,
      },
    });
    const estourada = planejarAtivacao(
      { ...obra, acumuladoCent: 110_000_00 },
      { data: '2026-08-15', vidaUtilMeses: 300 },
      HOJE,
    );
    expect('plano' in estourada && estourada.plano.estouroCent).toBe(10_000_00);
    expect(
      planejarAtivacao({ ...obra, acumuladoCent: 0 }, { data: '2026-06-01', vidaUtilMeses: 0 }, HOJE),
    ).toEqual({
      erros: ['sem-custo', 'data-antes-apropriacao', 'vida-invalida'],
    });
  });

  it('cancelar só a obra sem custo, com motivo', () => {
    expect(errosCancelamentoObra(obra, 'Projeto suspenso')).toEqual(['com-custo']);
    expect(errosCancelamentoObra({ ...obra, acumuladoCent: 0 }, 'Projeto suspenso')).toEqual([]);
    expect(errosCancelamentoObra({ ...obra, situacao: 'cancelado', acumuladoCent: 0 }, '')).toEqual([
      'nao-em-andamento',
      'motivo-curto',
    ]);
  });
});

describe('seguro dos bens', () => {
  const ap = {
    numero: 'AP-1',
    tipo: 'equipamento',
    seguradora: 3,
    inicio: '2026-01-01',
    fim: '2026-12-31',
    premioCent: 12_000_00,
    franquiaCent: null,
  };
  it('apólice valida número, tipo, seguradora, vigência e valores', () => {
    expect(errosApolice(ap)).toEqual([]);
    expect(
      errosApolice({
        ...ap,
        numero: ' ',
        tipo: 'vida',
        seguradora: null,
        fim: '2025-01-01',
        premioCent: -1,
        franquiaCent: -1,
      }),
    ).toEqual([
      'numero-ausente',
      'tipo-invalido',
      'seguradora-ausente',
      'vigencia-invertida',
      'premio-negativo',
      'franquia-negativa',
    ]);
  });

  it('situação vista: a vencer em 30 dias, vencida depois do fim', () => {
    expect(situacaoDaApolice({ situacao: 'vigente', fim: '2026-12-31' }, '2026-11-01')).toBe('vigente');
    expect(situacaoDaApolice({ situacao: 'vigente', fim: '2026-12-20' }, HOJE)).toBe('a-vencer');
    expect(situacaoDaApolice({ situacao: 'vigente', fim: '2026-10-31' }, HOJE)).toBe('vencida');
    expect(situacaoDaApolice({ situacao: 'cancelada', fim: '2026-12-31' }, HOJE)).toBe('cancelada');
  });

  it('bem segurado: apólice em vigor, bem ativo, início dentro da vigência e sem repetir', () => {
    const vig = { situacao: 'vigente', inicio: '2026-01-01', fim: '2026-12-31' };
    expect(
      errosBemSegurado(
        vig,
        { situacao: 'ativo' },
        { valorSeguradoCent: 1, inicio: '2026-02-01' },
        false,
        HOJE,
      ),
    ).toEqual([]);
    expect(
      errosBemSegurado(
        { ...vig, fim: '2026-10-01' },
        { situacao: 'baixado' },
        { valorSeguradoCent: 0, inicio: '2027-01-01' },
        true,
        HOJE,
      ),
    ).toEqual(['apolice-encerrada', 'bem-baixado', 'fora-da-vigencia', 'valor-zero', 'bem-ja-segurado']);
  });

  it('cobertura e subseguro (abaixo de 80% do valor contábil) e o total da apólice', () => {
    expect(cobertura(70_00, 100_00)).toMatchObject({ percentual: 70, subseguro: true });
    expect(cobertura(80_00, 100_00)).toMatchObject({ percentual: 80, subseguro: false });
    expect(cobertura(1, 0)).toMatchObject({ percentual: null, subseguro: false });
    expect(
      totalSegurado([
        { valorSeguradoCent: 10, ativo: true },
        { valorSeguradoCent: 5, ativo: false },
      ]),
    ).toBe(10);
  });
});
