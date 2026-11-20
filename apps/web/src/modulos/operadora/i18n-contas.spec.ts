// M56 (etapa 6, F5): os textos das contas médicas cobrem toda situação do lote e do recurso, todo tipo de guia e de
// despesa e todo evento do histórico; toda recusa e crítica das regras tem texto; nada cita o sistema anterior nem nome
// de tabela; nenhum texto usa a barra vertical (o separador de plural do vue-i18n).
import {
  CODIGOS_CRITICA_CONTA,
  CODIGOS_DESPESA_CONTA,
  CODIGOS_SITUACAO_CONTA_MEDICA,
  CODIGOS_SITUACAO_RECURSO,
  CODIGOS_TIPO_GUIA_CONTA,
  EVENTOS_CONTA,
  MENSAGENS_CONTAS,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensContasOperadora as m } from './i18n-contas';

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));

describe('textos das contas médicas', () => {
  it('cobrem as situações, os tipos de guia, as despesas, o recurso e os eventos', () => {
    for (const s of CODIGOS_SITUACAO_CONTA_MEDICA) expect(m.situacoes[s], s).toBeTruthy();
    for (const s of CODIGOS_TIPO_GUIA_CONTA) expect(m.tiposGuia[s], s).toBeTruthy();
    for (const d of Object.keys(CODIGOS_DESPESA_CONTA))
      expect(m.despesas[d as keyof typeof m.despesas], d).toBeTruthy();
    for (const s of CODIGOS_SITUACAO_RECURSO) expect(m.recurso.situacoes[s], s).toBeTruthy();
    for (const e of EVENTOS_CONTA) expect(m.eventos[e], e).toBeTruthy();
  });

  it('toda crítica e toda recusa das regras tem texto', () => {
    for (const c of CODIGOS_CRITICA_CONTA) expect(MENSAGENS_CONTAS[c], c).toBeTruthy();
    for (const c of [
      'arquivo-invalido',
      'xsd-invalido',
      'versao-recusada',
      'hash-nao-confere',
      'operadora-destino-desconhecida',
      'prestador-desconhecido',
      'lote-ja-recebido',
      'auditor-nao-designado',
      'glosa-acima-do-apresentado',
      'motivo-obrigatorio',
      'recurso-acima-da-glosa',
      'pagamento-acima-do-saldo',
      'demonstrativo-da-devolvida',
    ])
      expect(MENSAGENS_CONTAS[c], c).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela; nenhum usa a barra vertical', () => {
    const tudo = [...valores(m), ...Object.values(MENSAGENS_CONTAS)].join('\n');
    expect(tudo).not.toMatch(
      /spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)_?[A-Z]{4,}_?[A-Z_]*\b/,
    );
    expect(valores(m).join('')).not.toContain('|');
  });
});
