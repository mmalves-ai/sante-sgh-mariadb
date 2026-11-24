import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoProtocolo,
  conferirCancelamentoSolicitacao,
  conferirEmprestimo,
  conferirNaoLocalizado,
  conferirVolumeNoProtocolo,
  conferirProtocolo,
  conferirRecebimento,
  conferirSolicitacaoAberta,
  conteudoDoProtocolo,
  diasDeAtraso,
  type PosseVolume,
  posseAoReceber,
  prazoDoEmprestimo,
  situacaoAposDevolucao,
  situacaoDaSolicitacaoPelosItens,
  situacaoDaSolicitacao,
  situacaoPelosItens,
} from './same-tramite.js';

describe('protocolo de envio em lote', () => {
  it('confere a montagem: setores, itens, repetidos e documento avulso', () => {
    expect(conferirProtocolo({ remetente: 1, destinatario: 1, itens: [] }).map((p) => p.campo)).toEqual([
      'destinatario',
      'itens',
    ]);
    const r = conferirProtocolo({
      remetente: 1,
      destinatario: 2,
      itens: [
        { tipo: 'volume_prontuario', alvo: 5, descricao: null },
        { tipo: 'volume_prontuario', alvo: 5, descricao: null },
        { tipo: 'conta', alvo: null, descricao: null },
        { tipo: 'documento', alvo: null, descricao: ' ' },
      ],
    });
    expect(r.map((p) => p.campo)).toEqual(['itens.1', 'itens.2.alvo', 'itens.3.descricao']);
    expect(
      conferirProtocolo({
        remetente: 1,
        destinatario: 2,
        itens: [{ tipo: 'documento', alvo: null, descricao: 'Termo' }],
      }),
    ).toEqual([]);
  });

  it('o conteúdo sai dos tipos dos itens', () => {
    expect(conteudoDoProtocolo([{ tipo: 'volume_prontuario' }, { tipo: 'atendimento' }])).toBe('prontuario');
    expect(conteudoDoProtocolo([{ tipo: 'conta' }])).toBe('conta');
    expect(conteudoDoProtocolo([{ tipo: 'conta' }, { tipo: 'documento' }])).toBe('misto');
  });

  it('a situação do lote sai da conferência dos itens', () => {
    const n = { recebido: false, recusado: false };
    const ok = { recebido: true, recusado: false };
    const no = { recebido: false, recusado: true };
    expect(situacaoPelosItens([n, n])).toBe('enviado');
    expect(situacaoPelosItens([ok, n])).toBe('recebido_parcial');
    expect(situacaoPelosItens([ok, no])).toBe('recebido');
    expect(situacaoPelosItens([no, no])).toBe('recusado');
  });

  it('recebe item a item: lote enviado, item do lote e não conferido, recusa com motivo', () => {
    const itens = [
      { id: 1, recebido: false, recusado: false },
      { id: 2, recebido: true, recusado: false },
    ];
    expect(conferirRecebimento('recebido', itens, [{ item: 1, aceito: true, motivo: null }])[0]?.campo).toBe(
      'protocolo',
    );
    expect(
      conferirRecebimento('enviado', itens, [
        { item: 1, aceito: false, motivo: null },
        { item: 2, aceito: true, motivo: null },
        { item: 9, aceito: true, motivo: null },
      ]).map((p) => p.campo),
    ).toEqual(['itens.0.motivo', 'itens.1.item', 'itens.2.item']);
    expect(
      conferirRecebimento('recebido_parcial', itens, [{ item: 1, aceito: false, motivo: 'Sem a folha 3' }]),
    ).toEqual([]);
  });

  it('o cancelamento só antes da conferência e com motivo', () => {
    expect(conferirCancelamentoProtocolo('enviado', 'Emitido por engano')).toEqual([]);
    expect(conferirCancelamentoProtocolo('recebido_parcial', null).map((p) => p.campo)).toEqual([
      'protocolo',
      'motivo',
    ]);
  });
});

describe('solicitação e empréstimo de prontuário', () => {
  it('só empresta o volume que está no arquivo e livre', () => {
    const base = { situacao: 'arquivado' as const, noLocal: true, emprestimoAberto: false };
    expect(conferirEmprestimo(base)).toEqual([]);
    expect(conferirEmprestimo({ ...base, situacao: 'eliminado' })[0]?.mensagem).toMatch(/eliminado/);
    expect(conferirEmprestimo({ ...base, situacao: 'extraviado' })[0]?.mensagem).toMatch(/extraviado/);
    expect(conferirEmprestimo({ ...base, emprestimoAberto: true })[0]?.mensagem).toMatch(/emprestado/);
    expect(conferirEmprestimo({ ...base, noLocal: false })[0]?.mensagem).toMatch(/não está no arquivo/);
  });

  it('o prazo: o informado, o do motivo ou o padrão', () => {
    const s = new Date('2026-11-01T10:00:00Z');
    expect(prazoDoEmprestimo(s, { informado: null, doMotivo: 15, padrao: 7 }).toISOString()).toBe(
      '2026-11-16T10:00:00.000Z',
    );
    expect(prazoDoEmprestimo(s, { informado: 2, doMotivo: 15, padrao: 7 }).toISOString()).toBe(
      '2026-11-03T10:00:00.000Z',
    );
    expect(prazoDoEmprestimo(s, { informado: null, doMotivo: null, padrao: 7 }).toISOString()).toBe(
      '2026-11-08T10:00:00.000Z',
    );
  });

  it('o atraso conta do prazo e zera com a devolução', () => {
    const prazo = new Date('2026-11-10T10:00:00Z');
    expect(diasDeAtraso(prazo, null, new Date('2026-11-10T09:00:00Z'))).toBe(0);
    expect(diasDeAtraso(prazo, null, new Date('2026-11-12T11:00:00Z'))).toBe(3);
    expect(diasDeAtraso(prazo, new Date('2026-11-11T10:00:00Z'), new Date('2026-11-20T10:00:00Z'))).toBe(0);
  });

  it('a solicitação: atendida, parcial ou aberta', () => {
    expect(situacaoDaSolicitacao(2, 2)).toBe('atendida');
    expect(situacaoDaSolicitacao(3, 1)).toBe('atendida_parcial');
    expect(situacaoDaSolicitacao(1, 0)).toBe('pendente');
    expect(conferirSolicitacaoAberta('pendente')).toEqual([]);
    expect(conferirSolicitacaoAberta('cancelada')).toHaveLength(1);
  });
});

