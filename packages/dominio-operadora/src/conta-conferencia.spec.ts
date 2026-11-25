import { describe, expect, it } from 'vitest';
import {
  criticasDasRegras,
  type EntradaRegraCritica,
  normalizarCodigoRegra,
  problemasDaRegraCritica,
  problemasDoParecerAuditoria,
  type RegraCriticaConta,
} from './conta-conferencia.js';

const regra = (x: Partial<RegraCriticaConta>): RegraCriticaConta => ({
  id: 1,
  codigo: 'R1',
  descricao: 'Regra',
  tipo: 'auto_excludente',
  principal: '10101012',
  relacionado: '20101015',
  prestador: null,
  motivoGlosa: 7,
  percentual: null,
  glosaAutomatica: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const entrada = (x: Partial<EntradaRegraCritica>): EntradaRegraCritica => ({
  codigo: 'exc 01',
  descricao: 'Consulta e procedimento',
  tipo: 'auto_excludente',
  principal: 1,
  relacionado: 2,
  prestador: null,
  motivoGlosa: null,
  percentual: null,
  glosaAutomatica: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ...x,
});
const guia = {
  data: '2026-10-05',
  itens: [
    { indice: 0, codigo: '10101012', apresentado: 100 },
    { indice: 1, codigo: '20101015', apresentado: 80 },
  ],
};

describe('regra de crítica cadastrável', () => {
  it('normaliza o código e recusa o repetido', () => {
    expect(normalizarCodigoRegra(' exc 01 ')).toBe('EXC-01');
    expect(problemasDaRegraCritica(entrada({}))).toEqual([]);
    expect(problemasDaRegraCritica(entrada({}), ['EXC-01'])).toEqual([
      { codigo: 'codigo-repetido', campo: 'codigo' },
    ]);
  });

  it('exige o par diferente na exclusão, o prestador na penalidade e o percentual e o motivo da glosa', () => {
    const c = (x: Partial<EntradaRegraCritica>) => problemasDaRegraCritica(entrada(x)).map((p) => p.codigo);
    expect(c({ relacionado: null })).toContain('relacionado-obrigatorio');
    expect(c({ relacionado: 1 })).toContain('relacionado-igual-ao-principal');
    expect(c({ tipo: 'penalidade_prestador', principal: null, relacionado: null })).toEqual([
      'prestador-obrigatorio',
      'motivo-obrigatorio',
    ]);
    expect(c({ tipo: 'glosa_referencia', relacionado: null })).toEqual([
      'motivo-obrigatorio',
      'percentual-obrigatorio',
    ]);
    expect(c({ percentual: 120, motivoGlosa: 1 })).toContain('percentual-invalido');
    expect(c({ vigenciaFim: '2025-12-31' })).toContain('vigencia-invalida');
  });

  it('procedimentos excludentes: critica o relacionado só quando o principal está na guia', () => {
    expect(criticasDasRegras(guia, 5, [regra({})])).toEqual([
      expect.objectContaining({
        indice: 1,
        codigo: 'regra-procedimentos-excludentes',
        tipo: 'critica',
        glosado: 0,
      }),
    ]);
    expect(criticasDasRegras({ ...guia, itens: [guia.itens[1]!] }, 5, [regra({})])).toEqual([]);
    // com glosa automática e sem percentual, glosa o relacionado inteiro
    expect(criticasDasRegras(guia, 5, [regra({ glosaAutomatica: true })])[0]).toMatchObject({
      tipo: 'glosa',
      glosado: 80,
    });
  });

  it('respeita vigência, prestador, ativo e a glosa que o item já tem; uma glosa de regra por item', () => {
    expect(criticasDasRegras(guia, 5, [regra({ vigenciaFim: '2026-09-30' })])).toEqual([]);
    expect(criticasDasRegras(guia, 5, [regra({ prestador: 6 })])).toEqual([]);
    expect(criticasDasRegras(guia, 5, [regra({ ativo: false })])).toEqual([]);
    const ref = regra({
      tipo: 'glosa_referencia',
      relacionado: null,
      percentual: 30,
      glosaAutomatica: true,
    });
    expect(criticasDasRegras(guia, 5, [ref])[0]).toMatchObject({ indice: 0, glosado: 30 });
    expect(criticasDasRegras(guia, 5, [ref], new Map([[0, 90]]))[0]).toMatchObject({ glosado: 10 });
    const duas = criticasDasRegras(guia, 5, [ref, { ...ref, id: 2, codigo: 'R2' }]);
    expect(duas.map((x) => [x.regra, x.tipo, x.glosado])).toEqual([
      [1, 'glosa', 30],
      [2, 'critica', 0],
    ]);
  });

  it('penalidade do prestador sem procedimento alcança todos os itens dele', () => {
    const pen = regra({
      tipo: 'penalidade_prestador',
      principal: null,
      relacionado: null,
      prestador: 5,
      percentual: 10,
      glosaAutomatica: true,
    });
    expect(criticasDasRegras(guia, 5, [pen]).map((x) => x.glosado)).toEqual([10, 8]);
    expect(criticasDasRegras(guia, 9, [pen])).toEqual([]);
  });
});

describe('parecer da auditoria da conta', () => {
  const base = {
    tipo: 'medica' as const,
    resultado: 'liberado' as const,
    parecer: 'Procedimento compatível com o laudo.',
    motivoGlosa: null,
    situacaoConta: 'recebida',
    categoriaAuditor: 'medico' as const,
  };
  it('aceita o parecer médico de médico na conta em análise', () => {
    expect(problemasDoParecerAuditoria(base)).toEqual([]);
  });
  it('recusa fora da análise, sem texto, glosa sem motivo e auditor de outra categoria', () => {
    const c = (x: object) => problemasDoParecerAuditoria({ ...base, ...x }).map((p) => p.codigo);
    expect(c({ situacaoConta: 'analisada' })).toEqual(['conta-fora-da-analise']);
    expect(c({ parecer: 'ok' })).toEqual(['parecer-obrigatorio']);
    expect(c({ resultado: 'glosa_parcial' })).toEqual(['motivo-obrigatorio']);
    expect(c({ categoriaAuditor: 'enfermeiro' })).toEqual(['auditor-sem-categoria']);
    expect(c({ tipo: 'enfermagem', categoriaAuditor: null })).toEqual(['auditor-sem-categoria']);
    expect(c({ tipo: 'administrativa', categoriaAuditor: null })).toEqual([]);
  });
});
