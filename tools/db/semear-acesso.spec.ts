// Regras puras do semeador do acesso: leitura das variáveis (recusa só pelo nome, nunca com o valor), literal SQL e o
// SQL do banco plataforma (só o resumo argon2id, troca obrigatória, idempotente). Sem banco.
import { describe, expect, it } from 'vitest';
import { MINIMO_SENHA_INICIAL, lerEntradaSemeador, sqlPlataforma, textoSql } from './semear-acesso.ts';

const SENHA_A = 'Senha#Inicial01';
const SENHA_T = 'Teste#Inicial02';
const ok = {
  SEMEAR_ADMIN_LOGIN: 'dono',
  SEMEAR_ADMIN_SENHA: SENHA_A,
  SEMEAR_ADMIN_EMAIL: 'dono@exemplo.invalid',
  SEMEAR_TESTE_LOGIN: 'TESTE',
  SEMEAR_TESTE_SENHA: SENHA_T,
};

describe('variáveis do semeador', () => {
  it('lê as obrigatórias e usa o nome padrão do administrador', () => {
    const e = lerEntradaSemeador(ok);
    expect(e.admin).toEqual({ login: 'dono', senha: SENHA_A, email: 'dono@exemplo.invalid', nome: 'Administrador da plataforma' });
    expect(e.teste).toEqual({ login: 'TESTE', senha: SENHA_T });
  });

  it('recusa sem senha, com senha curta ou e-mail inválido, citando só o nome da variável', () => {
    const curta = 'a'.repeat(MINIMO_SENHA_INICIAL - 1);
    let msg = '';
    try {
      lerEntradaSemeador({ ...ok, SEMEAR_ADMIN_SENHA: undefined, SEMEAR_TESTE_SENHA: curta, SEMEAR_ADMIN_EMAIL: 'x' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/SEMEAR_ADMIN_SENHA ausente/);
    expect(msg).toMatch(/SEMEAR_TESTE_SENHA precisa/);
    expect(msg).toMatch(/SEMEAR_ADMIN_EMAIL fora do formato/);
    expect(msg).not.toContain(curta);
    expect(() => lerEntradaSemeador({ ...ok, SEMEAR_TESTE_LOGIN: 'plataforma:x' })).toThrow(/SEMEAR_TESTE_LOGIN/);
    expect(() => lerEntradaSemeador({ ...ok, SEMEAR_ADMIN_LOGIN: ' dono' })).toThrow(/SEMEAR_ADMIN_LOGIN/);
  });
});

describe('SQL do banco plataforma', () => {
  const resumo = '$argon2id$v=19$m=65536,t=3,p=1$c2FsZGV0ZXN0ZXNhbGRl$aGFzaGRldGVzdGVoYXNoZGV0ZXN0ZQ';

  it('literal com aspas e barra escapadas; caractere de controle recusado', () => {
    expect(textoSql("o'neil\\x")).toBe("'o''neil\\\\x'");
    expect(() => textoSql('a\nb')).toThrow();
  });

  it('grava só o resumo, com troca obrigatória; sem --redefinir-senhas a credencial existente é mantida', () => {
    const e = lerEntradaSemeador(ok).admin;
    const sql = sqlPlataforma(e, resumo, false);
    expect(sql).toContain(resumo);
    expect(sql).not.toContain(SENHA_A);
    expect(sql).toMatch(/troca_obrigatoria, criado_em\)\s+SELECT @adm, 'dono', '\$argon2id\$[^']+', @agora, TRUE/);
    expect(sql).toMatch(/AND @tinha_cred = 1 AND FALSE;/);
    expect(sqlPlataforma(e, resumo, true)).toMatch(/AND @tinha_cred = 1 AND TRUE;/);
    expect(() => sqlPlataforma(e, 'texto-puro', false)).toThrow();
  });
});
