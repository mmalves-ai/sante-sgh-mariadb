// Contratos da fatia F6 (M52.6): entradas de treinamentos, POP, autosserviço e plantão realizado; a origem `plantao` do
// lançamento do repasse; permissões (ciência e autosserviço para toda pessoa, a aprovação só por perfil); as quatro
// chaves desligadas por padrão; eventos e parâmetros.
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { definicaoParametro } from '../parametros/definicoes.js';
import { PERMISSOES_PESSOAS_M52_F6 } from '../permissoes/pessoas-f6.js';
import { esquemaLancarEventoRepasse } from '../repasse/entradas.js';
import {
  esquemaAlterarCurso,
  esquemaCurso,
  esquemaDecidirRealizado,
  esquemaFiltroRealizado,
  esquemaFiltroSituacaoTreinamento,
  esquemaInscricao,
  esquemaParticipacao,
  esquemaRegistrarRealizado,
  esquemaTarifaPlantao,
  esquemaTurma,
  esquemaVersaoPop,
} from './treinamento-entradas.js';
import {
  CHAVE_PESSOAS_AUTOATENDIMENTO,
  CHAVE_PESSOAS_PLANTAO_REALIZADO,
  CHAVE_PESSOAS_REPASSE_PLANTAO,
  CHAVE_PESSOAS_TREINAMENTO,
  PARAMETRO_ALERTA_TREINAMENTO,
  PARAMETRO_EVENTO_REPASSE_PLANTAO,
} from './treinamento-vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const curso = {
  codigo: 'NR32-BIO',
  titulo: 'Riscos biológicos (NR-32)',
  conteudo: 'Precauções padrão, descarte de perfurocortantes e conduta no acidente.',
  categoria: 'nr32',
  cargaMinimaMin: 240,
  validadeMeses: 12,
  obrigatorio: true,
};

describe('contratos de treinamentos e POP (M52.6)', () => {
  it('curso: código em maiúsculas, conteúdo, carga e validade; alteração com versão e ativo', () => {
    expect(esquemaCurso.parse(curso).alvos).toEqual([]);
    expect(esquemaCurso.safeParse({ ...curso, codigo: 'nr32 bio' }).success).toBe(false);
    expect(esquemaCurso.safeParse({ ...curso, conteudo: 'curto' }).success).toBe(false);
    expect(esquemaCurso.safeParse({ ...curso, validadeMeses: 121 }).success).toBe(false);
    expect(
      esquemaCurso.safeParse({ ...curso, alvos: [{ tipo: 'funcao', valor: 'Técnico de enfermagem' }] })
        .success,
    ).toBe(true);
    expect(esquemaAlterarCurso.safeParse({ ...curso, curso: 1, ativo: false, versao: 0 }).success).toBe(true);
    expect(esquemaAlterarCurso.safeParse({ ...curso, curso: 1 }).success).toBe(false);
  });

  it('turma: período coerente; inscrição sem repetição; participação com presença e conclusão', () => {
    const t = {
      curso: 1,
      inicio: '2026-11-03',
      fim: '2026-11-03',
      cargaMin: 240,
      instrutor: 'Instrutora',
      modalidade: 'presencial',
    };
    expect(esquemaTurma.safeParse(t).success).toBe(true);
    expect(esquemaTurma.safeParse({ ...t, fim: '2026-11-02' }).success).toBe(false);
    expect(esquemaInscricao.safeParse({ treinamento: 1, vinculos: [1, 2] }).success).toBe(true);
    expect(esquemaInscricao.safeParse({ treinamento: 1, vinculos: [1, 1] }).success).toBe(false);
    expect(esquemaInscricao.safeParse({ treinamento: 1, vinculos: [] }).success).toBe(false);
    expect(
      esquemaParticipacao.parse({ treinamento: 1, vinculo: 2, presenca: 'presente', versao: 0 }),
    ).toMatchObject({ aproveitamento: null, conclusao: null });
    expect(
      esquemaParticipacao.safeParse({ treinamento: 1, vinculo: 2, presenca: 'talvez', versao: 0 }).success,
    ).toBe(false);
    expect(esquemaFiltroSituacaoTreinamento.parse({ unidade: '12' })).toMatchObject({
      unidade: 12,
      situacao: 'comPendencia',
    });
  });

  it('versão de POP: resumo obrigatório; unidade opcional (o estabelecimento inteiro)', () => {
    const v = {
      codigo: 'POP-ENF-001',
      titulo: 'Higiene das mãos',
      vigencia: '2026-11-01',
      resumo: 'Os 5 momentos e a técnica.',
    };
    expect(esquemaVersaoPop.parse(v)).toMatchObject({ unidade: null, referencia: null, alteracoes: null });
    expect(esquemaVersaoPop.safeParse({ ...v, resumo: 'curto' }).success).toBe(false);
  });
});

