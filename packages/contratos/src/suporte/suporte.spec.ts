// Escritas que o Corrigir do suporte não desfaz (ADR 0021): o registro clínico do M22 entra na lista com a ação
// corretiva (suspender e registrar a correção), as leituras do PEP não.
import { describe, expect, it } from 'vitest';
import { ehAtoClinico, naoReversivelDe } from './suporte.js';

describe('efeitos não reversíveis do "como"', () => {
  it('registro clínico: finalizar, rascunho, descarte e suspensão', () => {
    for (const c of [
      '/api/pep/registro/1003/finalizar',
      '/api/pep/registro/1003/rascunho',
      '/api/pep/registro/1003/registros/77/suspender',
      '/api/pep/rascunhos/12/descartar',
    ]) {
      expect(naoReversivelDe(c)).toMatch(/suspenda o registro/);
      expect(ehAtoClinico(c)).toBe(true);
    }
    expect(naoReversivelDe('/api/pep/registro/1003/motivo')).toBeNull();
    expect(naoReversivelDe('/api/pep/registro/1003/formulario/61')).toBeNull();
  });

  it('M47.3: envio, reenvio e simulação da lista de trabalho do PACS; a consulta não', () => {
    for (const c of [
      '/api/sadt/imagem/worklist/enviar',
      '/api/sadt/imagem/worklist/12/reenviar',
      '/api/sadt/imagem/worklist/12/simular',
    ])
      expect(naoReversivelDe(c)).toMatch(/mesmo número de acesso/);
    expect(naoReversivelDe('/api/sadt/imagem/worklist')).toBeNull();
  });
});
