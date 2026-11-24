// Unidade do complemento D da porta própria da gestão da qualidade (qualidade-d): o mapeamento da pesquisa de
// satisfação, das versões anteriores e dos protocolos gerenciados para o contrato, os filtros (estabelecimento,
// período) e o teto que marca `cortada`.
import { ErroOperacao, type Executor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoQualidade } from './apoio-propria.js';
import {
  LeiturasGestaoComplementoD,
  METODOS_COMPLEMENTO_D,
  TETO_PESQUISAS,
} from './porta-propria-complemento-d.js';
import { METODOS_PORTA_GESTAO } from './porta-gestao.js';

const PESQ = {
  id: 11,
  paciente_id: 5,
  nota_recomendacao: 9,
  comentario: null,
  respondida_em: new Date(2026, 9, 3, 18, 0, 0),
  manifestacao_ouvidoria_id: null,
  natureza: 'exame',
  nome_agenda: 'AGENDA SINT',
  data_referencia: new Date(2026, 9, 2),
};

function falso(respostas: Record<string, unknown[]>) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const achar = (sql: string) => {
    const k = Object.keys(respostas).find((x) => sql.includes(x));
    return k ? respostas[k]! : [];
  };
  const leitor = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(achar(sql));
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(achar(sql)[0] ?? null);
    },
  };
  const nucleo = {
    lerSomente: (_c: unknown, fn: (l: typeof leitor) => Promise<unknown>) => fn(leitor),
    criarExecutor: () => ({}) as Executor,
  } as unknown as NucleoQualidade;
  return { leituras: new LeiturasGestaoComplementoD(nucleo), chamadas };
}
const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;

