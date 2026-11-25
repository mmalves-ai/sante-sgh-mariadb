// Contrato de efeito da manutenção da estrutura e da configuração TISS (F3.1, 02-CAD linhas 25, 26 e 27) contra o
// MariaDB real, no cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa
// real). Prova o que fica no banco:
// - estabelecimento: dados gravados com versão nova; CNPJ que não confere recusado sem gravar; versão velha = 409;
// - unidade: incluir, alterar e inativar com motivo (a linha fica, ativo = falso); código repetido recusado;
// - setor: incluir com ramais (principal espelhado), superior em ciclo recusado, lançamento na conta sem centro de
//   custo recusado, alterar trocando ramais (o que saiu fica com exclusão lógica), inativar com data só sem filhos
//   ativos (data futura recusada; trilha com o motivo) e reativar; histórico do responsável (retirar encerra hoje,
//   voltar abre período novo, nada sobrescrito);
// - configuração TISS: nova vigência encerra a aberta na véspera (o histórico fica); erros todos de uma vez; versão
//   velha na alteração da vigência = 409;
// - faixa: sobreposição recusada; consumo em ordem com zeros e prefixo, "esgotada" no último número, sem faixa = recusa;
//   encerrar grava a situação (nunca apaga) e a trilha com o motivo; a encerrada no meio do consumo segue reservando
//   os números já usados (a faixa nova que os cruza é recusada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EstruturaGestaoPropria } from './estrutura-gestao-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { reservarNumeroGuia, TissConfiguracaoPropria } from './tiss-configuracao-proprio.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-5-estrutura';
const COD = `${MARCA}E`;
// CNPJ sintético com dígitos verificadores válidos (nenhuma empresa real).
const CNPJ_SINTETICO = '11222333000181';

