// M55, etapa 4, regra 10: o conteúdo do termo de referência, do registro da etapa e da ata (emitidos em PDF/A pelo
// M09). Massa sintética.
import type { EventoLicitacao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { documentoLicitacao, montarLicitacao } from '../index.js';
import { estado, item, processo, proposta } from './fixtures.spec-util.js';

type Estado = NonNullable<Parameters<typeof estado>[0]>;
const detalhe = (x: Omit<Estado, 'eventos'> & { eventos?: EventoLicitacao[] } = {}, conduz = true) =>
  montarLicitacao({ ...estado(x), precosDetalhe: [], eventosDetalhe: x.eventos ?? [] }, 'AGENTE', conduz);

const valor = (campos: readonly { rotulo: string; valor: string }[], rotulo: string) =>
  campos.find((c) => c.rotulo === rotulo)?.valor;

describe('documentos do processo (regra 10)', () => {
  it('termo de referência: cabeçalho, itens com a quantidade e a conta da estimativa', () => {
    const r = documentoLicitacao(
      detalhe({ itens: [item(1, { descricao: 'Luva M', quantidade: 1500 })] }),
      'termo',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documento).toMatchObject({
      modelo: 'licitacao-termo',
      titulo: 'Termo de referência 1/2026',
      nomeArquivo: 'licitacao-termo-1-2026.pdf',
    });
    const c = r.documento.campos;
    expect(valor(c, 'Modalidade')).toBe('Pregão eletrônico');
    expect(valor(c, 'Item 1')).toMatch(/^Luva M: 1\.500 CX; valor unitário estimado R\$\s10,00$/);
    expect(valor(c, 'Conta da estimativa')).toBeTruthy();
    expect(valor(c, 'Orçamento')).toBe('Público');
  });

  it('orçamento sigiloso: o termo sai sem os valores antes do julgamento, seja quem for o emissor', () => {
    const sig = { processo: processo({ sigiloso: true, valorEstimado: 1000 }) };
    for (const conduz of [false, true]) {
      const r = documentoLicitacao(detalhe(sig, conduz), 'termo');
      if (!r.ok) throw new Error(r.motivo);
      const c = r.documento.campos;
      expect(valor(c, 'Orçamento')).toBe('Sigiloso até o julgamento');
      expect(valor(c, 'Valor estimado')).toBe('Sigiloso até o julgamento');
      expect(valor(c, 'Item 1')).not.toMatch(/estimado|R\$/);
      expect(valor(c, 'Conta da estimativa')).toBeUndefined();
      expect(JSON.stringify(c)).not.toMatch(/1\.000|10,00/);
    }
    // Depois do julgamento, o termo volta a trazer o estimado.
    const julgado = documentoLicitacao(
      detalhe({
        processo: processo({
          sigiloso: true,
          valorEstimado: 1000,
          etapa: 'julgado',
          dataJulgamento: '2026-10-28',
        }),
      }),
      'termo',
    );
    if (!julgado.ok) throw new Error(julgado.motivo);
    expect(valor(julgado.documento.campos, 'Valor estimado')).toMatch(/R\$\s1\.000,00/);
  });

  it('orçamento sigiloso: o registro da etapa não imprime a conta da pesquisa antes do julgamento', () => {
    const ev = (x: Partial<EventoLicitacao>): EventoLicitacao => ({
      id: 1,
      tipo: 'etapa',
      de: 'pesquisa',
      para: 'edital',
      data: '2026-10-20',
      veiculo: null,
      referencia: null,
      fornecedor: null,
      resultado: null,
      pedido: null,
      documento: null,
      descricao:
        'item 1: mediana de [9,0000; 10,0000; 11,0000] = 10,0000 × 100 = 1.000,00 | total: 1.000,00 = 1.000,00',
      usuario: 'AGENTE',
      criadoEm: '2026-10-20T10:00:00.000Z',
      ...x,
    });
    for (const conduz of [true, false]) {
      const r = documentoLicitacao(
        detalhe({ processo: processo({ etapa: 'edital', sigiloso: true }), eventos: [ev({})] }, conduz),
        'etapa',
      );
      if (!r.ok) throw new Error(r.motivo);
      const texto = JSON.stringify(r.documento.campos);
      expect(texto).not.toMatch(/mediana|1\.000,00/);
      expect(texto).toMatch(/Pesquisa de preços concluída/);
    }
  });

  it('registro da etapa: os atos em ordem, com a mudança de etapa e quem registrou', () => {
    const r = documentoLicitacao(
      detalhe({
        processo: processo({ etapa: 'pesquisa' }),
        eventos: [
          {
            id: 1,
            tipo: 'etapa',
            de: 'planejamento',
            para: 'pesquisa',
            data: null,
            veiculo: null,
            referencia: null,
            fornecedor: null,
            resultado: null,
            pedido: null,
            documento: null,
            descricao: 'Termo concluído',
            usuario: 'AGENTE',
            criadoEm: '2026-10-02T10:00:00.000Z',
          },
        ],
      }),
      'etapa',
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.documento.nomeArquivo).toBe('licitacao-etapa-1-2026-pesquisa.pdf');
    expect(valor(r.documento.campos, '02/10/2026 Mudança de etapa')).toBe(
      'Termo concluído (Termo de referência para Pesquisa de preços); por AGENTE',
    );
  });

  it('ata: só depois do julgamento; o vencedor, o valor e as propostas fora com o motivo', () => {
    expect(documentoLicitacao(detalhe(), 'ata')).toEqual({
      ok: false,
      motivo: 'A ata só existe depois do julgamento (ou do fracasso ou deserção) do processo.',
    });
    const r = documentoLicitacao(
      detalhe({
        processo: processo({ etapa: 'julgado', dataJulgamento: '2026-10-28', julgadoPor: 'AGENTE' }),
        itens: [item(1, { valorEstimado: 10 })],
        propostas: [
          proposta(1, 7001, 9),
          proposta(1, 7002, 8, { situacao: 'desclassificada', motivo: 'Fora da especificação' }),
        ],
      }),
      'ata',
    );
    if (!r.ok) throw new Error(r.motivo);
    const c = r.documento.campos;
    expect(valor(c, 'Item 1')).toMatch(
      /Vencedor definido; vencedor Fornecedor 7001 a R\$\s9,00 por CX; 2 proposta/,
    );
    expect(valor(c, 'Proposta de Fornecedor 7002')).toBe('Desclassificada: Fora da especificação');
    expect(valor(c, 'Valor total adjudicado')).toMatch(/^R\$\s90,00 \(/);
    expect(valor(c, 'Julgado por')).toBe('AGENTE');
  });
});
