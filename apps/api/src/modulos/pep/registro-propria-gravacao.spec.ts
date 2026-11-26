// Unidade da gravação do registro clínico no banco próprio: ordem hierárquica dos campos, definição do formulário
// (lida pelo conversor do domínio), ida e volta linha ↔ resposta tipada, data local ↔ UTC, versão do rascunho e as
// recusas antes de abrir transação. Sem banco.
import { converterModelo } from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type CampoDoModelo,
  type CampoOrdenado,
  camposDoModelo,
  conteudoDoRegistro,
  DESLOCAMENTO_OPCAO,
  lancamentosDosRascunhos,
  marcasDeSuporte,
  OP_REGISTRAR,
  OP_SALVAR_RASCUNHO,
  OP_SUSPENDER,
  definicaoDosCampos,
  linhasDasRespostas,
  linhasDoRascunho,
  localParaUtc,
  ordenarCampos,
  RegistroPropriaGravacao,
  respostaDaLinha,
  temValor,
  versaoDoRascunho,
} from './registro-propria-gravacao.js';
import type { LinhaGravacao } from './tipos-pep.js';

const campo = (
  id: number,
  sequencia: number,
  tipo: string,
  extra: Partial<CampoDoModelo> = {},
): CampoDoModelo => ({
  id,
  versao: 1,
  sequencia,
  pai: null,
  titulo: `Campo ${id}`,
  tipo,
  obrigatorio: false,
  opcoes: [],
  ...extra,
});

const CAMPOS = ordenarCampos([
  campo(10, 1, 'secao', { titulo: 'Evolução' }),
  campo(11, 2, 'texto', { pai: 10, obrigatorio: true }),
  campo(12, 3, 'escolha', {
    pai: 10,
    opcoes: [
      { id: 501, rotulo: 'Leve' },
      { id: 502, rotulo: 'Grave' },
    ],
  }),
  campo(13, 4, 'multipla', {
    pai: 10,
    opcoes: [
      { id: 601, rotulo: 'Oral' },
      { id: 602, rotulo: 'Enteral' },
    ],
  }),
  campo(14, 5, 'decimal', { pai: 10 }),
  campo(15, 6, 'data', { pai: 10 }),
  campo(16, 7, 'hora', { pai: 10 }),
  campo(17, 8, 'booleano', { pai: 10 }),
  campo(18, 9, 'texto'),
]);
const PELA_ORDEM = new Map(CAMPOS.map((c) => [c.ordem as string, c] as const));
const PELO_ID = new Map<number, CampoOrdenado>(CAMPOS.map((c) => [c.id, c] as const));

const linha = (ordem: string, v: Partial<LinhaGravacao> = {}): LinhaGravacao =>
  ({
    ordem,
    seq: 0,
    idResposta: 1,
    data: null,
    hora: null,
    indice: null,
    valor: null,
    alfa: null,
    texto: null,
    unidade: '',
    cid: null,
    ...v,
  }) as LinhaGravacao;

describe('ordem hierárquica dos campos', () => {
  it('dois dígitos por nível, pelo pai e pela sequência', () => {
    expect(CAMPOS.map((c) => [c.id, c.ordem])).toEqual([
      [10, '01'],
      [11, '0101'],
      [12, '0102'],
      [13, '0103'],
      [14, '0104'],
      [15, '0105'],
      [16, '0106'],
      [17, '0107'],
      [18, '02'],
    ]);
  });
  it('pai fora da versão vira raiz; ciclo fica sem ordem; mais de 99 por nível fica sem ordem', () => {
    const o = ordenarCampos([
      campo(1, 1, 'texto', { pai: 999 }),
      campo(2, 2, 'texto', { pai: 3 }),
      campo(3, 3, 'texto', { pai: 2 }),
    ]);
    expect(o.find((c) => c.id === 1)?.ordem).toBe('01');
    expect(o.find((c) => c.id === 2)?.ordem).toBeNull();
    const muitos = ordenarCampos(Array.from({ length: 100 }, (_, i) => campo(i + 1, i + 1, 'texto')));
    expect(muitos.filter((c) => c.ordem === null).map((c) => c.id)).toEqual([100]);
  });
});

