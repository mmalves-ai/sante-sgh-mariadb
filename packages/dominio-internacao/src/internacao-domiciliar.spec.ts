import { describe, expect, it } from 'vitest';
import {
  conferirAcaoChamadoDomiciliar,
  conferirAcaoInternacaoDomiciliar,
  conferirAcaoOrcamento,
  conferirAcaoVisitaDomiciliar,
  conferirChamadoDomiciliar,
  conferirOrcamentoDomiciliar,
  conferirTransferenciaDomicilio,
  conferirVisitaDomiciliar,
  ordenarFilaChamadosDomiciliares,
  totaisOrcamentoDomiciliar,
  valorItemOrcamento,
} from './internacao-domiciliar.js';

const hoje = '2026-11-25';
const agora = new Date('2026-11-25T15:00:00Z');
const campos = (r: readonly { campo: string }[]) => r.map((p) => p.campo);
const item = {
  tipoItem: 'visita',
  itemFaturavel: 1,
  tipoCusto: null,
  descricao: 'Visita de enfermagem',
  quantidade: 2,
  dias: 30,
  valorUnitario: 80,
  valorCustoUnitario: 50,
  percentualAcrescimo: null,
};

describe('orçamento da internação domiciliar', () => {
  it('item: quantidade × dias × unitário com acréscimo; custo pelos mesmos fatores', () => {
    expect(valorItemOrcamento(item)).toEqual({ valorTotal: 4800, valorCusto: 3000 });
    expect(valorItemOrcamento({ ...item, dias: null, percentualAcrescimo: 10 })).toEqual({
      valorTotal: 176,
      valorCusto: 100,
    });
  });
  it('totais: subtotal, impostos pelo percentual e total', () => {
    const t = totaisOrcamentoDomiciliar(
      [item, { ...item, quantidade: 1, dias: null, valorUnitario: 33.33 }],
      5,
    );
    expect(t).toEqual({ subtotal: 4833.33, valorCustoTotal: 3050, valorImpostos: 241.67, valorTotal: 5075 });
  });
  it('confere operadora sem fonte, período invertido, validade vencida e itens inválidos', () => {
    const p = conferirOrcamentoDomiciliar({
      tipo: 'operadora',
      fontePagadora: null,
      periodoInicio: '2026-12-10',
      periodoFim: '2026-12-01',
      validade: '2026-11-24',
      percentualImpostos: 120,
      itens: [{ ...item, itemFaturavel: null, quantidade: 0, descricao: ' ' }],
      hoje,
    });
    expect(campos(p)).toEqual([
      'fontePagadora',
      'periodoFim',
      'validade',
      'percentualImpostos',
      'itens.0.itemFaturavel',
      'itens.0.descricao',
      'itens.0.quantidade',
    ]);
    expect(
      conferirOrcamentoDomiciliar({
        tipo: 'particular',
        fontePagadora: null,
        periodoInicio: null,
        periodoFim: null,
        validade: hoje,
        percentualImpostos: 0,
        itens: [item],
        hoje,
      }),
    ).toEqual([]);
  });
  it('ciclo: enviar com itens e no prazo; aprovar só enviado e não vencido; editar só o rascunho', () => {
    const b = { itens: 1, validade: '2026-12-01', hoje };
    expect(conferirAcaoOrcamento({ ...b, acao: 'enviar', situacao: 'rascunho' }).situacao).toBe('enviado');
    expect(
      campos(conferirAcaoOrcamento({ ...b, itens: 0, acao: 'enviar', situacao: 'rascunho' }).problemas),
    ).toEqual(['itens']);
    expect(conferirAcaoOrcamento({ ...b, acao: 'aprovar', situacao: 'enviado' }).situacao).toBe('aprovado');
    expect(
      conferirAcaoOrcamento({ ...b, validade: '2026-11-20', acao: 'aprovar', situacao: 'enviado' })
        .problemas[0]!.mensagem,
    ).toContain('venceu');
    expect(conferirAcaoOrcamento({ ...b, acao: 'aprovar', situacao: 'rascunho' }).situacao).toBeNull();
    expect(conferirAcaoOrcamento({ ...b, acao: 'recusar', situacao: 'enviado' }).situacao).toBe('recusado');
    expect(conferirAcaoOrcamento({ ...b, acao: 'editar', situacao: 'enviado' }).situacao).toBeNull();
    expect(conferirAcaoOrcamento({ ...b, acao: 'cancelar', situacao: 'aprovado' }).situacao).toBeNull();
    expect(conferirAcaoOrcamento({ ...b, acao: 'cancelar', situacao: 'enviado' }).situacao).toBe('cancelado');
  });
});

