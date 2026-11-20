import { describe, expect, it } from 'vitest';
import { BancoDuble, CONFIG_TESTE } from './duble-banco.spec-util.js';
import { ErroOperacao } from './erros.js';
import { garantirSequencia, proximoNumero } from './sequencia.js';
import { escreverTransacao } from './transacao.js';

const CTX = { cliente: 'teste_duble', estabelecimento: 4, usuario: 3, correlacao: 'c-1' };
const carimbo = { usuario: 3, agora: new Date('2026-11-20T12:00:00Z') };
const linha = (x: Record<string, unknown> = {}) => [
  { id: 9, prefixo: 'AT-', proximo_valor: 41, incremento: 1, valor_maximo: null, ativo: 1, ...x },
];

async function codigo(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo;
    throw e;
  }
}

describe('sequencia_negocio', () => {
  it('trava a linha, devolve o valor formatado e grava o próximo na mesma transação', async () => {
    const banco = new BancoDuble().quando(/FROM sequencia_negocio/, linha());
    const n = await escreverTransacao(banco.fonte(), CONFIG_TESTE, CTX, (e) =>
      proximoNumero(e, 'atendimento', 4, carimbo),
    );
    expect(n).toEqual({ valor: 41, formatado: 'AT-41' });
    expect(banco.comandos[0]?.sql).toMatch(/WHERE tipo = \? AND estabelecimento_id <=> \? FOR UPDATE$/);
    expect(banco.comandos[0]?.parametros).toEqual(['atendimento', 4]);
    expect(banco.comandos[1]?.sql).toMatch(
      /^UPDATE sequencia_negocio SET proximo_valor = proximo_valor \+ incremento/,
    );
    expect(banco.comandos[1]?.parametros).toEqual([carimbo.agora, 3, 9]);
    expect(banco.estados).toEqual(['iniciar', 'confirmar', 'devolver']);
  });

  it('sem prefixo, inexistente, inativa e esgotada', async () => {
    const e = (b: BancoDuble) =>
      escreverTransacao(b.fonte(), CONFIG_TESTE, CTX, (x) => proximoNumero(x, 'conta', null, carimbo));
    expect(
      await e(
        new BancoDuble().quando(/FROM sequencia_negocio/, linha({ prefixo: null, proximo_valor: '7' })),
      ),
    ).toEqual({
      valor: 7,
      formatado: '7',
    });
    expect(await codigo(e(new BancoDuble()))).toBe('sequencia-nao-configurada');
    expect(await codigo(e(new BancoDuble().quando(/FROM sequencia_negocio/, linha({ ativo: 0 }))))).toBe(
      'sequencia-inativa',
    );
    expect(
      await codigo(e(new BancoDuble().quando(/FROM sequencia_negocio/, linha({ valor_maximo: 40 })))),
    ).toBe('sequencia-esgotada');
    await expect(
      e(new BancoDuble().quando(/FROM sequencia_negocio/, linha({ incremento: 0 }))),
    ).rejects.toThrow(/ilegível/);
    await expect(
      escreverTransacao(new BancoDuble().fonte(), CONFIG_TESTE, CTX, (x) =>
        proximoNumero(x, 'Tipo Errado', null, carimbo),
      ),
    ).rejects.toThrow(/inválido/);
  });

  it('garantirSequencia cria só quando não existe', async () => {
    const nova = new BancoDuble();
    const id = await escreverTransacao(nova.fonte(), CONFIG_TESTE, CTX, (e) =>
      garantirSequencia(e, { tipo: 'conta', estabelecimento: 4, prefixo: 'C' }, carimbo),
    );
    expect(id).toBe(100);
    expect(nova.que(/^INSERT INTO sequencia_negocio/)[0]?.parametros).toEqual([
      4,
      'conta',
      'C',
      1,
      1,
      null,
      carimbo.agora,
      3,
    ]);
    const existe = new BancoDuble().quando(/SELECT id FROM sequencia_negocio/, [{ id: 12 }]);
    expect(
      await escreverTransacao(existe.fonte(), CONFIG_TESTE, CTX, (e) =>
        garantirSequencia(e, { tipo: 'conta', estabelecimento: 4 }, carimbo),
      ),
    ).toBe(12);
    expect(existe.que(/^INSERT/)).toHaveLength(0);
  });
});
