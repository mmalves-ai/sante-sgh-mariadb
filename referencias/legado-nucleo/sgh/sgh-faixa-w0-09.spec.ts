// W0-09 (programa CRUD completo): os scripts SGH_ de comunicação, relatórios, coexistência e configuração ficam só na
// faixa 1120 a 1139 (docs/operacoes/README.md §4.3), só com objetos SGH_: sem FK para o legado, sem gatilho, sem DROP.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerScriptsSgh } from './scripts.js';

const scripts = lerScriptsSgh(resolve(import.meta.dirname, '../..'));
const doW009 = scripts.filter((x) => x.numero >= 1120 && x.numero <= 1139);

describe('W0-09: scripts SGH_ na faixa 1120 a 1139', () => {
  it('os scripts do pacote, em ordem', () => {
    expect(doW009.map((x) => x.arquivo)).toEqual([
      'acesso/sgh/1120_adm_comunicado_ciclo.sql',
      'relatorio/sgh/1121_rel_pedido_agendamento_ciclo.sql',
      'config/sgh/1122_coex_ciclo.sql',
      'config/sgh/1123_coex_registro.sql',
      'config/sgh/1124_cfg_parametro_retirada.sql',
      'acesso/sgh/1125_acesso_perfil_alteracao.sql',
      'acesso/sgh/1126_acesso_mapa_decisao.sql',
      'acesso/sgh/1127_acesso_perfil_revogacao.sql',
      'acesso/sgh/1128_adm_comunicado_evento_antes.sql',
      'acesso/sgh/1129_acesso_mapa_decisao_motivo.sql',
    ]);
  });

  it('só objetos SGH_; FK só para SGH_; nada de gatilho, DROP (fora a troca de CHECK SGH_) nem DELETE FROM', () => {
    const todos = doW009.flatMap((x) => x.comandos).join('\n');
    // DROP só da restrição CHECK de tabela SGH_ que o mesmo script recria (1122: as situações novas).
    const drops = [...todos.matchAll(/ALTER TABLE (\w+) DROP CONSTRAINT (\w+)/g)];
    for (const m of drops) {
      expect(m[1]).toMatch(/^SGH_/);
      expect(m[2]).toMatch(/^SGH_CK_/);
      expect(todos).toContain(`ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[2]} CHECK`);
    }
    expect(todos.replace(/ALTER TABLE \w+ DROP CONSTRAINT \w+/g, '')).not.toMatch(
      /\bTRIGGER\b|\bDROP\b|\bDELETE\s+FROM\b/,
    );
    for (const m of todos.matchAll(/REFERENCES (\w+)/g)) expect(m[1]).toMatch(/^SGH_/);
    for (const m of todos.matchAll(/(?:CREATE TABLE|ALTER TABLE|CREATE SEQUENCE) (\w+)/g))
      expect(m[1]).toMatch(/^SGH_/);
    // O evento do comunicado é só inclusão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ADM_MENSAGEM_EVENTO TO ROLE SGH_APLICACAO');
    // O evento do pedido e do envio agendado também; a exclusão física (DELETE) só nas duas tabelas do ciclo.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_REL_EVENTO TO ROLE SGH_APLICACAO');
    expect([...todos.matchAll(/GRANT ([A-Z, ]*\bDELETE\b[A-Z, ]*) ON (\w+)/g)].map((m) => m[2])).toEqual([
      'SGH_REL_PEDIDO',
      'SGH_REL_AGENDAMENTO',
      'SGH_CFG_COEX_TRILHA',
    ]);
    // O estorno da conclusão de treinamento é só inclusão (a conclusão nunca se apaga).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CFG_COEX_TREINO_ESTORNO TO ROLE SGH_APLICACAO');
    // O registro do fim e da retrocompatibilidade gravado pela tela: só inclusão (cada gravação é versão nova).
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_CFG_COEX_REGISTRO TO ROLE SGH_APLICACAO');
    // Retirar a sobreposição de parâmetro fecha a versão (colunas novas); a alteração do perfil concedido é só inclusão.
    expect(todos).toContain('ALTER TABLE SGH_CFG_PARAMETRO ADD RETIRADA_MOTIVO');
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_PERFIL_ALTERACAO TO ROLE SGH_APLICACAO');
    // A decisão do mapa (aprovar, recusar, voltar a proposta) deixa o anterior e o motivo: só inclusão.
    expect(todos).toContain('GRANT SELECT, INSERT ON SGH_ACESSO_MAPA_DECISAO TO ROLE SGH_APLICACAO');
    // Revogar o perfil concedido grava o motivo na própria concessão (coluna nova; a linha nunca se apaga).
    expect(todos).toContain('ALTER TABLE SGH_ACESSO_PERFIL_USUARIO ADD REVOGADO_MOTIVO');
    // Revisão: o valor anterior do comunicado corrigido cabe inteiro (a coluna só cresce).
    expect(todos).toContain('ALTER TABLE SGH_ADM_MENSAGEM_EVENTO ALTER COLUMN ANTES TYPE VARCHAR(13000)');
    // Revisão: toda mudança de uma linha do mapa que já existia exige o motivo (CHECK trocada).
    expect(todos).toContain(
      'SITUACAO_ANTES IS NULL OR SITUACAO_ANTES = SITUACAO OR CHAR_LENGTH(MOTIVO) >= 5',
    );
  });
});
