// Regra 9 e seção 10 da ficha do M09 (integração): Gotenberg + veraPDF + porta de arquivos do núcleo (ADR 0004: disco
// local numa pasta temporária, registro na tabela `arquivo` do cliente de teste SGH_CLIENTE_TESTE): emitir, conferir
// hash, arquivo somente leitura e nunca sobrescrito, guarda legal que recusa a exclusão, 2ª via; fila zpl idempotente
// no Valkey. Serviços do Compose sgh (127.0.0.1), massa sintética; nada sai da máquina.
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { caminhoDoArquivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria, enfileirarZpl, sha256Hex, zplPulseira } from '@sgh/dominio-documento';
import { EmissaoService } from './aplicacao/emissao.service.js';
import { gotenbergDisponivel } from './infra/gotenberg.js';
import { RegistroEmissoesMemoria } from './infra/registro.js';
import { arquivosDeTeste } from './integracao.spec-util.js';
import { ArmazemValkey, FilaZplValkey } from './infra/valkey.js';
import { resolve } from 'node:path';
import {
  compararSnapshot,
  metadadosPdf,
  pastaTemporaria,
  raiz,
  rasterizarPagina1,
  verapdf,
} from './integracao.spec-util.js';

const GOTENBERG = 'http://127.0.0.1:3318';
const VALKEY = 'redis://127.0.0.1:63718';

const arquivos = arquivosDeTeste();
const registro = new RegistroEmissoesMemoria();
const conversoes: number[] = [];
const servico = new EmissaoService({
  armazem: arquivos.armazem,
  cliente: arquivos.cliente,
  gotenbergUrl: GOTENBERG,
  registro,
  retencao: { imutavel: false, duracaoMs: 86_400_000 },
  produto: 'Produto de Teste',
  baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
  nomeEstabelecimento: (c) => `Estabelecimento Fictício ${c}`,
  raiz,
  aoConverter: (ms) => conversoes.push(ms),
});
const pedido = {
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'prova',
  versaoModelo: '1',
  titulo: 'Documento de prova',
  origem: { tipo: 'sintetico', idLegado: 1 },
  campos: [
    { rotulo: 'Paciente', valor: 'Paciente Fictício de Teste' },
    { rotulo: 'Texto', valor: 'ação, coração, Ü, €, “aspas”, ½ (CP1252)' },
  ],
  autor: 'USUARIO_TESTE',
};
let pasta: string;

beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  await arquivos.preparar();
  pasta = pastaTemporaria('m09-pdf-');
});
afterAll(async () => {
  rmSync(pasta, { recursive: true, force: true });
  await arquivos.encerrar();
});

