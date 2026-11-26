// Unidade da família "pareceres" da porta própria dos documentos com um dublê do núcleo e do executor (sem banco):
// vocabulário banco ↔ neutro, filtros do estabelecimento, erros de domínio iguais aos da porta de memória
// (ErroProntuario, mesmo código e status), versão (problema e sumário), profissional da sessão exigido e nenhuma
// exclusão física.
import type { Executor, Leitor, Operacao, ResultadoOperacao, TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  comoJson,
  dia,
  DocumentosPropriaPareceres,
  JUSTIFICATIVA_DESCARTE,
  situacaoProblemaGravada,
  situacaoProblemaLida,
  situacaoSumarioLida,
  situacaoSupervisaoLida,
} from './documentos-propria-pareceres.js';
import { ErroProntuario } from './tipos-pep.js';

type Linha = Record<string, unknown>;
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };
const C = {
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 'cor-1',
  rede: 'r',
  hospital: 'aa',
};
const G = { ...C, usuario: 3, usuarioLogin: 'medico', traceId: 't-1' };
const HASH = 'b'.repeat(64);

type Resposta = (sql: string, p: readonly unknown[]) => Linha[] | undefined;

function duble(o: { ler?: Resposta; travar?: Resposta; sessao?: boolean } = {}) {
  const sqls: { sql: string; params: readonly unknown[] }[] = [];
  const escritas: { op: string; tabela: string; id?: number; valores: Linha }[] = [];
  const trilhas: unknown[] = [];
  let proximo = 900;
  const consultar = async (sql: string, params: readonly unknown[] = []) => {
    sqls.push({ sql, params });
    if (/FROM estabelecimento/.test(sql)) return [EST];
    if (/FROM usuario u\s+JOIN usuario_vinculo_profissional/.test(sql))
      return o.sessao === false ? [] : [{ usuario: 3, profissional: 40 }];
    if (/FROM inscricao_conselho\s+WHERE profissional_id/.test(sql)) return [{ id: 61 }];
    if (/FROM tipo_documento_clinico/.test(sql)) return [{ id: 5 }];
    if (/FROM situacao_documento_prontuario/.test(sql)) return [{ id: 2 }];
    return o.ler?.(sql, params) ?? [];
  };
  const leitor = {
    cliente: 'teste',
    consultar,
    uma: async (sql: string, params: readonly unknown[] = []) => (await consultar(sql, params))[0] ?? null,
  };
  const tx = {
    ...leitor,
    consultarParaAtualizar: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      return o.travar?.(sql, params) ?? [];
    },
    incluir: async (tabela: string, valores: Linha) => {
      escritas.push({ op: 'incluir', tabela, valores });
      return proximo++;
    },
    alterar: async (tabela: string, id: number, _v: number, valores: Linha) => {
      escritas.push({ op: 'alterar', tabela, id, valores });
      return 2;
    },
    excluir: async () => {
      throw new Error('exclusão física proibida');
    },
  } as unknown as TxOperacao;
  const executor = {
    executar: async <E, S extends ResultadoOperacao>(
      op: Operacao<E, S>,
      _c: string,
      e: unknown,
      ctx: unknown,
    ) => {
      const resultado = await op.gravar(tx, e as E, ctx as never);
      trilhas.push({
        nome: op.nome,
        alvo: op.alvo(e as E, resultado),
        extras: op.trilha?.(e as E, resultado, ctx as never),
      });
      return { resultado, repetida: false, eventos: [], trilha: 1 };
    },
  } as unknown as Executor;
  const nucleo = {
    lerSomente: async <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(leitor as unknown as Leitor),
    criarExecutor: () => executor,
  };
  return { porta: new DocumentosPropriaPareceres(nucleo, 'cliente-config'), sqls, escritas, trilhas };
}

const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroProntuario);
    return { codigo: (e as ErroProntuario).codigo, status: (e as ErroProntuario).status };
  }
  throw new Error('esperava recusa');
};

