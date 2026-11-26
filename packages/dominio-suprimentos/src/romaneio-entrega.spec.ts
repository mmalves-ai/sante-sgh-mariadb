// Romaneio de entrega entre unidades (09-AREA linha 77, C1-120): cadastro do motorista e do veículo, montagem com as
// transferências, expedição (transporte, habilitação, categoria, controlado e termolábil), conferência por item na
// chegada e cancelamento antes da saída. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoRomaneio,
  conferirConferencia,
  conferirExpedicao,
  conferirMontagem,
  conferirMotorista,
  conferirVeiculo,
  type Expedicao,
  type MotoristaEntrada,
  placaNormalizada,
  situacaoAposConferencia,
  conferirCancelamentoEnvio,
  conferirEnvioEntreUnidades,
  type VeiculoEntrada,
} from './index.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);

const MOTORISTA: MotoristaEntrada = {
  nome: 'Motorista Fictício',
  cpf: '52998224725',
  tipoVinculo: 'proprio',
  transportadora: null,
  numeroHabilitacao: '12345678901',
  categorias: ['b'],
  vencimentoHabilitacao: '2028-01-31',
  transportaControlado: false,
  ativo: true,
  motivoInativacao: null,
};

const VEICULO: VeiculoEntrada = {
  codigo: 'V01',
  descricao: 'Furgão de entregas',
  placa: 'abc-1d23',
  proprio: true,
  transportadora: null,
  refrigerado: false,
  capacidadeCargaKg: 1500,
  ativo: true,
  motivoInativacao: null,
};

const EXPEDICAO: Expedicao = {
  situacao: 'aberto',
  itens: 2,
  veiculo: { ativo: true, proprio: true, refrigerado: false, capacidadeCargaKg: 1500 },
  motorista: {
    situacao: 'ativo',
    vencimentoHabilitacao: '2028-01-31',
    categorias: ['b'],
    transportaControlado: false,
  },
  transportadora: null,
  levaControlado: false,
  levaTermolabil: false,
  quilometragemSaida: 1000,
  hoje: '2026-11-25',
};

describe('cadastro do motorista e do veículo', () => {
  it('aceita o motorista completo e recusa CPF, habilitação, categoria, terceiro sem transportadora e inativo sem motivo', () => {
    expect(conferirMotorista(MOTORISTA)).toEqual([]);
    const r = conferirMotorista({
      ...MOTORISTA,
      cpf: '11111111111',
      numeroHabilitacao: '123',
      categorias: [],
      tipoVinculo: 'terceiro',
      ativo: false,
      motivoInativacao: 'x',
    });
    expect(codigos(r)).toEqual([
      'motorista-cpf',
      'motorista-habilitacao',
      'motorista-categoria',
      'motorista-transportadora',
      'motorista-motivo',
    ]);
  });

  it('normaliza a placa nos dois padrões e recusa a placa inválida e o veículo de terceiro sem dona', () => {
    expect(placaNormalizada('abc-1d23')).toBe('ABC1D23');
    expect(conferirVeiculo(VEICULO)).toEqual([]);
    expect(conferirVeiculo({ ...VEICULO, placa: 'ABC 1234' })).toEqual([]);
    expect(
      codigos(conferirVeiculo({ ...VEICULO, placa: 'AB12345', proprio: false, capacidadeCargaKg: 0 })),
    ).toEqual(['veiculo-placa', 'veiculo-transportadora', 'veiculo-capacidade']);
  });
});

