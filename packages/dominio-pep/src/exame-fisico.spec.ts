import { describe, expect, it } from 'vitest';
import {
  type CatalogoExame,
  faixaEtariaExame,
  type ItemExame,
  padraoServeAoPaciente,
  regiaoDentroDe,
  registroAceitaExame,
  resumirExamePorSistema,
  textoAchadoExame,
  textoExameDoRegistro,
  validarExameFisico,
} from './exame-fisico.js';

// Catálogo sintético: sistemas 1 (cardiovascular) e 2 (respiratório, inativo 3); regiões 10 tórax, 11 membro
// superior (com lado) dentro de 12 membros, 13 inativa; achados padronizados 100 (normal do cardiovascular),
// 101 (sopro, alterado), 102 (edema no membro superior, alterado), 103 (inativo), 104 (pediátrico), 105 (adulto).
const catalogo: CatalogoExame = {
  sistemas: new Map([
    [1, { id: 1, ativo: true }],
    [2, { id: 2, ativo: true }],
    [3, { id: 3, ativo: false }],
  ]),
  regioes: new Map([
    [10, { id: 10, ativo: true, admiteLateralidade: false, superiorId: null }],
    [12, { id: 12, ativo: true, admiteLateralidade: true, superiorId: null }],
    [11, { id: 11, ativo: true, admiteLateralidade: true, superiorId: 12 }],
    [13, { id: 13, ativo: false, admiteLateralidade: false, superiorId: null }],
  ]),
  padroes: new Map([
    [100, { id: 100, ativo: true, sistemaId: 1, regiaoId: null, normal: true, publicoAlvo: 'todos' }],
    [101, { id: 101, ativo: true, sistemaId: 1, regiaoId: 10, normal: false, publicoAlvo: 'todos' }],
    [102, { id: 102, ativo: true, sistemaId: null, regiaoId: 12, normal: false, publicoAlvo: 'todos' }],
    [103, { id: 103, ativo: false, sistemaId: 2, regiaoId: null, normal: true, publicoAlvo: 'todos' }],
    [104, { id: 104, ativo: true, sistemaId: 2, regiaoId: null, normal: true, publicoAlvo: 'pediatrico' }],
    [105, { id: 105, ativo: true, sistemaId: 2, regiaoId: null, normal: true, publicoAlvo: 'adulto' }],
  ]),
};
const item = (p: Partial<ItemExame>): ItemExame => ({
  sistemaId: null,
  regiaoId: null,
  padraoId: null,
  lateralidade: 'nao_se_aplica',
  normal: null,
  descricao: null,
  ...p,
});
const codigos = (r: { falhas: readonly { codigo: string }[] }) => r.falhas.map((f) => f.codigo);
const em = new Date('2026-11-25T12:00:00Z');

describe('exame físico estruturado: faixa e público', () => {
  it('faixa pela idade no momento clínico', () => {
    expect(faixaEtariaExame(new Date('2026-11-10'), em)).toBe('neonatal');
    expect(faixaEtariaExame(new Date('2010-01-01'), em)).toBe('pediatrico');
    expect(faixaEtariaExame(new Date('2008-11-26'), em)).toBe('pediatrico');
    expect(faixaEtariaExame(new Date('2008-11-25'), em)).toBe('adulto');
    expect(faixaEtariaExame(null, em)).toBeNull();
  });
  it('público do achado padronizado', () => {
    expect(padraoServeAoPaciente('todos', 'neonatal')).toBe(true);
    expect(padraoServeAoPaciente('adulto', null)).toBe(true);
    expect(padraoServeAoPaciente('adulto', 'pediatrico')).toBe(false);
    expect(padraoServeAoPaciente('pediatrico', 'neonatal')).toBe(true);
    expect(padraoServeAoPaciente('neonatal', 'pediatrico')).toBe(false);
    expect(padraoServeAoPaciente('gestante', 'neonatal')).toBe(false);
    expect(padraoServeAoPaciente('gestante', 'adulto')).toBe(true);
  });
  it('região dentro da árvore do corpo', () => {
    expect(regiaoDentroDe(11, 12, catalogo.regioes)).toBe(true);
    expect(regiaoDentroDe(12, 11, catalogo.regioes)).toBe(false);
    expect(regiaoDentroDe(10, 10, catalogo.regioes)).toBe(true);
  });
});

