// Envio da comunicação de beneficiário pelo serviço web da operadora e leitura do retorno (C1-108, 04-INT linha 80).
import { describe, expect, it } from 'vitest';
import {
  conferirTransmissao,
  PONTO_COMUNICACAO_OPERADORA,
  retornoDaIntegracao,
  transicaoComunicacao,
} from './comunicacao-operadora.js';

describe('conferirTransmissao', () => {
  it('a pendente de internação, alta ou óbito sai com o serviço web cadastrado', () => {
    for (const tipo of ['internacao', 'alta', 'obito'] as const)
      expect(conferirTransmissao({ situacao: 'pendente', tipo, servicoWeb: true })).toEqual([]);
    expect(PONTO_COMUNICACAO_OPERADORA).toMatch(/^[a-z][a-z0-9_.]{0,79}$/);
  });
  it('recusa sem serviço web, fora da pendente e o tipo sem mensagem própria', () => {
    expect(
      conferirTransmissao({ situacao: 'pendente', tipo: 'internacao', servicoWeb: false })[0]?.campo,
    ).toBe('canal');
    expect(
      conferirTransmissao({ situacao: 'enviada', tipo: 'internacao', servicoWeb: true }).map((p) => p.campo),
    ).toEqual(['situacao']);
    expect(
      conferirTransmissao({ situacao: 'pendente', tipo: 'prorrogacao', servicoWeb: true }).map(
        (p) => p.campo,
      ),
    ).toEqual(['tipo']);
  });
});

describe('retornoDaIntegracao', () => {
  const base = {
    situacaoComunicacao: 'enviada' as const,
    situacaoMensagem: 'processada' as const,
    resposta: null as string | null,
    erro: null as string | null,
  };
  it('na fila ou só entregue: aguarda, sem ação', () => {
    expect(retornoDaIntegracao({ ...base, situacaoMensagem: 'pendente' })).toEqual({
      retorno: null,
      problemas: [],
    });
    expect(retornoDaIntegracao({ ...base, situacaoMensagem: 'enviada' })).toEqual({
      retorno: null,
      problemas: [],
    });
  });
  it('aceita com protocolo confirma; a transição do domínio aceita', () => {
    const r = retornoDaIntegracao({
      ...base,
      resposta: JSON.stringify({ aceita: true, protocolo: ' PR-77 ' }),
    });
    expect(r.retorno).toEqual({ acao: 'confirmar', protocolo: 'PR-77', resposta: null });
    expect(transicaoComunicacao({ situacao: 'enviada', ...r.retorno! }).para).toBe('confirmada');
  });
  it('recusada rejeita com o motivo da operadora (ou o padrão)', () => {
    expect(
      retornoDaIntegracao({
        ...base,
        resposta: JSON.stringify({ aceita: false, motivo: 'Carteira inválida' }),
      }).retorno,
    ).toEqual({ acao: 'rejeitar', protocolo: null, resposta: 'Carteira inválida' });
    const r = retornoDaIntegracao({ ...base, resposta: JSON.stringify({ aceita: false }) }).retorno!;
    expect(r.resposta).toBe('Recusada pela operadora.');
    expect(transicaoComunicacao({ situacao: 'enviada', ...r }).para).toBe('rejeitada');
  });
  it('erro, descartada, recibo ilegível e aceita sem protocolo falham com motivo', () => {
    const erro = retornoDaIntegracao({ ...base, situacaoMensagem: 'erro', erro: 'tempo-esgotado' }).retorno!;
    expect(erro).toEqual({
      acao: 'falhar',
      protocolo: null,
      resposta: 'Falha no envio pelo serviço web (tempo-esgotado).',
    });
    expect(transicaoComunicacao({ situacao: 'enviada', ...erro }).para).toBe('erro');
    expect(retornoDaIntegracao({ ...base, situacaoMensagem: 'descartada' }).retorno?.acao).toBe('falhar');
    expect(retornoDaIntegracao({ ...base, resposta: '<xml' }).retorno?.resposta).toBe(
      'Retorno da operadora ilegível.',
    );
    expect(retornoDaIntegracao({ ...base, resposta: JSON.stringify({ aceita: true }) }).retorno?.acao).toBe(
      'falhar',
    );
  });
  it('só a enviada lê retorno', () => {
    const r = retornoDaIntegracao({ ...base, situacaoComunicacao: 'pendente' });
    expect(r.retorno).toBeNull();
    expect(r.problemas[0]?.campo).toBe('situacao');
  });
});
