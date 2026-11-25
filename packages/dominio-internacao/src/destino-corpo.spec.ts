import { describe, expect, it } from 'vitest';
import {
  conferirAberturaGuarda,
  declaracaoVigente,
  decidirAcaoLiberacao,
  decidirDestinoDeclaracao,
  pendenciasDestinoCorpo,
  validarFuneraria,
} from './destino-corpo.js';

const T0 = new Date('2026-11-20T10:00:00Z');
const mais = (min: number) => new Date(T0.getTime() + min * 60_000);
const campos = (r: { ok: boolean; problemas?: readonly { campo: string }[] }) =>
  r.ok ? [] : (r.problemas ?? []).map((p) => p.campo);

describe('validarFuneraria', () => {
  it('normaliza telefones e textos', () => {
    const r = validarFuneraria({
      nome: '  Funerária   Sintética ',
      telefonePlantao: '(11) 99999-0000',
      email: ' ',
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        nome: 'Funerária Sintética',
        telefone: null,
        telefonePlantao: '11999990000',
        email: null,
        documentosExigidos: null,
        observacao: null,
      },
    });
  });
  it('recusa nome curto, telefone sem DDD, e-mail inválido e falta de telefone', () => {
    expect(campos(validarFuneraria({ nome: 'ab', telefone: '9999-0000', email: 'x@' }))).toEqual([
      'nome',
      'telefone',
      'email',
    ]);
    expect(campos(validarFuneraria({ nome: 'Funerária' }))).toEqual(['telefone']);
  });
});

describe('decidirDestinoDeclaracao', () => {
  it('aceita a escolha em uso na declaração não cancelada', () => {
    expect(
      decidirDestinoDeclaracao({
        situacaoDeclaracao: 'rascunho',
        funeraria: { ativo: true },
        funerariaMudou: true,
        cartorio: { ativo: true },
        cartorioMudou: true,
      }).ok,
    ).toBe(true);
  });
  it('recusa declaração cancelada e escolha nova fora de uso; o que já estava segue', () => {
    expect(
      campos(
        decidirDestinoDeclaracao({
          situacaoDeclaracao: 'cancelada',
          funeraria: { ativo: false },
          funerariaMudou: true,
          cartorio: { ativo: false },
          cartorioMudou: true,
        }),
      ),
    ).toEqual(['declaracao', 'funeraria', 'cartorio']);
    expect(
      decidirDestinoDeclaracao({
        situacaoDeclaracao: 'emitida',
        funeraria: { ativo: false },
        funerariaMudou: false,
        cartorio: null,
        cartorioMudou: true,
      }).ok,
    ).toBe(true);
  });
});