describe('custódia única com a guarda', () => {
  const noArquivo: PosseVolume = {
    situacao: 'arquivado',
    noLocal: true,
    localArquivo: 10,
    setorAtual: null,
    saidaAberta: false,
    emTransito: false,
  };
  const arquivo = { setor: null, local: 10 };
  const unidade = { setor: 5, local: null };

  it('só põe no lote o volume que está com o remetente, fora de empréstimo e de outro lote', () => {
    expect(conferirVolumeNoProtocolo(noArquivo, arquivo, unidade)).toEqual([]);
    expect(conferirVolumeNoProtocolo({ ...noArquivo, emTransito: true }, arquivo, unidade)[0]).toMatch(
      /outro protocolo/,
    );
    expect(conferirVolumeNoProtocolo({ ...noArquivo, saidaAberta: true }, arquivo, unidade)[0]).toMatch(
      /emprestado/,
    );
    expect(
      conferirVolumeNoProtocolo({ ...noArquivo, situacao: 'emprestado' }, arquivo, unidade),
    ).toHaveLength(1);
    expect(conferirVolumeNoProtocolo(noArquivo, unidade, arquivo)[0]).toMatch(/remetente/);
    const comSetor: PosseVolume = { ...noArquivo, noLocal: false, setorAtual: 5 };
    expect(conferirVolumeNoProtocolo(comSetor, unidade, arquivo)).toEqual([]);
    expect(conferirVolumeNoProtocolo(comSetor, { setor: 6, local: null }, arquivo)[0]).toMatch(/remetente/);
    expect(conferirVolumeNoProtocolo(noArquivo, arquivo, { setor: null, local: null })[0]).toMatch(/destino/);
  });

  it('o recebimento põe o volume no arquivo ou com o setor do destinatário, sem mudar a situação', () => {
    expect(posseAoReceber({ situacao: 'aberto', localArquivo: 10 }, unidade)).toEqual({
      situacao: 'aberto',
      noLocal: false,
      localArquivo: 10,
    });
    expect(posseAoReceber({ situacao: 'aberto', localArquivo: 10 }, { setor: null, local: 11 })).toEqual({
      situacao: 'aberto',
      noLocal: true,
      localArquivo: 11,
    });
  });

  it('o empréstimo recusa o volume em trânsito num protocolo', () => {
    expect(
      conferirEmprestimo({
        situacao: 'arquivado',
        noLocal: true,
        emprestimoAberto: false,
        emTransito: true,
      })[0]?.mensagem,
    ).toMatch(/trânsito/);
  });

  it('a devolução restaura a situação de antes do empréstimo', () => {
    expect(situacaoAposDevolucao('aberto')).toBe('aberto');
    expect(situacaoAposDevolucao('encerrado')).toBe('encerrado');
    expect(situacaoAposDevolucao(null)).toBe('arquivado');
    expect(situacaoAposDevolucao('emprestado')).toBe('arquivado');
  });
});

describe('solicitação que sai da fila sem empréstimo', () => {
  it('recalcula a situação pelos itens', () => {
    expect(situacaoDaSolicitacaoPelosItens(['pendente', 'pendente'])).toBe('pendente');
    expect(situacaoDaSolicitacaoPelosItens(['emprestado', 'pendente'])).toBe('em_atendimento');
    expect(situacaoDaSolicitacaoPelosItens(['nao_localizado', 'pendente'])).toBe('em_atendimento');
    expect(situacaoDaSolicitacaoPelosItens(['emprestado', 'atendido'])).toBe('atendida');
    expect(situacaoDaSolicitacaoPelosItens(['emprestado', 'nao_localizado'])).toBe('atendida_parcial');
    expect(situacaoDaSolicitacaoPelosItens(['nao_localizado'])).toBe('cancelada');
    expect(situacaoDaSolicitacaoPelosItens(['cancelado', 'emprestado'])).toBe('atendida');
    expect(situacaoDaSolicitacaoPelosItens(['cancelado'])).toBe('cancelada');
  });

  it('cancela só a aberta e com motivo; não localizado só o item pendente, com onde se procurou', () => {
    expect(conferirCancelamentoSolicitacao('pendente', 'Paciente teve alta')).toEqual([]);
    expect(conferirCancelamentoSolicitacao('em_atendimento', ' ').map((p) => p.campo)).toEqual(['motivo']);
    expect(conferirCancelamentoSolicitacao('atendida', 'x').map((p) => p.campo)).toEqual(['solicitacao']);
    expect(conferirNaoLocalizado('pendente', 'pendente', 'Estante 4 e arquivo morto')).toEqual([]);
    expect(conferirNaoLocalizado('pendente', 'emprestado', 'x').map((p) => p.campo)).toEqual(['item']);
    expect(conferirNaoLocalizado('em_atendimento', 'pendente', null).map((p) => p.campo)).toEqual(['motivo']);
    expect(conferirNaoLocalizado('cancelada', 'pendente', 'x').map((p) => p.campo)).toEqual(['solicitacao']);
  });
});
