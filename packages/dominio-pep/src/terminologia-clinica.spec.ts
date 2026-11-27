import { describe, expect, it } from 'vitest';
import {
  regiaoDoItemPedido,
  nivelRegiaoPorProfundidade,
  ordenarSugestoesConceito,
  type TermoCatalogo,
  validarConceitoClinico,
  validarPadraoDoExame,
  validarRegiaoDoExame,
  validarRegistroDiagnostico,
  validarTrocaConceito,
} from './terminologia-clinica.js';

const HOJE = new Date('2026-11-25T12:00:00Z');
const cid = (o: Partial<TermoCatalogo> = {}): TermoCatalogo => ({
  terminologia: 'cid10',
  ativo: true,
  nivel: 4,
  vigenciaFim: null,
  ...o,
});
const conceito = (o: Partial<TermoCatalogo> = {}): TermoCatalogo => ({
  terminologia: 'snomed',
  ativo: true,
  nivel: null,
  vigenciaFim: null,
  ...o,
});
const base = {
  cid: cid(),
  tipo: 'secundario' as const,
  atendimentoDoPaciente: true,
  atendimentoDoEstabelecimento: true,
  principalAtivoExiste: false,
};
const codigos = (f: readonly { codigo: string }[]) => f.map((x) => x.codigo);

describe('conceito clínico equivalente', () => {
  it('aceita conceito ativo da terminologia clínica, e a ausência (opcional)', () => {
    expect(validarConceitoClinico(conceito(), HOJE)).toEqual([]);
    expect(validarConceitoClinico(undefined, HOJE)).toEqual([]);
  });
  it('recusa inexistente, de outra terminologia, inativo e vencido', () => {
    expect(codigos(validarConceitoClinico(null, HOJE))).toEqual(['conceito-inexistente']);
    expect(codigos(validarConceitoClinico(cid(), HOJE))).toEqual(['conceito-de-outra-terminologia']);
    expect(codigos(validarConceitoClinico(conceito({ ativo: false }), HOJE))).toEqual(['conceito-inativo']);
    expect(
      codigos(validarConceitoClinico(conceito({ vigenciaFim: new Date('2026-11-24T00:00:00Z') }), HOJE)),
    ).toEqual(['conceito-inativo']);
    expect(validarConceitoClinico(conceito({ vigenciaFim: new Date('2026-11-25T00:00:00Z') }), HOJE)).toEqual(
      [],
    );
  });
});

describe('registro do diagnóstico do atendimento', () => {
  it('aceita CID de categoria ou subcategoria, com ou sem conceito', () => {
    expect(validarRegistroDiagnostico(base, HOJE)).toEqual([]);
    expect(
      validarRegistroDiagnostico({ ...base, cid: cid({ nivel: 3 }), conceito: conceito() }, HOJE),
    ).toEqual([]);
  });
  it('recusa capítulo/agrupamento, CID inexistente, de outra terminologia ou inativa', () => {
    expect(codigos(validarRegistroDiagnostico({ ...base, cid: cid({ nivel: 2 }) }, HOJE))).toEqual([
      'cid-nao-codificavel',
    ]);
    expect(codigos(validarRegistroDiagnostico({ ...base, cid: null }, HOJE))).toEqual(['cid-inexistente']);
    expect(codigos(validarRegistroDiagnostico({ ...base, cid: conceito() }, HOJE))).toEqual([
      'cid-de-outra-terminologia',
    ]);
    expect(codigos(validarRegistroDiagnostico({ ...base, cid: cid({ ativo: false }) }, HOJE))).toEqual([
      'cid-inativa',
    ]);
  });
  it('um só principal ativo por atendimento; atendimento do paciente; conceito válido; observação no limite', () => {
    expect(
      codigos(validarRegistroDiagnostico({ ...base, tipo: 'principal', principalAtivoExiste: true }, HOJE)),
    ).toEqual(['principal-ja-registrado']);
    expect(validarRegistroDiagnostico({ ...base, principalAtivoExiste: true }, HOJE)).toEqual([]);
    expect(codigos(validarRegistroDiagnostico({ ...base, atendimentoDoPaciente: false }, HOJE))).toEqual([
      'atendimento-de-outro-paciente',
    ]);
    expect(
      codigos(validarRegistroDiagnostico({ ...base, atendimentoDoEstabelecimento: false }, HOJE)),
    ).toEqual(['atendimento-de-outro-estabelecimento']);
    expect(
      codigos(validarRegistroDiagnostico({ ...base, conceito: conceito({ ativo: false }) }, HOJE)),
    ).toEqual(['conceito-inativo']);
    expect(codigos(validarRegistroDiagnostico({ ...base, observacao: 'x'.repeat(2001) }, HOJE))).toEqual([
      'observacao-longa',
    ]);
  });
});

