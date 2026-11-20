import { describe, expect, it } from 'vitest';
import { gerarPdfCopia } from './copia-pdf.js';
import {
  conferirAtoCopia,
  conferirSolicitacaoCopia,
  etapaDaCopia,
  marcaDaguaCopia,
  mensagemCopia,
  type CopiaParaAto,
  type RecusaCopia,
  situacaoAposAto,
} from './copia-prontuario.js';
import type { SituacaoPedido } from './pedido-titular.js';

const vinculoOk = { doPaciente: true, vigente: true, escopos: ['documentos', 'pedidos'] };

describe('W0-10 (M2) cópia do prontuário: legitimidade', () => {
  it('o titular pede; o representante só com vínculo vigente do paciente e escopo documentos', () => {
    expect(
      conferirSolicitacaoCopia({ solicitante: 'titular', canal: 'portal', vinculo: null, prova: null }),
    ).toBe(null);
    const rep = (vinculo: typeof vinculoOk | null) =>
      conferirSolicitacaoCopia({ solicitante: 'representante', canal: 'portal', vinculo, prova: null });
    expect(rep(vinculoOk)).toBe(null);
    expect(rep(null)).toBe('representante-sem-vinculo');
    expect(rep({ ...vinculoOk, doPaciente: false })).toBe('vinculo-de-outro-paciente');
    expect(rep({ ...vinculoOk, vigente: false })).toBe('vinculo-sem-vigencia');
    expect(rep({ ...vinculoOk, escopos: ['agendamentos'] })).toBe('vinculo-sem-escopo');
  });

  it('o familiar do falecido só no balcão e com a prova descrita', () => {
    const h = (canal: 'portal' | 'balcao', prova: string | null) =>
      conferirSolicitacaoCopia({ solicitante: 'herdeiro', canal, vinculo: null, prova });
    expect(h('portal', 'certidão de óbito')).toBe('herdeiro-so-no-balcao');
    expect(h('balcao', null)).toBe('prova-obrigatoria');
    expect(h('balcao', '  ab ')).toBe('prova-obrigatoria');
    expect(h('balcao', 'certidão de óbito e de nascimento do filho')).toBe(null);
  });
});

describe('W0-10 (M2) cópia do prontuário: a fila de atos', () => {
  const sol = [{ ato: 'solicitacao' as const }];
  const conf = [...sol, { ato: 'legitimidade' as const }];
  const ger = [...conf, { ato: 'geracao' as const }];
  const legit = { ato: 'legitimidade' as const, solicitante: 'titular' as const, vinculo: null, prova: null };

  it('etapas na ordem; a situação do pedido acompanha', () => {
    expect(etapaDaCopia([])).toBe('aguardando-conferencia');
    expect(etapaDaCopia(conf)).toBe('legitimidade-conferida');
    expect(etapaDaCopia(ger)).toBe('gerada');
    expect(etapaDaCopia([...ger, { ato: 'entrega' }])).toBe('entregue');
    expect(situacaoAposAto('legitimidade')).toBe('identidade-verificada');
    expect(situacaoAposAto('entrega')).toBe('atendido');
    expect(situacaoAposAto('geracao')).toBe(null);
  });

  it('solicitação única; legitimidade antes de gerar e de entregar; entrega depois da geração', () => {
    const a = (situacaoPedido: SituacaoPedido, atos: CopiaParaAto['atos']): CopiaParaAto => ({
      situacaoPedido,
      atos,
    });
    expect(conferirAtoCopia(a('aberto', []), { ato: 'solicitacao' })).toBe(null);
    expect(conferirAtoCopia(a('aberto', sol), { ato: 'solicitacao' })).toBe('ja-solicitada');
    expect(conferirAtoCopia(a('aberto', []), legit)).toBe('sem-solicitacao');
    expect(conferirAtoCopia(a('aberto', sol), legit)).toBe(null);
    expect(conferirAtoCopia(a('identidade-verificada', conf), legit)).toBe('ja-conferida');
    expect(conferirAtoCopia(a('aberto', sol), { ato: 'geracao' })).toBe('legitimidade-primeiro');
    expect(conferirAtoCopia(a('identidade-verificada', conf), { ato: 'geracao' })).toBe(null);
    // Gerar de novo é permitido (cada geração vai para a trilha).
    expect(conferirAtoCopia(a('identidade-verificada', ger), { ato: 'geracao' })).toBe(null);
    const entrega = (meio: 'portal' | 'balcao', recebedor: string | null) =>
      ({ ato: 'entrega', meio, recebedor }) as const;
    expect(conferirAtoCopia(a('identidade-verificada', conf), entrega('portal', null))).toBe(
      'gere-antes-de-entregar',
    );
    expect(conferirAtoCopia(a('aberto', sol), entrega('portal', null))).toBe('legitimidade-primeiro');
    expect(conferirAtoCopia(a('identidade-verificada', ger), entrega('balcao', null))).toBe(
      'recebedor-obrigatorio',
    );
    expect(conferirAtoCopia(a('identidade-verificada', ger), entrega('balcao', 'Maria (RG conferido)'))).toBe(
      null,
    );
    expect(conferirAtoCopia(a('identidade-verificada', ger), entrega('portal', null))).toBe(null);
    expect(conferirAtoCopia(a('atendido', [...ger, { ato: 'entrega' }]), { ato: 'geracao' })).toBe(
      'ja-entregue',
    );
    expect(conferirAtoCopia(a('cancelado', sol), legit)).toBe('pedido-encerrado');
  });

  it('a conferência do representante refaz a checagem do vínculo', () => {
    const c = { situacaoPedido: 'aberto' as const, atos: sol };
    const r = (vigente: boolean) =>
      conferirAtoCopia(c, {
        ato: 'legitimidade',
        solicitante: 'representante',
        vinculo: { ...vinculoOk, vigente },
        prova: null,
      });
    expect(r(true)).toBe(null);
    expect(r(false)).toBe('vinculo-sem-vigencia');
  });

  it('toda recusa tem mensagem', () => {
    const todas: RecusaCopia[] = [
      'representante-sem-vinculo',
      'vinculo-de-outro-paciente',
      'vinculo-sem-vigencia',
      'vinculo-sem-escopo',
      'herdeiro-so-no-balcao',
      'prova-obrigatoria',
      'pedido-encerrado',
      'ja-solicitada',
      'sem-solicitacao',
      'ja-conferida',
      'legitimidade-primeiro',
      'ja-entregue',
      'gere-antes-de-entregar',
      'recebedor-obrigatorio',
    ];
    for (const r of todas) expect(mensagemCopia(r).length).toBeGreaterThan(10);
  });
});

