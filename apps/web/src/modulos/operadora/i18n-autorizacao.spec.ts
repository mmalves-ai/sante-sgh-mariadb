// M56 (etapa 5, F4): os textos da autorização cobrem toda situação do pedido e do item, todo evento do histórico, os
// tipos de prazo e as categorias do auditor; toda recusa e crítica das regras tem texto; nada cita o sistema anterior nem
// nome de tabela.
import {
  CODIGOS_CATEGORIA_AUDITOR,
  EVENTOS_AUTORIZACAO,
  MENSAGENS_AUTORIZACAO,
  SITUACOES_AUTORIZACAO,
  SITUACOES_ITEM_GUIA,
  TIPOS_PRAZO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensAutorizacaoOperadora as m } from './i18n-autorizacao';

describe('textos da autorização de guias', () => {
  it('cobrem as situações, os eventos, os prazos e as categorias', () => {
    for (const s of SITUACOES_AUTORIZACAO) expect(m.situacoes[s], s).toBeTruthy();
    for (const s of SITUACOES_ITEM_GUIA) expect(m.itemSituacoes[s], s).toBeTruthy();
    for (const e of EVENTOS_AUTORIZACAO) expect(m.eventos[e], e).toBeTruthy();
    for (const p of TIPOS_PRAZO) expect(m.prazos[p], p).toBeTruthy();
    for (const c of CODIGOS_CATEGORIA_AUDITOR) expect(m.auditores.categorias[c], c).toBeTruthy();
  });

  it('toda recusa e crítica das regras tem texto', () => {
    for (const c of [
      'dominio-invalido',
      'carteirinha-invalida',
      'beneficiario-inexistente',
      'internacao-obrigatoria',
      'cid-obrigatorio',
      'consulta-um-item',
      'procedimento-inexistente',
      'guia-principal-inexistente',
      'situacao-nao-permite',
      'auditor-nao-designado',
      'negativa-so-medico',
      'junta-so-medico',
      'critica-bloqueante',
      'critica-obrigatoria',
      'fundamento-obrigatorio',
      'nada-autorizado',
      'beneficiario-inelegivel',
      'produto-nao-e-plano',
      'fora-da-segmentacao',
      'em-carencia',
      'urgencia-em-carencia',
      'cpt-vigente',
      'prestador-fora-da-rede',
      'prestador-sem-regime',
    ])
      expect(MENSAGENS_AUTORIZACAO[c], c).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = [...valores(m), ...Object.values(MENSAGENS_AUTORIZACAO)].join('\n');
    expect(tudo).not.toMatch(
      /spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)_?[A-Z]{4,}_?[A-Z_]*\b/,
    );
  });
});
