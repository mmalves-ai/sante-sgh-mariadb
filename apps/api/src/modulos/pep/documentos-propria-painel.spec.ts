// Unidade da família "painel" da porta própria dos documentos, com dublê do núcleo e do executor (sem banco): o SQL
// filtra o estabelecimento e a exclusão lógica, a linha vira o tipo de negócio no fuso do estabelecimento, a liberação
// segue a memória (coassinatura desligada, operação sem adaptador pendente, profissional com conselho ativo) e a
// suspensão recusa o que a memória recusa e grava nova versão da linha, sem exclusão física.
import type {
  ContextoOperacao,
  Executor,
  Leitor,
  Operacao,
  ResultadoOperacao,
  TxOperacao,
} from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import {
  completudePainel,
  componentesDaFicha,
  documentoDaTrilha,
  documentos,
  executar,
  fila,
  lerReceita,
  painel,
  podeGravar,
  preferenciasPainel,
  TETO_PAINEL,
  TP_PADRAO_CONTROLADA,
} from './documentos-propria-painel.js';

type Linha = Record<string, unknown>;
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo', nome_fantasia: 'Hospital teste' };
const C = { cliente: '', estabelecimento: null, usuario: null, correlacao: 'c', rede: 'r', hospital: 'aa' };
const CTX: ContextoOperacao = {
  cliente: 'x',
  estabelecimento: 7,
  usuario: 3,
  correlacao: 'c',
  chaveIdempotencia: 'k',
};
const DOC = 'x'.repeat(60);

function duble(r: { consultar?: (sql: string) => Linha[]; uma?: (sql: string) => Linha | null } = {}) {
  const sqls: { sql: string; params: readonly unknown[] }[] = [];
  const leitor = {
    cliente: 't',
    consultar: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      return r.consultar?.(sql) ?? [];
    },
    uma: async (sql: string, params: readonly unknown[] = []) => {
      sqls.push({ sql, params });
      if (/FROM estabelecimento WHERE codigo/.test(sql)) return EST;
      return r.uma?.(sql) ?? null;
    },
  } as unknown as Leitor;
  const nucleo: NucleoDocumentosPep = {
    lerSomente: async (_c, fn) => fn(leitor),
    criarExecutor: () => {
      throw new Error('não usado');
    },
  };
  return { nucleo, sqls };
}

function executorDuble(o: { prof?: Linha | null; doc?: Linha | null }) {
  const escritas: { op: string; tabela: string; valores: Linha }[] = [];
  const tx = {
    contexto: CTX,
    uma: async () => (o.prof === undefined ? { profissional_id: 40 } : o.prof),
    consultarParaAtualizar: async () =>
      o.doc === null ? [] : [o.doc ?? { id: 5, versao: 2, situacao: 'emitida' }],
    alterar: async (tabela: string, _id: number, _v: number, valores: Linha) => {
      escritas.push({ op: 'alterar', tabela, valores });
      return 1;
    },
    incluir: async (tabela: string, valores: Linha) => {
      escritas.push({ op: 'incluir', tabela, valores });
      return 1;
    },
    excluir: async () => {
      throw new Error('exclusão física proibida');
    },
  } as unknown as TxOperacao;
  const executor = {
    executar: async <E, S extends ResultadoOperacao>(op: Operacao<E, S>) => {
      const s = await op.gravar(tx, {} as E, CTX);
      return { resultado: s, repetida: false };
    },
  } as unknown as Executor;
  return { executor, escritas };
}

