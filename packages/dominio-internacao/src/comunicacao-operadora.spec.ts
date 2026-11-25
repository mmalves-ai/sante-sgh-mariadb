import { describe, expect, it } from 'vitest';
import {
  conferirNovaComunicacao,
  type ContextoNovaComunicacao,
  conferirMensagemComunicacao,
  tipoInternacaoDaModalidade,
  transicaoComunicacao,
} from './comunicacao-operadora.js';

const ctx: ContextoNovaComunicacao = {
  tipo: 'internacao',
  tipoFonte: 'operadora',
  registroAns: '123456',
  numeroCarteira: '0001',
  altaRegistrada: false,
  altaPorObito: false,
  vivas: [],
};

describe('nova comunicação à operadora', () => {
  it('aceita a internação de beneficiário de operadora', () => {
    expect(conferirNovaComunicacao(ctx)).toEqual([]);
  });
  it('recusa fonte pública, sem registro e sem carteira', () => {
    const p = conferirNovaComunicacao({
      ...ctx,
      tipoFonte: 'publico',
      registroAns: null,
      numeroCarteira: ' ',
    });
    expect(p.map((x) => x.campo)).toEqual(['fonte', 'fonte', 'carteira']);
  });
  it('uma internação viva só; alta só depois da alta registrada e da internação comunicada', () => {
    expect(conferirNovaComunicacao({ ...ctx, vivas: ['internacao'] })).toHaveLength(1);
    expect(conferirNovaComunicacao({ ...ctx, tipo: 'alta' }).map((x) => x.mensagem)).toEqual([
      'A alta ainda não foi registrada nesta internação.',
      'Comunique primeiro a internação.',
    ]);
    expect(
      conferirNovaComunicacao({ ...ctx, tipo: 'alta', altaRegistrada: true, vivas: ['internacao'] }),
    ).toEqual([]);
  });
  it('óbito exige alta por óbito e exclui a alta comum', () => {
    const base = { ...ctx, altaRegistrada: true, vivas: ['internacao'] as const };
    expect(conferirNovaComunicacao({ ...base, tipo: 'obito' })).toHaveLength(1);
    expect(conferirNovaComunicacao({ ...base, tipo: 'obito', altaPorObito: true })).toEqual([]);
    expect(conferirNovaComunicacao({ ...base, tipo: 'alta', altaPorObito: true })).toHaveLength(1);
    expect(
      conferirNovaComunicacao({ ...base, tipo: 'obito', altaPorObito: true, vivas: ['internacao', 'alta'] }),
    ).toHaveLength(1);
  });
  it('prorrogação pode repetir', () => {
    expect(
      conferirNovaComunicacao({ ...ctx, tipo: 'prorrogacao', vivas: ['internacao', 'prorrogacao'] }),
    ).toEqual([]);
  });
});

describe('situação da comunicação', () => {
  it('pendente → enviada → confirmada com protocolo', () => {
    expect(
      transicaoComunicacao({ situacao: 'pendente', acao: 'enviar', protocolo: null, resposta: null }).para,
    ).toBe('enviada');
    expect(
      transicaoComunicacao({ situacao: 'enviada', acao: 'confirmar', protocolo: null, resposta: null })
        .problemas,
    ).toHaveLength(1);
    expect(
      transicaoComunicacao({ situacao: 'enviada', acao: 'confirmar', protocolo: 'P1', resposta: null }).para,
    ).toBe('confirmada');
  });
  it('recusa o que a situação não admite e exige motivo na rejeição e no cancelamento', () => {
    expect(
      transicaoComunicacao({ situacao: 'confirmada', acao: 'cancelar', protocolo: null, resposta: 'x' }).para,
    ).toBeNull();
    expect(
      transicaoComunicacao({ situacao: 'enviada', acao: 'rejeitar', protocolo: null, resposta: '' })
        .problemas[0]?.campo,
    ).toBe('resposta');
    expect(
      transicaoComunicacao({ situacao: 'rejeitada', acao: 'reenviar', protocolo: null, resposta: null }).para,
    ).toBe('pendente');
  });
});

describe('mensagem de comunicação de beneficiário', () => {
  const d = {
    tipo: 'internacao' as const,
    registroAns: '123456',
    numeroCarteira: ' 0001 ',
    recemNascido: true,
    eventoEm: '2025-03-01T10:20:30.000Z',
    tipoInternacao: '1',
    motivoEncerramento: null,
  };
  it('a internação leva carteira, recém-nascido, data, evento I e o tipo de internação', () => {
    expect(conferirMensagemComunicacao(d)).toEqual({
      dados: {
        numeroCarteira: '0001',
        recemNascido: true,
        dataEvento: '2025-03-01',
        tipoEvento: 'I',
        tipoInternacao: '1',
        motivoEncerramento: null,
      },
      problemas: [],
    });
  });
  it('a internação sem tipo de internação é recusada', () => {
    expect(conferirMensagemComunicacao({ ...d, tipoInternacao: null }).problemas.map((p) => p.campo)).toEqual(
      ['tipoInternacao'],
    );
    expect(conferirMensagemComunicacao({ ...d, tipoInternacao: '9' }).dados).toBeNull();
  });
  it('alta e óbito saem como alta com motivo; sem motivo, recusa; prorrogação não tem mensagem', () => {
    expect(conferirMensagemComunicacao({ ...d, tipo: 'alta' }).problemas[0]?.campo).toBe(
      'motivoEncerramento',
    );
    const r = conferirMensagemComunicacao({
      ...d,
      tipo: 'obito',
      tipoInternacao: null,
      motivoEncerramento: '41',
    });
    expect(r.dados).toMatchObject({ tipoEvento: 'A', motivoEncerramento: '41', tipoInternacao: null });
    expect(conferirMensagemComunicacao({ ...d, tipo: 'prorrogacao' }).dados).toBeNull();
    expect(conferirMensagemComunicacao({ ...d, registroAns: '12' }).problemas[0]?.campo).toBe('fonte');
    expect(conferirMensagemComunicacao({ ...d, numeroCarteira: ' ' }).problemas[0]?.campo).toBe('carteira');
  });
  it('tipo de internação pelo código do cadastro ou pela classificação da modalidade', () => {
    expect(tipoInternacaoDaModalidade('3', 'clinica')).toBe('3');
    expect(tipoInternacaoDaModalidade(null, 'cirurgica')).toBe('2');
    expect(tipoInternacaoDaModalidade('X', 'psiquiatrica')).toBe('5');
    expect(tipoInternacaoDaModalidade(null, 'outra')).toBeNull();
  });
});
