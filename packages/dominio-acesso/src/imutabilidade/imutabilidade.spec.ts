import {
  EXCECOES_DELETE_CLINICO,
  TABELAS_CLINICAS_MODELO,
  deleteClinicoProibido,
  ehTabelaClinica,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  exigirPlanoImutavel,
  gerarScriptsImutabilidade,
  ImutabilidadeRecusada,
  itensPlanoComDeleteClinico,
  resumirDeleteClinico,
} from './imutabilidade.js';

// Os retratos de privilégio trazem o identificador em maiúsculas; a lista do modelo é minúscula (a conferência ignora a caixa).
const CLINICA = TABELAS_CLINICAS_MODELO[0]!.toUpperCase();
const cab = { hospital: 'pc', versao: 'abc123', autorizacao: 'ESTADO.md, Autorizações, 29/10/2026 (ensaio)' };

describe('M59-F3 regra 6: tabela clínica', () => {
  it('lista do modelo gerada do DDL, SGH_ pelo prefixo, exceções fora da proibição', () => {
    expect(TABELAS_CLINICAS_MODELO.length).toBeGreaterThan(40);
    expect(ehTabelaClinica(CLINICA)).toBe(true);
    expect(ehTabelaClinica('convenio')).toBe(false);
    expect(ehTabelaClinica('SGH_PEP_DOC')).toBe(true);
    expect(ehTabelaClinica('SGH_DOC_ASSINATURA')).toBe(true);
    expect(ehTabelaClinica('SGH_CC_FA_GANHO')).toBe(true);
    expect(ehTabelaClinica('SGH_IDEMPOTENCIA')).toBe(false);
    // SADT (resultado e laudo), CC (cirurgia), prontuário e a trilha entram; os cadastros saem.
    for (const t of [
      'emissao_laudo',
      'entrega_resultado',
      'ato_cirurgico',
      'prescricao',
      'trilha_auditoria',
      'PRESCRICAO',
    ])
      expect(ehTabelaClinica(t)).toBe(true);
    for (const t of [
      'SGH_SADT_LAUDO_EMITIDO',
      'SGH_SADT_LAUDO_EXAME',
      'SGH_SADT_RESULT_VERSAO',
      'SGH_SADT_HEMO_ATO',
      'SGH_SADT_HEMO_REACAO',
      'SGH_CC_APA',
      'SGH_CC_SRPA',
      'SGH_CC_CHECKLIST',
    ])
      expect(ehTabelaClinica(t)).toBe(true);
    for (const t of ['unidade_medida', 'sala_cirurgica', 'SGH_SADT_HEMO_ESTOQUE'])
      expect(ehTabelaClinica(t)).toBe(false);
    for (const e of EXCECOES_DELETE_CLINICO) {
      expect(ehTabelaClinica(e.tabela)).toBe(true);
      expect(deleteClinicoProibido(e.tabela)).toBe(false);
    }
    expect(deleteClinicoProibido(` ${CLINICA.toLowerCase()} `)).toBe(true);
  });
});

describe('M59-F3 regra 6: plano por módulo', () => {
  it('acha e recusa DELETE clínico; aceita SELECT, INSERT e UPDATE e a exceção', () => {
    const plano = [
      { titular: 'SGH_MOD_PEP', objeto: CLINICA, acao: 'SELECT' as const },
      { titular: 'SGH_MOD_PEP', objeto: CLINICA, acao: 'UPDATE' as const },
      { titular: 'SGH_MOD_PEP', objeto: 'SGH_PEP_FORMNOVO_CASO', acao: 'DELETE' as const },
      { titular: 'SGH_MOD_ATENDIMENTO', objeto: 'convenio', acao: 'DELETE' as const },
    ];
    expect(itensPlanoComDeleteClinico(plano)).toEqual([]);
    expect(() => exigirPlanoImutavel(plano)).not.toThrow();
    const ruim = [...plano, { titular: 'SGH_MOD_PEP', objeto: CLINICA, acao: 'DELETE' as const }];
    expect(itensPlanoComDeleteClinico(ruim)).toHaveLength(1);
    try {
      exigirPlanoImutavel(ruim);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImutabilidadeRecusada);
      expect((e as ImutabilidadeRecusada).itens).toEqual([{ onde: 'SGH_MOD_PEP', tabela: CLINICA }]);
    }
  });
});

describe('M59-F3 regra 6: scripts da conta ampla', () => {
  const antes = [
    { titular: 'SANTE_APP', objeto: CLINICA, acao: 'DELETE' as const },
    { titular: 'SANTE_APP', objeto: CLINICA, acao: 'DELETE' as const },
    { titular: 'SANTE_APP', objeto: CLINICA, acao: 'UPDATE' as const },
    { titular: 'SANTE_APP', objeto: 'convenio', acao: 'DELETE' as const },
    { titular: 'SANTE_APP', objeto: 'SGH_PEP_FORMNOVO_CASO', acao: 'DELETE' as const },
    { titular: 'OUTRA', objeto: CLINICA, acao: 'DELETE' as const },
  ];
  it('revoga só o DELETE clínico que a conta tem; o recolher devolve o mesmo, em ordem inversa; ASCII', () => {
    const s = gerarScriptsImutabilidade('SANTE_APP', antes, cab);
    expect(s.tabelas).toEqual([CLINICA]);
    expect(s.aplicar).toContain([`REVOKE`, `DELETE`, `ON "${CLINICA}" FROM USER "SANTE_APP";`].join(' '));
    expect(s.aplicar).not.toContain('convenio');
    expect(s.aplicar).not.toContain('OUTRA');
    expect(s.recolher).toContain([`GRANT`, `DELETE`, `ON "${CLINICA}" TO USER "SANTE_APP";`].join(' '));
    expect(s.aplicar.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect([...(s.aplicar + s.recolher)].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
  it('recusa o administrador do servidor e identificador fora do padrão; sem DELETE, só o cabeçalho', () => {
    expect(() => gerarScriptsImutabilidade('SYSDBA', antes, cab)).toThrow(/administrador/);
    expect(() => gerarScriptsImutabilidade('x"; DROP', antes, cab)).toThrow(/inválido/);
    const vazio = gerarScriptsImutabilidade('NINGUEM', antes, cab);
    expect(vazio.tabelas).toEqual([]);
    expect(vazio.aplicar).not.toContain('REVOKE');
  });
});

describe('M59-F3 regra 6: quem apaga registro clínico', () => {
  it('legíveis por nome, as demais no agregado, faixa abaixo de 5, concessão pelo Sante', () => {
    const r = resumirDeleteClinico(
      [
        { titular: 'SANTE_APP', tabelas: 55 },
        { titular: 'ALFA', tabelas: 3 },
        { titular: null, tabelas: 2 },
        { titular: null, tabelas: 10 },
        { titular: 'ZERO', tabelas: 0 },
      ],
      (t) => t === 'SANTE_APP',
    );
    expect(r.titulares).toEqual([
      { titular: 'ALFA', doSante: false, tabelas: '<5' },
      { titular: 'SANTE_APP', doSante: true, tabelas: 55 },
      { titular: '(outras)', doSante: false, tabelas: 12 },
    ]);
    expect(r.concessaoVigente).toBe(true);
    expect(resumirDeleteClinico([{ titular: 'ALFA', tabelas: 9 }], () => false).concessaoVigente).toBe(false);
  });
});
