import { describe, expect, it } from 'vitest';
import {
  conferirAcaoChamado,
  conferirChamadoAmbulancia,
  conferirEquipeAmbulancia,
  conferirMaqueiro,
  ordenarFilaChamados,
  quilometrosRodados,
} from './chamado-ambulancia.js';

const agora = new Date('2026-11-25T12:00:00Z');
const pedido = {
  tipo: 'remocao_inter_hospitalar',
  categoria: 1,
  destinoExterno: 7,
  rota: null,
  destinoLogradouro: null,
  destinoCep: null,
  previsto: null,
  agora,
  abertoNoAtendimento: false,
};
const campos = (r: { campo: string }[]) => r.map((p) => p.campo);
const veiculo = { categoria: 1, ativo: true, quilometragemAtual: 1000 };
const base = { categoriaPedida: 1, classificacao: 'B', veiculo, agora };

describe('chamado de ambulância', () => {
  it('aceita o pedido com destino e recusa sem destino, categoria, CEP válido ou com previsão no passado', () => {
    expect(conferirChamadoAmbulancia(pedido)).toEqual([]);
    expect(conferirChamadoAmbulancia({ ...pedido, destinoExterno: null, rota: 3 })).toEqual([]);
    expect(
      campos(
        conferirChamadoAmbulancia({
          ...pedido,
          tipo: 'x',
          categoria: null,
          destinoExterno: null,
          destinoCep: '123',
          previsto: new Date('2026-11-25T10:00:00Z'),
          abertoNoAtendimento: true,
        }),
      ),
    ).toEqual(['tipo', 'categoria', 'destino', 'destinoCep', 'previsto', 'atendimento']);
  });

  it('exige a equipe mínima pela classificação nacional', () => {
    expect(conferirEquipeAmbulancia([{ profissional: 1, funcao: 'condutor' }], 'A')).toEqual([]);
    expect(conferirEquipeAmbulancia([{ profissional: 1, funcao: 'condutor' }], 'B')).toHaveLength(1);
    expect(
      conferirEquipeAmbulancia(
        [
          { profissional: 1, funcao: 'condutor' },
          { profissional: 2, funcao: 'enfermeiro' },
        ],
        'B',
      ),
    ).toEqual([]);
    const d = conferirEquipeAmbulancia(
      [
        { profissional: 1, funcao: 'condutor' },
        { profissional: 1, funcao: 'enfermeiro' },
      ],
      'D',
    );
    expect(d.map((p) => p.mensagem)).toEqual([
      'O mesmo profissional aparece duas vezes na equipe.',
      'A ambulância tipo D exige o médico na equipe.',
    ]);
    expect(conferirEquipeAmbulancia([], null)).toHaveLength(1);
  });

  it('aprova com o veículo da categoria e a equipe; recusa outra categoria ou veículo inativo', () => {
    const equipe = [
      { profissional: 1, funcao: 'condutor' },
      { profissional: 2, funcao: 'tecnico_enfermagem' },
    ];
    expect(conferirAcaoChamado({ ...base, acao: 'aprovar', situacao: 'solicitado', equipe })).toEqual({
      situacao: 'aprovado',
      problemas: [],
    });
    expect(
      campos(
        conferirAcaoChamado({
          ...base,
          acao: 'aprovar',
          situacao: 'aprovado',
          veiculo: { ...veiculo, categoria: 2 },
          equipe,
        }).problemas,
      ),
    ).toEqual(['situacao', 'ambulancia']);
    expect(
      campos(
        conferirAcaoChamado({
          ...base,
          acao: 'aprovar',
          situacao: 'solicitado',
          veiculo: { ...veiculo, ativo: false },
          equipe,
        }).problemas,
      ),
    ).toEqual(['ambulancia']);
    expect(
      campos(
        conferirAcaoChamado({ ...base, acao: 'aprovar', situacao: 'solicitado', veiculo: null, equipe })
          .problemas,
      ),
    ).toEqual(['ambulancia']);
  });

  it('reprova e cancela só com motivo; cancelar depois da saída é recusado', () => {
    expect(
      conferirAcaoChamado({ ...base, acao: 'reprovar', situacao: 'solicitado', motivoReprovacao: 'x' }),
    ).toEqual({
      situacao: 'reprovado',
      problemas: [],
    });
    expect(
      campos(conferirAcaoChamado({ ...base, acao: 'reprovar', situacao: 'solicitado' }).problemas),
    ).toEqual(['motivo']);
    expect(
      conferirAcaoChamado({ ...base, acao: 'cancelar', situacao: 'aprovado', motivoCancelamento: 4 })
        .situacao,
    ).toBe('cancelado');
    expect(
      campos(
        conferirAcaoChamado({ ...base, acao: 'cancelar', situacao: 'em_transito', motivoCancelamento: 4 })
          .problemas,
      ),
    ).toEqual(['situacao']);
  });

  it('sai com o hodômetro não menor que o do veículo e conclui com o final não menor que o da saída', () => {
    expect(
      conferirAcaoChamado({ ...base, acao: 'sair', situacao: 'aprovado', kmInicial: 1000, saida: agora })
        .situacao,
    ).toBe('em_transito');
    expect(
      campos(conferirAcaoChamado({ ...base, acao: 'sair', situacao: 'aprovado', kmInicial: 999 }).problemas),
    ).toEqual(['kmInicial']);
    expect(
      campos(
        conferirAcaoChamado({
          ...base,
          acao: 'sair',
          situacao: 'aprovado',
          kmInicial: null,
          saida: new Date('2026-11-25T13:00:00Z'),
        }).problemas,
      ),
    ).toEqual(['kmInicial', 'saida']);
    const saida = new Date('2026-11-25T11:00:00Z');
    expect(
      conferirAcaoChamado({
        ...base,
        acao: 'concluir',
        situacao: 'em_transito',
        kmInicial: 1000,
        kmFinal: 1042,
        saida,
        fim: agora,
      }).situacao,
    ).toBe('concluido');
    expect(
      campos(
        conferirAcaoChamado({
          ...base,
          acao: 'concluir',
          situacao: 'em_transito',
          kmInicial: 1000,
          kmFinal: 990,
          saida,
          fim: new Date('2026-11-25T10:00:00Z'),
        }).problemas,
      ),
    ).toEqual(['kmFinal', 'fim']);
    expect(quilometrosRodados(1000, 1042)).toBe(42);
    expect(quilometrosRodados(1000, null)).toBeNull();
    expect(quilometrosRodados(1000, 900)).toBeNull();
  });

  it('ordena a fila: em trânsito, aprovados, solicitados; depois a previsão', () => {
    const f = ordenarFilaChamados([
      { id: 1, situacao: 'solicitado', previsto: null, solicitado: '2026-11-25T08:00:00Z' },
      { id: 2, situacao: 'aprovado', previsto: '2026-11-25T15:00:00Z', solicitado: '2026-11-25T09:00:00Z' },
      { id: 3, situacao: 'em_transito', previsto: null, solicitado: '2026-11-25T10:00:00Z' },
      { id: 4, situacao: 'aprovado', previsto: '2026-11-25T13:00:00Z', solicitado: '2026-11-25T09:30:00Z' },
    ]);
    expect(f.map((x) => x.id)).toEqual([3, 4, 2, 1]);
  });
});

