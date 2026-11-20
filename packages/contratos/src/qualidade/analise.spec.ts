// Entradas da etapa 2 do M48: análise, plano 5W2H, vigilância de produto, sugestão e período do painel.
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_FONTE_SUGESTAO,
  esquemaDispensarSugestao,
  esquemaPeriodoPainel,
  esquemaRegistrarAnalise,
  esquemaRegistrarPlanoAcao,
  esquemaRegistrarQueixaTecnica,
  FONTES_SUGESTAO,
  FORMATO_ORIGEM_SUGESTAO,
  TIPOS_VIGILANCIA_PRODUTO,
} from './analise.js';
import { CODIGOS_TIPO_INCIDENTE } from './notificacao.js';

const acao = {
  oQue: 'Revisar o POP de grades',
  porQue: 'Grade abaixada sem orientação',
  onde: 'Unidade 3',
  quando: '2026-11-30',
  quem: 'SINT.COORD',
  como: 'Treinamento no plantão',
  quanto: null,
};

describe('contratos da etapa 2 do M48', () => {
  it('análise pelos três métodos', () => {
    const base = {
      notificacao: 1,
      versao: 0,
      causaRaiz: null,
      fatores: [],
      licoes: null,
      concluir: false,
      semAcaoJustificativa: null,
    };
    expect(
      esquemaRegistrarAnalise.safeParse({
        ...base,
        conteudo: { metodo: 'cincoPorques', porques: ['Por quê?'] },
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarAnalise.safeParse({
        ...base,
        conteudo: { metodo: 'ishikawa', causas: [{ categoria: 'maquina', texto: 'Bomba sem manutenção' }] },
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarAnalise.safeParse({
        ...base,
        conteudo: {
          metodo: 'londres',
          cronologia: 'Fatos em ordem sintética.',
          problemas: [{ descricao: 'Sem dupla checagem', fatores: ['equipe'] }],
        },
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarAnalise.safeParse({ ...base, conteudo: { metodo: 'ishikawa', causas: [] } }).success,
    ).toBe(false);
    expect(
      esquemaRegistrarAnalise.safeParse({
        ...base,
        conteudo: {
          metodo: 'londres',
          cronologia: 'Fatos em ordem.',
          problemas: [{ descricao: 'Algo', fatores: [] }],
        },
      }).success,
    ).toBe(false);
  });

  it('plano 5W2H: incluir, alterar, situação e eficácia', () => {
    expect(esquemaRegistrarPlanoAcao.safeParse({ tipo: 'incluir', notificacao: 1, acao }).success).toBe(true);
    expect(
      esquemaRegistrarPlanoAcao.safeParse({ tipo: 'alterar', notificacao: 1, id: 2, versao: 1, acao })
        .success,
    ).toBe(true);
    expect(
      esquemaRegistrarPlanoAcao.safeParse({
        tipo: 'situacao',
        notificacao: 1,
        id: 2,
        versao: 1,
        situacao: 'planejada',
        texto: null,
      }).success,
    ).toBe(false);
    expect(
      esquemaRegistrarPlanoAcao.safeParse({
        tipo: 'eficacia',
        notificacao: 1,
        id: 2,
        versao: 1,
        eficacia: 'eficaz',
        texto: 'Nenhuma queda em 60 dias.',
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarPlanoAcao.safeParse({ tipo: 'incluir', notificacao: 1, acao: { ...acao, quem: 'a b' } })
        .success,
    ).toBe(false);
  });

  it('vigilância de produto: produto do cadastro ou descrito; alerta com número', () => {
    const abrir = {
      acao: 'abrir',
      area: 'tecnovigilancia',
      tipo: 'queixaTecnica',
      item: 10,
      produto: null,
      lote: 'L-123',
      serie: null,
      fabricante: null,
      registroAnvisa: '10234560001',
      descricao: 'Equipo com vazamento na conexão.',
      notificacao: null,
      alerta: null,
      conduta: 'segregado',
    };
    expect(esquemaRegistrarQueixaTecnica.safeParse(abrir).success).toBe(true);
    expect(esquemaRegistrarQueixaTecnica.safeParse({ ...abrir, item: null }).success).toBe(false);
    expect(esquemaRegistrarQueixaTecnica.safeParse({ ...abrir, tipo: 'alertaSanitario' }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarQueixaTecnica.safeParse({ ...abrir, tipo: 'alertaSanitario', alerta: 'Alerta 1234' })
        .success,
    ).toBe(true);
    expect(
      esquemaRegistrarQueixaTecnica.safeParse({
        acao: 'andamento',
        id: 1,
        versao: 1,
        situacao: 'notificada',
        conduta: 'recolhido',
        notivisaNumero: '2026.123',
        texto: 'Notificado e recolhido.',
      }).success,
    ).toBe(true);
    for (const t of TIPOS_VIGILANCIA_PRODUTO) expect(t.areas.length).toBeGreaterThan(0);
  });

  it('sugestão: as fontes têm o tipo do incidente e o formato da origem', () => {
    for (const f of FONTES_SUGESTAO) {
      expect(CODIGOS_TIPO_INCIDENTE).toContain(f.tipo);
      expect(FORMATO_ORIGEM_SUGESTAO.test(`${f.codigo}:1`)).toBe(true);
    }
    expect(CODIGOS_FONTE_SUGESTAO).toHaveLength(FONTES_SUGESTAO.length);
    expect(esquemaDispensarSugestao.safeParse({ origem: 'omitida:5' }).success).toBe(true);
    expect(esquemaDispensarSugestao.safeParse({ origem: 'omitida' }).success).toBe(false);
  });

  it('período do painel', () => {
    expect(esquemaPeriodoPainel.safeParse({ de: '2026-10-01', ate: '2026-10-26' }).success).toBe(true);
    expect(esquemaPeriodoPainel.safeParse({ de: '2026-10-27', ate: '2026-10-26' }).success).toBe(false);
  });
});
