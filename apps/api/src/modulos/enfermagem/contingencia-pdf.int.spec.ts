// Relatório de contingência do posto em PDF/A (ficha do M40, regra 6): o relatório da UTI sintética (porta em memória)
// pelo serviço de emissão do M09 (Gotenberg + S3 com Object Lock, num bucket de teste), com o hash conferido na
// releitura e o veraPDF sem falha (PDF/A-2b). Serviços do Compose sgh (127.0.0.1); massa SINTÉTICA; nada sai da
// máquina. Fora do `pnpm verificar`: roda pelo `testes:integracao` da API, com `./pnpm infra:subir` no ar.
import { rmSync } from 'node:fs';
import { sha256Hex } from '@sgh/dominio-documento';
import { TITULO_RELATORIO_CONTINGENCIA } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmissaoService } from '../documento/aplicacao/emissao.service.js';
import type { FonteDocumento } from '../documento/public-api.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { RegistroEmissoesMemoria } from '../documento/infra/registro.js';
import { ClienteS3 } from '../documento/infra/s3.js';
import { metadadosPdf, pastaTemporaria, raiz, verapdf } from '../documento/integracao.spec-util.js';
import { ServicoContingencia } from './contingencia.js';
import { RELOGIO_TESTE } from './enfermagem.spec-util.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m40-${Date.now()}`;
const s3 = new ClienteS3({ endpoint: S3, regiao: 'us-east-1' });
const registro = new RegistroEmissoesMemoria();
const emissao = new EmissaoService({
  s3,
  bucket,
  gotenbergUrl: GOTENBERG,
  registro,
  retencao: { modo: 'GOVERNANCE', duracaoMs: 3 * 60_000 },
  produto: 'Produto de Teste',
  baseUrlValidacao: 'https://rede-teste.exemplo.invalid',
  nomeEstabelecimento: (c) => `Estabelecimento Fictício ${c}`,
  raiz,
});
const porta = new PortaEnfermagemMemoria({ agora: () => new Date(RELOGIO_TESTE) });

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m40-contingencia-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('relatório de contingência do posto em PDF/A (M40, regra 6)', () => {
  it('PDF/A-2b sem falha no veraPDF, com o título e o hash conferido na releitura', async () => {
    const servico = new ServicoContingencia(porta, { emissao } as unknown as FonteDocumento);
    const g = await servico.gerar(
      {
        cliente: '',
        estabelecimento: null,
        usuario: null,
        correlacao: 'teste-pdf',
        rede: 'rede-teste',
        hospital: 'zz',
      },
      { unidade: 'UTI', horas: 6, autor: 'USUARIO_TESTE' },
    );
    expect(g.resumo).toMatchObject({ unidade: 'UTI', pacientes: 3 });
    expect(Buffer.from(g.pdf).subarray(0, 5).toString()).toBe('%PDF-');
    const r = verapdf(pasta, { 'contingencia.pdf': g.pdf });
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    expect(metadadosPdf(pasta, 'contingencia.pdf')).toMatchObject({
      Title: TITULO_RELATORIO_CONTINGENCIA,
      Part: '2',
    });
    const e = await registro.porId(g.resumo.documento);
    expect(e?.modelo).toBe('contingencia-posto');
    expect(await sha256Hex(await emissao.lerPdf(e!))).toBe(e!.sha256);
  }, 120_000);
});