describe('montagem do romaneio', () => {
  const transf = [
    { documento: 10, situacaoDocumento: 'aberto', emOutroRomaneio: false, entreUnidades: true },
    { documento: 11, situacaoDocumento: 'concluido', emOutroRomaneio: false, entreUnidades: true },
    { documento: 12, situacaoDocumento: 'cancelado', emOutroRomaneio: false, entreUnidades: true },
    { documento: 13, situacaoDocumento: 'aberto', emOutroRomaneio: true, entreUnidades: true },
    { documento: 14, situacaoDocumento: 'aberto', emOutroRomaneio: false, entreUnidades: true },
    { documento: 15, situacaoDocumento: 'aberto', emOutroRomaneio: false, entreUnidades: false },
  ];
  it('aceita só as transferências entre unidades em aberto, fora de outro romaneio', () => {
    expect(conferirMontagem({ documentos: [10, 14], valorFrete: 120 }, transf)).toEqual([]);
  });
  it('recusa a transferência já recebida e a da mesma unidade', () => {
    expect(codigos(conferirMontagem({ documentos: [11, 15], valorFrete: null }, transf))).toEqual([
      'romaneio-transferencia-recebida',
      'romaneio-mesma-unidade',
    ]);
  });
  it('recusa vazio, repetida, inexistente, cancelada, já em outro romaneio e frete negativo', () => {
    expect(codigos(conferirMontagem({ documentos: [], valorFrete: null }, transf))).toEqual([
      'romaneio-sem-itens',
    ]);
    expect(codigos(conferirMontagem({ documentos: [10, 10, 99, 12, 13], valorFrete: -1 }, transf))).toEqual([
      'romaneio-item-repetido',
      'romaneio-transferencia-inexistente',
      'romaneio-transferencia-cancelada',
      'romaneio-transferencia-em-outro',
      'romaneio-frete',
    ]);
  });
});

describe('expedição', () => {
  it('aceita o veículo próprio com motorista apto', () => {
    expect(conferirExpedicao(EXPEDICAO)).toEqual([]);
  });
  it('aceita a transportadora sem veículo nem motorista na carga comum', () => {
    expect(conferirExpedicao({ ...EXPEDICAO, veiculo: null, motorista: null, transportadora: 7 })).toEqual(
      [],
    );
  });
  it('recusa a carga controlada e a termolábil só com a transportadora, sem motorista nem veículo', () => {
    const terceiro = { ...EXPEDICAO, veiculo: null, motorista: null, transportadora: 7 };
    expect(codigos(conferirExpedicao({ ...terceiro, levaControlado: true, levaTermolabil: true }))).toEqual([
      'romaneio-controlado-sem-motorista',
      'romaneio-termolabil-sem-veiculo',
    ]);
  });
  it('recusa sem transporte, sem itens e o romaneio já expedido', () => {
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, itens: 0, veiculo: null, motorista: null }))).toEqual([
      'romaneio-sem-itens',
      'romaneio-sem-transporte',
    ]);
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, situacao: 'em_transito' }))).toEqual([
      'romaneio-nao-aberto',
    ]);
  });
  it('recusa habilitação vencida na véspera, motorista inativo e veículo sem motorista', () => {
    const m = EXPEDICAO.motorista!;
    expect(
      codigos(
        conferirExpedicao({
          ...EXPEDICAO,
          motorista: { ...m, situacao: 'bloqueado', vencimentoHabilitacao: '2026-11-24' },
        }),
      ),
    ).toEqual(['romaneio-motorista-inativo', 'romaneio-habilitacao-vencida']);
    expect(
      codigos(conferirExpedicao({ ...EXPEDICAO, motorista: { ...m, vencimentoHabilitacao: '2026-11-25' } })),
    ).toEqual([]);
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, motorista: null }))).toEqual(['romaneio-sem-motorista']);
  });
  it('pede C, D ou E acima de 3,5 t e B ou mais no veículo leve (só A não basta)', () => {
    const v = EXPEDICAO.veiculo!;
    const m = EXPEDICAO.motorista!;
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, veiculo: { ...v, capacidadeCargaKg: 6000 } }))).toEqual([
      'romaneio-categoria',
    ]);
    expect(
      conferirExpedicao({
        ...EXPEDICAO,
        veiculo: { ...v, capacidadeCargaKg: 6000 },
        motorista: { ...m, categorias: ['d'] },
      }),
    ).toEqual([]);
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, motorista: { ...m, categorias: ['a'] } }))).toEqual([
      'romaneio-categoria',
    ]);
  });
  it('controlado pede motorista habilitado; termolábil pede baú refrigerado', () => {
    expect(codigos(conferirExpedicao({ ...EXPEDICAO, levaControlado: true, levaTermolabil: true }))).toEqual([
      'romaneio-controlado',
      'romaneio-termolabil',
    ]);
    expect(
      conferirExpedicao({
        ...EXPEDICAO,
        levaControlado: true,
        levaTermolabil: true,
        motorista: { ...EXPEDICAO.motorista!, transportaControlado: true },
        veiculo: { ...EXPEDICAO.veiculo!, refrigerado: true },
      }),
    ).toEqual([]);
  });
});

