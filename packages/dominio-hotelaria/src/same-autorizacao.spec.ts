// Autorização da solicitação de prontuário pelo motivo (F3.9, 04-HOT L128): regras puras de same-tramite.ts.
import { describe, expect, it } from 'vitest';
import {
  autorizacaoAoSolicitar,
  conferirAutorizacaoDaEntrega,
  conferirDecisaoAutorizacao,
} from './same-tramite.js';

const base = {
  situacao: 'pendente' as const,
  autorizacao: 'aguardando' as const,
  decisao: 'autorizar' as const,
  justificativa: null,
  solicitante: 1,
  responsavel: 2,
};

describe('autorização da solicitação de prontuário', () => {
  it('nasce aguardando só quando o motivo exige', () => {
    expect(autorizacaoAoSolicitar(true)).toBe('aguardando');
    expect(autorizacaoAoSolicitar(false)).toBeNull();
  });

  it('autoriza a solicitação aberta e aguardando, por outro usuário, sem exigir justificativa', () => {
    expect(conferirDecisaoAutorizacao(base)).toEqual([]);
    expect(conferirDecisaoAutorizacao({ ...base, situacao: 'em_atendimento' })).toEqual([]);
  });

  it('recusa a decisão de quem pediu, a negativa sem justificativa e a solicitação fechada', () => {
    expect(conferirDecisaoAutorizacao({ ...base, responsavel: 1 }).map((p) => p.campo)).toEqual([
      'responsavel',
    ]);
    expect(
      conferirDecisaoAutorizacao({ ...base, decisao: 'negar', justificativa: '  ' }).map((p) => p.mensagem),
    ).toEqual(['A negativa exige a justificativa.']);
    expect(
      conferirDecisaoAutorizacao({ ...base, decisao: 'negar', justificativa: 'Sem parecer do comitê' }),
    ).toEqual([]);
    expect(conferirDecisaoAutorizacao({ ...base, situacao: 'cancelada' }).map((p) => p.campo)).toEqual([
      'solicitacao',
    ]);
  });

  it('recusa decidir de novo ou decidir o que o motivo não exige', () => {
    expect(conferirDecisaoAutorizacao({ ...base, autorizacao: 'autorizada' }).map((p) => p.mensagem)).toEqual(
      ['A autorização desta solicitação já foi decidida.'],
    );
    expect(conferirDecisaoAutorizacao({ ...base, autorizacao: null }).map((p) => p.mensagem)).toEqual([
      'O motivo desta solicitação não exige autorização.',
    ]);
  });

  it('só entrega o volume autorizado quando o motivo exige; nada sai aguardando ou negado', () => {
    expect(
      conferirAutorizacaoDaEntrega({
        exigeAutorizacao: true,
        autorizacao: 'autorizada',
        comSolicitacao: true,
      }),
    ).toEqual([]);
    expect(
      conferirAutorizacaoDaEntrega({ exigeAutorizacao: false, autorizacao: null, comSolicitacao: false }),
    ).toEqual([]);
    expect(
      conferirAutorizacaoDaEntrega({
        exigeAutorizacao: true,
        autorizacao: 'aguardando',
        comSolicitacao: true,
      })[0]!.mensagem,
    ).toBe('A solicitação aguarda a autorização do responsável do arquivo.');
    expect(
      conferirAutorizacaoDaEntrega({
        exigeAutorizacao: false,
        autorizacao: 'aguardando',
        comSolicitacao: true,
      }),
    ).toHaveLength(1);
    expect(
      conferirAutorizacaoDaEntrega({
        exigeAutorizacao: true,
        autorizacao: 'negada',
        comSolicitacao: true,
      })[0]!.mensagem,
    ).toBe('A autorização desta solicitação foi negada.');
    expect(
      conferirAutorizacaoDaEntrega({ exigeAutorizacao: true, autorizacao: null, comSolicitacao: false })[0]!
        .mensagem,
    ).toBe('O motivo exige autorização: registre a solicitação e aguarde a decisão do responsável.');
    expect(
      conferirAutorizacaoDaEntrega({ exigeAutorizacao: true, autorizacao: null, comSolicitacao: true })[0]!
        .mensagem,
    ).toBe('A solicitação não tem a autorização que o motivo exige.');
  });
});