describe('maqueiro do transporte interno', () => {
  const ok = {
    tipoPedido: 'interno',
    situacaoPedido: 'agendado',
    habilitacao: { funcao: 'maqueiro', tipo: 'interno', ativo: true },
    emAndamento: 0,
  };
  it('designa o maqueiro habilitado e livre num pedido interno antes da saída', () => {
    expect(conferirMaqueiro(ok)).toEqual([]);
    expect(
      conferirMaqueiro({ ...ok, tipoPedido: 'retorno', habilitacao: { ...ok.habilitacao, tipo: 'ambos' } }),
    ).toEqual([]);
  });
  it('recusa pedido externo, já iniciado, sem habilitação, inativo, só de ambulância ou ocupado', () => {
    expect(
      campos(conferirMaqueiro({ ...ok, tipoPedido: 'alta', situacaoPedido: 'em_andamento', emAndamento: 1 })),
    ).toEqual(['transporte', 'transporte', 'maqueiro']);
    expect(conferirMaqueiro({ ...ok, habilitacao: null })[0]?.mensagem).toMatch(/não está habilitado/);
    expect(conferirMaqueiro({ ...ok, habilitacao: { ...ok.habilitacao, funcao: 'motorista' } })).toHaveLength(
      1,
    );
    expect(
      conferirMaqueiro({ ...ok, habilitacao: { ...ok.habilitacao, ativo: false } })[0]?.mensagem,
    ).toMatch(/inativa/);
    expect(
      conferirMaqueiro({ ...ok, habilitacao: { ...ok.habilitacao, tipo: 'ambulancia' } })[0]?.mensagem,
    ).toMatch(/só para a ambulância/);
  });
});
