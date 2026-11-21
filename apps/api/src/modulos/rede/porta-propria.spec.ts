// Unidade da porta própria do MPI da Rede com um dublê do núcleo (sem banco): a lista de estabelecimentos (só os de
// código que cabe na chave do par), a recusa de outra rede e de outro estabelecimento antes de qualquer leitura, o
// contexto que vai ao Executor (cliente da porta, estabelecimento e usuário da trilha, chave de idempotência única) e a
// regra do banco único no serviço ("a mesma pessoa" e o desfazer: 409 unificar-no-cadastro, nada gravado).
import type { Executor, Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { ServicoMpiRede, type SessaoRede } from './aplicacao/servico.js';
import { PortaRedeMemoria } from './porta-memoria.js';
import { PortaRedePropria } from './porta-propria.js';

const REDE = 'rede-unidade';

function duble() {
  const leituras: string[] = [];
  const execucoes: { nome: string; cliente: string; entrada: unknown; contexto: Record<string, unknown> }[] = [];
  const leitor = {
    cliente: 'cliente_unidade',
    consultar: async (sql: string) => {
      leituras.push(sql);
      return /FROM estabelecimento/.test(sql)
        ? [
            { id: 1, codigo: 'hosp1', nome_fantasia: 'Hospital sintético 1' },
            { id: 2, codigo: 'hosp2', nome_fantasia: 'Hospital sintético 2' },
            { id: 3, codigo: 'CODIGO-FORA-DO-FORMATO', nome_fantasia: 'Fora' },
          ]
        : [];
    },
    uma: async () => null,
  } as unknown as Leitor;
  const executor = {
    executar: async (op: { nome: string }, cliente: string, entrada: unknown, contexto: Record<string, unknown>) => {
      execucoes.push({ nome: op.nome, cliente, entrada, contexto });
      return { resultado: {}, repetida: false, eventos: [], trilha: 1 };
    },
  } as unknown as Executor;
  const nucleo = {
    lerSomente: async <T>(_c: unknown, fn: (l: Leitor) => Promise<T>) => fn(leitor),
    criarExecutor: () => executor,
  };
  const avisos: string[] = [];
  const porta = new PortaRedePropria(nucleo, 'cliente_unidade', REDE, undefined, (m) => avisos.push(m));
  return { porta, leituras, execucoes, avisos };
}

describe('porta própria do MPI (dublê do núcleo)', () => {
  it('estabelecimentos: só os de código que cabe na chave do par; recusa outra rede e outro estabelecimento', async () => {
    const { porta, leituras, avisos } = duble();
    await porta.carregar();
    expect(porta.estabelecimentos().map((e) => e.codigo)).toEqual(['hosp1', 'hosp2']);
    // O de código fora do formato não some em silêncio: aviso no log (código e contagem, uma vez) e recusa explícita.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('1 estabelecimento(s) fora do MPI');
    expect(avisos[0]).toContain('CODIGO-FORA-DO-FORMATO');
    await porta.carregar();
    expect(avisos).toHaveLength(1);
    await expect(
      porta.cadastrosPorIds({ rede: REDE, hospital: 'CODIGO-FORA-DO-FORMATO' }, [1]),
    ).rejects.toMatchObject({ extras: { codigo: 'codigo-fora-do-formato' } });
    expect(porta.redeConfigurada()).toBe(REDE);
    const antes = leituras.length;
    await expect(porta.cadastrosPorIds({ rede: 'outra', hospital: 'hosp1' }, [1])).rejects.toMatchObject({
      tipo: 'sem-permissao',
    });
    await expect(porta.cadastrosPorIds({ rede: REDE, hospital: 'hosp9' }, [1])).rejects.toMatchObject({
      extras: { codigo: 'fora-da-rede' },
    });
    // Só a releitura da lista de estabelecimentos; nenhum cadastro lido.
    expect(leituras.slice(antes).every((s) => /FROM estabelecimento/.test(s))).toBe(true);
    expect(await porta.cadastrosPorIds({ rede: REDE, hospital: 'hosp1' }, [])).toEqual([]);
  });

  it('gravar: o contexto do Executor vem da trilha, com o cliente da porta e chave de idempotência única', async () => {
    const { porta, execucoes } = duble();
    await porta.carregar();
    const trilha = {
      estabelecimento: 1,
      usuario: 7,
      acao: 'operacao' as const,
      entidade: 'suspeita_duplicidade',
      entidadeId: null,
      dadosDepois: { evento: 'teste' },
      correlacao: 'correlacao-teste',
    };
    await expect(porta.gravar({ rede: REDE, hospital: 'hosp2' }, async () => 1, trilha)).rejects.toThrow(
      'sem resultado',
    );
    await expect(porta.gravar({ rede: REDE, hospital: 'hosp2' }, async () => 1, trilha)).rejects.toThrow();
    const [a, b] = execucoes;
    expect(a).toMatchObject({
      nome: 'rede.gravar-indice',
      cliente: 'cliente_unidade',
      entrada: { estabelecimento: 'hosp2' },
      contexto: { cliente: 'cliente_unidade', estabelecimento: 1, usuario: 7, correlacao: 'correlacao-teste' },
    });
    expect(a?.contexto['chaveIdempotencia']).not.toBe(b?.contexto['chaveIdempotencia']);
  });
});

describe('serviço sobre o banco único do cliente', () => {
  function montar() {
    const porta = Object.assign(
      new PortaRedeMemoria({
        rede: REDE,
        estabelecimentos: [
          { codigo: 'pc', nome: 'Estabelecimento sintético A' },
          { codigo: 'sx', nome: 'Estabelecimento sintético B' },
        ],
      }),
      { mesmaPessoaPorUnificacao: true },
    );
    const servico = new ServicoMpiRede(porta, { agora: () => new Date('2026-11-21T12:00:00.000Z') });
    const sessao: SessaoRede = {
      rede: REDE,
      hospital: 'pc',
      login: 'SINT.GESTOR',
      trilha: (evento, operacao) => ({
        estabelecimento: null,
        usuario: null,
        acao: 'operacao',
        entidade: 'suspeita_duplicidade',
        entidadeId: null,
        dadosDepois: { evento, operacao },
        correlacao: 'teste',
      }),
    };
    return { porta, servico, sessao };
  }

  it('o automático só põe o par na fila: nenhuma pessoa nem vínculo gravados, e o ciclo o conta na fila', async () => {
    const { porta, servico, sessao } = montar();
    const r = await servico.ciclo(sessao);
    expect(r.lidos).toBeGreaterThan(0);
    // O par de CPF igual (destino automático na massa sintética) não foi unido: conta em naFila, nunca em automaticos.
    expect(r).toMatchObject({ automaticos: 0, naFila: 4 });
    expect(porta.estado('pc')?.pessoas.size).toBe(0);
    expect(porta.estado('pc')?.vinculos.size).toBe(0);
    expect(porta.estado('sx')?.vinculos.size).toBe(0);
  });

  it('"mesma pessoa" e desfazer: 409 unificar-no-cadastro antes de qualquer gravação', async () => {
    const { porta, servico, sessao } = montar();
    await servico.ciclo(sessao);
    const fila = await servico.fila(sessao, { situacao: 'aberto', pagina: 1, porPagina: 20 } as never);
    const k = fila.itens[0]?.chave ?? '';
    expect(k).not.toBe('');
    const trilhas = porta.estado('pc')?.trilha.length ?? 0;
    await expect(servico.decidir(sessao, k, { decisao: 'mesma_pessoa' })).rejects.toMatchObject({
      extras: { codigo: 'unificar-no-cadastro' },
    });
    await expect(
      servico.desfazer(sessao, k, { justificativa: 'Desfazer de teste', reabrir: true }),
    ).rejects.toMatchObject({ extras: { codigo: 'unificar-no-cadastro' } });
    expect(porta.estado('pc')?.trilha.length).toBe(trilhas);
  });

  it('"outra pessoa": uma operação só (uma trilha), não uma por estabelecimento', async () => {
    const { porta, servico, sessao } = montar();
    await servico.ciclo(sessao);
    const fila = await servico.fila(sessao, { situacao: 'aberto', pagina: 1, porPagina: 20 } as never);
    const k = fila.itens[0]?.chave ?? '';
    const pc = porta.estado('pc')?.trilha.length ?? 0;
    const sx = porta.estado('sx')?.trilha.length ?? 0;
    const r = await servico.decidir(sessao, k, { decisao: 'outra_pessoa', justificativa: 'Pessoas diferentes (teste)' });
    expect(r.bancos.map((b) => b.situacao)).toEqual(['gravado', 'gravado']);
    expect((porta.estado('pc')?.trilha.length ?? 0) + (porta.estado('sx')?.trilha.length ?? 0)).toBe(pc + sx + 1);
  });

  it('divergência e reparo: vazio e zero, de forma explícita (nada a comparar no banco único)', async () => {
    const { servico, sessao } = montar();
    expect(await servico.divergencias(sessao)).toMatchObject({ total: 0, itens: [] });
    expect(await servico.reparar(sessao)).toEqual({ reparados: 0, pendentes: 0, manuais: [] });
  });

  it('aviso: o paciente atendido em outro estabelecimento, sem vínculo nenhum, é avisado', async () => {
    const { porta, servico, sessao } = montar();
    const chamadas: number[] = [];
    Object.assign(porta, {
      atendimentosNaRede: async (_c: unknown, id: number) => {
        chamadas.push(id);
        return [
          { estabelecimento: 'sx', idRemoto: id, atendimentos: 2, ultimoAtendimento: '2026-11-01', internacoes: 0, ultimaInternacao: null },
          { estabelecimento: 'fora', idRemoto: id, atendimentos: 9, ultimoAtendimento: '2026-11-02', internacoes: 0, ultimaInternacao: null },
        ];
      },
    });
    const a = await servico.avisoDoPaciente(sessao, 1, async () => ({ pode: false, motivo: 'regra não registrada' }));
    expect(chamadas).toEqual([1]);
    expect(a).toEqual({
      situacao: 'com-atendimentos',
      estabelecimentos: [
        {
          estabelecimento: 'sx',
          estabelecimentoNome: 'Estabelecimento sintético B',
          idRemoto: 1,
          disponivel: true,
          atendimentos: 2,
          ultimoAtendimento: '2026-11-01',
          internacoes: 0,
          ultimaInternacao: null,
          podeAbrir: false,
        },
      ],
      acessoCruzado: { pode: false, motivo: 'regra não registrada' },
    });
  });
});
