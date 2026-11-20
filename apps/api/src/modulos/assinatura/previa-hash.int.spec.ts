// Regras 4 e 8 do M49 (etapa 2; SBIS-35, SBIS-38, SBIS-42; ICP-05) sobre o PDF/A REAL do serviço de emissão (Gotenberg +
// S3 com Object Lock do Compose, 127.0.0.1): a prévia exata da receita de controle especial e do atestado (com o selo,
// o rodapé legal e o QR do verificador; sem o "assinar à mão") é guardada no S3 e o hash dela é o do arquivo lido de
// volta pela versão (o que a tela mostra é o que se assina); a revisão incremental PAdES com o CMS destacado (assinado
// pela ICP SINTÉTICA, com o carimbo do tempo sintético) mantém o PDF/A-2b sem falha no veraPDF e é validada FORA do
// sistema pelo pdfsig (poppler) e pelo OpenSSL. Fora do `pnpm verificar`: roda pelo `testes:integracao` da API, com
// `./pnpm infra:subir` no ar. Massa SINTÉTICA; nada sai da máquina.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assinarHashRsa,
  atributosAssinados,
  camposDoDocumentoIcp,
  carimbarSintetico,
  CPF_SINTETICO_SESSAO,
  criarRaizSintetica,
  emitirSintetico,
  inserirCms,
  lerAssinaturaPdf,
  type ModeloPep,
  montarCms,
  NOME_RAIZ_SINTETICA,
  novoIdentificadorQr,
  prepararPades,
  RODAPE_ASSINATURA_A_MAO,
  RODAPE_LEGAL_ICP,
  sha256Hex,
  TITULOS_PEP,
  urlVerificador,
} from '@sgh/dominio-documento';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmissaoService } from '../documento/aplicacao/emissao.service.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { RegistroEmissoesMemoria } from '../documento/infra/registro.js';
import { ClienteS3 } from '../documento/infra/s3.js';
import { pastaTemporaria, raiz, verapdf } from '../documento/integracao.spec-util.js';

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m49-${Date.now()}`;
const s3 = new ClienteS3({ endpoint: S3, regiao: 'us-east-1' });
const emissao = new EmissaoService({
  s3,
  bucket,
  gotenbergUrl: GOTENBERG,
  registro: new RegistroEmissoesMemoria(),
  retencao: { modo: 'GOVERNANCE', duracaoMs: 3 * 60_000 },
  produto: 'Produto de Teste',
  baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
  nomeEstabelecimento: (c) => `Estabelecimento Fictício ${c}`,
  raiz,
});

const agora = new Date('2026-10-24T12:00:00Z');
const icp = criarRaizSintetica(agora);
const titular = emitirSintetico(icp, { cpf: CPF_SINTETICO_SESSAO }, agora);
const act = emitirSintetico(icp, { cpf: null, carimbo: true }, agora);
const MODELOS: readonly ModeloPep[] = ['receita-controlada', 'atestado'];

async function previa(modelo: ModeloPep) {
  const codigo = novoIdentificadorQr();
  const url = urlVerificador('https://portal-teste.exemplo.invalid', codigo);
  const campos = camposDoDocumentoIcp(
    {
      modelo,
      identificacao: {
        paciente: 'PACIENTE FICTÍCIO SINTETICO',
        prontuario: '000123',
        nascimento: '01/01/1980',
        atendimento: null,
        profissional: 'PROFISSIONAL FICTÍCIO SINTETICO',
        conselho: null,
        dataHora: '24/10/2026 09:00',
      },
      corpo: ['Ação, coração, pé – texto SINTÉTICO do documento.'],
    },
    {
      profissional: 'PROFISSIONAL FICTÍCIO SINTETICO',
      registro: 'CRM-SP 000000',
      politica: 'AD-RT',
      assinadoEm: '24/10/2026 09:00:00',
      codigo,
      urlVerificador: url,
    },
  );
  expect(campos.some((c) => c.valor === RODAPE_ASSINATURA_A_MAO)).toBe(false);
  expect(campos.at(-1)!.valor).toBe(RODAPE_LEGAL_ICP);
  return emissao.emitir({
    rede: 'rede-teste',
    estabelecimento: 'zz',
    modelo,
    versaoModelo: '1',
    titulo: TITULOS_PEP[modelo],
    origem: { tipo: 'pep-documento', idLegado: 1 },
    campos,
    autor: 'USUARIO_TESTE',
    qr: { identificador: codigo, url },
  });
}

function assinar(pdf: Uint8Array) {
  const prep = prepararPades(pdf, { assinadoEm: agora });
  const attrs = atributosAssinados({ resumo: prep.resumo, certificado: titular.certificado });
  const assinatura = assinarHashRsa(titular.chave, Buffer.from(attrs.hash, 'hex'));
  const carimbo = carimbarSintetico(
    act,
    NOME_RAIZ_SINTETICA,
    { hash: Uint8Array.from(createHash('sha256').update(assinatura).digest()), nonce: null },
    agora,
  );
  return inserirCms(
    prep,
    montarCms({
      atributos: attrs.der,
      assinatura,
      certificado: titular.certificado,
      cadeia: [icp.certificado],
      carimbo,
    }),
  );
}

/** Os baldes de teste deste arquivo de rodadas anteriores (mais de 10 min) saem do S3 do Compose. */
function apagarBucketsVencidos(): void {
  const limite = Date.now() - 10 * 60_000;
  const weed = (c: string): string =>
    execFileSync('docker', ['exec', '-i', 'sgh-s3', 'weed', 'shell'], { input: `${c}\n`, encoding: 'utf8' });
  const vencidos = [...weed('s3.bucket.list').matchAll(/sgh-teste-m49-(\d+)/g)]
    .filter((m) => Number(m[1]) < limite)
    .map((m) => m[0]);
  for (const nome of new Set(vencidos)) weed(`s3.bucket.delete -name=${nome}`);
}

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  apagarBucketsVencidos();
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m49-pades-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('prévia exata e PDF assinado sobre o PDF/A real (regras 4 e 8)', () => {
  it('o hash da prévia é o do arquivo guardado (lido pela versão do S3); o PDF assinado também fica guardado', async () => {
    const e = await previa('atestado');
    const lido = await emissao.lerObjeto(e.emissao.chaveObjeto, e.versaoS3);
    expect(await sha256Hex(lido)).toBe(await sha256Hex(e.pdf));
    expect(e.emissao.sha256).toBe(await sha256Hex(lido));
    const assinado = assinar(lido);
    // A prévia é o começo exato do assinado (nenhum byte da prévia muda).
    expect(Buffer.from(assinado.subarray(0, lido.length)).equals(Buffer.from(lido))).toBe(true);
    const g = await emissao.gravarAssinado('rede-teste', 'zz', 1, assinado);
    expect(await sha256Hex(await emissao.lerObjeto(g.chave, g.versao))).toBe(await sha256Hex(assinado));
    expect(g.chave).toMatch(/^rede-teste\/zz\/documentos\/assinados\/1\/[0-9a-f-]{36}\.pdf$/);
  });

  it('receita de controle especial e atestado assinados: PDF/A-2b sem falha (veraPDF) e assinatura válida (pdfsig, OpenSSL)', async () => {
    const arquivos: Record<string, Uint8Array> = {};
    for (const m of MODELOS) {
      const e = await previa(m);
      arquivos[`${m}-previa.pdf`] = e.pdf;
      arquivos[`${m}-assinado.pdf`] = assinar(e.pdf);
    }
    const r = verapdf(pasta, arquivos);
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    for (const x of r) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0 });
    for (const m of MODELOS) {
      const caminho = join(pasta, `${m}-assinado.pdf`);
      const saida = execFileSync('pdfsig', [caminho], { encoding: 'utf8' });
      console.log(
        `[pdfsig] ${m}: ${saida
          .split('\n')
          .filter((l) => /Signature|signed|Validation/.test(l))
          .join(' | ')}`,
      );
      expect(saida).toContain('Signature is Valid');
      expect(saida).toContain('Total document signed');
      // OpenSSL: o SignedData confere sobre os bytes do /ByteRange com a raiz sintética.
      const pdf = arquivos[`${m}-assinado.pdf`]!;
      const l = lerAssinaturaPdf(pdf);
      const [a, b, c, d] = l.byteRange;
      writeFileSync(join(pasta, `${m}.cms`), l.cms);
      writeFileSync(
        join(pasta, `${m}.conteudo`),
        Buffer.concat([Buffer.from(pdf.subarray(a, a + b)), Buffer.from(pdf.subarray(c, c + d))]),
      );
      writeFileSync(
        join(pasta, 'raiz.pem'),
        `-----BEGIN CERTIFICATE-----\n${Buffer.from(icp.certificado)
          .toString('base64')
          .replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`,
      );
      const o = spawnSync(
        'openssl',
        [
          'cms',
          '-verify',
          '-inform',
          'DER',
          '-in',
          join(pasta, `${m}.cms`),
          '-binary',
          '-content',
          join(pasta, `${m}.conteudo`),
          '-CAfile',
          join(pasta, 'raiz.pem'),
          '-purpose',
          'any',
          '-out',
          '/dev/null',
        ],
        { encoding: 'utf8' },
      );
      expect(o.stderr).toContain('Verification successful');
    }
  });
});
