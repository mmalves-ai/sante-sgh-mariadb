import { describe, expect, it } from 'vitest';
import {
  RecusaPedido,
  restricoesAcionadas,
  type RegraRestricao,
  type SolicitacaoAvaliada,
} from './pedido.js';
import {
  type AlvoDaExcecao,
  type ExcecaoCadastrada,
  excecaoQueLibera,
  materialDoItem,
  tipoAtendimentoDoPedido,
} from './restricao-contexto.js';

const excecao = (
  x: Partial<ExcecaoCadastrada> & Pick<ExcecaoCadastrada, 'id' | 'abrangencia'>,
): ExcecaoCadastrada => ({
  regra: 7,
  estabelecimento: null,
  setorFuncional: null,
  perfil: null,
  paciente: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const alvo: AlvoDaExcecao = {
  estabelecimento: 1,
  paciente: 50,
  setorFuncional: 30,
  perfis: [4, 9],
  data: '2026-11-24',
};

describe('tipo de atendimento do pedido', () => {
  it('vem do regime do atendimento pelo código oficial, com ou sem zero à esquerda', () => {
    const de = (regimeCodigo: string | null, temInternacao = false, pedidoExterno = false) =>
      tipoAtendimentoDoPedido({ regimeCodigo, temInternacao, pedidoExterno });
    expect(de('01')).toBe('ambulatorial');
    expect(de('1')).toBe('ambulatorial');
    expect(de('02')).toBe('domiciliar');
    expect(de('03')).toBe('internacao');
    expect(de('04')).toBe('urgencia');
    expect(de('05')).toBe('ambulatorial');
  });

  it('o pedido de fora é externo, mesmo com regime; sem regime decide a internação aberta; sem nada fica desconhecido', () => {
    expect(tipoAtendimentoDoPedido({ regimeCodigo: '03', temInternacao: true, pedidoExterno: true })).toBe(
      'externo',
    );
    expect(tipoAtendimentoDoPedido({ regimeCodigo: null, temInternacao: true, pedidoExterno: false })).toBe(
      'internacao',
    );
    expect(
      tipoAtendimentoDoPedido({ regimeCodigo: null, temInternacao: false, pedidoExterno: false }),
    ).toBeNull();
    expect(
      tipoAtendimentoDoPedido({ regimeCodigo: '99', temInternacao: false, pedidoExterno: false }),
    ).toBeNull();
  });

  it('a regra que exige o tipo aciona quando ele diverge e vira alerta quando é desconhecido', () => {
    const regra: RegraRestricao = {
      id: 1,
      exame: 10,
      tipo: 'bloqueio',
      setor: null,
      unidade: null,
      material: null,
      sexo: null,
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      tipoAtendimento: 'internacao',
      diaSemana: null,
      horaInicio: null,
      horaFim: null,
      intervaloMinimoDias: null,
      permiteExcecao: false,
      mensagem: 'Só para paciente internado.',
      vigenciaInicio: '2020-01-01',
      vigenciaFim: null,
    };
    const s = (tipoAtendimento: SolicitacaoAvaliada['tipoAtendimento']): SolicitacaoAvaliada => ({
      exame: 10,
      setor: null,
      material: null,
      unidade: null,
      tipoAtendimento,
      sexo: null,
      idadeDias: null,
      data: '2026-11-24',
      hora: '10:00',
      anteriores: [],
    });
    expect(restricoesAcionadas([regra], s('internacao'))).toEqual([]);
    expect(restricoesAcionadas([regra], s('ambulatorial'))).toMatchObject([
      { motivo: 'atendimento', tipo: 'bloqueio' },
    ]);
    const incerto = restricoesAcionadas([regra], s(null));
    expect(incerto).toMatchObject([{ motivo: 'atendimento', tipo: 'alerta' }]);
    expect(incerto[0]!.mensagem).toContain('tipo de atendimento não informado');
  });
});

describe('exceção que libera a regra', () => {
  it('casa pelo paciente, pelo setor que pede, pelo perfil de quem pede e pelo estabelecimento', () => {
    expect(excecaoQueLibera([excecao({ id: 1, abrangencia: 'paciente', paciente: 50 })], 7, alvo)).toBe(1);
    expect(excecaoQueLibera([excecao({ id: 2, abrangencia: 'setor', setorFuncional: 30 })], 7, alvo)).toBe(2);
    expect(excecaoQueLibera([excecao({ id: 3, abrangencia: 'perfil', perfil: 9 })], 7, alvo)).toBe(3);
    expect(
      excecaoQueLibera([excecao({ id: 4, abrangencia: 'estabelecimento', estabelecimento: 1 })], 7, alvo),
    ).toBe(4);
  });

  it('não casa com outro paciente, outro setor, perfil que quem pede não tem, outro estabelecimento ou outra regra', () => {
    const fora = [
      excecao({ id: 1, abrangencia: 'paciente', paciente: 51 }),
      excecao({ id: 2, abrangencia: 'setor', setorFuncional: 31 }),
      excecao({ id: 3, abrangencia: 'perfil', perfil: 5 }),
      excecao({ id: 4, abrangencia: 'estabelecimento', estabelecimento: 2 }),
      excecao({ id: 5, abrangencia: 'estabelecimento', estabelecimento: 1, regra: 8 }),
    ];
    expect(excecaoQueLibera(fora, 7, alvo)).toBeNull();
    // Atendimento sem setor não casa com exceção de setor; quem não tem perfil não casa com exceção de perfil.
    expect(
      excecaoQueLibera(
        [
          excecao({ id: 6, abrangencia: 'setor', setorFuncional: 30 }),
          excecao({ id: 7, abrangencia: 'perfil', perfil: 9 }),
        ],
        7,
        { ...alvo, setorFuncional: null, perfis: [] },
      ),
    ).toBeNull();
  });

  it('exceção inativa, ainda não vigente ou vencida não libera; o último dia da vigência ainda vale', () => {
    const e = (x: Partial<ExcecaoCadastrada>) => [
      excecao({ id: 1, abrangencia: 'setor', setorFuncional: 30, ...x }),
    ];
    expect(excecaoQueLibera(e({ ativo: false }), 7, alvo)).toBeNull();
    expect(excecaoQueLibera(e({ vigenciaInicio: '2026-11-25' }), 7, alvo)).toBeNull();
    expect(excecaoQueLibera(e({ vigenciaFim: '2026-11-23' }), 7, alvo)).toBeNull();
    expect(excecaoQueLibera(e({ vigenciaFim: '2026-11-24' }), 7, alvo)).toBe(1);
  });

  it('com mais de uma, vence a mais específica e, no empate, a mais antiga', () => {
    const varias = [
      excecao({ id: 9, abrangencia: 'estabelecimento', estabelecimento: 1 }),
      excecao({ id: 8, abrangencia: 'perfil', perfil: 4 }),
      excecao({ id: 7, abrangencia: 'setor', setorFuncional: 30 }),
      excecao({ id: 6, abrangencia: 'setor', setorFuncional: 30 }),
    ];
    expect(excecaoQueLibera(varias, 7, alvo)).toBe(6);
    expect(
      excecaoQueLibera([...varias, excecao({ id: 20, abrangencia: 'paciente', paciente: 50 })], 7, alvo),
    ).toBe(20);
  });
});

describe('material do item pedido', () => {
  const aceitos = [
    { material: 12, padrao: false },
    { material: 5, padrao: true },
    { material: 3, padrao: false },
  ];

  it('sem escolha vale o padrão do cadastro; sem padrão marcado, o primeiro; exame sem material fica sem', () => {
    expect(materialDoItem(null, aceitos)).toBe(5);
    expect(
      materialDoItem(
        null,
        aceitos.map((m) => ({ ...m, padrao: false })),
      ),
    ).toBe(3);
    expect(materialDoItem(null, [])).toBeNull();
  });

  it('o material escolhido na tela prevalece quando o exame o aceita', () => {
    expect(materialDoItem(12, aceitos)).toBe(12);
  });

  it('material fora do cadastro do exame é recusado', () => {
    const codigo = (f: () => unknown) => {
      try {
        f();
        return null;
      } catch (e) {
        return e instanceof RecusaPedido ? e.codigo : 'outro';
      }
    };
    expect(codigo(() => materialDoItem(99, aceitos))).toBe('material-invalido');
    expect(codigo(() => materialDoItem(5, []))).toBe('material-invalido');
  });
});
