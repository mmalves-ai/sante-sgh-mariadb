// A configuração muda o sumário (F3.3, linha 03-PEP L124, correção): obrigatoriedade e retirada de uso valem também
// para as seções de campo próprio; o texto segue a ordem e os títulos do cadastro; o tipo estruturado não passa com
// texto solto; o navegador não escolhe título nem seção; o período próprio entra na resolução e na janela.
import type { SumarioAltaEstruturado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { pendenciasDoSumario, textoDoSumario } from './sumario-alta.js';
import {
  type ComponenteSumario,
  janelaDaSecao,
  pendenciasDasSecoes,
  resolverSecoesSumario,
  SECOES_PADRAO,
  sumarioNasSecoes,
  validarComponenteSumario,
} from './sumario-alta-secoes.js';

const comp = (o: Partial<ComponenteSumario>): ComponenteSumario => ({
  estabelecimento: 1,
  codigo: 'x',
  descricao: 'X',
  tipoConteudo: 'texto_livre',
  tipoAtendimento: 'todos',
  ordem: 10,
  obrigatorio: false,
  periodo: null,
  ativo: true,
  ...o,
});
const base: SumarioAltaEstruturado = {
  diagnosticos: [{ cid: 'I10', descricao: 'Hipertensão' }],
  procedimentos: [],
  medicamentosAlta: [],
  alergias: [],
  encaminhamentos: [],
};

describe('sumário de alta pela configuração do estabelecimento', () => {
  it('condição e plano não obrigatórios (ou retirados de uso) deixam de recusar; o diagnóstico é piso legal', () => {
    const secoes = resolverSecoesSumario(
      [
        comp({ codigo: 'diagnosticos', tipoConteudo: 'diagnosticos', descricao: 'Hipóteses', ordem: 5 }),
        comp({
          codigo: 'condicao',
          tipoConteudo: 'condicao_alta',
          descricao: 'Condição',
          obrigatorio: false,
        }),
        comp({ codigo: 'plano', tipoConteudo: 'plano_terapeutico', descricao: 'Plano', ativo: false }),
      ],
      1,
      'internacao',
    );
    expect(secoes.map((s) => s.codigo)).toEqual(['diagnosticos', 'condicao']);
    expect(pendenciasDoSumario(base, secoes)).toEqual([]);
    expect(pendenciasDoSumario({ ...base, diagnosticos: [] }, secoes).map((p) => p.campo)).toEqual([
      'diagnosticos',
    ]);
    // Sem configuração, o conjunto padrão exige plano e condição.
    expect(pendenciasDoSumario(base).map((p) => p.campo)).toEqual(['plano', 'condicaoAlta']);
  });

  it('texto na ordem e com os títulos do cadastro; seção inativa e código não configurado ficam fora', () => {
    const secoes = resolverSecoesSumario(
      [
        comp({ codigo: 'cond', tipoConteudo: 'condicao_alta', descricao: 'Estado na saída', ordem: 1 }),
        comp({ codigo: 'diag', tipoConteudo: 'diagnosticos', descricao: 'Hipóteses', ordem: 2 }),
        comp({ codigo: 'alerg', tipoConteudo: 'alergias', descricao: 'Alergias', ativo: false }),
        comp({ codigo: 'orient', tipoConteudo: 'orientacoes', descricao: 'Orientações', ordem: 3 }),
      ],
      1,
      'todos',
    );
    const s = sumarioNasSecoes(
      {
        ...base,
        condicaoAlta: 'Estável',
        secoes: [
          { codigo: 'orient', titulo: 'Título forjado', texto: ' Repouso ' },
          { codigo: 'alheia', titulo: 'Fora', texto: 'Não entra' },
          { codigo: 'diag', texto: 'texto solto' },
        ],
      },
      secoes,
    );
    expect(s.secoes).toEqual([{ codigo: 'orient', titulo: 'Orientações', texto: 'Repouso' }]);
    const t = textoDoSumario(s, secoes);
    expect(t).toBe('Estado na saída:\nEstável\n\nHipóteses:\n- I10 Hipertensão\n\nOrientações:\nRepouso');
    expect(t).not.toContain('Alergias');
  });

  it('tipo estruturado obrigatório não passa com texto solto no mesmo código', () => {
    const secoes = resolverSecoesSumario(
      [comp({ codigo: 'diagnosticos', tipoConteudo: 'diagnosticos', obrigatorio: true })],
      1,
      'todos',
    );
    const solto = { ...base, diagnosticos: [], secoes: [{ codigo: 'diagnosticos', texto: 'IAM' }] };
    expect(pendenciasDasSecoes(secoes, solto).map((p) => p.campo)).toEqual(['diagnosticos']);
  });

  it('período próprio: vale no lugar do recorte fixo; retirado de uso, volta ao atendimento inteiro', () => {
    const c = comp({ codigo: 'exa', tipoConteudo: 'exames', periodoConsulta: 7 });
    const ativo = new Map([[7, { atendimentoInteiro: false, horasRetroativas: 12, ativo: true }]]);
    const [v] = resolverSecoesSumario([c], 1, 'todos', ativo);
    expect(v).toMatchObject({ periodo: null, periodoConsulta: 7, horasRetroativas: 12 });
    const alta = new Date('2026-11-20T12:00:00Z');
    const j = janelaDaSecao(v!.periodo, new Date('2026-11-10T00:00:00Z'), alta, v!.horasRetroativas ?? null);
    expect(j.desde.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    const [r] = resolverSecoesSumario([c], 1, 'todos', new Map([[7, { ...ativo.get(7)!, ativo: false }]]));
    expect(r).toMatchObject({
      periodo: 'atendimento_inteiro',
      periodoConsulta: null,
      horasRetroativas: null,
    });
    expect(validarComponenteSumario({ ...c, periodo: 'ultimas_24_horas' }).map((e) => e.codigo)).toEqual([
      'periodo-duplo',
    ]);
    expect(SECOES_PADRAO.every((x) => x.origem === 'padrao')).toBe(true);
  });
});
