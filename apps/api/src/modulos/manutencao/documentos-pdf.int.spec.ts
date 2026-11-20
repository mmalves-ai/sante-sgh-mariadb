// A OS e o laudo em PDF/A (M55, etapa 1; ficha, seção 10, "Documento"): o HTML convertido pelo Gotenberg em PDF/A-2b e
// conferido pelo veraPDF (os mesmos contêineres dos documentos do M09/M15 e do termo de baixa do M54.6). Dados
// sintéticos. Pula sem o Gotenberg.
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { converterHtmlEmPdfA, gotenbergDisponivel } from '../documento/infra/gotenberg.js';
import { pastaTemporaria, verapdf } from '../documento/integracao.spec-util.js';
import { htmlLaudoExecucao, htmlOrdemServico, htmlPgts, htmlPmoc } from './documentos.js';
import { montarPmoc } from './pmoc.js';
import { LAUDO, OS_ENCERRADA } from './documentos.spec-util.js';

const GOTENBERG = 'http://127.0.0.1:3318';
const no = await gotenbergDisponivel(GOTENBERG);
const pasta = pastaTemporaria('m551-pdf-');
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe.skipIf(!no)('OS e laudo em PDF/A (Gotenberg + veraPDF)', () => {
  it('passam no veraPDF (PDF/A-2b)', async () => {
    const os = await converterHtmlEmPdfA(
      GOTENBERG,
      htmlOrdemServico({
        os: OS_ENCERRADA,
        estabelecimento: 'pc',
        emitidoEm: '2026-10-29T12:00:00Z',
        emitidoPor: 'SINT.MANUTENCAO',
      }),
    );
    const laudo = await converterHtmlEmPdfA(GOTENBERG, htmlLaudoExecucao(LAUDO));
    // O PGTS (W0-08, M3): o parque com um equipamento, o índice com as parcelas e um evento.
    const parcela = { pontos: 10, peso: 30, razao: 1 / 3 };
    const pgts = await converterHtmlEmPdfA(
      GOTENBERG,
      htmlPgts({
        equipamentos: [
          {
            codigo: 'EQ-0001',
            nome: 'MONITOR SINTETICO',
            tipo: 'medico',
            criticidade: 'critica',
            classeRisco: 'III',
            fabricante: 'FABRICANTE',
            modelo: 'MOD-1',
            numeroSerie: 'S-1',
            registroAnvisa: null,
            setor: 'UTI SINTETICA',
            situacao: 'ativo',
            indice: {
              indice: 30,
              faixa: 'manter',
              janelaMeses: 12,
              idade: { ...parcela, peso: 40, idadeMeses: 30, vidaUtilMeses: 120 },
              custo: { ...parcela, custoCent: 100_000, valorCent: 1_000_000 },
              falhas: { ...parcela, corretivas: 2, teto: 6 },
            },
          },
        ],
        modelos: [
          {
            fabricante: 'FABRICANTE',
            modelo: 'MOD-1',
            equipamentos: 1,
            cursos: [{ codigo: 'C1', titulo: 'Operação segura', validadeMeses: 24 }],
            aptos: 2,
            pendentes: 1,
          },
        ],
        eventos: [
          {
            equipamento: 'EQ-0001 MONITOR SINTETICO',
            tipo: 'incorporacao',
            data: '2024-04-01',
            motivo: 'Recebido e aceito',
            documento: null,
            destino: null,
            autorizadoPor: 'Gerente sintético',
          },
        ],
        planos: [],
        estabelecimento: 'pc',
        emitidoEm: '2026-10-29T12:00:00Z',
        emitidoPor: 'SINT.MANUTENCAO',
      }),
    );
    // O relatório do PMOC (W0-08, M4): um condicionador com o plano do modelo, uma execução no período e a assinatura do
    // responsável técnico (nome, registro e ART).
    const pmoc = await converterHtmlEmPdfA(
      GOTENBERG,
      htmlPmoc(
        montarPmoc({
          de: '2026-10-01',
          ate: '2026-10-31',
          hoje: '2026-11-18',
          antecedenciaPadrao: 15,
          responsavel: {
            nome: 'Eng. Responsável Sintético',
            registro: 'CREA-SP 0000000000',
            art: '0000000001',
          },
          planos: [
            {
              id: 10,
              equipamento: 1,
              versao: 1,
              atividade: 'preventiva',
              periodicidade: { quantidade: 1, unidade: 'meses' },
              dataBase: '2026-09-01',
              antecedenciaDias: null,
              procedimento: null,
              executor: 'interno',
              cobertura: null,
              ativo: true,
              modelo: { codigo: 'pmocAr', versao: 1 },
              ultimaExecucao: '2026-10-20',
              ultimoResultado: 'aprovado',
            },
          ],
          equipamentos: new Map([
            [
              1,
              {
                id: 1,
                codigo: 'AR-01',
                nome: 'Condicionador AR-01',
                local: 'UTI adulto · sala 2',
                fabricante: 'Fabricante Sintético',
                modelo: 'SPLIT-36',
                numeroSerie: 'SN-1',
              },
            ],
          ]),
          execucoes: new Map([
            [
              10,
              [
                {
                  id: 3,
                  plano: 10,
                  data: '2026-10-20',
                  resultado: 'aprovado',
                  laudo: null,
                  certificadoPadrao: null,
                  observacao: 'Filtros trocados; 24 °C e 55 %',
                  osCorretiva: null,
                  por: 'TECNICO.AR',
                  em: '2026-10-20T10:00',
                },
              ],
            ],
          ]),
          emissao: {
            estabelecimento: 'pc',
            emitidoEm: '2026-11-18T10:00:00.000Z',
            emitidoPor: 'SINT.MANUTENCAO',
          },
        }),
      ),
    );
    const r = verapdf(pasta, {
      'os.pdf': os.pdf,
      'laudo.pdf': laudo.pdf,
      'pgts.pdf': pgts.pdf,
      'pmoc.pdf': pmoc.pdf,
    });
    expect(r.map((x) => [x.arquivo, x.conforme]).sort()).toEqual([
      ['laudo.pdf', true],
      ['os.pdf', true],
      ['pgts.pdf', true],
      ['pmoc.pdf', true],
    ]);
  }, 300_000);
});