describe("W0-10 (M2) PDF da cópia com marca d'água", () => {
  const marca = marcaDaguaCopia('2026-000123', 'representante', new Date('2026-11-18T13:45:10Z'));
  const texto = (b: Uint8Array) => String.fromCharCode(...b);

  it('a marca leva protocolo, papel e instante, sem nome do titular', () => {
    expect(marca).toBe('CÓPIA 2026-000123 · representante legal · 2026-11-18 13:45 UTC');
  });

  it('PDF válido na estrutura, marca em todas as páginas, determinístico', () => {
    const linhas = Array.from(
      { length: 130 },
      (_, i) => `Evolução ${i + 1}: paciente estável (sem queixas).`,
    );
    const e = { titulo: 'Cópia do prontuário', secoes: [{ titulo: 'Evoluções', linhas }], marca };
    const { pdf, paginas } = gerarPdfCopia(e);
    const t = texto(pdf);
    expect(t.startsWith('%PDF-1.4')).toBe(true);
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(paginas).toBeGreaterThan(1);
    expect(t.match(/\/Type \/Page /g)?.length).toBe(paginas);
    // Marca diagonal e no rodapé em cada página.
    expect(t.split('CÓPIA 2026-000123').length - 1).toBe(2 * paginas);
    expect(t).toContain('0.7071 0.7071 -0.7071 0.7071');
    // Parênteses do texto escapados; acento em Latin-1.
    expect(t).toContain('\\(sem queixas\\)');
    expect(t).toContain('Evolução 1');
    // xref aponta para os objetos.
    const xref = Number(/startxref\n(\d+)/.exec(t)?.[1]);
    expect(t.slice(xref, xref + 4)).toBe('xref');
    const off = Number(/0000000000 65535 f \n(\d{10})/.exec(t)?.[1]);
    expect(t.slice(off, off + 7)).toBe('1 0 obj');
    expect(texto(gerarPdfCopia(e).pdf)).toBe(t);
  });

  it('sem seções ainda sai uma página', () => {
    expect(gerarPdfCopia({ titulo: 'x', secoes: [], marca }).paginas).toBe(1);
  });
});

describe('listas da cópia iguais às do CHECK do script 1144', () => {
  it('fixadas também em packages/legado/src/auditoria/script-1144.spec.ts', async () => {
    const m = await import('./copia-prontuario.js');
    expect([...m.ATOS_COPIA]).toEqual(['solicitacao', 'legitimidade', 'geracao', 'entrega']);
    expect([...m.SOLICITANTES_COPIA]).toEqual(['titular', 'representante', 'herdeiro']);
    expect([...m.MEIOS_ENTREGA_COPIA]).toEqual(['portal', 'balcao', 'correio']);
  });
});
