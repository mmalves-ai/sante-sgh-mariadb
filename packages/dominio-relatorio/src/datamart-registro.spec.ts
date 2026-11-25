import { describe, expect, it } from 'vitest';
import { cargaDevida, fecharCarga, mensagemSemValores, tipoDoObjeto } from './datamart-registro.js';

describe('registro da carga do data mart (01-ADM L115)', () => {
  it('a carga do dia é devida depois da hora da carga e uma vez por dia civil', () => {
    expect(cargaDevida({ hoje: '2026-11-25', hora: 1, ultimaIniciadaNoDia: null })).toBe(false);
    expect(cargaDevida({ hoje: '2026-11-25', hora: 2, ultimaIniciadaNoDia: null })).toBe(true);
    expect(cargaDevida({ hoje: '2026-11-25', hora: 9, ultimaIniciadaNoDia: '2026-11-24' })).toBe(true);
    expect(cargaDevida({ hoje: '2026-11-25', hora: 9, ultimaIniciadaNoDia: '2026-11-25' })).toBe(false);
    expect(cargaDevida({ hoje: '2026-11-25', hora: 5, ultimaIniciadaNoDia: null, horaDaCarga: 6 })).toBe(
      false,
    );
    expect(() => cargaDevida({ hoje: '25/11/2026', hora: 5, ultimaIniciadaNoDia: null })).toThrow(/dia/);
  });

  it('fato_* é fato; o resto é dimensão', () => {
    expect(tipoDoObjeto('fato_internacao_dia')).toBe('fato');
    expect(tipoDoObjeto('carga')).toBe('dimensao');
  });

  it('fecha a carga com as etapas na ordem, as linhas somadas e a situação', () => {
    const f = fecharCarga([
      { objeto: 'fato_internacao', linhas: 10, duracaoMs: 5 },
      { objeto: 'fato_atendimento', linhas: 3, duracaoMs: 1 },
      { objeto: 'carga', linhas: 1, duracaoMs: 0 },
    ]);
    expect(f).toMatchObject({
      situacao: 'concluida',
      linhasGravadas: 14,
      linhasRejeitadas: 0,
      mensagemErro: null,
    });
    expect(f.etapas.map((e) => [e.sequencia, e.tipoObjeto, e.objeto, e.situacao])).toEqual([
      [1, 'fato', 'fato_internacao', 'concluida'],
      [2, 'fato', 'fato_atendimento', 'concluida'],
      [3, 'dimensao', 'carga', 'concluida'],
    ]);
    expect(
      fecharCarga([{ objeto: 'fato_item_conta', linhas: 4, rejeitadas: 2, duracaoMs: 1 }]).situacao,
    ).toBe('concluida_com_rejeicao');
  });

  it('a falha registra a mensagem sem valores e as etapas como falhas', () => {
    const f = fecharCarga(
      [{ objeto: 'fato_internacao', linhas: 10, duracaoMs: 5 }],
      new Error("paciente 'Fulano Sintético' prontuário 123456 sem estabelecimento"),
    );
    expect(f.situacao).toBe('falhou');
    expect(f.linhasGravadas).toBe(0);
    expect(f.mensagemErro).toBe('Error: paciente … prontuário … sem estabelecimento');
    expect(f.etapas[0]?.situacao).toBe('falhou');
    expect(mensagemSemValores('x')).toBe('falha sem mensagem');
    expect(mensagemSemValores(new Error('a'.repeat(2000))).length).toBe(1000);
  });

  it('recusa objeto inválido, repetido ou contagem negativa', () => {
    expect(() => fecharCarga([{ objeto: 'Fato X', linhas: 1, duracaoMs: 0 }])).toThrow(/nome inválido/);
    expect(() =>
      fecharCarga([
        { objeto: 'carga', linhas: 1, duracaoMs: 0 },
        { objeto: 'carga', linhas: 1, duracaoMs: 0 },
      ]),
    ).toThrow(/repetido/);
    expect(() => fecharCarga([{ objeto: 'carga', linhas: -1, duracaoMs: 0 }])).toThrow(/contagem/);
  });
});
