import { describe, expect, it } from 'vitest';
import {
  conferirAtivacaoTipo,
  conferirDocumentosCirurgia,
  conferirRegistroDocumento,
  conferirRegraDocumento,
  conferirTipoDocumento,
  documentosExigidos,
  estadoDoDocumento,
  type RegraDocumentoCirurgia,
  type RegistroDocumento,
} from './documentos-pre-operatorio.js';

const regra = (r: Partial<RegraDocumentoCirurgia> & { tipo: number }): RegraDocumentoCirurgia => ({
  categoria: 'outro',
  procedimento: null,
  fontePagadora: null,
  faixa: null,
  validadeDias: null,
  obrigatorio: true,
  bloqueiaEntradaSala: false,
  geraPendencia: true,
  ...r,
});
const cirurgia = { procedimentos: [10], fontePagadora: 5, idade: { dias: 25_000, meses: 820, anos: 68 } };
const reg = (r: Partial<RegistroDocumento> & { tipo: number }): RegistroDocumento => ({
  sequencia: 1,
  situacao: 'apresentado',
  apresentadoEm: '2030-03-01',
  validoAte: null,
  ...r,
});

describe('documentos exigidos pela cirurgia', () => {
  it('aplica a regra pelo procedimento, pela fonte pagadora e pela faixa etária; nulo vale para todos', () => {
    const r = documentosExigidos(
      [
        regra({ tipo: 1, categoria: 'consentimento' }),
        regra({ tipo: 2, procedimento: 10, bloqueiaEntradaSala: true }),
        regra({ tipo: 3, procedimento: 99 }),
        regra({ tipo: 4, fontePagadora: 6 }),
        regra({ tipo: 5, faixa: { unidade: 'ano', inicial: 60, final: 120 }, categoria: 'risco_cirurgico' }),
        regra({ tipo: 6, faixa: { unidade: 'ano', inicial: 0, final: 17 } }),
        regra({ tipo: 7, obrigatorio: false }),
      ],
      cirurgia,
    );
    expect(r.map((e) => [e.tipo, e.bloqueia])).toEqual([
      [1, true],
      [2, true],
      [5, false],
    ]);
  });

  it('soma as regras do mesmo tipo: a menor validade e o bloqueio de qualquer uma', () => {
    const [e] = documentosExigidos(
      [regra({ tipo: 1, validadeDias: 90 }), regra({ tipo: 1, validadeDias: 30, bloqueiaEntradaSala: true })],
      cirurgia,
    );
    expect(e).toMatchObject({ validadeDias: 30, bloqueia: true, geraPendencia: true });
  });

  it('faixa etária sem a idade do paciente não se aplica', () => {
    expect(
      documentosExigidos([regra({ tipo: 1, faixa: { unidade: 'mes', inicial: 0, final: 12 } })], {
        ...cirurgia,
        idade: null,
      }),
    ).toEqual([]);
  });
});

describe('estado do documento na data da cirurgia', () => {
  const exigido = { tipo: 1, categoria: 'exame', validadeDias: 30, bloqueia: true, geraPendencia: true };
  it('pendente sem registro; o registro mais recente vale', () => {
    expect(estadoDoDocumento(exigido, null, '2030-03-10')).toBe('pendente');
  });
  it('vence pela validade em dias contada da data do documento e pela data de validade', () => {
    expect(estadoDoDocumento(exigido, reg({ tipo: 1, apresentadoEm: '2030-02-08' }), '2030-03-10')).toBe(
      'apresentado',
    );
    expect(estadoDoDocumento(exigido, reg({ tipo: 1, apresentadoEm: '2030-02-07' }), '2030-03-10')).toBe(
      'vencido',
    );
    expect(estadoDoDocumento(exigido, reg({ tipo: 1, validoAte: '2030-03-09' }), '2030-03-10')).toBe(
      'vencido',
    );
  });
  it('dispensado e recusado', () => {
    expect(estadoDoDocumento(exigido, reg({ tipo: 1, situacao: 'dispensado' }), '2030-03-10')).toBe(
      'dispensado',
    );
    expect(estadoDoDocumento(exigido, reg({ tipo: 1, situacao: 'recusado' }), '2030-03-10')).toBe('recusado');
  });
});

describe('bloqueio da confirmação e do início', () => {
  const exigidos = documentosExigidos(
    [
      regra({ tipo: 1, categoria: 'consentimento', geraPendencia: false }),
      regra({ tipo: 2, categoria: 'exame', geraPendencia: true }),
    ],
    cirurgia,
  );
  it('o início é recusado sem o consentimento; o exame só pendente não bloqueia o início', () => {
    const r = conferirDocumentosCirurgia(exigidos, [], 'no_bloco', '2030-03-10');
    expect(r).toMatchObject({ ok: false, codigo: 'documentos-pendentes', faltam: [1] });
    expect(conferirDocumentosCirurgia(exigidos, [reg({ tipo: 1 })], 'em_andamento', '2030-03-10')).toEqual({
      ok: true,
    });
  });
  it('a confirmação é recusada com o documento que gera pendência em falta', () => {
    expect(conferirDocumentosCirurgia(exigidos, [reg({ tipo: 1 })], 'confirmado', null)).toMatchObject({
      ok: false,
      faltam: [2],
    });
    expect(conferirDocumentosCirurgia(exigidos, [], 'agendado', null)).toEqual({ ok: true });
  });
  it('a ida direta a realizado (de confirmado ou do bloco) exige os documentos que bloqueiam', () => {
    const r = conferirDocumentosCirurgia(exigidos, [reg({ tipo: 2 })], 'realizado', '2030-03-10');
    expect(r).toMatchObject({ ok: false, codigo: 'documentos-pendentes', faltam: [1] });
    expect(r.ok ? '' : r.mensagem).toMatch(/realizada/);
    expect(conferirDocumentosCirurgia(exigidos, [reg({ tipo: 1 })], 'realizado', '2030-03-10')).toEqual({
      ok: true,
    });
  });
  it('vale o registro mais recente: recusado depois do apresentado volta a bloquear', () => {
    const regs = [reg({ tipo: 1, sequencia: 1 }), reg({ tipo: 1, sequencia: 2, situacao: 'recusado' })];
    expect(conferirDocumentosCirurgia(exigidos, regs, 'no_bloco', '2030-03-10').ok).toBe(false);
  });
});

