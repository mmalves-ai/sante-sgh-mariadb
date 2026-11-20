// Regra 4 da ficha do M22 (teste nomeado: renderizador/ativos): perguntas desligadas não aparecem no registro
// novo nem são gravadas; vínculos inativos continuam lidos nos registros antigos. Regras 5 e 6 (estado): só
// habilita/desabilita (não apaga valor), calcula o escore proposto, obrigatório só na finalização.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CampoRegistro, RespostaRegistro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { converterExpressao } from '../regras/conversor.js';
import { dataParaDias } from '../regras/valores.js';
import { avaliarFormulario, contextoDasRespostas, pendenciasParaFinalizar } from './estado.js';
import { bloqueiosDoModelo, camposParaRegistro, camposParaVisualizar, planos } from './visao.js';

const ler = (c: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../../docs/marcos/M09/dfm/${c}.json`), 'utf8'),
  ) as RepresentacaoFormulario;

describe('visão do formulário (regra 4)', () => {
  it('registro novo: só os vínculos ativos; visualização: todos', () => {
    const rep = ler('enf091');
    const ativos = planos(camposParaRegistro(rep));
    const todos = planos(camposParaVisualizar(rep));
    expect(ativos.length).toBeLessThan(todos.length);
    expect(ativos.length).toBe(rep.resumo.vinculosAtivos);
    expect(todos.length).toBe(rep.resumo.vinculos);
  });
  it('tipos de campo, layout em 12 colunas, histórico e opções pelo índice do formulário', () => {
    const c = planos(camposParaRegistro(ler('enf03')));
    const tipos = new Set(c.map((x) => x.tipo));
    for (const t of [
      'secao',
      'multipla',
      'escolha-com-texto',
      'grade',
      'quantidade',
      'texto-formatado',
      'alergias',
    ])
      expect(tipos.has(t as CampoRegistro['tipo']), t).toBe(true);
    const grade = c.find((x) => x.tipo === 'grade')!;
    expect(grade.colunasGrade.map((x) => x.titulo)).toEqual(['Hora', 'PA (mmHg)', 'FC', 'FR', 'T', 'SAT']);
    expect(grade.colunasGrade.map((x) => x.tipo)).toEqual([
      'hora',
      'texto',
      'numero',
      'numero',
      'numero',
      'numero',
    ]);
    expect(c.every((x) => x.colunas >= 1 && x.colunas <= 12)).toBe(true);
    expect(c.find((x) => x.tipo === 'multipla')!.opcoes[0]).toEqual({ indice: 0, texto: 'Medicação' });
    expect(c.some((x) => x.manterHistorico === 1)).toBe(true);
  });
  it('os 10 de maior uso não têm pergunta ativa a confirmar que bloqueie o registro', () => {
    for (const cod of [
      'enf091',
      'evam',
      'm12',
      'enf03',
      'enf0411',
      'enf041',
      'fisiuti',
      'm9',
      'e08',
      'm10',
    ]) {
      const b = bloqueiosDoModelo(camposParaRegistro(ler(cod)));
      expect(b.naoGravados, cod).toBe(0);
    }
  });
  it('regras convertidas vão para o campo (habilitar e calcular)', () => {
    const c = planos(camposParaRegistro(ler('enf02')));
    expect(c.filter((x) => x.calcular !== null).length).toBeGreaterThan(0);
    expect(c.every((x) => !x.regraPendente)).toBe(true);
  });
});

function campo(p: Partial<CampoRegistro> & Pick<CampoRegistro, 'vinculo' | 'tipo'>): CampoRegistro {
  return {
    linkId: `01.${p.vinculo}`,
    componente: `cmp${p.vinculo}`,
    titulo: `Campo ${p.vinculo}`,
    obrigatorio: false,
    unidade: null,
    tamanhoMaximo: null,
    colunas: 12,
    opcoes: [],
    colunasGrade: [],
    habilitar: null,
    calcular: null,
    regraPendente: false,
    manterHistorico: 0,
    ambiguo: false,
    itens: [],
    ...p,
  };
}

describe('estado do formulário (regras 5 e 6)', () => {
  const braden = converterExpressao(
    'A := 0; B := 0; if cmp1ItemIndex > 0 then A := cmp1ItemIndex; if cmp2ItemIndex > 0 then B := cmp2ItemIndex; result := Sum(A, B)',
  ).regra;
  const hab = converterExpressao('if (cmp1ItemIndex = 1) then result := false else result := true;').regra;
  const campos: CampoRegistro[] = [
    campo({
      vinculo: 0,
      tipo: 'secao',
      itens: [
        campo({
          vinculo: 1,
          tipo: 'escolha',
          opcoes: [1, 2, 3, 4].map((i) => ({ indice: i, texto: `${i}` })),
        }),
        campo({ vinculo: 2, tipo: 'escolha', opcoes: [1, 2, 3].map((i) => ({ indice: i, texto: `${i}` })) }),
        campo({ vinculo: 3, tipo: 'quantidade', calcular: braden }),
        campo({ vinculo: 4, tipo: 'texto', habilitar: hab, obrigatorio: true }),
        campo({ vinculo: 5, tipo: 'data', obrigatorio: true }),
        campo({ vinculo: 6, tipo: 'texto', calcular: { xpto: [1] } }),
      ],
    }),
  ];
  const r = (
    vinculo: number,
    valor: RespostaRegistro['valor'],
    extra: Partial<RespostaRegistro> = {},
  ): RespostaRegistro => ({
    vinculo,
    valor,
    autopreenchido: false,
    confirmado: false,
    ...extra,
  });
  const pac = { idade: 70, sexo: 'F' as const };

  it('escore proposto (Braden: soma dos índices) e desabilitar pela resposta', () => {
    const e = avaliarFormulario(
      campos,
      [r(1, { tipo: 'escolha', indice: 1 }), r(2, { tipo: 'escolha', indice: 3 })],
      pac,
      '2026-10-21',
    );
    expect(e.calculados.get(3)).toBe(4);
    expect(e.desabilitados.has(4)).toBe(true);
    expect(e.falhas).toBe(1);
    const f = avaliarFormulario(campos, [r(1, { tipo: 'escolha', indice: 2 })], pac, '2026-10-21');
    expect(f.desabilitados.has(4)).toBe(false);
    expect(f.calculados.get(3)).toBe(2);
  });
  it('valores das regras: número, data em dias, índice, texto numérico; vazio = 0 e índice -1', () => {
    const v = contextoDasRespostas(
      [
        ...campos,
        campo({ vinculo: 7, tipo: 'multipla' }),
        campo({ vinculo: 8, tipo: 'hora' }),
        campo({ vinculo: 9, tipo: 'grade' }),
      ],
      [
        r(5, { tipo: 'data', data: '2026-10-11' }),
        r(4, { tipo: 'texto', texto: '12,5' }),
        r(6, { tipo: 'texto', texto: 'abc' }),
        r(7, { tipo: 'multipla', indices: [3, 5] }),
        r(8, { tipo: 'hora', hora: '07:00' }),
        r(9, { tipo: 'grade', linhas: [] }),
        r(3, { tipo: 'numero', valor: 9 }),
      ],
      pac,
    );
    expect(v['cmp5']).toBe(dataParaDias('2026-10-11'));
    expect(v['cmp4']).toBe(12.5);
    expect(v['cmp6']).toBe('abc');
    expect(v['cmp7']).toBe(2);
    expect(v['cmp7ItemIndex']).toBe(3);
    expect(v['cmp8']).toBe('07:00');
    expect(v['cmp9']).toBe(0);
    expect(v['cmp3']).toBe(9);
    expect(v['cmp2']).toBe(0);
    expect(v['cmp2ItemIndex']).toBe(-1);
    expect(v['PacienteIdade']).toBe(70);
    expect(v['PacienteSexo']).toBe('F');
  });
  it('finalizar: obrigatório do vínculo habilitado e o pré-preenchido sem confirmação; o desabilitado não cobra', () => {
    const resp = [
      r(1, { tipo: 'escolha', indice: 1 }),
      r(5, { tipo: 'data', data: '2026-10-11' }, { autopreenchido: true }),
    ];
    const e = avaliarFormulario(campos, resp, pac, '2026-10-21');
    expect(pendenciasParaFinalizar(campos, resp, e)).toEqual([
      { vinculo: 5, titulo: 'Campo 5', motivo: 'confirmar-pre-preenchido' },
    ]);
    const sem = pendenciasParaFinalizar(campos, [], { desabilitados: new Set() });
    expect(sem.map((p) => p.vinculo)).toEqual([4, 5]);
  });
});
