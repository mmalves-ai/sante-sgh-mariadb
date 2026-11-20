// M56 (etapa 3, F2): os textos da cobrança cobrem todo código das regras puras (mensalidade, lançamento, baixa, acordo,
// reajuste, notificação) e das recusas do banco, as situações e os meios do vocabulário, e não citam o sistema anterior
// nem nome de tabela.
import {
  MEIOS_NOTIFICACAO,
  MENSAGENS_COBRANCA,
  SITUACOES_COBRANCA,
  SITUACOES_INADIMPLENCIA,
  SITUACOES_REAJUSTE,
  TIPOS_COBRANCA_OPERADORA,
} from '@sgh/contratos';
import type {
  AvisoReajuste,
  MotivoSemMensalidade,
  ProblemaAcordo,
  ProblemaBaixaCobranca,
  ProblemaLancamento,
  ProblemaNotificacao,
  ProblemaReajuste,
} from '@sgh/dominio-operadora';
import { describe, expect, it } from 'vitest';
import { mensagensCobrancaOperadora as m } from './i18n-cobranca';

// Conferência de tipo: todo código das regras tem texto (falta um, o tsc recusa).
const codigos: Record<
  | MotivoSemMensalidade
  | ProblemaLancamento
  | ProblemaBaixaCobranca
  | ProblemaAcordo
  | ProblemaReajuste
  | AvisoReajuste
  | ProblemaNotificacao,
  true
> = {
  'contrato-inativo': true,
  'contrato-fora-da-vigencia': true,
  'contrato-sem-dia-vencimento': true,
  'produto-sem-precos': true,
  'sem-beneficiarios': true,
  'ja-gerada': true,
  'competencia-invalida': true,
  'vencimento-antes-da-competencia': true,
  'nao-aberta': true,
  'pagamento-futuro': true,
  'pagamento-antes-da-emissao': true,
  'valor-divergente': true,
  'dispensa-sem-motivo': true,
  'acordo-de-outro-contrato': true,
  'acordo-cobranca-nao-aberta': true,
  'acordo-cobranca-repetida': true,
  'acordo-vencimento-passado': true,
  'acordo-parcela-zero': true,
  'contrato-encerrado': true,
  'reajuste-fora-do-aniversario': true,
  'reajuste-antes-de-12-meses': true,
  'reajuste-intervalo-menor': true,
  'reajuste-percentual-zero': true,
  'reajuste-sem-teto-ans': true,
  'reajuste-acima-do-teto': true,
  'reajuste-teto-so-individual': true,
  'reajuste-competencia-cobrada': true,
  'reajuste-ja-registrado': true,
  'reajuste-agrupamento': true,
  'notificacao-sem-atraso': true,
  'notificacao-futura': true,
  'notificacao-antes-do-vencimento': true,
};

describe('textos da cobrança da operadora', () => {
  it('cobrem os códigos das regras e das recusas, os tipos, as situações e os meios', () => {
    for (const c of Object.keys(codigos)) expect(MENSAGENS_COBRANCA[c], c).toBeTruthy();
    for (const c of [
      'mensalidade-ja-gerada',
      'cobranca-desatualizada',
      'nao-paga',
      'produto-sem-coparticipacao',
      'coparticipacao-zero',
      'beneficiario-de-outro-contrato',
      'reajuste-cancelado',
      'reajuste-ja-cobrado',
      'reajuste-mudou',
    ])
      expect(MENSAGENS_COBRANCA[c], c).toBeTruthy();
    expect(Object.keys(m.tipos).map(Number)).toEqual(Object.keys(TIPOS_COBRANCA_OPERADORA).map(Number));
    expect(Object.keys(m.situacoes).sort()).toEqual(Object.keys(SITUACOES_COBRANCA).sort());
    expect(Object.keys(m.inadimplencia.situacoes).sort()).toEqual(
      Object.keys(SITUACOES_INADIMPLENCIA).sort(),
    );
    expect(Object.keys(m.inadimplencia.meios).sort()).toEqual(Object.keys(MEIOS_NOTIFICACAO).sort());
    expect(Object.keys(m.reajustes.situacoes).sort()).toEqual(Object.keys(SITUACOES_REAJUSTE).sort());
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = [...valores(m), ...Object.values(MENSAGENS_COBRANCA)].join('\n');
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)[A-Z_]{4,}\b/i);
  });
});