describe('documento PDF/A na porta de arquivos (disco local)', () => {
  it('o PDF fica somente leitura na pasta do banco do cliente, com o registro e a guarda legal', async () => {
    const e = await servico.emitir(pedido);
    const meta = await arquivos.armazem.metadado(arquivos.contexto(), Number(e.versaoS3));
    expect(meta).toMatchObject({
      hash: e.emissao.sha256,
      tipoMime: 'application/pdf',
      finalidade: 'documento_emitido',
      imutavel: false,
      origem: 'sistema',
    });
    expect(meta!.retencaoAte! > new Date().toISOString().slice(0, 10)).toBe(true);
    const caminho = caminhoDoArquivo(arquivos.local().raiz, await arquivos.banco(), meta!.chave);
    expect((await stat(caminho)).mode & 0o777).toBe(0o444);
    expect(await arquivos.armazem.verificar(arquivos.contexto(), meta!.id)).toBe('integro');
  });

  it('emite original e 2ª via: PDF/A-2b sem erro no veraPDF, hash conferido, via marcada, original intacto', async () => {
    const original = await servico.emitir(pedido);
    const segunda = await servico.segundaVia(original.emissao.id, 'Extravio do original (teste)', pedido);
    const terceira = await servico.segundaVia(original.emissao.id, 'Segundo pedido de teste', pedido);
    expect([original.emissao.via, segunda.emissao.via, terceira.emissao.via]).toEqual([1, 2, 3]);
    expect(segunda.emissao).toMatchObject({
      idOriginal: original.emissao.id,
      motivoReemissao: 'Extravio do original (teste)',
    });
    expect(segunda.emissao.chaveObjeto).not.toBe(original.emissao.chaveObjeto);

    for (const e of [original, segunda, terceira]) {
      // Leitura sempre pelo arquivo do registro, conferida pelo hash.
      expect(e.emissao.versaoS3).toBe(e.versaoS3);
      const guardado = await servico.lerPdf(e.emissao);
      expect(await sha256Hex(guardado)).toBe(e.emissao.sha256);
    }
    const resultados = verapdf(pasta, {
      'original.pdf': original.pdf,
      'segunda-via.pdf': segunda.pdf,
      'terceira-via.pdf': terceira.pdf,
    });
    console.log(
      `[veraPDF] ${resultados.map((r) => `${r.arquivo}: ${r.conforme ? 'PASS' : 'FAIL'} (${r.regrasFalhas} regras, ${r.checagensFalhas} checagens com falha)`).join('; ')}`,
    );
    for (const r of resultados)
      expect(r).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    expect(metadadosPdf(pasta, 'original.pdf')).toMatchObject({
      Title: 'Documento de prova',
      Part: '2',
      Conformance: 'B',
    });
    expect(metadadosPdf(pasta, 'segunda-via.pdf')).toMatchObject({ Title: 'Documento de prova - 2ª via' });
    expect(metadadosPdf(pasta, 'terceira-via.pdf').Keywords).toContain('via=3');
    console.log(
      `[gotenberg] ${conversoes.length} conversões; maior ${Math.round(Math.max(...conversoes))} ms`,
    );
  });

  it('snapshot visual do documento de prova e p95 da conversão no Gotenberg', async () => {
    // Data fixa: só o QR (aleatório por emissão) muda entre a página e a referência.
    const fixo = new EmissaoService({
      armazem: arquivos.armazem,
      cliente: arquivos.cliente,
      gotenbergUrl: GOTENBERG,
      registro: new RegistroEmissoesMemoria(),
      retencao: { imutavel: false, duracaoMs: 86_400_000 },
      produto: 'Produto de Teste',
      baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
      nomeEstabelecimento: (c) => `Estabelecimento Fictício ${c}`,
      raiz,
      agora: () => new Date('2026-10-20T12:00:00Z'),
    });
    const tempos: number[] = [];
    let ultimo: Uint8Array | null = null;
    for (let i = 0; i < 20; i++) {
      const e = await fixo.emitir(pedido);
      tempos.push(e.conversaoMs);
      ultimo = e.pdf;
    }
    const ordenados = [...tempos].sort((a, b) => a - b);
    const p = (q: number) =>
      Math.round(ordenados[Math.min(ordenados.length - 1, Math.floor(q * ordenados.length))]!);
    console.log(`[gotenberg] 20 conversões: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, maior ${p(1)} ms`);
    expect(p(0.95)).toBeLessThan(5_000);
    const r = compararSnapshot(
      rasterizarPagina1(pasta, 'snapshot', ultimo!),
      resolve(import.meta.dirname, 'snapshots/documento-prova.pgm'),
    );
    console.log(
      `[snapshot] documento de prova: ${r.criado ? 'referência gravada' : `${r.diferentes} de ${r.total} pixels diferentes (${(r.fracao * 100).toFixed(2)}%)`}`,
    );
    expect(r.mesmoTamanho).toBe(true);
    expect(r.fracao).toBeLessThan(0.03);
  });

  it('sobrescrita recusada: o arquivo não se regrava e o mesmo conteúdo reaproveita o registro', async () => {
    const e = await servico.emitir(pedido);
    const id = Number(e.versaoS3);
    const meta = (await arquivos.armazem.metadado(arquivos.contexto(), id))!;
    const caminho = caminhoDoArquivo(arquivos.local().raiz, await arquivos.banco(), meta.chave);
    await expect(writeFile(caminho, 'adulterado')).rejects.toThrow();
    const ctx = { ...arquivos.contexto(), chaveIdempotencia: `teste-${randomUUID()}` };
    const deNovo = await arquivos.armazem.guardar(
      {
        conteudo: e.pdf,
        nomeOriginal: 'prova.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_emitido',
      },
      ctx,
    );
    expect(deNovo).toMatchObject({ id, reaproveitado: true });
    expect(await sha256Hex(await servico.lerPdf(e.emissao))).toBe(e.emissao.sha256);
  });

  it('guarda legal: a exclusão é recusada antes da data e o PDF continua legível', async () => {
    const e = await servico.emitir(pedido);
    const id = Number(e.versaoS3);
    const meta = (await arquivos.armazem.metadado(arquivos.contexto(), id))!;
    const ctx = { ...arquivos.contexto(), chaveIdempotencia: `teste-${randomUUID()}` };
    await expect(arquivos.armazem.excluir(id, meta.versao, ctx)).rejects.toThrow(/guarda legal/);
    expect(await sha256Hex(await servico.lerPdf(e.emissao))).toBe(e.emissao.sha256);
  });

  it('validação pública pelo QR: só existência, data, estabelecimento, hash e via', async () => {
    const e = await servico.emitir(pedido);
    const v = await servico.validar(e.emissao.identificadorQr);
    expect(v).toEqual({
      existe: true,
      emitidoEm: e.emissao.emitidoEm,
      estabelecimento: 'Estabelecimento Fictício zz',
      sha256: e.emissao.sha256,
      via: 1,
    });
    expect(await servico.validar('A'.repeat(22))).toEqual({ existe: false });
    await expect(servico.segundaVia(e.emissao.id, 'x', pedido)).rejects.toThrow(/motivo/);
    await expect(servico.segundaVia(randomUUID(), 'Motivo de teste', pedido)).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe('fila zpl idempotente no Valkey', () => {
  it('mesma Idempotency-Key = um trabalho só (Valkey SET NX)', async () => {
    const armazem = new ArmazemValkey(VALKEY);
    const enviados: string[] = [];
    const destino = { enviar: async (t: { id: string }) => void enviados.push(t.id) };
    const zpl = zplPulseira({
      nomeCompleto: 'Paciente Ficticio',
      nascimento: '1980-05-17',
      idPaciente: 1,
      prontuario: 1,
      atendimento: 1,
    });
    const chave = `teste-m09-${randomUUID()}`;
    const trabalho = {
      chaveIdempotencia: chave,
      rede: 'rede-teste',
      estabelecimento: 'zz',
      estacao: 'e1',
      modelo: 'pulseira' as const,
      zpl,
    };
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => enfileirarZpl(trabalho, armazem, destino, () => randomUUID())),
    );
    expect(resultados.filter((r) => r.novo)).toHaveLength(1);
    expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    expect(enviados).toHaveLength(1);
    // Fila de verdade: o trabalho entra uma vez na lista da estação, com o ZPL.
    const fila = new FilaZplValkey(VALKEY);
    const estacao = { rede: 'rede-teste', estabelecimento: 'zz', estacao: `e-${randomUUID().slice(0, 8)}` };
    const comFila = await Promise.all(
      Array.from({ length: 3 }, () =>
        enfileirarZpl({ ...trabalho, ...estacao, chaveIdempotencia: `${chave}-fila` }, armazem, fila, () =>
          randomUUID(),
        ),
      ),
    );
    expect(comFila.filter((r) => r.novo)).toHaveLength(1);
    expect(await fila.tamanho(estacao)).toBe(1);
    const item = await fila.retirar(estacao);
    expect(item).toMatchObject({ id: comFila.find((r) => r.novo)!.id, modelo: 'pulseira', zpl });
    expect(await fila.tamanho(estacao)).toBe(0);
    // Envio falhou: a reserva no Valkey é desfeita (comparar e apagar) e a nova tentativa cria o trabalho.
    const chaveFalha = `${chave}-falha`;
    const quebrado = { enviar: async () => Promise.reject(new Error('fila fora')) };
    await expect(
      enfileirarZpl({ ...trabalho, chaveIdempotencia: chaveFalha }, armazem, quebrado, () => 'f1'),
    ).rejects.toThrow('fila fora');
    const depois = await enfileirarZpl(
      { ...trabalho, chaveIdempotencia: chaveFalha },
      armazem,
      destino,
      () => 'f2',
    );
    expect(depois).toEqual({ id: 'f2', novo: true });
    // Mesmo comportamento no armazém de memória (dev sem Valkey).
    const mem = new ArmazemMemoria();
    const a = await enfileirarZpl(trabalho, mem, destino, () => 'x1');
    const b = await enfileirarZpl(trabalho, mem, destino, () => 'x2');
    expect([a.novo, b.novo, b.id]).toEqual([true, false, 'x1']);
  });
});