describe('complemento D da porta própria da gestão (unidade)', () => {
  it('os métodos cobertos são da porta da gestão', () => {
    for (const m of METODOS_COMPLEMENTO_D) expect(METODOS_PORTA_GESTAO.has(m)).toBe(true);
  });

  it('as pesquisas do período leem no estabelecimento pelo dia do atendimento e mapeiam para o contrato', async () => {
    const { leituras, chamadas } = falso({ resposta_pesquisa_satisfacao: [PESQ] });
    const r = await leituras.pesquisas(C, '2026-10-01', '2026-10-31');
    expect(chamadas[0]?.p).toEqual([3, '2026-10-01', '2026-10-31']);
    expect(chamadas[0]?.sql).toMatch(/h\.data_referencia >= \? AND h\.data_referencia <= \?/);
    expect(chamadas[0]?.sql).toMatch(/ORDER BY h\.data_referencia, r\.id/);
    expect(r).toEqual({
      itens: [
        {
          id: 11,
          paciente: 5,
          tipo: 'exame',
          agenda: 'AGENDA SINT',
          dataAtendimento: '2026-10-02',
          nota: 9,
          comentario: null,
          respondidaEm: '2026-10-03T18:00:00',
          manifestacao: null,
        },
      ],
      cortada: false,
    });
  });

  it('passar do teto marca cortada e devolve só o teto', async () => {
    const muitas = Array.from({ length: TETO_PESQUISAS + 1 }, (_, i) => ({ ...PESQ, id: i + 1 }));
    const { leituras } = falso({ resposta_pesquisa_satisfacao: muitas });
    const r = await leituras.pesquisas(C, '2026-10-01', '2026-10-31');
    expect(r.cortada).toBe(true);
    expect(r.itens).toHaveLength(TETO_PESQUISAS);
  });

  it('a pesquisa pelo id devolve o recorte do contrato; inexistente é nulo', async () => {
    const { leituras, chamadas } = falso({ resposta_pesquisa_satisfacao: [{ ...PESQ, comentario: 'Bom' }] });
    expect(await leituras.pesquisa(C, 11)).toEqual({
      id: 11,
      paciente: 5,
      nota: 9,
      comentario: 'Bom',
      respondidaEm: '2026-10-03T18:00:00',
    });
    expect(chamadas[0]?.p).toEqual([3, 11]);
    expect(await falso({}).leituras.pesquisa(C, 99)).toBeNull();
  });

  it('as versões vêm da trilha (versaoAnterior), da mais nova para a mais antiga', async () => {
    const va = { versao: 2, acao: 'correcao', motivo: 'Erro de digitação', dados: { titulo: 'A' } };
    const { leituras, chamadas } = falso({
      trilha_auditoria: [{ ocorrido_em: new Date(2026, 9, 5, 9, 0, 0), login: 'ANA', va: JSON.stringify(va) }],
    });
    expect(await leituras.versoes(C, 'nao_conformidade_qualidade', 8)).toEqual([
      {
        versao: 2,
        acao: 'correcao',
        motivo: 'Erro de digitação',
        alteradoPor: 'ANA',
        alteradoEm: '2026-10-05T09:00:00',
        dados: { titulo: 'A' },
      },
    ]);
    expect(chamadas[0]?.p).toEqual([3, 'nao_conformidade_qualidade', '8']);
    expect(chamadas[0]?.sql).toMatch(/ORDER BY t\.id DESC/);
  });

  it('os protocolos gerenciados: versões e inclusões do período com critérios e eventos', async () => {
    const { leituras, chamadas } = falso({
      protocolo_gerenciado_versao: [
        {
          id: 4,
          tipo: 'sepse',
          nome: 'Sepse SINT',
          numero_versao: 2,
          motivo: 'Revisão',
          dados: '{"criterios":[]}',
          vigencia_inicio: new Date(2026, 8, 1, 8, 0, 0),
          autor: 'ANA',
        },
      ],
      'FROM inclusao_protocolo_paciente': [
        {
          id: 9,
          atendimento_id: 70,
          paciente_id: 5,
          protocolo_gerenciado_id: 1,
          forma_inclusao: 'alerta_automatico',
          horario_zero_em: new Date(2026, 9, 2, 10, 0, 0),
          criado_em: new Date(2026, 9, 2, 10, 5, 0),
          tipo: 'sepse',
          incluido_por: 'ENF',
        },
      ],
      inclusao_protocolo_criterio: [{ inclusao_protocolo_paciente_id: 9, identificador: 'febre' }],
      inclusao_protocolo_registro: [
        {
          id: 30,
          inclusao_protocolo_paciente_id: 9,
          tipo: 'meta',
          codigo: 'lactato',
          situacao: 'cumprida',
          ocorrido_em: new Date(2026, 9, 2, 10, 30, 0),
          prazo_em: null,
          motivo: null,
          criado_em: new Date(2026, 9, 2, 10, 31, 0),
          login: 'ENF',
        },
      ],
    });
    const r = await leituras.protocolosGerenciados(C, '2026-10-01T00:00:00', '2026-11-01T00:00:00');
    expect(r.versoes[0]).toMatchObject({ id: 4, versao: 2, nome: 'Sepse SINT', notas: 'Revisão', autor: 'ANA' });
    expect(r.versoes[0]?.impressao).toMatch(/^[0-9a-f]{64}$/);
    const inclusao = chamadas.find((x) => x.sql.includes('FROM inclusao_protocolo_paciente'));
    expect(inclusao?.p).toEqual([3, '2026-10-01 00:00:00', '2026-11-01 00:00:00']);
    expect(r.protocolos).toEqual([
      {
        id: 9,
        cabecalho: '70',
        reg: 70,
        paciente: 5,
        tipo: r.versoes[0]?.tipo,
        gerenciado: 1,
        origem: 'sugerido',
        sugeridoPor: null,
        criterios: ['febre'],
        chegadaEm: '2026-10-02T10:00:00',
        incluidoEm: '2026-10-02T10:05:00',
        incluidoPor: 'ENF',
        eventos: [
          {
            id: 30,
            tipo: 'meta',
            codigo: 'lactato',
            situacao: 'cumprida',
            quando: '2026-10-02T10:30:00',
            prazoEm: null,
            motivo: null,
            por: 'ENF',
            em: '2026-10-02T10:31:00',
          },
        ],
      },
    ]);
  });

  it('sem inclusões no período, não consulta critérios nem eventos', async () => {
    const { leituras, chamadas } = falso({});
    expect(await leituras.protocolosGerenciados(C, '2026-10-01T00:00:00', '2026-11-01T00:00:00')).toEqual({
      versoes: [],
      protocolos: [],
    });
    expect(chamadas).toHaveLength(2);
  });

  it('sem estabelecimento na sessão, a leitura recusa', async () => {
    const { leituras } = falso({});
    await expect(
      leituras.pesquisas({ ...(C as object), estabelecimento: null } as never, '2026-10-01', '2026-10-31'),
    ).rejects.toThrow(ErroOperacao);
  });
});
