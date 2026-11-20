// internacao.fecharCenso no worker: só com a chave ligada; fecha o último dia do censo uma vez (o segundo desiste);
// só transação SGH_ (o escritor do núcleo recusa outra tabela); dev/ci só com CENSO_FECHAMENTO=ligado.
import type { Escritor, Leitor } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import {
  CensoFechamentoService,
  fechamentoLigado,
  fecharCensoDoEstabelecimento,
  JANELA_FECHAMENTO_DIAS,
  type NucleoCenso,
} from './censo-fechamento.service.js';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SENT = D('1899-12-30');

function nucleo(opcoes: { ligada: boolean; fechados?: string[]; jaNaGravacao?: boolean }) {
  const escritas: string[] = [];
  const fechados = [...(opcoes.fechados ?? [])];
  const leitor: Leitor = {
    hospital: 'pc',
    consultar: async (sql) => {
      if (sql.includes('FROM SGH_CFG_LIBERACAO'))
        return (
          opcoes.ligada
            ? [
                {
                  ID: 1,
                  TIPO: 'recurso',
                  OPERACAO: 'internacao.censo.fechamento',
                  ESCOPO: 'hospital',
                  VALOR: '*',
                  LIGADA: true,
                },
              ]
            : []
        ) as never;
      if (sql.includes('FROM SGH_CFG_PREREQUISITO'))
        return [
          {
            RECURSO: 'internacao.censo.fechamento',
            TIPO: 'aprovacao',
            SITUACAO: 'cumprido',
            DESCRICAO: 'x',
            RESPONSAVEL: 'x',
          },
        ] as never;
      if (sql.includes('FROM SGH_CFG_PARAMETRO')) return [] as never;
      if (sql.includes('DISTINCT DATA_CENSO')) return fechados.map((d) => ({ DATA_CENSO: D(d) })) as never;
      if (sql.includes('FROM RICADINT'))
        return [
          {
            REG: 1,
            PRONT: 1,
            ENTRADA: D('2026-10-18'),
            HORAENT: '1000',
            ALTA: SENT,
            HORASAI: null,
            MOTIVO: null,
            CARINT: '1',
            CLINICA: 'M',
            PERMANEN: null,
            BLOCO: '1',
            ACOMOD: 'ENF',
            LEITO: '01',
          },
        ] as never;
      if (sql.includes('FROM RICTRLOC'))
        return [
          {
            REG: 1,
            COD: 1,
            BLOCO: '1',
            ACOMOD: 'ENF',
            LEITO: '01',
            ENTRADA: D('2026-10-18'),
            HORAENT: '1000',
            SAIDA: SENT,
            HORASAI: null,
            ID_TBTIPOACOMOD: 1,
          },
        ] as never;
      if (sql.includes('FROM RIACOMOD'))
        return [{ BLOCO: '1', ACOMOD: 'ENF', NOME: 'Enf', TIPO: 1, LEITOS: 2, ATIVOS: 2 }] as never;
      if (sql.includes('FROM TBTIPOACOMOD')) return [{ ID: 1, NOME: 'Enfermaria' }] as never;
      return [] as never;
    },
    lerBlob: async () => Buffer.alloc(0),
  };
  let n = 0;
  // Linhas gravadas por dia (a prova pós-escrita relê o dia: contagem e soma dos internados).
  const porDia = new Map<string, number[]>();
  const diaDe = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const e: Escritor = {
    ...leitor,
    consultar: async (sql, p) => {
      if (sql.includes('WITH LOCK')) return (opcoes.jaNaGravacao ? [{ ID: 1 }] : []) as never;
      if (sql.includes('NEXT VALUE')) return [{ ID: ++n }] as never;
      if (sql.includes('COUNT(*) N, COALESCE')) {
        const xs = porDia.get(diaDe(p?.[1])) ?? [];
        return [{ N: xs.length, S: xs.reduce((a, b) => a + b, 0) }] as never;
      }
      return leitor.consultar(sql, p);
    },
    executar: async (sql, p) => {
      escritas.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('INTO SGH_INT_CENSO_DIA')) {
        const d = diaDe(p?.[2]);
        porDia.set(d, [...(porDia.get(d) ?? []), Number(p?.[7])]);
      }
      return 1;
    },
    executarRetornando: async (sql) => {
      escritas.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return { ID: 'x' };
    },
  };
  const nc: NucleoCenso = {
    rede: 'r',
    lerSomente: (_c, fn) => fn(leitor),
    gravarSgh: (_c, fn) => fn(e),
    encerrar: async () => undefined,
  };
  return { nc, escritas };
}

