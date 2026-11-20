import { describe, expect, it } from 'vitest';
import { definicaoParametro } from '../parametros/definicoes.js';
import {
  CATALOGO_FACHADA,
  CHAVES_PARAMETRO_FACHADA,
  CONTRATO_SANTE_API,
  esquemaConfigurarFachada,
  idOperacaoFachada,
  OPERACOES_SERVIDAS_FACHADA,
  OPERACOES_SGH_DA_FACHADA,
  SUPERFICIES_FACHADA,
} from './fachada.js';

describe('contrato da fachada (M58-F4)', () => {
  it('traz as 78 operações das cinco superfícies da versão 0.23.0', () => {
    expect(CONTRATO_SANTE_API.versao).toBe('0.23.0');
    expect(CATALOGO_FACHADA).toHaveLength(78);
    const por = Object.fromEntries(
      SUPERFICIES_FACHADA.map((s) => [s, CATALOGO_FACHADA.filter((o) => o.superficie === s).length]),
    );
    expect(por).toEqual({ atendimento: 23, gestao: 30, acoes: 17, auditoria: 6, saude: 2 });
    expect(new Set(CATALOGO_FACHADA.map((o) => o.id)).size).toBe(78);
  });

  it('as servidas e as equivalências existem no contrato', () => {
    const ids = new Set(CATALOGO_FACHADA.map((o) => o.id));
    for (const id of OPERACOES_SERVIDAS_FACHADA) expect(ids.has(id), id).toBe(true);
    for (const id of Object.keys(OPERACOES_SGH_DA_FACHADA)) expect(ids.has(id), id).toBe(true);
  });

  it('só /health é público; gestão e auditoria pedem o token próprio; toda escrita tem equivalência', () => {
    expect(CATALOGO_FACHADA.filter((o) => o.publica).map((o) => o.id)).toEqual(['GET /health']);
    expect(CATALOGO_FACHADA.find((o) => o.caminho === '/gestao/receita')?.escopo).toBe('gestao');
    expect(CATALOGO_FACHADA.find((o) => o.caminho === '/auditoria/panorama')?.escopo).toBe('auditoria');
    expect(CATALOGO_FACHADA.find((o) => o.caminho === '/health/db')?.escopo).toBe('principal');
    const semEquivalencia = CATALOGO_FACHADA.filter((o) => o.escreve && o.operacoesSgh.length === 0).map(
      (o) => o.id,
    );
    // A confirmação aplica a proposta de outra rota (a equivalência é a da rota que propôs).
    expect(semEquivalencia).toEqual(['POST /acoes/confirmar']);
  });

  it('identificador estável e parâmetros registrados', () => {
    expect(idOperacaoFachada('get', '/convenios/{codigo}')).toBe('GET /convenios/{codigo}');
    for (const chave of CHAVES_PARAMETRO_FACHADA) {
      const d = definicaoParametro(chave);
      expect(d, chave).toBeDefined();
      expect(d?.critico).toBe(true);
      expect(d?.niveis).toEqual(['estabelecimento']);
    }
    expect(definicaoParametro('integracao.fachada.ligada')?.padrao).toBe('nao');
    expect(definicaoParametro('integracao.fachada.escrita')?.padrao).toBe('nao');
  });

  it('configurar: chave fechada e justificativa', () => {
    expect(
      esquemaConfigurarFachada.safeParse({
        chave: 'integracao.fachada.ligada',
        valor: 'sim',
        justificativa: 'aceite da equipe da Hal-AI',
      }).success,
    ).toBe(true);
    expect(
      esquemaConfigurarFachada.safeParse({
        chave: 'legado.charset',
        valor: 'UTF8',
        justificativa: 'xxxxxxxxxx',
      }).success,
    ).toBe(false);
    expect(
      esquemaConfigurarFachada.safeParse({
        chave: 'integracao.fachada.ligada',
        valor: 'sim',
        justificativa: 'curta',
      }).success,
    ).toBe(false);
  });
});
