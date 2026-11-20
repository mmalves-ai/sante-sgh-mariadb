// Conta do portal do paciente (M50 etapa 1): convite, idade, ativação, situação e máscaras. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  bloqueioPorTentativas,
  codigoConvite,
  conferirAtivacao,
  conferirConvite,
  conferirTransicaoConta,
  type ContaPortalRegra,
  diaEmQueFaz,
  formatarConvite,
  idadeEm,
  MENSAGEM_ATIVACAO_GENERICA,
  mascararEmail,
  mensagemConvite,
  type PacienteParaConta,
  podeEntrar,
  primeiroNome,
  type RecusaConvite,
  situacaoEfetiva,
  validadeDoConvite,
} from './conta.js';

describe('convite', () => {
  it('código de 12 caracteres sem ambiguidade, impresso em grupos de 4', () => {
    const c = codigoConvite(Uint8Array.from({ length: 12 }, (_, i) => i * 7));
    expect(c).toMatch(/^[2-9A-HJ-NP-Z]{12}$/);
    expect(formatarConvite(c)).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(formatarConvite('abcd efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(() => codigoConvite(new Uint8Array(11))).toThrow(/insuficientes/);
  });
  it('validade em horas', () => {
    expect(validadeDoConvite(new Date('2026-10-24T12:00:00Z'), 72).toISOString()).toBe(
      '2026-10-27T12:00:00.000Z',
    );
  });
});

describe('idade', () => {
  it('anos completos; aniversário no dia conta', () => {
    expect(idadeEm('2008-10-24', '2026-10-24')).toBe(18);
    expect(idadeEm('2008-10-25', '2026-10-24')).toBe(17);
    expect(idadeEm('2008-11-01', '2026-10-24')).toBe(17);
    expect(idadeEm('2008-09-30', '2026-10-24')).toBe(18);
  });
  it('sentinela, futuro, vazio ou formato errado: null', () => {
    expect(idadeEm('1899-12-30', '2026-10-24')).toBeNull();
    expect(idadeEm('2027-01-01', '2026-10-24')).toBeNull();
    expect(idadeEm(null, '2026-10-24')).toBeNull();
    expect(idadeEm('24/10/2008', '2026-10-24')).toBeNull();
    expect(idadeEm('2008-10-24', 'hoje')).toBeNull();
  });
  it('dia em que faz N anos; 29/02 vira 01/03 em ano comum', () => {
    expect(diaEmQueFaz('2010-05-17', 18)).toBe('2028-05-17');
    expect(diaEmQueFaz('2008-02-29', 18)).toBe('2026-03-01');
    expect(diaEmQueFaz('2008-02-29', 16)).toBe('2024-02-29');
  });
});

describe('quem pode receber convite', () => {
  const ok: PacienteParaConta = {
    ativo: true,
    obito: false,
    unificadoEmOutro: false,
    nascimento: '1980-01-01',
  };
  const dia = '2026-10-24';
  it('maior, ativo, sem óbito nem unificação: pode; o convite novo substitui o não usado', () => {
    expect(conferirConvite(ok, null, dia, 18)).toBeNull();
    expect(conferirConvite(ok, 'convidada', dia, 18)).toBeNull();
    expect(conferirConvite(ok, 'encerrada', dia, 18)).toBeNull();
  });
  it('recusas na ordem e com texto de produto', () => {
    const casos: [PacienteParaConta, RecusaConvite][] = [
      [{ ...ok, ativo: false }, 'paciente-inativo'],
      [{ ...ok, obito: true }, 'obito'],
      [{ ...ok, unificadoEmOutro: true }, 'unificado'],
      [{ ...ok, nascimento: null }, 'sem-nascimento'],
      [{ ...ok, nascimento: '2012-01-01' }, 'menor-sem-conta-propria'],
    ];
    for (const [p, r] of casos) {
      expect(conferirConvite(p, null, dia, 18)).toBe(r);
      expect(mensagemConvite(r)).not.toMatch(/spdata|legado/i);
    }
    expect(conferirConvite(ok, 'ativa', dia, 18)).toBe('conta-ja-ativa');
    expect(conferirConvite(ok, 'bloqueada', dia, 18)).toBe('conta-ja-ativa');
    expect(mensagemConvite('conta-ja-ativa')).toMatch(/segundo fator/);
    // Parâmetro mais baixo (decisão do DPO) deixa o adolescente ter conta própria.
    expect(conferirConvite({ ...ok, nascimento: '2012-01-01' }, null, dia, 12)).toBeNull();
  });
});

describe('ativação', () => {
  const agora = new Date('2026-10-25T10:00:00Z');
  const convite = { validoAte: new Date('2026-10-27T00:00:00Z'), usadoEm: null, erradas: 0 };
  it('confere código e nascimento; a recusa é genérica', () => {
    expect(conferirAtivacao(convite, '1980-01-01', '1980-01-01', agora, 5)).toBeNull();
    expect(conferirAtivacao(null, '1980-01-01', '1980-01-01', agora, 5)).toBe('convite-invalido');
    expect(conferirAtivacao(convite, '1980-01-01', '1980-01-02', agora, 5)).toBe('convite-invalido');
    expect(conferirAtivacao(convite, null, '1980-01-01', agora, 5)).toBe('convite-invalido');
    expect(
      conferirAtivacao(
        { ...convite, usadoEm: new Date('2026-10-24T00:00:00Z') },
        '1980-01-01',
        '1980-01-01',
        agora,
        5,
      ),
    ).toBe('convite-invalido');
    expect(conferirAtivacao(convite, '1980-01-01', '1980-01-01', new Date('2026-10-28T00:00:00Z'), 5)).toBe(
      'convite-invalido',
    );
    expect(conferirAtivacao({ ...convite, erradas: 5 }, '1980-01-01', '1980-01-01', agora, 5)).toBe(
      'convite-esgotado',
    );
    expect(MENSAGEM_ATIVACAO_GENERICA).toMatch(/recepção/);
  });
});

describe('situação da conta', () => {
  const convidada: ContaPortalRegra = {
    situacao: 'convidada',
    segundoFatorConfirmado: false,
    termosAceitos: false,
    bloqueadaAte: null,
  };
  const ativa: ContaPortalRegra = {
    ...convidada,
    situacao: 'ativa',
    segundoFatorConfirmado: true,
    termosAceitos: true,
  };
  it('ativar exige termos e segundo fator', () => {
    expect(conferirTransicaoConta(convidada, { para: 'ativa' })).toBe('sem-termos');
    expect(conferirTransicaoConta({ ...convidada, termosAceitos: true }, { para: 'ativa' })).toBe(
      'sem-segundo-fator',
    );
    expect(
      conferirTransicaoConta(
        { ...convidada, termosAceitos: true, segundoFatorConfirmado: true },
        { para: 'ativa' },
      ),
    ).toBeNull();
    expect(conferirTransicaoConta(ativa, { para: 'ativa' })).toBe('ja-ativa');
  });
  it('bloquear, desbloquear e encerrar', () => {
    const b = { para: 'bloqueada', motivo: 'decisao-do-hospital', ate: null } as const;
    expect(conferirTransicaoConta(convidada, b)).toBe('convidada-nao-bloqueia');
    expect(conferirTransicaoConta(ativa, b)).toBeNull();
    expect(conferirTransicaoConta({ ...ativa, situacao: 'bloqueada' }, b)).toBe('ja-bloqueada');
    // Bloqueio por tentativas (com prazo) pode virar bloqueio por decisão.
    expect(
      conferirTransicaoConta(
        { ...ativa, situacao: 'bloqueada', bloqueadaAte: new Date('2026-10-24T12:00:00Z') },
        b,
      ),
    ).toBeNull();
    expect(conferirTransicaoConta(ativa, { para: 'desbloqueada' })).toBe('nao-bloqueada');
    expect(conferirTransicaoConta({ ...ativa, situacao: 'bloqueada' }, { para: 'desbloqueada' })).toBeNull();
    expect(conferirTransicaoConta(ativa, { para: 'encerrada', motivo: 'obito' })).toBeNull();
    expect(
      conferirTransicaoConta({ ...ativa, situacao: 'encerrada' }, { para: 'encerrada', motivo: 'obito' }),
    ).toBe('encerrada');
  });
  it('o bloqueio por tentativas acaba sozinho; o por decisão, não', () => {
    const agora = new Date('2026-10-24T12:00:00Z');
    const porTentativas = {
      ...ativa,
      situacao: 'bloqueada' as const,
      bloqueadaAte: new Date('2026-10-24T11:59:00Z'),
    };
    expect(situacaoEfetiva(porTentativas, agora)).toBe('ativa');
    expect(podeEntrar(porTentativas, agora)).toBe(true);
    expect(situacaoEfetiva({ ...porTentativas, bloqueadaAte: new Date('2026-10-24T12:01:00Z') }, agora)).toBe(
      'bloqueada',
    );
    expect(podeEntrar({ ...ativa, situacao: 'bloqueada' }, agora)).toBe(false);
    expect(podeEntrar({ ...ativa, segundoFatorConfirmado: false }, agora)).toBe(false);
    expect(podeEntrar(convidada, agora)).toBe(false);
  });
  it('bloqueio por tentativas com prazo', () => {
    const agora = new Date('2026-10-24T12:00:00Z');
    expect(bloqueioPorTentativas(4, 5, agora, 15)).toEqual({ bloquear: false, ate: null });
    expect(bloqueioPorTentativas(5, 5, agora, 15)).toEqual({
      bloquear: true,
      ate: new Date('2026-10-24T12:15:00Z'),
    });
  });
});

describe('máscaras', () => {
  it('e-mail mascarado', () => {
    expect(mascararEmail('fulano@exemplo.test')).toBe('fu***@ex***.test');
    expect(mascararEmail('a@localhost')).toBe('a***@lo***');
    expect(mascararEmail('semarroba')).toBe('***');
    expect(mascararEmail(null)).toBeNull();
  });
  it('primeiro nome para a saudação', () => {
    expect(primeiroNome('  MARIA DA SILVA ')).toBe('Maria');
    expect(primeiroNome('élcio')).toBe('Élcio');
    expect(primeiroNome(null)).toBe('');
    expect(primeiroNome('   ')).toBe('');
  });
});
