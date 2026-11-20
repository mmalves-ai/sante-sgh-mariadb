// Regra 9 da ficha do M02: mensagem crua do Firebird nunca chega à tela. Os três gdscodes viram 409 em
// português; outro vira 500 genérico. Mensagens sintéticas no formato do fbclient 3.0.
import { describe, expect, it } from 'vitest';
import {
  GDS_CANCELADO,
  GDS_CHECK,
  GDS_DEADLOCK,
  GDS_EXCECAO,
  GDS_LOCK_CONFLITO,
  GDS_VALIDACAO,
  erroDeConexao,
  gdscodeDe,
  problemaDoLegado,
  sanitizarMensagemFirebird,
} from './erros.js';

const VALIDACAO = 'validation error for column "TABELA_X"."NOME", value "FULANO SINTETICO"';
const CHECK = "Operation violates CHECK constraint CK_X on view or table TABELA_X\n-At trigger 'CHECK_1'";
const EXCECAO =
  "exception 7\n-E_SINTETICA\n-Paciente FULANO SINTETICO já internado\n-At trigger 'TRG_X' line: 3, col: 5";

describe('gdscode', () => {
  it.each([
    [VALIDACAO, GDS_VALIDACAO],
    [CHECK, GDS_CHECK],
    [EXCECAO, GDS_EXCECAO],
    ['operation was cancelled', GDS_CANCELADO],
    ['lock conflict on no wait transaction\n-deadlock', GDS_LOCK_CONFLITO],
    ['deadlock\n-update conflicts with concurrent update', GDS_DEADLOCK],
    ['Dynamic SQL Error\n-SQL error code = -204', null],
  ])('deduz da mensagem do driver nativo: %s', (m, codigo) => {
    expect(gdscodeDe(new Error(m))).toBe(codigo);
  });

  it('usa a propriedade quando o driver a traz (plano B)', () => {
    expect(gdscodeDe(Object.assign(new Error('x'), { gdscode: GDS_CHECK }))).toBe(GDS_CHECK);
    expect(gdscodeDe({ gdsCode: GDS_EXCECAO })).toBe(GDS_EXCECAO);
    expect(gdscodeDe(null)).toBeNull();
    expect(gdscodeDe('texto')).toBeNull();
  });
});

describe('Problem Details', () => {
  it.each([
    [VALIDACAO, 'legado-validacao'],
    [CHECK, 'legado-regra'],
    [EXCECAO, 'legado-recusa'],
  ])('vira 409 em português, sem a mensagem crua', (m, codigo) => {
    const { problema, log } = problemaDoLegado(new Error(m));
    expect(problema.status).toBe(409);
    expect(problema.codigo).toBe(codigo);
    expect(problema.type).toMatch(/^https:\/\//);
    expect(JSON.stringify(problema)).not.toMatch(/FULANO|TABELA_X|exception|validation|constraint/i);
    expect(log.mensagem).not.toContain('FULANO');
  });

  it('M10: código em uso (E_GERAL_VALOR_CHAVE) e exclusão proibida (E_EXC_NAO_PERMITIDA) com a saída certa', () => {
    const chave = problemaDoLegado(
      new Error(
        "exception 12\n-E_GERAL_VALOR_CHAVE\n-Valor chave\n-At trigger 'TRG_RILEITOS_BU' line: 5, col: 6",
      ),
    ).problema;
    expect(chave).toMatchObject({ status: 409, codigo: 'chave-imutavel' });
    expect(chave.detail).toMatch(/inative este item e crie outro/);
    const exc = problemaDoLegado(
      new Error("exception 3\n-E_EXC_NAO_PERMITIDA\n-At trigger 'TRG_TBUSERS_BD' line: 3, col: 3"),
    ).problema;
    expect(exc).toMatchObject({ status: 409, codigo: 'exclusao-nao-permitida' });
    for (const p of [chave, exc]) expect(JSON.stringify(p)).not.toMatch(/legado|TRG_|exception/i);
  });

  it('M24: suspensão da prescrição pela metade (E_PRPRESC1) vira suspensão incompleta', () => {
    const p = problemaDoLegado(
      new Error(
        "exception 77\n-E_PRPRESC1\n-Dados incompletos\n-At trigger 'TRG_PRPRESC_BIU' line: 14, col: 7",
      ),
    ).problema;
    expect(p).toMatchObject({ status: 409, codigo: 'suspensao-incompleta' });
    expect(p.detail).toMatch(/prescrição exige quem suspende/);
    expect(JSON.stringify(p)).not.toMatch(/legado|TRG_|exception/i);
  });

  it('M21: as exceções dos gatilhos da internação (leito ocupado, período aberto, isolamento, sexo) em português', () => {
    const casos: [string, string, RegExp][] = [
      ['EX_CHECA_LEITO', 'leito-ocupado', /Leito ocupado em outro terminal/],
      ['E_LOC_EXISTENTE_SEM_SAIDA', 'periodo-aberto', /período de leito aberto/],
      ['E_RICADINT3', 'isolamento-incompativel', /isolamento/],
      ['E_RICADINT4', 'sexo-incompativel', /outro sexo/],
    ];
    for (const [excecao, codigo, texto] of casos) {
      const p = problemaDoLegado(
        new Error(
          `exception 3\n-${excecao}\n-texto do banco\n-At trigger 'TRG_RICADINT_BIU' line: 1, col: 1`,
        ),
      ).problema;
      expect(p).toMatchObject({ status: 409, codigo });
      expect(p.detail).toMatch(texto);
      expect(JSON.stringify(p)).not.toMatch(/legado|TRG_|exception/i);
    }
  });

  it('outro erro vira 500 genérico', () => {
    const { problema, log } = problemaDoLegado(new Error("Dynamic SQL Error\n-Token unknown - 'segredo'"));
    expect(problema).toMatchObject({ status: 500, codigo: 'erro-interno' });
    expect(problema.detail).not.toMatch(/SQL/);
    expect(log.gdscode).toBeNull();
    expect(log.mensagem).toContain("'<omitido>'");
    expect(problemaDoLegado('falha').problema.status).toBe(500);
  });
});

describe('mensagem para o log, sem dado', () => {
  it('corta valor de coluna, literal e o texto livre da exceção', () => {
    expect(sanitizarMensagemFirebird(VALIDACAO)).toBe(
      'validation error for column "TABELA_X"."NOME", value <omitido>',
    );
    expect(sanitizarMensagemFirebird(EXCECAO)).toBe('exception 7 | -E_SINTETICA');
    expect(sanitizarMensagemFirebird('conversion error from string "123.456.789-00"')).toBe(
      'conversion error from string <omitido>',
    );
  });
  it('no máximo 4 linhas de 200 caracteres', () => {
    const m = sanitizarMensagemFirebird(Array.from({ length: 10 }, () => 'x'.repeat(300)).join('\n'));
    expect(m.split(' | ')).toHaveLength(4);
    expect(m.split(' | ')[0]).toHaveLength(200);
  });
});

describe('conexão perdida', () => {
  it.each([
    'connection shutdown',
    'Error writing data to the connection.',
    'Error reading data from the connection.',
  ])('%s → descartar a conexão', (m) => {
    expect(erroDeConexao(new Error(m))).toBe(true);
  });
  it('erro de SQL não descarta', () => {
    expect(erroDeConexao(new Error('Dynamic SQL Error'))).toBe(false);
    expect(erroDeConexao('connection shutdown')).toBe(true);
    expect(erroDeConexao(42)).toBe(false);
  });
});
