import { describe, expect, it } from 'vitest';
import {
  conferirNovaComunicacao,
  type ContextoNovaComunicacao,
  montarMensagemComunicacao,
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
    cnesOuCodigoPrestador: 'PRE<1>',
    numeroCarteira: '0001',
    recemNascido: false,
    numeroGuia: 'G1',
    eventoEm: '2025-03-01T10:20:30.000Z',
    tipoInternacao: '1',
    motivoEncerramento: null,
    sequencial: '9',
  };
  it('monta a internação com carteira, evento e guia, com escape', () => {
    const r = montarMensagemComunicacao(d);
    expect(r.problemas).toEqual([]);
    expect(r.xml).toContain('<ans:tipoEvento>I</ans:tipoEvento>');
    expect(r.xml).toContain('<ans:dataEvento>2025-03-01</ans:dataEvento>');
    expect(r.xml).toContain('PRE&lt;1&gt;');
    expect(r.xml).toContain('<ans:tipoInternacao>1</ans:tipoInternacao>');
    expect(r.xml).not.toContain('motivoEncerramento');
  });
  it('alta e óbito saem como alta com motivo; sem motivo, recusa; prorrogação não tem mensagem', () => {
    expect(montarMensagemComunicacao({ ...d, tipo: 'alta' }).problemas[0]?.campo).toBe('motivoEncerramento');
    const r = montarMensagemComunicacao({ ...d, tipo: 'obito', motivoEncerramento: '41' });
    expect(r.xml).toContain('<ans:tipoEvento>A</ans:tipoEvento>');
    expect(r.xml).toContain('<ans:motivoEncerramento>41</ans:motivoEncerramento>');
    expect(montarMensagemComunicacao({ ...d, tipo: 'prorrogacao' }).xml).toBeNull();
    expect(montarMensagemComunicacao({ ...d, registroAns: '12' }).problemas[0]?.campo).toBe('fonte');
  });
});
