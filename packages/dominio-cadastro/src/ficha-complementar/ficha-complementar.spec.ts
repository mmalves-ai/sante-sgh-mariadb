import { describe, expect, it } from 'vitest';
import {
  errosEmail,
  errosEndereco,
  errosTelefone,
  fimDoEncerramento,
  principalDepois,
  sucessorDoPrincipal,
  vigenteEm,
} from './contatos.js';
import { camposRecusados, errosDaRegra, type RegraCampo, regrasNoEscopo } from './regras-campo.js';
import {
  errosResponsavel,
  idadeEm,
  pendenciasRepresentacao,
  poderesPadrao,
  recusaEncerramento,
} from './responsaveis.js';

const regra = (x: Partial<RegraCampo> & Pick<RegraCampo, 'campo' | 'exigencia'>): RegraCampo => ({
  estabelecimento: null,
  modulo: null,
  tipoAtendimento: 'todos',
  fontePagadora: null,
  ...x,
});

describe('regras de campo do cadastro', () => {
  it('recusa campo desconhecido, exigência inválida e campo fixo opcional ou oculto', () => {
    expect(errosDaRegra({ campo: 'xpto', exigencia: 'obrigatorio', tipoAtendimento: 'todos' })).toEqual([
      'campo-desconhecido',
    ]);
    expect(errosDaRegra({ campo: 'cpf', exigencia: 'oculto', tipoAtendimento: 'todos' })).toEqual([
      'campo-fixo',
    ]);
    expect(errosDaRegra({ campo: 'email', exigencia: 'obrigatorio', tipoAtendimento: 'todos' })).toEqual([]);
    expect(errosDaRegra({ campo: 'email', exigencia: 'x' as never, tipoAtendimento: 'y' as never })).toEqual([
      'exigencia-invalida',
      'tipo-atendimento-invalido',
    ]);
  });

  it('a regra mais específica vale: estabelecimento > fonte > módulo > tipo; inativa e fora do escopo não valem', () => {
    const regras = [
      regra({ id: 1, campo: 'email', exigencia: 'obrigatorio' }),
      regra({ id: 2, campo: 'email', exigencia: 'opcional', fontePagadora: 7 }),
      regra({ id: 3, campo: 'email', exigencia: 'oculto', estabelecimento: 5, tipoAtendimento: 'urgencia' }),
      regra({ id: 4, campo: 'celular', exigencia: 'obrigatorio', modulo: 9, ativo: false }),
      regra({ id: 5, campo: 'telefone', exigencia: 'obrigatorio', estabelecimento: 6 }),
    ];
    const m = regrasNoEscopo(regras, {
      estabelecimento: 5,
      fontePagadora: 7,
      tipoAtendimento: 'urgencia',
      modulo: 9,
    });
    expect(m.get('email')?.id).toBe(3);
    expect(m.has('celular')).toBe(false);
    expect(m.has('telefone')).toBe(false);
    expect(regrasNoEscopo(regras, { estabelecimento: 5, fontePagadora: 7 }).get('email')?.id).toBe(2);
    expect(regrasNoEscopo(regras, { estabelecimento: 5 }).get('email')?.id).toBe(1);
  });

  it('cadastro: obrigatório vazio; alteração: obrigatório apagado e somente leitura mudado', () => {
    const regras = [
      regra({ campo: 'email', exigencia: 'obrigatorio', rotulo: 'E-mail do paciente' }),
      regra({ campo: 'nomeMae', exigencia: 'somente_leitura' }),
      regra({ campo: 'celular', exigencia: 'obrigatorio', fontePagadora: 3 }),
    ];
    const e = { estabelecimento: 1 };
    expect(camposRecusados(regras, e, { email: '  ' }, 'cadastro')).toEqual([
      { campo: 'email', rotulo: 'E-mail do paciente', motivo: 'obrigatorio' },
    ]);
    expect(camposRecusados(regras, { ...e, fontePagadora: 3 }, { email: 'a@b.co' }, 'cadastro')).toEqual([
      { campo: 'celular', rotulo: 'Celular', motivo: 'obrigatorio' },
    ]);
    expect(camposRecusados(regras, e, { nome: 'X' }, 'alteracao')).toEqual([]);
    expect(
      camposRecusados(regras, e, { email: null, nomeMae: 'Y' }, 'alteracao').map((x) => x.motivo),
    ).toEqual(['obrigatorio', 'somente_leitura']);
  });
});

