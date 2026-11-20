// Regra 10 do M55 (etapa 4): o termo de referência, o registro da etapa e a ata do julgamento em PDF/A, pelo serviço
// de emissão do M09 (Gotenberg + S3 com Object Lock, num bucket de teste): PDF/A-2b sem falha no veraPDF, retenção
// do objeto conferida, hash conferido na releitura e cada emissão numa chave nova. Serviços do Compose sgh
// (127.0.0.1); massa SINTÉTICA; nada sai da máquina. Fora do `pnpm verificar`: roda pelo `testes:integracao` da API,
// com `./pnpm infra:subir` no ar.
import { rmSync } from 'node:fs';
import { sha256Hex } from '@sgh/dominio-documento';
import {
  type ItemLicitacao,
  type LicitacaoGravada,
  PARAMETROS_LICITACAO_PADRAO,
  type PropostaLicitacao,
} from '@sgh/contratos';
import { montarLicitacao } from '@sgh/contratos/regras-suprimentos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmissaoService } from '../documento/aplicacao/emissao.service.js';
import { gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { RegistroEmissoesMemoria } from '../documento/infra/registro.js';
import { ClienteS3 } from '../documento/infra/s3.js';
import { metadadosPdf, pastaTemporaria, raiz, verapdf } from '../documento/integracao.spec-util.js';
import { emitirDocumentoLicitacao } from './licitacao-documento.js';

const S3 = 'http://127.0.0.1:9318';
const GOTENBERG = 'http://127.0.0.1:3318';
const bucket = `sgh-teste-m55-${Date.now()}`;
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

const processo: LicitacaoGravada = {
  id: 9001,
  numero: 'PE-9/2026',
  regime: 'lei-14133',
  modalidade: 'pregao-eletronico',
  criterio: 'menor-preco',
  natureza: 'bens',
  objeto: 'Aquisição de luvas de procedimento (sintético)',
  justificativa: 'Reposição do estoque do semestre para todos os setores (sintético)',
  fundamento: null,
  pesoTecnica: null,
  sigiloso: false,
  metodoEstimativa: 'mediana',
  valorEstimado: 1100,
  agente: 'USUARIO_TESTE',
  centroCusto: null,
  etapa: 'julgado',
  dataPublicacao: '2026-10-01',
  dataAbertura: '2026-10-20',
  dataJulgamento: '2026-10-27',
  julgadoPor: 'USUARIO_TESTE',
  homologadoPor: null,
  homologadoEm: null,
  versao: 7,
  usuario: 'USUARIO_TESTE',
  criadoEm: '2026-09-20T10:00:00.000Z',
};
const item: ItemLicitacao = {
  id: 1,
  numero: 1,
  descricao: 'Luva de procedimento M, ação “nitrílica” ½ (CP1252)',
  itemEstoque: null,
  unidade: 'CX',
  quantidade: 100,
  valorEstimado: 11,
  resultado: 'adjudicavel',
  vencedor: 7001,
  valorAdjudicado: 9.5,
};
const proposta = (id: number, fornecedor: number, valor: number): PropostaLicitacao => ({
  id,
  item: 1,
  fornecedor,
  fornecedorNome: `Fornecedor Sintético ${fornecedor}`,
  valor,
  lance: null,
  notaTecnica: null,
  marca: null,
  situacao: 'valida',
  motivo: null,
});
const detalhe = montarLicitacao(
  {
    processo,
    itens: [item],
    precos: [],
    propostas: [proposta(1, 7001, 9.5), proposta(2, 7002, 10)],
    eventos: [],
    hoje: '2026-10-28',
    parametros: PARAMETROS_LICITACAO_PADRAO,
    precosDetalhe: [],
    eventosDetalhe: [],
  },
  'USUARIO_TESTE',
  true,
);
const ctx = { rede: 'rede-teste', hospital: 'zz', autor: 'USUARIO_TESTE' };

let pasta: string;
beforeAll(async () => {
  expect(await gotenbergDisponivel(GOTENBERG)).toBe(true);
  await s3.criarBucketComTrava(bucket);
  pasta = pastaTemporaria('m55-licitacao-');
});
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('documentos do processo de compra em PDF/A (M55, regra 10)', () => {
  it('termo, registro da etapa e ata: PDF/A-2b sem falha, retenção no S3, hash conferido, chaves novas', async () => {
    const feitos = [];
    for (const tipo of ['termo', 'etapa', 'ata'] as const)
      feitos.push(await emitirDocumentoLicitacao({ emissao }, ctx, detalhe, tipo));
    const arquivos: Record<string, Uint8Array> = {};
    for (const { documento, feita } of feitos) {
      expect(feita.emissao).toMatchObject({
        modelo: documento.modelo,
        origem: { tipo: 'licitacao', idLegado: 9001 },
        via: 1,
      });
      expect(await sha256Hex(await emissao.lerPdf(feita.emissao))).toBe(feita.emissao.sha256);
      expect((await s3.retencao(bucket, feita.emissao.chaveObjeto, feita.versaoS3)).modo).toBe('GOVERNANCE');
      arquivos[documento.nomeArquivo] = feita.pdf;
    }
    expect(new Set(feitos.map((f) => f.feita.emissao.chaveObjeto)).size).toBe(3);
    const r = verapdf(pasta, arquivos);
    console.log(
      `[veraPDF] ${r.map((x) => `${x.arquivo}: ${x.conforme ? 'PASS' : 'FAIL'} (${x.regrasFalhas})`).join('; ')}`,
    );
    expect(r).toHaveLength(3);
    for (const x of r) expect(x).toMatchObject({ conforme: true, regrasFalhas: 0, checagensFalhas: 0 });
    expect(metadadosPdf(pasta, 'licitacao-termo-PE-9-2026.pdf')).toMatchObject({
      Title: 'Termo de referência PE-9/2026',
      Part: '2',
    });
    expect(metadadosPdf(pasta, 'licitacao-ata-PE-9-2026.pdf').Title).toBe('Ata do julgamento PE-9/2026');
  }, 180_000);

  it('a ata antes do julgamento é recusada sem emitir nada', async () => {
    const antes = montarLicitacao(
      {
        processo: { ...processo, etapa: 'sessao', dataJulgamento: null, julgadoPor: null },
        itens: [{ ...item, resultado: null, vencedor: null, valorAdjudicado: null }],
        precos: [],
        propostas: [],
        eventos: [],
        hoje: '2026-10-28',
        parametros: PARAMETROS_LICITACAO_PADRAO,
        precosDetalhe: [],
        eventosDetalhe: [],
      },
      'USUARIO_TESTE',
      true,
    );
    await expect(emitirDocumentoLicitacao({ emissao }, ctx, antes, 'ata')).rejects.toMatchObject({
      status: 409,
    });
  });
});
