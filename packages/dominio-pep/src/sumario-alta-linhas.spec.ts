// Sumário de alta por seção (F3.3, linha 03-PEP L124): linhas gravadas na ordem e com o título das seções vigentes,
// piso legal do diagnóstico, CID sem ponto, e a janela de cada seção recortando o episódio antes da montagem.
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  cid10DaLinha,
  episodioNasJanelas,
  GRUPOS_LINHA_SUMARIO,
  grupoDaSecao,
  itensNaJanela,
  linhasDoSumario,
} from './sumario-alta-linhas.js';
import { SECOES_PADRAO, type SecaoVigente, TIPOS_CONTEUDO_SECAO } from './sumario-alta-secoes.js';

const sec = (o: Partial<SecaoVigente>): SecaoVigente => ({
  codigo: 'x',
  descricao: 'X',
  tipoConteudo: 'texto_livre',
  ordem: 10,
  obrigatorio: false,
  periodo: null,
  origem: 'estabelecimento',
  ...o,
});
const s: SumarioAltaEstruturado = {
  motivoInternacao: 'Dor torácica',
  diagnosticos: [
    { cid: 'i21.0', descricao: 'Infarto agudo' },
    { cid: 'XYZ', descricao: 'Sem código válido' },
  ],
  procedimentos: ['Angioplastia', ' '],
  medicamentosAlta: ['AAS 100 mg'],
  alergias: [],
  encaminhamentos: ['Cardiologia'],
  plano: 'Retorno em 7 dias',
  condicaoAlta: 'Estável',
  secoes: [{ codigo: 'orient', texto: 'Repouso relativo' }],
};

describe('linhas do sumário por seção', () => {
  it('na ordem das seções vigentes, com o título do cadastro e uma linha por item; seção vazia não gera linha', () => {
    const secoes = [
      sec({ codigo: 'cond', descricao: 'Como sai', tipoConteudo: 'condicao_alta', ordem: 1 }),
      sec({ codigo: 'dx', descricao: 'Hipóteses finais', tipoConteudo: 'diagnosticos', ordem: 2 }),
      sec({ codigo: 'proc', descricao: 'Cirurgias', tipoConteudo: 'procedimentos', ordem: 3 }),
      sec({ codigo: 'alg', descricao: 'Alergias', tipoConteudo: 'alergias', ordem: 4 }),
      sec({ codigo: 'orient', descricao: 'Orientações ao paciente', tipoConteudo: 'orientacoes', ordem: 5 }),
      sec({ codigo: 'plano', descricao: 'Plano', tipoConteudo: 'plano_terapeutico', ordem: 6 }),
    ];
    const l = linhasDoSumario(s, secoes);
    expect(l.map((x) => [x.sequencia, x.grupo, x.secao, x.titulo, x.texto, x.cid10])).toEqual([
      [1, 'condicao_alta', 'cond', 'Como sai', 'Estável', null],
      [2, 'diagnosticos', 'dx', 'Hipóteses finais', 'Infarto agudo', 'I210'],
      [3, 'diagnosticos', 'dx', 'Hipóteses finais', 'Sem código válido', null],
      [4, 'procedimentos', 'proc', 'Cirurgias', 'Angioplastia', null],
      [5, 'orientacoes', 'orient', 'Orientações ao paciente', 'Repouso relativo', null],
      [6, 'plano', 'plano', 'Plano', 'Retorno em 7 dias', null],
      [7, 'encaminhamentos', 'plano', 'Plano', 'Cardiologia', null],
    ]);
  });

  it('o diagnóstico é piso legal: sem seção de diagnóstico, as linhas dele entram no fim', () => {
    const l = linhasDoSumario(s, [
      sec({ codigo: 'cond', descricao: 'Condição', tipoConteudo: 'condicao_alta' }),
    ]);
    expect(l.map((x) => [x.grupo, x.titulo, x.cid10])).toEqual([
      ['condicao_alta', 'Condição', null],
      ['diagnosticos', 'Diagnósticos', 'I210'],
      ['diagnosticos', 'Diagnósticos', null],
    ]);
  });

  it('conjunto padrão: o motivo entra pelo motivo da internação e os medicamentos na alta têm linha própria', () => {
    const l = linhasDoSumario(s, SECOES_PADRAO);
    expect(l[0]).toMatchObject({ grupo: 'motivo_internacao', secao: 'motivo', texto: 'Dor torácica' });
    expect(l.filter((x) => x.grupo === 'medicamentos_alta').map((x) => x.texto)).toEqual(['AAS 100 mg']);
    expect(l.map((x) => x.sequencia)).toEqual(l.map((_x, i) => i + 1));
  });

  it('todo tipo de seção cai num grupo do domínio fechado da coluna; texto livre próprio é "outros"', () => {
    for (const t of TIPOS_CONTEUDO_SECAO) expect(GRUPOS_LINHA_SUMARIO).toContain(grupoDaSecao(t, 'qualquer'));
    expect(grupoDaSecao('texto_livre', 'motivo')).toBe('motivo_internacao');
    expect(grupoDaSecao('dispositivos', 'cateter')).toBe('outros');
    expect(cid10DaLinha('A00.1')).toBe('A001');
    expect(cid10DaLinha('12345')).toBeNull();
    expect(cid10DaLinha(undefined)).toBeNull();
  });
});

describe('janela da seção recortando o episódio', () => {
  const itens = [
    { texto: 'Hemograma', em: '2026-11-01T10:00:00Z' },
    { texto: 'Troponina', em: '2026-11-03T08:00:00Z' },
    { texto: 'Troponina', em: '2026-11-03T20:00:00Z' },
    { texto: 'ECG', em: '2026-11-03T20:00:00Z' },
    { texto: 'Sem data', em: null },
  ];
  it('sem janela, tudo (sem repetir); com janela, só os datados dentro; "último" só o momento mais recente', () => {
    expect(itensNaJanela(itens, null)).toEqual(['Hemograma', 'Troponina', 'ECG', 'Sem data']);
    expect(
      itensNaJanela(itens, { desde: '2026-11-02T20:00:00Z', ate: '2026-11-03T20:00:00Z', ultimo: false }),
    ).toEqual(['Troponina', 'ECG']);
    expect(
      itensNaJanela(itens, { desde: '2026-11-01T00:00:00Z', ate: '2026-11-04T00:00:00Z', ultimo: true }),
    ).toEqual(['Troponina', 'ECG']);
    expect(
      itensNaJanela(itens, { desde: '2026-11-05T00:00:00Z', ate: '2026-11-06T00:00:00Z', ultimo: true }),
    ).toEqual([]);
  });

  it('cada tipo pela janela da sua seção; sem seção do tipo, o episódio inteiro', () => {
    const r = episodioNasJanelas(
      {
        procedimentos: [
          { texto: 'Cateterismo', em: '2026-11-01T12:00:00Z' },
          { texto: 'Angioplastia', em: '2026-11-03T12:00:00Z' },
        ],
        exames: itens,
      },
      [
        {
          tipoConteudo: 'procedimentos',
          janela: { desde: '2026-11-02T20:00:00Z', ate: '2026-11-03T20:00:00Z', ultimo: false },
        },
      ],
    );
    expect(r).toEqual({
      procedimentos: ['Angioplastia'],
      exames: ['Hemograma', 'Troponina', 'ECG', 'Sem data'],
    });
  });
});