describe('exame físico estruturado: validação dos achados', () => {
  it('o achado padronizado completa sistema, região e normal', () => {
    const r = validarExameFisico([item({ padraoId: 101 }), item({ padraoId: 100 })], catalogo, 'adulto');
    expect(r.falhas).toEqual([]);
    expect(r.itens[0]).toMatchObject({ sistemaId: 1, regiaoId: 10, normal: false });
    expect(r.itens[1]).toMatchObject({ sistemaId: 1, regiaoId: null, normal: true });
  });
  it('região com lado exige o lado; região sem lado recusa o lado', () => {
    expect(codigos(validarExameFisico([item({ padraoId: 102, regiaoId: 11 })], catalogo, null))).toEqual([
      'lado-obrigatorio',
    ]);
    const ok = validarExameFisico(
      [item({ padraoId: 102, regiaoId: 11, lateralidade: 'esquerdo' })],
      catalogo,
      null,
    );
    expect(ok.falhas).toEqual([]);
    expect(ok.itens[0]).toMatchObject({ regiaoId: 11, normal: false });
    expect(
      codigos(
        validarExameFisico([item({ regiaoId: 10, normal: true, lateralidade: 'direito' })], catalogo, null),
      ),
    ).toEqual(['lado-indevido']);
    expect(
      codigos(
        validarExameFisico([item({ sistemaId: 1, normal: true, lateralidade: 'direito' })], catalogo, null),
      ),
    ).toEqual(['lado-sem-regiao']);
  });
  it('padrão de outro sistema, de outra região, contraditório, inativo ou de outro público é recusado', () => {
    expect(codigos(validarExameFisico([item({ padraoId: 100, sistemaId: 2 })], catalogo, null))).toEqual([
      'achado-padrao-outro-sistema',
    ]);
    expect(codigos(validarExameFisico([item({ padraoId: 102, regiaoId: 10 })], catalogo, null))).toEqual([
      'achado-padrao-outra-regiao',
    ]);
    expect(codigos(validarExameFisico([item({ padraoId: 100, normal: false })], catalogo, null))).toEqual([
      'achado-contraditorio',
    ]);
    expect(codigos(validarExameFisico([item({ padraoId: 103 })], catalogo, null))).toEqual([
      'achado-padrao-inativo',
    ]);
    expect(codigos(validarExameFisico([item({ padraoId: 104 })], catalogo, 'adulto'))).toEqual([
      'achado-padrao-outro-publico',
    ]);
    expect(codigos(validarExameFisico([item({ padraoId: 105 })], catalogo, 'adulto'))).toEqual([]);
    expect(codigos(validarExameFisico([item({ padraoId: 999 })], catalogo, null))).toEqual([
      'achado-padrao-inexistente',
    ]);
  });
  it('sem lugar, vazio, alterado sem descrição, sistema e região inativos', () => {
    expect(codigos(validarExameFisico([item({ normal: true })], catalogo, null))).toEqual([
      'sem-sistema-ou-regiao',
    ]);
    expect(codigos(validarExameFisico([item({ sistemaId: 1 })], catalogo, null))).toEqual(['achado-vazio']);
    expect(codigos(validarExameFisico([item({ sistemaId: 1, normal: false })], catalogo, null))).toEqual([
      'alteracao-sem-descricao',
    ]);
    expect(
      codigos(validarExameFisico([item({ sistemaId: 3, regiaoId: 13, normal: true })], catalogo, null)),
    ).toEqual(['sistema-inativo', 'regiao-inativa']);
    expect(codigos(validarExameFisico([], catalogo, null))).toEqual(['exame-vazio']);
    expect(
      codigos(validarExameFisico([item({ sistemaId: 1, descricao: 'x'.repeat(2001) })], catalogo, null)),
    ).toEqual(['descricao-longa']);
  });
  it('repetido e normal contra alterado no mesmo ponto, inclusive contra o já gravado', () => {
    expect(
      codigos(validarExameFisico([item({ padraoId: 100 }), item({ padraoId: 100 })], catalogo, null)),
    ).toEqual(['achado-repetido']);
    expect(
      codigos(
        validarExameFisico(
          [item({ sistemaId: 1, normal: false, descricao: 'Ritmo irregular' })],
          catalogo,
          null,
          [item({ sistemaId: 1, padraoId: 100, normal: true })],
        ),
      ),
    ).toEqual(['normal-e-alterado']);
    // Lados diferentes são pontos diferentes: normal à direita e alterado à esquerda é aceito.
    expect(
      validarExameFisico(
        [
          item({ regiaoId: 11, lateralidade: 'direito', normal: true }),
          item({ regiaoId: 11, lateralidade: 'esquerdo', normal: false, descricao: 'Edema ++' }),
        ],
        catalogo,
        null,
      ).falhas,
    ).toEqual([]);
  });
});

