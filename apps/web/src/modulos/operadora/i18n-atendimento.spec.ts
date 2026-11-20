// M56 (etapa 8, F7): os textos do atendimento com protocolo e do portal do prestador cobrem toda instância, natureza,
// canal, solicitante, situação, conclusão, meio, tipo de prazo, evento e ação do contrato e toda situação da conta do
// portal; toda recusa das regras tem texto; nada cita o sistema anterior nem nome de tabela.
import {
  CANAIS_PROTOCOLO,
  CONCLUSOES_PROTOCOLO,
  EVENTOS_PROTOCOLO,
  INSTANCIAS_PROTOCOLO,
  MEIOS_RESPOSTA_PROTOCOLO,
  MENSAGENS_ATENDIMENTO,
  NATUREZAS_PROTOCOLO,
  SITUACOES_ACESSO_PORTAL,
  SITUACOES_PROTOCOLO_OPE,
  SOLICITANTES_PROTOCOLO,
  TIPOS_PRAZO_PROTOCOLO,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { CAMINHO_DA_ACAO } from './api-atendimento';
import { mensagensAtendimentoOperadora as m, mensagensPortalPrestador as p } from './i18n-atendimento';

describe('textos do atendimento com protocolo e do portal do prestador', () => {
  it('cobrem os vocabulários do contrato', () => {
    for (const x of INSTANCIAS_PROTOCOLO) expect(m.instancias[x], x).toBeTruthy();
    for (const x of NATUREZAS_PROTOCOLO) expect(m.naturezas[x], x).toBeTruthy();
    for (const x of CANAIS_PROTOCOLO) expect(m.canais[x], x).toBeTruthy();
    for (const x of SOLICITANTES_PROTOCOLO) expect(m.solicitantes[x], x).toBeTruthy();
    for (const x of SITUACOES_PROTOCOLO_OPE) expect(m.situacoes[x], x).toBeTruthy();
    for (const x of CONCLUSOES_PROTOCOLO) expect(m.conclusoes[x], x).toBeTruthy();
    for (const x of MEIOS_RESPOSTA_PROTOCOLO) expect(m.meios[x], x).toBeTruthy();
    for (const x of TIPOS_PRAZO_PROTOCOLO) expect(m.prazos[x], x).toBeTruthy();
    for (const x of EVENTOS_PROTOCOLO) expect(m.eventos[x], x).toBeTruthy();
    for (const x of Object.keys(CAMINHO_DA_ACAO)) expect(m.acoes[x as keyof typeof m.acoes], x).toBeTruthy();
    for (const x of SITUACOES_ACESSO_PORTAL) expect(m.portal.situacoes[x], x).toBeTruthy();
  });

  it('toda recusa das regras do atendimento e do portal tem texto', () => {
    for (const c of [
      'carteirinha-obrigatoria',
      'sem-beneficiario-so-informacao',
      'solicitante-nome-obrigatorio',
      'canal-da-ans',
      'nip-sem-numero',
      'ans-so-na-nip',
      'numero-nip-so-na-nip',
      'portal-so-prestador',
      'urgente-so-assistencial',
      'complexidade-so-cobertura',
      'autorizacao-so-cobertura',
      'origem-so-ouvidoria',
      'prorrogacao-acima-do-limite',
      'fundamento-obrigatorio',
      'escrita-pendente',
      'funcao-nao-liberavel',
      'ativacao-invalida',
      'funcao-nao-liberada',
      'prestador-descredenciado',
    ])
      expect(MENSAGENS_ATENDIMENTO[c], c).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior, a sigla do módulo antigo ou nome de tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = [...valores(m), ...valores(p), ...Object.values(MENSAGENS_ATENDIMENTO)].join('\n');
    expect(tudo).not.toMatch(
      /spdata|legado|sistema atual|\bSGO\b|\b(?:TB|CD|PS|SP|PF|SGH)_?[A-Z]{4,}_?[A-Z_]*\b/,
    );
  });
});
