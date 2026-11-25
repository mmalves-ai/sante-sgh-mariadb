// Regras do login único corporativo (01-ADM L61): cadastro por protocolo, token do OpenID, perfis por grupo, quem
// entra pela identidade externa e o vínculo novo. Só dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  sincronizarPerfis,
  conferirReivindicacoesOidc,
  conferirVinculoNovo,
  decidirEntradaExterna,
  EXIGENCIAS_ENTRADA_EXTERNA,
  gruposDaReivindicacao,
  padroesDoProtocolo,
  perfisDosGrupos,
  validarCadastroProvedor,
} from './provedor-externo.js';

const base = { codigo: 'corp', nome: 'Diretório sintético', urlServidor: 'https://idp.exemplo.test' };

describe('validarCadastroProvedor', () => {
  it('OpenID pede emissor https e cliente', () => {
    expect(validarCadastroProvedor({ ...base, protocolo: 'oidc' })).toEqual([
      'emissor-obrigatorio',
      'cliente-obrigatorio',
    ]);
    expect(
      validarCadastroProvedor({
        ...base,
        protocolo: 'oidc',
        emissor: 'http://idp',
        clienteIdentificador: 'sgh',
      }),
    ).toEqual(['emissor-sem-tls']);
    expect(
      validarCadastroProvedor({
        ...base,
        protocolo: 'oidc',
        emissor: 'https://idp.exemplo.test',
        clienteIdentificador: 'sgh',
        referenciaCofre: 'idp/corp/segredo',
      }),
    ).toEqual([]);
  });
  it('diretório só com ldaps, base de pesquisa e, no Active Directory, o domínio', () => {
    expect(validarCadastroProvedor({ ...base, protocolo: 'ldap', urlServidor: 'ldap://dc.test' })).toEqual([
      'url-sem-tls',
      'base-pesquisa-obrigatoria',
    ]);
    expect(
      validarCadastroProvedor({
        ...base,
        protocolo: 'active_directory',
        urlServidor: 'ldaps://dc.test',
        basePesquisa: 'dc=x',
      }),
    ).toEqual(['dominio-obrigatorio']);
  });
  it('recusa código, nome, protocolo e o segredo colado no lugar da referência', () => {
    expect(validarCadastroProvedor({ ...base, codigo: 'A B', nome: 'x', protocolo: 'kerberos' })).toEqual([
      'codigo-invalido',
      'nome-curto',
      'protocolo-invalido',
    ]);
    expect(
      validarCadastroProvedor({
        ...base,
        protocolo: 'saml',
        emissor: 'urn:idp',
        referenciaCofre: 'Xk29dP0aQz7LmN4rT8',
      }),
    ).toEqual(['segredo-no-cadastro']);
    expect(
      validarCadastroProvedor({ ...base, protocolo: 'saml', emissor: 'urn:idp', referenciaCofre: '-x' }),
    ).toEqual(['referencia-cofre-invalida']);
  });
  it('padrões dos atributos por protocolo', () => {
    expect(padroesDoProtocolo('active_directory').atributoLogin).toBe('sAMAccountName');
    expect(padroesDoProtocolo('oidc').atributoGrupo).toBe('groups');
  });
});

describe('conferirReivindicacoesOidc', () => {
  const agoraMs = 1_800_000_000_000;
  const s = agoraMs / 1000;
  const esp = { emissor: 'https://idp.test/', cliente: 'sgh', nonce: 'n1', agoraMs };
  const ok = { iss: 'https://idp.test', aud: 'sgh', sub: 'u-1', exp: s + 60, iat: s, nonce: 'n1' };
  it('token válido não tem falha (a barra final do emissor não conta)', () => {
    expect(conferirReivindicacoesOidc(ok, esp)).toEqual([]);
  });
  it('emissor, público, sujeito, validade e nonce', () => {
    expect(
      conferirReivindicacoesOidc(
        {
          iss: 'https://outro',
          aud: ['x', 'y'],
          sub: '',
          exp: s - 500,
          nbf: s + 500,
          iat: s + 500,
          nonce: 'n2',
        },
        esp,
      ),
    ).toEqual([
      'emissor-diferente',
      'publico-diferente',
      'parte-autorizada-diferente',
      'sem-sujeito',
      'expirado',
      'ainda-nao-valido',
      'emitido-no-futuro',
      'nonce-diferente',
    ]);
  });
  it('vários públicos exigem a parte autorizada; a tolerância do relógio vale', () => {
    expect(
      conferirReivindicacoesOidc({ ...ok, aud: ['sgh', 'outro'], azp: 'sgh', exp: s - 100 }, esp),
    ).toEqual([]);
  });
});

describe('perfis por grupo', () => {
  it('grupos da reivindicação: lista ou texto, sem repetição', () => {
    expect(gruposDaReivindicacao(['B', 'A', 'B', 3])).toEqual(['A', 'B']);
    expect(gruposDaReivindicacao('enf, med ,')).toEqual(['enf', 'med']);
    expect(gruposDaReivindicacao(null)).toEqual([]);
  });
  it('só o mapa ativo do estabelecimento ou de todos, sem diferença de maiúsculas', () => {
    const mapa = [
      { grupoExterno: 'CN=Enf', perfil: 'enfermagem', estabelecimento: null, ativo: true },
      { grupoExterno: 'cn=enf', perfil: 'triagem', estabelecimento: 2, ativo: true },
      { grupoExterno: 'cn=enf', perfil: 'velho', estabelecimento: 1, ativo: false },
      { grupoExterno: 'cn=med', perfil: 'medico', estabelecimento: 1, ativo: true },
    ];
    expect(perfisDosGrupos(mapa, ['cn=ENF'], 1)).toEqual(['enfermagem']);
    expect(perfisDosGrupos(mapa, ['cn=ENF'], 2)).toEqual(['enfermagem', 'triagem']);
    expect(perfisDosGrupos(mapa, [], 1)).toEqual([]);
  });
});