describe('contratos do plantão realizado e do repasse (M52.6)', () => {
  it('realizado: instantes locais; a recusa pede motivo; filtro pela competência', () => {
    expect(
      esquemaRegistrarRealizado.parse({ plantao: 1, inicio: '2026-10-24T19:00', fim: '2026-10-25T07:00' })
        .origem,
    ).toBe('informado');
    expect(
      esquemaRegistrarRealizado.safeParse({ plantao: 1, inicio: '2026-10-24 19:00', fim: '2026-10-25T07:00' })
        .success,
    ).toBe(false);
    expect(esquemaDecidirRealizado.safeParse({ realizado: 1, decisao: 'aprovar', versao: 0 }).success).toBe(
      true,
    );
    expect(esquemaDecidirRealizado.safeParse({ realizado: 1, decisao: 'recusar', versao: 0 }).success).toBe(
      false,
    );
    expect(esquemaFiltroRealizado.parse({ competencia: '2026-10' }).situacao).toBe('todos');
    expect(
      esquemaTarifaPlantao.safeParse({ tipo: 'presencial', inicio: '2026-01-01', valorHora: 100 }).success,
    ).toBe(true);
    expect(
      esquemaTarifaPlantao.safeParse({
        tipo: 'presencial',
        inicio: '2026-01-01',
        fim: '2025-01-01',
        valorHora: 100,
      }).success,
    ).toBe(false);
  });

  it('lançamento do repasse: a origem plantão leva os realizados, e só ela', () => {
    const base = {
      empresa: 1,
      competencia: '2026-10',
      data: '2026-10-26',
      evento: 5,
      tipo: 'M',
      prestador: 4321,
      profissional: 77,
      valor: 1200,
      justificativa: 'Plantões realizados de outubro',
    };
    expect(
      esquemaLancarEventoRepasse.safeParse({ ...base, origem: 'plantao', plantoes: [1, 2] }).success,
    ).toBe(true);
    expect(esquemaLancarEventoRepasse.safeParse({ ...base, origem: 'plantao' }).success).toBe(false);
    expect(esquemaLancarEventoRepasse.safeParse({ ...base, origem: 'ajuste', plantoes: [1] }).success).toBe(
      false,
    );
    expect(esquemaLancarEventoRepasse.parse({ ...base, origem: 'ajuste' }).plantoes).toEqual([]);
  });

  it('permissões: ciência e autosserviço de toda pessoa; aprovação só do perfil; lançamento pelo repasse', () => {
    const por = new Map(PERMISSOES_PESSOAS_M52_F6.map((p) => [p.codigo, p]));
    expect([...por.keys()]).toEqual([
      'pessoas.treinamento.ler',
      'pessoas.treinamento.registrar',
      'pessoas.pop.ciencia',
      'pessoas.autoatendimento.ler',
      'pessoas.realizado.ler',
      'pessoas.realizado.registrar',
      'pessoas.realizado.aprovar',
      'pessoas.realizado.lancar',
    ]);
    for (const c of ['pessoas.pop.ciencia', 'pessoas.autoatendimento.ler', 'pessoas.realizado.aprovar'])
      expect(opcoesDoMapa(c)).toEqual([]);
    for (const c of ['pessoas.pop.ciencia', 'pessoas.autoatendimento.ler'])
      expect(por.get(c)).toMatchObject({ concessaoPorPerfil: 'todos-os-perfis-de-pessoa' });
    expect(por.get('pessoas.realizado.aprovar')).toMatchObject({
      concessaoPorPerfil: 'por-perfil',
      perfis: ['gestor-escala'],
    });
    expect(opcoesDoMapa(por.get('pessoas.realizado.lancar')?.codigo)).toEqual([3033]);
    expect(PERMISSOES_PESSOAS_M52_F6.every((p) => p.categoria === 'administrativa')).toBe(true);
  });

  it('as quatro chaves desligadas por padrão (POL-3); eventos; parâmetros', () => {
    for (const c of [
      CHAVE_PESSOAS_TREINAMENTO,
      CHAVE_PESSOAS_AUTOATENDIMENTO,
      CHAVE_PESSOAS_PLANTAO_REALIZADO,
      CHAVE_PESSOAS_REPASSE_PLANTAO,
    ])
      expect(RECURSOS_DESLIGADOS.some((r) => r.chave === c)).toBe(true);
    expect(RECURSOS_DESLIGADOS.find((r) => r.chave === CHAVE_PESSOAS_REPASSE_PLANTAO)?.decisao).toMatch(
      /DP-33/,
    );
    expect(EVENTOS_AUDITAVEIS.pessoasPopCiencia.codigo).toBe('pessoas.pop.ciencia');
    expect(EVENTOS_AUDITAVEIS.pessoasRealizadoDecidido.codigo).toBe('pessoas.realizado.decidido');
    expect(definicaoParametro(PARAMETRO_ALERTA_TREINAMENTO)?.padrao).toBe('30');
    expect(definicaoParametro(PARAMETRO_EVENTO_REPASSE_PLANTAO)).toMatchObject({
      padrao: '0',
      critico: true,
    });
  });
});
