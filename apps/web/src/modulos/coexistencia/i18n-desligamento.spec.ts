// Toda chave do vocabulário do M58 tem texto, e nenhum texto cita a chave técnica do parâmetro ou da liberação.
import {
  CONTINGENCIAS_DESLIGAMENTO,
  DESTINOS_CONTA_TECNICA,
  esquemaItemDesligamentoAvaliado,
  INVENTARIO_DESLIGAMENTO,
  MOTIVOS_BLOQUEIO_PASSO,
  PASSOS_DESLIGAMENTO,
  SITUACOES_ITEM_DESLIGAMENTO,
  SITUACOES_PASSO,
  TIPOS_RECURSO_FORNECEDOR,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensDesligamento as m } from './i18n-desligamento.js';

function textos(o: unknown, caminho = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[caminho, o]];
  if (o && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => textos(v, caminho ? `${caminho}.${k}` : k));
  return [];
}

describe('textos do desligamento (M58)', () => {
  it('todo código do contrato tem texto', () => {
    for (const p of PASSOS_DESLIGAMENTO) expect(m.passos.nomes[p]).toBeTruthy();
    for (const s of SITUACOES_PASSO) expect(m.passos.situacoes[s]).toBeTruthy();
    for (const x of MOTIVOS_BLOQUEIO_PASSO) expect(m.passos.motivos[x]).toBeTruthy();
    for (const t of TIPOS_RECURSO_FORNECEDOR) expect(m.inventario.tipos[t]).toBeTruthy();
    for (const s of SITUACOES_ITEM_DESLIGAMENTO) expect(m.inventario.situacoes[s]).toBeTruthy();
    for (const c of CONTINGENCIAS_DESLIGAMENTO) expect(m.inventario.contingencias[c]).toBeTruthy();
    for (const d of DESTINOS_CONTA_TECNICA) expect(m.contas.destinos[d]).toBeTruthy();
    const pendencias = esquemaItemDesligamentoAvaliado.shape.pendencias.element.options;
    for (const p of pendencias) expect(m.inventario.pendencias[p]).toBeTruthy();
  });

  it('todo item do inventário tem título e descrição, e não sobra texto de item que não existe', () => {
    const ids = INVENTARIO_DESLIGAMENTO.map((i) => i.id).sort();
    expect(Object.keys(m.inventario.itens).sort()).toEqual(ids);
    for (const i of Object.values(m.inventario.itens)) {
      expect(i.titulo.length).toBeGreaterThan(3);
      expect(i.descricao.length).toBeGreaterThan(10);
    }
  });

  it('nenhum texto mostra chave técnica, nome de conta do banco ou nome de tabela', () => {
    const achados = textos(m).filter(([, t]) =>
      /\blegado\.charset\b|\bentrada\.utf8\b|\b[A-Z][A-Z0-9_]{5,}\b|\bsante-api\b/.test(t),
    );
    expect(achados).toEqual([]);
  });
});