describe('transferência para casa e ciclo da internação domiciliar', () => {
  const base = {
    paciente: 7,
    enderecoDoPaciente: true,
    origem: { paciente: 7, aberta: true },
    orcamento: { paciente: 7, situacao: 'aprovado' },
    liminar: null,
    dataPrevista: '2026-11-26',
    outraAberta: false,
    hoje,
  };
  it('aceita com orçamento aprovado do paciente ou com a liminar', () => {
    expect(conferirTransferenciaDomicilio(base)).toEqual([]);
    expect(
      conferirTransferenciaDomicilio({
        ...base,
        orcamento: null,
        liminar: { numero: '123', data: '2026-11-20' },
      }),
    ).toEqual([]);
  });
  it('recusa endereço de outro, outra aberta, origem e orçamento de outro, sem orçamento nem liminar', () => {
    expect(
      campos(
        conferirTransferenciaDomicilio({
          ...base,
          enderecoDoPaciente: false,
          outraAberta: true,
          origem: { paciente: 8, aberta: true },
          orcamento: { paciente: 8, situacao: 'aprovado' },
          dataPrevista: '2026-11-01',
        }),
      ),
    ).toEqual(['endereco', 'paciente', 'origemInternacao', 'orcamento', 'dataPrevista']);
    expect(
      campos(conferirTransferenciaDomicilio({ ...base, orcamento: { paciente: 7, situacao: 'enviado' } })),
    ).toEqual(['orcamento']);
    expect(campos(conferirTransferenciaDomicilio({ ...base, orcamento: null }))).toEqual(['orcamento']);
    expect(
      campos(
        conferirTransferenciaDomicilio({ ...base, orcamento: null, liminar: { numero: null, data: null } }),
      ),
    ).toEqual(['liminar']);
  });
  const acao = {
    medicoResponsavel: true,
    inicio: new Date('2026-11-20T10:00:00Z'),
    quando: agora,
    agora,
    motivo: null,
    chamadosAbertos: 0,
    visitasEmAndamento: 0,
  };
  it('iniciar exige médico responsável e nada no futuro', () => {
    expect(
      conferirAcaoInternacaoDomiciliar({ ...acao, acao: 'iniciar', situacao: 'em_avaliacao' }).situacao,
    ).toBe('ativa');
    expect(
      campos(
        conferirAcaoInternacaoDomiciliar({
          ...acao,
          acao: 'iniciar',
          situacao: 'solicitada',
          medicoResponsavel: false,
          quando: new Date('2026-11-26T10:00:00Z'),
        }).problemas,
      ),
    ).toEqual(['quando', 'medico']);
    expect(
      conferirAcaoInternacaoDomiciliar({ ...acao, acao: 'iniciar', situacao: 'ativa' }).situacao,
    ).toBeNull();
  });
  it('suspender e cancelar com motivo; retomar; encerrar sem chamado aberto nem visita em andamento', () => {
    expect(
      campos(conferirAcaoInternacaoDomiciliar({ ...acao, acao: 'suspender', situacao: 'ativa' }).problemas),
    ).toEqual(['motivo']);
    expect(
      conferirAcaoInternacaoDomiciliar({
        ...acao,
        acao: 'suspender',
        situacao: 'ativa',
        motivo: 'Reinternação hospitalar',
      }).situacao,
    ).toBe('suspensa');
    expect(
      conferirAcaoInternacaoDomiciliar({ ...acao, acao: 'retomar', situacao: 'suspensa' }).situacao,
    ).toBe('ativa');
    expect(
      conferirAcaoInternacaoDomiciliar({
        ...acao,
        acao: 'cancelar',
        situacao: 'ativa',
        motivo: 'x'.repeat(12),
      }).situacao,
    ).toBeNull();
    expect(
      campos(
        conferirAcaoInternacaoDomiciliar({
          ...acao,
          acao: 'encerrar',
          situacao: 'ativa',
          quando: new Date('2026-11-19T10:00:00Z'),
          chamadosAbertos: 1,
          visitasEmAndamento: 1,
        }).problemas,
      ),
    ).toEqual(['quando', 'chamados', 'visitas']);
    expect(
      conferirAcaoInternacaoDomiciliar({ ...acao, acao: 'encerrar', situacao: 'suspensa' }).situacao,
    ).toBe('encerrada');
  });
});

