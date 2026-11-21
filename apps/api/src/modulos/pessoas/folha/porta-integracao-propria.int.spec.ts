// Integração da porta própria da integração da folha contra o MariaDB real (cliente f22_o3, criado por
// `python3 -I tools/db/criar_cliente.py f22_o3 "Teste F2.2 onda 3"`). Massa sintética própria (códigos 9307x), criada
// no beforeAll e apagada no afterAll. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import { PortaIntegracaoFolhaPropria } from './porta-integracao-propria.js';
import { OPERACAO_TITULOS_FOLHA } from './servico-integracao.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const COD = { grupo: '93071', subgrupo: '93072', natureza: '93073' };
const CNPJ = '93070000000107';
const TIPO = { credor: 'F22-0307', documento: 'F22-0307' };
const NUMERO_TITULO = 'F22-0307-1';

describe.skipIf(SEM_BANCO)('porta própria da integração da folha contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaIntegracaoFolhaPropria;
  let est = 0;
  let credor = 0;
  const ctx = () => ({ cliente: CLIENTE, estabelecimento: est, usuario: null, correlacao: 'teste-03-07' });

  async function limpar() {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-03-07' }, async (e) => {
      await e.executar(
        `DELETE d FROM integracao_folha_financeiro_destino d
           JOIN natureza_financeira n ON n.id = d.natureza_financeira_id WHERE n.codigo = ?`,
        [COD.natureza],
      );
      await e.executar(
        `DELETE i FROM integracao_folha_financeiro i
          WHERE i.vigencia_inicio >= '2099-01-01'
            AND NOT EXISTS (SELECT 1 FROM integracao_folha_financeiro_destino d WHERE d.integracao_folha_financeiro_id = i.id)`,
      );
      await e.executar(
        'DELETE p FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.numero = ?',
        [NUMERO_TITULO],
      );
      await e.executar('DELETE FROM titulo_pagar WHERE numero = ?', [NUMERO_TITULO]);
      await e.executar('DELETE FROM tipo_credor WHERE codigo = ?', [TIPO.credor]);
      await e.executar('DELETE FROM tipo_documento_financeiro WHERE codigo = ?', [TIPO.documento]);
      await e.executar('DELETE FROM empresa_fornecedora WHERE cnpj = ?', [CNPJ]);
      await e.executar('DELETE FROM natureza_financeira WHERE codigo = ?', [COD.natureza]);
      await e.executar(
        'DELETE s FROM subgrupo_natureza_financeira s JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id WHERE g.codigo = ?',
        [COD.grupo],
      );
      await e.executar('DELETE FROM grupo_natureza_financeira WHERE codigo = ?', [COD.grupo]);
    });
  }

  beforeAll(async () => {
    const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
      cwd: RAIZ,
      encoding: 'utf8',
    });
    if (!lista.split('\n').some((l) => l.split('\t').includes(CLIENTE)))
      execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], {
        cwd: RAIZ,
      });
    nucleo = new NucleoProprio();
    porta = new PortaIntegracaoFolhaPropria(nucleo);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-03-07' }, async (e) => {
      const agora = new Date();
      const r = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM estabelecimento');
      est = Number(r?.id ?? 0) || 1;
      const g = await e.inserir(
        "INSERT INTO grupo_natureza_financeira (codigo, nome, tipo, criado_em) VALUES (?, 'GRUPO SINTETICO 03-07', 'despesa', ?)",
        [COD.grupo, agora],
      );
      const s = await e.inserir(
        "INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, criado_em) VALUES (?, ?, 'SUBGRUPO SINTETICO', 'despesa', ?)",
        [g, COD.subgrupo, agora],
      );
      const n = await e.inserir(
        "INSERT INTO natureza_financeira (codigo, descricao, subgrupo_natureza_financeira_id, tipo, criado_em) VALUES (?, 'NATUREZA SINTETICA 03-07', ?, 'despesa', ?)",
        [COD.natureza, s, agora],
      );
      credor = await e.inserir(
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, 'CREDOR SINTETICO 03-07', ?)",
        [CNPJ, agora],
      );
      const tc = await e.inserir(
        "INSERT INTO tipo_credor (codigo, descricao, natureza, criado_em) VALUES (?, 'TIPO SINTETICO 03-07', 'fornecedor', ?)",
        [TIPO.credor, agora],
      );
      const td = await e.inserir(
        "INSERT INTO tipo_documento_financeiro (codigo, descricao, sentido, criado_em) VALUES (?, 'DOCUMENTO SINTETICO 03-07', 'pagar', ?)",
        [TIPO.documento, agora],
      );
      // Título manual EMITIDO em julho e com a parcela VENCENDO em agosto de 2099: conta no aviso de agosto (vencimento).
      const t = await e.inserir(
        `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, modulo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, ?, ?, ?, 'financeiro', ?, 'DOC-0307', '2099-07-20', '2099-07-20', 100.00, 100.00, ?, ?)`,
        [est, NUMERO_TITULO, tc, credor, td, n, agora],
      );
      await e.inserir(
        `INSERT INTO parcela_pagar (titulo_pagar_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
         VALUES (?, 1, '2099-08-10', '2099-08-10', 100.00, 100.00, ?)`,
        [t, agora],
      );
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('classificações: a natureza de despesa sintética aparece com o código numérico', async () => {
    const cs = await porta.classificacoes(ctx());
    expect(cs).toContainEqual({
      grupo: Number(COD.grupo),
      subgrupo: Number(COD.subgrupo),
      item: Number(COD.natureza),
      nome: 'NATUREZA SINTETICA 03-07',
    });
  });

  it('credores: por código, por parte do nome e o fornecedor inativo some', async () => {
    expect(await porta.credores(ctx(), { codigos: [credor] })).toEqual([
      { codigo: credor, nome: 'CREDOR SINTETICO 03-07' },
    ]);
    expect(await porta.credores(ctx(), { termo: 'SINTETICO 03-07' })).toContainEqual({
      codigo: credor,
      nome: 'CREDOR SINTETICO 03-07',
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'inativar-03-07' }, (e) =>
      e.executar("UPDATE empresa_fornecedora SET situacao = 'inativo' WHERE id = ?", [credor]),
    );
    expect(await porta.credores(ctx(), { codigos: [credor] })).toEqual([]);
  });

  it('títulos manuais: conta pelo vencimento da parcela (emitido em M-1, vence em M), não pela emissão', async () => {
    const f = {
      empresa: est,
      credor,
      grupo: Number(COD.grupo),
      subgrupo: Number(COD.subgrupo),
      item: Number(COD.natureza),
    };
    expect(await porta.titulosManuais(ctx(), { ...f, de: '2099-08-01', ate: '2099-08-31' })).toBe(1);
    expect(await porta.titulosManuais(ctx(), { ...f, de: '2099-07-01', ate: '2099-07-31' })).toBe(0);
    expect(
      await porta.titulosManuais(ctx(), { ...f, item: f.item + 1, de: '2099-08-01', ate: '2099-08-31' }),
    ).toBe(0);
  });

  it('naturezas fora do contrato numérico: a contagem é um número (o aviso), nunca sumiço', async () => {
    expect(await porta.naturezasForaDoContrato(ctx())).toBeGreaterThanOrEqual(0);
  });

  it('de-para: grava a vigência com os destinos, relê, recusa a repetida e a conta sugerida sem coluna', async () => {
    const conta = await nucleo.lerSomente(ctx(), (l) =>
      l.uma<{ id: number; login: string }>('SELECT id, login FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
    );
    const login = String(conta?.login ?? '');
    expect(login).not.toBe('');
    // A auditoria (quem criou) é a conta da sessão.
    const cc = () => ({ cliente: CLIENTE, estabelecimento: est, usuario: Number(conta?.id), correlacao: 'teste-03-07' });
    // O teste dos credores inativa o fornecedor sintético: o de-para precisa dele ativo.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'ativar-03-07' }, (e) =>
      e.executar("UPDATE empresa_fornecedora SET situacao = 'ativo' WHERE id = ?", [credor]),
    );
    const classificacao = { grupo: Number(COD.grupo), subgrupo: Number(COD.subgrupo), item: Number(COD.natureza) };
    const destinos = [
      { destino: 'liquido-mensal' as const, credor, classificacao, diaVencimento: 5, mesesDepois: 1, contaContabil: '' },
      { destino: 'fgts' as const, credor, classificacao, diaVencimento: 20, mesesDepois: 0, contaContabil: '' },
    ];
    const trilha = (r: number): TrilhaDaGravacao => ({
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade: 'integracao_folha_financeiro',
      entidadeId: r,
      dadosDepois: { evento: 'teste' },
      correlacao: 'teste-03-07',
    });
    const id = await porta.gravarSgh(cc(), trilha, (g) =>
      g.incluirIntegracao({ empresa: est, inicio: '2099-08-01', destinos, por: login }),
    );
    const lidas = await porta.integracoes(cc(), est);
    const v = lidas.find((x) => x.id === id);
    expect(v).toMatchObject({ empresa: est, inicio: '2099-08-01', criadoPor: login });
    expect(v?.destinos).toEqual([
      { ...destinos[0], rotina: 4 },
      { ...destinos[1], rotina: 15 },
    ]);
    expect(
      await codigo(
        porta.gravarSgh(cc(), trilha, (g) =>
          g.incluirIntegracao({ empresa: est, inicio: '2099-08-01', destinos, por: login }),
        ),
      ),
    ).toBe('vigencia-repetida');
    expect(
      await codigo(
        porta.gravarSgh(cc(), trilha, (g) =>
          g.incluirIntegracao({
            empresa: est,
            inicio: '2099-09-01',
            destinos: [{ ...destinos[0]!, contaContabil: '9.9.93079' }],
            por: login,
          }),
        ),
      ),
    ).toBe('conta-contabil-inexistente');
    expect(
      await codigo(
        porta.gravarSgh(cc(), trilha, (g) =>
          g.incluirIntegracao({
            empresa: est,
            inicio: '2099-09-01',
            destinos: [{ ...destinos[0]!, classificacao: { ...classificacao, item: classificacao.item + 1 } }],
            por: login,
          }),
        ),
      ),
    ).toBe('classificacao-inexistente');
    expect((await porta.integracoes(cc(), est)).some((x) => x.inicio === '2099-09-01')).toBe(false);
  });

  it('lançamento dos títulos: liberado; outra empresa não é vista', async () => {
    expect(await porta.podeGravar(ctx(), OPERACAO_TITULOS_FOLHA)).toMatchObject({ pode: true });
    expect(await porta.lancamentos(ctx(), est + 100_000, 2099)).toEqual([]);
  });
});
