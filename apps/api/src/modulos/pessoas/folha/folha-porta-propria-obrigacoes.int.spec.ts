// Integração do gravador e das leituras próprias das férias e obrigações da folha (folha-porta-propria-obrigacoes.ts)
// contra o MariaDB real (cliente de teste, SGH_CLIENTE_TESTE), com a migração 15_RH/97_folha_obrigacoes: férias
// incluídas no período aquisitivo e marcadas calculadas pelo recibo ligado ao processamento; obrigação gravada com o
// arquivo no armazenamento (pasta temporária), relida, substituída, entregue e cancelada; catálogos oficiais.
// Massa SINTÉTICA (massa.spec-util e as linhas abaixo), apagada no fim (a trilha fica: só de acréscimo).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import {
  ArmazemArquivosLocal,
  criarPastaArquivosTeste,
  ErroOperacao,
  type PastaArquivosTeste,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  CLIENTE_O3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import { gravadorFolhaExecutor, TABELAS_FOLHA_EXECUTOR } from './folha-executor-proprio.js';
import { LeiturasCalculoFolhaPropria } from './folha-porta-propria-calculo.js';
import {
  gravadorFolhaObrigacoes,
  LeiturasObrigacoesFolhaPropria,
  TABELAS_FOLHA_OBRIGACOES,
} from './folha-porta-propria-obrigacoes.js';
import type { NovaObrigacaoDaFolha } from './tipos-folha.js';

const MARCA = 'TF24OB';
const trilha: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'obrigacao_trabalhista',
  entidadeId: null,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-folha-obrigacoes',
};
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
const totaisProcesso = {
  colaboradores: 1,
  proventos: 4000,
  descontos: 300,
  liquido: 3700,
  inss: 300,
  irrf: 0,
  fgts: 320,
  inssPatronal: 800,
  rat: 40,
  terceiros: 232,
};