describe('registro do documento', () => {
  const ctx = {
    situacaoCirurgia: 'agendado',
    natureza: 'eletiva',
    categoria: 'consentimento',
    hoje: '2030-03-05',
  };
  it('apresentado exige a data do documento, não futura, e validade não anterior a ela', () => {
    expect(
      conferirRegistroDocumento(
        { situacao: 'apresentado', observacao: null, apresentadoEm: '2030-03-01', validoAte: null },
        ctx,
      ),
    ).toEqual([]);
    expect(
      conferirRegistroDocumento(
        { situacao: 'apresentado', observacao: null, apresentadoEm: '2030-03-06', validoAte: '2030-03-01' },
        ctx,
      ).map((p) => p.campo),
    ).toEqual(['apresentadoEm', 'validoAte']);
  });
  it('consentimento não é dispensado na eletiva; na urgência, com justificativa', () => {
    const dispensa = {
      situacao: 'dispensado' as const,
      observacao: 'paciente inconsciente',
      apresentadoEm: null,
      validoAte: null,
    };
    expect(conferirRegistroDocumento(dispensa, ctx).map((p) => p.campo)).toEqual(['situacao']);
    expect(conferirRegistroDocumento(dispensa, { ...ctx, natureza: 'emergencia' })).toEqual([]);
    expect(
      conferirRegistroDocumento({ ...dispensa, observacao: 'curta' }, { ...ctx, natureza: 'emergencia' }),
    ).toHaveLength(1);
  });
  it('cirurgia realizada ou tipo inexistente recusam', () => {
    expect(
      conferirRegistroDocumento(
        { situacao: 'apresentado', observacao: null, apresentadoEm: '2030-03-01', validoAte: null },
        { ...ctx, situacaoCirurgia: 'realizado', categoria: null },
      ).map((p) => p.campo),
    ).toEqual(['agendamento', 'tipo']);
  });
});

describe('cadastro da regra e do tipo', () => {
  const e = {
    tipo: 1,
    procedimento: null,
    fontePagadora: null,
    faixaEtaria: null,
    validadeDias: 30,
    bloqueiaEntradaSala: false,
    geraPendencia: true,
  };
  it('consentimento e avaliação sempre bloqueiam; validade de 1 a 3650 dias', () => {
    expect(conferirRegraDocumento(e, { ativo: true, categoria: 'exame' })).toEqual([]);
    expect(
      conferirRegraDocumento({ ...e, validadeDias: 0 }, { ativo: true, categoria: 'avaliacao' }).map(
        (p) => p.campo,
      ),
    ).toEqual(['validadeDias', 'bloqueiaEntradaSala']);
    expect(conferirRegraDocumento(e, null).map((p) => p.campo)).toEqual(['tipo']);
  });
  it('tipo com código, descrição e categoria', () => {
    expect(
      conferirTipoDocumento({
        codigo: 'TCLE',
        descricao: 'Termo de consentimento',
        categoria: 'consentimento',
        validadeDias: null,
      }),
    ).toEqual([]);
    expect(
      conferirTipoDocumento({ codigo: 'a b', descricao: '', categoria: 'x', validadeDias: 5000 }).map(
        (p) => p.campo,
      ),
    ).toEqual(['codigo', 'descricao', 'categoria', 'validadeDias']);
  });
  it('desativar o tipo: nunca o exigido em toda cirurgia nem o tipo com regra ativa; reativar sempre', () => {
    const base = { obrigatorioGeral: false, regrasAtivasNoEstabelecimento: 0, regrasAtivasEmOutros: 0 };
    expect(conferirAtivacaoTipo({ ...base, ativo: false })).toEqual([]);
    expect(conferirAtivacaoTipo({ ...base, ativo: false, obrigatorioGeral: true })).toHaveLength(1);
    expect(
      conferirAtivacaoTipo({
        ...base,
        ativo: false,
        regrasAtivasNoEstabelecimento: 1,
        regrasAtivasEmOutros: 2,
      }).map((p) => p.mensagem),
    ).toEqual([
      expect.stringMatching(/deste estabelecimento/),
      expect.stringMatching(/outros estabelecimentos/),
    ]);
    expect(
      conferirAtivacaoTipo({ ...base, ativo: true, obrigatorioGeral: true, regrasAtivasEmOutros: 3 }),
    ).toEqual([]);
  });
});
