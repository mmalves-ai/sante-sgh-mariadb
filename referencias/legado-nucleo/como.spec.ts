// Imagem antes/depois das escritas do "como" (ADR 0021, regra 5b), sobre o banco FALSO em memória: o
// comando é analisado, o registro afetado é retratado na MESMA transação e, se não der para retratar, a
// escrita não acontece (fail-closed). Também: a ORIGEM da SGH_TRILHA com o ator real e o 503 do executor.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bancoDoSuporte } from './banco-falso.spec-util.js';
import {
  analisarEscrita,
  colunasDiferentes,
  comImagens,
  comparavelSerial,
  contarParametros,
  ErroImagemComo,
  executarComo,
  jsonAscii,
  limparMetadadosComo,
  marcaComoAtual,
  metaDaTabela,
  origemSuporte,
  type MarcaComo,
  semImagem,
  serializarLinha,
  serializarValor,
  setMudaChave,
  textoSerial,
  valorDoSerial,
} from './como.js';
import { depsDuble, escritorDuble } from './duble-escritor.spec-util.js';
import { ErroOperacao } from './erros-operacao.js';
import { Executor } from './executor.js';
import { definirOperacao, type Receita } from './operacao.js';
import { gravarTrilha } from './sgh/tecnicas.js';
import perfilTbusers from '../acesso/assinaturas/acesso.trocarGrupoUsuario/perfil-TBUSERS.pc.json' with { type: 'json' };

