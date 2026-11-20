// Permissões do M53-F0: formato, opção do outro sistema que concede, presença no catálogo declarado e criticidade.
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from './catalogo.js';
import { CATALOGO_LEGADO } from './catalogo-legado.js';
import { PERMISSOES_FOLHA_M53 } from './pessoas-folha.js';
import { FORMATO_CODIGO_PERMISSAO } from './tipos.js';

const opcoesDoLegado = new Set(CATALOGO_LEGADO.flatMap((p) => p.opcoesLegado));

describe('permissões da folha (M53-F0)', () => {
  it('vinte e quatro permissões (F0 a F8), únicas, no catálogo declarado, cada uma com opção que existe na árvore do outro sistema', () => {
    const codigos = PERMISSOES_FOLHA_M53.map((p) => p.codigo);
    expect(codigos).toEqual([
      'pessoas.folha.ler',
      'pessoas.folha.exportar',
      'pessoas.folha.importar',
      'pessoas.folha.abrir',
      'pessoas.afastamento.registrar',
      'pessoas.folha.calcular',
      'pessoas.salario.ler',
      'pessoas.salario.editar',
      'pessoas.parametroFolha.editar',
      'pessoas.ferias.ler',
      'pessoas.ferias.programar',
      'pessoas.ferias.calcular',
      'pessoas.decimo.calcular',
      'pessoas.rescisao.ler',
      'pessoas.rescisao.calcular',
      'pessoas.esocial.ler',
      'pessoas.esocial.gerar',
      'pessoas.esocial.transmitir',
      'pessoas.folha.fechar',
      'pessoas.obrigacao.ler',
      'pessoas.obrigacao.gerar',
      'pessoas.integracao.ler',
      'pessoas.integracao.configurar',
      'pessoas.integracao.lancar',
    ]);
    for (const p of PERMISSOES_FOLHA_M53) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length).toBeGreaterThan(0);
      for (const o of p.opcoesLegado) expect(opcoesDoLegado.has(o)).toBe(true);
      expect(CATALOGO_DECLARADO).toContain(p);
    }
    const todos = CATALOGO_DECLARADO.map((p) => p.codigo);
    for (const c of codigos) expect(todos.filter((x) => x === c)).toHaveLength(1);
  });

  it('exportar e importar são sensíveis (dado de colaborador sai e valor entra)', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    expect(por.get('pessoas.folha.exportar')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.folha.importar')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.afastamento.registrar')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.folha.ler')?.criticidade).toBe('normal');
  });

  it('abrir a área (D-ABRIR-532): quem tem a folha, os eventos, a tabela legal, os parâmetros ou a integração', async () => {
    const { DOMINIOS_DECLARADOS } = await import('../dominios/catalogo.js');
    const abrir = new Set(PERMISSOES_FOLHA_M53.find((p) => p.codigo === 'pessoas.folha.abrir')!.opcoesLegado);
    const ler = PERMISSOES_FOLHA_M53.find((p) => p.codigo === 'pessoas.folha.ler')!.opcoesLegado;
    for (const o of ler) expect(abrir.has(o)).toBe(true);
    // Toda opção que dá a leitura de um cadastro da folha do M53 (a tela das rubricas) também abre a área.
    for (const d of DOMINIOS_DECLARADOS.filter((x) => x.marco === 'M53' && x.modulo === 'pessoas'))
      for (const o of d.opcoesLegado.ler) expect(abrir.has(o), `${d.recurso} ${o}`).toBe(true);
    expect(PERMISSOES_FOLHA_M53.find((p) => p.codigo === 'pessoas.folha.abrir')?.criticidade).toBe('normal');
  });

  it('cálculo, salário e parâmetros (M53-F2): sensíveis; quem calcula ou altera o salário abre a área', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    for (const c of [
      'pessoas.folha.calcular',
      'pessoas.salario.ler',
      'pessoas.salario.editar',
      'pessoas.parametroFolha.editar',
    ])
      expect(por.get(c)?.criticidade).toBe('sensivel');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const c of ['pessoas.folha.calcular', 'pessoas.salario.editar', 'pessoas.parametroFolha.editar'])
      for (const o of por.get(c)!.opcoesLegado) expect(abrir.has(o), `${c} ${o}`).toBe(true);
  });

  it('férias e 13º (M53-F3): calcular é sensível; ler e programar não; quem tem qualquer uma abre a área', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    expect(por.get('pessoas.ferias.calcular')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.decimo.calcular')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.ferias.ler')?.criticidade).toBe('normal');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const c of [
      'pessoas.ferias.ler',
      'pessoas.ferias.programar',
      'pessoas.ferias.calcular',
      'pessoas.decimo.calcular',
    ])
      for (const o of por.get(c)!.opcoesLegado) expect(abrir.has(o), `${c} ${o}`).toBe(true);
  });

  it('rescisão (M53-F4): calcular é sensível; ler não; quem tem qualquer uma abre a área', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    expect(por.get('pessoas.rescisao.calcular')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.rescisao.calcular')?.categoria).toBe('financeira');
    expect(por.get('pessoas.rescisao.ler')?.criticidade).toBe('normal');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const c of ['pessoas.rescisao.ler', 'pessoas.rescisao.calcular'])
      for (const o of por.get(c)!.opcoesLegado) expect(abrir.has(o), `${c} ${o}`).toBe(true);
  });

  it('eSocial (M53-F5): gerar e transmitir são sensíveis; ler não; nenhuma abre a área da folha', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    expect(por.get('pessoas.esocial.ler')?.criticidade).toBe('normal');
    expect(por.get('pessoas.esocial.gerar')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.esocial.transmitir')?.criticidade).toBe('sensivel');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const o of por.get('pessoas.esocial.ler')!.opcoesLegado) expect(abrir.has(o)).toBe(false);
  });

  it('fechamento (M53-F6): fechar é sensível e financeiro, e as opções dele abrem a área da folha', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    const f = por.get('pessoas.folha.fechar')!;
    expect(f.criticidade).toBe('sensivel');
    expect(f.categoria).toBe('financeira');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const o of f.opcoesLegado) expect(abrir.has(o)).toBe(true);
  });

  it('obrigações (M53-F7): gerar é sensível; as exportações das obrigações abrem a área da folha', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    const g = por.get('pessoas.obrigacao.gerar')!;
    expect(g.criticidade).toBe('sensivel');
    expect(por.get('pessoas.obrigacao.ler')!.criticidade).toBe('normal');
    const abrir = new Set(por.get('pessoas.folha.abrir')!.opcoesLegado);
    for (const o of g.opcoesLegado) expect(abrir.has(o)).toBe(true);
    expect(g.opcoesLegado).toEqual([525, 526, 527, 528]);
  });

  it('integração (M53-F8): configurar e lançar são financeiras e sensíveis; quem lança ou configura também lê', () => {
    const por = new Map(PERMISSOES_FOLHA_M53.map((p) => [p.codigo, p]));
    const ler = new Set(por.get('pessoas.integracao.ler')!.opcoesLegado);
    for (const c of ['pessoas.integracao.configurar', 'pessoas.integracao.lancar']) {
      const p = por.get(c)!;
      expect(p.criticidade).toBe('sensivel');
      expect(p.categoria).toBe('financeira');
      for (const o of p.opcoesLegado) expect(ler.has(o)).toBe(true);
    }
    expect(por.get('pessoas.integracao.lancar')!.opcoesLegado).toEqual([397]);
  });
});
