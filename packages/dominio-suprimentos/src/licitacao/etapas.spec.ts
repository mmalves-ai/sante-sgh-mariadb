// M55, etapa 4 (regra 9; Lei 14.133/2021, arts. 7, 53, 55, 71 e 165): as etapas do processo formal de compra, os dias
// úteis, o prazo mínimo do aviso, o parecer jurídico, a sessão na data, o julgamento, o recurso no prazo, a
// homologação por outra pessoa, a revogação e a anulação, os eventos por etapa e a montagem do detalhe.
import { describe, expect, it } from 'vitest';
import {
  acoesLicitacao,
  contratacaoDireta,
  diasUteisEntre,
  etapaDepoisDoEvento,
  fimPrazoRecurso,
  montarLicitacao,
  podeAlterarTermo,
  podeAvancar,
  podeEncerrar,
  podeHomologar,
  podeMudarSituacaoProposta,
  podeRegistrarEvento,
  podeRegistrarPreco,
  podeRegistrarProposta,
  prazoMinimoAviso,
  resumoLicitacao,
  somarDiasUteis,
} from '../index.js';
import { estado, item, processo, proposta } from './fixtures.spec-util.js';

const P = { prazoAvisoRegulamentoDiasUteis: 5 };

describe('dias úteis e prazos do aviso', () => {
  it('conta só segunda a sexta, sem o dia do começo', () => {
    // 2026-10-30 é sexta; 2026-11-02 é segunda.
    expect(diasUteisEntre('2026-10-30', '2026-11-02')).toBe(1);
    expect(diasUteisEntre('2026-10-30', '2026-10-30')).toBe(0);
    expect(diasUteisEntre('2026-11-02', '2026-10-30')).toBe(0);
    expect(somarDiasUteis('2026-10-30', 3)).toBe('2026-11-04');
    expect(somarDiasUteis('2026-10-30', 0)).toBe('2026-10-30');
  });
  it('feriado do calendário não é dia útil (data do ano e ano 9999 = todo ano)', () => {
    const f = ['9999-11-20', '2026-11-02'];
    // 2026-11-13 é sexta; 20/11 (sexta) é feriado: 8 dias úteis completam em 26/11, não em 25/11.
    expect(somarDiasUteis('2026-11-13', 8)).toBe('2026-11-25');
    expect(somarDiasUteis('2026-11-13', 8, f)).toBe('2026-11-26');
    expect(diasUteisEntre('2026-11-13', '2026-11-25', f)).toBe(7);
    // 02/11 (segunda, Finados) dentro do recurso de 3 dias úteis de um julgamento na sexta 30/10.
    expect(somarDiasUteis('2026-10-30', 3, f)).toBe('2026-11-05');
    expect(diasUteisEntre('2026-10-30', '2026-11-02', f)).toBe(0);
  });
  it('aviso de bens por menor preço publicado em 13/11/2026: a abertura em 25/11 conta o 20/11 e é recusada', () => {
    const e = estado({
      processo: processo({ etapa: 'edital', natureza: 'bens', criterio: 'menor-preco' }),
      eventos: [{ id: 1, tipo: 'parecer', resultado: 'favoravel', criadoEm: '2026-11-10T10:00:00Z' }],
      hoje: '2026-11-13',
      feriados: ['9999-11-20'],
    });
    const aviso = (dataAbertura: string) =>
      podeAvancar(e, {
        para: 'publicado',
        dataPublicacao: '2026-11-13',
        dataAbertura,
        veiculo: 'pncp',
        referencia: 'PNCP 1',
      } as Parameters<typeof podeAvancar>[1]);
    const r = aviso('2026-11-25');
    expect(r?.codigo).toBe('licitacao-prazo-aviso');
    expect(r?.mensagem).toContain('2026-11-26');
    expect(aviso('2026-11-26')).toBeNull();
  });
  it('o prazo de recurso pula o feriado: a homologação só depois dele', () => {
    const p = processo({ etapa: 'julgado', dataJulgamento: '2026-10-30', julgadoPor: 'PREGOEIRO' });
    expect(fimPrazoRecurso(estado({ processo: p }))).toBe('2026-11-04');
    expect(fimPrazoRecurso(estado({ processo: p, feriados: ['9999-11-02'] }))).toBe('2026-11-05');
  });
  it('art. 55: bens 8 ou 15, serviços comuns 10, especiais 25, lance 15, técnica 35; regulamento e direta', () => {
    const o = { regime: 'lei-14133', modalidade: 'pregao-eletronico', criterio: 'menor-preco' } as const;
    expect(prazoMinimoAviso({ ...o, natureza: 'bens' }, P)).toBe(8);
    expect(prazoMinimoAviso({ ...o, natureza: 'bens', criterio: 'maior-retorno' }, P)).toBe(15);
    expect(prazoMinimoAviso({ ...o, natureza: 'servico-comum' }, P)).toBe(10);
    expect(prazoMinimoAviso({ ...o, natureza: 'obra-comum', criterio: 'maior-retorno' }, P)).toBe(35);
    expect(prazoMinimoAviso({ ...o, natureza: 'obra-especial' }, P)).toBe(25);
    expect(prazoMinimoAviso({ ...o, natureza: 'servico-especial', criterio: 'maior-retorno' }, P)).toBe(35);
    expect(
      prazoMinimoAviso({ ...o, natureza: 'bens', modalidade: 'leilao', criterio: 'maior-lance' }, P),
    ).toBe(15);
    expect(prazoMinimoAviso({ ...o, natureza: 'servico-especial', criterio: 'tecnica-preco' }, P)).toBe(35);
    expect(prazoMinimoAviso({ ...o, natureza: 'bens', regime: 'regulamento' }, P)).toBe(5);
    expect(prazoMinimoAviso({ ...o, natureza: 'bens', modalidade: 'dispensa' }, P)).toBeNull();
    expect(contratacaoDireta('inexigibilidade')).toBe(true);
    expect(contratacaoDireta('concorrencia')).toBe(false);
  });
});

