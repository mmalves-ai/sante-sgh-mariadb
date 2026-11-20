// M42: as regras puras da liberação da onda 4 (setores no catálogo de prontidão, chaves, critério, regra 1 na
// abertura da competência, regra 8 pelas respostas e o recolhimento).
import { describe, expect, it } from 'vitest';
import {
  IDS_SETOR_ONDA_4,
  ITENS_CRITERIO_GERAIS,
  RECURSOS_SO_NO_NOVO_ONDA_4,
  SETORES_ONDA_4,
  SETORES_PRONTIDAO,
  operacoesDoSetor,
} from '@sgh/contratos';
import {
  avaliarLiberacaoSetor,
  itensDoSetor,
  planoRecolhimento,
  roteiroRecolhimentoMarkdown,
} from '../onda2/onda2.js';
import {
  ajustarAberturaOnda4,
  ehSetorOnda4,
  feriadosDoParametro,
  itensOnda4DoSetor,
  lerSituacoesRespostas,
  momentoDoSetorOnda4,
  motivoForaDaAbertura,
  passoDoSetorOnda4,
  respostasDoSetorOnda4,
  setorExigeAbertura,
  setoresOnda4DaChave,
} from './onda4.js';

const NOMES = [
  'faturamento.fecharConta',
  'faturamento.reabrirConta',
  'faturamento.conferirItem',
  'faturamento.lancarItem',
  'faturamento.auditarConta',
  'faturamento.gerarLote',
  'faturamento.registrarProtocolo',
  'faturamento.fecharCompetencia',
  'faturamento.registrarGlosa',
  'financeiro.criarTituloPagar',
  'financeiro.baixarTitulo',
  'financeiro.criarTituloReceber',
  'financeiro.lancarMovimento',
  'financeiro.incluirBanco',
  'repasse.lancarEvento',
  'repasse.emitirRpa',
  'catalogo.importarBrasindice',
  'convenio.incluirPlano',
];

describe('setores da onda 4 no catálogo de prontidão', () => {
  it('os nove setores estão no catálogo, na onda 4, e os antigos saíram', () => {
    const ids = SETORES_PRONTIDAO.filter((s) => s.onda === 4).map((s) => s.id);
    expect(ids).toEqual([...IDS_SETOR_ONDA_4]);
    expect(SETORES_PRONTIDAO.some((s) => s.id === 'faturamento' || s.id === 'financeiro')).toBe(false);
  });

  it('cada operação e cada recurso do vocabulário da onda está no setor do catálogo', () => {
    for (const v of SETORES_ONDA_4.filter((x) => ehSetorOnda4(x.id))) {
      const def = SETORES_PRONTIDAO.find((s) => s.id === v.id)!;
      expect(operacoesDoSetor(def, v.operacoes).sort(), v.id).toEqual([...v.operacoes].sort());
      for (const r of v.recursos) expect(def.recursos, `${v.id}: ${r}`).toContain(r);
    }
  });

  it('a carga dos catálogos de preço não entra (fica com cadastros, onda 1)', () => {
    expect(ehSetorOnda4('catalogos-de-preco')).toBe(false);
    expect(setoresOnda4DaChave('operacao', 'catalogo.importarBrasindice', NOMES)).toEqual([]);
  });

  it('ordem, momento e passo', () => {
    expect(passoDoSetorOnda4('faturamento-convenio')).toBe(1);
    expect(passoDoSetorOnda4('repasse')).toBe(8);
    expect(passoDoSetorOnda4('farmacia-central')).toBe(0);
    expect(momentoDoSetorOnda4('tiss-lotes')).toBe('fim-da-competencia');
    expect(momentoDoSetorOnda4('nada')).toBeNull();
  });

  it('chave → setores (operação compartilhada em dois setores; recurso; outra onda)', () => {
    expect(setoresOnda4DaChave('operacao', 'financeiro.baixarTitulo', NOMES)).toEqual([
      'contas-a-pagar',
      'contas-a-receber',
    ]);
    expect(setoresOnda4DaChave('operacao', 'faturamento.conferirItem', NOMES)).toEqual([
      'faturamento-convenio',
      'auditoria-contas',
    ]);
    expect(setoresOnda4DaChave('recurso', 'faturamento.lote', NOMES)).toEqual(['tiss-lotes']);
    expect(setoresOnda4DaChave('operacao', 'financeiro.incluirBanco', NOMES)).toEqual(['contas-a-pagar']);
    expect(setoresOnda4DaChave('recurso', 'suprimentos.estoque', NOMES)).toEqual([]);
  });
});

describe('critério do setor', () => {
  it('itens gerais mais os da onda 4; regra 1 só nos setores da abertura', () => {
    const fat = SETORES_PRONTIDAO.find((s) => s.id === 'faturamento-convenio')!;
    const itens = itensDoSetor(fat);
    for (const i of ITENS_CRITERIO_GERAIS) expect(itens).toContain(i);
    expect(itens).toEqual(
      expect.arrayContaining(['abertura-da-competencia', 'reproducao-sem-diferenca', 'registros-conferidos']),
    );
    // o setor usa recursos só do novo da onda 2? não: sem relatório de contingência
    expect(itens).not.toContain('relatorio-contingencia');
    expect(setorExigeAbertura('faturamento-convenio')).toBe(true);
    expect(setorExigeAbertura('auditoria-contas')).toBe(true);
    expect(setorExigeAbertura('tiss-lotes')).toBe(false);
    expect(itensOnda4DoSetor('repasse')).toEqual(['registros-conferidos']);
    expect(itensOnda4DoSetor('medicos')).toEqual([]);
  });

  it('o fiscal sem operação não libera (DP-38: fiscal continua como hoje)', () => {
    const fiscal = SETORES_PRONTIDAO.find((s) => s.id === 'fiscal')!;
    const a = avaliarLiberacaoSetor({
      setor: fiscal,
      operacoes: {},
      itens: [],
      pentest: { bloqueia: false, motivo: '' },
    });
    expect(a.podeLiberar).toBe(false);
    expect(a.itens.find((i) => i.item === 'operacoes-conferidas')?.falta).toMatch(/nenhuma operação/);
  });
});