describe('definição do formulário', () => {
  const def = definicaoDosCampos({ id: 7, codigo: 'EVOL', titulo: 'Evolução' }, CAMPOS, 3);
  it('um componente e um vínculo por campo, na ordem, com a versão publicada', () => {
    expect(def.vinculos.map((v) => v.ordem)).toEqual(CAMPOS.map((c) => c.ordem));
    expect(def.componentes).toHaveLength(CAMPOS.length);
    expect(def.versoes).toEqual([{ versao: 3, componentes: CAMPOS.length }]);
    expect(def.vinculos.find((v) => v.id === 11)?.obrigatorio).toBe('T');
    // A escolha múltipla tem uma resposta por opção, com o deslocamento (nunca colide com o id de um campo).
    expect(def.respostas.filter((r) => r.idPergunta === 12).map((r) => r.id)).toEqual([
      DESLOCAMENTO_OPCAO + 501,
      DESLOCAMENTO_OPCAO + 502,
    ]);
    expect(def.respostas.filter((r) => r.idPergunta === 13).map((r) => r.id)).toEqual([
      DESLOCAMENTO_OPCAO + 601,
      DESLOCAMENTO_OPCAO + 602,
    ]);
  });
  it('o conversor do domínio lê a definição sem pendência de componente', async () => {
    const r = await converterModelo(def);
    expect(r.itens.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.itens)).toContain('Campo 11');
    // As escolhas resolvem todas as opções pelo id da resposta (sem pendência de escolha).
    expect(r.pendencias.filter((x) => x.tipo === 'escolha')).toEqual([]);
  });
});

describe('linha ↔ resposta tipada (ida e volta)', () => {
  const linhas: LinhaGravacao[] = [
    linha('0101', { idResposta: 11, texto: '{\\rtf1 quadro}' }),
    linha('0102', { idResposta: DESLOCAMENTO_OPCAO + 502, indice: '2', alfa: 'complemento' }),
    linha('0102', { idResposta: 12, seq: 1, alfa: 'texto livre' }),
    linha('0103', { idResposta: DESLOCAMENTO_OPCAO + 602, indice: '1', alfa: 'Enteral' }),
    linha('0104', { idResposta: 14, valor: 80.5, unidade: 'bpm' }),
    linha('0105', { idResposta: 15, data: '2026-11-20' }),
    linha('0106', { idResposta: 16, hora: '0930' }),
    linha('0107', { idResposta: 17, indice: '2' }),
    linha('02', { idResposta: 18, cid: 'J18.9' }),
  ];
  const tipadas = linhas.map((l) => respostaDaLinha(l, PELA_ORDEM));
  it('cada linha na coluna do tipo', () => {
    expect(tipadas.map((t) => t.tipo_valor)).toEqual([
      'texto',
      'opcao',
      'texto',
      'opcao',
      'numero',
      'data',
      'hora',
      'booleano',
      'cid',
    ]);
    expect(tipadas[1]?.modelo_campo_opcao_id).toBe(502);
    expect(tipadas[3]?.modelo_campo_opcao_id).toBe(602);
    expect(tipadas[6]?.valor_hora).toBe('09:30:00');
    expect(tipadas[7]?.valor_booleano).toBe(true);
    expect(tipadas[8]?.codigo_cid10).toBe('J189');
    // Sem o id da opção, pela posição: escolha a partir de 1, múltipla a partir de 0.
    expect(
      respostaDaLinha(linha('0102', { idResposta: 12, indice: '1' }), PELA_ORDEM).modelo_campo_opcao_id,
    ).toBe(501);
    expect(
      respostaDaLinha(linha('0103', { idResposta: 13, indice: '0' }), PELA_ORDEM).modelo_campo_opcao_id,
    ).toBe(601);
  });
  it('a leitura devolve as mesmas linhas', () => {
    const lidas = linhasDasRespostas(
      tipadas.map((t) => ({
        ...t,
        valor_booleano: t.valor_booleano === null ? null : Number(t.valor_booleano),
      })),
      PELO_ID,
    );
    const chave = (l: object) => {
      const x = l as Record<string, unknown>;
      return ['ordem', 'seq', 'idResposta', 'data', 'hora', 'indice', 'valor', 'alfa', 'texto', 'cid'].map(
        (k) => x[k],
      );
    };
    expect(lidas.map(chave)).toEqual(linhas.map(chave));
  });
  it('recusa a linha fora da versão publicada e a opção de outro campo', () => {
    expect(() => respostaDaLinha(linha('09', { texto: 'x' }), PELA_ORDEM)).toThrow(ErroOperacao);
    expect(() =>
      respostaDaLinha(linha('0103', { idResposta: DESLOCAMENTO_OPCAO + 501 }), PELA_ORDEM),
    ).toThrow(/opção marcada/);
    expect(() => respostaDaLinha(linha('0102', { indice: '9' }), PELA_ORDEM)).toThrow(/opção escolhida/);
    expect(() =>
      respostaDaLinha(linha('0102', { idResposta: DESLOCAMENTO_OPCAO + 601, indice: '1' }), PELA_ORDEM),
    ).toThrow(/opção escolhida/);
  });
  it('linha de título sem valor não vira resposta', () => {
    expect(temValor(linha('01'))).toBe(false);
    expect(temValor(linha('0101', { texto: 'a' }))).toBe(true);
  });
});

