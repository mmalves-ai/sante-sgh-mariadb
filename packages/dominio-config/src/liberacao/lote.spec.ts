// DP-4 e regra 9 do M08 (parte pura): lote numa ação só, reversível; quem a chave libera.
import { describe, expect, it } from 'vitest';
import { recursoLigado } from './recurso.js';
import { chaveLibera, ErroLote, planejarLote, reversaoLiga, reverterLote } from './lote.js';

describe('liberação em lote (DP-4)', () => {
  it('uma mudança por valor, sem repetir, só onde o estado muda, com o estado de antes', () => {
    const m = planejarLote(
      [
        { escopo: 'setor', valor: '10', ligada: true },
        { escopo: 'setor', valor: '11', ligada: false },
      ],
      'setor',
      ['10', '11', '12', '12', ' '],
      true,
    );
    expect(m).toEqual([
      { escopo: 'setor', valor: '11', ligada: true, antes: false },
      { escopo: 'setor', valor: '12', ligada: true, antes: null },
    ]);
  });
  it('reverter volta ao estado de antes (criada pelo lote volta a herdar)', () => {
    const lote = [
      { escopo: 'grupo' as const, valor: 'RECEPCAO', ligada: true, antes: null },
      { escopo: 'grupo' as const, valor: 'X', ligada: false, antes: true },
    ];
    expect(reverterLote(lote)).toEqual([
      { escopo: 'grupo', valor: 'RECEPCAO', ligada: null, antes: true },
      { escopo: 'grupo', valor: 'X', ligada: true, antes: false },
    ]);
    expect(reversaoLiga(lote)).toBe(true);
    expect(reversaoLiga([lote[0]!])).toBe(false);
  });
  it('reverter com a chave mais ampla ligada: o setor criado pelo lote volta a herdar (continua liberado)', () => {
    const doEstabelecimento = { escopo: 'hospital' as const, valor: '*', ligada: true };
    // Antes do lote: o setor 10 herda do estabelecimento (liberado).
    expect(chaveLibera([doEstabelecimento], 'SINT.UM', undefined, '10')).toBe(true);
    // O lote DESLIGA o setor 10 (linha nova) e é revertido.
    const [m] = planejarLote([doEstabelecimento], 'setor', ['10'], false);
    expect(m).toEqual({ escopo: 'setor', valor: '10', ligada: false, antes: null });
    const [volta] = reverterLote([m!]);
    const depois = [doEstabelecimento, { escopo: volta!.escopo, valor: volta!.valor, ligada: volta!.ligada }];
    expect(chaveLibera(depois, 'SINT.UM', undefined, '10')).toBe(true);
    // Linha que herda conta como ausente no próximo lote (antes nulo outra vez).
    expect(planejarLote(depois, 'setor', ['10'], true)).toEqual([
      { escopo: 'setor', valor: '10', ligada: true, antes: null },
    ]);
  });
  it('recurso ligado na hora do uso: a chave libera E nenhum pré-requisito falta (vencido desliga)', () => {
    const chaves = [{ escopo: 'hospital' as const, valor: '*', ligada: true }];
    const declarados = [
      { tipo: 'certificado' as const, descricao: 'Certificado sintético', responsavel: 'TI' },
    ];
    const agora = new Date('2026-10-20T12:00:00Z');
    const ok = [{ tipo: 'certificado' as const, situacao: 'cumprido' as const, validade: '2026-12-31' }];
    const vencido = [{ tipo: 'certificado' as const, situacao: 'cumprido' as const, validade: '2026-10-01' }];
    expect(recursoLigado(chaves, declarados, ok, { pessoa: 'SINT.UM' }, agora)).toBe(true);
    expect(recursoLigado(chaves, declarados, vencido, { pessoa: 'SINT.UM' }, agora)).toBe(false);
    expect(recursoLigado([], declarados, ok, { pessoa: 'SINT.UM' }, agora)).toBe(false);
  });
  it('recusas: lista vazia, estabelecimento sem *, * fora do estabelecimento', () => {
    expect(() => planejarLote([], 'pessoa', [], true)).toThrow(ErroLote);
    expect(() => planejarLote([], 'hospital', ['pc'], true)).toThrow(/'\*'/);
    expect(() => planejarLote([], 'setor', ['*'], true)).toThrow(/só vale/);
    expect(planejarLote([], 'hospital', ['*'], true)).toHaveLength(1);
  });
  it('quem a chave libera: estabelecimento desligado recusa; a mais específica vence', () => {
    const k = [
      { escopo: 'hospital' as const, valor: '*', ligada: true },
      { escopo: 'setor' as const, valor: '10', ligada: false },
      { escopo: 'grupo' as const, valor: 'RECEPCAO', ligada: true },
      { escopo: 'pessoa' as const, valor: 'SINT.UM', ligada: false },
    ];
    expect(chaveLibera(k, 'SINT.UM', 'RECEPCAO', '10')).toBe(false);
    expect(chaveLibera(k, 'SINT.DOIS', 'RECEPCAO', '10')).toBe(true);
    expect(chaveLibera(k, 'SINT.DOIS', undefined, '10')).toBe(false);
    expect(chaveLibera(k, 'SINT.DOIS', undefined, undefined)).toBe(true);
    expect(
      chaveLibera(
        [
          { escopo: 'hospital', valor: '*', ligada: false },
          { escopo: 'pessoa', valor: 'SINT.UM', ligada: true },
        ],
        'SINT.UM',
        undefined,
        undefined,
      ),
    ).toBe(false);
    expect(chaveLibera([], 'SINT.UM', undefined, undefined)).toBe(false);
  });
});
