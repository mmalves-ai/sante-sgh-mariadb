import { describe, expect, it } from 'vitest';
import {
  atributosDaGuia,
  competenciaDe,
  type DefinicaoAtributoGuia,
  guiaAceitaAtributos,
  sugerirProximoPeriodo,
  validarDefinicaoAtributo,
  validarPeriodoConta,
  validarSeguradoConta,
  validarValoresAtributos,
} from './complementos.js';

const conta = { situacao: 'aberta', inicio: '2026-01-20T08:00:00.000', fim: null };

describe('período da conta parcial', () => {
  it('sugere do início da conta até o fim do mês, depois do fim do último período', () => {
    expect(sugerirProximoPeriodo(conta, [])).toEqual({
      inicio: '2026-01-20T08:00:00.000',
      fim: '2026-01-31T23:59:59.999',
      tipoLancamentoId: null,
      competencia: '2026-01-01',
    });
    const s = sugerirProximoPeriodo(conta, [
      { inicio: conta.inicio, fim: '2026-01-31T23:59:59.999', tipoLancamentoId: null },
    ]);
    expect(s?.inicio).toBe('2026-01-31T23:59:59.999');
    expect(s?.competencia).toBe('2026-01-01');
  });
  it('para no fim da conta e não sugere nada quando ela já está coberta', () => {
    const fechada = { ...conta, fim: '2026-01-25T10:00:00.000' };
    expect(sugerirProximoPeriodo(fechada, [])?.fim).toBe('2026-01-25T10:00:00.000');
    expect(
      sugerirProximoPeriodo(fechada, [{ inicio: conta.inicio, fim: fechada.fim, tipoLancamentoId: null }]),
    ).toBeNull();
  });
  it('competência do fim da faixa, e recusa faixa invertida, fora da conta ou sobreposta', () => {
    expect(competenciaDe('2026-02-03T00:00:00.000')).toBe('2026-02-01');
    const ok = validarPeriodoConta(conta, [], {
      inicio: '2026-01-20T08:00:00.000',
      fim: '2026-02-05T00:00:00.000',
      tipoLancamentoId: null,
    });
    expect(ok).toEqual({ erros: {}, competencia: '2026-02-01' });
    expect(
      validarPeriodoConta(conta, [], {
        inicio: '2026-01-22T00:00',
        fim: '2026-01-21T00:00',
        tipoLancamentoId: null,
      }).erros['fim'],
    ).toMatch(/antes do início/);
    expect(
      validarPeriodoConta(conta, [], {
        inicio: '2026-01-19T00:00',
        fim: '2026-01-21T00:00',
        tipoLancamentoId: null,
      }).erros['inicio'],
    ).toMatch(/antes da abertura/);
    const existente = { inicio: '2026-01-20T08:00', fim: '2026-01-31T00:00', tipoLancamentoId: 7 };
    expect(
      validarPeriodoConta(conta, [existente], {
        inicio: '2026-01-25T00:00',
        fim: '2026-02-02T00:00',
        tipoLancamentoId: 7,
      }).erros['inicio'],
    ).toMatch(/sobrepõe/);
    // Outro tipo de lançamento não se sobrepõe; o período "todos" (nulo) se sobrepõe a qualquer um.
    expect(
      validarPeriodoConta(conta, [existente], {
        inicio: '2026-01-25T00:00',
        fim: '2026-02-02T00:00',
        tipoLancamentoId: 8,
      }).erros,
    ).toEqual({});
    expect(
      validarPeriodoConta(conta, [existente], {
        inicio: '2026-01-25T00:00',
        fim: '2026-02-02T00:00',
        tipoLancamentoId: null,
      }).erros['inicio'],
    ).toMatch(/sobrepõe/);
    // Encostar no fim do anterior é permitido.
    expect(
      validarPeriodoConta(conta, [existente], {
        inicio: '2026-01-31T00:00',
        fim: '2026-02-02T00:00',
        tipoLancamentoId: 7,
      }).erros,
    ).toEqual({});
  });
  it('competência no primeiro dia e não antes do mês do início; conta fechada recusa', () => {
    const p = { inicio: '2026-01-20T08:00', fim: '2026-01-30T00:00', tipoLancamentoId: null };
    expect(
      validarPeriodoConta(conta, [], { ...p, competencia: '2026-01-15' }).erros['competencia'],
    ).toBeTruthy();
    expect(validarPeriodoConta(conta, [], { ...p, competencia: '2025-12-01' }).erros['competencia']).toMatch(
      /anterior/,
    );
    expect(validarPeriodoConta({ ...conta, situacao: 'fechada' }, [], p).erros['conta']).toMatch(/reabra/);
  });
});

