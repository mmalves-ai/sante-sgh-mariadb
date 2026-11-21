// M46 (etapa 1): contratos da anestesia (vocabulário, entradas, permissões, eventos e a chave de liberação). Dados
// sintéticos.
import { describe, expect, it } from 'vitest';
import { eventoAuditavel } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_ANESTESIA_CODIGOS, PERMISSOES_ANESTESIA_M46 } from '../permissoes/anestesia.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaAssinarFicha,
  esquemaEncerrarLancamentoFicha,
  esquemaLancarFicha,
  esquemaMarcarTempoFicha,
  esquemaPassarResponsabilidade,
  esquemaRegistrarApa,
  esquemaRegistrarSrpa,
} from './anestesia-entradas.js';
import {
  CLASSES_ASA,
  ITENS_ALDRETE,
  PARTES_FICHA,
  REGRA_ALTA_SRPA_V1,
  SINAIS_FICHA,
  SINAIS_FICHA_OBRIGATORIOS,
} from './anestesia-vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const apa = {
  agendamento: 10,
  chave: 'apa-0001-sintetica',
  avaliadoEm: '2026-10-24T08:00',
  asa: 2,
  viaAerea: { mallampati: 2 },
  jejum: { refeicaoLeve: '2026-10-23T22:00', liquidosClaros: '2026-10-24T05:00' },
  alergiasConferidas: true,
  plano: { tipoAnestesia: 4 },
  conclusao: 'apto',
};

describe('vocabulário da anestesia', () => {
  it('ASA de I a VI, Aldrete com cinco itens de três níveis e a regra de alta v1', () => {
    expect(CLASSES_ASA.map((c) => c.classe)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ITENS_ALDRETE).toHaveLength(5);
    expect(ITENS_ALDRETE.every((i) => i.niveis.length === 3)).toBe(true);
    expect(REGRA_ALTA_SRPA_V1).toMatchObject({ versao: 1, aldreteMinimo: 9, destinosSemIndice: ['uti'] });
  });
  it('sinais obrigatórios da grade de 5 minutos e faixas coerentes', () => {
    expect(SINAIS_FICHA_OBRIGATORIOS).toEqual(['pas', 'pad', 'fc', 'spo2']);
    for (const s of Object.values(SINAIS_FICHA)) expect(s.minimo).toBeLessThan(s.maximo);
  });
  it('cada parte da ficha é um código de negócio único (coluna parte do lançamento da ficha)', () => {
    for (const p of PARTES_FICHA) expect(p.parte).toMatch(/^[a-z][A-Za-z]*$/);
    expect(new Set(PARTES_FICHA.map((p) => p.parte)).size).toBe(PARTES_FICHA.length);
  });
});

