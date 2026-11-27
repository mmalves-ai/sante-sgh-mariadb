// Regras da comunicação de internação e alta recebida pela operadora (04-INT linha 80, C1-108): a carteira normalizada
// na identificação, a resposta só da pendente, o aceite só com o beneficiário identificado e a recusa só com motivo.
import { describe, expect, it } from 'vitest';
import {
  carteiraNormalizada,
  problemasDaIdentificacaoComunicacao,
  problemasDaRespostaComunicacao,
} from './troca-tiss.js';

const cod = (p: { codigo: string }[]) => p.map((x) => x.codigo);

describe('comunicação recebida: identificação e resposta', () => {
  it('a carteira perde pontuação e espaços e fica em maiúsculas', () => {
    expect(carteiraNormalizada(' 0001.2345-6/7x ')).toBe('0001234567X');
    expect(carteiraNormalizada(' .-/ ')).toBe('');
  });

  it('identificar só a pendente e com carteira', () => {
    expect(problemasDaIdentificacaoComunicacao('recebida', '123')).toEqual([]);
    expect(cod(problemasDaIdentificacaoComunicacao('recebida', ' - '))).toEqual(['carteira-vazia']);
    expect(cod(problemasDaIdentificacaoComunicacao('aceita', '123'))).toEqual(['comunicacao-ja-respondida']);
  });

  it('aceitar exige o beneficiário identificado; recusar exige o motivo; a respondida não muda', () => {
    const pend = { situacao: 'recebida', beneficiarioIdentificado: true };
    expect(problemasDaRespostaComunicacao(pend, { acao: 'aceitar' })).toEqual([]);
    expect(problemasDaRespostaComunicacao(pend, { acao: 'recusar', motivoRecusa: 7 })).toEqual([]);
    expect(
      cod(problemasDaRespostaComunicacao({ ...pend, beneficiarioIdentificado: false }, { acao: 'aceitar' })),
    ).toEqual(['carteira-nao-identificada']);
    expect(
      problemasDaRespostaComunicacao(
        { ...pend, beneficiarioIdentificado: false },
        { acao: 'recusar', motivoRecusa: 7 },
      ),
    ).toEqual([]);
    expect(cod(problemasDaRespostaComunicacao(pend, { acao: 'recusar', motivoRecusa: null }))).toEqual([
      'recusa-sem-motivo',
    ]);
    expect(
      cod(problemasDaRespostaComunicacao({ ...pend, situacao: 'recusada' }, { acao: 'aceitar' })),
    ).toEqual(['comunicacao-ja-respondida']);
  });
});