describe('contatos da pessoa', () => {
  it('endereço: CEP, número ou sem número, vigência', () => {
    const ok = { cep: '30130010', numero: '10', semNumero: false, vigenciaInicio: null, vigenciaFim: null };
    expect(errosEndereco(ok)).toEqual([]);
    expect(errosEndereco({ ...ok, cep: '123', numero: null })).toEqual(['cep', 'numero']);
    expect(errosEndereco({ ...ok, vigenciaInicio: '2026-02-01', vigenciaFim: '2026-01-01' })).toEqual([
      'vigenciaFim',
    ]);
    expect(vigenteEm({ vigenciaInicio: '2026-01-01', vigenciaFim: null }, '2026-11-24')).toBe(true);
    expect(vigenteEm({ vigenciaInicio: null, vigenciaFim: '2026-11-23' }, '2026-11-24')).toBe(false);
  });

  it('telefone: DDD no Brasil, aceite só em tipo que aceita mensagem, recado com contato', () => {
    const ok = {
      ddi: '55',
      ddd: '31',
      numero: '999990000',
      aceitaMensagem: false,
      tipoPermiteMensagem: false,
      tipoRecado: false,
      nomeContato: null,
    };
    expect(errosTelefone(ok)).toEqual([]);
    expect(errosTelefone({ ...ok, ddd: null, aceitaMensagem: true, tipoRecado: true })).toEqual([
      'ddd',
      'aceitaMensagem',
      'nomeContato',
    ]);
  });

  it('e-mail: formato, finalidade e aceite de comunicação só declarado (LGPD)', () => {
    const ok = { email: 'a@b.co', finalidade: 'pessoal', aceitaComunicacao: true, aceiteDeclarado: true };
    expect(errosEmail(ok)).toEqual([]);
    expect(errosEmail({ ...ok, email: 'x', finalidade: 'z', aceiteDeclarado: false })).toEqual([
      'email',
      'finalidade',
      'aceitaComunicacao',
    ]);
  });

  it('um principal só; o primeiro vira principal; o sucessor assume quando o principal sai', () => {
    expect(principalDepois([{ id: 1, principal: true }], { id: 2, principal: true })).toEqual({
      principal: 2,
      desmarcar: [1],
    });
    expect(principalDepois([{ id: 1, principal: true }], { id: 2, principal: false })).toEqual({
      principal: 1,
      desmarcar: [],
    });
    expect(principalDepois([], { id: 3, principal: false })).toEqual({ principal: 3, desmarcar: [] });
    expect(
      sucessorDoPrincipal(
        [
          { id: 4, principal: true },
          { id: 2, principal: false },
        ],
        4,
      ),
    ).toBe(2);
    expect(sucessorDoPrincipal([{ id: 4, principal: false }], 4)).toBeNull();
  });
});

