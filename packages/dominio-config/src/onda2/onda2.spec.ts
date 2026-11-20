import { ITENS_REGISTRAVEIS_ONDA_2, type ItemCriterioRegistrado, SETORES_PRONTIDAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarLiberacaoSetor,
  cenariosFaltantes,
  ehSetorOnda2,
  indicadorChecagem,
  indicadorHigienizacao,
  itensDoSetor,
  motivoLoteOnda2,
  operacaoForaDaOnda,
  passoDoSetorOnda2,
  planoRecolhimento,
  registrosPorSistema,
  roteiroRecolhimentoMarkdown,
  setoresOnda2DaChave,
  setoresQueSeguramHospital,
  versaoPermitida,
  violacoesRegra15,
} from './onda2.js';

const setor = (id: string) => {
  const s = SETORES_PRONTIDAO.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

const todosCumpridos: ItemCriterioRegistrado[] = ITENS_REGISTRAVEIS_ONDA_2.map((item) => ({
  item,
  situacao: 'cumprido',
  evidencia: `docs/marcos/M40/evidencias.md#${item}`,
  em: '2026-12-01',
}));

const tudoOk = {
  operacoes: { 'enfermagem.checarAdministracao': 'conferida' as const },
  itens: todosCumpridos,
  pentest: { bloqueia: false, motivo: 'sem achado crítico ou alto aberto; reteste registrado' },
};

describe('itens do critério por setor', () => {
  it('contingência só para setor com recurso que só existe no novo; piloto e PEP onde a ficha pede', () => {
    expect(itensDoSetor(setor('enfermagem'))).toEqual(
      expect.arrayContaining(['unidade-piloto', 'pep-aberto-no-outro-sistema', 'relatorio-contingencia']),
    );
    expect(itensDoSetor(setor('medicos'))).toContain('relatorio-contingencia');
    expect(itensDoSetor(setor('higienizacao'))).toContain('relatorio-contingencia');
    expect(itensDoSetor(setor('sadt'))).toContain('relatorio-contingencia');
    expect(itensDoSetor(setor('same'))).not.toContain('relatorio-contingencia');
    expect(itensDoSetor(setor('internacao-leitos'))).not.toContain('unidade-piloto');
    const itens = itensDoSetor(setor('enfermagem'));
    expect(new Set(itens).size).toBe(itens.length);
  });
});

describe('avaliar a liberação do setor (regra 1)', () => {
  it('tudo cumprido: pode liberar, com os calculados marcados', () => {
    const a = avaliarLiberacaoSetor({ setor: setor('enfermagem'), ...tudoOk });
    expect(a.itens.filter((i) => !i.ok)).toEqual([]);
    expect(a.podeLiberar).toBe(true);
    expect(a.itens.find((i) => i.item === 'operacoes-conferidas')).toMatchObject({
      origem: 'calculado',
      detalhe: '1 de 1 conferidas',
    });
    expect(a.itens.find((i) => i.item === 'aceite-jornada')?.detalhe).toMatch(/^em 2026-12-01; docs/);
    expect(motivoLoteOnda2(a)).toBeNull();
  });
  it('sem registro: nenhum item registrado está ok (falha fechada)', () => {
    const a = avaliarLiberacaoSetor({ setor: setor('enfermagem'), ...tudoOk, itens: [] });
    expect(a.podeLiberar).toBe(false);
    const falhos = a.itens.filter((i) => !i.ok).map((i) => i.item);
    expect(falhos).toEqual(
      expect.arrayContaining([
        'aceite-jornada',
        'autorizacao-do-dono',
        'recolhimento-ensaiado',
        'unidade-piloto',
        'relatorio-contingencia',
      ]),
    );
    expect(falhos).not.toContain('operacoes-conferidas');
    expect(motivoLoteOnda2(a)).toMatch(/^Critério de liberação incompleto: aceite da jornada/);
  });
  it('operação só verde, item pendente e pentest aberto aparecem com o que falta; não se aplica conta', () => {
    const a = avaliarLiberacaoSetor({
      setor: setor('enfermagem'),
      operacoes: { 'enfermagem.checarAdministracao': 'verde', 'enfermagem.aprazarHorario': 'liberada' },
      itens: todosCumpridos.map((i) =>
        i.item === 'retorno-ensaiado'
          ? { ...i, situacao: 'pendente' as const }
          : i.item === 'apoio-e-chamados'
            ? { ...i, situacao: 'nao-se-aplica' as const }
            : i,
      ),
      pentest: { bloqueia: true, motivo: '1 achado(s) crítico(s) ou alto(s) sem correção retestada' },
    });
    const falta = Object.fromEntries(a.itens.filter((i) => !i.ok).map((i) => [i.item, i.falta]));
    expect(falta['operacoes-conferidas']).toBe(
      'operações ainda não conferidas: enfermagem.checarAdministracao (verde)',
    );
    expect(falta['retorno-ensaiado']).toBe('teste de retorno não feito no setor');
    expect(falta['pentest-sem-critico']).toMatch(/crítico/);
    expect(falta['apoio-e-chamados']).toBeUndefined();
    expect(a.podeLiberar).toBe(false);
  });
  it('"não se aplica" não cumpre a autorização do dono, o treinamento, os ensaios nem as condições do setor', () => {
    for (const item of [
      'autorizacao-do-dono',
      'aceite-jornada',
      'treinamento-concluido',
      'recolhimento-ensaiado',
      'retorno-ensaiado',
      'relatorio-contingencia',
      'pep-aberto-no-outro-sistema',
      'unidade-piloto',
    ] as const) {
      const a = avaliarLiberacaoSetor({
        setor: setor('enfermagem'),
        ...tudoOk,
        itens: todosCumpridos.map((i) =>
          i.item === item ? { ...i, situacao: 'nao-se-aplica' as const } : i,
        ),
      });
      const it = a.itens.find((x) => x.item === item);
      expect(it, item).toMatchObject({ ok: false, situacao: 'nao-se-aplica' });
      expect(it?.falta).toMatch(/não admite "não se aplica"/);
      expect(a.podeLiberar, item).toBe(false);
      expect(motivoLoteOnda2(a)).toMatch(/^Critério de liberação incompleto/);
    }
  });
  it('bloqueada: fora da onda só desde a origem; recolhida ou divergente segura o setor (volta à conferência)', () => {
    expect(operacaoForaDaOnda('bloqueada', false)).toBe(true);
    expect(operacaoForaDaOnda('bloqueada', true)).toBe(false);
    expect(operacaoForaDaOnda('especificada', true)).toBe(true);
    expect(operacaoForaDaOnda('verde', false)).toBe(false);
    const a = avaliarLiberacaoSetor({
      setor: setor('enfermagem'),
      ...tudoOk,
      operacoes: { 'enfermagem.checarAdministracao': 'bloqueada', 'enfermagem.aprazarHorario': 'liberada' },
    });
    expect(a.podeLiberar).toBe(false);
    expect(a.itens.find((i) => i.item === 'operacoes-conferidas')?.falta).toBe(
      'operações ainda não conferidas: enfermagem.checarAdministracao (bloqueada: volta à conferência)',
    );
  });
  it('setores da onda 2 da chave (tela de chaves): recurso e operação do setor; a chave da onda 1 fica fora', () => {
    const nomes = ['enfermagem.checarAdministracao', 'recepcao.emitirSenha', 'hotelaria.solicitarLimpeza'];
    expect(setoresOnda2DaChave('recurso', 'enfermagem.sinaisVitais', nomes)).toEqual(['enfermagem']);
    expect(setoresOnda2DaChave('operacao', 'enfermagem.checarAdministracao', nomes)).toEqual(['enfermagem']);
    expect(setoresOnda2DaChave('operacao', 'hotelaria.solicitarLimpeza', nomes)).toEqual(['higienizacao']);
    // A senha da recepção é da onda 1 (o pronto atendimento a repete): segue a lista da onda 1.
    expect(setoresOnda2DaChave('operacao', 'recepcao.emitirSenha', nomes)).toEqual([]);
    expect(setoresOnda2DaChave('recurso', 'agenda.consulta', nomes)).toEqual([]);
  });
  it('setor sem operação no catálogo não libera', () => {
    const a = avaliarLiberacaoSetor({ setor: setor('same'), ...tudoOk, operacoes: {} });
    expect(a.itens.find((i) => i.item === 'operacoes-conferidas')?.falta).toBe(
      'nenhuma operação de gravação do setor no catálogo',
    );
    const todasFora = avaliarLiberacaoSetor({
      setor: setor('same'),
      ...tudoOk,
      operacoes: {},
      fora: ['a.b', 'a.c'],
    });
    expect(todasFora.itens.find((i) => i.item === 'operacoes-conferidas')?.falta).toBe(
      'todas as 2 operações de gravação do setor estão desligadas até a prova',
    );
  });
  it('setor e passo da ordem (campo 12)', () => {
    expect(ehSetorOnda2('enfermagem')).toBe(true);
    expect(ehSetorOnda2('agendamento')).toBe(false);
    expect(passoDoSetorOnda2('same')).toBe(1);
    expect(passoDoSetorOnda2('higienizacao')).toBe(7);
    expect(passoDoSetorOnda2('agendamento')).toBe(0);
  });
});

describe('roteiro de recolhimento e retorno (regras 4 e 5)', () => {
  it('lista as chaves, as operações a bloquear, o relatório de contingência e o retorno, sem citar o outro sistema', () => {
    const md = roteiroRecolhimentoMarkdown({
      setor: setor('enfermagem'),
      hospital: 'pc',
      operacoes: ['enfermagem.checarAdministracao'],
    });
    expect(md).toMatch(/^# Recolhimento e retorno: /);
    expect(md).toContain('`enfermagem.checarAdministracao`');
    expect(md).toContain('`enfermagem.sinaisVitais`');
    expect(md).toContain('relatório de contingência');
    expect(md).toContain('Teste de retorno ao sistema anterior (regra 5)');
    expect(md).not.toMatch(/spdata|legado/i);
  });
});

describe('recolher (regra 4)', () => {
  it('o setor inteiro desliga operações e recursos e bloqueia as operações', () => {
    const p = planoRecolhimento(setor('higienizacao'), [
      'hotelaria.solicitarLimpeza',
      'hotelaria.avancarLimpeza',
    ]);
    expect(p.bloquear).toEqual(['hotelaria.avancarLimpeza', 'hotelaria.solicitarLimpeza']);
    expect(p.chaves).toContain('hotelaria.limpeza');
  });
  it('uma operação só; operação não liberada não gera plano', () => {
    expect(planoRecolhimento(setor('sadt'), ['sadt.lancarExame'], 'sadt.lancarExame')).toEqual({
      chaves: ['sadt.lancarExame'],
      bloquear: ['sadt.lancarExame'],
    });
    expect(planoRecolhimento(setor('sadt'), [], 'sadt.lancarExame').chaves).toEqual([]);
  });
});

describe('Serrano depois do ProntoCardio (regra 8)', () => {
  it('o hospital inicial não espera ninguém', () => {
    expect(setoresQueSeguramHospital('pc', {})).toEqual([]);
  });
  it('o outro espera todo setor das ondas 1 a 5 pronto no inicial; o deixado de fora não segura', () => {
    const setores = SETORES_PRONTIDAO.filter((s) => s.onda >= 1);
    const todos = Object.fromEntries(setores.map((s) => [s.id, 'migrado']));
    expect(setoresQueSeguramHospital('hs', todos)).toEqual([]);
    expect(setoresQueSeguramHospital('hs', { ...todos, sadt: 'treinamento' })).toEqual(['sadt']);
    expect(setoresQueSeguramHospital('hs', { ...todos, sadt: 'fora' })).toEqual([]);
    expect(setoresQueSeguramHospital('hs', {}).length).toBe(setores.length);
  });
});

describe('regra 15', () => {
  it('acusa gravação direta em tabela proibida e aceita as exceções justificadas', () => {
    expect(
      violacoesRegra15([
        { nome: 'internacao.transferirLeito', tabelasGravadas: [{ tabela: 'RILEITOS', acao: 'UPDATE' }] },
        { nome: 'internacao.internar', tabelasGravadas: [{ tabela: 'RICADINT', acao: 'INSERT' }] },
        { nome: 'pep.prescrever', tabelasGravadas: [{ tabela: 'ATCONTA', acao: 'INSERT' }] },
        { nome: 'internacao.darAlta', tabelasGravadas: [{ tabela: 'TBLEITO', acao: 'UPDATE' }] },
      ]),
    ).toEqual([
      { operacao: 'pep.prescrever', tabela: 'ATCONTA', acao: 'INSERT' },
      { operacao: 'internacao.darAlta', tabela: 'TBLEITO', acao: 'UPDATE' },
    ]);
  });
});

describe('regra 16', () => {
  it('fora da janela publica; na janela só hotfix de S1', () => {
    expect(versaoPermitida('2026-12-10', null).permitida).toBe(true);
    expect(versaoPermitida('2026-12-25', 'S2')).toEqual({
      permitida: false,
      motivo: 'sem versão nova de 2026-12-24 a 2026-12-27 (Natal); só hotfix de S1',
    });
    expect(versaoPermitida('2027-01-01', 'S1').permitida).toBe(true);
    expect(versaoPermitida('2027-01-03', null).permitida).toBe(false);
    expect(versaoPermitida('2027-01-04', null).permitida).toBe(true);
  });
});

describe('cenários faltantes (campo 9)', () => {
  it('lista os da ficha que o catálogo não tem', () => {
    expect(cenariosFaltantes(['administrado', 'atrasado'], ['administrado', 'offline'])).toEqual([
      'atrasado',
    ]);
  });
});

describe('indicadores do acompanhamento (campo 4)', () => {
  it('checagem: só A e N contam, com comparação binária', () => {
    expect(
      indicadorChecagem([
        { dia: '2026-12-01', unidade: 'CTI', situacao: 'A', n: 3 },
        { dia: '2026-12-01', unidade: 'CTI', situacao: 'N', n: 1 },
        { dia: '2026-12-01', unidade: 'CTI', situacao: 'n', n: 4 },
        { dia: '2026-12-01', unidade: 'CTI', situacao: 'P', n: 2 },
        { dia: '2026-12-01', unidade: '2A', situacao: 'P', n: 5 },
      ]),
    ).toEqual([
      { dia: '2026-12-01', unidade: '2A', horarios: 5, checados: 0, percentual: 0 },
      { dia: '2026-12-01', unidade: 'CTI', horarios: 10, checados: 4, percentual: 40 },
    ]);
  });
  it('higienização: avança no outro sistema ou com etapa no novo, sem contar duas vezes', () => {
    expect(
      indicadorHigienizacao([
        { dia: '2026-12-01', unidade: 'CTI', situacao: 1, comEtapaNoNovo: 2, n: 5 },
        { dia: '2026-12-01', unidade: 'CTI', situacao: 3, comEtapaNoNovo: 1, n: 1 },
        { dia: '2026-12-01', unidade: '2A', situacao: 1, comEtapaNoNovo: 9, n: 3 },
      ]),
    ).toEqual([
      { dia: '2026-12-01', unidade: '2A', solicitacoes: 3, avancaram: 3, percentual: 100 },
      { dia: '2026-12-01', unidade: 'CTI', solicitacoes: 6, avancaram: 3, percentual: 50 },
    ]);
  });
  it('registros por sistema: trilha acima do total não dá negativo', () => {
    expect(
      registrosPorSistema(
        [
          { dia: '2026-12-01', tipo: 'prescricao', n: 10 },
          { dia: '2026-12-01', tipo: 'evolucao', n: 4 },
        ],
        [
          { dia: '2026-12-01', tipo: 'prescricao', n: 3 },
          { dia: '2026-12-01', tipo: 'evolucao', n: 6 },
        ],
      ),
    ).toEqual([
      { dia: '2026-12-01', tipo: 'evolucao', total: 4, peloNovo: 4, peloOutro: 0 },
      { dia: '2026-12-01', tipo: 'prescricao', total: 10, peloNovo: 3, peloOutro: 7 },
    ]);
  });
});