describe('decidirEntradaExterna', () => {
  const agora = new Date('2027-01-10T12:00:00Z');
  const comum = {
    provedorAtivo: true,
    criaContaAutomatica: false,
    vinculo: null,
    emailConfirmado: true,
    contasComEmail: [],
    agora,
  };
  const vinculo = { id: 9, usuario: 4, login: 'sint.a', ativo: true, validoAte: null };
  it('vínculo ativo entra; desligado, vencido ou provedor inativo recusam', () => {
    expect(decidirEntradaExterna({ ...comum, vinculo })).toEqual({
      tipo: 'entrar',
      vinculo: 9,
      login: 'sint.a',
    });
    expect(decidirEntradaExterna({ ...comum, vinculo: { ...vinculo, ativo: false } })).toEqual({
      tipo: 'recusar',
      motivo: 'vinculo-inativo',
    });
    expect(
      decidirEntradaExterna({
        ...comum,
        vinculo: { ...vinculo, validoAte: new Date('2027-01-01T00:00:00Z') },
      }),
    ).toEqual({ tipo: 'recusar', motivo: 'vinculo-vencido' });
    expect(decidirEntradaExterna({ ...comum, provedorAtivo: false, vinculo })).toEqual({
      tipo: 'recusar',
      motivo: 'provedor-inativo',
    });
  });
  it('primeiro acesso: liga à única conta com o e-mail confirmado, só com a criação automática', () => {
    const uma = [{ usuario: 7, login: 'sint.b' }];
    expect(decidirEntradaExterna({ ...comum, contasComEmail: uma })).toEqual({
      tipo: 'recusar',
      motivo: 'sem-vinculo',
    });
    expect(decidirEntradaExterna({ ...comum, criaContaAutomatica: true, contasComEmail: uma })).toEqual({
      tipo: 'vincular',
      usuario: 7,
      login: 'sint.b',
    });
    expect(
      decidirEntradaExterna({
        ...comum,
        criaContaAutomatica: true,
        emailConfirmado: false,
        contasComEmail: uma,
      }).tipo,
    ).toBe('recusar');
    expect(
      decidirEntradaExterna({
        ...comum,
        criaContaAutomatica: true,
        contasComEmail: [...uma, { usuario: 8, login: 'sint.c' }],
      }).tipo,
    ).toBe('recusar');
  });
  it('a entrada externa nunca dispensa o segundo fator, a contagem de tentativas e o bloqueio da conta', () => {
    expect(EXIGENCIAS_ENTRADA_EXTERNA).toEqual({
      segundoFator: true,
      contaTentativas: true,
      respeitaBloqueioDaConta: true,
      pedeTrocaDeSenha: false,
    });
  });
  it('vínculo novo pelo gestor', () => {
    expect(conferirVinculoNovo({ identificador: ' ', identidadeJaLigada: false, contaJaLigada: false })).toBe(
      'identificador-invalido',
    );
    expect(conferirVinculoNovo({ identificador: 's', identidadeJaLigada: true, contaJaLigada: true })).toBe(
      'identidade-ja-ligada',
    );
    expect(conferirVinculoNovo({ identificador: 's', identidadeJaLigada: false, contaJaLigada: true })).toBe(
      'conta-ja-ligada',
    );
    expect(
      conferirVinculoNovo({ identificador: 's', identidadeJaLigada: false, contaJaLigada: false }),
    ).toBeNull();
  });
});

describe('sincronizarPerfis (perfis do diretório na entrada)', () => {
  const hoje = '2026-11-25';
  it('inclui o que o grupo dá e a conta não tem; mantém o que já tem', () => {
    const r = sincronizarPerfis({
      desejados: ['ENFERMAGEM', 'RECEPCAO'],
      atuais: [{ id: 1, perfil: 'RECEPCAO', vigenciaInicio: '2026-01-01', doDiretorio: true }],
      hoje,
    });
    expect(r).toEqual({ incluir: ['ENFERMAGEM'], encerrar: [] });
  });
  it('tira só o perfil do diretório que o grupo deixou de dar; o do gestor fica', () => {
    const r = sincronizarPerfis({
      desejados: [],
      atuais: [
        { id: 1, perfil: 'RECEPCAO', vigenciaInicio: '2026-01-01', doDiretorio: true },
        { id: 2, perfil: 'FATURAMENTO', vigenciaInicio: '2026-01-01', doDiretorio: false },
        { id: 3, perfil: 'ENFERMAGEM', vigenciaInicio: hoje, doDiretorio: true },
      ],
      hoje,
    });
    expect(r.incluir).toEqual([]);
    expect(r.encerrar).toEqual([
      { id: 1, modo: 'fim' },
      { id: 3, modo: 'anular' },
    ]);
  });
});
