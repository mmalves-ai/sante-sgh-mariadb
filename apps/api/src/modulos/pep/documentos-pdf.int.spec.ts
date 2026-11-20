// Documentos do prontuário em PDF/A (ficha do M23, regras 7 e 8; seção 10 "Documento"): cada modelo emitido pelo
// serviço de emissão do M09 (Gotenberg + S3 com Object Lock), com o texto do corpus CP1252, passa no veraPDF
// (PDF/A-2b, 0 regra com falha), tem o snapshot visual da primeira página (referência versionada em
// snapshots/pep-*.pgm; SGH_ATUALIZAR_SNAPSHOT=sim regrava), sai com "2ª via" na reemissão e leva o rodapé "assinar à
// mão" nos que saem do hospital. Serviços do Compose sgh (127.0.0.1); massa SINTÉTICA; nada sai da máquina. Fora do
// `pnpm verificar`: roda pelo `testes:integracao` da API, com `./pnpm infra:subir` no ar.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  camposDoDocumentoPep,
  type ModeloPep,
  RODAPE_ASSINATURA_A_MAO,
  sha256Hex,
  TITULOS_PEP,
} from '@sgh/dominio-documento';
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

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m09-${Date.now()}`;

/** Os modelos da ficha (seção 10): receita simples e de controle especial, atestado, declaração, TCLE, sumário e transferência. */
const MODELOS: readonly ModeloPep[] = [
  'receita',
  'receita-controlada',
  'atestado',
  'declaracao',
  'tcle',
  'sumario-alta',
  'rel-transferencia',
];

/** Corpus CP1252 (regra 18): acentos, cedilha, aspas curvas, travessão, euro, ordinais e frações. */
const CORPUS =
  'Ação, coração, pé, avó, Ü, ñ; “aspas” e ‘simples’ – travessão — € 1,50; 1º, 2ª; ½ comprimido.';

function apagarBucketsVencidos(): void {
  const limite = Date.now() - 10 * 60_000;
  const weed = (c: string): string =>
    execFileSync('docker', ['exec', '-i', 'sgh-s3', 'weed', 'shell'], { input: `${c}\n`, encoding: 'utf8' });
  const vencidos = [...weed('s3.bucket.list').matchAll(/sgh-teste-m09-(\d+)/g)]
    .filter((m) => Number(m[1]) < limite)
    .map((m) => m[0]);
  for (const nome of new Set(vencidos)) weed(`s3.bucket.delete -name=${nome}`);
}

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
  // Data fixa: só o QR muda entre a página e a referência do snapshot.
  agora: () => new Date('2026-10-21T12:00:00Z'),
});

function pedido(modelo: ModeloPep) {
  return {
    rede: 'rede-teste',
    estabelecimento: 'zz',
    modelo: `pep-${modelo}`,
    versaoModelo: '1',
    titulo: TITULOS_PEP[modelo],
    origem: { tipo: 'pep-documento', idLegado: 1 },
    campos: camposDoDocumentoPep({
      modelo,
      identificacao: {
        paciente: 'PACIENTE FICTÍCIO SINTETICO',
        prontuario: '000123',
        nascimento: '01/01/1980',
        atendimento: '31337',
        profissional: 'PROFISSIONAL FICTÍCIO SINTETICO',
        conselho: 'CRM 12345/SP',
        dataHora: '21/10/2026 09:00',
      },
      corpo: [CORPUS],
      extras: modelo === 'receita-controlada' ? [{ rotulo: 'Vias', valor: '2' }] : [],
    }),
    autor: 'USUARIO_TESTE',
  };
}

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  apagarBucketsVencidos();
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m23-pdf-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('documentos do prontuário em PDF/A (M23)', () => {
  it('cada modelo: PDF/A-2b sem falha no veraPDF, hash conferido, 2ª via marcada, rodapé "assinar à mão"', async () => {
    const arquivos: Record<string, Uint8Array> = {};
    for (const m of MODELOS) {
      const p = pedido(m);
      const original = await servico.emitir(p);
      const segunda = await servico.segundaVia(original.emissao.id, 'Pedido do paciente (teste)', p);
      expect(segunda.emissao.via).toBe(2);
      expect(await sha256Hex(await servico.lerPdf(original.emissao))).toBe(original.emissao.sha256);
      arquivos[`${m}.pdf`] = original.pdf;
      arquivos[`${m}-2via.pdf`] = segunda.pdf;
      const assinaAMao = p.campos.some((c) => c.valor === RODAPE_ASSINATURA_A_MAO);
      expect([m, assinaAMao]).toEqual([m, m === 'receita-controlada' || m === 'atestado']);
    }
    const r = verapdf(pasta, arquivos);
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(r).toHaveLength(MODELOS.length * 2);
    for (const x of r) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    for (const m of MODELOS) {
      expect(metadadosPdf(pasta, `${m}.pdf`)).toMatchObject({
        Title: TITULOS_PEP[m],
        Part: '2',
        Conformance: 'B',
      });
      expect(metadadosPdf(pasta, `${m}-2via.pdf`).Title).toBe(`${TITULOS_PEP[m]} - 2ª via`);
    }
  });

  it('snapshot visual da primeira página de cada modelo (o corpus CP1252 renderizado)', async () => {
    for (const m of MODELOS) {
      const e = await servico.emitir(pedido(m));
      const s = compararSnapshot(
        rasterizarPagina1(pasta, `snap-${m}`, e.pdf),
        resolve(import.meta.dirname, `snapshots/pep-${m}.pgm`),
      );
      console.log(
        `[snapshot] ${m}: ${s.criado ? 'referência gravada' : `${(s.fracao * 100).toFixed(2)}% dos pixels diferentes`}`,
      );
      expect(s.mesmoTamanho).toBe(true);
      expect(s.fracao).toBeLessThan(0.03);
    }
  });
});