describe('dados do segurado na conta', () => {
  const s = {
    numeroCarteira: '0001 2345 6789',
    validadeCarteira: '2026-12-31',
    parentescoTitular: null,
    titularCoberturaId: null,
    matriculaFuncional: null,
  };
  it('carteira obrigatória e validade conferida no início da conta (só alerta)', () => {
    expect(validarSeguradoConta('aberta', conta.inicio, s)).toEqual({ erros: {}, alertas: [] });
    expect(validarSeguradoConta('aberta', conta.inicio, { ...s, numeroCarteira: ' ' }).erros).toHaveProperty(
      'numeroCarteira',
    );
    const v = validarSeguradoConta('aberta', conta.inicio, { ...s, validadeCarteira: '2026-01-10' });
    expect(v.erros).toEqual({});
    expect(v.alertas[0]).toMatch(/vencida/);
    expect(
      validarSeguradoConta('aberta', conta.inicio, { ...s, validadeCarteira: '2026-13-40' }).erros,
    ).toHaveProperty('validadeCarteira');
  });
  it('dependente exige o titular ou a matrícula; conta cancelada recusa', () => {
    expect(
      validarSeguradoConta('aberta', conta.inicio, { ...s, parentescoTitular: 'filho' }).erros,
    ).toHaveProperty('titularCoberturaId');
    expect(
      validarSeguradoConta('aberta', conta.inicio, {
        ...s,
        parentescoTitular: 'filho',
        matriculaFuncional: 'M1',
      }).erros,
    ).toEqual({});
    expect(validarSeguradoConta('cancelada', conta.inicio, s).erros).toHaveProperty('conta');
  });
});

