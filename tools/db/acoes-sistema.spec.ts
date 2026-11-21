// Regra pura do catálogo de ações (acao_sistema): o tipo pelo verbo, os limites das colunas e a recusa de código
// repetido. Sem banco.
import { describe, expect, it } from 'vitest';
import type { DeclaracaoPermissao } from '@sgh/contratos';
import {
  TAMANHO_CODIGO,
  TAMANHO_DESCRICAO,
  TIPOS_ACAO,
  acoesDoCatalogo,
  catalogoDoProduto,
  tipoDaAcao,
} from './acoes-sistema.js';

const p = (codigo: string, descricao = 'Ação de teste'): DeclaracaoPermissao =>
  ({ codigo, descricao, concessaoPorPerfil: null }) as DeclaracaoPermissao;

describe('tipo da ação', () => {
  it('pelo verbo final do código', () => {
    expect(tipoDaAcao('pep.evolucao.ler')).toBe('ver');
    expect(tipoDaAcao('agenda.marcacao.criar')).toBe('incluir');
    expect(tipoDaAcao('cadastro.paciente.editar')).toBe('alterar');
    expect(tipoDaAcao('cadastro.paciente.inativar')).toBe('excluir');
    expect(tipoDaAcao('suprimentos.pedido.aprovar')).toBe('aprovar');
    expect(tipoDaAcao('relatorio.censo.modeloXIV')).toBe('imprimir');
    expect(tipoDaAcao('relatorio.censo.preImpressao')).toBe('imprimir');
    expect(tipoDaAcao('financeiro.titulos.exportar')).toBe('exportar');
    expect(tipoDaAcao('documento.laudo.assinar')).toBe('assinar');
    expect(tipoDaAcao('faturamento.conta.liberar')).toBe('liberar');
    expect(tipoDaAcao('sistema.rotina.solicitarLimpeza')).toBe('executar');
  });
});

describe('linhas de acao_sistema', () => {
  it('o catálogo do produto inteiro cabe nas colunas, sem repetição e com tipo válido', () => {
    const acoes = acoesDoCatalogo();
    expect(acoes.length).toBe(catalogoDoProduto().length);
    expect(acoes.length).toBeGreaterThan(1000);
    expect(new Set(acoes.map((a) => a.codigo.toLowerCase())).size).toBe(acoes.length);
    for (const a of acoes) {
      expect(a.codigo.length).toBeLessThanOrEqual(TAMANHO_CODIGO);
      expect(a.descricao.length).toBeGreaterThan(0);
      expect(a.descricao.length).toBeLessThanOrEqual(TAMANHO_DESCRICAO);
      expect(TIPOS_ACAO).toContain(a.tipoAcao);
      expect(a.ordem).toBeGreaterThan(0);
      expect(a.ordem).toBeLessThanOrEqual(65_535);
    }
  });

  it('descrição longa é cortada; vazia vira o código', () => {
    const [longa, vazia] = acoesDoCatalogo([p('a.b.ler', 'x'.repeat(400)), p('a.c.ler', '  ')]);
    expect(longa?.descricao.length).toBe(TAMANHO_DESCRICAO);
    expect(vazia?.descricao).toBe('a.c.ler');
  });

  it('código repetido (sem diferenciar maiúsculas e acentos) ou longo demais recusa', () => {
    expect(() => acoesDoCatalogo([p('a.b.ler'), p('A.B.LER')])).toThrow(/repetido/);
    expect(() => acoesDoCatalogo([p('a.ação.ler'), p('a.acao.ler')])).toThrow(/repetido/);
    expect(() => acoesDoCatalogo([p('x'.repeat(TAMANHO_CODIGO + 1))])).toThrow(/caracteres/);
  });
});
