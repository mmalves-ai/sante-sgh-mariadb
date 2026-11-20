// M55 (etapa 3; regra 5; ficha, seção 4): o alerta diário de vencimento dos contratos no worker. Os alertas do dia
// (90, 60 e 30 dias e vencido; vigente e a iniciar não avisam), a chave do objeto com o fim vigente e a faixa, o gestor e
// o fiscal sem repetir, a funcionalidade desligada sem leitura de contratos, o aviso já gravado que não repete nem
// grava trilha e a chave do serviço. O legado é simulado; dados sintéticos.
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({
  ligada: true,
  contratos: [] as unknown[],
  avisos: new Set<string>(),
  trilhas: [] as Record<string, unknown>[],
  leuContratos: 0,
}));

vi.mock('@sgh/legado', () => ({
  NucleoLegado: class {},
  lerCodigos: () => ['pc'],
  lerConfiguracaoNucleo: () => ({ bibliotecaCliente: null }),
  somenteSgh: (e: unknown) => e,
  lerChavesLiberacao: async () => [{ chave: 'contratos', tipo: 'recurso', ligada: estado.ligada }],
  contratosParaAlerta: async () => {
    estado.leuContratos++;
    return { hoje: '2026-10-28', contratos: estado.contratos };
  },
  gravarAviso: async (_e: unknown, a: { login: string; evento: string; objetoChave: string }) => {
    const k = `${a.login}|${a.evento}|${a.objetoChave}`;
    if (estado.avisos.has(k)) return null;
    estado.avisos.add(k);
    return estado.avisos.size;
  },
  gravarTrilha: async (_e: unknown, t: Record<string, unknown>) => {
    estado.trilhas.push(t);
  },
}));
vi.mock('@sgh/legado/nativo', () => ({ criarDriverNativo: () => null }));

const {
  alertaContratosLigado,
  alertasDoDia,
  cicloContratos,
  ContratosVencimentoService,
  TIPO_AVISO_CONTRATO,
} = await import('./contratos-vencimento.service.js');

const contrato = (id: number, fim: string, x: Record<string, unknown> = {}) => ({
  id,
  numero: `CT-SINT-${id}`,
  situacao: 'ativo' as const,
  inicio: '2026-01-01',
  fim,
  gestor: 'sint.gercompras',
  fiscal: 'SINT.CONTRATOS',
  ...x,
});

const nucleo = {
  rede: 'sintetica',
  lerSomente: async (_c: unknown, fn: (l: unknown) => unknown) => fn({}),
  gravarSgh: async (_c: unknown, fn: (e: unknown) => unknown) => fn({}),
  encerrar: async () => undefined,
} as never;

describe('alerta de vencimento dos contratos (M55.3)', () => {
  it('avisa só quem cruzou 90, 60 ou 30 dias ou venceu; a chave leva o fim vigente e a faixa', () => {
    const xs = alertasDoDia(
      [
        contrato(1, '2027-06-30'), // vigente
        contrato(2, '2027-01-20'), // 84 dias
        contrato(3, '2026-12-20'), // 53 dias
        contrato(4, '2026-11-10'), // 13 dias
        contrato(5, '2026-10-27'), // vencido ontem
        contrato(6, '2027-12-31', { inicio: '2026-11-15' }), // a iniciar
      ],
      '2026-10-28',
    );
    expect(xs.map((x) => [x.contrato, x.faixa, x.chave])).toEqual([
      [2, 'vence-90', '2:2027-01-20:vence-90'],
      [3, 'vence-60', '3:2026-12-20:vence-60'],
      [4, 'vence-30', '4:2026-11-10:vence-30'],
      [5, 'vencido', '5:2026-10-27:vencido'],
    ]);
    expect(xs[0]!.destinatarios).toEqual(['SINT.GERCOMPRAS', 'SINT.CONTRATOS']);
    expect(xs[3]!.titulo).toBe('Contrato CT-SINT-5 vencido em 27/10/2026');
    expect(xs[2]!.titulo).toBe('Contrato CT-SINT-4: vence em até 30 dias (10/11/2026)');
    expect(xs.map((x) => x.titulo).join('\n')).not.toMatch(/spdata|legado|SGH_/i);
  });

  it('o gestor e o fiscal iguais (em maiúsculas) recebem um aviso só', () => {
    const [x] = alertasDoDia([contrato(9, '2026-11-01', { fiscal: 'SINT.GERCOMPRAS' })], '2026-10-28');
    expect(x!.destinatarios).toEqual(['SINT.GERCOMPRAS']);
  });

  it('grava os avisos com a trilha uma vez por faixa; o segundo ciclo do dia não repete', async () => {
    estado.ligada = true;
    estado.contratos = [contrato(2, '2027-01-20'), contrato(1, '2027-06-30')];
    estado.avisos.clear();
    estado.trilhas.length = 0;
    expect(await cicloContratos(nucleo, 'pc')).toEqual({ ligada: true, emAlerta: 1, avisos: 2 });
    expect(estado.trilhas).toHaveLength(1);
    expect(estado.trilhas[0]).toMatchObject({
      evento: 'suprimentos.contrato.alertaVencimento',
      tabelaAlvo: 'SGH_SUP_CONTRATO',
      idAlvo: '2',
      chaveNaturalAlvo: '2:2027-01-20:vence-90',
    });
    expect(await cicloContratos(nucleo, 'pc')).toEqual({ ligada: true, emAlerta: 1, avisos: 0 });
    expect(estado.trilhas).toHaveLength(1);
    // A renovação muda o fim vigente: o alerta reabre na nova faixa.
    estado.contratos = [contrato(2, '2026-12-01')];
    expect((await cicloContratos(nucleo, 'pc')).avisos).toBe(2);
    expect(TIPO_AVISO_CONTRATO).toBe('contrato-vencimento');
  });

  it('com a funcionalidade desligada não lê contratos nem avisa', async () => {
    estado.ligada = false;
    estado.leuContratos = 0;
    estado.contratos = [contrato(4, '2026-11-10')];
    expect(await cicloContratos(nucleo, 'pc')).toEqual({ ligada: false, emAlerta: 0, avisos: 0 });
    expect(estado.leuContratos).toBe(0);
  });

  it('o serviço: o ciclo por estabelecimento e a chave fora de dev/ci', async () => {
    estado.ligada = true;
    estado.contratos = [contrato(7, '2026-11-20')];
    const s = new ContratosVencimentoService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(nucleo);
    expect(await s.ciclo()).toEqual([{ estabelecimento: 'pc', emAlerta: 1, avisos: 2 }]);
    expect(alertaContratosLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(alertaContratosLigado({ AMBIENTE: 'producao', CONTRATOS_ALERTA_DIARIO: 'desligado' })).toBe(false);
    expect(alertaContratosLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(alertaContratosLigado({ AMBIENTE: 'ci', CONTRATOS_ALERTA_DIARIO: 'ligado' })).toBe(true);
    await s.onApplicationShutdown();
  });
});
