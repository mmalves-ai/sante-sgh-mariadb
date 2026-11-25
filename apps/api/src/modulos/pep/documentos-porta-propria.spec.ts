// Unidade da porta própria dos documentos do prontuário com um dublê do núcleo e do executor (sem banco): o SQL filtra
// o estabelecimento e a exclusão lógica, a linha vira o tipo de negócio no fuso do estabelecimento, o lote de
// assinatura recusa o que a porta de memória recusa (autor, já assinado, conteúdo mudado) e assina o resto, e o que não
// tem adaptador recusa com 501 sem ler nem gravar.
import { createHash } from 'node:crypto';
import type { Executor, Leitor, Operacao, ResultadoOperacao, TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_ASSINAVEIS,
  documentoLido,
  PortaDocumentosPropria,
  tipoDeNegocio,
} from './documentos-porta-propria.js';

type Linha = Record<string, unknown>;
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };
const C = {
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 'cor-1',
  rede: 'rede-teste',
  hospital: 'aa',
};
const G = { ...C, usuario: 3, usuarioLogin: 'medico', traceId: 't-1' };
const HASH = 'a'.repeat(64);

function linhaDoc(o: Partial<Linha> = {}): Linha {
  return {
    id: 10,
    categoria_tipo: 'evolucao',
    entidade_origem: 'registro_assistencial',
    entidade_origem_id: 55,
    paciente_id: 100,
    atendimento_id: 200,
    lancado_em: new Date('2026-11-20T15:00:00Z'),
    conteudo: JSON.stringify({ hash_conteudo: HASH, como_suporte: false }),
    categoria: 'lancado',
    hash_conteudo: null,
    nivel_exigido: null,
    concluido_em: null,
    assinado_em: null,
    dados_assinatura: null,
    autor: 'medico',
    ...o,
  };
}

function duble(
  o: {
    docs?: Linha[];
    travados?: Record<number, Linha | undefined>;
    autor?: number | null;
    encerrado?: Linha | null;
    inscricoes?: Linha[];
  } = {},
) {
  const sqls: { sql: string; params: readonly unknown[] }[] = [];
  const escritas: { op: string; tabela: string; id?: number; valores: Linha }[] = [];
  const contextos: unknown[] = [];
  let proximo = 900;
  const leitor = {
    cliente: 'teste',
    consultar: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      if (/FROM documento_prontuario dp/.test(sql)) return o.docs ?? [];
      if (/FROM inscricao_conselho/.test(sql)) return o.inscricoes ?? [];
      return [];
    },
    uma: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      if (/FROM estabelecimento/.test(sql)) return EST;
      if (/LEFT JOIN usuario_vinculo_profissional/.test(sql))
        return { usuario: 3, profissional: o.autor === undefined ? 40 : o.autor, nome: 'P' };
      if (/FROM usuario u/.test(sql)) return o.encerrado ?? null;
      if (/situacao_documento_prontuario WHERE categoria/.test(sql)) return { id: 2 };
      if (/FROM documento_prontuario dp/.test(sql)) return (o.docs ?? [])[0] ?? null;
      return null;
    },
  };
  const tx = {
    ...leitor,
    consultarParaAtualizar: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      const t = o.travados?.[Number(params[0])];
      return t ? [t] : [];
    },
    incluir: async (tabela: string, valores: Linha) => {
      escritas.push({ op: 'incluir', tabela, valores });
      return proximo++;
    },
    alterar: async (tabela: string, id: number, _v: number, valores: Linha) => {
      escritas.push({ op: 'alterar', tabela, id, valores });
      return 2;
    },
  } as unknown as TxOperacao;
  const trilhas: unknown[] = [];
  const executor = {
    executar: async <E, S extends ResultadoOperacao>(
      op: Operacao<E, S>,
      _c: string,
      e: unknown,
      ctx: unknown,
    ) => {
      contextos.push(ctx);
      const resultado = await op.gravar(tx, e as E, ctx as never);
      trilhas.push({
        alvo: op.alvo(e as E, resultado),
        extras: op.trilha?.(e as E, resultado, ctx as never),
      });
      return { resultado, repetida: false, eventos: [], trilha: 1 };
    },
  } as unknown as Executor;
  const nucleo = {
    lerSomente: async <T>(c: unknown, fn: (l: Leitor) => Promise<T>) => {
      contextos.push(c);
      return fn(leitor as unknown as Leitor);
    },
    criarExecutor: () => executor,
  };
  return { porta: new PortaDocumentosPropria(nucleo, 'cliente-config'), sqls, escritas, contextos, trilhas };
}

