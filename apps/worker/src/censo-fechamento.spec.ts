// internacao.fecharCenso no worker (lote F2.2 05-15): só com a chave ligada; fecha o último dia do censo uma vez (o
// segundo desiste); fecha os dias da janela que ficaram sem retrato, em ordem; dev/ci só com CENSO_FECHAMENTO=ligado.
// A porta própria é trocada por um dublê (nada conecta a banco); a prova sobre o MariaDB é a
// censo-fechamento-propria.int.spec.ts. Dados sintéticos.
import type { MovimentoInternacao } from '@sgh/contratos';
import { grupoDoTipoSaida } from '@sgh/dominio-internacao';
import { describe, expect, it } from 'vitest';
import type { DiaCensoParaGravar, PortaCenso } from './censo-fechamento-propria.js';
import {
  CensoFechamentoService,
  fechamentoLigado,
  fecharCensoDoEstabelecimento,
  JANELA_FECHAMENTO_DIAS,
} from './censo-fechamento.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const EST: AlvoEstabelecimento = { cliente: 'cli_teste', id: 7, codigo: 'pc', fuso: 'America/Sao_Paulo' };

const MOV: MovimentoInternacao = {
  internacoes: [
    {
      bloco: '1',
      acomodacao: 'ENF',
      leito: '01',
      reg: 1,
      paciente: 1,
      entrada: D('2026-10-18'),
      horaEntrada: '1000',
      alta: null,
      horaAlta: null,
      motivo: null,
      grupoSaida: grupoDoTipoSaida(null),
      carater: '1',
      clinica: 'Clínica médica',
      permanencia: null,
    },
  ],
  trechos: [
    {
      bloco: '1',
      acomodacao: 'ENF',
      leito: '01',
      reg: 1,
      cod: 1,
      entrada: D('2026-10-18'),
      horaEntrada: '1000',
      saida: null,
      horaSaida: null,
      tipo: 1,
    },
  ],
  transferencias: [],
  unidades: [{ bloco: '1', acomodacao: 'ENF', nome: 'Enf', tipo: 1, leitos: 2, leitosAtivos: 2 }],
  tipos: new Map([[1, 'Enfermaria']]),
  dadosAte: D('2026-10-20'),
};

function porta(opcoes: {
  ligada: boolean;
  fechados?: string[];
  jaNaGravacao?: boolean;
  semAcomodacao?: boolean;
  intensivas?: number[];
}) {
  const gravados: DiaCensoParaGravar[] = [];
  const p: PortaCenso = {
    estabelecimentos: async () => [EST],
    configuracao: async () => ({ ligada: opcoes.ligada, horaFechamento: null, categoriasIntensivas: opcoes.intensivas ?? [] }),
    diasFechados: async () => [...(opcoes.fechados ?? [])],
    movimento: async () => MOV,
    gravarDia: async (_e, d) => {
      if (opcoes.jaNaGravacao) return null;
      if (opcoes.semAcomodacao) return { unidades: 0, linhas: 0, internados: 0 };
      gravados.push(d);
      return { unidades: 1, linhas: d.linhas.length, internados: d.linhas.reduce((a, l) => a + l.internados, 0) };
    },
  };
  return { p, gravados };
}

// 2026-10-20 13:00 UTC = 10:00 em São Paulo: o último dia fechado (meia-noite) é 2026-10-19.
const AGORA = Date.UTC(2026, 9, 20, 13, 0);
const SEMANA = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'];

