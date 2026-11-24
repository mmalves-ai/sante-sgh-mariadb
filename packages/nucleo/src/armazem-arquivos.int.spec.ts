// Integração da porta de arquivos (ADR 0004) contra o MariaDB real: o cliente de teste (SGH_CLIENTE_TESTE, padrão
// teste_nucleo) e uma pasta temporária como ARQUIVOS_RAIZ. Confere registro em `arquivo` pelo Executor com trilha,
// idempotência, leitura conferida pelo hash, versão nova sem apagar a anterior, recusa de exclusão antes da guarda
// legal e o vigia (falta e divergência). Conteúdo sintético. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemArquivosLocal, criarArmazemLocal } from './armazem-arquivos.js';
import { type PastaArquivosTeste, criarPastaArquivosTeste } from './arquivos-teste.js';
import type { ContextoOperacao } from './executor.js';
import { NucleoProprio } from './nucleo.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

describe.skipIf(SEM_BANCO)(`porta de arquivos no disco local (cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let pasta: PastaArquivosTeste;
  let armazem: ArmazemArquivosLocal;
  let estabelecimento = 0;
  let usuario = 0;
  const ctx = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento,
    usuario,
    correlacao: `teste-arq-${randomUUID()}`.slice(0, 64),
    chaveIdempotencia: `arq-${randomUUID()}`,
  });
  const leitura = () => ({ cliente: CLIENTE, estabelecimento, usuario, correlacao: 'teste-arq-leitura' });
  const umaLinha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia' }, (l) => l.uma(sql, p));
  const unico = (rotulo: string) => Buffer.from(`${rotulo} sintetico ${randomUUID()}`);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    pasta = await criarPastaArquivosTeste(CLIENTE);
    armazem = criarArmazemLocal(nucleo, { raiz: pasta.raiz });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-arquivos' }, async (e) => {
      const agora = new Date();
      estabelecimento =
        (await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', ['tarquivos']))?.id ??
        (await e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
          ['tarquivos', 'Estabelecimento de teste', 'Estabelecimento de teste dos arquivos', agora],
        ));
      usuario =
        (await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', ['teste.arquivos']))?.id ??
        (await e.inserir(
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em, versao) VALUES (?, ?, 'servico', ?, 1)",
          ['teste.arquivos', 'Conta de serviço do teste dos arquivos', agora],
        ));
    });
  });

  afterAll(async () => {
    await pasta?.apagar();
    await nucleo?.encerrar();
  });

  it('guarda: arquivo somente leitura na pasta do banco, registro com trilha, leitura conferida', async () => {
    const conteudo = unico('laudo');
    const c = ctx();
    const entrada = {
      conteudo,
      nomeOriginal: 'laudo.pdf',
      tipoMime: 'application/pdf',
      finalidade: 'laudo',
      entidade: 'estabelecimento',
      entidadeId: estabelecimento,
    };
    const g = await armazem.guardar(entrada, c);
    expect(g.reaproveitado).toBe(false);
    expect(g.chave).toMatch(
      new RegExp(`^sistema/${estabelecimento}/\\d{4}/\\d{2}/${g.hash.slice(0, 2)}/${g.hash}$`),
    );
    const caminho = await armazem.caminho(CLIENTE, g.chave);
    expect(caminho.startsWith(`${pasta.raiz}/cliente_`)).toBe(true);
    const linha = await umaLinha(
      'SELECT hash_sha256, tamanho_bytes, origem, criado_por FROM arquivo WHERE id = ?',
      [g.id],
    );
    expect(linha).toMatchObject({ hash_sha256: g.hash, origem: 'sistema' });
    expect(Number(linha!['tamanho_bytes'])).toBe(conteudo.byteLength);
    const trilha = await umaLinha(
      "SELECT acao FROM trilha_auditoria WHERE entidade = 'arquivo' AND entidade_id = ? AND correlacao = ?",
      [g.id, c.correlacao],
    );
    expect(trilha).toMatchObject({ acao: 'inclusao' });
    // Outra entrada com a mesma chave de idempotência: recusa (nunca grava outro registro).
    await expect(armazem.guardar({ ...entrada, nomeOriginal: 'outro.pdf' }, c)).rejects.toThrow(
      /idempotencia-divergente/,
    );
    const lido = await armazem.ler(leitura(), g.id);
    expect(lido.conteudo.equals(conteudo)).toBe(true);
    expect(lido.metadado).toMatchObject({ nomeOriginal: 'laudo.pdf', finalidade: 'laudo', imutavel: false });
    expect(await armazem.existe(leitura(), g.id)).toBe(true);
    expect(await armazem.verificar(leitura(), g.id)).toBe('integro');
    // A mesma chave de idempotência devolve o mesmo resultado sem gravar de novo.
    expect((await armazem.guardar(entrada, c)).id).toBe(g.id);
    // O mesmo conteúdo com outra chave reaproveita o registro.
    expect(
      (
        await armazem.guardar(
          { conteudo, nomeOriginal: 'copia.pdf', tipoMime: 'application/pdf', finalidade: 'laudo' },
          ctx(),
        )
      ).reaproveitado,
    ).toBe(true);
  });

  it('versão nova nunca apaga a anterior', async () => {
    const v1 = await armazem.guardar(
      {
        conteudo: unico('v1'),
        nomeOriginal: 'd.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_assinado',
      },
      ctx(),
    );
    const v2 = await armazem.guardar(
      {
        conteudo: unico('v2'),
        nomeOriginal: 'd.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_assinado',
      },
      ctx(),
    );
    expect(v2.id).not.toBe(v1.id);
    expect(await armazem.verificar(leitura(), v1.id)).toBe('integro');
    expect(await armazem.verificar(leitura(), v2.id)).toBe('integro');
  });

  it('exclusão recusada antes da guarda legal e para o imutável; depois dela, registro e arquivo saem', async () => {
    const retido = await armazem.guardar(
      {
        conteudo: unico('retido'),
        nomeOriginal: 'r.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_assinado',
        retencaoAte: '2046-11-21',
        imutavel: true,
      },
      ctx(),
    );
    await expect(armazem.excluir(retido.id, 1, ctx())).rejects.toThrow(/guarda legal/);
    const imutavel = await armazem.guardar(
      {
        conteudo: unico('imutavel'),
        nomeOriginal: 'i.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_assinado',
        imutavel: true,
      },
      ctx(),
    );
    await expect(armazem.excluir(imutavel.id, 1, ctx())).rejects.toThrow(/imutável/);
    const livre = await armazem.guardar(
      {
        conteudo: unico('anexo'),
        nomeOriginal: 'a.txt',
        tipoMime: 'text/plain',
        finalidade: 'anexo',
        retencaoAte: '2020-01-01',
      },
      ctx(),
    );
    const caminho = await armazem.caminho(CLIENTE, livre.chave);
    await armazem.excluir(livre.id, 1, ctx());
    expect(await armazem.metadado(leitura(), livre.id)).toBeNull();
    expect(await armazem.verificar(leitura(), livre.id)).toBe('sem_registro');
    await expect(armazem.ler(leitura(), livre.id)).rejects.toThrow(/registro-inexistente|não existe/);
    await expect(unlink(caminho)).rejects.toThrow(/ENOENT/);
    expect(await armazem.verificar(leitura(), retido.id)).toBe('integro');
  });

  it('o vigia aponta falta e divergência; a leitura recusa o arquivo adulterado', async () => {
    const some = await armazem.guardar(
      { conteudo: unico('some'), nomeOriginal: 's.txt', tipoMime: 'text/plain', finalidade: 'anexo' },
      ctx(),
    );
    const muda = await armazem.guardar(
      { conteudo: unico('muda'), nomeOriginal: 'm.txt', tipoMime: 'text/plain', finalidade: 'anexo' },
      ctx(),
    );
    // As listas do vigia têm no máximo 100 ids (o cliente de teste acumula arquivos de rodadas anteriores):
    // a prova é a situação de cada id e o aumento de 1 em cada total.
    const antes = await armazem.verificarCliente(leitura());
    await unlink(await armazem.caminho(CLIENTE, some.chave));
    const cm = await armazem.caminho(CLIENTE, muda.chave);
    await chmod(cm, 0o644);
    await writeFile(cm, 'adulterado');
    await expect(armazem.ler(leitura(), some.id)).rejects.toThrow(/arquivo-ausente/);
    await expect(armazem.ler(leitura(), muda.id)).rejects.toThrow(/arquivo-divergente/);
    const v = await armazem.verificarCliente(leitura());
    expect(await armazem.verificar(leitura(), some.id)).toBe('faltando');
    expect(await armazem.verificar(leitura(), muda.id)).toBe('divergente');
    expect(v.totalFaltando).toBe(antes.totalFaltando + 1);
    expect(v.totalDivergentes).toBe(antes.totalDivergentes + 1);
    expect(v.faltando.length).toBeLessThanOrEqual(100);
    expect(v.divergentes.length).toBeLessThanOrEqual(100);
    expect(v.conferidos).toBeGreaterThanOrEqual(v.integros + v.totalFaltando + v.totalDivergentes);
  });

  it('recusa entrada inválida antes de tocar o disco', async () => {
    await expect(
      armazem.guardar(
        { conteudo: unico('x'), nomeOriginal: 'x', tipoMime: 'sem-barra', finalidade: 'anexo' },
        ctx(),
      ),
    ).rejects.toThrow(/entrada-invalida/);
    await expect(
      armazem.guardar(
        { conteudo: Buffer.alloc(0), nomeOriginal: 'x', tipoMime: 'text/plain', finalidade: 'anexo' },
        ctx(),
      ),
    ).rejects.toThrow(/entrada-invalida/);
  });
});