// 2026-10-20 13:00 UTC = 10:00 em São Paulo: o último dia fechado (meia-noite) é 2026-10-19.
const AGORA = Date.UTC(2026, 9, 20, 13, 0);
/** A janela conferida em cada ciclo: os 7 dias até o último fechado. */
const SEMANA = [
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
];

describe('fechamento do censo no worker', () => {
  it('chave desligada: nada é gravado', async () => {
    const { nc, escritas } = nucleo({ ligada: false });
    expect(await fecharCensoDoEstabelecimento(nc, 'pc', AGORA)).toEqual({ situacao: 'desligado' });
    expect(escritas).toEqual([]);
  });

  it('ligada: fecha o dia anterior uma vez, só em SGH_, com a trilha', async () => {
    const { nc, escritas } = nucleo({ ligada: true, fechados: SEMANA.slice(0, 6) });
    const r = await fecharCensoDoEstabelecimento(nc, 'pc', AGORA);
    expect(r).toEqual({
      situacao: 'fechado',
      data: '2026-10-19',
      linhas: 1,
      internados: 1,
      dias: ['2026-10-19'],
    });
    expect(escritas.every((s) => /SGH_/.test(s))).toBe(true);
    expect(escritas.some((s) => s.includes('SGH_INT_CENSO_DIA'))).toBe(true);
    expect(escritas.some((s) => s.includes('SGH_TRILHA'))).toBe(true);
  });

  it('já fechado (antes ou por outro processo durante a gravação): desiste', async () => {
    expect(
      await fecharCensoDoEstabelecimento(nucleo({ ligada: true, fechados: SEMANA }).nc, 'pc', AGORA),
    ).toEqual({
      situacao: 'ja-fechado',
    });
    expect(
      await fecharCensoDoEstabelecimento(nucleo({ ligada: true, jaNaGravacao: true }).nc, 'pc', AGORA),
    ).toEqual({
      situacao: 'ja-fechado',
    });
  });

  it('dia perdido (worker parado na hora de fechar): o ciclo seguinte fecha os dias da janela sem retrato, em ordem', async () => {
    const { nc, escritas } = nucleo({
      ligada: true,
      fechados: SEMANA.filter((d) => !['2026-10-15', '2026-10-18', '2026-10-19'].includes(d)),
    });
    const r = await fecharCensoDoEstabelecimento(nc, 'pc', AGORA);
    expect(r).toMatchObject({ situacao: 'fechado', data: '2026-10-19', internados: 1 });
    expect(r.situacao === 'fechado' && r.dias).toEqual(['2026-10-15', '2026-10-18', '2026-10-19']);
    // Um retrato e um evento da trilha por dia.
    expect(escritas.filter((s) => s.includes('SGH_TRILHA'))).toHaveLength(3);
    // Fora da janela de 7 dias, nada.
    expect(JANELA_FECHAMENTO_DIAS).toBe(7);
  });

  it('ligado fora de dev/ci; em dev/ci só pedido; o ciclo percorre os estabelecimentos', async () => {
    expect(fechamentoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(fechamentoLigado({ AMBIENTE: 'producao', CENSO_FECHAMENTO: 'desligado' })).toBe(false);
    expect(fechamentoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(fechamentoLigado({ AMBIENTE: 'ci', CENSO_FECHAMENTO: 'ligado' })).toBe(true);
    const s = new CensoFechamentoService();
    expect(await s.ciclo()).toEqual([]);
    s.usar(nucleo({ ligada: false }).nc);
    const antes = process.env['ESTABELECIMENTOS'];
    process.env['ESTABELECIMENTOS'] = 'pc';
    try {
      expect(await s.ciclo(AGORA)).toEqual([{ situacao: 'desligado' }]);
    } finally {
      if (antes === undefined) delete process.env['ESTABELECIMENTOS'];
      else process.env['ESTABELECIMENTOS'] = antes;
    }
    await s.onApplicationShutdown();
  });
});
