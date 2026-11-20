// Regras de tela da etapa 2 do M48: montagem da análise (cada método, linhas vazias fora, a falta com o texto certo),
// da ação 5W2H, do registro de vigilância de produto e do andamento; o formulário da sugestão; e o texto do indicador
// sempre com as parcelas. Dados SINTÉTICOS.
import type { AcaoPlanoLida, AnaliseLida } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensSeguranca as M } from './i18n-seguranca.js';
import {
  comparacaoComMeta,
  dataCurta,
  formularioDaAcao,
  formularioDaAnalise,
  formularioDaSugestao,
  formularioQueixaVazio,
  montarAcao,
  montarAnalise,
  montarAndamento,
  montarQueixa,
  situacoesSeguintes,
  textoDaMeta,
  textoDoIndicador,
  tiposDaArea,
} from './regras-seguranca.js';

const analise = (x: Partial<AnaliseLida> = {}): AnaliseLida => ({
  id: 1,
  notificacao: 7,
  metodo: 'londres',
  conteudo: {
    metodo: 'londres',
    cronologia: 'Cronologia sintética do turno.',
    problemas: [{ descricao: 'Grade abaixada', fatores: ['equipe'] }],
  },
  causaRaiz: 'Rotina ausente',
  fatores: ['organizacao'],
  licoes: null,
  semAcaoJustificativa: null,
  situacao: 'rascunho',
  versao: 3,
  registradaPor: 'SINT.NSP',
  registradaEm: '2026-10-22T09:00:00',
  atualizadaEm: null,
  concluidaEm: null,
  concluidaPor: null,
  ...x,
});

describe('análise', () => {
  it('vazia começa nos 5 porquês; gravada volta ao formulário do método', () => {
    const v = formularioDaAnalise(null);
    expect(v.metodo).toBe('cincoPorques');
    expect(v.porques).toEqual(['', '']);
    const f = formularioDaAnalise(analise());
    expect(f.metodo).toBe('londres');
    expect(f.cronologia).toBe('Cronologia sintética do turno.');
    expect(f.problemas).toEqual([{ descricao: 'Grade abaixada', fatores: ['equipe'] }]);
    expect(f.fatores).toEqual(['organizacao']);
    const i = formularioDaAnalise(
      analise({
        metodo: 'ishikawa',
        conteudo: { metodo: 'ishikawa', causas: [{ categoria: 'maquina', texto: 'Cama' }] },
      }),
    );
    expect(i.causas).toEqual([{ categoria: 'maquina', texto: 'Cama' }]);
    const c = formularioDaAnalise(
      analise({ metodo: 'cincoPorques', conteudo: { metodo: 'cincoPorques', porques: ['Caiu', 'Grade'] } }),
    );
    expect(c.porques).toEqual(['Caiu', 'Grade']);
  });

  it('5 porquês: as linhas vazias saem; sem nenhuma, a falta do conteúdo', () => {
    const f = formularioDaAnalise(null);
    f.porques = ['Paciente caiu', '  ', 'Grade abaixada'];
    f.causaRaiz = '  ';
    const m = montarAnalise(f, 7, 0);
    expect(m.ok && m.entrada).toMatchObject({
      notificacao: 7,
      versao: 0,
      conteudo: { metodo: 'cincoPorques', porques: ['Paciente caiu', 'Grade abaixada'] },
      causaRaiz: null,
      licoes: null,
      concluir: false,
    });
    f.porques = ['', ''];
    expect(montarAnalise(f, 7, 0)).toMatchObject({
      ok: false,
      campo: 'conteudo',
      mensagem: M.analise.falta.conteudo,
    });
  });

  it('Ishikawa e Londres: linhas vazias fora; cronologia curta tem texto próprio', () => {
    const f = formularioDaAnalise(null);
    f.metodo = 'ishikawa';
    f.causas = [
      { categoria: 'material', texto: 'Insumo sem lote' },
      { categoria: 'metodo', texto: ' ' },
    ];
    const m = montarAnalise(f, 7, 2);
    expect(m.ok && m.entrada.conteudo).toEqual({
      metodo: 'ishikawa',
      causas: [{ categoria: 'material', texto: 'Insumo sem lote' }],
    });
    f.metodo = 'londres';
    f.cronologia = 'curta';
    f.problemas = [{ descricao: 'Grade abaixada', fatores: ['equipe'] }];
    expect(montarAnalise(f, 7, 2)).toMatchObject({ ok: false, mensagem: M.analise.falta.cronologia });
    f.cronologia = 'Cronologia sintética do turno.';
    f.concluir = true;
    f.semAcaoJustificativa = 'Circunstância já corrigida.';
    const l = montarAnalise(f, 7, 2);
    expect(l.ok && l.entrada).toMatchObject({
      concluir: true,
      semAcaoJustificativa: 'Circunstância já corrigida.',
    });
  });

  it('texto grande demais aponta o campo', () => {
    const f = formularioDaAnalise(null);
    f.porques = ['Paciente caiu'];
    f.licoes = 'x'.repeat(2100);
    expect(montarAnalise(f, 7, 0)).toMatchObject({
      ok: false,
      campo: 'licoes',
      mensagem: M.analise.falta.licoes,
    });
  });
});