describe('entradas', () => {
  it('APA mínima com os padrões; apto com ressalvas exige as ressalvas', () => {
    const r = esquemaRegistrarApa.parse(apa);
    expect(r).toMatchObject({ emergencia: false, versao: 0, criteriosLee: [] });
    expect(r.jejum.leiteMaterno).toBeNull();
    expect(r.viaAerea.historicoViaAereaDificil).toBe(false);
    expect(esquemaRegistrarApa.safeParse({ ...apa, conclusao: 'apto-ressalvas' }).success).toBe(false);
    expect(
      esquemaRegistrarApa.safeParse({
        ...apa,
        conclusao: 'apto-ressalvas',
        ressalvas: 'Via aérea difícil prevista',
      }).success,
    ).toBe(true);
    expect(esquemaRegistrarApa.safeParse({ ...apa, asa: 7 }).success).toBe(false);
    expect(esquemaRegistrarApa.safeParse({ ...apa, criteriosLee: ['inventado'] }).success).toBe(false);
  });
  it('lote da ficha com as partes; parte desconhecida e "outro" sem descrição recusados', () => {
    const lote = {
      agendamento: 10,
      chave: 'fa-lote-0001',
      lancamentos: [
        { parte: 'sinal', momento: '2026-10-24T09:00', tipo: 'fc', valor: 72 },
        { parte: 'medicamento', momento: '2026-10-24T09:01', item: 55, dose: 2, unidade: 'mg', via: 'ev' },
        { parte: 'gas', momento: '2026-10-24T09:02', gas: 'sevoflurano', valor: 2 },
        { parte: 'fluido', momento: '2026-10-24T09:03', fluido: 'cristaloide', volumeMl: 500 },
        { parte: 'perda', momento: '2026-10-24T09:30', perda: 'sangramento', volumeMl: 150 },
        { parte: 'evento', momento: '2026-10-24T09:04', evento: 'intubacao' },
        { parte: 'modoRespiratorio', momento: '2026-10-24T09:04', modo: 3 },
        { parte: 'posicao', momento: '2026-10-24T09:05', posicao: 1 },
        { parte: 'equipe', momento: '2026-10-24T09:00', profissional: { id: 9, cod: 90 }, funcao: 6 },
      ],
    };
    expect(esquemaLancarFicha.parse(lote).lancamentos).toHaveLength(9);
    expect(
      esquemaLancarFicha.safeParse({ ...lote, lancamentos: [{ parte: 'xyz', momento: '2026-10-24T09:00' }] })
        .success,
    ).toBe(false);
    expect(
      esquemaLancarFicha.safeParse({
        ...lote,
        lancamentos: [{ parte: 'evento', momento: '2026-10-24T09:00', evento: 'outro' }],
      }).success,
    ).toBe(false);
    expect(esquemaLancarFicha.safeParse({ ...lote, lancamentos: [] }).success).toBe(false);
  });
  it('marco, passagem e assinatura', () => {
    expect(
      esquemaMarcarTempoFicha.safeParse({
        agendamento: 1,
        chave: 'fa-marco-0001',
        marco: 'inicioAnestesia',
        momento: '2026-10-24T09:00',
      }).success,
    ).toBe(true);
    expect(
      esquemaPassarResponsabilidade.safeParse({
        agendamento: 1,
        chave: 'fa-pass-0001',
        momento: '2026-10-24T10:00',
        para: { id: 2, cod: 20 },
        resumo: 'curto',
      }).success,
    ).toBe(false);
    expect(esquemaAssinarFicha.safeParse({ agendamento: 1, chave: 'fa-assin-0001' }).success).toBe(false);
    expect(
      esquemaEncerrarLancamentoFicha.safeParse({
        agendamento: 1,
        chave: 'fa-fim-0001',
        lancamento: 3,
        fim: '2026-10-24T10:00',
      }).success,
    ).toBe(true);
  });
  it('SRPA: o destino vai só na alta e a alta exige o destino', () => {
    const base = {
      agendamento: 1,
      chave: 'srpa-0001-sint',
      em: '2026-10-24T11:00',
      aldrete: { atividade: 2, respiracao: 2, circulacao: 2, consciencia: 2, saturacao: 2 },
      dor: 1,
      nvpo: 0,
    };
    expect(esquemaRegistrarSrpa.safeParse({ ...base, momento: 'admissao' }).success).toBe(true);
    expect(esquemaRegistrarSrpa.safeParse({ ...base, momento: 'alta' }).success).toBe(false);
    expect(esquemaRegistrarSrpa.safeParse({ ...base, momento: 'alta', destino: 'unidade' }).success).toBe(
      true,
    );
    expect(esquemaRegistrarSrpa.safeParse({ ...base, momento: 'avaliacao', destino: 'uti' }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarSrpa.safeParse({
        ...base,
        momento: 'admissao',
        aldrete: { ...base.aldrete, atividade: 3 },
      }).success,
    ).toBe(false);
  });
});

describe('permissões, eventos e liberação', () => {
  it('as sete permissões no catálogo, no formato, com opção do sistema anterior e categoria clínica', () => {
    expect(PERMISSOES_ANESTESIA_M46.map((p) => p.codigo).sort()).toEqual(
      Object.values(PERMISSOES_ANESTESIA_CODIGOS).sort(),
    );
    for (const p of PERMISSOES_ANESTESIA_M46) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(opcoesDoMapa(p.codigo).length).toBeGreaterThan(0);
      expect(p.categoria).toBe('clinica');
      expect(CATALOGO_DECLARADO.filter((c) => c.codigo === p.codigo)).toHaveLength(1);
    }
    const assinar = PERMISSOES_ANESTESIA_M46.find(
      (p) => p.codigo === PERMISSOES_ANESTESIA_CODIGOS.fichaAssinar,
    );
    expect(assinar).toMatchObject({ criticidade: 'critica', exigeConselho: true });
  });
  it('os eventos da regra 13 desta etapa existem e ficam só na trilha própria', () => {
    for (const c of [
      'cirurgia.apa.registrada',
      'cirurgia.fichaAnestesica.lancada',
      'cirurgia.fichaAnestesica.passagem',
      'cirurgia.fichaAnestesica.assinada',
      'cirurgia.fichaAnestesica.adendo',
      'cirurgia.srpa.registrada',
      'cirurgia.srpa.alta',
      'cirurgia.anestesia.lida',
    ])
      expect(eventoAuditavel(c)).toMatchObject({ codigo: c, legado: null });
  });
  it('a chave bloco.ficha nasce desligada, do M46, com os pré-requisitos', () => {
    const r = recursoDesligado('bloco.ficha');
    expect(r?.marco).toBe('M46');
    expect(r?.prerequisitos.length).toBe(2);
  });
});