describe('campo adicional da operadora na guia', () => {
  const op = (id: number, codigo: string, opcaoPaiId: number | null = null, ativo = true) => ({
    id,
    codigo,
    descricao: codigo,
    ativo,
    opcaoPaiId,
  });
  const base = {
    tipoGuia: null,
    obrigatorio: false,
    tamanhoMaximo: null,
    dependeDeId: null,
    ativo: true,
    ordem: 0,
    opcoes: [],
  };
  const defs: DefinicaoAtributoGuia[] = [
    {
      ...base,
      id: 1,
      codigo: 'TRAT',
      rotulo: 'Tratamento',
      tipoDado: 'opcao',
      obrigatorio: true,
      opcoes: [op(10, 'QT'), op(11, 'RT'), op(12, 'X', null, false)],
    },
    {
      ...base,
      id: 2,
      codigo: 'FASE',
      rotulo: 'Fase',
      tipoDado: 'opcao',
      dependeDeId: 1,
      opcoes: [op(20, 'QT1', 10), op(21, 'RT1', 11)],
      ordem: 1,
    },
    { ...base, id: 3, codigo: 'PESO', rotulo: 'Peso', tipoDado: 'numero', tipoGuia: 'sp_sadt', ordem: 2 },
    { ...base, id: 4, codigo: 'DIAG', rotulo: 'Data do diagnóstico', tipoDado: 'data', ordem: 3 },
    { ...base, id: 5, codigo: 'MET', rotulo: 'Metástase', tipoDado: 'booleano', ordem: 4 },
    { ...base, id: 6, codigo: 'OBS', rotulo: 'Observação', tipoDado: 'texto', tamanhoMaximo: 5, ordem: 5 },
    { ...base, id: 7, codigo: 'VELHO', rotulo: 'Inativo', tipoDado: 'texto', ativo: false },
  ];
  it('filtra pelo tipo de guia e pelos ativos', () => {
    expect(atributosDaGuia(defs, 'consulta').map((d) => d.id)).toEqual([1, 2, 4, 5, 6]);
    expect(atributosDaGuia(defs, 'sp_sadt').map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('normaliza pelo tipo e aponta o obrigatório que falta', () => {
    const r = validarValoresAtributos(defs, [
      { atributoId: 3, opcaoId: null, texto: '72,5' },
      { atributoId: 4, opcaoId: null, texto: '2026-01-02' },
      { atributoId: 5, opcaoId: null, texto: 'Sim' },
      { atributoId: 6, opcaoId: null, texto: '' },
    ]);
    expect(r.erros).toEqual({});
    expect(r.normalizados.map((v) => v.texto)).toEqual(['72.5', '2026-01-02', 'sim']);
    expect(r.faltam).toEqual(['Tratamento']);
  });
  it('recusa tipo errado, texto longo, opção inativa ou de outro campo e opção que não combina com a do pai', () => {
    const r = validarValoresAtributos(defs, [
      { atributoId: 3, opcaoId: null, texto: 'abc' },
      { atributoId: 4, opcaoId: null, texto: '02/01/2026' },
      { atributoId: 5, opcaoId: null, texto: 'talvez' },
      { atributoId: 6, opcaoId: null, texto: 'longo demais' },
      { atributoId: 1, opcaoId: 12, texto: null },
      { atributoId: 99, opcaoId: null, texto: 'x' },
    ]);
    expect(Object.keys(r.erros).sort()).toEqual(
      ['atributo.1', 'atributo.3', 'atributo.4', 'atributo.5', 'atributo.6', 'atributo.99'].sort(),
    );
    const dep = validarValoresAtributos(defs, [
      { atributoId: 1, opcaoId: 10, texto: null },
      { atributoId: 2, opcaoId: 21, texto: null },
    ]);
    expect(dep.erros['atributo.2']).toMatch(/não combina/);
    expect(
      validarValoresAtributos(defs, [
        { atributoId: 1, opcaoId: 10, texto: null },
        { atributoId: 2, opcaoId: 20, texto: null },
      ]).erros,
    ).toEqual({});
  });
  it('definição: código, tamanho só em texto, dependência só entre listas e sem ciclo', () => {
    const d = {
      id: null,
      codigo: 'ONCO_1',
      rotulo: 'Classificação',
      tipoDado: 'opcao',
      tipoGuia: null,
      tamanhoMaximo: null,
      dependeDeId: null,
    };
    expect(validarDefinicaoAtributo(d, defs)).toEqual({});
    expect(validarDefinicaoAtributo({ ...d, codigo: 'com espaço' }, defs)).toHaveProperty('codigo');
    expect(validarDefinicaoAtributo({ ...d, tamanhoMaximo: 10 }, defs)).toHaveProperty('tamanhoMaximo');
    expect(validarDefinicaoAtributo({ ...d, dependeDeId: 3 }, defs)).toHaveProperty('dependeDeId');
    expect(validarDefinicaoAtributo({ ...d, tipoDado: 'texto', dependeDeId: 1 }, defs)).toHaveProperty(
      'dependeDeId',
    );
    expect(validarDefinicaoAtributo({ ...d, id: 1, dependeDeId: 2 }, defs)['dependeDeId']).toMatch(/ciclo/);
    expect(validarDefinicaoAtributo({ ...d, tipoGuia: 'qualquer' }, defs)).toHaveProperty('tipoGuia');
  });
  it('a guia aceita os campos antes do lote ou devolvida', () => {
    expect(guiaAceitaAtributos('montada')).toBe(true);
    expect(guiaAceitaAtributos('glosada')).toBe(true);
    expect(guiaAceitaAtributos('enviada')).toBe(false);
  });
});
