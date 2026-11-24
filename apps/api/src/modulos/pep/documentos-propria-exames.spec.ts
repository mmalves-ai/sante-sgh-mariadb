// Unidade da família exames, anexos e termo de consentimento da porta própria dos documentos: as regras puras de
// tradução (grupo do exame, idade, sexo, situação do termo, extensão) e o comportamento da porta sobre um núcleo
// trocado (leituras roteadas por SQL e um executor que roda a gravação numa transação falsa). Massa sintética.
import { ErroOperacao, type Executor, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  anosDeDias,
  atoDoServico,
  DocumentosPropriaExames,
  extensaoDe,
  idsValidos,
  sexoDe,
  situacaoDoTermo,
} from './documentos-propria-exames.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';

type Linha = Record<string, unknown>;
type Rota = [RegExp, (sql: string, p: unknown[]) => Linha[]];

const C = {
  rede: 'r',
  hospital: 'H1',
  cliente: 'teste',
  estabelecimento: null,
  usuario: 7,
  correlacao: 'unidade',
};
const G = { ...C, usuarioLogin: 'medico', traceId: 't1' };

function nucleoFalso(rotas: Rota[], gravados: { tabela: string; valores: Linha }[] = []) {
  const consultar = async (sql: string, p: unknown[] = []): Promise<Linha[]> => {
    if (/FROM estabelecimento WHERE codigo/.test(sql)) return [{ id: 1, fuso_horario: 'America/Sao_Paulo' }];
    for (const [re, f] of rotas) if (re.test(sql)) return f(sql, p);
    return [];
  };
  const leitor = {
    consultar,
    uma: async (sql: string, p?: unknown[]) => (await consultar(sql, p))[0] ?? null,
  };
  let proximo = 100;
  const tx = {
    ...leitor,
    consultarParaAtualizar: consultar,
    incluir: async (tabela: string, valores: Linha) => {
      gravados.push({ tabela, valores });
      return ++proximo;
    },
    alterar: async (tabela: string, id: number, _v: number, valores: Linha) => {
      gravados.push({ tabela, valores: { ...valores, id } });
      return 2;
    },
  } as unknown as TxOperacao;
  const executor = {
    executar: async (op: { gravar: (t: TxOperacao) => Promise<unknown> }) => {
      await op.gravar(tx);
      return {};
    },
  } as unknown as Executor;
  const nucleo: NucleoDocumentosPep = {
    lerSomente: async (_c, fn) => fn(leitor as never),
    criarExecutor: () => executor,
  };
  return { nucleo, gravados };
}

/** Sessão válida: usuário 7 → profissional 9 → inscrição 33 ativa. */
const SESSAO: Rota[] = [
  [/FROM usuario u\s+LEFT JOIN usuario_vinculo_profissional/, () => [{ usuario: 7, profissional_id: 9 }]],
  [/FROM inscricao_conselho i JOIN profissional/, () => [{ id: 33 }]],
];

describe('regras puras de tradução', () => {
  it('grupo do exame pelo tipo de serviço (15 laboratório, 16 imagem, 0 outros)', () => {
    expect([atoDoServico('laboratorio'), atoDoServico('imagem'), atoDoServico('metodo_grafico')]).toEqual([
      15, 16, 0,
    ]);
  });
  it('idade em anos completos; sem limite: null', () => {
    expect([anosDeDias(null), anosDeDias(365), anosDeDias(18 * 365.25), anosDeDias(364)]).toEqual([
      null,
      0,
      18,
      0,
    ]);
  });
  it('sexo F/M pela sigla ou código; outro: sem restrição', () => {
    expect([sexoDe('F', null), sexoDe(null, 'm'), sexoDe('I', 'IGN')]).toEqual(['F', 'M', null]);
  });
  it('situação do termo: assinado; revogado, recusado e cancelado deixam de valer; o resto pendente', () => {
    expect(
      ['assinado', 'revogado', 'recusado', 'cancelado', 'emitido', 'pendente'].map(situacaoDoTermo),
    ).toEqual(['assinado', 'revogado', 'revogado', 'revogado', 'pendente', 'pendente']);
  });
  it('extensão pelo nome ou pelo tipo MIME', () => {
    expect([
      extensaoDe('Laudo.PDF', null),
      extensaoDe('sem', 'application/pdf'),
      extensaoDe('x', 'image/png'),
    ]).toEqual(['pdf', 'pdf', null]);
  });
  it('ids válidos: positivos, sem repetição', () => {
    expect(idsValidos([3, 3, -1, 0, 1.5, 4])).toEqual([3, 4]);
  });
});