describe('responsáveis do paciente', () => {
  const hoje = '2026-11-24';
  it('idade e poderes padrão', () => {
    expect(idadeEm('2008-11-25', hoje)).toBe(17);
    expect(idadeEm('2008-11-24', hoje)).toBe(18);
    expect(poderesPadrao('curador').autorizarProcedimento).toBe(true);
    expect(poderesPadrao('familiar')).toEqual({
      autorizarProcedimento: false,
      receberInformacao: false,
      retirarDocumento: false,
    });
  });

  it('só representante maior autoriza procedimento; não é o próprio paciente', () => {
    const base = {
      papel: 'familiar',
      poderes: { autorizarProcedimento: true, receberInformacao: true, retirarDocumento: false },
      vigenciaInicio: hoje,
      vigenciaFim: null,
      nascimentoResponsavel: '1980-01-01',
      mesmaPessoaDoPaciente: false,
    };
    expect(errosResponsavel(base, hoje)).toEqual(['autorizarProcedimento']);
    expect(
      errosResponsavel({ ...base, papel: 'responsavel_legal', nascimentoResponsavel: '2010-01-01' }, hoje),
    ).toEqual(['representante-menor']);
    expect(
      errosResponsavel(
        { ...base, papel: 'tutor', mesmaPessoaDoPaciente: true, vigenciaFim: '2020-01-01' },
        hoje,
      ),
    ).toEqual(['mesma-pessoa', 'vigenciaFim']);
    // Representante sem data de nascimento: a maioridade não está provada.
    expect(
      errosResponsavel(
        { ...base, papel: 'curador', poderes: poderesPadrao('curador'), nascimentoResponsavel: null },
        hoje,
      ),
    ).toEqual(['nascimento-representante']);
    expect(
      errosResponsavel({ ...base, poderes: poderesPadrao('familiar'), nascimentoResponsavel: null }, hoje),
    ).toEqual([]);
  });

  it('encerramento: fim ontem; começado hoje ou no futuro fica com o intervalo vazio (nunca vigente)', () => {
    expect(fimDoEncerramento('2026-01-01', hoje)).toBe('2026-11-23');
    expect(fimDoEncerramento(null, hoje)).toBe('2026-11-23');
    expect(fimDoEncerramento(hoje, hoje)).toBe('2026-11-23');
    expect(fimDoEncerramento('2026-12-01', hoje)).toBe('2026-11-30');
    expect(fimDoEncerramento('2027-01-01', hoje)).toBe('2026-12-31');
    for (const inicio of ['2026-01-01', hoje, '2026-12-01'])
      expect(vigenteEm({ vigenciaInicio: inicio, vigenciaFim: fimDoEncerramento(inicio, hoje) }, hoje)).toBe(
        false,
      );
    expect(
      vigenteEm(
        { vigenciaInicio: '2026-12-01', vigenciaFim: fimDoEncerramento('2026-12-01', hoje) },
        '2026-12-01',
      ),
    ).toBe(false);
  });

  it('pendências: menor sem representante e comprovante de curatela ausente', () => {
    expect(
      pendenciasRepresentacao('2015-01-01', [{ id: 1, papel: 'familiar', temComprovante: false }], hoje),
    ).toEqual([{ pendencia: 'menor-sem-representante', vinculo: null }]);
    expect(
      pendenciasRepresentacao('1950-01-01', [{ id: 2, papel: 'curador', temComprovante: false }], hoje),
    ).toEqual([
      // Curador sem a condição de incapacidade registrada (F3.1-02): a ficha pede a condição.
      { pendencia: 'curatela-sem-incapacidade', vinculo: null },
      { pendencia: 'comprovante-ausente', vinculo: 2 },
    ]);
    expect(
      pendenciasRepresentacao('1950-01-01', [{ id: 2, papel: 'curador', temComprovante: false }], hoje, true),
    ).toEqual([{ pendencia: 'comprovante-ausente', vinculo: 2 }]);
    expect(pendenciasRepresentacao('1950-01-01', [], hoje)).toEqual([]);
  });

  it('encerramento: menor não fica sem representante; incapaz não fica sem curador sem o levantamento', () => {
    const v = [
      { id: 1, papel: 'responsavel_legal', temComprovante: true },
      { id: 2, papel: 'familiar', temComprovante: false },
    ];
    expect(recusaEncerramento('2015-01-01', v, 1, hoje, false)).toBe('menor-sem-representante');
    expect(
      recusaEncerramento(
        '2015-01-01',
        [...v, { id: 3, papel: 'tutor', temComprovante: true }],
        1,
        hoje,
        false,
      ),
    ).toBeNull();
    expect(recusaEncerramento('1990-01-01', v, 1, hoje, false)).toBeNull();
    const c = [{ id: 5, papel: 'curador', temComprovante: true }];
    expect(recusaEncerramento('1950-01-01', c, 5, hoje, false)).toBe('incapaz-sem-curador');
    expect(recusaEncerramento('1950-01-01', c, 5, hoje, true)).toBeNull();
  });
});
