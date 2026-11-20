import {
  CHAVES_REGRA_1_ONDA_3,
  ITENS_CRITERIO_POR_SETOR_ONDA_3,
  ITENS_REGISTRAVEIS_ONDA_2,
  type ItemCriterioRegistrado,
  OPERACOES_CATALOGO_ONDA_3,
  RECURSOS_FORA_DA_ONDA3,
  RECURSOS_SO_NO_NOVO_ONDA_3,
  SETORES_ONDA3,
  SETORES_PRONTIDAO,
  operacoesDoSetor,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarLiberacaoSetor,
  itensDoSetor,
  motivoLoteOnda2,
  planoRecolhimento,
  roteiroRecolhimentoMarkdown,
  setoresOnda2DaChave,
} from '../onda2/onda2.js';
import {
  anterioresNaoLiberados,
  chaveExigePrescricao,
  ehSetorOnda3,
  motivoRegra1,
  passoDoSetorOnda3,
  prioridadeOnda3,
  regra1PorLocal,
  setoresOnda3DaChave,
  unidadesComPrescricaoEmUso,
} from './onda3.js';

const setor = (id: string) => {
  const s = SETORES_PRONTIDAO.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

const nomes = [...OPERACOES_CATALOGO_ONDA_3, 'suprimentos.incluirCategoria', 'pep.prescrever'];

describe('setores da onda 3 no catálogo de prontidão', () => {
  it('os quatro setores do campo 12 estão no catálogo, na onda 3, na ordem, e o setor antigo saiu', () => {
    const daOnda = SETORES_PRONTIDAO.filter((s) => s.onda === 3).map((s) => s.id);
    expect(daOnda).toEqual([
      'almoxarifado-compras',
      'farmacia-central',
      'farmacias-satelites',
      'farmacia-clinica',
    ]);
    expect(SETORES_PRONTIDAO.some((s) => s.id === 'farmacia-suprimentos')).toBe(false);
    expect(daOnda.map(passoDoSetorOnda3)).toEqual([1, 2, 3, 4]);
    expect(daOnda.every(ehSetorOnda3)).toBe(true);
    expect(ehSetorOnda3('enfermagem')).toBe(false);
  });

  it('as operações do setor no catálogo de prontidão são as P1 e P2 do contrato da onda (e os cadastros no almoxarifado)', () => {
    for (const s of SETORES_ONDA3) {
      const doCatalogo = operacoesDoSetor(setor(s.id), nomes);
      expect(doCatalogo.sort()).toEqual(
        [
          ...s.operacoesP1,
          ...s.operacoesP2,
          ...(s.id === 'almoxarifado-compras' ? ['suprimentos.incluirCategoria'] : []),
        ].sort(),
      );
      expect(setor(s.id).recursos).toEqual(s.recursos);
    }
  });

  it('nenhum setor da onda liga a farmácia ambulatorial nem o livro oficial (regra 5)', () => {
    for (const s of SETORES_PRONTIDAO.filter((x) => x.onda === 3))
      for (const r of RECURSOS_FORA_DA_ONDA3) expect(s.recursos).not.toContain(r);
  });

  it('P1 e P2 pela ficha', () => {
    expect(prioridadeOnda3('suprimentos.registrarSaida')).toBe('P1');
    expect(prioridadeOnda3('suprimentos.registrarProposta')).toBe('P1');
    expect(prioridadeOnda3('suprimentos.fecharMes')).toBe('P2');
    expect(prioridadeOnda3('suprimentos.avaliarPrescricao')).toBe('P2');
    expect(prioridadeOnda3('pep.prescrever')).toBeNull();
  });
});

describe('critério do setor da onda 3 (regras 1 a 8 do M40 com as condições da onda)', () => {
  const todos: ItemCriterioRegistrado[] = ITENS_REGISTRAVEIS_ONDA_2.map((item) => ({
    item,
    situacao: 'cumprido',
    evidencia: `docs/marcos/M41/evidencias.md#${item}`,
    em: '2026-12-01',
  }));
  const pentest = { bloqueia: false, motivo: 'sem achado crítico ou alto aberto' };

  it('cada setor tem os gerais e os da onda; a farmácia exige a prescrição na unidade; nenhum relatório de contingência', () => {
    for (const s of SETORES_ONDA3) {
      const itens = itensDoSetor(setor(s.id));
      expect(itens).toEqual(expect.arrayContaining([...ITENS_CRITERIO_POR_SETOR_ONDA_3[s.id]]));
      expect(itens).toContain('autorizacao-do-dono');
      expect(itens).not.toContain('relatorio-contingencia');
      expect(itens.includes('prescricao-na-unidade')).toBe(s.exigePrescricaoDaUnidade);
    }
  });

  it('tudo cumprido e as operações conferidas: pode liberar; sem a prescrição na unidade, segura e diz por quê', () => {
    const ops = { 'suprimentos.dispensarHorario': 'conferida' as const };
    const ok = avaliarLiberacaoSetor({
      setor: setor('farmacia-central'),
      operacoes: ops,
      itens: todos,
      pentest,
    });
    expect(ok.podeLiberar).toBe(true);
    const sem = avaliarLiberacaoSetor({
      setor: setor('farmacia-central'),
      operacoes: ops,
      itens: todos.filter((i) => i.item !== 'prescricao-na-unidade'),
      pentest,
    });
    expect(sem.podeLiberar).toBe(false);
    expect(motivoLoteOnda2(sem)).toContain('prescrição eletrônica');
  });

  it('"não se aplica" não vale para o inventário, a conferência dos documentos, a numérica e a prescrição', () => {
    for (const item of [
      'inventario-recente',
      'documentos-conferidos',
      'conferencia-numerica',
      'prescricao-na-unidade',
    ] as const) {
      const a = avaliarLiberacaoSetor({
        setor: setor('farmacia-central'),
        operacoes: { 'suprimentos.dispensarHorario': 'conferida' },
        itens: todos.map((i) => (i.item === item ? { ...i, situacao: 'nao-se-aplica' } : i)),
        pentest,
      });
      expect(a.itens.find((i) => i.item === item)?.ok).toBe(false);
    }
  });

  it('a chave de setor da onda 3 é reconhecida; a da onda 2 não é da onda 3', () => {
    expect(setoresOnda3DaChave('operacao', 'suprimentos.registrarSaida', nomes)).toEqual([
      'almoxarifado-compras',
      'farmacia-central',
      'farmacias-satelites',
    ]);
    expect(setoresOnda3DaChave('recurso', 'suprimentos.avaliacao', nomes)).toEqual(['farmacia-clinica']);
    expect(setoresOnda3DaChave('operacao', 'pep.prescrever', nomes)).toEqual([]);
    expect(setoresOnda2DaChave('operacao', 'suprimentos.registrarSaida', nomes)).toEqual([]);
  });

  it('ordem: aviso dos setores anteriores ainda não liberados', () => {
    expect(anterioresNaoLiberados('farmacias-satelites', { 'almoxarifado-compras': 'liberado' })).toEqual([
      'farmacia-central',
    ]);
    expect(anterioresNaoLiberados('almoxarifado-compras', {})).toEqual([]);
  });

  it('recolhimento desliga as operações liberadas e os recursos; o roteiro cita os recursos só do novo e não o outro sistema pelo nome', () => {
    const p = planoRecolhimento(setor('farmacia-clinica'), ['suprimentos.avaliarPrescricao']);
    expect(p.chaves).toEqual(['suprimentos.avaliarPrescricao', 'suprimentos.avaliacao']);
    const md = roteiroRecolhimentoMarkdown({
      setor: setor('farmacia-central'),
      hospital: 'pc',
      operacoes: ['suprimentos.dispensarHorario'],
      onda: 3,
      recursosSoNoNovo: RECURSOS_SO_NO_NOVO_ONDA_3,
    });
    expect(md).toContain('aba "Onda 3"');
    expect(md).toContain('a dupla conferência de controlados');
    expect(md).not.toMatch(/spdata|legado/i);
  });
});

describe('regra 1: a farmácia só depois da prescrição em uso na unidade', () => {
  const atendidas = [
    { local: 10, unidade: 'CTI', dispensacoes: 40 },
    { local: 10, unidade: '2A', dispensacoes: 12 },
    { local: 15, unidade: '3B', dispensacoes: 0 },
  ];

  it('as chaves da dispensação e da entrega (recurso e operação) exigem a prescrição; as do almoxarifado não', () => {
    for (const c of CHAVES_REGRA_1_ONDA_3) expect(chaveExigePrescricao(c)).toBe(true);
    expect(chaveExigePrescricao('suprimentos.registrarSaida')).toBe(false);
    expect(chaveExigePrescricao('suprimentos.estoque')).toBe(false);
  });

  it('em uso: unidades com prescrição do novo na janela; a chave desligada no estabelecimento recolhe a prova', () => {
    const lidas = [
      { unidade: 'CTI', n: 30 },
      { unidade: '2A ', n: 0 },
    ];
    expect(unidadesComPrescricaoEmUso([{ escopo: 'setor', valor: '3', ligada: true }], lidas)).toEqual([
      'CTI',
    ]);
    expect(unidadesComPrescricaoEmUso([{ escopo: 'hospital', valor: '*', ligada: false }], lidas)).toEqual(
      [],
    );
    expect(unidadesComPrescricaoEmUso([], lidas)).toEqual([]);
  });

  it('por local: as unidades atendidas e as que faltam; ligar recusa enquanto faltar; desligar nunca recusa', () => {
    const por = regra1PorLocal(atendidas, ['CTI']);
    expect(por).toEqual([{ local: 10, unidades: ['2A', 'CTI'], faltam: ['2A'] }]);
    expect(motivoRegra1(true, por, ['CTI'])).toContain('2A');
    expect(motivoRegra1(true, regra1PorLocal(atendidas, ['CTI', '2A']), ['CTI', '2A'])).toBeNull();
    expect(motivoRegra1(false, por, [])).toBeNull();
    expect(motivoRegra1(true, [], ['CTI'])).toContain('não tem unidade atendida');
  });
});