describe('guarda e liberação do corpo', () => {
  it('abertura: uma por atendimento, entrada entre o óbito e agora', () => {
    expect(
      conferirAberturaGuarda({
        obitoEm: T0,
        entradaNecroterioEm: mais(30),
        agora: mais(60),
        guardaDoAtendimento: null,
      }).ok,
    ).toBe(true);
    expect(
      campos(
        conferirAberturaGuarda({
          obitoEm: T0,
          entradaNecroterioEm: mais(-5),
          agora: mais(60),
          guardaDoAtendimento: 'em_guarda',
        }),
      ),
    ).toEqual(['atendimento', 'entradaNecroterio']);
    for (const g of ['liberado', 'retirado', 'encaminhado_iml'] as const)
      expect(
        campos(
          conferirAberturaGuarda({
            obitoEm: T0,
            entradaNecroterioEm: null,
            agora: mais(60),
            guardaDoAtendimento: g,
          }),
        ),
      ).toEqual(['atendimento']);
    expect(
      conferirAberturaGuarda({
        obitoEm: T0,
        entradaNecroterioEm: null,
        agora: mais(60),
        guardaDoAtendimento: null,
      }),
    ).toEqual({ ok: true, reabrir: false });
  });

  it('guarda cancelada é reaberta, nunca duplicada', () => {
    expect(
      conferirAberturaGuarda({
        obitoEm: T0,
        entradaNecroterioEm: mais(30),
        agora: mais(60),
        guardaDoAtendimento: 'cancelado',
      }),
    ).toEqual({ ok: true, reabrir: true });
  });

  it('declaração vigente: a não cancelada mais recente', () => {
    expect(
      declaracaoVigente([
        { id: 3, situacao: 'cancelada' },
        { id: 1, situacao: 'emitida' },
        { id: 2, situacao: 'rascunho' },
      ])?.id,
    ).toBe(2);
    expect(declaracaoVigente([{ id: 5, situacao: 'cancelada' }])).toBeNull();
    expect(declaracaoVigente([])).toBeNull();
  });

  const liberar = {
    agora: mais(120),
    obitoEm: T0,
    declaracao: 'emitida' as const,
    funeraria: { ativo: true },
    retiranteNome: 'Pessoa sintética',
    retiranteCpf: '529.982.247-25',
    documentosConferidos: true,
    declaracaoEntregue: true,
  };

  it('libera com declaração emitida e entregue, documentos conferidos e quem retira identificado', () => {
    expect(decidirAcaoLiberacao('em_guarda', 'liberar', liberar)).toEqual({
      ok: true,
      nova: 'liberado',
      retiranteCpf: '52998224725',
    });
  });

  it('sem declaração emitida não libera; o caminho é o encaminhamento', () => {
    expect(
      campos(decidirAcaoLiberacao('em_guarda', 'liberar', { ...liberar, declaracao: 'rascunho' })),
    ).toEqual(['declaracao']);
    expect(
      decidirAcaoLiberacao('em_guarda', 'encaminhar_iml', { agora: mais(10), obitoEm: T0, declaracao: null }),
    ).toEqual({ ok: true, nova: 'encaminhado_iml', retiranteCpf: null });
  });

  it('recusa liberação sem conferência, sem entrega, com CPF inválido e sem documento', () => {
    expect(
      campos(
        decidirAcaoLiberacao('em_guarda', 'liberar', {
          ...liberar,
          documentosConferidos: false,
          declaracaoEntregue: false,
          retiranteCpf: '111.111.111-11',
          funeraria: { ativo: false },
        }),
      ),
    ).toEqual(['declaracaoEntregue', 'documentosConferidos', 'funeraria', 'retiranteCpf']);
    expect(
      campos(
        decidirAcaoLiberacao('em_guarda', 'liberar', {
          ...liberar,
          retiranteCpf: null,
          retiranteDocumento: ' ',
        }),
      ),
    ).toEqual(['retiranteDocumento']);
  });

  it('retirada depois da liberação e nunca no futuro; cancelamento com motivo; passagem inválida recusada', () => {
    const base = { agora: mais(240), obitoEm: T0, liberadoEm: mais(120), declaracao: 'emitida' as const };
    expect(decidirAcaoLiberacao('liberado', 'retirar', { ...base, retiradaEm: mais(180) }).ok).toBe(true);
    expect(campos(decidirAcaoLiberacao('liberado', 'retirar', { ...base, retiradaEm: mais(60) }))).toEqual([
      'retiradaEm',
    ]);
    expect(campos(decidirAcaoLiberacao('liberado', 'retirar', { ...base, retiradaEm: mais(600) }))).toEqual([
      'retiradaEm',
    ]);
    expect(campos(decidirAcaoLiberacao('liberado', 'cancelar', { ...base, motivo: 'curto' }))).toEqual([
      'motivo',
    ]);
    expect(
      decidirAcaoLiberacao('liberado', 'cancelar', { ...base, motivo: 'Família desistiu da funerária' }).ok,
    ).toBe(true);
    expect(
      campos(decidirAcaoLiberacao('retirado', 'cancelar', { ...base, motivo: 'Motivo longo o bastante' })),
    ).toEqual(['situacao']);
  });

  it('pendências do destino do corpo', () => {
    expect(
      pendenciasDestinoCorpo({
        declaracao: 'rascunho',
        funerariaEscolhida: false,
        cartorioEscolhido: true,
        guarda: null,
      }),
    ).toEqual(['emitir-declaracao', 'funeraria', 'guarda']);
    expect(
      pendenciasDestinoCorpo({
        declaracao: 'emitida',
        funerariaEscolhida: true,
        cartorioEscolhido: true,
        guarda: 'retirado',
      }),
    ).toEqual([]);
    expect(
      pendenciasDestinoCorpo({
        declaracao: 'emitida',
        funerariaEscolhida: true,
        cartorioEscolhido: true,
        guarda: 'cancelado',
      }),
    ).toEqual(['guarda']);
  });
});
