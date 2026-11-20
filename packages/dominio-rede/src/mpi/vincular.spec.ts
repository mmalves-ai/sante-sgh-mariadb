// Vincular (M57, regras 2 e 4): um plano por banco, em ordem, idempotente; a pessoa que um lado já tem é reaproveitada;
// pessoas diferentes são conflito; "outra pessoa" só muda o candidato. Nunca escreve fora do índice (regra 1).
import { describe, expect, it } from 'vitest';
import { ErroIndiceRede, garantirSomenteIndice, type PlanoIndice, tabelasDoPlano } from './indice.js';
import { PESSOA_1, PESSOA_2 } from './indice.spec-util.js';
import { type PedidoVincular, planejarOutraPessoa, planejarVinculo } from './vincular.js';

function pedido(extra: Partial<PedidoVincular> = {}): PedidoVincular {
  return {
    a: { estabelecimento: 'pc', id: 101, prontuario: 5001, pessoaAtual: null },
    b: { estabelecimento: 'hs', id: 909, prontuario: 77001, pessoaAtual: null },
    origem: 'humano',
    por: 'GESTOR.TESTE',
    em: '2026-10-24T10:00:00.000Z',
    justificativa: null,
    novaPessoa: () => PESSOA_1,
    ...extra,
  };
}

describe('vincular', () => {
  it('pessoa nova: plano com um banco por estabelecimento, em ordem, cada um com a linha do próprio cadastro', () => {
    const r = planejarVinculo(pedido());
    expect(r.resultado).toBe('plano');
    if (r.resultado !== 'plano') return;
    expect(r.plano.chave).toBe('hs:909|pc:101');
    expect(r.plano.pessoa).toBe(PESSOA_1);
    expect(r.plano.bancos.map((b) => b.estabelecimento)).toEqual(['hs', 'pc']);
    const hs = r.plano.bancos[0]!.escritas.find((e) => e.tabela === 'SGH_REDE_VINCULO');
    expect(hs && hs.tabela === 'SGH_REDE_VINCULO' && hs.linha.idLocal).toBe(909);
    const pc = r.plano.bancos[1]!.escritas.find((e) => e.tabela === 'SGH_REDE_VINCULO');
    expect(pc && pc.tabela === 'SGH_REDE_VINCULO' && pc.linha.idRemoto).toBe(909);
    expect(tabelasDoPlano(r.plano)).toEqual(['SGH_REDE_CANDIDATO', 'SGH_REDE_PESSOA', 'SGH_REDE_VINCULO']);
    expect(() => garantirSomenteIndice(r.plano)).not.toThrow();
  });

  it('reaproveita a pessoa que um lado já tem (sem gerar nova)', () => {
    const r = planejarVinculo(
      pedido({
        b: { estabelecimento: 'hs', id: 909, prontuario: 77001, pessoaAtual: PESSOA_2 },
        novaPessoa: () => {
          throw new Error('não devia gerar');
        },
      }),
    );
    expect(r.resultado === 'plano' && r.plano.pessoa).toBe(PESSOA_2);
  });

  it('os dois já na mesma pessoa: nada a gravar; pessoas diferentes: conflito', () => {
    const mesma = planejarVinculo(
      pedido({
        a: { estabelecimento: 'pc', id: 101, prontuario: 5001, pessoaAtual: PESSOA_1 },
        b: { estabelecimento: 'hs', id: 909, prontuario: 77001, pessoaAtual: PESSOA_1 },
      }),
    );
    expect(mesma).toEqual({ resultado: 'ja_vinculado', chave: 'hs:909|pc:101', pessoa: PESSOA_1 });
    const conflito = planejarVinculo(
      pedido({
        a: { estabelecimento: 'pc', id: 101, prontuario: 5001, pessoaAtual: PESSOA_1 },
        b: { estabelecimento: 'hs', id: 909, prontuario: 77001, pessoaAtual: PESSOA_2 },
      }),
    );
    expect(conflito).toEqual({ resultado: 'conflito', chave: 'hs:909|pc:101', motivo: 'pessoas_diferentes' });
  });

  it('idempotente: o mesmo pedido dá o mesmo plano', () => {
    expect(planejarVinculo(pedido())).toEqual(planejarVinculo(pedido()));
  });

  it('identificador de pessoa fora do formato é recusado', () => {
    expect(() => planejarVinculo(pedido({ novaPessoa: () => 'x' }))).toThrow();
  });

  it('"outra pessoa": só o candidato, nos dois bancos', () => {
    const p = planejarOutraPessoa(
      'hs:909|pc:101',
      'GESTOR.TESTE',
      '2026-10-24T10:00:00.000Z',
      'mães diferentes',
    );
    expect(p.bancos.map((b) => b.estabelecimento)).toEqual(['hs', 'pc']);
    expect(tabelasDoPlano(p)).toEqual(['SGH_REDE_CANDIDATO']);
  });
});

describe('somente o índice (regra 1)', () => {
  it('um plano que escreva em cadastro de paciente é recusado inteiro', () => {
    const ruim = {
      operacao: 'vincular',
      chave: 'hs:909|pc:101',
      pessoa: PESSOA_1,
      bancos: [{ estabelecimento: 'pc', escritas: [{ tabela: 'RICADPAC', acao: 'gravar' }] }],
    } as unknown as PlanoIndice;
    expect(() => garantirSomenteIndice(ruim)).toThrow(ErroIndiceRede);
  });
});
