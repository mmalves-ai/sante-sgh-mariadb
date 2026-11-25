// Contrato de efeito das ligações do cadastro (F3.1, 02-CAD linhas 17, 18 e 20) contra o MariaDB real, no cliente de
// teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco:
// procedimento da especialidade com vigência (sobreposição recusada; encerrar grava o fim e a linha fica), ocupação
// principal única (retirar é exclusão lógica e a principal passa à que fica; religar volta na mesma linha), lotação por
// estabelecimento e unidade (CBO, carga semanal, tipo de vínculo de trabalho, vigência; sobreposição e carga acima da
// semana recusadas; vínculo inexistente ou do nível mais alto da árvore recusado; encerrar não apaga) e solicitante
// externo (alterar, inativar com motivo e reativar, código por fonte pagadora; parecidos na ficha).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroLigacoesProprio } from './cadastro-ligacoes-proprio.js';
import { OPERACAO_CADASTRAR_SOLICITANTE } from './porta-propria.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-4-ligacoes';

describe.skipIf(SEM_BANCO)('ligações do cadastro no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: CadastroLigacoesProprio;
  let m: Massa | null = null;
  let cbo: number[] = [];
  // Árvore sintética do tipo de vínculo de trabalho (códigos 97..: fora da faixa do cadastro nacional).
  let vinculoRaiz = 0;
  let vinculoTipo = 0;
  const DESCRICAO_TIPO = `TIPO ${MARCA} LIG SINTETICO`;
  const solicitantes: number[] = [];

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
    dadosDepois: { evento: 'teste', recurso: 'cadastro.ligacoes' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const versao = async (tabela: string, id: number) =>
    Number((await um<{ versao: unknown }>(`SELECT versao FROM ${tabela} WHERE id = ?`, [id]))!.versao);

  async function limparMinhas(): Promise<void> {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar('DELETE FROM especialidade_procedimento WHERE especialidade_medica_id = ?', [
        m!.especialidade,
      ]);
      await e.executar('DELETE FROM especialidade_ocupacao WHERE especialidade_medica_id = ?', [
        m!.especialidade,
      ]);
      await e.executar('DELETE FROM lotacao_profissional WHERE profissional_id = ?', [m!.profissional]);
      await e.executar("DELETE FROM tipo_vinculo_trabalho WHERE codigo_cnes = '9701'", []);
      await e.executar("DELETE FROM tipo_vinculo_trabalho WHERE codigo_cnes = '97'", []);
      await e.executar(
        `DELETE x FROM solicitante_externo_fonte_pagadora x JOIN solicitante_externo s ON s.id = x.solicitante_externo_id
          WHERE s.nome LIKE ?`,
        [`%${MARCA}%`],
      );
      await e.executar('DELETE FROM solicitante_externo WHERE nome LIKE ?', [`%${MARCA} LIG%`]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new CadastroLigacoesProprio(nucleo, CLIENTE_F22);
    cbo = (await todos('SELECT id FROM ocupacao_cbo ORDER BY id LIMIT 2', [])).map((r) => Number(r['id']));
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar(
        `INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, ativo, criado_em)
         VALUES ('97', 'vinculo', '97', ?, TRUE, NOW(3))`,
        [`VINCULO ${MARCA} LIG SINTETICO`],
      );
      vinculoRaiz = Number(
        (await e.uma<{ id: unknown }>("SELECT id FROM tipo_vinculo_trabalho WHERE codigo_cnes = '97'", []))!
          .id,
      );
      await e.executar(
        `INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, superior_tipo_vinculo_trabalho_id, codigo_vinculo,
           codigo_tipo, descricao, ativo, criado_em) VALUES ('9701', 'tipo', ?, '97', '01', ?, TRUE, NOW(3))`,
        [vinculoRaiz, DESCRICAO_TIPO],
      );
      vinculoTipo = Number(
        (await e.uma<{ id: unknown }>("SELECT id FROM tipo_vinculo_trabalho WHERE codigo_cnes = '9701'", []))!
          .id,
      );
      for (const [nome, numero] of [
        [`ANA ${MARCA} LIG SINTETICA`, '9914001'],
        [`DRA ANA ${MARCA} LIG SINTETICA`, '9914002'],
      ] as const) {
        await e.executar(
          `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
             data_inscricao, ativo, criado_em) VALUES (?, ?, ?, ?, '2026-01-01', TRUE, NOW(3))`,
          [nome, m!.conselho, numero, m!.uf],
        );
        const r = await e.uma<{ id: unknown }>(
          'SELECT id FROM solicitante_externo WHERE numero_conselho = ? AND nome = ?',
          [numero, nome],
        );
        solicitantes.push(Number(r!.id));
      }
    });
  }, 120_000);

  /** A linha da trilha de cada operação, na mesma transação: [ação, motivo] da última gravada para o alvo. */
  const trilhaDe = async (entidade: string, id: number) => {
    const r = await um(
      'SELECT acao, motivo, estabelecimento_id FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id DESC LIMIT 1',
      [entidade, id],
    );
    return r ? [r['acao'], r['motivo'], Number(r['estabelecimento_id'])] : null;
  };

  afterAll(async () => {
    await limparMinhas();
    if (m)
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        limparTrilhaDaMassa(e, { ids: [m!.estabelecimento, m!.outroEstabelecimento] }),
      );
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('especialidade: procedimento com vigência, sobreposição recusada, encerrar grava o fim e a linha fica', async () => {
    const base = { especialidade: m!.especialidade, procedimento: m!.procedimento };
    const id = await s.incluirProcedimento(
      c(),
      { ...base, vigenciaInicio: '2026-01-01', vigenciaFim: null },
      t('x'),
    );
    await expect(
      s.incluirProcedimento(c(), { ...base, vigenciaInicio: '2026-03-01', vigenciaFim: null }, t('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-sobreposta' } });
    await expect(
      s.incluirProcedimento(
        c(),
        { ...base, vigenciaInicio: '2026-03-01', vigenciaFim: '2026-02-01' },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-invertida' } });
    await s.encerrarProcedimento(
      c(),
      {
        dono: m!.especialidade,
        id,
        versao: await versao('especialidade_procedimento', id),
        fim: '2026-06-30',
      },
      t('x'),
    );
    const novo = await s.incluirProcedimento(
      c(),
      { ...base, vigenciaInicio: '2026-07-01', vigenciaFim: null },
      t('x'),
    );
    const linhas = await todos(
      `SELECT id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS i, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f, ativo, excluido_em
         FROM especialidade_procedimento WHERE especialidade_medica_id = ? ORDER BY id`,
      [m!.especialidade],
    );
    expect(linhas.map((l) => [Number(l['id']), l['i'], l['f'], l['excluido_em']])).toEqual([
      [id, '2026-01-01', '2026-06-30', null],
      [novo, '2026-07-01', null, null],
    ]);
    const lidas = await s.ligacoesEspecialidade(c(), m!.especialidade);
    expect(lidas.procedimentos).toHaveLength(2);
  });

  it('especialidade: uma ocupação principal; retirar é exclusão lógica; religar volta na mesma linha', async () => {
    expect(cbo.length).toBe(2);
    const [a, b] = cbo as [number, number];
    const ia = await s.gravarOcupacao(
      c(),
      { especialidade: m!.especialidade, ocupacao: a, principal: false },
      t('x'),
    );
    const ib = await s.gravarOcupacao(
      c(),
      { especialidade: m!.especialidade, ocupacao: b, principal: true },
      t('x'),
    );
    const principais = async () =>
      (
        await todos(
          'SELECT id, principal, excluido_em FROM especialidade_ocupacao WHERE especialidade_medica_id = ? ORDER BY id',
          [m!.especialidade],
        )
      ).map((r) => [Number(r['id']), Number(r['principal']), r['excluido_em'] === null]);
    expect(await principais()).toEqual([
      [ia, 0, true],
      [ib, 1, true],
    ]);
    await s.retirarOcupacao(
      c(),
      { dono: m!.especialidade, id: ib, versao: await versao('especialidade_ocupacao', ib) },
      t('x'),
    );
    expect(await principais()).toEqual([
      [ia, 1, true],
      [ib, 1, false],
    ]);
    const de = await s.gravarOcupacao(
      c(),
      { especialidade: m!.especialidade, ocupacao: b, principal: false },
      t('x'),
    );
    expect(de).toBe(ib);
    expect(await principais()).toEqual([
      [ia, 1, true],
      [ib, 0, true],
    ]);
  });

  it('lotação: inclui por estabelecimento e unidade; recusa sobreposição e carga acima da semana; encerrar não apaga', async () => {
    const base = {
      profissional: m!.profissional,
      estabelecimento: m!.estabelecimento,
      unidade: m!.unidade,
      ocupacao: cbo[0]!,
      inscricao: null,
      tipoVinculo: null,
      cargaAmbulatorial: 20,
      cargaHospitalar: 10,
      cargaOutros: 0,
      ocupacaoPadrao: true,
      atendeSus: true,
      geraRepasse: false,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    // Tipo de vínculo: só o tipo ou o subtipo (o nível mais alto da árvore não descreve o vínculo) e só o que existe.
    const maior = await um<{ id: unknown }>('SELECT MAX(id) AS id FROM tipo_vinculo_trabalho', []);
    for (const tipoVinculo of [vinculoRaiz, Number(maior!.id) + 1000])
      await expect(s.incluirLotacao(c(), { ...base, tipoVinculo }, t('x'))).rejects.toMatchObject({
        problema: { codigo: 'vinculo-inexistente' },
      });
    expect(
      await todos('SELECT id FROM lotacao_profissional WHERE profissional_id = ?', [m!.profissional]),
    ).toHaveLength(0);
    expect((await s.opcoes(c(), null)).tiposVinculo.map((x) => x.id)).toContain(vinculoTipo);
    expect((await s.opcoes(c(), null)).tiposVinculo.map((x) => x.id)).not.toContain(vinculoRaiz);
    const id = await s.incluirLotacao(c(), base, t('x'));
    await expect(
      s.incluirLotacao(c(), { ...base, vigenciaInicio: '2026-05-01' }, t('x')),
    ).rejects.toMatchObject({
      problema: { codigo: 'vigencia-sobreposta' },
    });
    // Fora do acesso total, outro estabelecimento é recusado (lotar, ler e encerrar só no da sessão).
    await expect(
      s.incluirLotacao(c(), { ...base, estabelecimento: m!.outroEstabelecimento, unidade: null }, t('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'estabelecimento-fora-da-sessao' } });
    await expect(
      s.incluirLotacao(
        c(),
        {
          ...base,
          estabelecimento: m!.outroEstabelecimento,
          unidade: null,
          cargaHospitalar: 140,
          cargaAmbulatorial: 0,
        },
        t('x'),
        true,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'carga-acima-da-semana' } });
    await expect(
      s.incluirLotacao(c(), { ...base, estabelecimento: m!.outroEstabelecimento }, t('x'), true),
    ).rejects.toMatchObject({ problema: { codigo: 'unidade-de-outro-estabelecimento' } });
    // Com acesso total (administrador), lota no outro estabelecimento; o usuário do estabelecimento não a vê nem a encerra.
    const alheia = await s.incluirLotacao(
      c(),
      {
        ...base,
        estabelecimento: m!.outroEstabelecimento,
        unidade: null,
        ocupacaoPadrao: false,
        cargaAmbulatorial: 4,
      },
      t('x'),
      true,
    );
    await expect(
      s.encerrarLotacao(
        c(),
        {
          dono: m!.profissional,
          id: alheia,
          versao: await versao('lotacao_profissional', alheia),
          fim: null,
        },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'estabelecimento-fora-da-sessao' } });
    expect((await s.lotacoes(c(), m!.profissional)).itens.map((x) => x.id)).toEqual([id]);
    expect((await s.lotacoes(c(), m!.profissional, true)).itens.map((x) => x.id).sort()).toEqual(
      [id, alheia].sort(),
    );
    expect((await s.opcoes(c(), null)).estabelecimentos.map((x) => x.id)).toEqual([m!.estabelecimento]);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar('DELETE FROM lotacao_profissional WHERE id = ?', [alheia]),
    );
    await expect(
      s.incluirLotacao(c(), { ...base, cargaAmbulatorial: 0, cargaHospitalar: 0 }, t('x')),
    ).rejects.toMatchObject({
      problema: { codigo: 'carga-zerada' },
    });
    await s.encerrarLotacao(
      c(),
      { dono: m!.profissional, id, versao: await versao('lotacao_profissional', id), fim: '2026-04-30' },
      t('x'),
    );
    const id2 = await s.incluirLotacao(
      c(),
      { ...base, vigenciaInicio: '2026-05-01', cargaAmbulatorial: 30, tipoVinculo: vinculoTipo },
      t('x'),
    );
    const linhas = await todos(
      `SELECT id, unidade_assistencial_id AS u, ocupacao_padrao AS p, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f,
              carga_horaria_ambulatorial AS a, tipo_vinculo_trabalho_id AS v, excluido_em FROM lotacao_profissional WHERE profissional_id = ? ORDER BY id`,
      [m!.profissional],
    );
    expect(
      linhas.map((l) => [
        Number(l['id']),
        Number(l['u']),
        Number(l['p']),
        l['f'],
        Number(l['a']),
        l['v'] === null ? null : Number(l['v']),
        l['excluido_em'],
      ]),
    ).toEqual([
      [id, m!.unidade, 0, '2026-04-30', 20, null, null],
      [id2, m!.unidade, 1, null, 30, vinculoTipo, null],
    ]);
    const lidas = await s.lotacoes(c(), m!.profissional);
    expect(lidas.itens.map((x) => x.cargaSemanal)).toEqual([40, 30]);
    // A leitura da aba devolve o tipo de vínculo gravado, com a descrição do catálogo.
    expect(lidas.itens.map((x) => [x.id, x.tipoVinculo, x.tipoVinculoDescricao])).toEqual([
      [id2, vinculoTipo, DESCRICAO_TIPO],
      [id, null, null],
    ]);
    // Trilha na mesma transação: inclusão e encerramento da lotação, no estabelecimento da sessão.
    expect(await trilhaDe('lotacao_profissional', id2)).toEqual(['inclusao', null, m!.estabelecimento]);
    expect(await trilhaDe('lotacao_profissional', id)).toEqual(['alteracao', null, m!.estabelecimento]);
  });

  it('solicitante: altera, inativa com motivo e reativa, código por fonte; a ficha mostra parecidos e o que falta', async () => {
    const [a, b] = solicitantes as [number, number];
    await s.alterarSolicitante(
      c(),
      {
        id: a,
        versao: await versao('solicitante_externo', a),
        nome: `ANA ${MARCA} LIG SINTETICA`,
        cpf: null,
        cns: null,
        ocupacao: cbo[0]!,
        especialidade: m!.especialidade,
        instituicaoNome: 'CLINICA SINTETICA',
        instituicaoCnpj: null,
        instituicaoCnes: '1234567',
        telefone: null,
        email: null,
        observacao: null,
      },
      t('x'),
    );
    expect((await trilhaDe('solicitante_externo', a))?.[0]).toBe('alteracao');
    const alt = {
      id: b,
      nome: `DRA ANA ${MARCA} LIG SINTETICA`,
      cpf: null,
      cns: null,
      ocupacao: null,
      especialidade: null,
      instituicaoNome: null,
      instituicaoCnpj: null,
      instituicaoCnes: null,
      telefone: null,
      email: null,
      observacao: null,
    };
    // Corrigir o número para o de outro cadastro: colisão recusada pela chave do domínio (zeros à esquerda contam igual).
    await expect(
      s.alterarSolicitante(
        c(),
        { ...alt, versao: await versao('solicitante_externo', b), numero: '09914001' },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'solicitante-existente' } });
    // Corrigir o erro de digitação no registro sem criar outro cadastro.
    await s.alterarSolicitante(
      c(),
      { ...alt, versao: await versao('solicitante_externo', b), numero: '9914003' },
      t('x'),
    );
    expect(
      (await um('SELECT numero_conselho FROM solicitante_externo WHERE id = ?', [b]))!['numero_conselho'],
    ).toBe('9914003');
    await expect(
      s.mudarSituacaoSolicitante(
        c(),
        { id: a, versao: await versao('solicitante_externo', a), ativo: false, motivo: 'curto', data: null },
        t('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-curto' } });
    await s.mudarSituacaoSolicitante(
      c(),
      {
        id: b,
        versao: await versao('solicitante_externo', b),
        ativo: false,
        motivo: 'Cadastro repetido do mesmo médico',
        data: '2026-02-01',
      },
      t('x'),
    );
    const inativo = await um(
      'SELECT ativo, DATE_FORMAT(data_inativacao, "%Y-%m-%d") AS d, excluido_em FROM solicitante_externo WHERE id = ?',
      [b],
    );
    expect([Number(inativo!['ativo']), inativo!['d'], inativo!['excluido_em']]).toEqual([
      0,
      '2026-02-01',
      null,
    ]);
    expect(await trilhaDe('solicitante_externo', b)).toEqual([
      'alteracao',
      'Cadastro repetido do mesmo médico',
      m!.estabelecimento,
    ]);
    await s.mudarSituacaoSolicitante(
      c(),
      {
        id: b,
        versao: await versao('solicitante_externo', b),
        ativo: true,
        motivo: 'Reativado por engano na baixa',
        data: null,
      },
      t('x'),
    );
    expect(Number((await um('SELECT ativo FROM solicitante_externo WHERE id = ?', [b]))!['ativo'])).toBe(1);

    const cod = await s.gravarCodigoFonte(
      c(),
      { solicitante: a, fonte: m!.fonte, codigo: 'AB-1', ativo: true },
      t('x'),
    );
    await expect(
      s.gravarCodigoFonte(c(), { solicitante: a, fonte: m!.fonte, codigo: 'AB 1', ativo: true }, t('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'codigo-invalido' } });
    expect(
      await s.gravarCodigoFonte(
        c(),
        { solicitante: a, fonte: m!.fonte, codigo: 'AB-2', ativo: true },
        t('x'),
      ),
    ).toBe(cod);
    await s.gravarCodigoFonte(c(), { solicitante: a, fonte: m!.fonte, codigo: '', ativo: false }, t('x'));
    const linha = await um(
      'SELECT codigo_na_fonte, ativo, excluido_em FROM solicitante_externo_fonte_pagadora WHERE id = ?',
      [cod],
    );
    expect([linha!['codigo_na_fonte'], Number(linha!['ativo']), linha!['excluido_em']]).toEqual([
      'AB-2',
      0,
      null,
    ]);

    const f = await s.fichaSolicitante(c(), a);
    expect(f.codigos.map((x) => [x.codigo, x.ativo])).toEqual([['AB-2', false]]);
    expect(f.parecidos.map((p) => [p.id, p.motivo])).toEqual([[b, 'mesmo-nome']]);
    expect(f.instituicaoCnes).toBe('1234567');
    const fb = await s.fichaSolicitante(c(), b);
    expect(fb.faltaParaGuia).toEqual(['cbo']);
  });

  it('solicitante: a inclusão recusa o repetido pela chave do domínio (zeros à esquerda não escapam)', async () => {
    const sigla = String(
      (await um<{ sigla: unknown }>('SELECT sigla FROM unidade_federativa WHERE id = ?', [m!.uf]))!.sigla,
    );
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar(
        `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
           data_inscricao, ativo, criado_em) VALUES (?, ?, '009914077', ?, '2026-01-01', TRUE, NOW(3))`,
        [`ZERO ${MARCA} LIG SINTETICA`, m!.conselho, m!.uf],
      ),
    );
    const ex = nucleo.criarExecutor();
    const ctx = () => ({
      cliente: CLIENTE_F22,
      estabelecimento: m!.estabelecimento,
      usuario: m!.usuario,
      correlacao: COR,
      chaveIdempotencia: `f3-1-4:${Math.random()}`,
    });
    const incluir = (numero: number, nome: string) =>
      ex.executar(
        OPERACAO_CADASTRAR_SOLICITANTE,
        CLIENTE_F22,
        { nome, conselho: m!.conselho, uf: sigla, numero },
        ctx(),
      );
    await expect(incluir(9_914_077, `REPETIDO ${MARCA} LIG SINTETICA`)).rejects.toMatchObject({
      problema: { codigo: 'solicitante-existente' },
    });
    const novo = await incluir(9_914_078, `NOVO ${MARCA} LIG SINTETICA`);
    const id = Number((novo.resultado as { solicitante: unknown }).solicitante);
    const linhas = await todos(
      'SELECT numero_conselho, ativo FROM solicitante_externo WHERE conselho_classe_id = ? AND conselho_unidade_federativa_id = ? AND numero_conselho IN (?, ?, ?) ORDER BY id',
      [m!.conselho, m!.uf, '009914077', '9914077', '9914078'],
    );
    expect(linhas.map((r) => [String(r['numero_conselho']), Number(r['ativo'])])).toEqual([
      ['009914077', 1],
      ['9914078', 1],
    ]);
    expect(id).toBeGreaterThan(0);
  });
});