describe('vocabulário banco ↔ neutro', () => {
  it('problema, sumário, supervisão, data e JSON', () => {
    expect(['ativo', 'controlado', 'resolvido', 'inativo', 'refutado'].map(situacaoProblemaLida)).toEqual([
      'ativo',
      'ativo',
      'resolvido',
      'descartado',
      'descartado',
    ]);
    expect(situacaoProblemaGravada('descartado')).toBe('refutado');
    expect(
      ['rascunho', 'cancelado', 'finalizado', 'assinado', 'retificado'].map(situacaoSumarioLida),
    ).toEqual(['rascunho', 'rascunho', 'finalizado', 'finalizado', 'finalizado']);
    expect(['pendente', 'coassinado', 'recusado', 'ajuste_solicitado'].map(situacaoSupervisaoLida)).toEqual([
      'pendente',
      'coassinado',
      'recusado',
      'recusado',
    ]);
    expect(dia(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20');
    expect(dia(null)).toBeNull();
    expect(comoJson('{"a":1}')).toBe('{"a":1}');
    expect(JSON.parse(comoJson('texto livre'))).toBe('texto livre');
  });
});

describe('leituras', () => {
  it('historicoPareceres filtra estabelecimento e, se pedido, o paciente', async () => {
    const d = duble({ ler: () => [{ n: 4 }] });
    expect(await d.porta.historicoPareceres(C, 100)).toEqual({
      pedidos: 4,
      respostas: 4,
      encaminhamentos: 4,
    });
    const conta = d.sqls.filter((s) => /COUNT/.test(s.sql));
    expect(conta).toHaveLength(3);
    for (const s of conta) expect(s.params).toEqual([7, 100]);
    const t = duble({ ler: () => [{ n: 1 }] });
    await t.porta.historicoPareceres(C, null);
    for (const s of t.sqls.filter((x) => /COUNT/.test(x.sql))) {
      expect(s.params).toEqual([7]);
      expect(s.sql).not.toMatch(/paciente_id = \?/);
    }
  });

  it('especialidadesDoCbo sem ids válidos não lê; com ids, pela ocupação da inscrição', async () => {
    const d = duble({ ler: (sql) => (/DISTINCT em.id/.test(sql) ? [{ id: 2 }, { id: 9 }] : undefined) });
    expect(await d.porta.especialidadesDoCbo(C, [0, -1])).toEqual([]);
    expect(d.sqls).toHaveLength(0);
    expect(await d.porta.especialidadesDoCbo(C, [61, 61, 62])).toEqual([2, 9]);
    expect(d.sqls.at(-1)?.params).toEqual([61, 62]);
  });

  it('problemas: uma linha por versão, dados da versão, situação neutra e data no fuso', async () => {
    const d = duble({
      ler: (sql) =>
        /FROM problema_paciente_versao v/.test(sql)
          ? [
              {
                id: 31,
                anterior: null,
                dados: JSON.stringify({
                  descricao: 'HAS',
                  cid: 'I10',
                  tipo: 'diagnostico',
                  inicio: '2026-01-01',
                  fim: null,
                }),
                situacao: 'ativo',
                ocorrido_em: new Date('2026-11-20T15:00:00Z'),
                login: 'medico',
                descricao: 'x',
                tipo: 'problema',
              },
              {
                id: 32,
                anterior: 31,
                dados: null,
                situacao: 'refutado',
                ocorrido_em: new Date('2026-11-21T15:00:00Z'),
                login: null,
                descricao: 'Da tabela',
                tipo: 'achado',
                inicio_em: new Date('2026-01-02T00:00:00Z'),
                resolvido_em: null,
              },
            ]
          : undefined,
    });
    const ps = await d.porta.problemas(C, 100);
    expect(ps[0]).toEqual({
      id: 31,
      anterior: null,
      descricao: 'HAS',
      cid: 'I10',
      tipo: 'diagnostico',
      inicio: '2026-01-01',
      fim: null,
      situacao: 'ativo',
      usuario: 'medico',
      em: '2026-11-20T12:00:00',
    });
    expect(ps[1]).toMatchObject({
      id: 32,
      anterior: 31,
      descricao: 'Da tabela',
      tipo: 'problema',
      inicio: '2026-01-02',
      situacao: 'descartado',
      usuario: '',
    });
    expect(d.sqls.at(-1)?.params).toEqual([7, 100]);
    // O teto corta o histórico antigo, nunca a última versão de cada problema.
    expect(d.sqls.at(-1)?.sql).toMatch(/recencia <= 500 OR x\.ultima = 1/);
  });

  it('sumários em ordem de versão; coassinaturas pelo login do preceptor; óbito ignora o cancelado', async () => {
    const d = duble({
      ler: (sql) => {
        if (/FROM sumario_alta sa/.test(sql))
          return [
            {
              numero_versao: 1,
              situacao: 'rascunho',
              conteudo_rascunho: '{}',
              documento_prontuario_id: null,
              registrado_em: new Date('2026-11-20T15:00:00Z'),
              login: 'medico',
            },
          ];
        if (/FROM registro_assistencial_supervisao s/.test(sql))
          return [
            {
              id: 4,
              registro_assistencial_id: 8,
              paciente_id: 100,
              atendimento_id: 200,
              residente: 'res',
              situacao: 'pendente',
              em: null,
            },
          ];
        if (/FROM declaracao_obito/.test(sql)) return [];
        return undefined;
      },
    });
    expect(await d.porta.sumarios(C, 200)).toEqual([
      {
        versao: 1,
        situacao: 'rascunho',
        conteudo: '{}',
        documento: null,
        usuario: 'medico',
        em: '2026-11-20T12:00:00',
      },
    ]);
    expect(await d.porta.coassinaturas(C, 'prec')).toEqual([
      {
        id: 4,
        registro: 8,
        paciente: 100,
        atendimento: 200,
        residente: 'res',
        preceptor: 'prec',
        situacao: 'pendente',
        em: null,
      },
    ]);
    expect(d.sqls.at(-1)?.params).toEqual([7, 'prec', 7]);
    expect(await d.porta.obito(C, 100)).toBeNull();
    expect(d.sqls.at(-1)?.sql).toMatch(/situacao <> 'cancelada'/);
  });
});

describe('gravações', () => {
  it('sem profissional da sessão, nada é gravado (403)', async () => {
    const d = duble({ sessao: false });
    expect(await erro(d.porta.aceitarParecer(G, 1))).toEqual({ codigo: 'sem-profissional', status: 403 });
    expect(d.escritas).toHaveLength(0);
  });

  it('problema novo: linha e versão 1; mudança com versão velha: conflito-versao; descarte com justificativa', async () => {
    const d = duble({
      travar: (sql, p) =>
        /FROM problema_paciente_versao v/.test(sql)
          ? p[0] === 31
            ? [{ problema_paciente_id: 3, numero_versao: 1, versao: 1, ultima: 2 }]
            : [{ problema_paciente_id: 3, numero_versao: 2, versao: 2, ultima: 2 }]
          : [],
    });
    const base = {
      paciente: 100,
      atendimento: null,
      descricao: 'Dor',
      cid: null,
      idCid: null,
      tipo: 'problema' as const,
      inicio: '2026-11-01',
      fim: null,
    };
    expect(await d.porta.gravarProblema(G, { ...base, situacao: 'ativo', anterior: null })).toBe(901);
    expect(d.escritas.map((e) => [e.op, e.tabela])).toEqual([
      ['incluir', 'problema_paciente'],
      ['incluir', 'problema_paciente_versao'],
    ]);
    expect(d.escritas[1]!.valores).toMatchObject({
      problema_paciente_id: 900,
      numero_versao: 1,
      operacao: 'inclusao',
      usuario_id: 3,
      profissional_id: 40,
    });
    expect(await erro(d.porta.gravarProblema(G, { ...base, situacao: 'resolvido', anterior: 31 }))).toEqual({
      codigo: 'conflito-versao',
      status: 409,
    });
    d.escritas.length = 0;
    await d.porta.gravarProblema(G, { ...base, situacao: 'descartado', anterior: 32 });
    expect(d.escritas[0]).toMatchObject({ op: 'alterar', tabela: 'problema_paciente', id: 3 });
    expect(d.escritas[0]!.valores).toMatchObject({
      situacao: 'refutado',
      inativado_por_profissional_id: 40,
      justificativa_inativacao: JUSTIFICATIVA_DESCARTE,
    });
    expect(d.escritas[1]!.valores).toMatchObject({
      numero_versao: 3,
      operacao: 'alteracao',
      situacao: 'refutado',
    });
    expect(
      await erro(
        d.porta.gravarProblema(G, { ...base, situacao: 'resolvido', fim: '2026-10-01', anterior: 32 }),
      ),
    ).toEqual({ codigo: 'periodo-invalido', status: 422 });
  });

  it('sumário: versão já salva é conflito; versão nova vira rascunho com o resumo e a conta', async () => {
    const d = duble({
      ler: (sql) => (/FROM atendimento/.test(sql) ? [{ id: 200 }] : undefined),
      travar: (sql) => (/FROM sumario_alta/.test(sql) ? [{ id: 1, numero_versao: 1 }] : []),
    });
    const s = { paciente: 100, atendimento: 200, conteudo: '{"x":1}', hashConteudo: HASH };
    expect(await erro(d.porta.salvarRascunhoSumario(G, { ...s, versao: 1 }))).toEqual({
      codigo: 'conflito-versao',
      status: 409,
    });
    expect(await d.porta.salvarRascunhoSumario(G, { ...s, versao: 2 })).toBe(2);
    expect(d.escritas.at(-1)).toMatchObject({
      tabela: 'sumario_alta',
      valores: {
        numero_versao: 2,
        situacao: 'rascunho',
        hash_conteudo: HASH,
        registrado_usuario_id: 3,
        responsavel_profissional_id: 40,
      },
    });
    expect(await erro(d.porta.salvarRascunhoSumario(G, { ...s, versao: 3, hashConteudo: 'x' }))).toEqual({
      codigo: 'hash-invalido',
      status: 422,
    });
  });

  it('parecer: inexistente 404; aceite só do solicitado; cancelamento exige motivo e recusa o encerrado', async () => {
    const d = duble({
      travar: (sql, p) =>
        /FROM interconsulta/.test(sql)
          ? ((
              {
                1: [{ id: 1, versao: 1, paciente_id: 100, situacao: 'solicitado', visualizado_em: null }],
                2: [{ id: 2, versao: 3, paciente_id: 100, situacao: 'respondido' }],
              } as Record<number, Linha[]>
            )[Number(p[0])] ?? [])
          : [],
    });
    expect(await erro(d.porta.aceitarParecer(G, 9))).toEqual({ codigo: 'registro-inexistente', status: 404 });
    expect(await erro(d.porta.aceitarParecer(G, 2))).toEqual({ codigo: 'situacao-invalida', status: 409 });
    expect(await d.porta.aceitarParecer(G, 1)).toEqual({ paciente: 100 });
    expect(d.escritas.at(-1)).toMatchObject({
      op: 'alterar',
      tabela: 'interconsulta',
      id: 1,
      valores: { situacao: 'aceito', aceito_por_profissional_id: 40 },
    });
    expect(await erro(d.porta.cancelarParecer(G, 1, '  '))).toEqual({
      codigo: 'motivo-obrigatorio',
      status: 422,
    });
    expect(await erro(d.porta.cancelarParecer(G, 2, 'duplicado'))).toEqual({
      codigo: 'situacao-invalida',
      status: 409,
    });
    await d.porta.cancelarParecer(G, 1, 'duplicado');
    expect(d.escritas.at(-1)!.valores).toMatchObject({
      situacao: 'cancelado',
      motivo_cancelamento: 'duplicado',
      cancelado_por_profissional_id: 40,
    });
    expect(d.trilhas.at(-1)).toMatchObject({ alvo: { tabela: 'interconsulta', id: 1 } });
  });

  it('coassinatura: só o preceptor; encerrada recusa; recusa exige motivo; último coassinado finaliza o registro', async () => {
    const sup = (o: Linha = {}) => [
      {
        id: 4,
        versao: 1,
        situacao: 'pendente',
        preceptor_profissional_id: 40,
        registro: 8,
        versao_registro: 1,
        paciente_id: 100,
        situacao_registro: 'aguardando_coassinatura',
        ...o,
      },
    ];
    const comum = {
      ler: (sql: string) =>
        /COUNT\(\*\) AS n FROM registro_assistencial_supervisao/.test(sql) ? [{ n: 0 }] : undefined,
    };
    expect(
      await erro(
        duble({ ...comum, travar: () => sup({ preceptor_profissional_id: 41 }) }).porta.coassinarNoNovo(G, {
          id: 4,
          decisao: 'coassinado',
        }),
      ),
    ).toEqual({ codigo: 'sem-permissao', status: 403 });
    expect(
      await erro(
        duble({ ...comum, travar: () => sup({ situacao: 'coassinado' }) }).porta.coassinarNoNovo(G, {
          id: 4,
          decisao: 'coassinado',
        }),
      ),
    ).toEqual({ codigo: 'coassinatura-encerrada', status: 409 });
    expect(
      await erro(
        duble({ ...comum, travar: () => [] }).porta.coassinarNoNovo(G, { id: 4, decisao: 'coassinado' }),
      ),
    ).toEqual({ codigo: 'nao-encontrado', status: 404 });
    expect(
      await erro(
        duble({ ...comum, travar: () => sup() }).porta.coassinarNoNovo(G, { id: 4, decisao: 'recusado' }),
      ),
    ).toEqual({ codigo: 'motivo-obrigatorio', status: 422 });
    const d = duble({ ...comum, travar: () => sup() });
    expect(await d.porta.coassinarNoNovo(G, { id: 4, decisao: 'coassinado' })).toEqual({
      registro: 8,
      paciente: 100,
    });
    // C2-076 (d7274d32): o aceite gera a assinatura do preceptor no documento do prontuário (nasce lançado se faltava,
    // com o evento de criação e o de assinatura) antes de fechar a supervisão.
    expect(d.escritas.map((e) => [e.tabela, e.valores['situacao']])).toEqual([
      ['documento_prontuario', undefined],
      ['documento_prontuario_evento', undefined],
      ['documento_prontuario_evento', undefined],
      ['registro_assistencial', 'finalizado'],
      ['registro_assistencial_supervisao', 'coassinado'],
    ]);
  });

  it('óbito: já registrado recusa; com número é emitida e gera o documento; ocupação alheia recusa', async () => {
    const at = { ler: (sql: string) => (/FROM atendimento/.test(sql) ? [{ id: 200 }] : undefined) };
    const o = {
      paciente: 100,
      atendimento: 200,
      dataHora: new Date('2026-11-22T10:00:00Z'),
      numero: '12345678',
      causas: 'causa',
      cbo: 61,
      hashConteudo: HASH,
    };
    expect(
      await erro(
        duble({
          ...at,
          travar: (sql) => (/FROM declaracao_obito/.test(sql) ? [{ id: 1 }] : []),
        }).porta.registrarObito(G, o),
      ),
    ).toEqual({ codigo: 'ja-registrado', status: 409 });
    expect(
      await erro(
        duble({
          ler: (sql: string) =>
            /FROM atendimento/.test(sql)
              ? [{ id: 200 }]
              : /FROM declaracao_obito WHERE estabelecimento_id/.test(sql)
                ? [{ id: 2 }]
                : undefined,
        }).porta.registrarObito(G, o),
      ),
    ).toEqual({ codigo: 'numero-repetido', status: 409 });
    expect(await erro(duble(at).porta.registrarObito(G, { ...o, cbo: 99 }))).toEqual({
      codigo: 'cbo-invalido',
      status: 422,
    });
    const d = duble(at);
    expect(await d.porta.registrarObito(G, o)).toEqual({ id: 900, documento: 901 });
    expect(d.escritas.map((e) => [e.op, e.tabela])).toEqual([
      ['incluir', 'declaracao_obito'],
      ['incluir', 'documento_prontuario'],
      ['incluir', 'documento_prontuario_evento'],
      ['alterar', 'declaracao_obito'],
      // A emissão com número é o primeiro evento da declaração (L126).
      ['incluir', 'declaracao_obito_evento'],
    ]);
    expect(d.escritas[4]!.valores).toMatchObject({
      operacao: 'inclusao',
      tipo_evento: 'emissao',
      numero: '12345678',
    });
    expect(d.escritas[0]!.valores).toMatchObject({
      situacao: 'emitida',
      numero: '12345678',
      profissional_id: 40,
    });
    expect(d.escritas[1]!.valores).toMatchObject({
      entidade_origem: 'declaracao_obito',
      entidade_origem_id: 900,
      tipo_documento_clinico_id: 5,
    });
    const r = duble(at);
    await r.porta.registrarObito(G, { ...o, numero: null, cbo: null });
    expect(r.escritas[0]!.valores).toMatchObject({ situacao: 'rascunho', numero: null, emitida_em: null });
  });

  it('transferência: relatório + documento; atendimento de outro paciente recusa', async () => {
    const t = {
      paciente: 100,
      atendimento: 200,
      destino: 'Hospital X',
      motivo: 'UTI',
      conteudo: '{"a":1}',
      cbo: null,
      hashConteudo: HASH,
    };
    expect(await erro(duble().porta.registrarTransferencia(G, t))).toEqual({
      codigo: 'atendimento-invalido',
      status: 404,
    });
    const d = duble({ ler: (sql) => (/FROM atendimento/.test(sql) ? [{ id: 200 }] : undefined) });
    expect(await d.porta.registrarTransferencia(G, t)).toEqual({ id: 900, documento: 901 });
    expect(d.escritas[0]).toMatchObject({
      tabela: 'relatorio_transferencia',
      valores: { destino: 'Hospital X', usuario_id: 3, profissional_id: 40 },
    });
    expect(d.escritas.at(-1)).toMatchObject({
      op: 'alterar',
      tabela: 'relatorio_transferencia',
      id: 900,
      valores: { documento_prontuario_id: 901 },
    });
  });

  it('ciência: já ciente recusa; comunicação aberta é fechada; sem ela, registrada pelo sistema', async () => {
    const res = (sql: string) => (/FROM resultado_exame/.test(sql) ? [{ id: 77 }] : undefined);
    const x = {
      paciente: 100,
      exame: 77,
      chave: 'k',
      resultado: null,
      elemento: 'K',
      conduta: 'Repor',
      escalonadoPara: null,
    };
    expect(
      await erro(
        duble({ ler: res, travar: () => [{ id: 1, versao: 1, situacao: 'ciente' }] }).porta.registrarCiencia(
          G,
          x,
        ),
      ),
    ).toEqual({ codigo: 'ja-ciente', status: 409 });
    expect(await erro(duble().porta.registrarCiencia(G, x))).toEqual({
      codigo: 'nao-encontrado',
      status: 404,
    });
    const a = duble({ ler: res, travar: () => [{ id: 5, versao: 2, situacao: 'aguardando_ciencia' }] });
    expect(await a.porta.registrarCiencia(G, x)).toBe(5);
    // O resultado é conferido pelo paciente e pelo estabelecimento, não só pelo id.
    expect(a.sqls.find((q) => /FROM resultado_exame/.test(q.sql))?.params).toEqual([77, 100, 7, 7]);
    expect(a.escritas[0]).toMatchObject({
      op: 'alterar',
      id: 5,
      valores: { situacao: 'ciente', ciente_usuario_id: 3, ciente_profissional_id: 40, conduta: 'Repor' },
    });
    const n = duble({ ler: res });
    expect(await n.porta.registrarCiencia(G, x)).toBe(900);
    expect(n.escritas[0]).toMatchObject({
      op: 'incluir',
      valores: { resultado_exame_id: 77, situacao: 'ciente', canal_comunicacao: 'sistema', analito: 'K' },
    });
  });
});
