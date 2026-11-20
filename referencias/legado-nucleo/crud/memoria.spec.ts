// Banco de domínios em memória (sessão sintética, M08): o mesmo executor e a mesma receita genérica sobre
// tabelas sintéticas; transação que só confirma no sucesso; SQL fora do esperado é recusado.
import { describe, expect, it } from 'vitest';
import { declaracao, DECLARACOES } from '../../cadastros.js';
import type { ContextoOperacao } from '../operacao.js';
import { operacao } from '../../operacoes.js';
import { listarDominio, opcoesDoCampo, usoDoItem } from './repositorio.js';
import { BancoMemoriaDominios, linhasSinteticas } from './memoria.js';

let n = 0;
const ctx = (): ContextoOperacao => ({
  rede: 'rede-teste',
  hospital: 'aa',
  traceId: 'teste-memoria',
  usuarioLegado: 'SINT.ADMIN',
  idempotencyKey: `memoria-${++n}-chave`,
});
const catalogo = { estado: () => 'verde' as const };

describe('banco de domínios em memória', () => {
  it('linhas sintéticas respeitam a declaração (chave na faixa, letra vista, situação ativa)', () => {
    const civil = linhasSinteticas(declaracao('cadastro.estadoCivil')!);
    expect(civil).toHaveLength(3);
    expect(civil[0]).toMatchObject({ ID: 1, SEXO: 'F' });
    expect(linhasSinteticas(declaracao('internacao.tipoLimpeza')!)[0]).toMatchObject({ ATIVO: 'T' });
    expect(linhasSinteticas(declaracao('pep.tipoAlergia')!)[0]).toMatchObject({ ID_TBCLASSIFALERGIA: 1 });
    expect(linhasSinteticas(declaracao('pep.viaAdministracaoDieta')!)[0]).toMatchObject({
      ID_TBTPDIETA: null,
    });
  });

  it('o executor inclui, altera e inativa em memória; a recusa não muda nada', async () => {
    const banco = new BancoMemoriaDominios(DECLARACOES, {
      PRTPLAN: { chave: 'ID', linhas: [{ ID: 1, NOME: 'P' }] },
    });
    const ex = banco.criarExecutor(catalogo, 'ci');
    const r = await ex.executar(
      operacao('internacao.incluirTipoLimpeza'),
      'aa',
      { nome: 'Limpeza nova', tempoPrevisto: '00:45' },
      ctx(),
    );
    expect(r.resultado['codigo']).toBe('1001');
    const d = declaracao('internacao.tipoLimpeza')!;
    const lista = await banco.ler('aa', (l) => listarDominio(l, d));
    const novo = lista.itens.find((i) => i.codigo === '1001')!;
    expect(novo.valores['tempoPrevisto']).toBe('00:45');
    await ex.executar(
      operacao('internacao.alterarTipoLimpeza'),
      'aa',
      { codigo: '1001', versao: novo.versao, valores: { tempoPrevisto: '01:15' } },
      ctx(),
    );
    const depois = (await banco.ler('aa', (l) => listarDominio(l, d))).itens.find(
      (i) => i.codigo === '1001',
    )!;
    await ex.executar(
      operacao('internacao.inativarTipoLimpeza'),
      'aa',
      { codigo: '1001', versao: depois.versao },
      ctx(),
    );
    expect(
      (await banco.ler('aa', (l) => listarDominio(l, d))).itens.find((i) => i.codigo === '1001')?.ativo,
    ).toBe(false);
    // Inativo não conta na duplicidade (regra 3: entre ativos); o sintético ativo conta.
    await ex.executar(
      operacao('internacao.incluirTipoLimpeza'),
      'aa',
      { nome: 'limpeza nova', tempoPrevisto: '00:45' },
      ctx(),
    );
    await expect(
      ex.executar(
        operacao('internacao.incluirTipoLimpeza'),
        'aa',
        { nome: 'tipo de limpeza 1', tempoPrevisto: '00:45' },
        ctx(),
      ),
    ).rejects.toMatchObject({
      problema: { codigo: 'duplicado' },
    });
    // Outro estabelecimento tem o seu próprio banco sintético.
    expect((await banco.ler('bb', (l) => listarDominio(l, d))).itens).toHaveLength(3);
  });

  it('chave manual repetida vira 409; uso e opções em memória', async () => {
    const banco = new BancoMemoriaDominios(DECLARACOES, {
      PRTPLAN: { chave: 'ID', linhas: [{ ID: 1, NOME: 'Plano' }] },
    });
    const ex = banco.criarExecutor(catalogo, 'ci');
    await expect(
      ex.executar(operacao('cadastro.incluirReligiao'), 'aa', { codigo: 1, nome: 'Outra religião' }, ctx()),
    ).rejects.toMatchObject({
      problema: { codigo: 'duplicado' },
    });
    const modo = declaracao('pep.modoVentilatorio')!;
    expect(await banco.ler('aa', (l) => opcoesDoCampo(l, modo, 'tipoPlano', declaracao))).toEqual([
      { valor: 1, rotulo: 'Plano', ativo: true },
    ]);
    expect(await banco.ler('aa', (l) => usoDoItem(l, modo, '1'))).toEqual([]);
  });

  it('transação: sem confirmar ou com erro, o estado não muda; SQL desconhecido é recusado', async () => {
    const banco = new BancoMemoriaDominios(DECLARACOES);
    const d = declaracao('cadastro.religiao')!;
    await banco.escrever(
      'aa',
      (e) => e.executar('INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)', [77, 'X']),
      false,
    );
    expect((await banco.ler('aa', (l) => listarDominio(l, d))).itens.map((i) => i.codigo)).not.toContain(
      '77',
    );
    await expect(
      banco.escrever(
        'aa',
        async (e) => {
          await e.executar('INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)', [78, 'Y']);
          throw new Error('falhou');
        },
        true,
      ),
    ).rejects.toThrow('falhou');
    expect((await banco.ler('aa', (l) => listarDominio(l, d))).itens.map((i) => i.codigo)).not.toContain(
      '78',
    );
    await banco.escrever(
      'aa',
      (e) => e.executar('INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)', [79, 'Z']),
      true,
    );
    expect((await banco.ler('aa', (l) => listarDominio(l, d))).itens.map((i) => i.codigo)).toContain('79');
    await expect(
      banco.escrever(
        'aa',
        (e) => e.executar('INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)', [79, 'Z']),
        true,
      ),
    ).rejects.toThrow(/PRIMARY/);
    await expect(banco.ler('aa', (l) => l.consultar('DELETE FROM TBRELIG'))).rejects.toThrow(/fora do banco/);
    await expect(banco.ler('aa', (l) => l.consultar('SELECT X FROM NAO_EXISTE'))).rejects.toThrow(
      /fora do banco/,
    );
    await expect(
      banco.escrever('aa', (e) => e.executar('INSERT INTO NAO_EXISTE (A) VALUES (?)', [1]), true),
    ).rejects.toThrow(/fora do banco/);
    await expect(
      banco.escrever('aa', (e) => e.executar('UPDATE NAO_EXISTE SET A = ? WHERE ID = ?', [1, 1]), true),
    ).rejects.toThrow(/fora do banco/);
    expect(
      await banco.escrever(
        'aa',
        (e) => e.executar('UPDATE TBRELIG SET NOME = ? WHERE COD = ?', ['W', 9999]),
        true,
      ),
    ).toBe(0);
    expect(
      await banco.escrever('aa', (e) => e.executar('INSERT INTO SGH_TRILHA (ID) VALUES (?)', [1]), true),
    ).toBe(1);
    expect(await banco.ler('aa', (l) => l.consultar('SELECT HASH_LINHA FROM SGH_TRILHA'))).toEqual([]);
    expect(
      await banco.escrever(
        'aa',
        (e) => e.executarRetornando('INSERT INTO TBRELIG (COD, NOME) VALUES (?, ?)', [80, 'V']),
        true,
      ),
    ).toEqual({});
    expect((await banco.ler('aa', (l) => l.lerBlob(null))).length).toBe(0);
  });
});