describe('troca do conceito e região do exame', () => {
  it('não troca o conceito do diagnóstico inativado; tirar (null explícito é inexistente, undefined não)', () => {
    expect(codigos(validarTrocaConceito({ situacao: 'inativado' }, conceito(), HOJE))).toEqual([
      'diagnostico-inativado',
    ]);
    expect(validarTrocaConceito({ situacao: 'ativo' }, conceito(), HOJE)).toEqual([]);
    expect(validarTrocaConceito({ situacao: 'resolvido' }, undefined, HOJE)).toEqual([]);
  });
  it('não troca o conceito do diagnóstico de outro estabelecimento', () => {
    expect(
      codigos(validarTrocaConceito({ situacao: 'ativo', doEstabelecimento: false }, conceito(), HOJE)),
    ).toEqual(['diagnostico-de-outro-estabelecimento']);
    expect(validarTrocaConceito({ situacao: 'ativo', doEstabelecimento: true }, conceito(), HOJE)).toEqual(
      [],
    );
  });
  it('tornar padrão: só a ligação ativa que ainda não é a padrão', () => {
    expect(validarPadraoDoExame({ ativo: true, padrao: false })).toEqual([]);
    expect(codigos(validarPadraoDoExame(null))).toEqual(['regiao-nao-ligada']);
    expect(codigos(validarPadraoDoExame({ ativo: false, padrao: false }))).toEqual(['regiao-nao-ligada']);
    expect(codigos(validarPadraoDoExame({ ativo: true, padrao: true }))).toEqual(['regiao-ja-padrao']);
  });
  it('nível da região pela profundidade', () => {
    expect([0, 1, 2, 3, 4, 9].map(nivelRegiaoPorProfundidade)).toEqual([
      'regiao',
      'regiao',
      'localizacao_primaria',
      'localizacao',
      'sublocalizacao',
      'sublocalizacao',
    ]);
  });
  it('região do exame: existe, em vigor e não repetida', () => {
    expect(validarRegiaoDoExame({ ativo: true, vigenciaFim: null }, false, HOJE)).toEqual([]);
    expect(codigos(validarRegiaoDoExame(null, false, HOJE))).toEqual(['regiao-inexistente']);
    expect(codigos(validarRegiaoDoExame({ ativo: false, vigenciaFim: null }, false, HOJE))).toEqual([
      'regiao-inativa',
    ]);
    expect(codigos(validarRegiaoDoExame({ ativo: true, vigenciaFim: null }, true, HOJE))).toEqual([
      'regiao-ja-ligada',
    ]);
  });
  it('sugestões: principal, depois equivalente, depois o resto, por descrição', () => {
    const r = ordenarSugestoesConceito([
      { principal: false, tipoEquivalencia: 'mais_amplo', descricao: 'A' },
      { principal: false, tipoEquivalencia: 'equivalente', descricao: 'C' },
      { principal: true, tipoEquivalencia: 'mais_restrito', descricao: 'Z' },
      { principal: false, tipoEquivalencia: 'equivalente', descricao: 'B' },
    ]);
    expect(r.map((x) => x.descricao)).toEqual(['Z', 'B', 'C', 'A']);
  });
});

describe('região anatômica do exame pedido', () => {
  const admitidas = [
    { regiao: 41, padrao: true },
    { regiao: 42, padrao: false },
  ];
  it('sem região informada vale a padrão; sem padrão ou sem ligação, fica sem região', () => {
    expect(regiaoDoItemPedido(null, admitidas)).toEqual({ regiao: 41, falhas: [] });
    expect(regiaoDoItemPedido(null, [{ regiao: 42, padrao: false }])).toEqual({ regiao: null, falhas: [] });
    expect(regiaoDoItemPedido(null, [])).toEqual({ regiao: null, falhas: [] });
  });
  it('a região informada tem de estar ligada e ativa no exame', () => {
    expect(regiaoDoItemPedido(42, admitidas)).toEqual({ regiao: 42, falhas: [] });
    expect(codigos(regiaoDoItemPedido(99, admitidas).falhas)).toEqual(['regiao-nao-admitida']);
    expect(codigos(regiaoDoItemPedido(41, []).falhas)).toEqual(['regiao-nao-admitida']);
  });
});