const travado = (o: Partial<Linha> = {}): Linha => ({
  id: 10,
  versao: 1,
  profissional_id: 40,
  situacao_documento_prontuario_id: 1,
  conteudo: JSON.stringify({ hash_conteudo: HASH }),
  categoria: 'lancado',
  hash_conteudo: null,
  concluido_em: null,
  assinaturas: 0,
  autor: 'medico',
  ...o,
});

describe('PortaDocumentosPropria (dublê do núcleo)', () => {
  it('documentoLido: vocabulário neutro, fuso do estabelecimento, resumo da emissão e situação suspensa', () => {
    const d = documentoLido(linhaDoc(), 'America/Sao_Paulo');
    expect(d).toEqual({
      id: 10,
      tipo: 'registro-clinico',
      origemTabela: 'registro_assistencial',
      origemId: 55,
      paciente: 100,
      atendimento: 200,
      usuario: 'medico',
      hash: HASH,
      nivel: 'sem-assinatura',
      criadoEm: '2026-11-20T12:00:00',
      assinadoEm: null,
      suspenso: false,
      comoSuporte: false,
    });
    // O envelope assinado manda no resumo e no nível; a assinatura na sessão traz a data e o nível do evento.
    expect(
      documentoLido(linhaDoc({ hash_conteudo: 'b'.repeat(64), nivel_exigido: 'icp-brasil' }), 'UTC'),
    ).toMatchObject({
      hash: 'b'.repeat(64),
      nivel: 'icp-brasil',
    });
    expect(
      documentoLido(
        linhaDoc({
          categoria: 'assinado',
          assinado_em: new Date('2026-11-20T16:00:00Z'),
          dados_assinatura: { nivel: 'avancada-sessao-suporte', comoSuporte: true },
        }),
        'UTC',
      ),
    ).toMatchObject({
      assinadoEm: '2026-11-20T16:00:00',
      nivel: 'avancada-sessao-suporte',
      comoSuporte: true,
      suspenso: false,
    });
    for (const categoria of ['rascunho', 'suspenso', 'cancelado', 'corrigido', 'arquivado'])
      expect(documentoLido(linhaDoc({ categoria }), 'UTC').suspenso).toBe(true);
    for (const categoria of CATEGORIAS_ASSINAVEIS)
      expect(documentoLido(linhaDoc({ categoria }), 'UTC').suspenso).toBe(false);
    // Tipo de negócio pela origem e pela categoria do tipo; nunca o código do catálogo do cliente.
    expect(tipoDeNegocio('registro_assistencial', 'outro')).toBe('registro-clinico');
    expect(tipoDeNegocio('alergia_paciente', 'outro')).toBe('alergia');
    expect(tipoDeNegocio('documento_emitido', 'sumario')).toBe('sumario-alta');
    expect(tipoDeNegocio('documento_emitido', 'atestado')).toBe('atestado');
    expect(tipoDeNegocio('outra', 'termo')).toBe('tcle');
    expect(tipoDeNegocio('outra', 'outro')).toBe('documento');
    // Sem resumo gravado: o SHA-256 do conteúdo estruturado.
    const semHash = documentoLido(linhaDoc({ conteudo: null }), 'UTC');
    expect(semHash.hash).toBe(createHash('sha256').update('null').digest('hex'));
  });

  it('leituras filtram o estabelecimento e a exclusão lógica; cliente da configuração quando a sessão não traz', async () => {
    const d = duble({ docs: [linhaDoc()] });
    const ds = await d.porta.documentosSgh(C, 100);
    expect(ds.map((x) => x.id)).toEqual([10]);
    expect(d.contextos[0]).toEqual({ cliente: 'cliente-config', correlacao: 'pep.documentos.lista' });
    const sql = d.sqls.find((s) => /FROM documento_prontuario dp/.test(s.sql))!;
    expect(sql.sql).toMatch(/dp\.estabelecimento_id = \? AND dp\.excluido_em IS NULL/);
    expect(sql.params).toEqual([7, 100]);
    expect(await d.porta.documentoSgh(C, 10)).toMatchObject({ id: 10 });
    expect(await d.porta.documentoSghDaOrigem(C, 'registro_assistencial', 55)).toMatchObject({
      origemId: 55,
    });
  });

  it('pendências: só do autor fixado no documento (o mesmo critério da prévia), assinável, sem assinatura', async () => {
    const d = duble({ docs: [linhaDoc()] });
    expect((await d.porta.pendencias(C, 'medico')).map((x) => x.id)).toEqual([10]);
    const sql = d.sqls.find((s) => /FROM documento_prontuario dp/.test(s.sql))!;
    expect(sql.params).toEqual([7, 'medico', ...CATEGORIAS_ASSINAVEIS]);
    expect(sql.sql).toMatch(/NOT EXISTS/);
    // O autor vem do evento de criação, sem filtro de vigência do vínculo de hoje.
    expect(sql.sql).toMatch(/ec\.acao = 'criacao'/);
    const sem = duble({ docs: [linhaDoc()] });
    expect(await sem.porta.pendencias(C, '')).toEqual([]);
    expect(sem.sqls).toEqual([]);
  });

  it('profissional: vínculo encerrado mantém a categoria (sigilo) com o conselho inativo; login vazio é null', async () => {
    const inscricoes = [{ id: 5, situacao: 'ativa', codigo_cbo: '251510' }];
    const d = duble({ autor: null, encerrado: { usuario: 3, profissional: 40, nome: 'P' }, inscricoes });
    const p = await d.porta.profissional(C, 'psicologo-que-saiu');
    expect(p).toMatchObject({ idProfissional: 40, cbo: 5 });
    expect(p!.ocupacoes).toEqual([{ cbo: 5, codigo: '251510', conselhoAtivo: false }]);
    const vigente = duble({ inscricoes });
    expect((await vigente.porta.profissional(C, 'medico'))!.ocupacoes[0]!.conselhoAtivo).toBe(true);
    expect(await duble({ inscricoes }).porta.profissional(C, '')).toBeNull();
  });

  it('assinar: recusa o de outro autor, o já assinado e o conteúdo mudado; assina o resto com evento e situação', async () => {
    const d = duble({
      travados: {
        10: travado(),
        11: travado({ id: 11, profissional_id: 41 }),
        12: travado({ id: 12, assinaturas: 1 }),
        13: travado({ id: 13 }),
        14: travado({ id: 14, categoria: 'rascunho' }),
        16: travado({ id: 16, autor: 'outra-conta-do-mesmo-profissional' }),
      },
    });
    const r = await d.porta.assinar(G, [
      { documento: 10, hash: HASH },
      { documento: 11, hash: HASH },
      { documento: 12, hash: HASH },
      { documento: 13, hash: 'c'.repeat(64) },
      { documento: 14, hash: HASH },
      { documento: 15, hash: HASH },
      { documento: 16, hash: HASH },
    ]);
    expect(r.assinados).toEqual([10]);
    expect(r.recusados).toEqual([
      { documento: 11, motivo: 'Documento não encontrado entre as suas pendências.' },
      { documento: 12, motivo: 'Já assinado.' },
      { documento: 13, motivo: 'O conteúdo mudou desde a prévia.' },
      { documento: 14, motivo: 'O documento não está em situação de assinatura.' },
      { documento: 15, motivo: 'Documento não encontrado entre as suas pendências.' },
      { documento: 16, motivo: 'Documento não encontrado entre as suas pendências.' },
    ]);
    expect(
      d.escritas.map((e) => [
        e.op,
        e.tabela,
        e.valores['acao'] ?? e.valores['situacao_documento_prontuario_id'],
      ]),
    ).toEqual([
      ['alterar', 'documento_prontuario', 2],
      ['incluir', 'documento_prontuario_evento', 'assinatura'],
    ]);
    expect(JSON.parse(String(d.escritas[1]!.valores['dados']))).toEqual({
      nivel: 'avancada-sessao',
      hash: HASH,
      comoSuporte: false,
    });
    // Nenhuma exclusão física em tabela clínica.
    expect(d.sqls.some((s) => /\bDELETE\b/i.test(s.sql))).toBe(false);
    expect(d.trilhas[0]).toMatchObject({ alvo: { tabela: 'documento_prontuario', id: 10 } });
  });

  it('assinar como suporte: nível de suporte e sem profissional no evento', async () => {
    const d = duble({ travados: { 10: travado() } });
    await d.porta.assinar(G, [{ documento: 10, hash: HASH }], true);
    const ev = d.escritas.find((e) => e.tabela === 'documento_prontuario_evento')!;
    expect(ev.valores['profissional_id']).toBeNull();
    expect(JSON.parse(String(ev.valores['dados']))).toMatchObject({
      nivel: 'avancada-sessao-suporte',
      comoSuporte: true,
    });
  });

  it('documento do registro clínico: o existente volta sem gravar', async () => {
    const d = duble({ docs: [linhaDoc()] });
    expect(
      await d.porta.documentoDoRegistroClinico(G, {
        registro: 55,
        paciente: 100,
        atendimento: 200,
        hash: HASH,
      }),
    ).toBe(10);
    expect(d.escritas).toEqual([]);
  });

  it('evento de impressão: vias e evento na cadeia; visualização só na trilha (consulta)', async () => {
    const d = duble({
      travados: { 10: { id: 10, versao: 1, situacao_documento_prontuario_id: 1, vias_impressas: 2 } },
    });
    await d.porta.registrarEventoDocumento(G, { documento: 10, tipo: 'segunda-via', justificativa: 'perda' });
    expect(d.escritas[0]).toMatchObject({ op: 'alterar', valores: { vias_impressas: 3 } });
    expect(d.escritas[1]).toMatchObject({
      tabela: 'documento_prontuario_evento',
      valores: { acao: 'impressao', justificativa: 'perda' },
    });
    // O registro único de impressão e exportação (01-ADM L82): a segunda via é reimpressão, com a justificativa.
    expect(d.escritas[2]).toMatchObject({
      tabela: 'exportacao_documento',
      valores: { documento_prontuario_id: 10, tipo_operacao: 'reimpressao', justificativa: 'perda' },
    });
    expect(d.escritas).toHaveLength(3);
    await d.porta.registrarEventoDocumento(G, { documento: 10, tipo: 'visualizado' });
    expect(d.escritas).toHaveLength(3);
    expect(d.trilhas[1]).toMatchObject({ extras: { acao: 'consulta' } });
  });

  // pep.emitirDocumento ganhou adaptador próprio (documentos-propria-operacoes.ts); anexar documento ainda não tem.
  it('operação sem adaptador próprio não é liberada, sem ler nem gravar', async () => {
    const d = duble();
    expect(await d.porta.podeGravar(G, 'pep.operacaoSemAdaptador', 'medico')).toMatchObject({
      pode: false,
      codigo: 'pendente-modelo-proprio',
    });
    expect(d.sqls).toEqual([]);
  });
});
