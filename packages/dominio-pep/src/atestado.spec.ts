import { describe, expect, it } from 'vitest';
import { conferirAtestado, textoDoAtestado, tipoDoModelo, xmlDoAtestado } from './atestado.js';
import { filho, filhosElemento, lerXml, textoXml } from './prontuario/xml-seguro.js';

describe('atestado (regra 5)', () => {
  it('CID só com autorização; dias no atestado; CID só no atestado', () => {
    expect(
      conferirAtestado({ tipo: 'atestado', texto: 'Atesto para os devidos fins.', diasAfastamento: 2 }),
    ).toEqual([]);
    expect(
      conferirAtestado({ tipo: 'atestado', texto: 'Atesto.', diasAfastamento: 2, cid: 'J11' }).map(
        (p) => p.codigo,
      ),
    ).toEqual(['cid-sem-autorizacao']);
    expect(conferirAtestado({ tipo: 'atestado', texto: 'Atesto.' }).map((p) => p.codigo)).toEqual([
      'sem-dias',
    ]);
    expect(
      conferirAtestado({ tipo: 'declaracao', texto: 'Declaro.', cid: 'J11', autorizacaoCid: 'paciente' }).map(
        (p) => p.codigo,
      ),
    ).toEqual(['cid-fora-do-atestado']);
    expect(conferirAtestado({ tipo: 'requerimento', texto: 'Requeiro ≥' }).map((p) => p.codigo)).toEqual([
      'texto-cp1252',
    ]);
  });

  it('texto final com dias e CID autorizado', () => {
    const t = textoDoAtestado({
      tipo: 'atestado',
      texto: 'Atesto que o paciente esteve em atendimento.',
      diasAfastamento: 3,
      cid: 'J11',
      autorizacaoCid: 'paciente',
    });
    expect(t).toContain('Afastamento: 3 dias.');
    expect(t).toContain('CID-10: J11 (informado com autorização expressa do paciente).');
    expect(textoDoAtestado({ tipo: 'atestado', texto: 'X', diasAfastamento: 1 })).toContain('1 dia.');
    expect(textoDoAtestado({ tipo: 'declaracao', texto: 'Declaro.' })).toBe('Declaro.');
    expect(
      textoDoAtestado({
        tipo: 'atestado',
        texto: 'X',
        diasAfastamento: 1,
        cid: 'A00',
        autorizacaoCid: 'responsavel',
      }),
    ).toContain('do responsável');
  });

  it('XML do conteúdo como o legado grava (campos do modelo, o primeiro com o texto)', () => {
    const xml = xmlDoAtestado(
      { codigo: 1, nome: 'ATESTADO MÉDICO' },
      [
        { nome: 'Rch0', modelo: null },
        { nome: 'Rch2', modelo: '{\\rtf1 rodape}' },
      ],
      'Atesto <teste> & ação.',
    );
    expect(xml.startsWith('<atestado codigo_ficha="1" nome="ATESTADO MÉDICO"><componentes>')).toBe(true);
    const doc = lerXml(xml);
    const comps = filhosElemento(filho(doc, 'componentes')!, 'componente');
    expect(comps).toHaveLength(2);
    expect(textoXml(filho(comps[0]!, 'conteudo'))).toContain('Atesto <teste> &');
    expect(xml).toContain('&lt;teste&gt; &amp;');
    expect(xml).toContain('<nome>Rch2</nome><conteudo>{\\rtf1 rodape}</conteudo>');
    expect(xmlDoAtestado({ codigo: 9, nome: 'X' }, [], 'Y')).toContain('<nome>Rch0</nome>');
    expect(
      xmlDoAtestado(
        { codigo: 9, nome: 'X' },
        [
          { nome: 'A', modelo: null },
          { nome: 'B', modelo: null },
        ],
        'Y',
      ),
    ).toContain('<nome>B</nome><conteudo>{\\rtf1');
  });

  it('tipo pelo nome do modelo', () => {
    expect(tipoDoModelo('ATESTADO MÉDICO')).toBe('atestado');
    expect(tipoDoModelo('Declaração de comparecimento')).toBe('declaracao');
    expect(tipoDoModelo('Solicitação de procedimentos')).toBe('requerimento');
  });
});