describe.skipIf(SEM_BANCO)('estrutura e configuração TISS no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let es: EstruturaGestaoPropria;
  let ts: TissConfiguracaoPropria;
  let m: Massa | null = null;
  let original: Record<string, unknown> | null = null;
  let versaoPadrao = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const todos = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.consultar(sql, p));
  const t = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.estrutura' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  /** A linha da trilha da operação no alvo, com o motivo gravado (a prova de que a alteração ficou auditada). */
  const trilhaDe = async (entidade: string, id: number, motivo: string) =>
    Number(
      (await um<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND motivo = ?',
        [entidade, id, motivo],
      ))!.n,
    );
  const versao = async (tabela: string, id: number) =>
    Number((await um<{ versao: unknown }>(`SELECT versao FROM ${tabela} WHERE id = ?`, [id]))!.versao);

  async function limparMinhas(): Promise<void> {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar(
        `DELETE r FROM ramal_setor r JOIN setor_funcional s ON s.id = r.setor_funcional_id
          WHERE s.estabelecimento_id = ? AND s.codigo LIKE ?`,
        [m!.estabelecimento, `${COD}%`],
      );
      await e.executar(
        `DELETE r FROM responsavel_setor_funcional r JOIN setor_funcional s ON s.id = r.setor_funcional_id
          WHERE s.estabelecimento_id = ? AND s.codigo LIKE ?`,
        [m!.estabelecimento, `${COD}%`],
      );
      await e.executar(
        'UPDATE setor_funcional SET setor_superior_id = NULL WHERE estabelecimento_id = ? AND codigo LIKE ?',
        [m!.estabelecimento, `${COD}%`],
      );
      await e.executar('DELETE FROM setor_funcional WHERE estabelecimento_id = ? AND codigo LIKE ?', [
        m!.estabelecimento,
        `${COD}%`,
      ]);
      await e.executar('DELETE FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo LIKE ?', [
        m!.estabelecimento,
        `${COD}%`,
      ]);
      await e.executar(
        'DELETE FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?',
        [m!.estabelecimento, m!.fonte],
      );
      await e.executar(
        'DELETE FROM faixa_numeracao_guia WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?',
        [m!.estabelecimento, m!.fonte],
      );
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    es = new EstruturaGestaoPropria(nucleo, CLIENTE_F22);
    ts = new TissConfiguracaoPropria(nucleo, CLIENTE_F22);
    original = await um(
      'SELECT razao_social, nome_fantasia, cnpj, codigo_cnes, cep FROM estabelecimento WHERE id = ?',
      [m.estabelecimento],
    );
    const v = await um<{ id: unknown }>(
      'SELECT id FROM versao_padrao_tiss WHERE ativo ORDER BY id LIMIT 1',
      [],
    );
    if (v) versaoPadrao = Number(v.id);
    else
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
        await e.executar(
          `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
           VALUES ('04.03.00', 'troca', 'Versão sintética do teste', '2025-01-01', 'teste', NOW(3))`,
          [],
        );
        versaoPadrao = Number(
          (await e.uma<{ id: unknown }>('SELECT MAX(id) AS id FROM versao_padrao_tiss', []))!.id,
        );
      });
  }, 120_000);

  afterAll(async () => {
    await limparMinhas();
    if (m && original)
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.executar(
          'UPDATE estabelecimento SET razao_social = ?, nome_fantasia = ?, cnpj = ?, codigo_cnes = ?, cep = ? WHERE id = ?',
          [
            original!['razao_social'],
            original!['nome_fantasia'],
            original!['cnpj'],
            original!['codigo_cnes'],
            original!['cep'],
            m!.estabelecimento,
          ],
        ),
      );
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('estabelecimento: grava com versão nova; CNPJ que não confere e versão velha recusados', async () => {
    const lido = (await es.lerTudo(c())).estabelecimento;
    const base = {
      estabelecimento: m!.estabelecimento,
      versao: lido.versao,
      razaoSocial: `Hospital ${MARCA} Sintético SA`,
      nomeFantasia: `Hospital ${MARCA}`,
      cnpj: null,
      inscricaoEstadual: null,
      inscricaoMunicipal: null,
      cnes: null,
      tipo: null,
      porte: null,
      esfera: null,
      hospitalDia: true,
      cep: '30130010',
      logradouro: 'Rua Sintética',
      numero: '10',
      complemento: null,
      bairro: 'Centro',
      telefone: null,
      email: 'contato@exemplo.invalid',
      site: null,
      inicioAtividade: '2020-01-01',
      fimAtividade: null,
    };
    await expect(
      es.alterarEstabelecimento(c(), { ...base, cnpj: '11222333000182' }, t('x')),
    ).rejects.toMatchObject({
      problema: { codigo: 'cnpj-invalido' },
    });
    await es.alterarEstabelecimento(c(), base, t('x'));
    const r = await um('SELECT razao_social, hospital_dia, cep, versao FROM estabelecimento WHERE id = ?', [
      m!.estabelecimento,
    ]);
    expect(r).toMatchObject({ razao_social: base.razaoSocial, cep: '30130010' });
    expect(Boolean(Number(r!['hospital_dia']))).toBe(true);
    expect(Number(r!['versao'])).toBe(lido.versao + 1);
    await expect(es.alterarEstabelecimento(c(), base, t('x'))).rejects.toMatchObject({
      problema: { status: 409 },
    });
  });

  it('unidade: inclui, recusa código repetido, altera e inativa com motivo (a linha fica)', async () => {
    const base = {
      id: null,
      versao: null,
      codigo: `${COD}U1`,
      nome: `Ambulatório lateral ${MARCA}`,
      nomeCompleto: null,
      sigla: 'AMB',
      tipo: 'ambulatorio',
      cnes: null,
      cnpj: CNPJ_SINTETICO,
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      telefone: null,
      orientacaoAcesso: 'Entrada pela rua lateral',
    };
    const id = await es.gravarUnidade(c(), base, t('x'));
    await expect(es.gravarUnidade(c(), base, t('x'))).rejects.toMatchObject({
      problema: { codigo: 'unidade-repetida' },
    });
    await es.gravarUnidade(
      c(),
      { ...base, id, versao: await versao('unidade_assistencial', id), sigla: 'AMB2' },
      t('x'),
    );
    await expect(
      es.situacaoUnidade(
        c(),
        { id, versao: await versao('unidade_assistencial', id), ativo: false, data: null, motivo: 'curto' },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-curto' } });
    await es.situacaoUnidade(
      c(),
      {
        id,
        versao: await versao('unidade_assistencial', id),
        ativo: false,
        data: null,
        motivo: 'Unidade fechada para reforma',
      },
      t('x'),
    );
    expect(
      await um('SELECT sigla, ativo, excluido_em FROM unidade_assistencial WHERE id = ?', [id]),
    ).toMatchObject({
      sigla: 'AMB2',
      excluido_em: null,
    });
    expect(Number((await um('SELECT ativo FROM unidade_assistencial WHERE id = ?', [id]))!['ativo'])).toBe(0);
  });

  it('setor: ramais, ciclo e centro de custo recusados, troca de ramal com exclusão lógica, inativar só sem filhos', async () => {
    const base = {
      id: null,
      versao: null,
      codigo: `${COD}S1`,
      nome: `Internação ${MARCA}`,
      sigla: 'INT',
      tipo: 'assistencial',
      superior: null,
      unidade: m!.unidade,
      centroCusto: m!.centroCusto,
      responsavel: m!.profissional,
      responsavelInicio: '2026-01-01',
      responsavelFim: null,
      podeSolicitarExames: true,
      aceitaLancamentoConta: true,
      producaoFaturada: true,
      exigeProfissionalAgendamento: false,
      exigeRecursoAgendamento: false,
      siglaAgendamento: null,
      observacaoAgendamento: null,
      ramais: [
        {
          id: null,
          ramal: '2001',
          contato: 'Posto',
          principal: false,
          responsavel: false,
          telefoneExterno: null,
          observacao: null,
        },
        {
          id: null,
          ramal: '2002',
          contato: 'Chefia',
          principal: true,
          responsavel: true,
          telefoneExterno: '3133334444',
          observacao: null,
        },
      ],
    };
    await expect(es.gravarSetor(c(), { ...base, centroCusto: null }, t('x'))).rejects.toMatchObject({
      problema: { codigo: 'lancamento-sem-centro-custo' },
    });
    const pai = await es.gravarSetor(c(), base, t('x'));
    expect(await um('SELECT ramal_principal, ativo FROM setor_funcional WHERE id = ?', [pai])).toMatchObject({
      ramal_principal: '2002',
    });
    const filho = await es.gravarSetor(
      c(),
      { ...base, codigo: `${COD}S2`, nome: `Posto ${MARCA}`, superior: pai, ramais: [] },
      t('x'),
    );
    await expect(
      es.gravarSetor(
        c(),
        { ...base, id: pai, versao: await versao('setor_funcional', pai), superior: filho },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'superior-em-ciclo' } });
    // Troca: 2001 sai (exclusão lógica), 2002 fica, 2003 entra.
    const ramais = await todos(
      'SELECT id, ramal FROM ramal_setor WHERE setor_funcional_id = ? ORDER BY sequencia',
      [pai],
    );
    const id2002 = Number(ramais.find((r) => r['ramal'] === '2002')!['id']);
    await es.gravarSetor(
      c(),
      {
        ...base,
        id: pai,
        versao: await versao('setor_funcional', pai),
        ramais: [
          { ...base.ramais[1]!, id: id2002, principal: false },
          {
            id: null,
            ramal: '2003',
            contato: null,
            principal: true,
            responsavel: false,
            telefoneExterno: null,
            observacao: null,
          },
        ],
      },
      t('x'),
    );
    const depois = await todos(
      'SELECT ramal, sequencia, excluido_em IS NOT NULL AS saiu FROM ramal_setor WHERE setor_funcional_id = ? ORDER BY sequencia',
      [pai],
    );
    expect(depois.map((r) => [r['ramal'], Number(r['sequencia']), Number(r['saiu'])])).toEqual([
      ['2001', 1, 1],
      ['2002', 2, 0],
      ['2003', 3, 0],
    ]);
    expect(
      (await um('SELECT ramal_principal FROM setor_funcional WHERE id = ?', [pai]))!['ramal_principal'],
    ).toBe('2003');
    // Inativar o pai com filho ativo é recusado; o filho primeiro, com data; depois o pai; reativar volta.
    // Data futura recusada: o estado "inativo" vale no dia em que é gravado.
    await expect(
      es.situacaoSetor(
        c(),
        {
          id: filho,
          versao: await versao('setor_funcional', filho),
          ativo: false,
          data: '2099-01-01',
          motivo: 'Setor desativado na reforma',
        },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'inativacao-futura' } });
    await expect(
      es.situacaoSetor(
        c(),
        {
          id: pai,
          versao: await versao('setor_funcional', pai),
          ativo: false,
          data: null,
          motivo: 'Setor desativado na reforma',
        },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'setor-com-filhos-ativos' } });
    await es.situacaoSetor(
      c(),
      {
        id: filho,
        versao: await versao('setor_funcional', filho),
        ativo: false,
        data: null,
        motivo: 'Setor desativado na reforma',
      },
      t('x'),
    );
    expect(await trilhaDe('setor_funcional', filho, 'Setor desativado na reforma')).toBe(1);
    const f = await um('SELECT ativo, data_inativacao, excluido_em FROM setor_funcional WHERE id = ?', [
      filho,
    ]);
    expect(Number(f!['ativo'])).toBe(0);
    expect(f!['data_inativacao']).not.toBeNull();
    expect(f!['excluido_em']).toBeNull();
    await es.situacaoSetor(
      c(),
      {
        id: filho,
        versao: await versao('setor_funcional', filho),
        ativo: true,
        data: null,
        motivo: 'Setor reaberto depois da reforma',
      },
      t('x'),
    );
    expect(
      await um('SELECT ativo, data_inativacao FROM setor_funcional WHERE id = ?', [filho]),
    ).toMatchObject({
      data_inativacao: null,
    });
    const lido = await es.lerTudo(c());
    const s = lido.setores.find((x) => x.id === pai)!;
    expect(s.ramais.map((r) => r.ramal)).toEqual(['2002', '2003']);
    expect(s.responsavel).toBe(m!.profissional);
    // Histórico do responsável: retirar encerra o período hoje; o mesmo profissional volta com período novo; nada é
    // sobrescrito e a leitura devolve os dois períodos.
    const hoje = String(
      (await um<{ d: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS d", []))!.d,
    );
    const amanha = String(
      (await um<{ d: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE + INTERVAL 1 DAY, '%Y-%m-%d') AS d", []))!.d,
    );
    const corpoPai = { ...base, id: pai, ramais: [] as typeof base.ramais };
    await es.gravarSetor(
      c(),
      {
        ...corpoPai,
        versao: await versao('setor_funcional', pai),
        responsavel: null,
        responsavelInicio: null,
      },
      t('x'),
    );
    await es.gravarSetor(
      c(),
      { ...corpoPai, versao: await versao('setor_funcional', pai), responsavelInicio: amanha },
      t('x'),
    );
    const periodos = await todos(
      `SELECT profissional_id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS i, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f
         FROM responsavel_setor_funcional WHERE setor_funcional_id = ? ORDER BY vigencia_inicio`,
      [pai],
    );
    expect(periodos.map((r) => [Number(r['profissional_id']), r['i'], r['f']])).toEqual([
      [m!.profissional, '2026-01-01', hoje],
      [m!.profissional, amanha, null],
    ]);
    expect(
      await um(
        "SELECT DATE_FORMAT(responsavel_vigencia_inicio, '%Y-%m-%d') AS i FROM setor_funcional WHERE id = ?",
        [pai],
      ),
    ).toMatchObject({ i: amanha });
    const relido = (await es.lerTudo(c())).setores.find((x) => x.id === pai)!;
    expect(relido.responsaveis.map((r) => [r.inicio, r.fim])).toEqual([
      [amanha, null],
      ['2026-01-01', hoje],
    ]);
  });

  it('configuração TISS: erros de uma vez; nova vigência encerra a aberta na véspera e o histórico fica', async () => {
    const base = {
      id: null,
      versao: null,
      fontePagadora: m!.fonte,
      versaoPadrao,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      registroAns: '123456',
      codigoPrestadorOperadora: 'P001',
      identificacaoPrestador: 'codigo_operadora' as const,
      cnpjContratado: null,
      razaoSocialContratado: null,
      numeracaoGuia: 'prestador' as const,
      limiteGuiasLote: 100,
      ordenacaoGuias: 'numero' as const,
      agrupaProcedimentoMaiorData: false,
      agrupaItensIguais: true,
      separaProfissionalPorGuia: false,
      quebraResumoInternacao: 'nao_quebra' as const,
      omiteGuiaSemValor: true,
      somenteArquivo: false,
      imprimeVersoGuia: false,
      exigeCidAlta: true,
      informaCid: true,
      exigeElegibilidade: false,
      elegibilidadeEletronica: false,
      autorizacaoEletronica: false,
      faturamentoEletronico: true,
      retornoEletronico: true,
      reapresentacaoEletronica: false,
      consideraPagoItemSemRetorno: false,
      diasRetornoConsulta: 30,
    };
    await expect(
      ts.gravarConfiguracao(c(), { ...base, registroAns: '12', limiteGuiasLote: 500 }, t('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'registro-ans-invalido' } });
    const a = await ts.gravarConfiguracao(c(), base, t('x'));
    await expect(ts.gravarConfiguracao(c(), base, t('x'))).rejects.toMatchObject({
      problema: { codigo: 'vigencia-sobreposta' },
    });
    const b = await ts.gravarConfiguracao(
      c(),
      { ...base, vigenciaInicio: '2026-07-01', limiteGuiasLote: 50 },
      t('x'),
    );
    const linhas = await todos(
      `SELECT id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS i, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f, limite_guias_lote
         FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? ORDER BY vigencia_inicio`,
      [m!.estabelecimento, m!.fonte],
    );
    expect(linhas.map((r) => [Number(r['id']), r['i'], r['f'], Number(r['limite_guias_lote'])])).toEqual([
      [a, '2026-01-01', '2026-06-30', 100],
      [b, '2026-07-01', null, 50],
    ]);
    await expect(
      ts.gravarConfiguracao(
        c(),
        {
          ...base,
          id: b,
          versao: await versao('configuracao_tiss_fonte_pagadora', b),
          vigenciaInicio: '2026-08-01',
        },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'inicio-imutavel' } });
    // Alterar a vigência com a versão velha: conflito 409, nada muda.
    const v = await versao('configuracao_tiss_fonte_pagadora', b);
    await ts.gravarConfiguracao(
      c(),
      { ...base, id: b, versao: v, vigenciaInicio: '2026-07-01', limiteGuiasLote: 60 },
      t('x'),
    );
    await expect(
      ts.gravarConfiguracao(
        c(),
        { ...base, id: b, versao: v, vigenciaInicio: '2026-07-01', limiteGuiasLote: 70 },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    expect(
      Number(
        (await um('SELECT limite_guias_lote FROM configuracao_tiss_fonte_pagadora WHERE id = ?', [b]))![
          'limite_guias_lote'
        ],
      ),
    ).toBe(60);
  });

  it('faixa: sobreposição recusada, consumo em ordem até esgotar, sem faixa recusa, encerrar grava a situação', async () => {
    const base = {
      fontePagadora: m!.fonte,
      tipoGuia: 'sp_sadt',
      formaGeracao: 'faixa_operadora' as const,
      prefixo: 'SP',
      tamanhoFixo: 6,
      numeroInicial: 1,
      numeroFinal: 2,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    const f1 = await ts.incluirFaixa(c(), base, t('x'));
    await expect(
      ts.incluirFaixa(c(), { ...base, numeroInicial: 2, numeroFinal: 9 }, t('x')),
    ).rejects.toMatchObject({
      problema: { codigo: 'faixa-sobreposta' },
    });
    // Outro tipo de guia com o mesmo prefixo, tamanho e números: o número da guia é único por fonte pagadora.
    await expect(ts.incluirFaixa(c(), { ...base, tipoGuia: 'internacao' }, t('x'))).rejects.toMatchObject({
      problema: { codigo: 'faixa-repete-numero-de-outro-tipo' },
    });
    const opReservar = definirOperacao({
      nome: 'teste.tiss.reservar-numero',
      tabelas: ['faixa_numeracao_guia'],
      entrada: z.object({ tipo: z.string() }).strict(),
      async gravar(tx, e, ctx) {
        const r = await reservarNumeroGuia(
          tx,
          ctx.estabelecimento ?? m!.estabelecimento,
          m!.fonte,
          e.tipo,
          '2026-03-01',
        );
        return { id: r.faixa, numero: r.numero, esgotada: r.esgotada };
      },
      alvo: (_e, r) => ({ tabela: 'faixa_numeracao_guia', id: Number(r.id) }),
    });
    const executor = nucleo.criarExecutor();
    const reservar = async () =>
      (
        await executor.executar(
          opReservar,
          CLIENTE_F22,
          { tipo: 'sp_sadt' },
          {
            cliente: CLIENTE_F22,
            estabelecimento: m!.estabelecimento,
            usuario: m!.usuario,
            correlacao: COR,
            chaveIdempotencia: `direta:${randomUUID()}`,
          },
        )
      ).resultado as { numero: string; esgotada: boolean };
    expect(await reservar()).toMatchObject({ numero: 'SP000001', esgotada: false });
    expect(await reservar()).toMatchObject({ numero: 'SP000002', esgotada: true });
    expect(
      await um('SELECT proximo_numero, situacao FROM faixa_numeracao_guia WHERE id = ?', [f1]),
    ).toMatchObject({
      situacao: 'esgotada',
    });
    await expect(reservar()).rejects.toMatchObject({ problema: { codigo: 'sem-faixa-de-guia' } });
    const f2 = await ts.incluirFaixa(c(), { ...base, numeroInicial: 3, numeroFinal: 100 }, t('x'));
    expect(await reservar()).toMatchObject({ numero: 'SP000003' });
    await ts.encerrarFaixa(
      c(),
      { id: f2, versao: await versao('faixa_numeracao_guia', f2), motivo: 'Operadora trocou a faixa' },
      t('x'),
    );
    expect(
      await um('SELECT situacao, proximo_numero FROM faixa_numeracao_guia WHERE id = ?', [f2]),
    ).toMatchObject({
      situacao: 'encerrada',
    });
    expect(await trilhaDe('faixa_numeracao_guia', f2, 'Operadora trocou a faixa')).toBe(1);
    // A faixa encerrada no meio do consumo (3 a 100, o 3 já usado) segue reservando o número usado: a nova que o
    // cruza é recusada; a que começa depois do último usado é aceita.
    await expect(
      ts.incluirFaixa(c(), { ...base, numeroInicial: 3, numeroFinal: 10 }, t('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'faixa-sobreposta' } });
    const f3 = await ts.incluirFaixa(c(), { ...base, numeroInicial: 4, numeroFinal: 10 }, t('x'));
    expect(await reservar()).toMatchObject({ numero: 'SP000004' });
    expect(f3).toBeGreaterThan(f2);
    const painel = await ts.painel(c(), m!.fonte);
    expect(painel.faixas.map((f) => [f.situacao, f.usados])).toEqual(
      expect.arrayContaining([
        ['esgotada', 2],
        ['encerrada', 1],
      ]),
    );
  });
});