describe('etapas', () => {
  const comPrecos = (x: Parameters<typeof processo>[0]) =>
    estado({ processo: processo(x), precos: [9, 10, 11].map((valor) => ({ item: 1, valor })) });

  it('a ordem: daqui não vai para lá; encerrado não muda; o termo só muda no planejamento', () => {
    expect(podeAvancar(estado(), { para: 'pesquisa' })).toBeNull();
    expect(
      podeAvancar(estado(), { para: 'julgado', desempates: [], justificativaDesempate: null })?.codigo,
    ).toBe('licitacao-etapa-invalida');
    expect(
      podeAvancar(estado({ processo: processo({ etapa: 'revogado' }) }), { para: 'pesquisa' })?.codigo,
    ).toBe('licitacao-encerrada');
    expect(podeAlterarTermo(processo())).toBeNull();
    expect(podeAlterarTermo(processo({ etapa: 'pesquisa' }))?.codigo).toBe('licitacao-termo-fechado');
  });
  it('licitação vai ao edital; direta vai à sessão (e não ao edital)', () => {
    expect(
      podeAvancar(comPrecos({ etapa: 'pesquisa' }), { para: 'edital', justificativaPesquisa: null }),
    ).toBeNull();
    expect(
      podeAvancar(comPrecos({ etapa: 'pesquisa' }), { para: 'sessao', justificativaPesquisa: null })
        ?.mensagem,
    ).toMatch(/edital/);
    const direta = { etapa: 'pesquisa', modalidade: 'inexigibilidade', fundamento: 'art. 74, I' } as const;
    expect(podeAvancar(comPrecos(direta), { para: 'edital', justificativaPesquisa: null })?.codigo).toBe(
      'licitacao-etapa-invalida',
    );
    expect(podeAvancar(comPrecos(direta), { para: 'sessao', justificativaPesquisa: null })).toBeNull();
  });
  it('publicação: parecer exigido e não desfavorável; prazo mínimo em dias úteis; nada futuro', () => {
    const pub = { para: 'publicado', dataPublicacao: '2026-10-20', dataAbertura: '2026-10-30' } as const;
    const ed = estado({ processo: processo({ etapa: 'edital' }) });
    expect(podeAvancar(ed, pub)?.codigo).toBe('licitacao-sem-parecer');
    const par = (resultado: string, id: number) => ({
      id,
      tipo: 'parecer' as const,
      resultado,
      criadoEm: '',
    });
    expect(podeAvancar({ ...ed, eventos: [par('favoravel', 1), par('desfavoravel', 2)] }, pub)?.codigo).toBe(
      'licitacao-parecer-desfavoravel',
    );
    const ok = { ...ed, eventos: [par('desfavoravel', 1), par('ressalvas', 2)] };
    expect(podeAvancar(ok, pub)).toBeNull(); // 20/10 → 30/10: 8 dias úteis
    const curto = podeAvancar(ok, { ...pub, dataAbertura: '2026-10-29' });
    expect(curto).toMatchObject({ codigo: 'licitacao-prazo-aviso', campos: ['dataAbertura'] });
    expect(curto?.mensagem).toMatch(
      /7 dias úteis \(sem sábado, domingo e feriado\); o mínimo é 8 \(a primeira data possível é 2026-10-30\)/,
    );
    expect(
      podeAvancar(ok, { ...pub, dataPublicacao: '2026-10-30', dataAbertura: '2026-11-30' })?.codigo,
    ).toBe('licitacao-publicacao-futura');
    const semExigir = { ...ed, parametros: { ...ed.parametros, exigeParecer: false } };
    expect(podeAvancar(semExigir, pub)).toBeNull();
  });
  it('a sessão abre na data marcada', () => {
    const pub = estado({ processo: processo({ etapa: 'publicado', dataAbertura: '2026-10-30' }) });
    expect(podeAvancar(pub, { para: 'sessao', justificativaPesquisa: null })?.codigo).toBe(
      'licitacao-antes-abertura',
    );
    expect(
      podeAvancar({ ...pub, hoje: '2026-10-30' }, { para: 'sessao', justificativaPesquisa: null }),
    ).toBeNull();
  });
  it('julgar: empate pede desempate justificado; sem vencedor, fracassado ou deserto', () => {
    const s = estado({
      processo: processo({ etapa: 'sessao' }),
      itens: [item(1)],
      propostas: [proposta(1, 5, 9), proposta(1, 6, 9)],
    });
    const j = (d: { item: number; fornecedor: number }[], t: string | null) =>
      podeAvancar(s, { para: 'julgado', desempates: d, justificativaDesempate: t });
    expect(j([], null)?.codigo).toBe('licitacao-empate');
    expect(j([{ item: 1, fornecedor: 5 }], 'curta')?.codigo).toBe('licitacao-desempate-sem-justificativa');
    expect(j([{ item: 1, fornecedor: 5 }], 'Sorteio em sessão pública, art. 60 §2')).toBeNull();
    expect(podeAvancar(s, { para: 'fracassado' })?.codigo).toBe('licitacao-com-vencedor');
    expect(podeAvancar(s, { para: 'deserto' })?.codigo).toBe('licitacao-com-propostas');
    const ruins = estado({
      processo: processo({ etapa: 'sessao' }),
      propostas: [proposta(1, 5, 99)],
    });
    expect(
      podeAvancar(ruins, { para: 'julgado', desempates: [], justificativaDesempate: null })?.codigo,
    ).toBe('licitacao-sem-vencedor');
    expect(podeAvancar(ruins, { para: 'fracassado' })).toBeNull();
    expect(
      podeAvancar(estado({ processo: processo({ etapa: 'publicado' }) }), { para: 'deserto' }),
    ).toBeNull();
  });
});