describe('conferência na chegada', () => {
  const base = {
    situacao: 'em_transito' as const,
    itens: [
      { id: 1, situacao: 'pendente' as const },
      { id: 2, situacao: 'pendente' as const },
      { id: 3, situacao: 'entregue' as const },
    ],
    quilometragemSaida: 1000,
    quilometragemChegada: 1042,
  };
  it('aceita a entrega e o recusado com motivo', () => {
    expect(
      conferirConferencia({
        ...base,
        desfechos: [
          { item: 1, desfecho: 'entregue', motivo: null },
          { item: 2, desfecho: 'recusado', motivo: 'Caixa violada' },
        ],
      }),
    ).toEqual([]);
  });
  it('recusa o não entregue sem motivo, item já conferido, de outro romaneio e quilometragem abaixo da saída', () => {
    expect(
      codigos(
        conferirConferencia({
          ...base,
          quilometragemChegada: 900,
          desfechos: [
            { item: 2, desfecho: 'extraviado', motivo: '' },
            { item: 3, desfecho: 'entregue', motivo: null },
            { item: 9, desfecho: 'entregue', motivo: null },
          ],
        }),
      ),
    ).toEqual([
      'conferencia-motivo',
      'conferencia-item-conferido',
      'conferencia-item-inexistente',
      'conferencia-quilometragem',
    ]);
    expect(codigos(conferirConferencia({ ...base, situacao: 'aberto', desfechos: [] }))).toEqual([
      'romaneio-nao-em-transito',
    ]);
  });
  it('fecha entregue, entregue em parte ou segue em trânsito', () => {
    expect(situacaoAposConferencia(['entregue', 'entregue'])).toBe('entregue');
    expect(situacaoAposConferencia(['entregue', 'devolvido'])).toBe('entregue_parcial');
    expect(situacaoAposConferencia(['entregue', 'pendente'])).toBe('em_transito');
  });
});

describe('cancelamento', () => {
  it('só antes da saída e com motivo', () => {
    expect(conferirCancelamentoRomaneio('aberto', 'Saída adiada')).toEqual([]);
    expect(codigos(conferirCancelamentoRomaneio('em_transito', 'x'))).toEqual([
      'romaneio-nao-cancelavel',
      'romaneio-motivo',
    ]);
  });
});

describe('envio entre unidades', () => {
  const itens = [{ item: 1, quantidade: 2 }];
  it('aceita o destino ativo em outra unidade', () => {
    expect(conferirEnvioEntreUnidades({ origemUnidade: 1, destinoUnidade: 2, itens })).toEqual([]);
  });
  it('recusa o destino da mesma unidade, o inexistente, sem itens, repetido e quantidade zero', () => {
    expect(codigos(conferirEnvioEntreUnidades({ origemUnidade: 1, destinoUnidade: 1, itens }))).toEqual([
      'envio-mesma-unidade',
    ]);
    expect(
      codigos(
        conferirEnvioEntreUnidades({
          origemUnidade: 1,
          destinoUnidade: null,
          itens: [
            { item: 1, quantidade: 0 },
            { item: 1, quantidade: 1 },
          ],
        }),
      ),
    ).toEqual(['envio-destino-inexistente', 'envio-item-repetido', 'envio-quantidade']);
    expect(codigos(conferirEnvioEntreUnidades({ origemUnidade: 1, destinoUnidade: 2, itens: [] }))).toEqual([
      'envio-sem-itens',
    ]);
  });
  it('o cancelamento recusa o envio em romaneio ativo, o já recebido e sem motivo', () => {
    expect(
      conferirCancelamentoEnvio({
        situacaoDocumento: 'aberto',
        emRomaneioAtivo: false,
        motivo: 'Pedido errado',
      }),
    ).toEqual([]);
    expect(
      codigos(
        conferirCancelamentoEnvio({ situacaoDocumento: 'concluido', emRomaneioAtivo: true, motivo: '' }),
      ),
    ).toEqual(['envio-nao-cancelavel', 'envio-em-romaneio', 'envio-motivo']);
  });
});
