import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoProtocolo,
  conferirEmprestimo,
  conferirProtocolo,
  conferirRecebimento,
  conferirSolicitacaoAberta,
  conteudoDoProtocolo,
  diasDeAtraso,
  prazoDoEmprestimo,
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
