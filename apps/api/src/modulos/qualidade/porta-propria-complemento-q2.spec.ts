// Unidade do complemento Q2 da porta própria da gestão da qualidade (qualidade-q2): o mapeamento das revisões de
// documento, das ciências, das comissões, do histórico da análise crítica e da contagem do painel para o contrato, os
// filtros (estabelecimento, situação, busca, página) e a ordem dos parâmetros.
import type { Executor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoQualidade } from './apoio-propria.js';
import {
  LeiturasGestaoComplementoQ2,
  METODOS_COMPLEMENTO_Q2,
  PONTUACAO_RISCO_CRITICO,
  TETO_HISTORICO_ANALISES,
} from './porta-propria-complemento-q2.js';
import { METODOS_PORTA_GESTAO } from './porta-gestao.js';

const DOC = {
  id: 41,
  versao: 2,
  codigo: 'POP-SINT-1',
  numero_versao: '3',
  tipo: 'procedimento',
  titulo: 'Higiene das mãos',
  area: 'Qualidade',
  motivo_alteracao: 'Revisão anual',
  elaborado_por: 'ana',
  revisado_por: null,
  aprovado_por: 'bia',
  publicado_em: new Date(2026, 9, 1, 8, 0, 0),
  vigencia_ate: new Date(2027, 9, 1),
  exige_ciencia: 1,
  hash: 'AB'.repeat(32),
  situacao: 'cancelada',
  motivo_retirada: 'Substituído por protocolo',
  encerrado_em: new Date(2026, 10, 2, 9, 30, 0),
  conteudo: 'texto',
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
  return { leituras: new LeiturasGestaoComplementoQ2(nucleo), chamadas };
}
const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;

