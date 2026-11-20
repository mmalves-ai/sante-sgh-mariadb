import { describe, expect, it } from 'vitest';
import { BancoDuble, CONFIG_TESTE } from './duble-banco.spec-util.js';
import { ErroOperacao } from './erros.js';
import {
  alterarAuditado,
  colunasMudadas,
  excluirAuditado,
  incluirAuditado,
  travarRegistro,
} from './gravacao.js';
import { type Escritor, escreverTransacao } from './transacao.js';

const CTX = { cliente: 'teste_duble', estabelecimento: 1, usuario: 3, correlacao: 'c-1' };
const AGORA = new Date('2026-11-20T12:00:00.000Z');
const carimbo = { usuario: 3, agora: AGORA };

function comEscritor<T>(banco: BancoDuble, fn: (e: Escritor) => Promise<T>): Promise<T> {
  return escreverTransacao(banco.fonte(), CONFIG_TESTE, CTX, fn);
}

async function codigoDoErro(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo;
    throw e;
  }
  return 'sem-erro';
}

describe('auditoria automática', () => {
  it('a inclusão grava criado_em, criado_por e versão 1', async () => {
    const banco = new BancoDuble();
    const id = await comEscritor(banco, (e) =>
      incluirAuditado(e, 'tipo_x', { codigo: 'A', descricao: 'B' }, carimbo),
    );
    expect(id).toBe(100);
    const [c] = banco.que(/^INSERT INTO tipo_x/);
    expect(c?.sql).toBe(
      'INSERT INTO tipo_x (codigo, descricao, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?)',
    );
    expect(c?.parametros).toEqual(['A', 'B', AGORA, 3, 1]);
  });

  it('recusa coluna do núcleo e nome inválido nos valores', async () => {
    const banco = new BancoDuble();
    await expect(
      comEscritor(banco, (e) => incluirAuditado(e, 'tipo_x', { versao: 9 }, carimbo)),
    ).rejects.toThrow(/do núcleo/);
    await expect(
      comEscritor(banco, (e) => incluirAuditado(e, 'tipo_x', { 'a; drop': 1 }, carimbo)),
    ).rejects.toThrow(/inválido/);
    await expect(comEscritor(banco, (e) => incluirAuditado(e, 'Tipo-X', {}, carimbo))).rejects.toThrow(
      /inválido/,
    );
    expect(banco.estados.filter((s) => s === 'desfazer')).toHaveLength(3);
  });

  it('a alteração confere a versão e grava alterado_em, alterado_por e versão + 1', async () => {
    const banco = new BancoDuble();
    const v = await comEscritor(banco, (e) =>
      alterarAuditado(e, 'tipo_x', 5, 2, { descricao: 'Nova' }, carimbo),
    );
    expect(v).toBe(3);
    const [c] = banco.que(/^UPDATE tipo_x/);
    expect(c?.sql).toBe(
      'UPDATE tipo_x SET descricao = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ? AND versao = ?',
    );
    expect(c?.parametros).toEqual(['Nova', AGORA, 3, 5, 2]);
  });
});

describe('trava otimista', () => {
  it('nenhuma linha afetada com o registro existente: conflito de versão', async () => {
    const banco = new BancoDuble()
      .quando(/^UPDATE tipo_x/, { affectedRows: 0 })
      .quando(/^SELECT versao FROM tipo_x/, [{ versao: 3 }]);
    expect(
      await codigoDoErro(
        comEscritor(banco, (e) => alterarAuditado(e, 'tipo_x', 5, 2, { descricao: 'N' }, carimbo)),
      ),
    ).toBe('conflito-versao');
    expect(banco.estados).toContain('desfazer');
    expect(banco.estados).not.toContain('confirmar');
  });

  it('nenhuma linha afetada sem o registro: inexistente', async () => {
    const banco = new BancoDuble().quando(/^UPDATE tipo_x/, { affectedRows: 0 });
    expect(
      await codigoDoErro(
        comEscritor(banco, (e) => alterarAuditado(e, 'tipo_x', 5, 2, { descricao: 'N' }, carimbo)),
      ),
    ).toBe('registro-inexistente');
  });

  it('a exclusão também confere a versão', async () => {
    const banco = new BancoDuble()
      .quando(/^DELETE FROM tipo_x/, { affectedRows: 0 })
      .quando(/^SELECT versao/, [{ versao: 7 }]);
    expect(await codigoDoErro(comEscritor(banco, (e) => excluirAuditado(e, 'tipo_x', 5, 6)))).toBe(
      'conflito-versao',
    );
    const ok = new BancoDuble();
    await comEscritor(ok, (e) => excluirAuditado(e, 'tipo_x', 5, 6));
    expect(ok.que(/^DELETE/)[0]?.parametros).toEqual([5, 6]);
  });

  it('id e versão inválidos são recusados antes do banco', async () => {
    const banco = new BancoDuble();
    await expect(comEscritor(banco, (e) => alterarAuditado(e, 'tipo_x', 0, 1, {}, carimbo))).rejects.toThrow(
      /Id/,
    );
    await expect(comEscritor(banco, (e) => alterarAuditado(e, 'tipo_x', 1, 0, {}, carimbo))).rejects.toThrow(
      /Versão/,
    );
    expect(banco.que(/UPDATE/)).toHaveLength(0);
  });

  it('travarRegistro usa SELECT ... FOR UPDATE com id e versão', async () => {
    const banco = new BancoDuble().quando(/FROM tipo_x/, [{ id: 5, versao: 2, descricao: 'A' }]);
    const l = await comEscritor(banco, (e) => travarRegistro(e, 'tipo_x', 5, ['descricao', 'versao']));
    expect(l).toEqual({ id: 5, versao: 2, descricao: 'A' });
    expect(banco.comandos.at(-1)?.sql).toBe(
      'SELECT id, versao, descricao FROM tipo_x WHERE id = ? FOR UPDATE',
    );
  });

  it('colunasMudadas compara datas, nulos e espaços à direita', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(
      colunasMudadas({ a: 'x  ', b: d, c: null, e: 1 }, { a: 'x', b: new Date(d), c: null, e: 2 }),
    ).toEqual(['e']);
  });
});