describe('datas, versão do rascunho e linhas guardadas', () => {
  it('hora civil de São Paulo → UTC (+3h), sem depender do TZ da máquina', () => {
    expect(localParaUtc('2026-11-20T09:30', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-11-20T12:30:00.000Z',
    );
    expect(() => localParaUtc('2026-13-45T99:99', 'America/Sao_Paulo')).toThrow(ErroOperacao);
  });
  it('a versão do rascunho muda com a versão da linha', () => {
    expect(versaoDoRascunho(5, 1)).toHaveLength(32);
    expect(versaoDoRascunho(5, 1)).not.toBe(versaoDoRascunho(5, 2));
  });
  it('linhas do rascunho: texto JSON ou objeto; outra coisa vira lista vazia', () => {
    expect(linhasDoRascunho('[{"ordem":"01"}]')).toEqual([{ ordem: '01' }]);
    expect(linhasDoRascunho({ a: 1 })).toEqual([]);
  });
});

describe('recusas antes da transação', () => {
  const nucleo = {
    lerSomente: async () => {
      throw new Error('não deveria ler');
    },
    criarExecutor: () => {
      throw new Error('não deveria gravar');
    },
  } as unknown as ConstructorParameters<typeof RegistroPropriaGravacao>[0];
  const g = new RegistroPropriaGravacao(nucleo, 'teste');
  const c = {
    rede: 'r',
    hospital: 'h',
    cliente: 'teste',
    estabelecimento: null,
    usuario: 1,
    correlacao: 'x',
  };
  const ctx = {
    cliente: 'teste',
    estabelecimento: null,
    usuario: 1,
    correlacao: 'x',
    chaveIdempotencia: 'k',
  };
  it('suspender sem reautenticação: 401', async () => {
    await expect(
      g.suspender(
        c as never,
        { registro: 1, cbo: 1, justificativa: 'x'.repeat(12), documento: 'y'.repeat(12) },
        ctx,
      ),
    ).rejects.toMatchObject({ problema: { status: 401, codigo: 'reautenticacao-necessaria' } });
  });
  // A coassinatura e o parecer gravam no banco próprio (L96, C2-076 daef9582; contrato de efeito no .int.spec); só a
  // classificação de risco segue fechada com 501 (grava pela recepção).
  it('registro com classificação de risco: 501 fechado', async () => {
    await expect(
      g.registrar(c as never, { classificacao: { cor: 'vermelho' } } as never, ctx),
    ).rejects.toMatchObject({ problema: { status: 501, codigo: 'pendente-modelo-proprio' } });
  });
  it('rascunhos de lista vazia de profissionais: nada lido', async () => {
    await expect(g.rascunhosDoProfissional(c as never, [])).resolves.toEqual([]);
  });
  it('a leitura usa o cliente da sessão e a correlação do método', async () => {
    const vistos: string[] = [];
    const n = {
      lerSomente: async (
        ctx2: { cliente: string; correlacao: string },
        fn: (l: Leitor) => Promise<unknown>,
      ) => {
        vistos.push(`${ctx2.cliente}:${ctx2.correlacao}`);
        return fn({ uma: async () => null, consultar: async () => [] } as unknown as Leitor);
      },
      criarExecutor: () => null,
    } as unknown as ConstructorParameters<typeof RegistroPropriaGravacao>[0];
    await expect(
      new RegistroPropriaGravacao(n, 'padrao').profissional({ ...c, cliente: '' } as never, 'x'),
    ).rejects.toMatchObject({
      problema: { codigo: 'estabelecimento-inexistente' },
    });
    expect(vistos).toEqual(['padrao:pep.registro.profissional']);
  });
});

describe('correções do revisor: suporte, leitura do modelo, lançamento e idempotência', () => {
  const t = (operacao: string, dados: Record<string, unknown> | null, origem: unknown = null) => ({
    entidadeId: 1,
    operacao,
    dados,
    origem,
  });
  it('marcas de suporte técnico como a memória: criado e suspenso, pela marca do serviço ou pela origem "como"', () => {
    expect(
      marcasDeSuporte([t(OP_REGISTRAR, { comoSuporte: false }), t(OP_SUSPENDER, { comoSuporte: false })]),
    ).toEqual([]);
    expect(
      marcasDeSuporte([t(OP_REGISTRAR, { comoSuporte: true }), t(OP_SUSPENDER, null, { sessao: 's' })]),
    ).toEqual(['criado', 'suspenso']);
    expect(
      marcasDeSuporte([t(OP_REGISTRAR, { comoSuporte: false }), t(OP_SUSPENDER, { comoSuporte: true })]),
    ).toEqual(['suspenso']);
  });
  it('leitura do modelo sem filtro de campo excluído nem de opção inativa; preenchimento com os filtros', async () => {
    const sqls: string[] = [];
    const l = { consultar: async (sql: string) => (sqls.push(sql), []) } as unknown as Leitor;
    await camposDoModelo(l, 1);
    await camposDoModelo(l, 1, true);
    expect(sqls[0]).toContain('c.excluido_em IS NULL');
    expect(sqls[1]).toContain('o.ativo = TRUE');
    expect(sqls[2]).not.toContain('excluido_em IS NULL');
    expect(sqls[3]).not.toContain('ativo = TRUE');
  });
  it('lançamento do rascunho: o primeiro gravado na trilha de cada salvamento', async () => {
    const l = {
      consultar: async () => [
        {
          entidade_id: 7,
          operacao: OP_SALVAR_RASCUNHO,
          dados: '{"lancadoEm":"2026-11-20T12:00:00.000Z"}',
          origem: null,
        },
        { entidade_id: 7, operacao: OP_SALVAR_RASCUNHO, dados: { lancadoEm: 'depois' }, origem: null },
        { entidade_id: 8, operacao: OP_SALVAR_RASCUNHO, dados: { anterior: 7 }, origem: null },
      ],
    } as unknown as Leitor;
    const m = await lancamentosDosRascunhos(l, 1, [7, 8]);
    expect([...m]).toEqual([[7, '2026-11-20T12:00:00.000Z']]);
  });
  it('idempotência: o conteúdo entra na entrada (a mesma chave com outro conteúdo diverge)', async () => {
    const entradas: unknown[] = [];
    const n = {
      lerSomente: async (_c: unknown, fn: (l: Leitor) => Promise<unknown>) =>
        fn({
          uma: async () => ({ id: 1, fuso_horario: 'America/Sao_Paulo', nome_fantasia: null }),
        } as unknown as Leitor),
      criarExecutor: () => ({
        executar: async (_op: unknown, _cl: string, entrada: unknown) => {
          entradas.push(entrada);
          return { resultado: { valor: { registro: 1, trilha: null } } };
        },
      }),
    } as unknown as ConstructorParameters<typeof RegistroPropriaGravacao>[0];
    const g = new RegistroPropriaGravacao(n, 'teste');
    const c = {
      rede: 'r',
      hospital: 'h',
      cliente: 'teste',
      estabelecimento: null,
      usuario: 1,
      correlacao: 'x',
    };
    const ctx = {
      cliente: 'teste',
      estabelecimento: null,
      usuario: 1,
      correlacao: 'x',
      chaveIdempotencia: 'k',
    };
    const e = {
      paciente: 1,
      atendimento: 2,
      modelo: 3,
      cbo: 4,
      dataHoraClinica: '2026-11-20T09:30',
      linhas: [],
    };
    await g.registrar(c as never, e as never, ctx);
    await g.registrar(c as never, { ...e, paciente: 9 } as never, ctx);
    expect(entradas).toHaveLength(2);
    expect(entradas[0]).toMatchObject({ chave: 'k', conteudo: { paciente: 1 } });
    expect(entradas[1]).toMatchObject({ chave: 'k', conteudo: { paciente: 9 } });
    expect(conteudoDoRegistro(e as never)).not.toEqual(
      conteudoDoRegistro({ ...e, linhas: [{ ordem: '01' }] } as never),
    );
  });
});