const MARCA: MarcaComo = { sessao: '501', acao: '601', atorTipo: 'suporte', idConta: '9', alvo: 'SINT.ALVO' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linhas do banco falso, conferidas campo a campo
function imagens(b: ReturnType<typeof bancoDoSuporte>): Record<string, any>[] {
  return b.copia('SGH_SUP_IMAGEM').map((i) => ({
    ...i,
    ANTES: i['ANTES'] ? JSON.parse(String(i['ANTES'])) : null,
    DEPOIS: i['DEPOIS'] ? JSON.parse(String(i['DEPOIS'])) : null,
  }));
}

describe('análise do comando de escrita', () => {
  it('INSERT … VALUES, com e sem RETURNING; INSERT … SELECT e MERGE ficam de fora', () => {
    expect(analisarEscrita('INSERT INTO TBTESTE (NOME) VALUES (?)')).toEqual({
      acao: 'INSERT',
      tabela: 'TBTESTE',
      retorna: null,
    });
    expect(
      analisarEscrita('INSERT INTO TBTESTE (NOME) VALUES (CAST(? AS VARCHAR(9))) RETURNING ID, NOME'),
    ).toEqual({
      acao: 'INSERT',
      tabela: 'TBTESTE',
      retorna: ['ID', 'NOME'],
    });
    expect(analisarEscrita('INSERT INTO TBTESTE (NOME) SELECT NOME FROM TBX').acao).toBe('OUTRA');
    expect(analisarEscrita('MERGE INTO TBTESTE t USING x ON (1=1)')).toEqual({
      acao: 'OUTRA',
      tabela: 'TBTESTE',
    });
    expect(analisarEscrita('UPDATE OR INSERT INTO TBTESTE (ID) VALUES (?) MATCHING (ID)').acao).toBe('OUTRA');
    expect(analisarEscrita('EXECUTE PROCEDURE X')).toEqual({ acao: 'OUTRA', tabela: null });
  });

  it('UPDATE com apelido e WHERE no nível de cima (não o de dentro de parênteses nem de aspas)', () => {
    const a = analisarEscrita(
      "UPDATE TBTESTE t SET NOME = ?, VALOR = (SELECT MAX(V) FROM X WHERE X.A = ?) WHERE t.ID = ? AND NOME <> 'WHERE ?'",
    );
    expect(a).toMatchObject({
      acao: 'UPDATE',
      tabela: 'TBTESTE',
      apelido: 't',
      parametrosSet: 2,
      parametrosWhere: 1,
    });
    expect(analisarEscrita('UPDATE TBTESTE SET NOME = ?')).toMatchObject({ where: null, parametrosWhere: 0 });
    expect(analisarEscrita('DELETE FROM TBTESTE d WHERE d.ID = ? RETURNING ID')).toMatchObject({
      acao: 'DELETE',
      apelido: 'd',
      where: 'd.ID = ?',
      parametrosWhere: 1,
    });
    expect(analisarEscrita('DELETE FROM TBTESTE WHERE ID = ?')).toMatchObject({ apelido: null });
    expect(contarParametros("A = ? AND B = '?' AND C = \"?\" AND D = 'it''s ?'")).toBe(1);
    expect(setMudaChave('NOME = ?, t.ID = ?', ['ID'])).toBe(true);
    expect(setMudaChave('NOME = ?, IDADE = ?', ['ID'])).toBe(false);
  });

  it('valores da imagem: data, bytes e inteiro grande voltam iguais; JSON só ASCII', async () => {
    const d = new Date(Date.UTC(2026, 9, 20, 12));
    const s = await serializarLinha({
      D: d,
      B: Buffer.from([1, 2]),
      N: 10n,
      T: 'ação',
      Z: null,
      U: undefined,
    });
    expect(valorDoSerial(s['D']!)).toEqual(d);
    expect(valorDoSerial(s['B']!)).toEqual(Buffer.from([1, 2]));
    expect(valorDoSerial(s['N']!)).toBe(10n);
    expect(s['Z']).toBeNull();
    expect(jsonAscii(s)).not.toMatch(/[^\x20-\x7e]/);
    expect(JSON.parse(jsonAscii(s))['T']).toBe('ação');
    expect(await serializarValor({ blob: 1 }, { lerBlob: async () => Buffer.from('x') })).toEqual({
      $b: 'eA==',
    });
    await expect(serializarValor({ blob: 1 })).rejects.toBeInstanceOf(ErroImagemComo);
    expect(comparavelSerial('a  ')).toBe(comparavelSerial('a'));
    expect(textoSerial({ $b: 'eA==' })).toBe('(binário, 1 bytes)');
    expect(textoSerial({ $n: '5' })).toBe('5');
    expect(textoSerial(undefined)).toBeNull();
    expect(colunasDiferentes({ A: 1, B: 'x ' }, { A: 2, B: 'x' })).toEqual(['A']);
  });
});

describe('comImagens: o registro afetado é retratado na mesma transação', () => {
  it('INSERT (pelo executar): a chave gerada pelo "gatilho" volta pelo RETURNING e a imagem leva o DEPOIS', async () => {
    limparMetadadosComo();
    const b = bancoDoSuporte();
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    expect(await e.executar('INSERT INTO TBTESTE (NOME, VALOR) VALUES (?, ?)', ['Três', 30])).toBe(1);
    const [im] = imagens(b);
    expect(im).toMatchObject({
      ID_SESSAO: '501',
      ID_ACAO: '601',
      ATOR_TIPO: 'suporte',
      ID_CONTA: '9',
      ALVO_LOGIN: 'SINT.ALVO',
      TABELA: 'TBTESTE',
      OPERACAO: 'INSERT',
      ANTES: null,
    });
    expect(JSON.parse(String(im?.['CHAVE']))).toEqual({ ID: 101 });
    // A coluna calculada (COMPUTED BY) não entra.
    expect(im?.['DEPOIS']).toEqual({ ID: 101, NOME: 'Três', VALOR: 30, QUANDO: null });
  });

  it('as tabelas de suprimentos (SGH_SUP_OPME_ETAPA) levam a imagem no "como" (o Corrigir as alcança)', async () => {
    limparMetadadosComo();
    const b = bancoDoSuporte().tabela('SGH_SUP_OPME_ETAPA', {
      chave: ['ID'],
      colunas: ['ID', 'ID_SOLIC', 'ETAPA', 'SENHA'],
      gerador: 'ID',
      linhas: [],
    });
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    expect(
      await e.executar('INSERT INTO SGH_SUP_OPME_ETAPA (ID_SOLIC, ETAPA, SENHA) VALUES (?, ?, ?)', [
        46301,
        'autorizacao',
        'SENHA-SINT',
      ]),
    ).toBe(1);
    const [im] = imagens(b);
    expect(im).toMatchObject({ TABELA: 'SGH_SUP_OPME_ETAPA', OPERACAO: 'INSERT', ANTES: null });
    expect(im?.['DEPOIS']).toMatchObject({ ID_SOLIC: 46301, ETAPA: 'autorizacao' });
  });

  it('INSERT pelo executarRetornando: devolve só as colunas que o chamador pediu', async () => {
    const b = bancoDoSuporte();
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    expect(await e.executarRetornando('INSERT INTO TBTESTE (NOME) VALUES (?) RETURNING NOME', ['Q'])).toEqual(
      {
        NOME: 'Q',
      },
    );
    expect(
      await e.executarRetornando('INSERT INTO TBTESTE (ID, NOME) VALUES (?, ?) RETURNING ID', [50, 'C']),
    ).toEqual({
      ID: 50,
    });
    expect(imagens(b).map((i) => JSON.parse(String(i['CHAVE'])))).toEqual([{ ID: 101 }, { ID: 50 }]);
  });

  it('UPDATE: ANTES e DEPOIS do registro, com as colunas que mudaram; sem mudança, sem imagem', async () => {
    const b = bancoDoSuporte();
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    expect(await e.executar('UPDATE TBTESTE SET VALOR = ? WHERE ID = ?', [11, 1])).toBe(1);
    expect(await e.executar('UPDATE TBTESTE SET NOME = ? WHERE ID = ?', ['Dois', 2])).toBe(1);
    const im = imagens(b);
    expect(im).toHaveLength(1);
    expect(im[0]).toMatchObject({ OPERACAO: 'UPDATE', COLUNAS: 'VALOR' });
    expect(im[0]?.['ANTES']['VALOR']).toBe(10);
    expect(im[0]?.['DEPOIS']['VALOR']).toBe(11);
  });

  it('DELETE: a imagem guarda o registro inteiro (para reinserir)', async () => {
    const b = bancoDoSuporte();
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    expect(await e.executar('DELETE FROM TBTESTE WHERE ID = ?', [2])).toBe(1);
    expect(imagens(b)[0]).toMatchObject({
      OPERACAO: 'DELETE',
      DEPOIS: null,
      ANTES: { ID: 2, NOME: 'Dois', VALOR: 20, QUANDO: null },
    });
  });

  it('colunas de credencial nunca são lidas (TBUSERS: SENHA e SALT fora do SELECT e da imagem)', async () => {
    const b = bancoDoSuporte();
    const e = comImagens(b.escritor(), MARCA, 'rede-teste');
    await e.executar('UPDATE TBUSERS SET NOMEC = ? WHERE NOME = ?', ['Outro', 'SINT.X']);
    const selects = b.comandos.filter((c) => c.tipo === 'consultar' && /FROM TBUSERS/.test(c.sql));
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s.sql).not.toMatch(/SENHA|SALT/);
    expect(JSON.stringify(imagens(b))).not.toMatch(/HASH-SINTETICO|SENHA|SALT/);
  });

  it('TBUSERS com as 32 colunas medidas no pc: nenhuma de credencial, verificação, biometria ou dado pessoal na imagem', async () => {
    const colunas = (perfilTbusers as { colunas: Record<string, unknown> | { nome: string }[] }).colunas;
    const nomes = Array.isArray(colunas) ? colunas.map((c) => c.nome) : Object.keys(colunas);
    expect(nomes).toHaveLength(32);
    const leitor = {
      hospital: 'teste-tbusers-imagem',
      consultar: (sql: string) =>
        Promise.resolve(/PRIMARY KEY/.test(sql) ? [{ C: 'NOME' }] : nomes.map((c) => ({ C: c }))),
    };
    const meta = await metaDaTabela(leitor as never, 'TBUSERS');
    expect(meta.lidas).toContain('GRUPO');
    expect(meta.lidas).toContain('NOME');
    // DATA_ULTIMA_ALTERACAO_SENHA é só a data (a política de troca), não credencial.
    for (const c of meta.lidas.filter((x) => x !== 'DATA_ULTIMA_ALTERACAO_SENHA'))
      expect(c).not.toMatch(
        /SENHA|SALT|CODIGO|DIGITAL|TOKEN|FOTO|BIOMETRIA|DOIS_FATORES|MAIL|CPF|NASC|IPLOG|PCLOG/,
      );
  });

  it('tabelas técnicas passam sem imagem (trilhas, outbox, as do próprio suporte)', async () => {
    for (const t of [
      'SGH_TRILHA',
      'SGH_OUTBOX',
      'SGH_SUP_ACAO',
      'SGH_PLAT_CONTA',
      'TBCABTRILHA',
      'TBLANTRILHASGH',
    ])
      expect(semImagem(t)).toBe(true);
    expect(semImagem('SGH_CFG_PARAMETRO')).toBe(false);
    // O prefixo SGH_SUP_ é também o das tabelas de suprimentos: só as do suporte ficam de fora.
    for (const t of ['SGH_SUP_SESSAO', 'SGH_SUP_LEITURA', 'SGH_SUP_IMAGEM', 'SGH_SUP_CORRECAO'])
      expect(semImagem(t)).toBe(true);
    for (const t of [
      'SGH_SUP_OPME_SOLIC',
      'SGH_SUP_OPME_ETAPA',
      'SGH_SUP_OPME_RASTREIO',
      'SGH_SUP_INVENTARIO',
      'SGH_SUP_TRANSF_ETAPA',
    ])
      expect(semImagem(t)).toBe(false);
    const e = escritorDuble(() => 1);
    await comImagens(e, MARCA, 'r').executar('INSERT INTO SGH_TRILHA (ID) VALUES (?)', [1]);
    expect(e.comandos).toHaveLength(1);
  });

  it.each([
    ['MERGE', 'MERGE INTO TBTESTE t USING TBX x ON (t.ID = x.ID) WHEN MATCHED THEN UPDATE SET NOME = x.NOME'],
    ['INSERT … SELECT', 'INSERT INTO TBTESTE (NOME) SELECT NOME FROM TBTESTE'],
    ['procedimento', 'EXECUTE PROCEDURE SP_X'],
    ['tabela sem chave primária', 'UPDATE TBSEMCHAVE SET A = ? WHERE A = ?'],
    ['UPDATE que muda a chave', 'UPDATE TBTESTE SET ID = ? WHERE ID = ?'],
  ])('fail-closed: %s não é retratado e a escrita NÃO acontece', async (_nome, sql) => {
    limparMetadadosComo();
    const b = bancoDoSuporte();
    const antes = b.copia('TBTESTE');
    await expect(comImagens(b.escritor(), MARCA, 'r').executar(sql, [9, 1])).rejects.toBeInstanceOf(
      ErroImagemComo,
    );
    expect(b.copia('TBTESTE')).toEqual(antes);
    expect(b.comandos.some((c) => c.tipo !== 'consultar')).toBe(false);
  });

  it('a imagem ANTES é lida com WITH LOCK; linha confirmada por outra estação depois da leitura: recusa', async () => {
    const b = bancoDoSuporte();
    const base = b.escritor();
    // Outra estação confirma uma linha que o mesmo WHERE pega, entre a leitura da imagem e o DELETE.
    const concorrente = {
      ...base,
      executar: async (sql: string, p: readonly unknown[] = []) => {
        if (/^DELETE/.test(sql))
          b.tabelas.get('TBTESTE')!.linhas.push({ ID: 3, NOME: 'Três', VALOR: 20, QUANDO: null, DOBRO: 40 });
        return base.executar(sql, p);
      },
    };
    await expect(
      comImagens(concorrente, MARCA, 'r').executar('DELETE FROM TBTESTE WHERE VALOR = ?', [20]),
    ).rejects.toThrow(ErroImagemComo);
    const leitura = b.comandos.find((c) => c.tipo === 'consultar' && /FROM TBTESTE WHERE/.test(c.sql));
    expect(leitura?.sql).toMatch(/ WITH LOCK$/);
    // Sem concorrência, o mesmo comando passa (o número de linhas confere com a imagem).
    const b2 = bancoDoSuporte();
    expect(
      await comImagens(b2.escritor(), MARCA, 'r').executar('DELETE FROM TBTESTE WHERE VALOR = ?', [20]),
    ).toBe(1);
  });

  it('fail-closed: se a imagem não grava, o erro sobe (a transação inteira é desfeita)', async () => {
    const b = bancoDoSuporte();
    b.falharEm = 'SGH_SUP_IMAGEM';
    await expect(
      comImagens(b.escritor(), MARCA, 'r').executar('UPDATE TBTESTE SET VALOR = ? WHERE ID = ?', [99, 1]),
    ).rejects.toThrow(/falha simulada/);
  });

  it('teto de registros por comando: acima dele, recusa', async () => {
    const e = escritorDuble((c) => {
      if (c.sql.includes('RDB$RELATION_CONSTRAINTS')) return [{ C: 'ID' }];
      if (c.sql.includes('RDB$RELATION_FIELDS')) return [{ C: 'ID' }];
      throw Object.assign(new Error('Consulta passou do teto de 500 linhas.'), { name: 'ErroTetoLinhas' });
    });
    limparMetadadosComo();
    await expect(comImagens(e, MARCA, 'r').executar('DELETE FROM TBGRANDE WHERE A = ?', [1])).rejects.toThrow(
      /teto/,
    );
    expect(e.comandos.some((c) => c.tipo === 'executar')).toBe(false);
  });
});