describe('fechamento do censo no worker', () => {
  it('chave desligada: nada é gravado', async () => {
    const { p, gravados } = porta({ ligada: false });
    expect(await fecharCensoDoEstabelecimento(p, EST, AGORA)).toEqual({ situacao: 'desligado' });
    expect(gravados).toEqual([]);
  });

  it('ligada: fecha o dia anterior uma vez, com a versão do cálculo e a hora padrão', async () => {
    const { p, gravados } = porta({ ligada: true, fechados: SEMANA.slice(0, 6) });
    const r = await fecharCensoDoEstabelecimento(p, EST, AGORA);
    expect(r).toMatchObject({ situacao: 'fechado', data: '2026-10-19', internados: 1, dias: ['2026-10-19'] });
    expect(gravados).toHaveLength(1);
    expect(gravados[0]).toMatchObject({ data: '2026-10-19', versaoCalculo: 1 });
    expect(gravados[0]!.horaFechamento).toBeGreaterThanOrEqual(1);
  });

  it('já fechado (antes ou por outro processo durante a gravação): desiste', async () => {
    expect(await fecharCensoDoEstabelecimento(porta({ ligada: true, fechados: SEMANA }).p, EST, AGORA)).toEqual({
      situacao: 'ja-fechado',
    });
    expect(await fecharCensoDoEstabelecimento(porta({ ligada: true, jaNaGravacao: true }).p, EST, AGORA)).toEqual({
      situacao: 'ja-fechado',
    });
  });

  it('sem acomodação de internação no cadastro: nada é gravado e o resultado diz por quê', async () => {
    expect(await fecharCensoDoEstabelecimento(porta({ ligada: true, semAcomodacao: true }).p, EST, AGORA)).toEqual({
      situacao: 'sem-acomodacao',
    });
  });

  it('a terapia intensiva vem das categorias de acomodação da porta (não de códigos fixos)', async () => {
    const comUti = porta({ ligada: true, fechados: SEMANA.slice(0, -1), intensivas: [1] });
    await fecharCensoDoEstabelecimento(comUti.p, EST, AGORA);
    expect(comUti.gravados[0]?.linhas.every((l) => l.intensiva)).toBe(true);
    const semUti = porta({ ligada: true, fechados: SEMANA.slice(0, -1), intensivas: [3, 7, 8, 9, 17] });
    await fecharCensoDoEstabelecimento(semUti.p, EST, AGORA);
    expect(semUti.gravados[0]?.linhas.some((l) => l.intensiva)).toBe(false);
  });

  it('dia perdido (worker parado na hora de fechar): fecha os dias da janela sem retrato, em ordem', async () => {
    const { p, gravados } = porta({
      ligada: true,
      fechados: SEMANA.filter((d) => !['2026-10-15', '2026-10-18', '2026-10-19'].includes(d)),
    });
    const r = await fecharCensoDoEstabelecimento(p, EST, AGORA);
    expect(r).toMatchObject({ situacao: 'fechado', data: '2026-10-19', internados: 1 });
    expect(r.situacao === 'fechado' && r.dias).toEqual(['2026-10-15', '2026-10-18', '2026-10-19']);
    expect(gravados.map((g) => g.data)).toEqual(['2026-10-15', '2026-10-18', '2026-10-19']);
    expect(JANELA_FECHAMENTO_DIAS).toBe(7);
  });

  it('ligado fora de dev/ci; em dev/ci só pedido; o ciclo percorre clientes e estabelecimentos', async () => {
    expect(fechamentoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(fechamentoLigado({ AMBIENTE: 'producao', CENSO_FECHAMENTO: 'desligado' })).toBe(false);
    expect(fechamentoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(fechamentoLigado({ AMBIENTE: 'ci', CENSO_FECHAMENTO: 'ligado' })).toBe(true);
    const s = new CensoFechamentoService();
    expect(await s.ciclo()).toEqual([]);
    const plataforma = { lerPlataforma: async () => [] as never, encerrar: async () => undefined };
    s.usar(plataforma, () => porta({ ligada: false }).p);
    const antes = process.env['WORKER_CLIENTES'];
    process.env['WORKER_CLIENTES'] = 'cli_teste';
    try {
      expect(await s.ciclo(AGORA)).toEqual([{ situacao: 'desligado', cliente: 'cli_teste', estabelecimento: 'pc' }]);
    } finally {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    }
    await s.onApplicationShutdown();
  });
});
