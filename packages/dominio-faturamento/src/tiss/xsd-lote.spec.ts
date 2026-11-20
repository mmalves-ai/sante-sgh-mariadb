// Regra 1 do M31 (critério de saída da Fase 3): lote sintético de cada tipo de guia (consulta, SP/SADT com outras
// despesas, resumo de internação, honorário individual) e o recurso de glosa validam no XSD oficial 04.03.00 com 0 erro;
// campo obrigatório ausente é recusado e explicado. Massa sintética (fixtures.spec-util.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cabecalho,
  consulta,
  honorario,
  recurso,
  resumoInternacao,
  spSadt,
  spSadtComDespesas,
} from './fixtures.spec-util.js';
import { mensagemLoteGuias, mensagemRecursoGlosa, VERSAO_TISS } from './lote.js';
import { explicarErroXsd } from './montagem.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote, validarNoXsd } from './validacao.js';
import { latin1 } from './xml.js';
import { VERSAO_TISS_VIGENTE } from '@sgh/contratos/regras-faturamento';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

describe('xsd-lote: todo tipo de guia e o recurso em 04.03.00', () => {
  it('a versão gerada é a vigente (DP-47.7)', () => {
    expect(VERSAO_TISS).toBe(VERSAO_TISS_VIGENTE);
  });
  it.each([
    ['consulta', () => mensagemLoteGuias(cabecalho, '2001', [consulta])],
    ['SP/SADT', () => mensagemLoteGuias(cabecalho, '2002', [spSadt])],
    ['SP/SADT com outras despesas', () => mensagemLoteGuias(cabecalho, '2003', [spSadtComDespesas])],
    ['resumo de internação', () => mensagemLoteGuias(cabecalho, '2004', [resumoInternacao])],
    [
      'resumo de internação com outras despesas',
      () =>
        mensagemLoteGuias(cabecalho, '2005', [
          { ...resumoInternacao, despesas: spSadtComDespesas.despesas ?? [] },
        ]),
    ],
    ['honorário individual', () => mensagemLoteGuias(cabecalho, '2006', [honorario])],
    [
      'reapresentação (lote novo de guia antiga)',
      () => mensagemLoteGuias(cabecalho, '2007', [spSadt, spSadtComDespesas]),
    ],
    ['recurso de glosa', () => mensagemRecursoGlosa(cabecalho, recurso)],
  ])('%s: 0 erro no XSD e "pronto"', async (_, gerar) => {
    const m = gerar();
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect((await conferirLote(m, esquemas)).estado).toBe('pronto');
  });

  it('campo obrigatório ausente é recusado e explicado em português', async () => {
    const m = mensagemLoteGuias(cabecalho, '2008', [spSadt]);
    const xml = m.xml.replace(/<ans:CNES>[^<]*<\/ans:CNES>/, '');
    const v = await validarNoXsd(latin1(xml), esquemas);
    expect(v.valido).toBe(false);
    expect(v.erros.length).toBeGreaterThan(0);
    const explicado = v.erros.map(explicarErroXsd).join(' ');
    expect(explicado).toMatch(/Falta o campo|fora do formato|inválido|recusou/);
  });

  it('lote com guias de tipos diferentes é recusado antes do XSD', () => {
    expect(() => mensagemLoteGuias(cabecalho, '2009', [spSadt, consulta])).toThrow(/um só tipo/);
  });
});

describe('explicarErroXsd', () => {
  it.each([
    [
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}valorTotal': This element is not expected. Expected is ( {http://www.ans.gov.br/padroes/tiss/schemas}CNES ).",
      /Falta o campo "CNES" antes de "valorTotal"/,
    ],
    [
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}dadosExecutante': Missing child element(s). Expected is ( {http://www.ans.gov.br/padroes/tiss/schemas}CNES ).",
      /Falta o campo "CNES" dentro de "dadosExecutante"/,
    ],
    [
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}CNES': [facet 'maxLength'] The value has a length of '9'.",
      /fora do formato/,
    ],
    [
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}codigoTabela': [facet 'enumeration'] The value '77' is not an element of the set.",
      /não existe na tabela/,
    ],
    [
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}quantidadeExecutada': 'x' is not a valid value of the atomic type.",
      /valor inválido/,
    ],
    ['hash do epílogo não confere', /hash do epílogo/],
    ['Padrao 4.01.00 recusado: só 4.03.00 (DP-47.7)', /Padrao/],
    ['outra coisa qualquer', /O validador recusou/],
  ])('%s', (erro, esperado) => {
    expect(explicarErroXsd(erro)).toMatch(esperado);
  });
});