describe('recurso, homologação e encerramento', () => {
  // Julgado na quinta 2026-10-22: 3 dias úteis vão até a terça 2026-10-27.
  const julgado = (x: Parameters<typeof processo>[0] = {}) =>
    estado({
      processo: processo({ etapa: 'julgado', dataJulgamento: '2026-10-22', julgadoPor: 'PREGOEIRO', ...x }),
      itens: [item(1, { vencedor: 5 })],
      propostas: [proposta(1, 5, 9), proposta(1, 6, 9.5)],
    });
  it('o prazo de recurso em dias úteis; a direta não tem', () => {
    expect(fimPrazoRecurso(julgado())).toBe('2026-10-27');
    expect(fimPrazoRecurso(julgado({ modalidade: 'dispensa' }))).toBeNull();
    expect(fimPrazoRecurso(estado())).toBeNull();
  });
  it('homologar: depois do prazo, sem recurso pendente, por outra pessoa', () => {
    expect(podeHomologar({ ...julgado(), hoje: '2026-10-27' }, 'AUTORIDADE')?.codigo).toBe(
      'licitacao-prazo-recurso',
    );
    expect(podeHomologar(julgado(), 'AUTORIDADE')).toBeNull();
    expect(podeHomologar(julgado(), 'agente')?.codigo).toBe('licitacao-segregacao');
    expect(podeHomologar(julgado(), 'pregoeiro')?.codigo).toBe('licitacao-segregacao');
    expect(podeHomologar(julgado({ etapa: 'recurso' }), 'AUTORIDADE')?.codigo).toBe(
      'licitacao-recurso-pendente',
    );
    expect(podeHomologar(estado({ processo: processo({ etapa: 'sessao' }) }), 'AUTORIDADE')?.codigo).toBe(
      'licitacao-etapa-invalida',
    );
    expect(
      podeHomologar({ ...julgado({ modalidade: 'dispensa' }), hoje: '2026-10-22' }, 'AUTORIDADE'),
    ).toBeNull();
  });
  it('recurso: no prazo, de quem fez proposta; não na direta; a decisão leva a etapa', () => {
    const r = (h: string, f: number) =>
      podeRegistrarEvento({ ...julgado(), hoje: h }, { tipo: 'recurso', data: h, fornecedor: f });
    expect(r('2026-10-27', 6)).toBeNull();
    expect(r('2026-10-28', 6)?.codigo).toBe('licitacao-recurso-intempestivo');
    expect(r('2026-10-26', 8)?.codigo).toBe('licitacao-recorrente');
    expect(
      podeRegistrarEvento(julgado({ modalidade: 'dispensa' }), { tipo: 'recurso', fornecedor: 6 })?.codigo,
    ).toBe('licitacao-etapa-invalida');
    expect(etapaDepoisDoEvento('julgado', 'recurso', null)).toBe('recurso');
    expect(etapaDepoisDoEvento('recurso', 'decisao-recurso', 'provido')).toBe('sessao');
    expect(etapaDepoisDoEvento('recurso', 'decisao-recurso', 'nao-provido')).toBe('julgado');
    expect(etapaDepoisDoEvento('edital', 'parecer', 'favoravel')).toBe('edital');
  });
  it('eventos por etapa; data futura recusada; pedido só do vencedor e uma vez', () => {
    expect(podeRegistrarEvento(estado(), { tipo: 'parecer', data: '2026-10-29' })).toBeNull();
    expect(podeRegistrarEvento(estado(), { tipo: 'parecer', data: '2026-10-30' })?.codigo).toBe(
      'licitacao-data-futura',
    );
    expect(podeRegistrarEvento(estado(), { tipo: 'ata' })?.codigo).toBe('licitacao-etapa-invalida');
    expect(
      podeRegistrarEvento(estado({ processo: processo({ etapa: 'anulado' }) }), { tipo: 'documento' }),
    ).toBeNull();
    const h = julgado({ etapa: 'homologado' });
    expect(podeRegistrarEvento(h, { tipo: 'pedido', fornecedorPedido: null })?.codigo).toBe(
      'licitacao-pedido-inexistente',
    );
    expect(podeRegistrarEvento(h, { tipo: 'pedido', fornecedorPedido: 6 })?.codigo).toBe(
      'licitacao-pedido-fornecedor',
    );
    expect(
      podeRegistrarEvento(h, { tipo: 'pedido', fornecedorPedido: 5, pedidoJaLigado: true })?.codigo,
    ).toBe('licitacao-pedido-repetido');
    expect(podeRegistrarEvento(h, { tipo: 'pedido', fornecedorPedido: 5 })).toBeNull();
  });
  it('revogar antes do fim; anular também o homologado', () => {
    expect(podeEncerrar(processo({ etapa: 'sessao' }), 'revogado')).toBeNull();
    expect(podeEncerrar(processo({ etapa: 'homologado' }), 'revogado')?.codigo).toBe('licitacao-encerrada');
    expect(podeEncerrar(processo({ etapa: 'homologado' }), 'anulado')).toBeNull();
    expect(podeEncerrar(processo({ etapa: 'anulado' }), 'anulado')?.codigo).toBe('licitacao-encerrada');
  });
});

