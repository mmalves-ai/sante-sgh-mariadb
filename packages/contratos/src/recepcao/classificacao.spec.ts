// M44 (etapa 1): as entradas da classificação de risco (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import {
  CORES_RISCO,
  esquemaClassificarRisco,
  esquemaConteudoProtocolo,
  esquemaReclassificarRisco,
  esquemaSinaisClassificacao,
} from './classificacao.js';
import { PERMISSOES_CLASSIFICACAO_M44 } from '../permissoes/classificacao.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { CATALOGO_EVENTOS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';

const base = {
  atendimento: 900101,
  versaoProtocolo: 1,
  fluxograma: 'dor-toracica',
  discriminadores: ['dor-precordial'],
  sinais: { pas: 130, pad: 85, fc: 96, dor: 7 },
  queixa: 'Dor no peito há uma hora',
  corFinal: 'laranja',
};

describe('cores e tempos-alvo (regra 4)', () => {
  it('cinco cores em ordem de prioridade, com nome escrito e os tempos padrão 0, 10, 60, 120, 240', () => {
    expect(CORES_RISCO.map((c) => [c.codigo, c.prioridade, c.tempoAlvoPadraoMin])).toEqual([
      ['vermelho', 1, 0],
      ['laranja', 2, 10],
      ['amarelo', 3, 60],
      ['verde', 4, 120],
      ['azul', 5, 240],
    ]);
    for (const c of CORES_RISCO) expect(c.nome.length).toBeGreaterThan(3);
  });
});

describe('entradas', () => {
  it('sinais fora da faixa plausível são recusados; ausentes viram null', () => {
    expect(esquemaSinaisClassificacao.parse({ fc: 80 })).toMatchObject({ fc: 80, pas: null, dor: null });
    expect(esquemaSinaisClassificacao.safeParse({ dor: 11 }).success).toBe(false);
    expect(esquemaSinaisClassificacao.safeParse({ fc: 80.5 }).success).toBe(false);
    expect(esquemaSinaisClassificacao.parse({ temperatura: 37.8 }).temperatura).toBe(37.8);
    expect(esquemaSinaisClassificacao.safeParse({ peso: 70 }).success).toBe(false);
  });

  it('classificar: a justificativa é opcional na entrada (a regra 3 a exige quando a cor final difere)', () => {
    const v = esquemaClassificarRisco.parse(base);
    expect(v.justificativaSobreposicao).toBeNull();
    expect(esquemaClassificarRisco.safeParse({ ...base, corFinal: 'roxo' }).success).toBe(false);
    expect(esquemaClassificarRisco.safeParse({ ...base, justificativaSobreposicao: 'curta' }).success).toBe(
      false,
    );
  });

  it('reclassificar: motivo estouro ou mudança do quadro; a mudança exige a descrição', () => {
    expect(esquemaReclassificarRisco.safeParse({ ...base, anterior: 5, motivo: 'estouro' }).success).toBe(
      true,
    );
    expect(
      esquemaReclassificarRisco.safeParse({ ...base, anterior: 5, motivo: 'mudanca_quadro' }).success,
    ).toBe(false);
    expect(
      esquemaReclassificarRisco.safeParse({
        ...base,
        anterior: 5,
        motivo: 'mudanca_quadro',
        descricaoMudanca: 'Saturação caiu para 88% em ar ambiente',
      }).success,
    ).toBe(true);
    expect(esquemaReclassificarRisco.safeParse({ ...base, anterior: 5, motivo: 'inicial' }).success).toBe(
      false,
    );
  });

  it('conteúdo do protocolo: exatamente cinco cores; discriminador com regra objeto ou nula', () => {
    const cores = CORES_RISCO.map((c) => ({
      cor: c.codigo,
      nome: c.nome,
      tempoAlvoMin: c.tempoAlvoPadraoMin,
      opcaoE08: c.prioridade,
    }));
    const conteudo = {
      tipo: 'accr',
      nome: 'ACCR sintético',
      cores,
      fluxogramas: [{ codigo: 'geral', titulo: 'Geral' }],
      discriminadores: [
        {
          codigo: 'sat-baixa',
          fluxograma: 'geral',
          titulo: 'Saturação baixa',
          cor: 'laranja',
          regra: { '<': [{ var: 'saturacao' }, 90] },
        },
      ],
    };
    expect(esquemaConteudoProtocolo.safeParse(conteudo).success).toBe(true);
    expect(esquemaConteudoProtocolo.safeParse({ ...conteudo, cores: cores.slice(1) }).success).toBe(false);
    expect(
      esquemaConteudoProtocolo.safeParse({
        ...conteudo,
        discriminadores: [{ ...conteudo.discriminadores[0], regra: [1, 2] }],
      }).success,
    ).toBe(false);
  });
});

describe('catálogos', () => {
  it('as permissões do M44 estão no catálogo, no formato, e as que classificam exigem conselho', () => {
    for (const p of PERMISSOES_CLASSIFICACAO_M44) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(CATALOGO_DECLARADO.filter((x) => x.codigo === p.codigo)).toHaveLength(1);
      expect(p.opcoesLegado.length > 0 || p.concessaoPorPerfil !== null).toBe(true);
    }
    const por = new Map(PERMISSOES_CLASSIFICACAO_M44.map((p) => [p.codigo, p]));
    expect(por.get('recepcao.classificacao.criar')?.exigeConselho).toBe(true);
    expect(por.get('recepcao.classificacao.reclassificar')?.exigeConselho).toBe(true);
    expect(por.get('recepcao.classificacao.registrarSinais')?.exigeConselho).toBeUndefined();
  });

  it('os eventos de auditoria da regra 15 (etapa 1) e a chave de liberação existem', () => {
    const codigos = new Set(CATALOGO_EVENTOS.map((e) => e.codigo));
    for (const c of [
      'recepcao.classificacao.concluida',
      'recepcao.classificacao.corSobreposta',
      'recepcao.classificacao.reclassificada',
      'recepcao.protocolo.publicado',
    ])
      expect(codigos.has(c)).toBe(true);
    expect(recursoDesligado('pa.classificacao')?.marco).toBe('M44');
  });
});