describe('painel', () => {
  it('filtra estabelecimento, abertos e exclusão lógica; mapeia a linha e marca o limite', async () => {
    const linha = {
      id: 9,
      numero: 'AT-0042',
      paciente_id: 100,
      tipo_base: 'internacao',
      entrada_em: new Date('2026-11-20T13:00:00Z'),
      nome: 'PACIENTE SINTETICO',
      nome_social: null,
      nascimento: '1980-01-01',
      sexo: 'F',
      numero_prontuario: 555,
      id_unidade: 3,
      unidade: 'UTI',
      leito: '10A',
      convenio: 'PART',
      medico: 'DR',
      alergias: 2,
    };
    const { nucleo, sqls } = duble({ consultar: () => Array.from({ length: TETO_PAINEL + 1 }, () => linha) });
    const r = await painel(nucleo, 'cli', C, { unidade: 3, busca: 'sint%' });
    expect(r.limitado).toBe(true);
    expect(r.linhas).toHaveLength(TETO_PAINEL);
    expect(r.linhas[0]).toMatchObject({
      paciente: 100,
      atendimento: 9,
      registro: 42,
      tipo: 'internacao',
      entrada: '2026-11-20T10:00:00',
      idUnidade: 3,
      alergiasAtivas: 2,
    });
    const q = sqls.at(-1)!;
    expect(q.sql).toMatch(/a\.excluido_em IS NULL AND a\.saida_em IS NULL/);
    expect(q.sql).toMatch(/NOT IN \('encerrado','cancelado'\)/);
    expect(q.params).toEqual([7, 7, 3, 'SINT\\%', 'SINT%']);
  });

  it('equipe sem especialidade: nenhuma linha e nenhuma leitura do painel', async () => {
    const { nucleo, sqls } = duble();
    expect(
      await painel(nucleo, 'cli', C, { unidade: null, busca: null, equipe: { especialidades: [] } }),
    ).toEqual({
      linhas: [],
      limitado: false,
    });
    expect(sqls.some((s) => /FROM atendimento a/.test(s.sql))).toBe(false);
  });

  it('"meus" filtra por quem registrou no episódio ou aceitou parecer', async () => {
    const { nucleo, sqls } = duble();
    await painel(nucleo, 'cli', C, {
      unidade: null,
      busca: null,
      meus: { cbos: [1], login: 'med', hospital: 'aa' },
    });
    const q = sqls.at(-1)!;
    expect(q.sql).toMatch(/registro_assistencial r JOIN usuario u/);
    expect(q.sql).toMatch(/aceito_por_profissional_id/);
    expect(q.params).toEqual([7, 7, 'med', 'med']);
  });
});

describe('completude e preferências', () => {
  it('sem ids não lê; separa alergia de "nega"; pareceres abertos no fuso', async () => {
    const vazio = duble();
    expect((await completudePainel(vazio.nucleo, 'cli', C, [], [], new Date())).negas).toEqual([]);
    expect(vazio.sqls).toHaveLength(0);
    const { nucleo } = duble({
      consultar: (sql) => {
        if (/FROM alergia_paciente/.test(sql))
          return [
            { paciente_id: 1, nega: 0, em: new Date('2026-11-20T12:00:00Z') },
            { paciente_id: 1, nega: 1, em: new Date('2026-11-21T12:00:00Z') },
          ];
        if (/FROM interconsulta/.test(sql))
          return [{ paciente_id: 1, situacao: 'aceito', prazo_em: new Date('2026-11-22T12:00:00Z') }];
        if (/FROM registro_assistencial/.test(sql))
          return [{ atendimento_id: 2, em: new Date('2026-11-20T15:00:00Z') }];
        return [];
      },
    });
    const r = await completudePainel(nucleo, 'cli', C, [1], [2], new Date());
    expect(r.alergiasInformadas).toEqual([{ paciente: 1, em: '2026-11-20T09:00:00' }]);
    expect(r.negas).toEqual([{ paciente: 1, em: '2026-11-21T09:00:00' }]);
    expect(r.evolucoesMedicas).toEqual([{ atendimento: 2, em: '2026-11-20T12:00:00' }]);
    expect(r.pareceres).toEqual([{ paciente: 1, situacao: 'aceito', prazo: '2026-11-22T09:00:00' }]);
    expect(r.valores).toEqual([]);
  });

  it('preferências: sem conta, vazio; com filtro padrão, unidade e colunas', async () => {
    expect(await preferenciasPainel(duble().nucleo, 'cli', C, 'x')).toEqual({ unidade: null, campos: [] });
    const { nucleo } = duble({
      uma: (sql) => (/FROM usuario/.test(sql) ? { id: 3 } : { id: 8, unidade_internacao_id: 4 }),
      consultar: () => [{ coluna: 'leito', exibir: 0, ordem: 2 }],
    });
    expect(await preferenciasPainel(nucleo, 'cli', C, 'med')).toEqual({
      unidade: 4,
      campos: [{ campo: 'leito', exibir: false, ordem: 2 }],
    });
  });
});

