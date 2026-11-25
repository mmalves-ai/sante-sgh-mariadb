// C1-066 (03-PEP linha 125): regras do pedido de transporte do paciente.
import { describe, expect, it } from 'vitest';
import {
  conferirAcaoTransporte,
  conferirPedidoTransporte,
  ordenarFilaTransporte,
  type PedidoTransporte,
  tipoTransporteDaAlta,
} from './transporte-paciente.js';

const agora = new Date('2026-11-25T12:00:00Z');
const base: PedidoTransporte = {
  tipo: 'alta',
  prioridade: 'rotina',
  internacao: 10,
  atendimento: 20,
  origemSetor: 1,
  origemDescricao: null,
  destinoSetor: null,
  destinoExterno: null,
  destinoDescricao: 'Domicílio do paciente',
  requerOxigenio: false,
  requerMonitorizacao: false,
  meioExigeAmbulancia: null,
  previsto: new Date('2026-11-25T15:00:00Z'),
  abertosMesmoTipo: 0,
  agora,
};
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('conferirPedidoTransporte', () => {
  it('aceita a alta para o domicílio ligada à internação', () => {
    expect(conferirPedidoTransporte(base)).toEqual([]);
  });

  it('recusa tipo, prioridade, destino e origem ausentes', () => {
    const p = conferirPedidoTransporte({
      ...base,
      tipo: '',
      prioridade: 'x',
      origemSetor: null,
      destinoDescricao: null,
    });
    expect(campos(p)).toEqual(['tipo', 'prioridade', 'destino', 'origem']);
  });

  it('a alta exige a internação; sem internação nem atendimento, recusa', () => {
    expect(campos(conferirPedidoTransporte({ ...base, internacao: null }))).toEqual(['internacao']);
    expect(campos(conferirPedidoTransporte({ ...base, internacao: null, atendimento: null }))).toEqual([
      'internacao',
      'internacao',
    ]);
  });

  it('interno e retorno vão a um setor diferente da origem; os que saem do hospital não vão a setor', () => {
    expect(
      campos(conferirPedidoTransporte({ ...base, tipo: 'interno', destinoDescricao: null, destinoSetor: 2 })),
    ).toEqual([]);
    expect(campos(conferirPedidoTransporte({ ...base, tipo: 'interno' }))).toEqual(['destinoSetor']);
    expect(
      campos(conferirPedidoTransporte({ ...base, tipo: 'interno', destinoDescricao: null, destinoSetor: 1 })),
    ).toEqual(['destinoSetor']);
    expect(
      campos(
        conferirPedidoTransporte({
          ...base,
          tipo: 'transferencia_externa',
          destinoDescricao: null,
          destinoSetor: 2,
        }),
      ),
    ).toEqual(['destinoSetor', 'destinoExterno']);
    expect(
      conferirPedidoTransporte({
        ...base,
        tipo: 'transferencia_externa',
        destinoDescricao: null,
        destinoExterno: 7,
      }),
    ).toEqual([]);
  });

  it('retorno: o paciente volta de fora do hospital para a própria unidade; a origem é o local externo', () => {
    const retorno = { ...base, tipo: 'retorno', destinoDescricao: null, destinoSetor: 1 };
    // O caso típico: volta do exame externo para o setor em que está internado (destino = setor atual).
    expect(
      conferirPedidoTransporte({ ...retorno, origemSetor: null, origemDescricao: 'Clínica de imagem' }),
    ).toEqual([]);
    // Sem o local de onde volta, ou com um setor do hospital como origem, recusa.
    expect(campos(conferirPedidoTransporte({ ...retorno, origemSetor: null }))).toEqual(['origemDescricao']);
    expect(
      campos(conferirPedidoTransporte({ ...retorno, origemSetor: 1, origemDescricao: 'Clínica de imagem' })),
    ).toEqual(['origemDescricao']);
    expect(
      campos(conferirPedidoTransporte({ ...retorno, origemSetor: null, origemDescricao: '  ' })),
    ).toEqual(['origemDescricao']);
  });

  it('oxigênio ou monitorização só com meio de ambulância', () => {
    expect(
      campos(conferirPedidoTransporte({ ...base, requerOxigenio: true, meioExigeAmbulancia: false })),
    ).toEqual(['meio']);
    expect(
      conferirPedidoTransporte({ ...base, requerMonitorizacao: true, meioExigeAmbulancia: true }),
    ).toEqual([]);
    expect(conferirPedidoTransporte({ ...base, requerOxigenio: true, meioExigeAmbulancia: null })).toEqual(
      [],
    );
  });

  it('previsão no passado e pedido repetido em aberto são recusados', () => {
    expect(campos(conferirPedidoTransporte({ ...base, previsto: new Date('2026-11-25T11:00:00Z') }))).toEqual(
      ['previsto'],
    );
    expect(campos(conferirPedidoTransporte({ ...base, abertosMesmoTipo: 1 }))).toEqual(['tipo']);
  });
});

