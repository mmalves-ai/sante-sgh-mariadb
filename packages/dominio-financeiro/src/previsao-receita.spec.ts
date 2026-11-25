// F8, 07-FIN linha 68: a previsão de receita se realiza pelo título a receber, a de despesa pelo título a pagar.
import { describe, expect, it } from 'vitest';
import { conferirLadoRealizacao, conferirTituloReceberConciliacao } from './previsao-provisao.js';

describe('lado do título que realiza a ocorrência', () => {
  it('despesa pelo título a pagar e receita pelo título a receber passam', () => {
    expect(conferirLadoRealizacao({ tipo: 'despesa', tituloPagar: true, tituloReceber: false })).toBeNull();
    expect(conferirLadoRealizacao({ tipo: 'receita', tituloPagar: false, tituloReceber: true })).toBeNull();
  });

  it('título do outro lado é recusado, apontando o campo certo', () => {
    expect(
      conferirLadoRealizacao({ tipo: 'receita', tituloPagar: true, tituloReceber: false }),
    ).toMatchObject({
      codigo: 'titulo-de-outro-lado',
      campos: ['tituloReceber'],
    });
    expect(
      conferirLadoRealizacao({ tipo: 'despesa', tituloPagar: false, tituloReceber: true }),
    ).toMatchObject({
      codigo: 'titulo-de-outro-lado',
      campos: ['tituloPagar'],
    });
  });

  it('nenhum título ou os dois juntos são recusados', () => {
    expect(
      conferirLadoRealizacao({ tipo: 'receita', tituloPagar: false, tituloReceber: false }),
    ).toMatchObject({
      codigo: 'titulo-obrigatorio',
      campos: ['tituloReceber'],
    });
    expect(conferirLadoRealizacao({ tipo: 'despesa', tituloPagar: true, tituloReceber: true })).toMatchObject(
      {
        codigo: 'titulo-obrigatorio',
        campos: ['tituloPagar'],
      },
    );
  });
});

describe('título a receber que realiza a previsão de receita', () => {
  it('passa sem fonte na previsão e com a mesma fonte', () => {
    expect(
      conferirTituloReceberConciliacao({ jaConciliado: false, fonteEsperada: null, fonteTitulo: 7 }),
    ).toBeNull();
    expect(
      conferirTituloReceberConciliacao({ jaConciliado: false, fonteEsperada: 7, fonteTitulo: 7 }),
    ).toBeNull();
  });

  it('recusa o título já conciliado e o de outra fonte pagadora (ou sem fonte)', () => {
    expect(
      conferirTituloReceberConciliacao({ jaConciliado: true, fonteEsperada: null, fonteTitulo: null }),
    ).toMatchObject({ codigo: 'titulo-ja-conciliado' });
    expect(
      conferirTituloReceberConciliacao({ jaConciliado: false, fonteEsperada: 7, fonteTitulo: 8 }),
    ).toMatchObject({ codigo: 'devedor-diferente' });
    expect(
      conferirTituloReceberConciliacao({ jaConciliado: false, fonteEsperada: 7, fonteTitulo: null }),
    ).toMatchObject({ codigo: 'devedor-diferente' });
  });
});