describe('complemento Q2 da porta própria da gestão (unidade)', () => {
  it('os métodos cobertos são da porta da gestão', () => {
    for (const m of METODOS_COMPLEMENTO_Q2) expect(METODOS_PORTA_GESTAO.has(m)).toBe(true);
  });

  it('a revisão pelo id traz o conteúdo e mapeia situação, logins, hash e retirada', async () => {
    const { leituras, chamadas } = falso({ documento_qualidade_versao: [DOC] });
    const d = await leituras.documento(C, 41);
    expect(chamadas[0]!.p).toEqual([3, 41]);
    expect(chamadas[0]!.sql).toContain(', v.conteudo');
    expect(d).toMatchObject({
      id: 41,
      revisao: 3,
      situacao: 'retirado',
      elaboradoPor: 'ANA',
      revisadoPor: null,
      aprovadoPor: 'BIA',
      publicadoEm: '2026-10-01T08:00:00',
      vigenciaAte: '2027-10-01',
      exigeCiencia: true,
      hash: 'ab'.repeat(32),
      motivoRetirada: 'Substituído por protocolo',
      encerradoEm: '2026-11-02T09:30:00',
      conteudo: 'texto',
    });
  });

  it('a revisão inexistente é nula; a lista não traz o conteúdo', async () => {
    expect(await falso({}).leituras.documento(C, 9)).toBeNull();
    const { leituras, chamadas } = falso({ documento_qualidade_versao: [DOC] });
    const xs = await leituras.documentosDoCodigo(C, 'POP-SINT-1');
    expect(xs[0]!.conteudo).toBeNull();
    expect(chamadas[0]!.sql).not.toContain(', v.conteudo');
    expect(chamadas[0]!.p).toEqual([3, 'POP-SINT-1']);
  });

  it('a lista filtra pela situação do banco, tipo e busca em maiúsculas, com a página e o total', async () => {
    const { leituras, chamadas } = falso({ 'COUNT(*) AS total': [{ total: 7 }], 'LIMIT 5 OFFSET 5': [DOC] });
    const r = await leituras.documentos(C, { situacao: 'obsoleto', tipo: 'pop', busca: 'mãos', pagina: 2, porPagina: 5 });
    expect(r.total).toBe(7);
    expect(r.itens).toHaveLength(1);
    expect(chamadas[1]!.p).toEqual([3, 'obsoleta', 'pop', 'MÃOS', 'MÃOS']);
  });

  it('ciências: total e a da sessão por revisão; sem revisão não lê o banco', async () => {
    const vazio = falso({});
    expect((await vazio.leituras.ciencias(C, [], 'ana')).size).toBe(0);
    expect(vazio.chamadas).toHaveLength(0);
    const { leituras, chamadas } = falso({ documento_qualidade_ciencia: [{ documento: 41, total: 2, sessao: 1 }] });
    const m = await leituras.ciencias(C, [41, 41, 42], 'ana');
    expect(m.get(41)).toEqual({ total: 2, sessao: true });
    expect(m.has(42)).toBe(false);
    expect(chamadas[0]!.p).toEqual(['ANA', 3, 41, 42]);
  });

  it('cientes pelo login e instante do registro', async () => {
    const { leituras } = falso({
      documento_qualidade_ciencia: [{ usuario: 'ANA', ciencia_em: new Date(2026, 9, 5, 10, 0, 0) }],
    });
    expect(await leituras.cientes(C, 41)).toEqual([{ usuario: 'ANA', cienteEm: '2026-10-05T10:00:00' }]);
  });

  it('comissões com a composição vigente em JSON e as últimas reuniões', async () => {
    const { leituras, chamadas } = falso({
      'FROM comissao_hospitalar': [
        {
          id: 8,
          versao: 1,
          tipo: 'ccih',
          nome: 'CCIH SINT',
          periodicidade_reuniao: 'mensal',
          situacao: 'ativa',
          criado_em: new Date(2026, 0, 2, 8, 0, 0),
          ultima_ordinaria: new Date(2026, 9, 1, 14, 0, 0),
          ultima_reuniao: null,
        },
      ],
      'FROM comissao_membro': [
        { comissao: 8, nome: 'Ana Sint', papel: 'vice_presidente', login: 'ana' },
        { comissao: 8, nome: 'Bia Sint', papel: 'membro', login: null },
      ],
    });
    const [c] = await leituras.comissoes(C);
    expect(c).toMatchObject({ id: 8, tipo: 'ccih', ativa: true, ultimaOrdinaria: '2026-10-01T14:00:00', ultimaReuniao: null });
    expect(JSON.parse(c!.membros)).toEqual([
      { nome: 'Ana Sint', funcao: 'vice presidente', login: 'ANA' },
      { nome: 'Bia Sint', funcao: 'membro', login: null },
    ]);
    expect(chamadas[1]!.p).toEqual([8]);
    expect(await falso({}).leituras.comissao(C, 99)).toBeNull();
  });

  it('histórico da análise crítica do indicador pela competência, com teto', async () => {
    const { leituras, chamadas } = falso({
      analise_critica_indicador: [
        {
          id: 5,
          versao: 1,
          indicador: 'IND-1',
          competencia: new Date(2026, 8, 1),
          numerador: '3.0000',
          denominador: '10.0000',
          valor: '30.0000',
          valor_meta: null,
          situacao_meta: 'fora_da_meta',
          analise: 'Queda',
          causa: null,
          acao_proposta: 'Treinar',
          responsavel: 'bia',
          prazo: new Date(2026, 11, 1),
          registrada_por: 'ana',
          analisado_em: new Date(2026, 9, 3, 9, 0, 0),
          atualizada_por: null,
          alterado_em: null,
        },
      ],
    });
    const [a] = await leituras.historicoAnalises(C, 'IND-1');
    expect(a).toMatchObject({
      competencia: '2026-09',
      numerador: 3,
      denominador: 10,
      valor: 30,
      meta: null,
      situacaoMeta: 'fora-da-meta',
      responsavel: 'BIA',
      prazo: '2026-12-01',
      registradaPor: 'ANA',
      atualizadaEm: null,
    });
    expect(chamadas[0]!.sql).toContain(`LIMIT ${TETO_HISTORICO_ANALISES}`);
    expect(chamadas[0]!.p).toEqual([3, 'IND-1']);
  });

  it('a contagem do painel lê cada parte no estabelecimento com o dia civil e o login', async () => {
    const { leituras, chamadas } = falso({
      'AS pendentes': [{ vigentes: 4, vencidas: 1, pendentes: 2 }],
      'AS criticos': [{ criticos: 3 }],
      nao_conformidade_qualidade: [{ abertas: 5, vencidas: '2' }],
      manifestacao_ouvidoria: [{ abertas: 6, vencidas: 0 }],
    });
    expect(await leituras.contagem(C, '2026-11-10T08:00:00', 'ana')).toEqual({
      documentosVigentes: 4,
      documentosRevisaoVencida: 1,
      cienciasPendentesSessao: 2,
      riscosCriticos: 3,
      naoConformidadesAbertas: 5,
      naoConformidadesVencidas: 2,
      manifestacoesAbertas: 6,
      manifestacoesVencidas: 0,
    });
    expect(chamadas[0]!.p).toEqual(['2026-11-10', 3, 'ANA', 3]);
    expect(chamadas[1]!.p).toEqual([3, PONTUACAO_RISCO_CRITICO]);
    expect(chamadas[2]!.p).toEqual(['2026-11-10', 3]);
  });

  it('sem estabelecimento na sessão recusa antes de ler', async () => {
    const { leituras, chamadas } = falso({});
    await expect(leituras.comissoes({ ...(C as object), estabelecimento: null } as never)).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });
});
