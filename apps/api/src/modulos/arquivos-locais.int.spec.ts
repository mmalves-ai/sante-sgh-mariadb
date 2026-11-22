// Integração dos armazéns dos módulos (fotos da higienização e da portaria, digitalização certificada, provas do portal)
// sobre a porta de arquivos do núcleo (ADR 0004) contra o MariaDB real: o cliente de teste (SGH_CLIENTE_TESTE, padrão
// teste_nucleo) e uma pasta temporária como ARQUIVOS_RAIZ. Contrato de efeito: o arquivo no disco sob a pasta do banco,
// o registro em `arquivo` (finalidade, tipo, hash, retenção), a chave do módulo com o id, a leitura conferida, o
// isolamento por estabelecimento e a exclusão da foto vencida. Conteúdo sintético. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArmazemArquivosLocal,
  criarPastaArquivosTeste,
  NucleoProprio,
  type PastaArquivosTeste,
  pastaDoBanco,
  sha256,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armazemFotosLocal, type ArmazemFotos, CHAVE_FOTO } from './adt/fotos.js';
import { type ArquivosDoModulo, arquivosDoAmbiente, arquivosDoModulo, idNaChave } from './arquivos-locais.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from './cadastro/contexto-nucleo.js';
import {
  armazemDigitalizacaoLocal,
  type ArmazemDigitalizacao,
  CHAVE_DIGITALIZACAO,
} from './digitalizacao/armazem.js';
import { armazemProvasLocal, type ArmazemProvas, CHAVE_PROVA } from './portal-paciente/aplicacao/provas.js';
import {
  armazemFotosPortariaLocal,
  type ArmazemFotosPortaria,
  CHAVE_FOTO_VISITANTE,
} from './portaria/fotos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const H1 = 'tarqmod1';
const H2 = 'tarqmod2';

