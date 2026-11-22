import { describe, expect, it } from 'vitest';
import {
  bloqueadoParaAssinatura,
  categoriaAssinavel,
  estadoDoEnvelope,
  registroExibido,
} from './regras-assinatura.js';

describe('regras da assinatura', () => {
  it('só lançado, validado e aguardando assinatura podem receber assinatura', () => {
    for (const c of ['lancado', 'validado', 'aguardando_assinatura']) {
      expect(categoriaAssinavel(c)).toBe(true);
      expect(bloqueadoParaAssinatura(c)).toBe(false);
    }
    for (const c of ['rascunho', 'corrigido', 'arquivado', 'suspenso', 'cancelado', 'outra']) {
      expect(categoriaAssinavel(c)).toBe(false);
      expect(bloqueadoParaAssinatura(c)).toBe(true);
    }
    // Já assinado: não entra na fila, mas não é tratado como suspenso.
    expect(categoriaAssinavel('assinado')).toBe(false);
    expect(bloqueadoParaAssinatura('assinado')).toBe(false);
  });

  it('envelope: sem assinatura, falha, pendente, indeterminado e válido', () => {
    const v = { situacao: 'valida' };
    expect(estadoDoEnvelope({ situacao: 'pendente', assinaturasExigidas: 1, assinaturas: [] })).toBeNull();
    expect(estadoDoEnvelope({ situacao: 'parcial', assinaturasExigidas: 2, assinaturas: [v] })).toEqual({
      estado: 'pendente',
      resultado: null,
    });
    // Situação incoerente (assinado com menos que o exigido): pendente, nunca válido.
    expect(estadoDoEnvelope({ situacao: 'assinado', assinaturasExigidas: 2, assinaturas: [v] })?.estado).toBe(
      'pendente',
    );
    expect(
      estadoDoEnvelope({
        situacao: 'assinado',
        assinaturasExigidas: 1,
        assinaturas: [{ situacao: 'revogada' }, v],
      }),
    ).toEqual({ estado: 'falha', resultado: 'invalida' });
    expect(
      estadoDoEnvelope({
        situacao: 'parcial',
        assinaturasExigidas: 2,
        assinaturas: [{ situacao: 'invalida' }],
      }),
    ).toEqual({ estado: 'falha', resultado: 'invalida' });
    expect(
      estadoDoEnvelope({
        situacao: 'assinado',
        assinaturasExigidas: 1,
        assinaturas: [{ situacao: 'expirada' }],
      }),
    ).toEqual({ estado: 'assinada', resultado: 'indeterminada' });
    expect(estadoDoEnvelope({ situacao: 'assinado', assinaturasExigidas: 2, assinaturas: [v, v] })).toEqual({
      estado: 'assinada',
      resultado: 'valida',
    });
  });

  it('registro exibido', () => {
    expect(registroExibido({ sigla: 'CRM', uf: 'RJ', numero: '123' })).toBe('CRM-RJ 123');
    expect(registroExibido({ sigla: null, uf: null, numero: '9' })).toBe('Conselho 9');
    expect(registroExibido({ sigla: 'CRM', uf: 'RJ', numero: null })).toBeNull();
    expect(registroExibido(null)).toBeNull();
  });
});