describe('regra 1: início na abertura de uma competência', () => {
  const feriados = feriadosDoParametro('2027-01-01, 2027-02-15,xx');

  it('feriados do parâmetro (as datas inválidas saem)', () => {
    expect([...feriados]).toEqual(['2027-01-01', '2027-02-15']);
    expect(feriadosDoParametro(null).size).toBe(0);
  });

  it('o primeiro dia útil passa; outro dia é recusado com a abertura e a próxima', () => {
    expect(
      motivoForaDaAbertura(
        [{ item: 'abertura-da-competencia', situacao: 'cumprido', em: '2027-01-04' }],
        feriados,
      ),
    ).toBeNull();
    const m = motivoForaDaAbertura(
      [{ item: 'abertura-da-competencia', situacao: 'cumprido', em: '2027-01-05' }],
      feriados,
    );
    expect(m).toContain('04/01/2027');
    expect(m).toContain('01/02/2027');
    expect(
      motivoForaDaAbertura([{ item: 'abertura-da-competencia', situacao: 'pendente', em: null }], feriados),
    ).toBeNull();
    expect(
      motivoForaDaAbertura([{ item: 'abertura-da-competencia', situacao: 'cumprido', em: null }], feriados),
    ).toMatch(/Informe/);
    expect(
      motivoForaDaAbertura([{ item: 'aceite-jornada', situacao: 'cumprido', em: '2027-01-05' }], feriados),
    ).toBeNull();
  });

  it('na avaliação, o registro fora da abertura fica pendente e segura o setor', () => {
    const base = {
      setor: 'faturamento-convenio',
      podeLiberar: true,
      itens: [
        {
          item: 'abertura-da-competencia' as const,
          rotulo: 'x',
          ok: true,
          origem: 'registrado' as const,
          situacao: 'cumprido' as const,
          falta: null,
          detalhe: '',
        },
      ],
    };
    const fora = ajustarAberturaOnda4(
      base,
      [{ item: 'abertura-da-competencia', situacao: 'cumprido', em: '2027-01-05' }],
      feriados,
    );
    expect(fora.podeLiberar).toBe(false);
    expect(fora.itens[0]!.falta).toContain('04/01/2027');
    expect(
      ajustarAberturaOnda4(
        base,
        [{ item: 'abertura-da-competencia', situacao: 'cumprido', em: '2027-01-04' }],
        feriados,
      ),
    ).toBe(base);
  });
});

describe('regra 8: respostas do faturamento e do fiscal', () => {
  const md = [
    '| Pergunta | DP | Situação pc | Situação hs | Padrão |',
    '|---|---|---|---|---|',
    '| FAT-07 TISS | 33.7 | respondido | sem-resposta | x |',
    '| FAT-14 TISS 04.03.00 | 37 | aplicado | aplicado | x |',
    '| FIS-09 Códigos | 46.4 | inventado | sem-resposta | x |',
    'texto solto',
  ].join('\n');

  it('lê a situação por hospital; valor desconhecido vale sem resposta', () => {
    expect(lerSituacoesRespostas(md)).toEqual([
      { pergunta: 'FAT-07', pc: 'respondido', hs: 'sem-resposta' },
      { pergunta: 'FAT-14', pc: 'aplicado', hs: 'aplicado' },
      { pergunta: 'FIS-09', pc: 'sem-resposta', hs: 'sem-resposta' },
    ]);
  });

  it('as respostas do setor com a parte e como entram', () => {
    const r = respostasDoSetorOnda4('tiss-lotes', lerSituacoesRespostas(md), 'pc');
    expect(r).toEqual([
      {
        pergunta: 'FAT-07',
        parte: 'versão e canal TISS',
        situacao: 'respondido',
        comoEntra: 'cenario-pendente',
      },
      { pergunta: 'FAT-14', parte: 'TISS 04.03.00', situacao: 'aplicado', comoEntra: 'aplicada' },
    ]);
    expect(respostasDoSetorOnda4('tiss-lotes', [], 'hs')[0]!.comoEntra).toBe('padrao-de-mercado');
    expect(respostasDoSetorOnda4('nada', [], 'pc')).toEqual([]);
  });
});

describe('recolhimento', () => {
  it('o plano do setor desliga as operações liberadas e os recursos; o roteiro cita os recursos só do novo', () => {
    const glosa = SETORES_PRONTIDAO.find((s) => s.id === 'glosa-recurso')!;
    const p = planoRecolhimento(glosa, ['faturamento.registrarGlosa']);
    expect(p.chaves).toEqual([
      'faturamento.registrarGlosa',
      'faturamento.protocoloRecurso',
      'faturamento.conciliacao',
    ]);
    const md = roteiroRecolhimentoMarkdown({
      setor: glosa,
      hospital: 'pc',
      operacoes: ['faturamento.registrarGlosa'],
      onda: 4,
      recursosSoNoNovo: RECURSOS_SO_NO_NOVO_ONDA_4,
    });
    expect(md).toContain('onda 4');
    expect(md).toContain('indeferimento');
    expect(md).not.toMatch(/SPDATA/i);
  });
});
