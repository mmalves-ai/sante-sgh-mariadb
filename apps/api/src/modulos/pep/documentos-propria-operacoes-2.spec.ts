// Unidade da família pep-resto2 (documentos-propria-operacoes-2.ts): as funções puras do anexo e do pedido de exames e
// a falha fechada sem a porta de armazenamento (nada lido nem gravado). Sem banco.
import { ErroOperacao, FORMATO_CHAVE_IDEMPOTENCIA } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  agruparPorSetor,
  chaveDoArquivoDoAnexo,
  guardaLegal,
  nomeDoArquivo,
  OPERACOES_PEP_RESTO_2,
  operacoesDocumentosPropria2,
  pdfDoAnexo,
} from './documentos-propria-operacoes-2.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';

const codigo = (fn: () => unknown): string => {
  try {
    fn();
    return 'sem-erro';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe('documentos-propria-operacoes-2 (funções puras)', () => {
  it('pdfDoAnexo aceita só PDF (422 arquivo-invalido)', () => {
    const pdf = pdfDoAnexo(Buffer.from('%PDF-1.4 sintetico').toString('base64'));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(codigo(() => pdfDoAnexo(Buffer.from('texto').toString('base64')))).toBe('arquivo-invalido');
    expect(codigo(() => pdfDoAnexo(''))).toBe('arquivo-invalido');
  });

  it('guardaLegal soma os anos da guarda do prontuário (20) à data de hoje', () => {
    expect(guardaLegal(new Date('2026-11-24T15:00:00Z'))).toBe('2046-11-24');
    expect(guardaLegal(new Date('2024-02-29T12:00:00Z'))).toBe('2044-02-29');
    expect(guardaLegal(new Date('2026-01-01T00:00:00Z'), 1)).toBe('2027-01-01');
  });

  it('nomeDoArquivo tira caracteres de caminho e garante a extensão .pdf', () => {
    expect(nomeDoArquivo('Exame externo')).toBe('Exame externo.pdf');
    expect(nomeDoArquivo('laudo.PDF')).toBe('laudo.PDF');
    expect(nomeDoArquivo('../a/b:c*?.pdf')).toBe('.._a_b_c__.pdf');
    expect(nomeDoArquivo('   ')).toBe('anexo.pdf');
    expect(nomeDoArquivo('a\u0001b')).toBe('a_b.pdf');
  });

  it('agruparPorSetor agrupa pelo setor executante na ordem de entrada; exame sem setor recusa 409', () => {
    const setores = new Map([
      [1, 10],
      [2, 20],
      [3, 10],
    ]);
    const g = agruparPorSetor([{ exame: 1 }, { exame: 2 }, { exame: 3 }], setores);
    expect([...g.entries()].map(([s, i]) => [s, i.map((x) => x.exame)])).toEqual([
      [10, [1, 3]],
      [20, [2]],
    ]);
    expect(codigo(() => agruparPorSetor([{ exame: 9 }], setores))).toBe('exame-sem-setor-executante');
  });

  it('chaveDoArquivoDoAnexo cabe no formato do núcleo para qualquer chave de requisição e é determinística', () => {
    for (const n of [8, 42, 72, 73, 80, 200]) {
      const k = chaveDoArquivoDoAnexo('c'.repeat(n));
      expect(FORMATO_CHAVE_IDEMPOTENCIA.test(k)).toBe(true);
      expect(k.length).toBeLessThanOrEqual(80);
    }
    expect(chaveDoArquivoDoAnexo('a'.repeat(80))).toBe(chaveDoArquivoDoAnexo('a'.repeat(80)));
    expect(chaveDoArquivoDoAnexo('a'.repeat(80))).not.toBe(chaveDoArquivoDoAnexo('b'.repeat(80)));
  });

  it('as duas operações da família; anexar sem a porta de armazenamento recusa 503 sem ler o banco', async () => {
    expect(OPERACOES_PEP_RESTO_2).toEqual(['pep.anexarDocumento', 'pep.solicitarExame']);
    let leu = false;
    const nucleo = {
      criarExecutor: () => ({}),
      lerSomente: () => {
        leu = true;
        throw new Error('não deveria ler');
      },
    } as unknown as NucleoDocumentosPep;
    const ops = operacoesDocumentosPropria2(nucleo, 'teste', null);
    expect(Object.keys(ops).sort()).toEqual(['pep.anexarDocumento', 'pep.solicitarExame']);
    const entrada = {
      paciente: 1,
      atendimento: 2,
      cbo: 3,
      retratos: { htAtendimento: 2, htPaciente: 1 },
      dataHoraClinica: '2026-11-24T10:00',
      hashConteudo: 'b'.repeat(64),
      nome: 'Exame',
      estacao: 'Estacao',
      conteudo: Buffer.from('%PDF-1.4 sintetico').toString('base64'),
    };
    const erro = await ops['pep.anexarDocumento']!(
      { rede: 'r', hospital: 'h', cliente: 'teste', estabelecimento: null, usuario: 1, correlacao: 'c' } as never,
      entrada,
      { cliente: 'teste', estabelecimento: null, usuario: 1, correlacao: 'c', chaveIdempotencia: 'chave-sintetica' },
    ).catch((e: unknown) => e);
    expect(erro instanceof ErroOperacao ? erro.problema.codigo : String(erro)).toBe('armazenamento-indisponivel');
    expect(leu).toBe(false);
  });
});
