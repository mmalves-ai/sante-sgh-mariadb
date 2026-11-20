// Textos da agência transfusional, etapa 2 (M47): nenhum cita o sistema anterior nem nome de tabela; toda recusa da
// imuno-hematologia e do estoque tem texto.
import { MENSAGENS_ESTOQUE, MENSAGENS_IMUNO } from '@sgh/dominio-sadt';
import { describe, expect, it } from 'vitest';
import { mensagensAgencia } from './i18n-agencia.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos da agência transfusional (etapa 2)', () => {
  it('nenhum texto cita o sistema anterior nem nome de tabela', () => {
    const todos = [...textos(mensagensAgencia), ...textos(MENSAGENS_IMUNO), ...textos(MENSAGENS_ESTOQUE)];
    expect(
      todos.filter(([, t]) => /SPDATA|legado|sistema atual|\bSH[A-Z]{3,}\b|SGH_|SILANEXA/i.test(t)),
    ).toEqual([]);
  });
  it('as recusas das regras têm texto', () => {
    for (const c of [
      'mesmo-profissional',
      'tipagem-inconclusiva',
      'prova-cruzada-pendente',
      'bolsa-fora-do-estoque',
      'bolsa-reservada-outra',
      'bolsa-sem-reserva',
      'etiqueta-diferente-do-estoque',
      'tipagem-divergente',
    ])
      expect(MENSAGENS_IMUNO[c], c).toBeTruthy();
    for (const c of [
      'movimento-invalido',
      'bolsa-transfundida',
      'bolsa-ja-recebida',
      'versao-desatualizada',
      'reserva-excedente',
    ])
      expect(MENSAGENS_ESTOQUE[c], c).toBeTruthy();
  });
});
