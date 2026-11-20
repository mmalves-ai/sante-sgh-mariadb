import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import {
  esquemaAlterarConta,
  esquemaContaPlano,
  esquemaPublicarRegra,
  esquemaRegraContabil,
  esquemaFiltroFatos,
} from './entradas.js';
import {
  CODIGOS_ORIGEM_LANCAMENTO,
  FONTES_FATO,
  GRUPOS_CONTA,
  ORIGENS_LANCAMENTO,
  TIPOS_FATO,
} from './vocabulario.js';

const regra = {
  empresa: 1,
  origem: 3,
  tipoFato: 'receitaConta',
  versao: 1,
  nome: 'Receita de convênio',
  vigenciaInicio: '2027-01-01',
  partidas: [
    {
      lado: 'D',
      conta: { modo: 'dePara', campoChave: 'convenio' },
      valor: { base: 'valorFato' },
      historico: 'Conta {documento}',
    },
    {
      lado: 'C',
      conta: { modo: 'fixa', conta: '3.1.1.01.0001' },
      valor: { base: 'valorFato' },
      historico: 'Conta {documento}',
    },
  ],
};

describe('vocabulário da contabilidade', () => {
  it('tem as 11 origens do banco e todo tipo de fato aponta para uma delas', () => {
    expect(CODIGOS_ORIGEM_LANCAMENTO).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const t of Object.values(TIPOS_FATO)) expect(ORIGENS_LANCAMENTO[t.origem]).toBeTruthy();
  });

  it('toda fonte tem tipos conhecidos e o grupo define a natureza', () => {
    for (const f of FONTES_FATO) for (const t of f.tipos) expect(TIPOS_FATO[t]).toBeTruthy();
    expect(GRUPOS_CONTA.receita.natureza).toBe('credora');
    expect(GRUPOS_CONTA.ativo.natureza).toBe('devedora');
  });

  it('rótulos sem o nome do outro sistema', () => {
    const textos = [
      ...Object.values(ORIGENS_LANCAMENTO),
      ...Object.values(TIPOS_FATO).map((t) => t.rotulo),
    ].join(' ');
    expect(textos).not.toMatch(/spdata|legado|sistema atual/i);
  });
});

describe('entradas da contabilidade', () => {
  it('conta do plano: código por níveis e padrões', () => {
    const c = esquemaContaPlano.parse({
      empresa: 1,
      codigo: '1.1.1.01.0001',
      nome: 'Caixa geral',
      grupo: 'ativo',
      tipo: 'analitica',
      natureza: 'devedora',
    });
    expect(c.referencialTipo).toBeNull();
    expect(c.ativa).toBe(true);
    expect(esquemaContaPlano.safeParse({ ...c, codigo: '1..2' }).success).toBe(false);
    expect(esquemaContaPlano.safeParse({ ...c, codigo: 'A.1' }).success).toBe(false);
  });

  it('alterar conta não muda grupo nem tipo', () => {
    const a = esquemaAlterarConta.parse({
      empresa: 1,
      codigo: '1.1',
      versao: 0,
      nome: 'Novo',
      grupo: 'passivo',
    });
    expect(a).not.toHaveProperty('grupo');
  });

  it('regra: pelo menos duas partidas, condições e prioridade padrão', () => {
    const r = esquemaRegraContabil.parse(regra);
    expect(r.prioridade).toBe(100);
    expect(r.condicoes).toEqual([]);
    expect(esquemaRegraContabil.safeParse({ ...regra, partidas: [regra.partidas[0]] }).success).toBe(false);
    expect(esquemaRegraContabil.safeParse({ ...regra, origem: 12 }).success).toBe(false);
    expect(esquemaRegraContabil.safeParse({ ...regra, tipoFato: 'outro' }).success).toBe(false);
  });

  it('publicar exige justificativa', () => {
    expect(esquemaPublicarRegra.safeParse({ regra, justificativa: 'curta' }).success).toBe(false);
    expect(esquemaPublicarRegra.safeParse({ regra, justificativa: 'Primeira versão da regra' }).success).toBe(
      true,
    );
  });

  it('filtro dos fatos paginado com teto', () => {
    expect(esquemaFiltroFatos.parse({}).tamanho).toBe(50);
    expect(esquemaFiltroFatos.safeParse({ tamanho: 500 }).success).toBe(false);
    expect(esquemaFiltroFatos.safeParse({ competencia: '2027-13' }).success).toBe(false);
  });
});

describe('permissões e liberação da contabilidade (etapa 1)', () => {
  it('as permissões da ficha estão no catálogo, com opção do outro sistema', () => {
    for (const c of [
      'contabil.plano.ler',
      'contabil.plano.editar',
      'contabil.regra.publicar',
      'contabil.fato.ler',
    ]) {
      const p = CATALOGO_DECLARADO.find((x) => x.codigo === c);
      expect(p, c).toBeDefined();
      expect(FORMATO_CODIGO_PERMISSAO.test(c)).toBe(true);
      expect(p!.opcoesLegado.length).toBeGreaterThan(0);
    }
    expect(CATALOGO_DECLARADO.find((x) => x.codigo === 'contabil.regra.publicar')!.criticidade).toBe(
      'critica',
    );
  });

  it('as chaves contabil e contabil.sped existem, com pré-requisito', () => {
    expect(recursoDesligado('contabil')?.prerequisitos.length).toBe(1);
    expect(recursoDesligado('contabil.sped')?.marco).toBe('M54');
  });
});