describe('receitas, atestados, fichas e fila', () => {
  const receita = {
    id: 5,
    paciente_id: 100,
    atendimento_id: 9,
    emitida_em: new Date('2026-11-20T13:00:00Z'),
    situacao: 'suspensa',
    suspensa_em: new Date('2026-11-20T14:00:00Z'),
    justificativa_suspensao: 'motivo',
    orientacoes: null,
    origem_receita_medica_id: null,
    controle_especial: 1,
    antimicrobiano: 0,
    profissional: 'DR',
    cbo: '225125',
  };
  it('id inválido não lê; receita controlada, suspensa, no fuso', async () => {
    const v = duble();
    expect(await lerReceita(v.nucleo, 'cli', C, 0)).toBeNull();
    expect(v.sqls).toHaveLength(0);
    const { nucleo, sqls } = duble({ uma: () => receita, consultar: () => [receita] });
    expect(await lerReceita(nucleo, 'cli', C, 5)).toMatchObject({
      titulo: 'Receita de controle especial',
      suspensoEm: '2026-11-20T11:00:00',
      retratos: { htPaciente: 100, htAtendimento: 9 },
      cbo: '225125',
    });
    expect(sqls.at(-1)!.sql).toMatch(/x\.estabelecimento_id = \? AND x\.excluido_em IS NULL/);
    const [d] = await documentos(nucleo, 'cli', C, 100, 'receita');
    expect(d).toMatchObject({ familia: 'receita', suspenso: true, tpPadrao: TP_PADRAO_CONTROLADA });
  });

  it('documento da trilha: nenhum no banco próprio (como a memória)', async () => {
    expect(await documentoDaTrilha()).toBeNull();
  });

  it('componentes da ficha: do conteúdo, ou o modelo ligado', () => {
    expect(componentesDaFicha('{"componentes":[{"nome":"Texto","modelo":"M"},{"x":1}]}', null)).toEqual([
      { nome: 'Texto', modelo: 'M' },
    ]);
    expect(componentesDaFicha('{}', 'Atestado')).toEqual([{ nome: 'Atestado', modelo: 'Atestado' }]);
    expect(componentesDaFicha('lixo', null)).toEqual([]);
  });

  it('fila: filtros opcionais como parâmetros; origem e logins', async () => {
    const { nucleo, sqls } = duble({
      consultar: () => [
        {
          id: 1,
          paciente_id: 2,
          atendimento_id: 3,
          pedido_registro_assistencial_id: 4,
          especialidade_medica_id: 5,
          categoria_assistencial: null,
          prioridade: 'urgente',
          prazo_em: null,
          situacao: 'solicitado',
          origem: 'migracao',
          solicitado_em: new Date('2026-11-20T13:00:00Z'),
          resposta: null,
          solicitante: 'med',
          aceito_por: null,
        },
      ],
    });
    const [f] = await fila(nucleo, 'cli', C, { especialidade: 5, situacao: 'solicitado' });
    expect(f).toMatchObject({ tipo: 'parecer', origem: 'legado', solicitante: 'med', aceitoPor: null });
    expect(sqls.at(-1)!.params).toEqual([7, 5, 'solicitado']);
  });
});

