import { describe, expect, it } from 'vitest';
import {
  atributosDaGuia,
  competenciaDoPeriodo,
  dependentesAtivos,
  type DefinicaoAtributoGuia,
  guiaAceitaAtributos,
  caractereForaDoTiss,
  observacaoDosAtributos,
  recusaCamposOperadoraInvalidos,
  recusaObrigatoriosPendentes,
  recusaObservacaoLonga,
  sugerirProximoPeriodo,
  validarDefinicaoAtributo,
  validarOpcoesAtributo,
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
    expect(s).toEqual({
      inicio: '2026-02-01T00:00:00.000',
      fim: '2026-02-28T23:59:59.999',
      tipoLancamentoId: null,
      competencia: '2026-02-01',
    });
    // A sugestão aceita é válida (sem duração zero nem sobreposição) e a seguinte já vai para março.
    const jan = { inicio: conta.inicio, fim: '2026-01-31T23:59:59.999', tipoLancamentoId: null };
    expect(validarPeriodoConta(conta, [jan], s!).erros).toEqual({});
    expect(sugerirProximoPeriodo(conta, [jan, s!])?.competencia).toBe('2026-03-01');
    // Último período no meio do mês: o próximo começa no mesmo instante (faixas encostadas não se sobrepõem).
    const meio = { inicio: conta.inicio, fim: '2026-01-25T10:00:00.000', tipoLancamentoId: null };
    expect(sugerirProximoPeriodo(conta, [meio])).toMatchObject({
      inicio: '2026-01-25T10:00:00.000',
      fim: '2026-01-31T23:59:59.999',
      competencia: '2026-01-01',
    });
    // Virada do ano.
    expect(sugerirProximoPeriodo(conta, [{ ...jan, fim: '2026-12-31T23:59:59.999' }])?.inicio).toBe(
      '2027-01-01T00:00:00.000',
    );
  });
  it('recusa período de duração zero', () => {
    expect(
      validarPeriodoConta(conta, [], {
        inicio: '2026-01-31T23:59:59.999',
        fim: '2026-01-31T23:59:59.999',
        tipoLancamentoId: null,
      }).erros['fim'],
    ).toMatch(/duração zero/);
  });
  it('para no fim da conta e não sugere nada quando ela já está coberta', () => {
    const fechada = { ...conta, fim: '2026-01-25T10:00:00.000' };
    expect(sugerirProximoPeriodo(fechada, [])?.fim).toBe('2026-01-25T10:00:00.000');
    expect(
      sugerirProximoPeriodo(fechada, [{ inicio: conta.inicio, fim: fechada.fim, tipoLancamentoId: null }]),
    ).toBeNull();
  });
  it('competência do fim da faixa, e recusa faixa invertida, fora da conta ou sobreposta', () => {
    expect(competenciaDoPeriodo('2026-02-03T00:00:00.000')).toBe('2026-02-01');
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
    // Pai inativado (fora dos campos que valem para a guia): a opção do filho não fica travada.
    const semPai = atributosDaGuia(
      defs.map((d) => (d.id === 1 ? { ...d, ativo: false } : d)),
      'consulta',
    );
    expect(validarValoresAtributos(semPai, [{ atributoId: 2, opcaoId: 21, texto: null }]).erros).toEqual({});
  });
  it('observação da guia TISS: código e valor de envio, na ordem, só os campos que valem e os valores válidos', () => {
    const comEnvio = defs.map((d) =>
      d.id === 1 ? { ...d, opcoes: d.opcoes.map((o) => (o.id === 10 ? { ...o, valorEnvio: 'Q01' } : o)) } : d,
    );
    const campos = atributosDaGuia(comEnvio, 'consulta');
    const r = observacaoDosAtributos(campos, [
      { atributoId: 5, opcaoId: null, texto: 'S' },
      { atributoId: 1, opcaoId: 10, texto: null },
      { atributoId: 2, opcaoId: 20, texto: null },
      { atributoId: 4, opcaoId: null, texto: 'data ruim' },
      { atributoId: 3, opcaoId: null, texto: '80' },
      { atributoId: 7, opcaoId: null, texto: 'guardado' },
    ]);
    // Opção com envio vai pelo envio; sem envio, pelo código. Campo de outro tipo de guia e campo inativo ficam
    // guardados e não vão (sem erro). A data gravada que não vale não vai e fica em erros: o lote recusa a guia.
    expect(r).toEqual({
      texto: 'TRAT: Q01; FASE: QT1; MET: sim',
      excede: false,
      erros: ['Data do diagnóstico: informe a data (AAAA-MM-DD).'],
    });
    expect(observacaoDosAtributos(campos, [])).toEqual({ texto: null, excede: false, erros: [] });
    expect(observacaoDosAtributos([], [{ atributoId: 1, opcaoId: 10, texto: null }])).toEqual({
      texto: null,
      excede: false,
      erros: [],
    });
  });

  it('valor gravado que deixou de valer não some: opção inativada, tamanho reduzido e combinação com o pai vão a erros', () => {
    const campos = atributosDaGuia(
      defs.map((d) =>
        d.id === 1 ? { ...d, opcoes: d.opcoes.map((o) => (o.id === 11 ? { ...o, ativo: false } : o)) } : d,
      ),
      'consulta',
    );
    const r = observacaoDosAtributos(campos, [
      { atributoId: 1, opcaoId: 11, texto: null }, // opção inativada depois de gravada
      { atributoId: 6, opcaoId: null, texto: 'texto antigo' }, // tamanho máximo reduzido para 5
    ]);
    expect(r.texto).toBeNull();
    expect(r.erros).toEqual([
      'Tratamento: opção inexistente ou inativa.',
      'Observação: no máximo 5 caracteres.',
    ]);
    // Opção filha que não combina com a do pai: não vai à operadora (nem é normalizada) e recusa.
    const dep = observacaoDosAtributos(atributosDaGuia(defs, 'consulta'), [
      { atributoId: 1, opcaoId: 10, texto: null },
      { atributoId: 2, opcaoId: 21, texto: null },
    ]);
    expect(dep.texto).toBe('TRAT: QT');
    expect(dep.erros).toEqual(['Fase: a opção não combina com a escolhida no campo de que depende.']);
    expect(
      validarValoresAtributos(defs, [
        { atributoId: 1, opcaoId: 10, texto: null },
        { atributoId: 2, opcaoId: 21, texto: null },
      ]).normalizados.map((v) => v.atributoId),
    ).toEqual([1]);
    const recusa = recusaCamposOperadoraInvalidos('C1', 'G1', dep.erros)!;
    expect(recusa.codigo).toBe('guia-campos-operadora-invalidos');
    expect(recusa.mensagem).toContain('guia G1');
    expect(recusa.mensagem).toContain('Fase: a opção não combina');
    expect(recusaCamposOperadoraInvalidos('C1', 'G1', [])).toBeNull();
  });

  it('caractere fora do ISO-8859-1 recusa ao gravar o valor e a opção, e o lote recusa o que já estava gravado', () => {
    expect(caractereForaDoTiss('Estádio I – grau 2')).toBe('U+2013');
    expect(caractereForaDoTiss('“aspas”')).toBe('U+201C');
    expect(caractereForaDoTiss('ok 😀')).toBe('U+1F600');
    expect(caractereForaDoTiss('Estádio Ç ° ½ ok')).toBeNull();
    const texto: DefinicaoAtributoGuia = {
      ...base,
      id: 9,
      codigo: 'NOTA',
      rotulo: 'Nota',
      tipoDado: 'texto',
    };
    const v = validarValoresAtributos([texto], [{ atributoId: 9, opcaoId: null, texto: 'fase 1 – ciclo 2' }]);
    expect(v.erros['atributo.9']).toBe(
      'Nota: o caractere U+2013 não cabe no arquivo TISS (ISO-8859-1); troque-o (travessão por hífen, aspas curvas por retas, sem emoji).',
    );
    expect(v.normalizados).toEqual([]);
    expect(
      validarValoresAtributos([texto], [{ atributoId: 9, opcaoId: null, texto: 'fase 1 - ciclo 2' }]).erros,
    ).toEqual({});
    expect(
      Object.keys(
        validarOpcoesAtributo([
          { codigo: 'E1', valorEnvio: 'ONC–E1' },
          { codigo: 'E2', valorEnvio: null },
          { codigo: 'E3’', valorEnvio: 'ok' },
        ]),
      ),
    ).toEqual(['opcoes.0.valorEnvio', 'opcoes.2.codigo']);
    // Opção gravada antes da conferência, com envio fora do padrão: não vai e recusa, sem trocar o caractere.
    const lista: DefinicaoAtributoGuia = {
      ...base,
      id: 8,
      codigo: 'EST',
      rotulo: 'Estadiamento',
      tipoDado: 'opcao',
      opcoes: [{ ...op(80, 'E1'), valorEnvio: 'ONC—E1' }],
    };
    const r = observacaoDosAtributos(
      [lista, texto],
      [
        { atributoId: 8, opcaoId: 80, texto: null },
        { atributoId: 9, opcaoId: null, texto: 'ok' },
      ],
    );
    expect(r.texto).toBe('NOTA: ok');
    expect(r.erros).toEqual([
      'Estadiamento: o caractere U+2014 não cabe no arquivo TISS (ISO-8859-1); troque-o (travessão por hífen, aspas curvas por retas, sem emoji).',
    ]);
  });

  it('observação acima do limite do padrão é marcada e o lote recusa (nunca se corta)', () => {
    const longo: DefinicaoAtributoGuia = {
      ...base,
      id: 9,
      codigo: 'LONGO',
      rotulo: 'Longo',
      tipoDado: 'texto',
    };
    const r = observacaoDosAtributos([longo], [{ atributoId: 9, opcaoId: null, texto: 'x'.repeat(494) }]);
    expect(r.texto).toHaveLength(501);
    expect(r.excede).toBe(true);
    expect(
      observacaoDosAtributos([longo], [{ atributoId: 9, opcaoId: null, texto: 'x'.repeat(493) }]).excede,
    ).toBe(false);
    const recusa = recusaObservacaoLonga('C1', 'G1', 501);
    expect(recusa.codigo).toBe('guia-campos-operadora-excede');
    expect(recusa.mensagem).toContain('guia G1 somam 501 caracteres');
    expect(recusa.mensagem).toContain('aceita 500');
  });

  it('inativar um campo com dependentes ativos aponta quais são', () => {
    expect(dependentesAtivos(1, defs)).toEqual(['Fase']);
    expect(
      dependentesAtivos(
        1,
        defs.map((d) => (d.id === 2 ? { ...d, ativo: false } : d)),
      ),
    ).toEqual([]);
    expect(dependentesAtivos(3, defs)).toEqual([]);
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

describe('obrigatório da operadora antes do lote', () => {
  it('recusa a conta com a guia e os campos que faltam; sem pendência, segue', () => {
    expect(recusaObrigatoriosPendentes('C1', [{ numero: 'G1', faltam: [] }])).toBeNull();
    expect(recusaObrigatoriosPendentes('C1', [])).toBeNull();
    const r = recusaObrigatoriosPendentes('C1', [
      { numero: 'G1', faltam: [] },
      { numero: 'G2', faltam: ['Tratamento', 'Fase'] },
    ]);
    expect(r?.codigo).toBe('guia-obrigatorio-pendente');
    expect(r?.mensagem).toContain('guia G2: Tratamento, Fase');
    expect(r?.mensagem).not.toContain('G1');
  });
});