const JPEG = (rotulo: string) =>
  new Uint8Array(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${rotulo} ${randomUUID()}`)]),
  );
const PDF = (rotulo: string) =>
  new Uint8Array(Buffer.from(`%PDF-1.4\n% ${rotulo} sintetico ${randomUUID()}\n%%EOF\n`));

describe.skipIf(SEM_BANCO)(`armazéns dos módulos no disco local (cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let pasta: PastaArquivosTeste;
  let banco = '';
  let arquivos: ArquivosDoModulo;
  let fotos: ArmazemFotos;
  let portaria: ArmazemFotosPortaria;
  let digitalizacao: ArmazemDigitalizacao;
  let provas: ArmazemProvas;
  let provasGuarda: ArmazemProvas;
  const linha = (id: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-arq-mod' }, (l) =>
      l.uma<Record<string, unknown>>(
        `SELECT finalidade, tipo_mime, hash_sha256, retencao_ate, chave_armazenamento, estabelecimento_id, excluido_em
           FROM arquivo WHERE id = ?`,
        [id],
      ),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    pasta = await criarPastaArquivosTeste(CLIENTE);
    banco = (await nucleo.cliente(CLIENTE)).banco;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-arq-mod' }, async (e) => {
      for (const codigo of [H1, H2])
        if (!(await e.uma('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo])))
          await e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
            [codigo, `Estabelecimento ${codigo}`, `Estabelecimento de teste ${codigo}`, new Date()],
          );
    });
    desligarMapaEstabelecimentos();
    await ligarMapaEstabelecimentos(CLIENTE, nucleo);
    arquivos = arquivosDoAmbiente(nucleo, CLIENTE, {}, pasta.raiz)!;
    fotos = armazemFotosLocal(arquivos);
    portaria = armazemFotosPortariaLocal(arquivos);
    digitalizacao = armazemDigitalizacaoLocal(arquivos, { AMBIENTE: 'producao' });
    provas = armazemProvasLocal(arquivos, { AMBIENTE: 'ci' });
    provasGuarda = armazemProvasLocal(arquivos, { AMBIENTE: 'producao' });
  });

  afterAll(async () => {
    desligarMapaEstabelecimentos();
    await pasta?.apagar();
    await nucleo?.encerrar();
  });

  it('foto da higienização: chave do módulo com o id, arquivo no disco, registro e leitura conferida', async () => {
    const bytes = JPEG('higienizacao');
    const chave = await fotos.guardar(H1, 'image/jpeg', bytes);
    expect(chave).toMatch(CHAVE_FOTO);
    const id = Number(/arquivo-(\d+)-/.exec(chave)![1]);
    const l = await linha(id);
    expect(l).toMatchObject({
      finalidade: 'foto_higienizacao',
      tipo_mime: 'image/jpeg',
      hash_sha256: sha256(bytes),
    });
    expect(existsSync(join(pasta.raiz, pastaDoBanco(banco), String(l!['chave_armazenamento'])))).toBe(true);
    const lido = await fotos.ler(H1, chave);
    expect(lido?.tipo).toBe('image/jpeg');
    expect(Buffer.from(lido!.bytes).equals(Buffer.from(bytes))).toBe(true);
    // Outro estabelecimento não lê; chave fora do formato também não.
    expect(await fotos.ler(H2, chave)).toBeNull();
    expect(await fotos.ler(H1, 'higienizacao/arquivo-999999999.jpg')).toBeNull();
    // O id sozinho (adivinhável) ou com outro sinal não lê.
    expect(await fotos.ler(H1, `higienizacao/arquivo-${id}.jpg`)).toBeNull();
    const sinal = /-([a-f0-9]{24})\./.exec(chave)![1]!;
    const outro = `${sinal[0] === '0' ? '1' : '0'}${sinal.slice(1)}`;
    expect(await fotos.ler(H1, chave.replace(sinal, outro))).toBeNull();
    expect(await fotos.ler(H1, '../arquivo-1.jpg')).toBeNull();
  });

  it('o mesmo conteúdo reaproveita o registro (nunca duas cópias)', async () => {
    const bytes = JPEG('repetida');
    const a = await fotos.guardar(H1, 'image/jpeg', bytes);
    const b = await fotos.guardar(H1, 'image/jpeg', bytes);
    expect(b).toBe(a);
  });

  it('foto do visitante: a mesma foto em outro cadastro é recusada e a remoção não apaga a do outro', async () => {
    const bytes = JPEG('dois-visitantes');
    const a = await portaria.guardar(H1, 'image/jpeg', bytes);
    await expect(portaria.guardar(H1, 'image/jpeg', bytes)).rejects.toMatchObject({
      extras: { codigo: 'foto-repetida' },
    });
    expect((await portaria.ler(H1, a))?.tipo).toBe('image/jpeg');
    // Removida (retenção vencida), o reenvio do mesmo conteúdo reativa o registro e a foto volta a ser lida.
    await portaria.remover(H1, a);
    expect(await portaria.ler(H1, a)).toBeNull();
    const b = await portaria.guardar(H1, 'image/jpeg', bytes);
    expect(Buffer.from((await portaria.ler(H1, b))!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect((await linha(idNaChave(b)!))?.['excluido_em']).toBeNull();
  });

  it('o mesmo conteúdo em outro mês vira outro registro (sem conflito de idempotência)', async () => {
    const bytes = JPEG('outro-mes');
    const a = await portaria.guardar(H1, 'image/jpeg', bytes);
    const adiante = new ArmazemArquivosLocal({
      raiz: pasta.raiz,
      executor: nucleo.criarExecutor(),
      ler: (c, fn) => nucleo.lerSomente(c, fn),
      bancoDoCliente: async (c) => (await nucleo.cliente(c)).banco,
      agora: () => new Date(Date.now() + 40 * 86_400_000),
    });
    const depois = armazemFotosPortariaLocal(arquivosDoModulo(adiante, CLIENTE, nucleo.criarExecutor()));
    const b = await depois.guardar(H1, 'image/jpeg', bytes);
    expect(idNaChave(b)).not.toBe(idNaChave(a));
    expect((await portaria.ler(H1, a))?.tipo).toBe('image/jpeg');
  });

  it('estabelecimento fora do mapa do cliente: recusa guardar e ler (falha fechada)', async () => {
    const chave = await portaria.guardar(H1, 'image/jpeg', JPEG('mapa'));
    const fora = { tipo: 'sem-permissao', extras: { codigo: 'estabelecimento-fora-do-mapa' } };
    await expect(
      arquivos.guardar('tarqsemmapa', {
        conteudo: JPEG('x'),
        nomeOriginal: 'x.jpg',
        tipoMime: 'image/jpeg',
        finalidade: 'foto_visitante',
      }),
    ).rejects.toMatchObject(fora);
    await expect(portaria.ler('tarqsemmapa', chave)).rejects.toMatchObject(fora);
    await expect(arquivos.metadado('', idNaChave(chave)!)).rejects.toMatchObject(fora);
  });

  it('foto do visitante: guarda, lê e, vencida a retenção, exclui registro e arquivo', async () => {
    const chave = await portaria.guardar(H1, 'image/jpeg', JPEG('visitante'));
    expect(chave).toMatch(CHAVE_FOTO_VISITANTE);
    const id = idNaChave(chave)!;
    const antes = await linha(id);
    expect(antes).toMatchObject({ finalidade: 'foto_visitante', retencao_ate: null, excluido_em: null });
    expect((await portaria.ler(H1, chave))?.tipo).toBe('image/jpeg');
    await portaria.remover(H1, chave);
    const depois = await linha(id);
    expect(depois?.['excluido_em']).not.toBeNull();
    expect(existsSync(join(pasta.raiz, pastaDoBanco(banco), String(antes!['chave_armazenamento'])))).toBe(
      false,
    );
    expect(await portaria.ler(H1, chave)).toBeNull();
    // A foto de outra finalidade não é removida pela portaria.
    const outra = await fotos.guardar(H1, 'image/jpeg', JPEG('nao-e-visitante'));
    const idOutra = Number(/arquivo-(\d+)-/.exec(outra)![1]);
    await portaria.remover(H1, `visitante/arquivo-${idOutra}.jpg`);
    expect((await linha(idOutra))?.['excluido_em']).toBeNull();
  });

  it('PDF da digitalização: guarda legal de 20 anos só depois do COMMIT (fixar), hash conferido e leitura', async () => {
    const pdf = PDF('digitalizacao');
    const hash = sha256(pdf);
    const chave = await digitalizacao.guardar(H1, pdf, hash);
    expect(chave).toMatch(CHAVE_DIGITALIZACAO);
    const l = await linha(idNaChave(chave)!);
    expect(l).toMatchObject({
      finalidade: 'documento_digitalizado',
      tipo_mime: 'application/pdf',
      hash_sha256: hash,
    });
    expect(l!['retencao_ate']).toBeNull();
    await digitalizacao.fixar(H1, chave);
    const r = (await linha(idNaChave(chave)!))!['retencao_ate'];
    const ano = Number((r instanceof Date ? r.toISOString() : String(r)).slice(0, 4));
    expect(ano).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 19);
    await digitalizacao.fixar(H1, chave); // de novo: nada a fazer
    await expect(arquivos.excluir(H1, idNaChave(chave)!)).rejects.toMatchObject({
      problema: { codigo: 'arquivo-retido' },
    });
    // A tentativa sem COMMIT (sem fixar) não fica presa pela guarda: pode ser excluída.
    const pdf2 = PDF('tentativa-recusada');
    const c2 = await digitalizacao.guardar(H1, pdf2, sha256(pdf2));
    await arquivos.excluir(H1, idNaChave(c2)!);
    expect((await linha(idNaChave(c2)!))?.['excluido_em']).not.toBeNull();
    const lido = await digitalizacao.ler(H1, chave);
    expect(Buffer.from(lido!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256(lido!)).toBe(hash);
    await expect(digitalizacao.guardar(H1, pdf, 'a'.repeat(64))).rejects.toThrow(/não confere/);
    expect(await digitalizacao.ler(H2, chave)).toBeNull();
  });

  it('prova do portal: chave secreta (id + sinal), PDF e imagem, sinal errado não lê', async () => {
    const pdf = PDF('prova');
    const chave = await provas.guardar(H1, 'application/pdf', pdf);
    expect(chave).toMatch(CHAVE_PROVA);
    const lido = await provas.ler(H1, chave);
    expect(lido?.tipo).toBe('application/pdf');
    expect(sha256(lido!.bytes)).toBe(sha256(pdf));
    // O mesmo conteúdo devolve a mesma chave (o sinal do registro existente).
    expect(await provas.guardar(H1, 'application/pdf', pdf)).toBe(chave);
    // Sinal trocado, extensão trocada ou outro estabelecimento: nada.
    const trocado = `${chave.slice(0, 30)}${chave[30] === '0' ? '1' : '0'}${chave.slice(31)}`;
    expect(await provas.ler(H1, trocado)).toBeNull();
    expect(await provas.ler(H1, chave.replace(/-pdf$/, '-png'))).toBeNull();
    expect(await provas.ler(H2, chave)).toBeNull();
    const img = await provas.guardar(
      H1,
      'image/png',
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Buffer.from(randomUUID())]),
    );
    expect(img).toMatch(/-png$/);
    expect((await provas.ler(H1, img))?.tipo).toBe('image/png');
    // Fora de dev/ci, a retenção da prova (5 anos) vai no registro.
    const g = await provasGuarda.guardar(H1, 'application/pdf', PDF('prova-guarda'));
    const id = Number.parseInt(g.slice(14, 22), 16);
    expect((await linha(id))?.['retencao_ate']).not.toBeNull();
    expect((await linha(Number.parseInt(chave.slice(14, 22), 16)))?.['retencao_ate']).toBeNull();
  });
});