describe('DocumentosPropriaExames (núcleo trocado)', () => {
  it('catálogo: termo em caixa alta, nome contém ou código igual; só os pedíveis; tradução do exame', async () => {
    let visto: { sql: string; p: unknown[] } | null = null;
    const { nucleo } = nucleoFalso([
      [
        /FROM exame ex/,
        (sql, p) => {
          visto = { sql, p };
          return [
            {
              id: 5,
              codigo: 'K',
              nome: 'POTÁSSIO',
              tipo_servico: 'laboratorio',
              ativo: 1,
              idade_minima_dias: null,
              idade_maxima_dias: 3650,
              sexo_sigla: null,
              sexo_codigo: null,
              material: 2,
            },
          ];
        },
      ],
    ]);
    const porta = new DocumentosPropriaExames(nucleo, 'teste');
    const r = await porta.catalogoExames(C, ' pot ');
    expect(r).toEqual([
      {
        id: 5,
        ato: 15,
        codigo: 'K',
        nome: 'POTÁSSIO',
        ativo: true,
        sexo: null,
        idadeMinima: null,
        idadeMaxima: 9,
        material: 2,
      },
    ]);
    expect(visto!.sql).toContain('solicitavel_prontuario = TRUE');
    expect(visto!.p).toEqual(['%POT%', 'POT']);
  });

  it('examesPorId sem ids válidos não lê o banco', async () => {
    const { nucleo } = nucleoFalso([
      [
        /./,
        () => {
          throw new Error('não deveria ler');
        },
      ],
    ]);
    expect(await new DocumentosPropriaExames(nucleo, 'teste').examesPorId(C, [0, -2])).toEqual([]);
  });

  it('kits agrupam os exames na ordem do item; kit sem item vem vazio', async () => {
    const { nucleo } = nucleoFalso([
      [
        /FROM kit_exame k/,
        () => [
          { id: 1, nome: 'ROTINA', exame_id: 5 },
          { id: 1, nome: 'ROTINA', exame_id: 6 },
          { id: 2, nome: 'VAZIO', exame_id: null },
        ],
      ],
    ]);
    expect(await new DocumentosPropriaExames(nucleo, 'teste').kits(C)).toEqual([
      { id: 1, nome: 'ROTINA', exames: [5, 6] },
      { id: 2, nome: 'VAZIO', exames: [] },
    ]);
  });

  it('pedidos: requisição é o agrupamento; prioridade urgente marca o item; situação → solicitado/liberado', async () => {
    const { nucleo } = nucleoFalso([
      [
        /FROM requisicao_exame r/,
        () =>
          [
            {
              id: 11,
              requisicao: 10,
              exame_id: 5,
              nome: 'POTÁSSIO',
              tipo_servico: 'laboratorio',
              solicitado_em: new Date('2026-11-20T13:00:00Z'),
              prioridade: 'urgente',
              urgente: 0,
              situacao: 'solicitado',
              indicacao_clinica: 'controle',
              profissional: 'Profissional sintético',
            },
            {
              id: 12,
              requisicao: 10,
              exame_id: 6,
              nome: 'RX',
              tipo_servico: 'imagem',
              solicitado_em: new Date('2026-11-20T13:00:00Z'),
              prioridade: 'rotina',
              urgente: 0,
              situacao: 'liberado',
              indicacao_clinica: null,
              profissional: null,
            },
          ].reverse(), // o banco devolve do mais recente para trás (ORDER BY ... DESC)
      ],
    ]);
    const [a, b] = await new DocumentosPropriaExames(nucleo, 'teste').pedidos(C, 1);
    expect(a).toMatchObject({
      id: 11,
      agrupamento: 10,
      ato: 15,
      urgente: true,
      pendSadt: 'T',
      liberado: false,
    });
    expect(a!.data).toBe(a!.solicitadoEm!.slice(0, 10));
    expect(b).toMatchObject({
      id: 12,
      ato: 16,
      urgente: false,
      pendSadt: null,
      liberado: true,
      indicacao: null,
    });
  });

  it('resultados: valores por analito com faixa e limites críticos; texto cai na conclusão', async () => {
    const { nucleo } = nucleoFalso([
      [
        /FROM resultado_exame re/,
        () => [
          {
            id: 40,
            item: 11,
            sequencia: 1,
            nome: 'POTÁSSIO',
            codigo: 'K',
            tipo_servico: 'laboratorio',
            requisicao: 10,
            atendimento: 'A-1',
            liberado_em: new Date('2026-11-20T15:00:00Z'),
            texto_resultado: null,
            conclusao: 'Sem observações',
          },
        ],
      ],
      [
        /FROM resultado_analito ra/,
        () => [
          {
            resultado_exame_id: 40,
            elemento: 'POTASSIO',
            valor_numerico: '6.900000',
            valor_texto: null,
            unidade: 'mEq/L',
            referencia_minimo: '3.5',
            referencia_maximo: '5.1',
            referencia_texto: '3,5 a 5,1',
            critico_minimo: '2.5',
            critico_maximo: '6.5',
          },
        ],
      ],
    ]);
    const [r] = await new DocumentosPropriaExames(nucleo, 'teste').resultados(C, 1);
    expect(r!.exame).toBe(11);
    expect(r!.chave).toMatchObject({ reg: 1, conta: 10, atend: 'A-1', ato: 15, exame: 'K', sequencia: 1 });
    expect(r!.valores[0]).toEqual({
      elemento: 'POTASSIO',
      numerico: 6.9,
      alfa: null,
      unidade: 'mEq/L',
      refIni: 3.5,
      refFin: 5.1,
      referencia: '3,5 a 5,1',
      minAbe: 2.5,
      maxAbe: 6.5,
    });
    expect(r!.texto).toBe('Sem observações');
  });

  it('arquivo do anexo: sem a porta de armazenamento, 503 (falha fechada); com ela, o conteúdo lido', async () => {
    const rotas: Rota[] = [
      [/FROM anexo_prontuario ap\s+WHERE ap.id/, () => [{ paciente_id: 1, arquivo_id: 77 }]],
    ];
    const { nucleo } = nucleoFalso(rotas);
    await expect(new DocumentosPropriaExames(nucleo, 'teste').arquivoAnexo(C, 3)).rejects.toMatchObject({
      problema: {
        status: 503,
      },
    });
    let pedido: number | null = null;
    const arquivos = {
      ler: async (_c: unknown, id: number) => {
        pedido = id;
        return { metadado: {} as never, conteudo: Buffer.from('%PDF-1.4') };
      },
    };
    const r = await new DocumentosPropriaExames(nucleo, 'teste', arquivos).arquivoAnexo(C, 3);
    expect(pedido).toBe(77);
    expect(r?.paciente).toBe(1);
    expect(r?.pdf.toString('latin1')).toBe('%PDF-1.4');
    expect(await new DocumentosPropriaExames(nucleo, 'teste', arquivos).arquivoAnexo(C, 0)).toBeNull();
  });

  it('termos: versão anterior, situação pela etapa e o motivo da revogação', async () => {
    const { nucleo } = nucleoFalso([
      [
        /FROM termo_consentimento_paciente t/,
        (sql) =>
          [
            {
              id: 1,
              termo_anterior_id: null,
              atendimento_id: 2,
              termo_consentimento_modelo_id: 3,
              procedimento_descricao: 'Cateterismo',
              etapa: 'emitido',
              motivo_revogacao: null,
              motivo_recusa: null,
              documento_prontuario_id: 9,
              criado_em: new Date('2026-11-20T10:00:00Z'),
              login: 'medico',
            },
            {
              id: 4,
              termo_anterior_id: 1,
              atendimento_id: 2,
              termo_consentimento_modelo_id: 3,
              procedimento_descricao: 'Cateterismo',
              etapa: 'revogado',
              motivo_revogacao: 'Paciente desistiu do exame',
              motivo_recusa: null,
              documento_prontuario_id: 9,
              criado_em: new Date('2026-11-20T11:00:00Z'),
              login: null,
            },
          ].filter((x) => (/AND NOT EXISTS/.test(sql) ? x.id === 4 : x.id === 1)),
      ],
    ]);
    const ts = await new DocumentosPropriaExames(nucleo, 'teste').tcles(C, 1);
    expect(ts.map((t) => [t.id, t.anterior, t.situacao, t.motivo, t.usuario])).toEqual([
      [1, null, 'pendente', null, 'medico'],
      [4, 1, 'revogado', 'Paciente desistiu do exame', ''],
    ]);
  });

  it('emitir termo: exige o profissional da sessão com conselho ativo', async () => {
    const { nucleo } = nucleoFalso([
      [
        /FROM usuario u\s+LEFT JOIN usuario_vinculo_profissional/,
        () => [{ usuario: 7, profissional_id: null }],
      ],
    ]);
    const e = {
      paciente: 1,
      atendimento: 2,
      tipo: null,
      procedimento: 'Cateterismo',
      cbo: null,
      hashConteudo: 'h',
    };
    await expect(new DocumentosPropriaExames(nucleo, 'teste').emitirTcle(G, e)).rejects.toMatchObject({
      problema: {
        status: 403,
        codigo: 'sem-profissional',
      },
    });
    const { nucleo: n2 } = nucleoFalso([
      [/FROM usuario u\s+LEFT JOIN usuario_vinculo_profissional/, () => [{ usuario: 7, profissional_id: 9 }]],
    ]);
    await expect(new DocumentosPropriaExames(n2, 'teste').emitirTcle(G, e)).rejects.toMatchObject({
      problema: {
        codigo: 'conselho-inativo',
      },
    });
  });

  it('emitir termo: grava o termo pendente, o documento lançado com o resumo, o evento de criação e o vínculo', async () => {
    const { nucleo, gravados } = nucleoFalso([
      ...SESSAO,
      [/FROM atendimento WHERE id/, () => [{ id: 2, paciente_id: 1 }]],
      [/FROM tipo_documento_clinico WHERE categoria = 'termo'/, () => [{ id: 50 }]],
      [/FROM situacao_termo_consentimento/, () => [{ id: 60 }]],
      [/FROM situacao_documento_prontuario/, () => [{ id: 70 }]],
    ]);
    const r = await new DocumentosPropriaExames(nucleo, 'teste').emitirTcle(G, {
      paciente: 1,
      atendimento: 2,
      tipo: null,
      procedimento: ' Cateterismo ',
      cbo: 33,
      hashConteudo: 'abc',
    });
    expect(r).toEqual({ id: 101, documento: 102 });
    expect(gravados.map((g) => g.tabela)).toEqual([
      'termo_consentimento_paciente',
      'documento_prontuario',
      'documento_prontuario_evento',
      'termo_consentimento_paciente',
    ]);
    expect(gravados[0]!.valores).toMatchObject({
      situacao_termo_consentimento_id: 60,
      procedimento_descricao: 'Cateterismo',
      profissional_id: 9,
    });
    expect(gravados[1]!.valores).toMatchObject({
      entidade_origem: 'termo_consentimento_paciente',
      entidade_origem_id: 101,
      tipo_documento_clinico_id: 50,
    });
    expect(JSON.parse(String(gravados[1]!.valores['conteudo']))).toEqual({
      hash_conteudo: 'abc',
      como_suporte: false,
    });
    expect(gravados[3]!.valores).toEqual({ documento_prontuario_id: 102, id: 101 });
  });

  it('emitir termo: atendimento de outro paciente é recusado; procedimento curto também', async () => {
    const { nucleo } = nucleoFalso([
      ...SESSAO,
      [/FROM atendimento WHERE id/, () => [{ id: 2, paciente_id: 99 }]],
    ]);
    const porta = new DocumentosPropriaExames(nucleo, 'teste');
    const e = {
      paciente: 1,
      atendimento: 2,
      tipo: null,
      procedimento: 'Cateterismo',
      cbo: null,
      hashConteudo: 'h',
    };
    await expect(porta.emitirTcle(G, e)).rejects.toMatchObject({
      problema: { codigo: 'atendimento-de-outro-paciente' },
    });
    await expect(porta.emitirTcle(G, { ...e, procedimento: 'x' })).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('mudar situação: revogar sem motivo é recusado antes de ler o banco', async () => {
    const { nucleo } = nucleoFalso([
      [
        /./,
        () => {
          throw new Error('não deveria ler');
        },
      ],
    ]);
    await expect(
      new DocumentosPropriaExames(nucleo, 'teste').mudarSituacaoTcle(G, {
        paciente: 1,
        versao: 4,
        situacao: 'revogado',
        motivo: 'curto',
      }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'motivo-obrigatorio' } });
  });

  it('mudar situação: versão já substituída é conflito; revogado não muda; assinar grava NOVA versão ligada', async () => {
    const termo = {
      id: 4,
      atendimento_id: 2,
      paciente_id: 1,
      termo_consentimento_modelo_id: null,
      procedimento_descricao: 'Cat',
      texto_simples: 'texto',
      emitido_em: new Date(),
      assinado_em: null,
      documento_prontuario_id: 9,
      etapa: 'emitido',
    };
    const montar = (sucessor: boolean, etapa = 'emitido') =>
      nucleoFalso([
        ...SESSAO,
        [/SELECT t\.\*, st\.etapa/, () => [{ ...termo, etapa }]],
        [/WHERE termo_anterior_id = \?/, () => (sucessor ? [{ id: 5 }] : [])],
        [/FROM situacao_termo_consentimento/, () => [{ id: 61 }]],
      ]);
    const m = { paciente: 1, versao: 4, situacao: 'assinado' as const, motivo: null };
    await expect(
      new DocumentosPropriaExames(montar(true).nucleo, 't').mudarSituacaoTcle(G, m),
    ).rejects.toMatchObject({
      problema: {
        codigo: 'conflito-versao',
      },
    });
    await expect(
      new DocumentosPropriaExames(montar(false, 'revogado').nucleo, 't').mudarSituacaoTcle(G, m),
    ).rejects.toMatchObject({ problema: { codigo: 'situacao-invalida' } });
    const { nucleo, gravados } = montar(false);
    const id = await new DocumentosPropriaExames(nucleo, 't').mudarSituacaoTcle(G, m);
    expect(id).toBe(101);
    expect(gravados).toHaveLength(1);
    expect(gravados[0]!.tabela).toBe('termo_consentimento_paciente');
    expect(gravados[0]!.valores).toMatchObject({
      termo_anterior_id: 4,
      situacao_termo_consentimento_id: 61,
      documento_prontuario_id: 9,
      revogado_em: null,
    });
    expect(gravados[0]!.valores['assinado_em']).toBeInstanceOf(Date);
  });
});

describe('teto das leituras do histórico: corta o antigo, nunca o recente', () => {
  it('pedidos, resultados, exames de fora e anexos buscam do mais recente para trás com o teto e devolvem em ordem crescente', async () => {
    const sqls: string[] = [];
    const linhas = (ids: number[]) => () =>
      ids.map((id) => ({ id, item: id, requisicao: 1, exame_id: 1, nome: 'X' }));
    const { nucleo } = nucleoFalso([
      [/FROM requisicao_exame r/, (sql) => (sqls.push(sql), linhas([3, 2])())],
      [/FROM resultado_exame re/, (sql) => (sqls.push(sql), linhas([3, 2])())],
      [/FROM exame_lancado_prontuario el/, (sql) => (sqls.push(sql), linhas([3, 2])())],
      [/FROM anexo_prontuario ap/, (sql) => (sqls.push(sql), linhas([3, 2])())],
    ]);
    const porta = new DocumentosPropriaExames(nucleo, 'teste', null, undefined, 2);
    expect((await porta.pedidos(C, 1)).map((x) => x.id)).toEqual([2, 3]);
    expect((await porta.resultados(C, 1)).map((x) => x.exame)).toEqual([2, 3]);
    expect((await porta.examesExternos(C, 1)).map((x) => x.id)).toEqual([2, 3]);
    expect((await porta.anexos(C, 1)).map((x) => x.id)).toEqual([2, 3]);
    expect(sqls).toHaveLength(4);
    for (const sql of sqls) expect(sql).toMatch(/ORDER BY \S+ DESC, \S+ DESC[^`]*LIMIT 2$/);
  });

  it('termos: a versão vigente de cada cadeia vem sempre (sem teto); o teto corta só as substituídas antigas', async () => {
    const sqls: string[] = [];
    const termo = (id: number, anterior: number | null, etapa: string) => ({
      id,
      termo_anterior_id: anterior,
      atendimento_id: 2,
      termo_consentimento_modelo_id: null,
      procedimento_descricao: 'Procedimento sintético',
      etapa,
      motivo_revogacao: etapa === 'revogado' ? 'Motivo sintético' : null,
      motivo_recusa: null,
      documento_prontuario_id: null,
      criado_em: new Date('2026-11-20T10:00:00Z'),
      login: 'medico',
    });
    const { nucleo } = nucleoFalso([
      [
        /FROM termo_consentimento_paciente t/,
        (sql) => (
          sqls.push(sql),
          /AND NOT EXISTS/.test(sql)
            ? [termo(9, 8, 'revogado'), termo(1, null, 'emitido')]
            : [termo(8, 7, 'assinado')]
        ),
      ],
    ]);
    const ts = await new DocumentosPropriaExames(nucleo, 'teste', null, undefined, 1).tcles(C, 1);
    expect(ts.map((t) => [t.id, t.situacao])).toEqual([
      [1, 'pendente'],
      [8, 'assinado'],
      [9, 'revogado'],
    ]);
    const vigentes = sqls.find((s) => /AND NOT EXISTS/.test(s))!;
    const substituidas = sqls.find((s) => !/AND NOT EXISTS/.test(s))!;
    expect(vigentes).not.toMatch(/LIMIT/);
    expect(substituidas).toMatch(/ORDER BY t\.id DESC LIMIT 1$/);
  });
});