describe('preços, propostas e detalhe', () => {
  it('preço só na pesquisa e de item do processo', () => {
    const p = estado({ processo: processo({ etapa: 'pesquisa' }) });
    expect(podeRegistrarPreco(p, 1)).toBeNull();
    expect(podeRegistrarPreco(p, 9)?.codigo).toBe('licitacao-item-inexistente');
    expect(podeRegistrarPreco(estado(), 1)?.codigo).toBe('licitacao-etapa-invalida');
  });
  it('proposta: na sessão, uma por fornecedor e item, lance só em pregão e leilão, nota na técnica', () => {
    const s = estado({ processo: processo({ etapa: 'sessao' }), propostas: [proposta(1, 5, 9)] });
    const x = { item: 1, fornecedor: 6, lance: null, notaTecnica: null };
    expect(podeRegistrarProposta(s, x)).toBeNull();
    expect(podeRegistrarProposta(s, { ...x, item: 3 })?.codigo).toBe('licitacao-item-inexistente');
    expect(podeRegistrarProposta(s, { ...x, fornecedor: 5 })?.codigo).toBe('licitacao-proposta-repetida');
    expect(podeRegistrarProposta(s, { ...x, lance: 8 })).toBeNull();
    const conc = estado({
      processo: processo({ etapa: 'sessao', modalidade: 'concorrencia', criterio: 'tecnica-preco' }),
    });
    expect(podeRegistrarProposta(conc, { ...x, lance: 8 })?.codigo).toBe('licitacao-lance');
    expect(podeRegistrarProposta(conc, x)?.codigo).toBe('licitacao-nota-tecnica');
    expect(podeRegistrarProposta(estado(), x)?.codigo).toBe('licitacao-etapa-invalida');
    expect(podeMudarSituacaoProposta(processo({ etapa: 'sessao' }))).toBeNull();
    expect(podeMudarSituacaoProposta(processo({ etapa: 'julgado' }))?.codigo).toBe(
      'licitacao-etapa-invalida',
    );
  });
  it('ações com o motivo: pesquisa abaixo do mínimo segue com justificativa; empate julga com desempate', () => {
    const pesq = estado({ processo: processo({ etapa: 'pesquisa' }), precos: [{ item: 1, valor: 5 }] });
    expect(acoesLicitacao(pesq, 'X')).toEqual([
      { acao: 'edital', pode: true, motivo: expect.stringMatching(/menos de 3 preços/) },
      { acao: 'revogar', pode: true, motivo: null },
    ]);
    const direta = estado({
      processo: processo({ etapa: 'pesquisa', modalidade: 'dispensa', fundamento: 'art. 75, IV' }),
    });
    expect(acoesLicitacao(direta, 'X').map((a) => [a.acao, a.pode])).toEqual([
      ['sessao', false],
      ['revogar', true],
    ]);
    const ed = acoesLicitacao(estado({ processo: processo({ etapa: 'edital' }) }), 'X');
    expect(ed[0]).toMatchObject({ acao: 'publicado', pode: false, motivo: expect.stringMatching(/parecer/) });
    const ses = estado({
      processo: processo({ etapa: 'sessao' }),
      propostas: [proposta(1, 5, 9), proposta(1, 6, 9)],
    });
    expect(acoesLicitacao(ses, 'X').map((a) => [a.acao, a.pode])).toEqual([
      ['julgado', true],
      ['fracassado', false],
      ['deserto', false],
      ['revogar', true],
    ]);
    expect(acoesLicitacao(estado({ processo: processo({ etapa: 'planejamento' }) }), 'X')[0]).toEqual({
      acao: 'pesquisa',
      pode: true,
      motivo: null,
    });
    expect(acoesLicitacao(estado({ processo: processo({ etapa: 'homologado' }) }), 'X')).toEqual([]);
    expect(
      acoesLicitacao(
        estado({ processo: processo({ etapa: 'julgado', dataJulgamento: '2026-10-01', julgadoPor: 'X' }) }),
        'x',
      )[0],
    ).toMatchObject({ acao: 'homologar', pode: false });
  });
  it('o detalhe: julgamento na sessão, avisos, sigilo do orçamento para quem não conduz', () => {
    const base = {
      processo: processo({ etapa: 'sessao', sigiloso: true, valorEstimado: 100, natureza: 'obra-comum' }),
      itens: [item(1)],
      precos: [{ item: 1, valor: 10 }],
      propostas: [proposta(1, 5, 7), proposta(1, 6, 7)],
      precosDetalhe: [
        {
          id: 1,
          item: 1,
          fonte: 'painel' as const,
          referencia: 'Painel',
          valor: 10,
          data: '2026-10-01',
          fornecedor: null,
          usuario: 'X',
          descarte: null,
        },
      ],
      eventosDetalhe: [],
    };
    const quemConduz = montarLicitacao({ ...estado(base), ...base }, 'AGENTE', true);
    expect(quemConduz.valorEstimado).toBe(100);
    expect(quemConduz.julgamento?.empates).toBe(1);
    expect(quemConduz.avisos.map((a) => a.codigo)).toEqual(['inexequivel', 'empate']);
    const outro = montarLicitacao({ ...estado(base), ...base }, 'LEITOR', false);
    expect(outro).toMatchObject({ valorEstimado: null, precos: [], processo: { valorEstimado: null } });
    expect(outro.estimativa.conta).toMatch(/sigiloso/);
    expect(outro.itensDetalhe[0]?.valorEstimado).toBeNull();
    const plan = montarLicitacao({ ...estado(), precosDetalhe: [], eventosDetalhe: [] }, 'X', false);
    expect(plan.julgamento).toBeNull();
    const pesq = montarLicitacao(
      { ...estado({ processo: processo({ etapa: 'pesquisa' }) }), precosDetalhe: [], eventosDetalhe: [] },
      'X',
      true,
    );
    expect(pesq.avisos[0]?.codigo).toBe('pesquisa-insuficiente');
    const julg = montarLicitacao(
      {
        ...estado({
          processo: processo({ etapa: 'julgado', dataJulgamento: '2026-10-28', julgadoPor: 'P' }),
          itens: [item(1, { vencedor: 5 })],
          propostas: [proposta(1, 5, 9), proposta(1, 6, 9)],
        }),
        precosDetalhe: [],
        eventosDetalhe: [],
      },
      'X',
      true,
    );
    expect(julg.julgamento?.itens[0]?.vencedor).toBe(5);
    expect(julg.prazoRecursoAte).toBe('2026-11-02');
    expect(julg.avisos.map((a) => a.codigo)).toEqual(['prazo-recurso']);
    expect(resumoLicitacao(processo(), 3)).toMatchObject({
      numero: '1/2026',
      itens: 3,
      etapa: 'planejamento',
    });
  });

  it('orçamento sigiloso: o histórico e a prévia do julgamento não revelam o estimado a quem não conduz', () => {
    const saida = {
      id: 1,
      tipo: 'etapa' as const,
      de: 'pesquisa' as const,
      para: 'edital' as const,
      data: '2026-10-20',
      veiculo: null,
      referencia: null,
      fornecedor: null,
      resultado: null,
      pedido: null,
      documento: null,
      descricao:
        'item 1: mediana de [9,0000; 10,0000; 11,0000] = 10,0000 × 10 = 100,00 | total: 100,00 = 100,00',
      usuario: 'AGENTE',
      criadoEm: '2026-10-20T10:00:00.000Z',
    };
    const parecer = {
      ...saida,
      id: 2,
      tipo: 'parecer' as const,
      de: null,
      para: null,
      descricao: 'Parecer ok.',
    };
    const base = {
      processo: processo({ etapa: 'sessao', sigiloso: true, valorEstimado: 100 }),
      itens: [item(1, { valorEstimado: 10 })],
      propostas: [proposta(1, 5, 12), proposta(1, 6, 9)],
      precosDetalhe: [],
      eventosDetalhe: [saida, parecer],
    };
    const leitor = montarLicitacao({ ...estado(base), ...base }, 'LEITOR', false);
    expect(JSON.stringify(leitor.eventos)).not.toMatch(/mediana|100,00/);
    expect(leitor.eventos[0]?.descricao).toMatch(/sigiloso/);
    expect(leitor.eventos[1]?.descricao).toBe('Parecer ok.');
    expect(leitor.julgamento).toBeNull();
    expect(JSON.stringify(leitor)).not.toMatch(/acima-estimado|Acima do valor estimado/);
    const agente = montarLicitacao({ ...estado(base), ...base }, 'AGENTE', true);
    expect(agente.eventos[0]?.descricao).toMatch(/mediana/);
    expect(agente.julgamento).not.toBeNull();
    // Depois do julgamento, o histórico sai inteiro para todos.
    const julgado = {
      ...base,
      processo: { ...base.processo, etapa: 'julgado' as const, dataJulgamento: '2026-10-28' },
    };
    expect(
      montarLicitacao({ ...estado(julgado), ...julgado }, 'LEITOR', false).eventos[0]?.descricao,
    ).toMatch(/mediana/);
  });
});