describe('contexto "como" e trilha', () => {
  it('executarComo marca o que for encadeado; fora dele, nada', async () => {
    expect(marcaComoAtual()).toBeNull();
    const dentro = await executarComo(MARCA, async () => {
      await Promise.resolve();
      return marcaComoAtual();
    });
    expect(dentro).toEqual(MARCA);
    expect(marcaComoAtual()).toBeNull();
    expect(origemSuporte(MARCA)).toBe('SUPORTE:suporte:9:S501');
  });

  it('SGH_TRILHA no "como": USUARIO é o alvo e a ORIGEM leva o ator real (sem nome, e-mail nem IP)', async () => {
    const b = bancoDoSuporte();
    const linha = {
      rede: 'r',
      hospital: 'pc',
      usuario: 'SINT.ALVO',
      evento: 'x',
      recurso: 'x',
      operacao: 'x',
      tabelaAlvo: null,
      idAlvo: null,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'SGH-WEB:SUPORTE',
      correlacao: 'c',
    };
    await executarComo(MARCA, () => gravarTrilha(b.escritor(), linha));
    const insert = b.comandos.find((c) => c.sql.includes('INSERT INTO SGH_TRILHA'));
    expect(insert?.parametros[4]).toBe('SINT.ALVO');
    expect(insert?.parametros).toContain('SUPORTE:suporte:9:S501');
  });

  it('executor: ErroImagemComo vira 503 (a escrita não aconteceu)', async () => {
    const receita: Receita = {
      nome: 'teste.incluirItem',
      modulo: 'teste',
      grupo: 'teste',
      descricao: 'Operação sintética.',
      marco: 'M04',
      origem: 'perfil-passivo',
      arquivoOrigem: null,
      evento: 'teste.item.incluido',
      recurso: 'teste.item',
      passos: [
        {
          ordem: 1,
          tabela: 'TABELA_X',
          acao: 'INSERT',
          colunas: { NOME: { classe: 'entrada', origem: 'entrada' } },
        },
      ],
      efeitos: [],
      naoFaz: [],
      condicao: '-',
      concorrencia: '-',
      prova: '-',
      cenarios: [
        { nome: 'feliz', descricao: 'inclui' },
        { nome: 'recusa', descricao: 'recusa', recusa: true },
      ],
    };
    const op = definirOperacao<{ nome: string }, { id: number }>({
      receita,
      entrada: z.object({ nome: z.string() }),
      gravar: async () => {
        throw new ErroImagemComo('sem imagem');
      },
      provar: async () => undefined,
      eventos: () => [],
      alvo: () => ({ tabela: 'TABELA_X', id: null }),
    });
    const { deps } = depsDuble(escritorDuble(() => []));
    const erro = await new Executor(deps)
      .executar(
        op,
        'pc',
        { nome: 'x' },
        {
          rede: 'rede-teste',
          hospital: 'pc',
          traceId: 't',
          usuarioLegado: 'USUARIO.TESTE',
          idempotencyKey: 'chave-teste-0001',
        },
      )
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect((erro as ErroOperacao).problema).toMatchObject({
      status: 503,
      codigo: 'suporte-imagem-indisponivel',
    });
  });
});
