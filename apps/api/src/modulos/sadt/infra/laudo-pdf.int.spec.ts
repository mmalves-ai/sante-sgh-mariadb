// Laudo em PDF/A (ficha do M26, regra 11; seção 10 "Documento"): o laudo dos exames liberados, emitido pelo serviço de
// emissão do M09 (Gotenberg + S3 com Object Lock), com o código de autenticação e o QR da validação pública, passa no
// veraPDF (PDF/A-2b, 0 regra com falha), sai com "2ª via" na reemissão e tem o snapshot visual da primeira página
// (referência versionada em snapshots/sadt-laudo.pgm; SGH_ATUALIZAR_SNAPSHOT=sim regrava). Pela API (porta em memória):
// a emissão grava o laudo no novo, a 2ª via pede o motivo e a validação pública mostra só a emissão (sem conteúdo
// clínico). Serviços do Compose sgh (127.0.0.1); massa SINTÉTICA; nada sai da máquina. Fora do `pnpm verificar`.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sha256Hex } from '@sgh/dominio-documento';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { EmissaoService } from '../../documento/aplicacao/emissao.service.js';
import { gotenbergDisponivel } from '../../documento/infra/gotenberg.js';
import {
  compararSnapshot,
  metadadosPdf,
  pastaTemporaria,
  raiz,
  rasterizarPagina1,
  verapdf,
} from '../../documento/integracao.spec-util.js';
import { RegistroEmissoesMemoria } from '../../documento/infra/registro.js';
import { ClienteS3 } from '../../documento/infra/s3.js';
import { PortaDocumentosMemoria } from '../../pep/documentos-porta-memoria.js';
import { camposDoLaudo } from '../aplicacao/servico.js';
import { PortaSadtMemoria } from '../porta-memoria.js';

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m26-${Date.now()}`;
const CODIGO = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';

const s3 = new ClienteS3({ endpoint: S3, regiao: 'us-east-1' });
const servico = new EmissaoService({
  s3,
  bucket,
  gotenbergUrl: GOTENBERG,
  registro: new RegistroEmissoesMemoria(),
  retencao: { modo: 'GOVERNANCE', duracaoMs: 3 * 60_000 },
  produto: 'Produto de Teste',
  baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
  nomeEstabelecimento: (c) => `Estabelecimento Fictício ${c}`,
  raiz,
  agora: () => new Date('2026-10-22T12:00:00Z'),
});

const pedido = () => ({
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'sadt-laudo',
  versaoModelo: '1',
  titulo: 'Laudo de exames',
  origem: { tipo: 'sadt-laudo', idLegado: 1 },
  campos: camposDoLaudo(
    {
      paciente: { nome: 'PACIENTE FICTÍCIO SINTETICO', prontuario: 123 },
      atendimento: '31337',
      convenio: 'CONVÊNIO FICTÍCIO',
      exames: [
        {
          nome: 'POTÁSSIO SINTETICO',
          setor: 'Laboratório',
          data: '2026-10-22',
          liberadoEm: '2026-10-22T10:00:00',
          liberadoPor: 'RESPONSAVEL SINTETICO',
          valores: [{ elemento: 'POTÁSSIO', valor: '6,8', unidade: 'mEq/L', referencia: '3,5 a 5,1' }],
          texto: [],
          emissor: '',
        },
        {
          nome: 'ULTRASSONOGRAFIA DE ABDOME SINTETICO',
          setor: 'Imagem',
          data: '2026-10-22',
          liberadoEm: '2026-10-22T11:00:00',
          liberadoPor: 'MEDICO SINTETICO',
          valores: [],
          texto: ['Fígado de dimensões normais. Ação, pé, avó; “aspas” – € 1,50.'],
          emissor: 'MEDICO SINTETICO',
        },
      ],
    },
    CODIGO,
    '1ª via',
  ),
  autor: 'USUARIO_TESTE',
});

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m26-pdf-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('laudo em PDF/A (M26)', () => {
  it('PDF/A-2b sem falha no veraPDF, hash conferido, 2ª via marcada e o snapshot da primeira página', async () => {
    const p = pedido();
    const original = await servico.emitir(p);
    const segunda = await servico.segundaVia(original.emissao.id, 'Reimpressão para o paciente (teste)', p);
    expect(segunda.emissao.via).toBe(2);
    expect(await sha256Hex(await servico.lerPdf(original.emissao))).toBe(original.emissao.sha256);
    const r = verapdf(pasta, { 'laudo.pdf': original.pdf, 'laudo-2via.pdf': segunda.pdf });
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(r).toHaveLength(2);
    for (const x of r) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    expect(metadadosPdf(pasta, 'laudo.pdf')).toMatchObject({
      Title: 'Laudo de exames',
      Part: '2',
      Conformance: 'B',
    });
    expect(metadadosPdf(pasta, 'laudo-2via.pdf').Title).toBe('Laudo de exames - 2ª via');
    const s = compararSnapshot(
      rasterizarPagina1(pasta, 'snap-laudo', original.pdf),
      resolve(import.meta.dirname, 'snapshots/sadt-laudo.pgm'),
    );
    console.log(
      `[snapshot] laudo: ${s.criado ? 'referência gravada' : `${(s.fracao * 100).toFixed(2)}% dos pixels diferentes`}`,
    );
    expect(s.mesmoTamanho).toBe(true);
    expect(s.fracao).toBeLessThan(0.03);
  }, 300_000);
});

describe('emissão pela API (porta em memória, serviço de emissão do Compose)', () => {
  let app: NestFastifyApplication;
  const env: Record<string, string> = {
    ...envTeste,
    AMBIENTE: 'dev',
    S3_ENDPOINT: S3,
    GOTENBERG_URL: GOTENBERG,
    S3_BUCKET_DOCUMENTOS: bucket,
  };
  beforeAll(async () => {
    const trilha = new RegistradorTrilhaMemoria();
    const documentos = new PortaDocumentosMemoria(trilha, null);
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      documentos,
      sadt: new PortaSadtMemoria({ estado: () => 'verde' }, documentos),
      vigia: null,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('o laudo do liberado em PDF com o código; a 2ª via pede o motivo; a validação pública sem conteúdo clínico', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.BIOMEDICO', senha: SENHA },
    });
    const set = r.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '';
    let k = 0;
    const post = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/sadt/laudos',
        headers: { cookie, 'x-csrf': csrf, 'idempotency-key': `int-m26-laudo-${Date.now()}-${++k}` },
        payload,
      });
    const liberados = (
      await app.inject({
        method: 'GET',
        url: '/api/sadt/exames?setor=laboratorio&situacao=liberados',
        headers: { cookie },
      })
    ).json().itens as { id: number; paciente: { nome: string } }[];
    const exame = liberados.find((x) => x.paciente.nome.includes('CINTHYA'))!;
    const um = await post({ exames: [exame.id] });
    expect(um.statusCode).toBe(200);
    expect(um.json().codigo).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Buffer.from(um.json().pdf, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await post({ exames: [exame.id] })).json().codigo).toBe('laudo-emitido');
    expect((await post({ exames: [exame.id], segundaVia: true })).statusCode).toBe(400);
    const via = await post({
      exames: [exame.id],
      segundaVia: true,
      motivoSegundaVia: 'Reimpressão para o paciente',
    });
    expect(via.statusCode).toBe(200);
    expect(via.json().codigo).toBe(um.json().codigo);
    const v = (await app.inject({ method: 'GET', url: `/api/portal/aa/validar/${um.json().codigo}` })).json();
    expect(v).toMatchObject({ valido: true, exames: 1 });
    expect(JSON.stringify(v)).not.toMatch(/CINTHYA|SÓDIO|140/);
  }, 120_000);
});
