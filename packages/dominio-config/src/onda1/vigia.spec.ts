// M39: a vigilância diária da onda 1 confere só a estrutura que não muda depois da gravação (D-VIGIA-39).
import type { Assinatura } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { vigiarHospitalDia } from '../onda0/vigia.js';
import { CENARIO_IMUTAVEL, comparacoesImutaveis, diferencasImutaveis, referenciaImutavel } from './vigia.js';

const ref = (cenario: string, colunas: Record<string, string>, linhas = 1): Assinatura =>
  ({
    formato: 1,
    operacao: 'agenda.agendarConsulta',
    cenario,
    origem: 'perfil',
    hospitais: ['pc'],
    impressaoSchema: null,
    diferencas_aceitas: [],
    tabelas: [
      {
        tabela: 'REPACAGD',
        acao: 'INSERT',
        linhas,
        colunas: Object.fromEntries(Object.entries(colunas).map(([k, classe]) => [k, { classe }])),
      },
      { tabela: 'REPACAGI', acao: 'UPDATE', linhas: 1, colunas: { PACIENTE: { classe: 'entrada' } } },
    ],
    ligacoes: [],
    efeitosTrigger: [],
    generators: {},
  }) as unknown as Assinatura;

const A = ref('primeira', {
  ID: 'generator',
  DT_AGE: 'carimbo-banco',
  NOME: 'copia:REPACAGI.NOME',
  ID_RICADPAC_X: 'copia:REPACAGD.ID',
  TP_AGE: 'dominio:0|10',
  OBS: 'entrada',
  DATA_HORA_AGENDAMENTO: 'copia:REPACAGD.DATA',
});
const B = ref('retorno', {
  ID: 'generator',
  DT_AGE: 'carimbo-banco',
  NOME: 'copia:REPACAGI.NOME',
  OBS: 'vazio',
  DATA_HORA_AGENDAMENTO: 'entrada',
});
const recusa = { ...A, cenario: 'recusa', tabelas: [] } as Assinatura;

const preenchida = (cols: string[], vazias: string[] = []) => ({
  tabelas: [
    {
      tabela: 'REPACAGD',
      acao: 'INSERT' as const,
      linhas: [
        Object.fromEntries([
          ...cols.map((c) => [c, { preenchida: true, confere: null }]),
          ...vazias.map((c) => [c, { preenchida: false, confere: null }]),
        ]),
      ],
    },
  ],
});

describe('referência imutável', () => {
  it('só a principal, 1 linha, e as colunas imutáveis em todas as referências de sucesso', () => {
    const r = referenciaImutavel([A, B, recusa], { tabela: 'REPACAGD', chave: 'ID' })!;
    expect(r.cenario).toBe(CENARIO_IMUTAVEL);
    expect(r.tabelas).toHaveLength(1);
    expect(r.tabelas[0]).toMatchObject({ tabela: 'REPACAGD', acao: 'INSERT', linhas: 1 });
    // DATA_HORA_AGENDAMENTO é cópia numa e entrada noutra: fica de fora; TP_AGE (domínio) e OBS (entrada) também.
    expect(Object.keys(r.tabelas[0]!.colunas).sort()).toEqual(['DT_AGE', 'ID', 'NOME']);
    expect(referenciaImutavel([recusa], { tabela: 'REPACAGD', chave: 'ID' })).toBeNull();
  });

  it('diverge só quando uma coluna imutável ficou vazia; o resto da linha anda livre e a linha removida não conta', () => {
    const r = referenciaImutavel([A, B], { tabela: 'REPACAGD', chave: 'ID' })!;
    expect(diferencasImutaveis(r, preenchida(['ID', 'DT_AGE', 'NOME', 'OBS', 'TP_AGE', 'SITUACAO']))).toEqual(
      [],
    );
    expect(diferencasImutaveis(r, preenchida(['ID', 'NOME'], ['DT_AGE']))).toEqual([
      {
        tipo: 'colunas',
        elemento: 'REPACAGD:INSERT.colunas.DT_AGE',
        esperado: 'carimbo-banco',
        obtido: 'vazia',
        aceita: false,
      },
    ]);
    // A linha removida depois (cancelamento, desfazer, unificação) não é divergência.
    expect(diferencasImutaveis(r, { tabelas: [] })).toEqual([]);
  });

  it('no banco, só o preenchimento: a cópia da própria chave (a unificação muda) não confere valor', () => {
    const r = referenciaImutavel([A], { tabela: 'REPACAGD', chave: 'ID' })!;
    const c = comparacoesImutaveis(r, 'REPACAGD', { tabela: 'REPACAGD', chave: 'ID' });
    expect(Object.values(c).every((x) => x.tipo === 'nenhuma')).toBe(true);
  });

  it('o dia do hospital: a operação que só altera linha viva sai "fora da amostra", com o motivo', async () => {
    const r = await vigiarHospitalDia({
      hospital: 'pc',
      data: '2026-11-09',
      tamanho: 50,
      operacoes: ['agenda.agendarConsulta', 'recepcao.chamarSenha', 'x.semNada'],
      localizavel: (op) => op === 'agenda.agendarConsulta',
      foraDaAmostra: (op) => (op === 'recepcao.chamarSenha' ? 'altera linha existente' : null),
      gravacoesDoDia: async () => [{ id: '1', cenario: CENARIO_IMUTAVEL }],
      referencias: () => ({
        [CENARIO_IMUTAVEL]: referenciaImutavel([A], { tabela: 'REPACAGD', chave: 'ID' })!,
      }),
      lerEstrutura: async () => preenchida(['ID', 'NOME'], ['DT_AGE']),
      comparar: (op) => (op === 'agenda.agendarConsulta' ? diferencasImutaveis : undefined),
    });
    expect(r.foraDaAmostra).toEqual([{ operacao: 'recepcao.chamarSenha', motivo: 'altera linha existente' }]);
    expect(r.semLocalizador).toEqual(['x.semNada']);
    expect(r.resultados[0]).toMatchObject({
      operacao: 'agenda.agendarConsulta',
      amostradas: 1,
      divergentes: 1,
    });
    expect(r.alertas).toHaveLength(1);
  });
});
