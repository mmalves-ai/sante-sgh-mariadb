// Prescrição impressa em PDF/A (ficha do M24, seção 10 "Documento"): a prescrição com os horários previstos, emitida
// pelo serviço de emissão do M09 (Gotenberg + S3 com Object Lock), com o corpus CP1252 na observação para a
// enfermagem, passa no veraPDF (PDF/A-2b, 0 regra com falha), sai com "2ª via" na reimpressão e tem o snapshot visual
// da primeira página (referência versionada em snapshots/pep-prescricao.pgm; SGH_ATUALIZAR_SNAPSHOT=sim regrava).
// Serviços do Compose sgh (127.0.0.1); massa SINTÉTICA; nada sai da máquina. Fora do `pnpm verificar`: roda pelo
// `testes:integracao` da API, com `./pnpm infra:subir` no ar.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { camposDoDocumentoPep, sha256Hex, TITULOS_PEP } from '@sgh/dominio-documento';
import { linhasDaPrescricaoImpressa } from '@sgh/dominio-pep';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import { EmissaoService } from '../documento/aplicacao/emissao.service.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { RegistroEmissoesMemoria } from '../documento/infra/registro.js';
import { ClienteS3 } from '../documento/infra/s3.js';
import {
  compararSnapshot,
  metadadosPdf,
  pastaTemporaria,
  raiz,
  rasterizarPagina1,
  verapdf,
} from '../documento/integracao.spec-util.js';
import { criarAppPep } from './teste.spec-util.js';

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m09-${Date.now()}`;
const CORPUS = 'Ação, pé, avó, Ü; “aspas” – € 1,50; 1º, 2ª; ½ dose.';

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
  agora: () => new Date('2026-10-21T12:00:00Z'),
});

const h = (dataHora: string, rotulo = 'Prescrito') => ({ dataHora, rotulo });
const pedido = () => ({
  rede: 'rede-teste',
  estabelecimento: 'zz',
  modelo: 'prescricao',
  versaoModelo: '1',
  titulo: TITULOS_PEP.prescricao,
  origem: { tipo: 'prescricao', idLegado: 1 },
  campos: camposDoDocumentoPep({
    modelo: 'prescricao',
    identificacao: {
      paciente: 'PACIENTE FICTÍCIO SINTETICO',
      prontuario: '000123',
      nascimento: '01/01/1980',
      atendimento: '31337',
      profissional: 'PROFISSIONAL FICTÍCIO SINTETICO',
      conselho: null,
      dataHora: '21/10/2026 15:40',
    },
    corpo: linhasDaPrescricaoImpressa(
      [
        {
          tipoNome: 'Medicamento',
          descricao: 'DIPIRONA SINTETICO 500 MG/ML',
          dose: '2 ML',
          via: 'Endovenosa',
          frequencia: '06/06',
          situacao: 'ativo',
          incluidoDepois: false,
          observacaoEnfermagem: CORPUS,
          horarios: [
            h('2026-10-21T18:00:00'),
            h('2026-10-22T00:00:00'),
            h('2026-10-22T06:00:00'),
            h('2026-10-22T12:00:00'),
          ],
        },
        {
          tipoNome: 'Cuidado',
          descricao: 'CONTROLE DE SINAIS VITAIS SINTETICO',
          dose: null,
          via: null,
          frequencia: '08/08',
          situacao: 'suspenso',
          incluidoDepois: true,
          observacaoEnfermagem: null,
          horarios: [h('2026-10-21T22:00:00', 'Suspenso'), h('2026-10-22T06:00:00', 'Suspenso')],
        },
      ],
      null,
    ),
    extras: [
      { rotulo: 'Vigência', valor: '2026-10-21 16:01 a 2026-10-22 16:00' },
      { rotulo: 'Situação', valor: 'Vigente' },
    ],
  }),
  autor: 'USUARIO_TESTE',
});

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m24-pdf-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('prescrição impressa em PDF/A (M24)', () => {
  it('PDF/A-2b sem falha no veraPDF, hash conferido, 2ª via marcada e o snapshot da primeira página', async () => {
    const p = pedido();
    const original = await servico.emitir(p);
    const segunda = await servico.segundaVia(original.emissao.id, 'Reimpressão para a enfermagem (teste)', p);
    expect(segunda.emissao.via).toBe(2);
    expect(await sha256Hex(await servico.lerPdf(original.emissao))).toBe(original.emissao.sha256);
    const r = verapdf(pasta, { 'prescricao.pdf': original.pdf, 'prescricao-2via.pdf': segunda.pdf });
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(r).toHaveLength(2);
    for (const x of r) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    expect(metadadosPdf(pasta, 'prescricao.pdf')).toMatchObject({
      Title: TITULOS_PEP.prescricao,
      Part: '2',
      Conformance: 'B',
    });
    expect(metadadosPdf(pasta, 'prescricao-2via.pdf').Title).toBe(`${TITULOS_PEP.prescricao} - 2ª via`);
    const s = compararSnapshot(
      rasterizarPagina1(pasta, 'snap-prescricao', original.pdf),
      resolve(import.meta.dirname, 'snapshots/pep-prescricao.pgm'),
    );
    console.log(
      `[snapshot] prescricao: ${s.criado ? 'referência gravada' : `${(s.fracao * 100).toFixed(2)}% dos pixels diferentes`}`,
    );
    expect(s.mesmoTamanho).toBe(true);
    expect(s.fracao).toBeLessThan(0.03);
  }, 300_000);
});

describe('impressão pela API (porta em memória, serviço de emissão do Compose)', () => {
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
    app = await criarAppPep(env, {
      trilha,
      cadastro: new PortaCadastroMemoria(),
      prescricao: new PortaPrescricaoMemoria(trilha),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('a prescrição aberta sai em PDF; a reimpressão exige o motivo e sai como 2ª via', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.MEDICO', senha: SENHA },
    });
    const set = r.headers['set-cookie'] as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    const csrf =
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '';
    const lista = (
      await app.inject({
        method: 'GET',
        url: '/api/pep/prescricao/1001/atendimentos/10011',
        headers: { cookie },
      })
    ).json() as { id: number }[];
    const id = lista.at(-1)!.id;
    const imprimir = (payload: object) =>
      app.inject({
        method: 'POST',
        url: `/api/pep/prescricao/1001/prescricoes/${id}/imprimir`,
        headers: { cookie, 'x-csrf': csrf },
        payload,
      });
    const um = await imprimir({});
    expect(um.statusCode).toBe(200);
    expect(um.headers['content-type']).toMatch(/application\/pdf/);
    expect(um.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(um.headers['content-disposition']).toMatch(/via1\.pdf/);
    expect((await imprimir({})).statusCode).toBe(400);
    const dois = await imprimir({ motivo: 'Reimpressão para a enfermagem' });
    expect(dois.statusCode).toBe(200);
    expect(dois.headers['content-disposition']).toMatch(/via2\.pdf/);
  }, 300_000);
});