describe('ação 5W2H', () => {
  const ok = {
    oQue: 'Checar a grade a cada ronda',
    porQue: 'Grade abaixada',
    onde: 'Unidade A',
    quando: '2026-11-15',
    quem: 'sint.nsp',
    como: 'Item no checklist da ronda',
    quanto: '',
  };
  it('monta com o custo nulo quando vazio; a falta aponta a pergunta', () => {
    const m = montarAcao(ok);
    expect(m.ok && m.entrada).toMatchObject({ quem: 'sint.nsp', quanto: null });
    expect(montarAcao({ ...ok, quem: '' })).toMatchObject({
      ok: false,
      campo: 'quem',
      mensagem: M.plano.falta.quem,
    });
    expect(montarAcao({ ...ok, quando: null })).toMatchObject({ ok: false, campo: 'quando' });
    expect(montarAcao({ ...ok, oQue: 'ab' })).toMatchObject({ ok: false, mensagem: M.plano.falta.oQue });
  });
  it('o formulário da alteração vem da ação lida', () => {
    const a = { ...ok, quanto: null, id: 1 } as unknown as AcaoPlanoLida;
    expect(formularioDaAcao(a)).toMatchObject({ oQue: ok.oQue, quanto: '' });
    expect(formularioDaAcao()).toMatchObject({ oQue: '', quando: null });
  });
});

describe('vigilância de produto', () => {
  it('os tipos cabem na área; tipo fora da área é falta', () => {
    expect(tiposDaArea('farmacovigilancia').map((t) => t.codigo)).toContain('reacaoAdversa');
    expect(tiposDaArea('tecnovigilancia').map((t) => t.codigo)).not.toContain('reacaoAdversa');
    const f = { ...formularioQueixaVazio(), tipo: 'reacaoAdversa' as const };
    expect(montarQueixa(f, null)).toMatchObject({ ok: false, campo: 'tipo' });
  });
  it('produto do cadastro ou descrito; alerta exige o número; vai a notificação ligada', () => {
    const base = {
      ...formularioQueixaVazio(),
      tipo: 'queixaTecnica' as const,
      descricao: 'Equipo sintético com vazamento na conexão.',
    };
    expect(montarQueixa(base, null)).toMatchObject({ ok: false, mensagem: M.vigilancia.falta.produto });
    const m = montarQueixa({ ...base, item: 55, produto: 'ignorado', lote: 'L-01' }, 7);
    expect(m.ok && m.entrada).toMatchObject({
      acao: 'abrir',
      item: 55,
      produto: null,
      lote: 'L-01',
      notificacao: 7,
    });
    const alerta = { ...base, produto: 'Equipo genérico', tipo: 'alertaSanitario' as const };
    expect(montarQueixa(alerta, null)).toMatchObject({ ok: false, mensagem: M.vigilancia.falta.alerta });
    const a = montarQueixa({ ...alerta, alerta: 'AL-2026-1' }, null);
    expect(a.ok && a.entrada.alerta).toBe('AL-2026-1');
    expect(montarQueixa({ ...base, item: 55, lote: 'lote#' }, null)).toMatchObject({
      ok: false,
      campo: 'lote',
    });
  });
  it('andamento: texto obrigatório; situações só para a frente', () => {
    const f = {
      situacao: 'notificada' as const,
      conduta: 'segregado' as const,
      notivisaNumero: '',
      texto: 'curto',
    };
    expect(montarAndamento(f, 3, 1)).toMatchObject({ ok: false, campo: 'texto' });
    const m = montarAndamento(
      { ...f, texto: 'Lote segregado e notificado.', notivisaNumero: 'NV-123' },
      3,
      1,
    );
    expect(m.ok && m.entrada).toMatchObject({
      acao: 'andamento',
      id: 3,
      versao: 1,
      notivisaNumero: 'NV-123',
    });
    expect(situacoesSeguintes('emInvestigacao').map((s) => s.codigo)).toEqual([
      'emInvestigacao',
      'notificada',
      'encerrada',
    ]);
  });
});

describe('sugestão e painel', () => {
  it('a sugestão preenche tipo, data, hora, se chegou ao paciente e a descrição', () => {
    expect(
      formularioDaSugestao({
        origem: 'omitida:7',
        fonte: 'omitida',
        tipo: 'medicacao',
        titulo: 'Dose não administrada',
        quando: '2026-10-21T10:05:00',
        atendimento: 48001,
        chegouAoPaciente: false,
        descricao: 'Dose não administrada por falta do item.',
      }),
    ).toEqual({
      tipo: 'medicacao',
      chegouAoPaciente: 'nao',
      descricao: 'Dose não administrada por falta do item.',
      data: '2026-10-21',
      hora: '10:05',
    });
  });
  it('o indicador sempre com as parcelas; a meta comparada em texto', () => {
    expect(textoDoIndicador({ numerador: 12, denominador: 40, percentual: 30 })).toBe('12 de 40 (30,0%)');
    expect(textoDoIndicador({ numerador: 0, denominador: 0, percentual: null })).toBe(
      `0 de 0 (${M.painel.semDado})`,
    );
    expect(textoDaMeta({ meta: null })).toBe(M.painel.semMeta);
    expect(textoDaMeta({ meta: 95 })).toBe('95,0%');
    expect(comparacaoComMeta({ percentual: 96, meta: 95 })).toBe('atingida');
    expect(comparacaoComMeta({ percentual: 80, meta: 95 })).toBe('abaixo');
    expect(comparacaoComMeta({ percentual: null, meta: 95 })).toBeNull();
    expect(dataCurta('2026-10-21')).toBe('21/10/2026');
    expect(dataCurta(null)).toBe('-');
  });
});
