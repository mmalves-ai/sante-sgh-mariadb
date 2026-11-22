// M55 (etapa 3; regra 5; lote F2.2 05-15): o alerta diário de vencimento dos contratos no worker. Os alertas do dia
// (90, 60 e 30 dias e vencido; vigente e a iniciar não avisam), a chave com o fim vigente e a faixa, o gestor e o fiscal
// sem repetir, a funcionalidade desligada sem leitura de contratos, o aviso já gravado que não repete, o contrato sem
// destinatário contado e a chave do serviço. A porta própria é um dublê; dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { PortaContratos } from './contratos-vencimento-propria.js';
import {
  alertaContratosLigado,
  alertasDoDia,
  cicloContratos,
  type ContratoParaAlerta,
  ContratosVencimentoService,
  TIPO_AVISO_CONTRATO,
} from './contratos-vencimento.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const EST: AlvoEstabelecimento = { cliente: 'cli_teste', id: 7, codigo: 'pc', fuso: 'America/Sao_Paulo' };
const HOJE = new Date('2026-10-28T15:00:00.000Z');

const contrato = (id: number, fim: string, x: Partial<ContratoParaAlerta> = {}): ContratoParaAlerta => ({
  id,
  numero: `CT-SINT-${id}`,
  situacao: 'vigente',
  inicio: '2026-01-01',
  fim,
  destinatarios: [11, 12],
  diasAlerta: null,
  assunto: null,
  mensagem: null,
  ...x,
});

function porta(estado: { ligada: boolean; contratos: ContratoParaAlerta[] }) {
  const avisos = new Set<string>();
  let leuContratos = 0;
  const p: PortaContratos = {
    estabelecimentos: async () => [EST],
    ligada: async () => estado.ligada,
    contratos: async () => {
      leuContratos++;
      return estado.contratos;
    },
    avisar: async (_e, a) => {
      let novos = 0;
      for (const d of a.destinatarios) {
        const k = `${d}|${a.chave}`;
        if (avisos.has(k)) continue;
        avisos.add(k);
        novos++;
      }
      return novos;
    },
  };
  return { p, avisos, lidos: () => leuContratos };
}

describe('alerta de vencimento dos contratos (M55.3)', () => {
  it('avisa só quem cruzou 90, 60 ou 30 dias ou venceu; a chave leva o fim vigente e a faixa', () => {
    const xs = alertasDoDia(
      [
        contrato(1, '2027-06-30'),
        contrato(2, '2027-01-20'),
        contrato(3, '2026-12-20'),
        contrato(4, '2026-11-10'),
        contrato(5, '2026-10-27'),
        contrato(6, '2027-12-31', { inicio: '2026-11-15' }),
      ],
      '2026-10-28',
    );
    expect(xs.map((x) => [x.contrato, x.faixa, x.chave])).toEqual([
      [2, 'vence-90', '2:2027-01-20:vence-90'],
      [3, 'vence-60', '3:2026-12-20:vence-60'],
      [4, 'vence-30', '4:2026-11-10:vence-30'],
      [5, 'vencido', '5:2026-10-27:vencido'],
    ]);
    expect(xs[3]!.titulo).toBe('Contrato CT-SINT-5 vencido em 27/10/2026');
    expect(xs[2]!.titulo).toBe('Contrato CT-SINT-4: vence em até 30 dias (10/11/2026)');
    expect(xs.map((x) => x.titulo).join('\n')).not.toMatch(/spdata|legado|SGH_/i);
  });

  it('o gestor e o fiscal iguais recebem um aviso só', () => {
    const [x] = alertasDoDia([contrato(9, '2026-11-01', { destinatarios: [11, 11] })], '2026-10-28');
    expect(x!.destinatarios).toEqual([11]);
  });

  it('grava uma vez por faixa; o segundo ciclo do dia não repete; a renovação reabre; sem destinatário é contado', async () => {
    const estado = { ligada: true, contratos: [contrato(2, '2027-01-20'), contrato(1, '2027-06-30')] };
    const { p } = porta(estado);
    expect(await cicloContratos(p, EST, HOJE)).toEqual({
      ligada: true,
      emAlerta: 1,
      avisos: 2,
      semDestinatario: 0,
    });
    expect(await cicloContratos(p, EST, HOJE)).toEqual({
      ligada: true,
      emAlerta: 1,
      avisos: 0,
      semDestinatario: 0,
    });
    estado.contratos = [contrato(2, '2026-12-01'), contrato(8, '2026-11-01', { destinatarios: [] })];
    expect(await cicloContratos(p, EST, HOJE)).toEqual({
      ligada: true,
      emAlerta: 2,
      avisos: 2,
      semDestinatario: 1,
    });
    expect(TIPO_AVISO_CONTRATO).toBe('contrato-vencimento');
  });

  it('com a funcionalidade desligada não lê contratos nem avisa', async () => {
    const x = porta({ ligada: false, contratos: [contrato(4, '2026-11-10')] });
    expect(await cicloContratos(x.p, EST, HOJE)).toEqual({
      ligada: false,
      emAlerta: 0,
      avisos: 0,
      semDestinatario: 0,
    });
    expect(x.lidos()).toBe(0);
  });

  it('o serviço: o ciclo por cliente e estabelecimento e a chave fora de dev/ci', async () => {
    const s = new ContratosVencimentoService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(
      { lerPlataforma: async () => [] as never, encerrar: async () => undefined },
      () => porta({ ligada: true, contratos: [contrato(7, '2026-11-20')] }).p,
    );
    const antes = process.env['WORKER_CLIENTES'];
    process.env['WORKER_CLIENTES'] = 'cli_teste';
    try {
      expect(await s.ciclo(HOJE)).toEqual([
        { cliente: 'cli_teste', estabelecimento: 'pc', emAlerta: 1, avisos: 2 },
      ]);
    } finally {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    }
    expect(alertaContratosLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(alertaContratosLigado({ AMBIENTE: 'producao', CONTRATOS_ALERTA_DIARIO: 'desligado' })).toBe(false);
    expect(alertaContratosLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(alertaContratosLigado({ AMBIENTE: 'ci', CONTRATOS_ALERTA_DIARIO: 'ligado' })).toBe(true);
    await s.onApplicationShutdown();
  });

  it('antecedência própria do contrato: faixa a mais, uma vez por fim; assunto e mensagem próprios no aviso', () => {
    const xs = alertasDoDia(
      [
        contrato(21, '2026-11-15', {
          diasAlerta: 20,
          assunto: 'Renovar limpeza',
          mensagem: 'Pedir três orçamentos.',
        }),
        contrato(22, '2026-12-27', { diasAlerta: 60 }),
        contrato(23, '2027-03-01', { diasAlerta: 130 }),
      ],
      '2026-10-28',
    );
    const de21 = xs.filter((x) => x.contrato === 21);
    expect(de21.map((x) => x.faixa)).toEqual(['vence-30', 'antecedencia-contrato']);
    expect(de21[1]!.chave).toBe('21:2026-11-15:antecedencia-20');
    expect(
      de21.every(
        (x) => x.titulo === 'Renovar limpeza (vence em 15/11/2026)' && x.texto === 'Pedir três orçamentos.',
      ),
    ).toBe(true);
    // 60 dias coincide com a faixa padrão: não duplica.
    expect(xs.filter((x) => x.contrato === 22).map((x) => x.faixa)).toEqual(['vence-60']);
    expect(xs.filter((x) => x.contrato === 23).map((x) => x.faixa)).toEqual(['antecedencia-contrato']);
  });
});