describe('conferirAcaoTransporte', () => {
  const acao = {
    acao: 'agendar' as const,
    situacao: 'solicitado',
    meioDefinido: true,
    meioExigeAmbulancia: true,
    requerOxigenio: false,
    requerMonitorizacao: false,
    ambulancia: 3,
    previsto: new Date('2026-11-25T14:00:00Z'),
    saida: null,
    chegada: null,
    retorno: null,
    distanciaKm: null,
    motivoCancelamento: null,
    agora,
  };

  it('ciclo: agendar, sair, concluir', () => {
    expect(conferirAcaoTransporte(acao)).toEqual({ situacao: 'agendado', problemas: [] });
    expect(
      conferirAcaoTransporte({
        ...acao,
        acao: 'iniciar',
        situacao: 'agendado',
        saida: new Date('2026-11-25T11:50:00Z'),
      }).situacao,
    ).toBe('em_andamento');
    expect(
      conferirAcaoTransporte({
        ...acao,
        acao: 'concluir',
        situacao: 'em_andamento',
        saida: new Date('2026-11-25T11:00:00Z'),
        chegada: new Date('2026-11-25T11:40:00Z'),
        retorno: new Date('2026-11-25T11:58:00Z'),
        distanciaKm: 12.5,
      }).situacao,
    ).toBe('concluido');
  });

  it('agendar exige previsão futura e meio; oxigênio sem ambulância é recusado', () => {
    expect(
      campos(conferirAcaoTransporte({ ...acao, previsto: null, meioDefinido: false }).problemas),
    ).toEqual(['previsto', 'meio']);
    expect(
      campos(conferirAcaoTransporte({ ...acao, requerOxigenio: true, meioExigeAmbulancia: false }).problemas),
    ).toEqual(['meio']);
  });

  it('a saída exige o veículo quando o meio é ambulância e não pode estar no futuro', () => {
    const r = conferirAcaoTransporte({
      ...acao,
      acao: 'iniciar',
      ambulancia: null,
      saida: new Date('2026-11-25T13:00:00Z'),
    });
    expect(r.situacao).toBeNull();
    expect(campos(r.problemas)).toEqual(['ambulancia', 'saida']);
  });

  it('chegada antes da saída, retorno antes da chegada e distância negativa são recusados', () => {
    const r = conferirAcaoTransporte({
      ...acao,
      acao: 'concluir',
      situacao: 'em_andamento',
      saida: new Date('2026-11-25T11:00:00Z'),
      chegada: new Date('2026-11-25T10:00:00Z'),
      retorno: new Date('2026-11-25T09:00:00Z'),
      distanciaKm: -1,
    });
    expect(campos(r.problemas)).toEqual(['chegada', 'retorno', 'distanciaKm']);
  });

  it('cancelar exige motivo e só antes da saída; concluído não volta', () => {
    expect(campos(conferirAcaoTransporte({ ...acao, acao: 'cancelar' }).problemas)).toEqual(['motivo']);
    expect(conferirAcaoTransporte({ ...acao, acao: 'cancelar', motivoCancelamento: 4 }).situacao).toBe(
      'cancelado',
    );
    expect(
      conferirAcaoTransporte({ ...acao, acao: 'cancelar', situacao: 'em_andamento', motivoCancelamento: 4 })
        .problemas[0]!.mensagem,
    ).toContain('já saiu');
    expect(conferirAcaoTransporte({ ...acao, situacao: 'concluido' }).situacao).toBeNull();
  });
});

describe('fila e sugestão pela alta', () => {
  it('ordena por prioridade, previsão e pedido', () => {
    const f = ordenarFilaTransporte([
      { id: 1, prioridade: 'rotina', previsto: '2026-11-25T10:00:00Z', solicitado: '2026-11-25T08:00:00Z' },
      { id: 2, prioridade: 'emergencia', previsto: null, solicitado: '2026-11-25T09:00:00Z' },
      { id: 3, prioridade: 'rotina', previsto: '2026-11-25T09:00:00Z', solicitado: '2026-11-25T08:30:00Z' },
      { id: 4, prioridade: 'rotina', previsto: null, solicitado: '2026-11-25T07:00:00Z' },
    ]);
    expect(f.map((x) => x.id)).toEqual([2, 3, 1, 4]);
  });

  it('tipo sugerido pelo destino da alta', () => {
    expect(tipoTransporteDaAlta('transferencia_externa')).toBe('transferencia_externa');
    expect(tipoTransporteDaAlta('domicilio')).toBe('alta');
    expect(tipoTransporteDaAlta(null)).toBe('alta');
  });
});