describe('exame físico estruturado: registro, resumo e texto', () => {
  it('só o autor, com o registro em vigor, sem assinatura concluída e dentro da janela de complemento', () => {
    const lancadoEm = new Date('2026-11-20T10:00:00Z');
    const agora = new Date('2026-11-20T18:00:00Z');
    const reg = { situacao: 'finalizado', autorUsuarioId: 7, lancadoEm, assinado: false };
    expect(registroAceitaExame(reg, 7, agora)).toEqual([]);
    expect(registroAceitaExame({ ...reg, situacao: 'aguardando_coassinatura' }, 7, agora)).toEqual([]);
    expect(codigos({ falhas: registroAceitaExame({ ...reg, situacao: 'suspenso' }, 8, agora) })).toEqual([
      'registro-fora-de-vigor',
      'nao-e-autor',
    ]);
    // O conteúdo assinado não recebe acréscimo.
    expect(codigos({ falhas: registroAceitaExame({ ...reg, assinado: true }, 7, agora) })).toEqual([
      'registro-assinado',
    ]);
    // Janela: 24 horas do lançamento valem; um minuto depois, não; sem lançamento conhecido, não.
    expect(registroAceitaExame(reg, 7, new Date('2026-11-21T10:00:00Z'))).toEqual([]);
    expect(codigos({ falhas: registroAceitaExame(reg, 7, new Date('2026-11-21T10:01:00Z')) })).toEqual([
      'janela-de-complemento-encerrada',
    ]);
    expect(codigos({ falhas: registroAceitaExame({ ...reg, lancadoEm: null }, 7, agora) })).toEqual([
      'janela-de-complemento-encerrada',
    ]);
  });
  it('texto do exame no registro: um cabeçalho datado por lote, uma linha por achado', () => {
    expect(textoExameDoRegistro([])).toBe('');
    expect(
      textoExameDoRegistro([
        { lancadoEm: '20/11/2026 10:05', texto: 'Cardiovascular: sem alterações' },
        { lancadoEm: '20/11/2026 10:05', texto: 'Tórax: alterado; Estertores' },
        { lancadoEm: '20/11/2026 14:30', texto: 'Braço (direito): sem alterações' },
      ]),
    ).toBe(
      [
        'Exame físico estruturado (lançado em 20/11/2026 10:05):',
        '- Cardiovascular: sem alterações',
        '- Tórax: alterado; Estertores',
        '',
        'Exame físico estruturado (lançado em 20/11/2026 14:30):',
        '- Braço (direito): sem alterações',
      ].join('\n'),
    );
  });
  it('resumo por sistema e linha de texto', () => {
    expect(
      resumirExamePorSistema([
        { sistemaId: 1, normal: true },
        { sistemaId: 1, normal: false },
        { sistemaId: null, normal: null },
      ]),
    ).toEqual([
      { sistemaId: 1, examinados: 2, normais: 1, alterados: 1 },
      { sistemaId: null, examinados: 1, normais: 0, alterados: 0 },
    ]);
    expect(
      textoAchadoExame({
        sistema: 'Cardiovascular',
        regiao: 'Membro superior',
        lateralidade: 'esquerdo',
        achado: null,
        normal: false,
        descricao: 'Edema ++',
      }),
    ).toBe('Cardiovascular · Membro superior (esquerdo): alterado; Edema ++');
  });

  describe('exame físico no registro migrado sem conta do autor', () => {
    it('ninguém acrescenta: nem o usuário da sessão, nem o contexto sem usuário (nunca 0 contra 0)', () => {
      const agora = new Date('2026-11-20T18:00:00Z');
      const reg = { situacao: 'finalizado', autorUsuarioId: null, lancadoEm: null, assinado: false };
      expect(codigos({ falhas: registroAceitaExame(reg, 7, agora) })).toContain('nao-e-autor');
      expect(codigos({ falhas: registroAceitaExame(reg, null, agora) })).toContain('nao-e-autor');
      expect(codigos({ falhas: registroAceitaExame({ ...reg, autorUsuarioId: 7 }, null, agora) })).toContain(
        'nao-e-autor',
      );
    });
  });
});