describe.skipIf(SEM_BANCO_O3)(`férias e obrigações próprias da folha (cliente ${CLIENTE_O3})`, () => {
  let m: MassaPessoasO3;
  let pasta: PastaArquivosTeste;
  let arquivos: ArmazemArquivosLocal;
  let exec: ReturnType<MassaPessoasO3['nucleo']['criarExecutor']>;
  let leituras: LeiturasObrigacoesFolhaPropria;
  let calculo: LeiturasCalculoFolhaPropria;
  const ctx = (est?: number) => ({
    cliente: CLIENTE_O3,
    estabelecimento: est ?? m.est,
    usuario: m.usuario,
    correlacao: 'teste-folha-obrigacoes',
  });
  const gravar = <T>(
    fn: (
      g: ReturnType<typeof gravadorFolhaObrigacoes> & ReturnType<typeof gravadorFolhaExecutor>,
    ) => Promise<T>,
  ) =>
    gravacaoDireta(exec, ctx(), {
      nome: 'pessoas.calculo_folha.gravar',
      tabelas: [...TABELAS_FOLHA_EXECUTOR, ...TABELAS_FOLHA_OBRIGACOES],
      trilha,
      gravador: (tx, est) => ({
        ...gravadorFolhaExecutor(tx, est),
        ...gravadorFolhaObrigacoes(tx, est, { cliente: CLIENTE_O3, arquivos }),
      }),
      fn,
    });

  async function limpar() {
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-folha-obrigacoes' }, async (e) => {
      const est = [m.est];
      await e.executar(
        'DELETE f FROM obrigacao_fechamento f JOIN obrigacao_trabalhista o ON o.id = f.obrigacao_trabalhista_id WHERE o.estabelecimento_id = ?',
        est,
      );
      await e.executar(
        'DELETE a FROM arquivo_obrigacao a JOIN obrigacao_trabalhista o ON o.id = a.obrigacao_trabalhista_id WHERE o.estabelecimento_id = ?',
        est,
      );
      await e.executar('DELETE FROM obrigacao_trabalhista WHERE estabelecimento_id = ?', est);
      await e.executar(
        "DELETE FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'obrigacao_trabalhista'",
        est,
      );
      await e.executar('DELETE FROM recibo_ferias WHERE estabelecimento_id = ?', est);
      await e.executar('DELETE FROM programacao_ferias WHERE estabelecimento_id = ?', est);
      await e.executar('DELETE FROM periodo_aquisitivo WHERE estabelecimento_id = ?', est);
      await e.executar(
        "DELETE FROM periodo_aquisitivo WHERE estabelecimento_id = ? AND inicio = '2095-01-01'",
        [m.outro],
      );
      await e.executar(
        'DELETE l FROM processamento_folha_linha l JOIN processamento_folha p ON p.id = l.processamento_folha_id WHERE p.estabelecimento_id = ?',
        est,
      );
      await e.executar('DELETE FROM processamento_folha WHERE estabelecimento_id = ?', est);
      await e.executar('DELETE FROM fechamento_periodo_folha WHERE estabelecimento_id = ?', est);
      await e.executar(
        'DELETE c FROM codigo_esocial c JOIN tabela_esocial t ON t.id = c.tabela_esocial_id WHERE t.versao_fonte LIKE ?',
        [`${MARCA}%`],
      );
      await e.executar('DELETE FROM tabela_esocial WHERE versao_fonte LIKE ?', [`${MARCA}%`]);
    });
  }

  beforeAll(async () => {
    m = await prepararMassaO3('F24O');
    pasta = await criarPastaArquivosTeste(CLIENTE_O3);
    arquivos = new ArmazemArquivosLocal({
      raiz: pasta.raiz,
      executor: m.nucleo.criarExecutor(),
      ler: (c, fn) => m.nucleo.lerSomente(c, fn),
      bancoDoCliente: async (c) => (await m.nucleo.cliente(c)).banco,
    });
    exec = m.nucleo.criarExecutor();
    leituras = new LeiturasObrigacoesFolhaPropria(m.nucleo, arquivos);
    calculo = new LeiturasCalculoFolhaPropria(m.nucleo);
    await limpar();
  });
  afterAll(async () => {
    if (m) {
      await limpar();
      await encerrarMassaO3(m);
    }
    await pasta?.apagar();
  });

  it('férias: inclui no período aquisitivo, marca calculada com o recibo do processamento e recusa a quarta fração', async () => {
    const nova = {
      vinculo: m.vinculo,
      empresa: m.est,
      aquisitivoInicio: '2096-01-01',
      aquisitivoFim: '2096-12-31',
      faltas: 7,
      direito: 24,
      dias: 5,
      abono: 0,
      dobra: 0,
      adiantarDecimo: false,
    };
    const ids = await gravar(async (g) => [
      // CLT art. 134, § 1º: uma fração de 14 dias e as outras de 5, dentro dos 24 de direito (7 faltas, art. 130).
      await g.incluirFerias({
        ...nova,
        dias: 14,
        inicio: '2097-02-01',
        fim: '2097-02-14',
        pagamento: '2097-01-30',
        por: m.login,
      }),
      await g.incluirFerias({
        ...nova,
        inicio: '2097-05-01',
        fim: '2097-05-05',
        pagamento: '2097-04-29',
        por: m.login,
      }),
      await g.incluirFerias({
        ...nova,
        inicio: '2097-08-01',
        fim: '2097-08-05',
        pagamento: '2097-07-30',
        por: m.login,
      }),
    ]);
    expect(ids).toHaveLength(3);
    // Um só período, do VÍNCULO (CLT art. 130), com as faltas e os dias de direito da escala que o domínio calculou.
    const periodos = await m.nucleo.lerSomente(ctx(), (l) =>
      l.consultar(
        `SELECT vinculo_trabalho_id, faltas_injustificadas, dias_direito, dias_saldo FROM periodo_aquisitivo
          WHERE estabelecimento_id = ? AND inicio = '2096-01-01'`,
        [m.est],
      ),
    );
    expect(periodos.map((r) => Object.values(r).map(Number))).toEqual([[m.vinculo, 7, 24, 24]]);
    // O gravador não aceita o que a CLT não admite: direito fora da escala do art. 130, faltas e direito diferentes
    // dos do período gravado, frações além do direito ou sem lugar para a de 14 dias (nada é gravado).
    const outra = { ...nova, inicio: '2097-11-01', fim: '2097-11-05', pagamento: '2097-10-30', por: m.login };
    expect(
      await codigo(
        gravar((g) =>
          g.incluirFerias({
            ...outra,
            aquisitivoInicio: '2095-01-01',
            aquisitivoFim: '2095-12-31',
            direito: 30,
          }),
        ),
      ),
    ).toBe('periodo-direito-incoerente');
    expect(await codigo(gravar((g) => g.incluirFerias({ ...outra, faltas: 0, direito: 30 })))).toBe(
      'periodo-aquisitivo-divergente',
    );
    expect(
      await codigo(
        gravar((g) =>
          g.incluirFerias({
            ...outra,
            aquisitivoInicio: '2095-01-01',
            aquisitivoFim: '2095-12-31',
            dias: 12,
            fim: '2097-11-12',
          }),
        ),
      ),
    ).toBe('fracao-quatorze');
    expect(
      await codigo(
        gravar((g) =>
          g.incluirFerias({
            ...nova,
            inicio: '2097-10-01',
            fim: '2097-10-10',
            pagamento: '2097-09-29',
            por: m.login,
          }),
        ),
      ),
    ).toBe('ferias-fracoes-esgotadas');
    const lida = await calculo.feriasPorId(ctx(), ids[0]!);
    expect(lida).toMatchObject({
      vinculo: m.vinculo,
      empresa: m.est,
      aquisitivoInicio: '2096-01-01',
      aquisitivoFim: '2096-12-31',
      inicio: '2097-02-01',
      dias: 14,
      pagamento: '2097-01-30',
      situacao: 'programada',
      processo: null,
      registradoPor: m.login,
    });
    const processo = await gravar(async (g) => {
      const antes = await g.emVigorComTrava(m.est, '2097-02', 'ferias');
      const id = await g.incluirProcesso({
        empresa: m.est,
        competencia: '2097-02',
        tipo: 'ferias',
        pagamento: '2097-01-30',
        numero: antes.proximoNumero,
        totais: totaisProcesso,
        foraDaFolha: 0,
        tabelaLegal: '2097-01-01',
        parametros: '',
        resumo: 'b'.repeat(64),
        por: m.login,
      });
      await g.situacaoFerias({
        id: ids[0]!,
        versao: lida!.versao,
        de: 'programada',
        para: 'calculada',
        processo: id,
        motivo: null,
        por: m.login,
      });
      return id;
    });
    const calculada = await calculo.feriasPorId(ctx(), ids[0]!);
    expect(calculada).toMatchObject({ situacao: 'calculada', processo, situacaoPor: m.login });
    const recibos = async () =>
      m.nucleo.lerSomente(ctx(), async (l) => {
        const r = await l.uma(
          `SELECT SUM(situacao <> 'cancelado') AS vivos, SUM(situacao = 'cancelado') AS cancelados
             FROM recibo_ferias WHERE programacao_ferias_id = ?`,
          [ids[0]!],
        );
        return { vivos: Number(r?.['vivos'] ?? 0), cancelados: Number(r?.['cancelados'] ?? 0) };
      });
    expect(await recibos()).toEqual({ vivos: 1, cancelados: 0 });
    // Voltar a programar cancela o recibo; recalcular deixa um só recibo vivo.
    await gravar((g) =>
      g.situacaoFerias({
        id: ids[0]!,
        versao: calculada!.versao,
        de: 'calculada',
        para: 'programada',
        motivo: null,
        por: m.login,
      }),
    );
    expect(await recibos()).toEqual({ vivos: 0, cancelados: 1 });
    const reprogramada = await calculo.feriasPorId(ctx(), ids[0]!);
    await gravar((g) =>
      g.situacaoFerias({
        id: ids[0]!,
        versao: reprogramada!.versao,
        de: 'programada',
        para: 'calculada',
        processo,
        motivo: null,
        por: m.login,
      }),
    );
    expect(await recibos()).toEqual({ vivos: 1, cancelados: 1 });
    // Recibo conferido: as férias não se cancelam.
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'recibo-conferido' }, (e) =>
      e.executar(
        "UPDATE recibo_ferias SET situacao = 'conferido' WHERE programacao_ferias_id = ? AND situacao = 'calculado'",
        [ids[0]!],
      ),
    );
    const recalculada = await calculo.feriasPorId(ctx(), ids[0]!);
    expect(
      await codigo(
        gravar((g) =>
          g.situacaoFerias({
            id: ids[0]!,
            versao: recalculada!.versao,
            de: 'calculada',
            para: 'cancelada',
            motivo: 'teste',
            por: m.login,
          }),
        ),
      ),
    ).toBe('recibo-ferias-conferido');
    expect(await calculo.feriasPorId(ctx(), ids[0]!)).toMatchObject({ situacao: 'calculada' });
    // O período é do vínculo: o mesmo início com outro fim no MESMO vínculo recusa (nunca dois períodos por contrato).
    expect(
      await codigo(
        gravar((g) =>
          g.incluirFerias({
            ...nova,
            aquisitivoFim: '2096-12-30',
            inicio: '2097-11-01',
            fim: '2097-11-10',
            pagamento: '2097-10-30',
            por: m.login,
          }),
        ),
      ),
    ).toBe('periodo-aquisitivo-divergente');
    // A versão lida antes não vale mais.
    expect(
      await codigo(
        gravar((g) =>
          g.situacaoFerias({
            id: ids[0]!,
            versao: lida!.versao,
            de: 'programada',
            para: 'calculada',
            processo,
            motivo: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('desatualizado');
    // Cancelar a segunda fração grava o motivo; a vaga volta para uma fração nova.
    const segunda = await calculo.feriasPorId(ctx(), ids[1]!);
    await gravar((g) =>
      g.situacaoFerias({
        id: ids[1]!,
        versao: segunda!.versao,
        de: 'programada',
        para: 'cancelada',
        motivo: 'pedido do colaborador',
        por: m.login,
      }),
    );
    expect(await calculo.feriasPorId(ctx(), ids[1]!)).toMatchObject({
      situacao: 'cancelada',
      motivo: 'pedido do colaborador',
    });
    // A vaga volta, mas a fração ainda cabe no direito: 14 + 5 + 10 passa dos 24 dias; 14 + 5 + 5 cabe.
    const vaga = { ...nova, inicio: '2097-10-01', pagamento: '2097-09-29', por: m.login };
    expect(await codigo(gravar((g) => g.incluirFerias({ ...vaga, dias: 10, fim: '2097-10-10' })))).toBe(
      'ferias-acima-do-direito',
    );
    expect(await codigo(gravar((g) => g.incluirFerias({ ...vaga, fim: '2097-10-05' })))).toBe('ok');
  });

  it('obrigação: grava o arquivo, relê, numera, substitui, entrega e cancela pela versão', async () => {
    const base: NovaObrigacaoDaFolha = {
      empresa: m.est,
      tipo: 'fgts-digital',
      periodo: '2097-03',
      numero: 1,
      leiaute: '1.0',
      leiauteConferido: true,
      nomeArquivo: 'fgts-2097-03.txt',
      conteudoCifrado: `conteudo-cifrado-${MARCA}-1`,
      tamanho: 1234,
      resumo: 'c'.repeat(64),
      totais: {
        trabalhadores: 1,
        remuneracao: 4000,
        remuneracaoDecimo: 0,
        baseFgts: 4000,
        fgts: 320,
        rescisorio: 0,
        admissoes: 0,
        desligamentos: 0,
      },
      fechamentos: [],
      por: m.login,
    };
    const r = await gravar(async (g) => {
      const antes = await g.obrigacoesEmVigorComTrava(m.est, 'fgts-digital', '2097-03');
      const id = await g.incluirObrigacao({ ...base, numero: antes.proximoNumero });
      return { antes, id, depois: await g.obrigacoesEmVigorComTrava(m.est, 'fgts-digital', '2097-03') };
    });
    expect(r.antes).toEqual({ vigentes: [], proximoNumero: 1 });
    expect(r.depois.proximoNumero).toBe(2);
    expect(r.depois.vigentes.map((x) => x.id)).toEqual([r.id]);
    const lida = await leituras.obrigacao(ctx(), r.id);
    expect(lida).toMatchObject({
      id: r.id,
      empresa: m.est,
      tipo: 'fgts-digital',
      periodo: '2097-03',
      numero: 1,
      situacao: 'gerada',
      leiaute: '1.0',
      leiauteConferido: true,
      nomeArquivo: 'fgts-2097-03.txt',
      tamanho: 1234,
      resumo: 'c'.repeat(64),
      totais: base.totais,
      fechamentos: [],
      geradoPor: m.login,
      protocolo: null,
      situacaoPor: null,
    });
    expect(await leituras.conteudoObrigacao(ctx(), r.id)).toBe(base.conteudoCifrado);
    // Número repetido recusa (a concorrência que chegou antes).
    expect(await codigo(gravar((g) => g.incluirObrigacao(base)))).toBe('desatualizado');
    // Substitui a 1 pela 2 e entrega a 2.
    const id2 = await gravar(async (g) => {
      await g.substituirObrigacao({ id: r.id, versao: lida!.versao, por: m.login });
      return g.incluirObrigacao({ ...base, numero: 2, conteudoCifrado: `conteudo-cifrado-${MARCA}-2` });
    });
    const v2 = (await leituras.obrigacao(ctx(), id2))!;
    expect(v2.numero).toBe(2);
    await gravar((g) =>
      g.registrarEntregaObrigacao({
        id: id2,
        versao: v2.versao,
        protocolo: 'PROT-1',
        data: '2097-04-15',
        valorGuia: 320,
        acrescimos: 1.5,
        por: m.login,
      }),
    );
    expect(await leituras.obrigacao(ctx(), r.id)).toMatchObject({
      situacao: 'substituida',
      situacaoPor: m.login,
    });
    const entregue = (await leituras.obrigacao(ctx(), id2))!;
    expect(entregue).toMatchObject({
      situacao: 'entregue',
      protocolo: 'PROT-1',
      entregueEm: '2097-04-15',
      valorGuia: 320,
      acrescimos: 1.5,
      entreguePor: m.login,
    });
    expect(entregue.entregaRegistrada).not.toBeNull();
    // Entregue não se cancela.
    expect(
      await codigo(
        gravar((g) => g.cancelarObrigacao({ id: id2, versao: entregue.versao, motivo: 'x', por: m.login })),
      ),
    ).toBe('desatualizado');
    // RAIS (encerrada no catálogo oficial): o gravador recusa e nada é gravado; fica só o histórico das já gravadas.
    expect(
      await codigo(
        gravar((g) =>
          g.incluirObrigacao({
            ...base,
            tipo: 'rais',
            periodo: '2096',
            nomeArquivo: 'rais-2096.txt',
            conteudoCifrado: `conteudo-cifrado-${MARCA}-rais`,
          }),
        ),
      ),
    ).toBe('obrigacao-encerrada');
    // Outra competência: grava e cancela com motivo.
    const rais = await gravar((g) =>
      g.incluirObrigacao({
        ...base,
        periodo: '2096-06',
        nomeArquivo: 'fgts-2096-06.txt',
        conteudoCifrado: `conteudo-cifrado-${MARCA}-2096`,
      }),
    );
    const lidaRais = (await leituras.obrigacao(ctx(), rais))!;
    expect(lidaRais).toMatchObject({ tipo: 'fgts-digital', periodo: '2096-06', numero: 1 });
    await gravar((g) =>
      g.cancelarObrigacao({ id: rais, versao: lidaRais.versao, motivo: 'gerada por engano', por: m.login }),
    );
    expect(await leituras.obrigacao(ctx(), rais)).toMatchObject({
      situacao: 'cancelada',
      motivo: 'gerada por engano',
    });
    // Filtros e ordem: período mais recente primeiro; o ano; a situação; outra empresa não vê.
    expect((await leituras.obrigacoes(ctx(), {})).map((x) => x.id)).toEqual([id2, r.id, rais]);
    expect((await leituras.obrigacoes(ctx(), { ano: '2096' })).map((x) => x.id)).toEqual([rais]);
    expect((await leituras.obrigacoes(ctx(), { situacoes: ['entregue'] })).map((x) => x.id)).toEqual([id2]);
    expect(await leituras.obrigacoes(ctx(), { empresa: m.outro })).toEqual([]);
    expect(await leituras.obrigacao(ctx(m.outro), r.id)).toBeNull();
    expect(await leituras.conteudoObrigacao(ctx(m.outro), r.id)).toBeNull();
  });

  it('catálogo oficial das obrigações: a edição versionada, sem depender de carga no banco (nunca catalogo-pendente)', async () => {
    const c = await leituras.catalogosObrigacoes(ctx(), '2026-11-24');
    expect(c.edicao).toBe('2026-11');
    const situacao = Object.fromEntries(c.obrigacoes.map((o) => [o.codigo, o.situacao]));
    expect(situacao).toEqual({
      esocial: 'vigente',
      'efd-reinf': 'vigente',
      dctfweb: 'vigente',
      'fgts-digital': 'vigente',
      sefip: 'encerrada',
      caged: 'encerrada',
      rais: 'encerrada',
    });
  });
});
