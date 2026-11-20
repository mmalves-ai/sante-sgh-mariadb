// M56 (etapa 7, F6): os textos dos envios à ANS cobrem toda situação do envio, todo resultado de item, todo movimento do
// SIB, todo motivo de impugnação, toda decisão, todo evento do histórico e toda periodicidade; toda recusa das regras
// tem texto; nada cita o sistema anterior nem nome de tabela; nenhum texto usa a barra vertical.
import {
  CODIGOS_MOTIVO_IMPUGNACAO_SUS,
  CODIGOS_MOVIMENTO_SIB,
  CODIGOS_SITUACAO_ENVIO_ANS,
  DECISOES_RESSARCIMENTO,
  MENSAGENS_ANS,
  MOTIVOS_IMPUGNACAO_SUS,
  OBRIGACOES_ANS,
  RESULTADOS_ITEM_ANS,
  SITUACOES_ENVIO_ANS,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensAnsOperadora as m } from './i18n-ans';

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));

describe('textos dos envios à ANS', () => {
  it('cobrem as situações, os resultados, os movimentos, os motivos, as decisões, os eventos e as periodicidades', () => {
    for (const s of CODIGOS_SITUACAO_ENVIO_ANS) expect(m.situacoes[s], s).toBe(SITUACOES_ENVIO_ANS[s]);
    for (const r of Object.keys(RESULTADOS_ITEM_ANS)) expect(m.resultados[r as 'aceito'], r).toBeTruthy();
    for (const v of CODIGOS_MOVIMENTO_SIB) expect(m.itens.tipos[v], v).toBeTruthy();
    for (const x of CODIGOS_MOTIVO_IMPUGNACAO_SUS) expect(m.motivosSus[x], x).toBe(MOTIVOS_IMPUGNACAO_SUS[x]);
    for (const d of Object.keys(DECISOES_RESSARCIMENTO)) expect(m.decisoes[d as 'pendente'], d).toBeTruthy();
    for (const e of [
      'geracao',
      'substituicao',
      'envio',
      'retorno',
      'decisao',
      'protocolo',
      'pagamento',
    ] as const)
      expect(m.eventos[e], e).toBeTruthy();
    for (const o of Object.values(OBRIGACOES_ANS)) {
      expect(m.periodicidades[o.periodicidade], o.periodicidade).toBeTruthy();
      expect(m.formatos[o.periodicidade], o.periodicidade).toBeTruthy();
    }
    for (const x of ['grupo', 'quadro', 'plano', 'guia', 'AIH', 'APAC'] as const)
      expect(m.itens.tipos[x], x).toBeTruthy();
  });

  it('toda recusa das regras e das gravações tem texto', () => {
    for (const c of [
      'competencia-invalida',
      'competencia-futura',
      'sem-registros',
      'sem-balancete',
      'balancete-desequilibrado',
      'sem-valor-tps',
      'sem-recibo',
      'recibo-no-simulador',
      'envio-desatualizado',
      'situacao-nao-permite',
      'retorno-sem-itens',
      'cco-obrigatorio',
      'sem-gru',
      'aviso-repetido',
      'decisao-pendente',
      'impugnacao-sem-motivo',
      'prazo-vencido',
      'simular-so-fora-de-producao',
      'sem-movimentos',
    ])
      expect(MENSAGENS_ANS[c], c).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela; nenhum usa a barra vertical', () => {
    const tudo = [...valores(m), ...Object.values(MENSAGENS_ANS)].join('\n');
    expect(tudo).not.toMatch(
      /spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)_?[A-Z]{4,}_?[A-Z_]*\b/,
    );
    expect(valores(m).join('')).not.toContain('|');
  });
});