describe('chamados da atenção domiciliar', () => {
  const ab = {
    tipoAtivo: true,
    motivoDeOutroTipo: false,
    internacaoSituacao: 'ativa',
    temEndereco: true,
    prioridade: null,
    chamadoEm: agora,
    agora,
  };
  it('abertura: tipo ativo, motivo do tipo, internação ativa, endereço e hora', () => {
    expect(conferirChamadoDomiciliar(ab)).toEqual([]);
    expect(
      campos(
        conferirChamadoDomiciliar({
          ...ab,
          tipoAtivo: false,
          motivoDeOutroTipo: true,
          internacaoSituacao: 'encerrada',
          temEndereco: false,
          prioridade: 'qualquer',
          chamadoEm: new Date('2026-11-25T16:00:00Z'),
        }),
      ),
    ).toEqual(['tipo', 'motivo', 'internacao', 'logradouro', 'prioridade', 'chamadoEm']);
  });
  it('ciclo: triar com prioridade, atribuir com profissional, iniciar, concluir com desfecho, anular com motivo', () => {
    expect(
      conferirAcaoChamadoDomiciliar({ acao: 'triar', situacao: 'aberto', prioridade: 'urgente' }).situacao,
    ).toBe('triado');
    expect(campos(conferirAcaoChamadoDomiciliar({ acao: 'triar', situacao: 'aberto' }).problemas)).toEqual([
      'prioridade',
    ]);
    expect(
      conferirAcaoChamadoDomiciliar({ acao: 'atribuir', situacao: 'triado', profissional: 3 }).situacao,
    ).toBe('atribuido');
    expect(conferirAcaoChamadoDomiciliar({ acao: 'iniciar', situacao: 'atribuido' }).situacao).toBe(
      'em_atendimento',
    );
    expect(
      campos(
        conferirAcaoChamadoDomiciliar({
          acao: 'concluir',
          situacao: 'em_atendimento',
          desfecho: 'atendido_domicilio',
          visitaRealizada: false,
          tipoComCoparticipacao: false,
          coparticipacao: 10,
        }).problemas,
      ),
    ).toEqual(['desfecho', 'coparticipacao']);
    expect(
      conferirAcaoChamadoDomiciliar({
        acao: 'concluir',
        situacao: 'em_atendimento',
        desfecho: 'atendido_domicilio',
        visitaRealizada: true,
        tipoComCoparticipacao: true,
        coparticipacao: 25,
      }).situacao,
    ).toBe('concluido');
    expect(
      conferirAcaoChamadoDomiciliar({ acao: 'concluir', situacao: 'aberto', desfecho: 'orientado_telefone' })
        .situacao,
    ).toBe('concluido');
    expect(
      campos(
        conferirAcaoChamadoDomiciliar({ acao: 'anular', situacao: 'aberto', motivo: 'curto' }).problemas,
      ),
    ).toEqual(['motivo']);
    expect(
      conferirAcaoChamadoDomiciliar({ acao: 'anular', situacao: 'concluido', motivo: 'x'.repeat(20) })
        .situacao,
    ).toBeNull();
  });
  it('fila: prioridade e depois a hora', () => {
    const f = ordenarFilaChamadosDomiciliares([
      { id: 1, prioridade: null, chamadoEm: '2026-11-25T08:00:00Z' },
      { id: 2, prioridade: 'nao_urgente', chamadoEm: '2026-11-25T07:00:00Z' },
      { id: 3, prioridade: 'emergencia', chamadoEm: '2026-11-25T09:00:00Z' },
      { id: 4, prioridade: 'emergencia', chamadoEm: '2026-11-25T08:30:00Z' },
    ]);
    expect(f.map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });
});

describe('visitas domiciliares', () => {
  const v = {
    internacaoSituacao: 'ativa',
    inicioInternacao: new Date('2026-11-20T10:00:00Z'),
    quando: new Date('2026-11-26T13:00:00Z'),
    duracaoMinutos: 60,
    outrasDoProfissional: [],
  };
  it('agenda na internação ativa, depois do início e sem sobrepor o profissional', () => {
    expect(conferirVisitaDomiciliar(v)).toEqual([]);
    expect(
      conferirVisitaDomiciliar({
        ...v,
        outrasDoProfissional: [{ quando: new Date('2026-11-26T14:00:00Z'), duracaoMinutos: 30 }],
      }),
    ).toEqual([]);
    expect(
      campos(
        conferirVisitaDomiciliar({
          ...v,
          internacaoSituacao: 'suspensa',
          quando: new Date('2026-11-19T13:00:00Z'),
          duracaoMinutos: 0,
          outrasDoProfissional: [{ quando: new Date('2026-11-19T12:30:00Z'), duracaoMinutos: null }],
        }),
      ),
    ).toEqual(['internacao', 'quando', 'duracao', 'quando']);
  });
  it('ciclo: iniciar, realizar com início e fim, cancelar com motivo', () => {
    const b = { inicio: null, fim: null, agora, motivo: null };
    expect(
      conferirAcaoVisitaDomiciliar({ ...b, acao: 'iniciar', situacao: 'agendada', inicio: agora }).situacao,
    ).toBe('em_andamento');
    expect(
      conferirAcaoVisitaDomiciliar({
        ...b,
        acao: 'realizar',
        situacao: 'em_andamento',
        inicio: new Date('2026-11-25T13:00:00Z'),
        fim: new Date('2026-11-25T14:00:00Z'),
      }).situacao,
    ).toBe('realizada');
    expect(
      campos(
        conferirAcaoVisitaDomiciliar({
          ...b,
          acao: 'realizar',
          situacao: 'em_andamento',
          inicio: new Date('2026-11-25T14:00:00Z'),
          fim: new Date('2026-11-25T16:00:00Z'),
        }).problemas,
      ),
    ).toEqual(['fim']);
    expect(
      campos(conferirAcaoVisitaDomiciliar({ ...b, acao: 'cancelar', situacao: 'agendada' }).problemas),
    ).toEqual(['motivo']);
    expect(
      conferirAcaoVisitaDomiciliar({ ...b, acao: 'cancelar', situacao: 'realizada', motivo: 'x'.repeat(12) })
        .situacao,
    ).toBeNull();
    expect(
      conferirAcaoVisitaDomiciliar({
        ...b,
        acao: 'nao_realizar',
        situacao: 'confirmada',
        motivo: 'Paciente ausente no endereço',
      }).situacao,
    ).toBe('nao_realizada');
  });
});
