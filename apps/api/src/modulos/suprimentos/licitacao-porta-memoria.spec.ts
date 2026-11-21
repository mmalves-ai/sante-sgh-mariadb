// Regra 10 do M55 (etapa 4) na porta em memória: o documento emitido fica ligado ao processo (o evento `documento`,
// com o número da emissão na referência) sem mudar a etapa nem a versão; o reenvio da mesma emissão não duplica. E o
// calendário sintético: o prazo de recurso pula o feriado. Massa sintética.
import { esquemaCriarLicitacao, PARAMETROS_LICITACAO_PADRAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaLicitacaoMemoria } from './licitacao-porta-memoria.js';

const c: ContextoPortaM18 = {
  cliente: 'sint',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'teste-licitacao',
};
const parametros = PARAMETROS_LICITACAO_PADRAO;

describe('porta da licitação em memória', () => {
  it('o documento emitido ligado ao processo, sem mudar a versão; a mesma emissão não duplica', async () => {
    const porta = new PortaLicitacaoMemoria(() => '2026-10-29');
    const criado = await porta.gravarSgh(c, null, (g) =>
      g.criar({
        usuario: 'SINT.LICITACAO',
        parametros,
        entrada: esquemaCriarLicitacao.parse({
          chave: 'teste-m554-doc-criar',
          numero: 'PE-DOC/2026',
          regime: 'lei-14133',
          modalidade: 'pregao-eletronico',
          natureza: 'bens',
          objeto: 'Aquisição sintética de luvas',
          justificativa: 'Reposição sintética do estoque do semestre',
          agente: 'SINT.LICITACAO',
          itens: [{ descricao: 'Luva sintética', unidade: 'CX', quantidade: 10 }],
        }),
      }),
    );
    const id = criado.licitacao;
    const antes = (await porta.detalhar(c, id, { parametros, usuario: 'X', conduz: true }))!;
    const documento = {
      tipo: 'termo' as const,
      emissao: '00000000-0000-4000-8000-000000000001',
      sha256: 'ab'.repeat(32),
      identificadorQr: 'QR-SINT-1',
      etapa: 'planejamento',
    };
    const ligar = () =>
      porta.gravarSgh(c, null, (g) => g.documento({ licitacao: id, documento, usuario: 'SINT.LEITOR' }));
    const r1 = await ligar();
    const r2 = await ligar();
    expect([r1.repetido, r2.repetido]).toEqual([false, true]);
    const d = (await porta.detalhar(c, id, { parametros, usuario: 'X', conduz: false }))!;
    const docs = d.eventos.filter((e) => e.tipo === 'documento');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ referencia: documento.emissao, usuario: 'SINT.LEITOR' });
    expect(docs[0]!.descricao).toMatch(
      /^Termo de referência em PDF\/A .*SHA-256 (ab){32}; código de validação QR-SINT-1$/,
    );
    expect(d.versao).toBe(antes.versao);
    expect(d.etapa).toBe('planejamento');
    expect(d.feriados).toContain('9999-11-20');
  });
});
