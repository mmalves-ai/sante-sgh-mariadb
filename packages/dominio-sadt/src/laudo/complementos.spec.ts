import { describe, expect, it } from 'vitest';
import {
  avisoDoAchadoCritico,
  conferirPalavrasChave,
  destinatariosDaRetificacaoDoLaudo,
  emissaoSuperada,
  exameAposAssinatura,
  mudancaDePalavras,
} from './complementos.js';
import { RecusaLaudo } from './redacao.js';

const codigo = (fn: () => unknown) => {
  try {
    fn();
    return 'passou';
  } catch (e) {
    return e instanceof RecusaLaudo ? e.codigo : String(e);
  }
};

describe('complementos do laudo (05-SADT linha 16)', () => {
  it('palavras-chave: sem repetição, só do cadastro ativo, com teto', () => {
    expect(conferirPalavrasChave([3, 1, 3], new Set([1, 3]))).toEqual([3, 1]);
    expect(codigo(() => conferirPalavrasChave([1, 9], new Set([1])))).toBe('palavra-chave-inexistente');
    const muitas = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(codigo(() => conferirPalavrasChave(muitas, new Set(muitas)))).toBe('palavras-chave-demais');
  });

  it('palavras-chave: a nova entra, a que voltou é reativada e a retirada é marcada (nada apagado)', () => {
    const gravadas = [
      { id: 10, palavra: 1, excluida: false },
      { id: 11, palavra: 2, excluida: true },
      { id: 12, palavra: 3, excluida: false },
    ];
    expect(mudancaDePalavras(gravadas, [2, 3, 4])).toEqual({ incluir: [4], reativar: [11], retirar: [10] });
    expect(mudancaDePalavras(gravadas, [])).toEqual({ incluir: [], reativar: [], retirar: [10, 12] });
    expect(mudancaDePalavras(gravadas, [1, 3])).toEqual({ incluir: [], reativar: [], retirar: [] });
  });

  it('a assinatura libera o exame realizado; o já liberado ou entregue não muda', () => {
    expect(exameAposAssinatura('em_analise')).toBe('liberado');
    expect(exameAposAssinatura('coletado')).toBe('liberado');
    expect(exameAposAssinatura('liberado')).toBeNull();
    expect(exameAposAssinatura('entregue')).toBeNull();
  });

  it('achado crítico: abre uma vez, não repete, e a retirada cancela só o que não foi comunicado', () => {
    expect(avisoDoAchadoCritico(true, [])).toBe('abrir');
    expect(avisoDoAchadoCritico(true, [{ situacao: 'pendente' }])).toBe('nada');
    expect(avisoDoAchadoCritico(true, [{ situacao: 'comunicado' }])).toBe('nada');
    expect(avisoDoAchadoCritico(true, [{ situacao: 'cancelado' }])).toBe('abrir');
    expect(avisoDoAchadoCritico(false, [{ situacao: 'pendente' }])).toBe('cancelar');
    expect(avisoDoAchadoCritico(false, [{ situacao: 'escalonado' }])).toBe('cancelar');
    expect(avisoDoAchadoCritico(false, [{ situacao: 'comunicado' }])).toBe('nada');
    expect(avisoDoAchadoCritico(false, [])).toBe('nada');
  });

  it('retificação do laudo emitido: avisa quem emitiu e quem pediu, menos quem retifica, sem repetir', () => {
    expect(destinatariosDaRetificacaoDoLaudo([5, 5, null, 7], [7, 8], 8)).toEqual([5, 7]);
    expect(destinatariosDaRetificacaoDoLaudo([], [null], 1)).toEqual([]);
  });

  it('a emissão anterior à retificação fica superada', () => {
    const emitida = new Date('2026-11-20T10:00:00Z');
    expect(emissaoSuperada(emitida, [])).toBe(false);
    expect(emissaoSuperada(emitida, [new Date('2026-11-19T10:00:00Z')])).toBe(false);
    expect(emissaoSuperada(emitida, [new Date('2026-11-21T10:00:00Z')])).toBe(true);
  });
});
