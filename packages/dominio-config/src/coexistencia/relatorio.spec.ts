// Regra 9 do M37: o relatório diário e semanal com as parcelas impressas e sem dado pessoal.
import { describe, expect, it } from 'vitest';
import { calcularParcela } from './parcela.js';
import { type DadosRelatorioCoex, relatorioCoexistenciaMarkdown } from './relatorio.js';

const dados: DadosRelatorioCoex = {
  periodo: 'dia',
  dia: '2026-11-04',
  inicio: '2026-11-04',
  geradoEm: '2026-11-04T23:00:00.000Z',
  esteira: { verificar: 'verde', cobertura: 'não informada' },
  decisoes: [
    { id: 'DP-3', assunto: 'chave-usuários', prazo: '2026-11-06', vencendo: true },
    { id: 'DP-15', assunto: 'estações de treino', prazo: null, vencendo: false },
  ],
  hospitais: [
    {
      codigo: 'pc',
      nome: 'ProntoCardio',
      bloqueio: null,
      aguardandoPrimeiro: false,
      operacoes: { verde: 500, especificada: 30 },
      setores: [
        {
          codigo: 'agendamento',
          nome: 'Agendamento',
          onda: 1,
          situacao: 'liberado',
          pessoas: 31,
          treinados: 3,
          parcela: calcularParcela(100, 61),
        },
      ],
      chamados: [
        { severidade: 'S1', abertos: 0, vencidos: 0, resolvidos: 1 },
        { severidade: 'S2', abertos: 2, vencidos: 0, resolvidos: 7 },
      ],
      carga: { conexoesPorSistema: [{ sistema: 'novo', conexoes: 4 }], transacoesLongas: 0 },
      lotes: { aplicados: 1, recolhidos: 0 },
    },
    {
      codigo: 'hs',
      nome: 'Serrano',
      bloqueio: 'sem a cópia do estabelecimento (HS-1)',
      aguardandoPrimeiro: true,
      operacoes: {},
      setores: [],
      chamados: [],
      carga: null,
      lotes: { aplicados: 0, recolhidos: 0 },
    },
  ],
};

describe('relatório de governança (regra 9)', () => {
  it('diário: parcelas impressas, contagens pequenas como <5, bloqueio do Serrano, decisões', () => {
    const md = relatorioCoexistenciaMarkdown(dados);
    expect(md).toContain('# Relatório diário da coexistência — 2026-11-04');
    expect(md).toContain('novo 61 de 100 = 61%');
    expect(md).toContain('| Agendamento | 1 | liberado | 31 | <5 |');
    expect(md).toContain('| S2 | <5 | 0 | 7 |');
    expect(md).toContain('Bloqueio: sem a cópia do estabelecimento (HS-1).');
    expect(md).toContain('DP-3: chave-usuários (prazo 2026-11-06, vencendo).');
    expect(md).toContain('Setores liberados: 1 de 1.');
    expect(md).not.toMatch(/SPDATA|legado/i);
  });

  it('semanal: carga do banco sempre; sem chamado nem decisão', () => {
    const h = dados.hospitais[0]!;
    const md = relatorioCoexistenciaMarkdown({
      ...dados,
      periodo: 'semana',
      inicio: '2026-10-29',
      decisoes: [],
      hospitais: [{ ...h, chamados: [], carga: null, aguardandoPrimeiro: true, operacoes: {} }],
    });
    expect(md).toContain('— 2026-10-29 a 2026-11-04');
    expect(md).toContain('Sem leitura da carga no período.');
    expect(md).toContain('Nenhum chamado no período.');
    expect(md).toContain('Nenhuma decisão pendente registrada.');
    expect(md).toContain('Aguardando o ProntoCardio');
    expect(md).toContain('Nenhuma operação no catálogo.');
  });

  it('M43 (regra 9): o semanal lista os setores depois da meta da onda com a nova data proposta', () => {
    const h = dados.hospitais[0]!;
    const semAtraso = relatorioCoexistenciaMarkdown({
      ...dados,
      periodo: 'semana',
      hospitais: [{ ...h, atrasados: [] }],
    });
    expect(semAtraso).toContain('Nenhum: todos os setores com a meta vencida já passaram a este sistema.');
    const md = relatorioCoexistenciaMarkdown({
      ...dados,
      periodo: 'semana',
      hospitais: [
        {
          ...h,
          atrasados: [
            {
              codigo: 'farmacia',
              nome: 'Farmácia',
              onda: 3,
              situacao: 'treinamento',
              meta: '2026-12-31',
              novaData: '2027-02-28',
            },
          ],
        },
      ],
    });
    expect(md).toContain('### Setores no outro sistema depois da meta da onda');
    expect(md).toContain('| Farmácia | 3 | em treinamento | 2026-12-31 | 2027-02-28 |');
    expect(md).toContain('o dono revê');
    // O diário só mostra a seção quando há setor atrasado.
    expect(relatorioCoexistenciaMarkdown(dados)).not.toContain('depois da meta da onda');
  });
});
