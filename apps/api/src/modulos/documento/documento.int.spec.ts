// Regra 9 e seção 10 da ficha do M09 (integração): Gotenberg + veraPDF + S3 com Object Lock em contêiner:
// emitir, conferir hash, recusar sobrescrita, 2ª via; fila zpl idempotente no Valkey. Serviços do Compose
// sgh (127.0.0.1), massa sintética; nada sai da máquina. O bucket é novo por execução (os vencidos de execuções anteriores são apagados no início), com retenção
// GOVERNANCE curta (dev) e um objeto COMPLIANCE de prova: os dois expiram em minutos.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria, enfileirarZpl, sha256Hex, zplPulseira } from '@sgh/dominio-documento';
import { EmissaoService } from './aplicacao/emissao.service.js';
import { gotenbergDisponivel } from './infra/gotenberg.js';
import { RegistroEmissoesMemoria } from './infra/registro.js';
import { ClienteS3, ErroS3 } from './infra/s3.js';
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

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const VALKEY = 'redis://127.0.0.1:63718';
const bucket = `sgh-teste-m09-${Date.now()}`;

// Os buckets de teste levam objetos com Object Lock (retenção de minutos), que nem o próprio teste pode
// apagar ao terminar. Antes de criar o novo, apaga os de execuções anteriores com a retenção vencida (mais
// de 10 min), pelo console de administração do SeaweedFS no container do projeto. Sem isso, cada execução
// deixa um bucket e o teto de volumes do sgh-s3 (infra/compose/dev.yml) lota.
function limparBucketsDeTesteVencidos(): void {
  const limite = Date.now() - 10 * 60_000;
  const weed = (comando: string): string =>
    execFileSync('docker', ['exec', '-i', 'sgh-s3', 'weed', 'shell'], {
      input: `${comando}\n`,
      encoding: 'utf8',
    });
  const vencidos = [...weed('s3.bucket.list').matchAll(/sgh-teste-m09-(\d+)/g)]
    .filter((m) => Number(m[1]) < limite)
    .map((m) => m[0]);
  for (const nome of new Set(vencidos)) weed(`s3.bucket.delete -name=${nome}`);
}
const s3 = new ClienteS3({ endpoint: S3, regiao: 'us-east-1' });
const registro = new RegistroEmissoesMemoria();
const conversoes: number[] = [];
const servico = new EmissaoService({
  s3,
  bucket,
  gotenbergUrl: GOTENBERG,
  registro,
  retencao: { modo: 'GOVERNANCE', duracaoMs: 3 * 60_000 },
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
  limparBucketsDeTesteVencidos();
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m09-pdf-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('documento PDF/A no S3 com Object Lock', () => {
  it('bucket com Object Lock e versionamento', async () => {
    expect(await s3.travaDoBucket(bucket)).toEqual({ habilitada: true, versionamento: true });
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
      // Leitura sempre pela versão do registro (nunca a "mais recente" da chave).
      expect(e.emissao.versaoS3).toBe(e.versaoS3);
      const guardado = await servico.lerPdf(e.emissao);
      expect(await sha256Hex(guardado)).toBe(e.emissao.sha256);
      const ret = await s3.retencao(bucket, e.emissao.chaveObjeto, e.versaoS3);
      expect(ret.modo).toBe('GOVERNANCE');
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
      s3,
      bucket,
      gotenbergUrl: GOTENBERG,
      registro: new RegistroEmissoesMemoria(),
      retencao: { modo: 'GOVERNANCE', duracaoMs: 3 * 60_000 },
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

  it('sobrescrita recusada: versão protegida não se apaga e o original continua igual', async () => {
    const e = await servico.emitir(pedido);
    const chave = e.emissao.chaveObjeto;
    expect(await s3.existe(bucket, chave)).toBe(true);
    // Mesmo um PUT direto na chave (fora da aplicação) só cria versão nova: a protegida continua lá.
    await s3.gravarSemRetencao(bucket, chave, new TextEncoder().encode('adulterado'));
    expect(await sha256Hex(await s3.ler(bucket, chave, e.versaoS3))).toBe(e.emissao.sha256);
    expect((await s3.versoes(bucket, chave)).length).toBe(2);
    await expect(s3.apagarVersao(bucket, chave, e.versaoS3)).rejects.toBeInstanceOf(ErroS3);
    expect(await sha256Hex(await s3.ler(bucket, chave, e.versaoS3))).toBe(e.emissao.sha256);
  });

  it('COMPLIANCE: nem apagar com bypass nem encurtar a retenção', async () => {
    const chave = `rede-teste/zz/documentos/prova/${randomUUID()}/via-1.pdf`;
    const ate = new Date(Date.now() + 3 * 60_000);
    const { versao } = await s3.gravarComRetencao(
      bucket,
      chave,
      new TextEncoder().encode('%PDF-teste'),
      'application/pdf',
      'COMPLIANCE',
      ate,
    );
    await expect(s3.apagarVersao(bucket, chave, versao!, true)).rejects.toBeInstanceOf(ErroS3);
    await expect(
      s3.encurtarRetencao(bucket, chave, versao!, 'COMPLIANCE', new Date(Date.now() + 60_000)),
    ).rejects.toBeInstanceOf(ErroS3);
    expect((await s3.retencao(bucket, chave, versao!)).modo).toBe('COMPLIANCE');
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
