// Integração da fonte própria do M12 contra o MariaDB real (cliente f22_o2, já criado pela obra da onda 2). Massa
// SINTÉTICA com códigos "L0212P" (nenhum dado real). Contrato de efeito de cada gravação: linhas, versão, retrato do
// nome e trilha; e as recusas (sem efeito, conflito de versão, campo que o modelo ainda não tem, operação ainda não
// liberada, plano de outro estabelecimento). No fim, a massa de negócio é apagada; ficam o estabelecimento, o usuário e
// os cadastros da rede que a trilha (só inclusão) referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoGravacaoPreco, CtxPrecos, TrilhaPreco } from './fonte.js';
import { FontePrecosPropria } from './fonte-propria.js';
import { ErroPlano } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0212P';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo']);
    if (e instanceof ErroPlano) return e.codigo;
    return String(e);
  }
}

describe.skipIf(SEM_BANCO)('fonte própria de preços (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let fonte: FontePrecosPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    semCredenciamento: 0,
    diaria: 0,
    usuario: 0,
    fonte: 0,
    classe: 0,
    tabela: 0,
    item: 0,
    preco: 0,
    contrato: 0,
  };
  let c: CtxPrecos;
  let outro: CtxPrecos;
  const gravacao = (extra: Partial<ContextoGravacaoPreco> = {}): ContextoGravacaoPreco => ({
    ...c,
    chaveIdempotencia: `t0212p-${randomUUID()}`,
    reautenticadoEm: Date.now(),
    login: 'l0212.teste',
    estacao: 'teste',
    ...extra,
  });
  const trilha: TrilhaPreco = {
    rede: 'teste',
    hospital: P,
    usuario: 'l0212.teste',
    evento: 'teste-0212',
    recurso: 'convenio.plano',
    operacao: 'convenio.plano',
    chaveNaturalAlvo: 'plano',
    resultado: 'sucesso',
    estacao: 'teste',
    correlacao: 'teste-0212',
  };

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        `DELETE pe FROM plano_fonte_pagadora_estabelecimento pe JOIN plano_fonte_pagadora p ON p.id = pe.plano_fonte_pagadora_id
          WHERE p.fonte_pagadora_id = ?`,
        [ids.fonte],
      );
      await e.executar('DELETE FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
      await e.executar('DELETE FROM codigo_prestador_fonte_pagadora WHERE fonte_pagadora_id = ?', [
        ids.fonte,
      ]);
      await e.executar(
        'DELETE ctv FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
        [ids.fonte],
      );
      await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
      await e.executar(
        'DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id WHERE pp.tabela_preco_id = ?',
        [ids.tabela],
      );
      await e.executar('DELETE FROM preco_procedimento WHERE tabela_preco_id = ?', [ids.tabela]);
      await e.executar(
        'DELETE v FROM preco_diaria_taxa_valor v JOIN preco_diaria_taxa d ON d.id = v.preco_diaria_taxa_id WHERE d.tabela_preco_id = ?',
        [ids.tabela],
      );
      await e.executar('DELETE FROM preco_diaria_taxa WHERE tabela_preco_id = ?', [ids.tabela]);
      await e.executar(
        "UPDATE fonte_pagadora_estabelecimento SET situacao = 'ativa', dias_retorno = NULL WHERE fonte_pagadora_id = ?",
        [ids.fonte],
      );
      await e.executar('DELETE FROM fonte_pagadora_versao WHERE fonte_pagadora_id = ?', [ids.fonte]);
      await e.executar(
        "UPDATE fonte_pagadora SET situacao = 'ativa', nome = 'OPERADORA L0212P SINTETICA', dias_retorno = 30, email = NULL WHERE id = ?",
        [ids.fonte],
      );
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-12-precos' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      // UFs usadas pela alteração do contrato: o catálogo do IBGE do cliente de teste pode estar vazio.
      const pais = await garantir(
        e,
        'SELECT id FROM pais_referencia WHERE codigo_iso = ?',
        ['BR'],
        'INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES (?, ?, ?)',
        ['BR', 'Brasil', agora],
      );
      for (const [codigo, sigla, nome] of [
        ['35', 'SP', 'São Paulo'],
        ['31', 'MG', 'Minas Gerais'],
        ['33', 'RJ', 'Rio de Janeiro'],
        ['29', 'BA', 'Bahia'],
      ])
        await garantir(
          e,
          'SELECT id FROM unidade_federativa WHERE sigla = ?',
          [sigla],
          'INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, sigla, nome, pais, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.semCredenciamento = await est(`${P}C`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0212.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0212.teste', 'USUARIO SINTETICO L0212', agora],
      );
      ids.classe = await garantir(
        e,
        'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
        [`${P}-CONV`],
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO L0212P', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-A`],
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, registro_ans, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA L0212P SINTETICA', 'operadora', 'ativa', ?, '999001', 30, ?)`,
        [`${P}-A`, ids.classe, agora],
      );
      // O convênio credenciado nos estabelecimentos A e B (não no C).
      for (const x of [ids.est, ids.outroEst])
        await garantir(
          e,
          'SELECT id FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?',
          [ids.fonte, x],
          "INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, situacao, criado_em) VALUES (?, ?, 'ativa', ?)",
          [ids.fonte, x, agora],
        );
      ids.tabela = await garantir(
        e,
        'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
           VALUES (?, ?, 'HONORARIOS L0212P', 'honorario', 'propria', 'real', 'ativa', ?)`,
        [ids.est, `${P}-HON`, agora],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${P}-HON`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'HONORARIOS L0212P', 'honorario', ?)",
        [`${P}-HON`, agora],
      );
      ids.item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        [`${P}-CONS`],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, 'CONSULTA SINTETICA L0212P', 'honorario', ?, ?)",
        [`${P}-CONS`, grupo, agora],
      );
      await limpar(e);
      ids.preco = await e.inserir(
        `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em)
           VALUES (?, 1, ?, 'valor', ?)`,
        [ids.tabela, ids.item, agora],
      );
      for (const [vig, valor] of [
        ['2025-01-01', 80],
        ['2026-01-15', 100],
      ] as const)
        await e.inserir(
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, ocorrido_em, vigencia_inicio, valor_honorario,
             valor_custo_operacional, valor_filme, valor_anestesia, valor_outros, valor_total, criado_em)
           VALUES (?, ?, ?, ?, 5, 0, 0, 1, ?, ?)`,
          [ids.preco, agora, vig, valor, valor + 6, agora],
        );
      for (const [seq, nome, valor] of [
        [1, 'DIARIA L0212P A', 300],
        [2, 'DIARIA L0212P B', 400],
      ] as const) {
        const d = await e.inserir(
          `INSERT INTO preco_diaria_taxa (tabela_preco_id, sequencia, codigo, nome, tipo_item, criado_em)
             VALUES (?, ?, ?, ?, 'diaria', ?)`,
          [ids.tabela, seq, `${P}-D${seq}`, nome, agora],
        );
        if (seq === 2) ids.diaria = d;
        await e.inserir(
          `INSERT INTO preco_diaria_taxa_valor (preco_diaria_taxa_id, ocorrido_em, vigencia_inicio, valor, criado_em)
             VALUES (?, ?, '2025-01-01', ?, ?)`,
          [d, agora, valor, agora],
        );
      }
      ids.contrato = await e.inserir(
        `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO L0212P', '2025-01-01', 'vigente', 60, ?)`,
        [ids.est, ids.fonte, `${P}-1`, agora],
      );
      await e.inserir(
        `INSERT INTO contrato_tabela_vigencia (contrato_fonte_pagadora_id, tipo_item, tabela_preco_id, vigencia_inicio, criado_em)
           VALUES (?, 'honorario_ambulatorial', ?, '2025-01-01', ?)`,
        [ids.contrato, ids.tabela, agora],
      );
      await e.inserir(
        `INSERT INTO codigo_prestador_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, tipo_prestador, codigo_operadora,
           vigencia_inicio, criado_em) VALUES (?, ?, 'estabelecimento', 'L0212P-COD', '2025-01-01', ?)`,
        [ids.est, ids.fonte, agora],
      );
    });
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-02-12-precos',
      rede: 'teste',
      hospital: P,
      traceId: 'teste-02-12-precos',
    };
    outro = { ...c, estabelecimento: ids.outroEst };
    fonte = new FontePrecosPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-12-precos' }, async (e) => {
      await limpar(e);
    });
    await nucleo.encerrar();
  });

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-0212p' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );

  it('convênio com a tabela do acordo do estabelecimento; contrato pela chave de negócio', async () => {
    const conv = await fonte.convenio(c, ids.fonte);
    expect(conv).toMatchObject({
      codigo: ids.fonte,
      situacao: 'A',
      registroAns: 999001,
      honorariosExterna: ids.tabela,
      classificacao: ids.classe,
    });
    expect((await fonte.convenio(outro, ids.fonte))?.honorariosExterna).toBeNull();
    const v = await fonte.valoresContrato(c, ids.fonte);
    expect(v).toMatchObject({
      nome: 'OPERADORA L0212P SINTETICA',
      retornoDias: '30',
      situacaoAcordo: 'vigente',
      prazoApresentacaoDias: 60,
    });
    expect((await fonte.vigenciasTabelas(c, ids.fonte)).map((x) => [x.tipo, x.tabela, x.fim])).toEqual([
      ['honorariosExterna', ids.tabela, null],
    ]);
    expect((await fonte.tiss(c, ids.fonte)).configurado).toBe(true);
    expect((await fonte.tiss(outro, ids.fonte)).configurado).toBe(false);
    const cod = await fonte.codigosPrestador(c, ids.fonte, 0, 50);
    expect(cod.itens.map((i) => i['codigo'])).toEqual(['L0212P-COD']);
    // A contagem é do total, não da página.
    expect(await fonte.codigosPrestador(c, ids.fonte, 1, 1)).toMatchObject({ itens: [], total: 1 });
    // O convênio não credenciado no estabelecimento não aparece.
    const semCred = { ...c, estabelecimento: ids.semCredenciamento };
    expect((await fonte.convenios(semCred)).map((x) => x.codigo)).not.toContain(ids.fonte);
    expect(await fonte.convenio(semCred, ids.fonte)).toBeNull();
    expect(await fonte.valoresContrato(semCred, ids.fonte)).toBeNull();
  });

  it('diárias: a página traz o total da tabela; o item é lido pelo id', async () => {
    const pagina = await fonte.itensDiaria(c, ids.tabela, { pagina: 0, porPagina: 1, data: '2026-06-01' });
    expect(pagina.itens.length).toBe(1);
    expect(pagina.total).toBe(2);
    expect(await fonte.itemDiaria(c, ids.tabela, ids.diaria, '2026-06-01')).toMatchObject({
      id: ids.diaria,
      valor: 400,
      vigencia: '2025-01-01',
    });
    expect(await fonte.itemDiaria(outro, ids.tabela, ids.diaria, '2026-06-01')).toBeNull();
  });

  it('tabela de honorários: o valor vigente na data e a linha do tempo; nada de outro estabelecimento', async () => {
    expect((await fonte.cabecalhos(c, 'honorarios')).map((t) => t.codigo)).toContain(ids.tabela);
    expect((await fonte.cabecalhos(outro, 'honorarios')).map((t) => t.codigo)).not.toContain(ids.tabela);
    const em2025 = await fonte.itemHonorario(c, ids.tabela, ids.preco, '2025-06-01');
    expect(em2025).toMatchObject({
      vigencia: '2025-01-01',
      valores: { ch: 80, co: 5, filme: 0, anes: 0, outros: 1 },
      vigencias: 2,
    });
    const em2026 = await fonte.itemHonorario(c, ids.tabela, ids.preco, '2026-06-01');
    expect(em2026?.valores?.ch).toBe(100);
    expect(await fonte.itemHonorario(outro, ids.tabela, ids.preco, '2026-06-01')).toBeNull();
    const pagina = await fonte.itensHonorario(c, ids.tabela, {
      pagina: 0,
      porPagina: 10,
      data: '2026-06-01',
      busca: 'consulta',
    });
    expect(pagina.total).toBe(1);
    expect((await fonte.vigenciasDoItem(c, ids.tabela, ids.preco)).map((x) => x.data)).toEqual([
      '2026-01-15',
      '2025-01-01',
    ]);
  });

  it('situação: suspende e reativa no estabelecimento, com o retrato completo e a trilha; o outro estabelecimento não muda', async () => {
    const suspender = () =>
      fonte.executar(
        'convenio.alterarSituacao',
        c,
        { convenio: ids.fonte, operacao: 'suspender', justificativa: 'Teste sintético L0212P' },
        gravacao(),
      );
    const r = await suspender();
    expect(r.resultado).toMatchObject({ convenio: ids.fonte, situacaoAntes: 'A', situacaoDepois: 'I' });
    const situacaoEm = (est: number) =>
      ler<{ situacao: string; versao: number }>(
        'SELECT situacao, versao FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?',
        [ids.fonte, est],
      );
    expect(await situacaoEm(ids.est)).toMatchObject({ situacao: 'suspensa' });
    // A suspensão em A não muda B nem a fonte pagadora da rede.
    expect((await situacaoEm(ids.outroEst))?.situacao).toBe('ativa');
    expect(
      (await ler<{ situacao: string }>('SELECT situacao FROM fonte_pagadora WHERE id = ?', [ids.fonte]))
        ?.situacao,
    ).toBe('ativa');
    expect((await fonte.convenio(outro, ids.fonte))?.situacao).toBe('A');
    expect((await fonte.convenio(c, ids.fonte))?.situacao).toBe('I');
    const retratos = await ler<{ total: number }>(
      'SELECT COUNT(*) AS total FROM fonte_pagadora_versao WHERE fonte_pagadora_id = ?',
      [ids.fonte],
    );
    expect(Number(retratos?.total)).toBe(1);
    // O retrato é o registro depois da mudança: a situação nova.
    const dados = await ler<{ dados: unknown }>(
      'SELECT dados FROM fonte_pagadora_versao WHERE fonte_pagadora_id = ? ORDER BY id DESC LIMIT 1',
      [ids.fonte],
    );
    const json = (typeof dados?.dados === 'string' ? JSON.parse(dados.dados) : dados?.dados) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      id: ids.fonte,
      nome: 'OPERADORA L0212P SINTETICA',
      estabelecimento: { estabelecimento_id: ids.est, situacao: 'suspensa' },
    });
    const t = await ler<{ motivo: string }>(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'fonte_pagadora' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [ids.fonte],
    );
    expect(t?.motivo).toBe('Teste sintético L0212P');
    expect(await recusada(suspender())).toBe('sem-efeito');
    expect((await fonte.historico(c, ids.fonte)).length).toBe(1);
    // Sem reautenticação recente: a operação crítica recusa.
    expect(
      await recusada(
        fonte.executar(
          'convenio.alterarSituacao',
          c,
          { convenio: ids.fonte, operacao: 'reativar', justificativa: 'Teste sintético' },
          gravacao({ reautenticadoEm: 0 }),
        ),
      ),
    ).toBe('reautenticacao-necessaria');
    await fonte.executar(
      'convenio.alterarSituacao',
      c,
      { convenio: ids.fonte, operacao: 'reativar', justificativa: 'Teste sintético' },
      gravacao(),
    );
    expect((await fonte.convenio(c, ids.fonte))?.situacao).toBe('A');
  });

  it('contrato: altera o que o modelo tem pela leitura da tela; o campo sem coluna aguarda o modelo', async () => {
    const alterar = (
      valores: Record<string, string | number | null>,
      lidos: Record<string, string | number | null>,
    ) =>
      fonte.executar(
        'convenio.alterarContrato',
        c,
        { convenio: ids.fonte, aba: 'cadastro', valores, lidos, justificativa: 'Teste sintético L0212P' },
        gravacao(),
      );
    expect(await recusada(alterar({ nome: 'OUTRO NOME' }, { nome: 'LIDO ERRADO' }))).toBe('conflito-versao');
    const antes = await ler<{ versao: number }>('SELECT versao FROM fonte_pagadora WHERE id = ?', [
      ids.fonte,
    ]);
    await alterar({ nome: 'OPERADORA L0212P RENOMEADA' }, { nome: 'OPERADORA L0212P SINTETICA' });
    const depois = await ler<{ versao: number; nome: string }>(
      'SELECT versao, nome FROM fonte_pagadora WHERE id = ?',
      [ids.fonte],
    );
    expect(depois?.nome).toBe('OPERADORA L0212P RENOMEADA');
    expect(Number(depois?.versao)).toBe(Number(antes?.versao) + 1);
    expect(await recusada(alterar({ bairro: 'CENTRO' }, { bairro: null }))).toBe('modelo-pendente');
    // UF pela sigla (a FK da unidade federativa) e o telefone da fonte pagadora.
    const lidos = await fonte.valoresContrato(c, ids.fonte);
    // A massa é reaproveitada entre execuções: os valores novos sempre diferem dos lidos.
    const uf = lidos?.['uf'] === 'SP' ? 'MG' : 'SP';
    const nfUf = lidos?.['nfUf'] === 'RJ' ? 'BA' : 'RJ';
    const telefone = lidos?.['telefone'] === '1133334444' ? '1144445555' : '1133334444';
    await alterar(
      { uf, nfUf, telefone },
      { uf: lidos?.['uf'] ?? null, nfUf: lidos?.['nfUf'] ?? null, telefone: lidos?.['telefone'] ?? null },
    );
    expect(await fonte.valoresContrato(c, ids.fonte)).toMatchObject({ uf, nfUf, telefone });
    const fk = await ler<{ u: string }>(
      'SELECT u.sigla AS u FROM fonte_pagadora f JOIN unidade_federativa u ON u.id = f.unidade_federativa_id WHERE f.id = ?',
      [ids.fonte],
    );
    expect(fk?.u).toBe(uf);
    // O retorno é o da unidade: grava no estabelecimento, a rede e o outro estabelecimento ficam com o da fonte.
    await fonte.executar(
      'convenio.alterarContrato',
      c,
      {
        convenio: ids.fonte,
        aba: 'faturabilidade',
        valores: { retornoDias: '45' },
        lidos: { retornoDias: '30' },
        justificativa: 'Teste sintético L0212P',
      },
      gravacao(),
    );
    expect((await fonte.valoresContrato(c, ids.fonte))?.['retornoDias']).toBe('45');
    expect((await fonte.valoresContrato(outro, ids.fonte))?.['retornoDias']).toBe('30');
    expect(
      Number(
        (
          await ler<{ dias_retorno: number }>('SELECT dias_retorno FROM fonte_pagadora WHERE id = ?', [
            ids.fonte,
          ])
        )?.dias_retorno,
      ),
    ).toBe(30);
    expect(fonte.estado('preco.reajustar')).toBeNull();
    expect(await recusada(fonte.executar('preco.reajustar', c, {}, gravacao()))).toBe(
      'operacao-nao-liberada',
    );
  });

  it('plano: inclui com a vigência no estabelecimento, corrige pela versão; outro estabelecimento não vê', async () => {
    const novo = {
      hospital: P,
      convenio: ids.fonte,
      nome: 'PLANO L0212P',
      planoLegado: 77,
      inicio: '2026-01-01',
      fim: null,
      justificativa: 'Teste sintético',
      autor: 'x',
    };
    const pedido = { ...trilha, chaveIdempotencia: `t0212p-plano-${randomUUID()}` };
    const r = await fonte.gravarPlano(c, novo, pedido);
    // O reenvio do mesmo pedido (mesma Idempotency-Key) devolve o mesmo plano, sem gravar de novo.
    expect(await fonte.gravarPlano(c, novo, pedido)).toEqual(r);
    const lidos = await fonte.planos(c, ids.fonte);
    expect(lidos?.map((p) => [p.id, p.nome, p.planoLegado, p.inicio, p.fim, p.versao])).toEqual([
      [r.id, 'PLANO L0212P', 77, '2026-01-01', null, 1],
    ]);
    expect(await fonte.planos(outro, ids.fonte)).toEqual([]);
    const alt = (versao: number, fim: string) =>
      fonte.alterarPlano(
        c,
        {
          hospital: P,
          convenio: ids.fonte,
          id: r.id,
          versao,
          fim,
          justificativa: 'Teste sintético',
          autor: 'x',
        },
        trilha,
      );
    expect(await recusada(alt(1, '2025-01-01'))).toBe('vigencia-invalida');
    expect(await alt(1, '2026-12-31')).toEqual({ id: r.id, versao: 2 });
    expect(await recusada(alt(1, '2026-12-31'))).toBe('conflito-concorrente');
    expect(
      await recusada(
        fonte.alterarPlano(
          outro,
          {
            hospital: P,
            convenio: ids.fonte,
            id: r.id,
            versao: 2,
            fim: null,
            justificativa: 'x',
            autor: 'x',
          },
          trilha,
        ),
      ),
    ).toBe('nao-encontrado');
  });
});