describe('podeGravar e executar', () => {
  it('coassinatura desligada; sem adaptador, pendente; sem profissional ou conselho, não pode', async () => {
    const { nucleo, sqls } = duble();
    expect((await podeGravar(nucleo, 'cli', C, 'pep.coassinarEvolucao', 'med')).codigo).toBe(
      'operacao-nao-liberada',
    );
    expect((await podeGravar(nucleo, 'cli', C, 'pep.registrarObito', 'med')).codigo).toBe(
      'pendente-modelo-proprio',
    );
    expect(sqls).toHaveLength(0);
    expect((await podeGravar(nucleo, 'cli', C, 'pep.suspenderDocumento', 'med')).codigo).toBe(
      'sem-profissional',
    );
    const semConselho = duble({
      uma: (sql) => (/FROM usuario u/.test(sql) ? { usuario: 3, profissional: 40 } : { n: 0 }),
    });
    expect((await podeGravar(semConselho.nucleo, 'cli', C, 'pep.suspenderDocumento', 'med')).codigo).toBe(
      'sem-conselho-ativo',
    );
    const ok = duble({
      uma: (sql) => (/FROM usuario u/.test(sql) ? { usuario: 3, profissional: 40 } : { n: 1 }),
    });
    expect(await podeGravar(ok.nucleo, 'cli', C, 'pep.suspenderDocumento', 'med')).toEqual({
      pode: true,
      codigo: null,
      motivo: null,
    });
  });

  it('operação sem adaptador recusa 501; a de outra família é despachada', async () => {
    const { nucleo } = duble();
    const { executor } = executorDuble({});
    await expect(executar(nucleo, 'cli', executor, C, 'pep.registrarObito', {}, CTX)).rejects.toMatchObject({
      problema: { status: 501, codigo: 'pendente-modelo-proprio' },
    });
    expect(
      await executar(nucleo, 'cli', executor, C, 'pep.x', {}, CTX, { 'pep.x': async () => ({ feito: 1 }) }),
    ).toEqual({ feito: 1 });
  });

  const entrada = {
    familia: 'atestado',
    paciente: 100,
    origem: 5,
    cbo: 11,
    justificativa: 'Emitido por engano',
    documento: DOC,
  };

  it('suspensão: entrada inválida 400, inscrição de outro 403, inexistente 404, já suspenso 422', async () => {
    const { nucleo } = duble();
    const exec = (o: Parameters<typeof executorDuble>[0], e: unknown = entrada) =>
      executar(nucleo, 'cli', executorDuble(o).executor, C, 'pep.suspenderDocumento', e, CTX);
    await expect(exec({}, { ...entrada, justificativa: 'curta' })).rejects.toMatchObject({
      problema: { status: 400 },
    });
    await expect(exec({ prof: null })).rejects.toMatchObject({ problema: { status: 403 } });
    await expect(exec({ doc: null })).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(exec({ doc: { id: 5, versao: 1, situacao: 'suspenso' } })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'ja-suspenso' },
    });
  });

  it('suspensão do atestado: nova versão da linha e versão do documento emitido, sem exclusão', async () => {
    const { nucleo } = duble();
    const d = executorDuble({ doc: { id: 5, versao: 2, situacao: 'valido' } });
    expect(await executar(nucleo, 'cli', d.executor, C, 'pep.suspenderDocumento', entrada, CTX)).toEqual({
      origem: 5,
      trilha: null,
    });
    expect(d.escritas.map((e) => [e.op, e.tabela])).toEqual([
      ['alterar', 'documento_emitido'],
      ['incluir', 'documento_emitido_versao'],
    ]);
    expect(d.escritas[0]!.valores).toMatchObject({ situacao: 'suspenso', suspenso_por_profissional_id: 40 });
    const r = executorDuble({});
    await executar(
      nucleo,
      'cli',
      r.executor,
      C,
      'pep.suspenderDocumento',
      { ...entrada, familia: 'receita' },
      CTX,
    );
    expect(r.escritas).toHaveLength(1);
    expect(r.escritas[0]).toMatchObject({ tabela: 'receita_medica', valores: { situacao: 'suspensa' } });
  });
});
