// Integração da porta própria do orçamento empresarial (M54, etapa 7) contra o MariaDB real, cliente f22_o2 (onda 2),
// com o serviço da API por cima. Massa SINTÉTICA "L0211O" (nenhuma pessoa real): um estabelecimento (e outro, para a
// recusa de estabelecimento), dois usuários, dois centros de custo e um plano gerencial com um item de receita e um de
// despesa. Contrato de efeito de cada gravação: as linhas em versao_orcamento e linha_orcamento, a `versao`, a trilha de
// auditoria da operação (com as escritas registradas) e a ausência de saída no outbox; o realizado com massa de
// títulos (com e sem rateio, renegociado, previsão) e consumo; e as recusas (versão lida velha, consumo sem insumo, segregação, outro estabelecimento).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaOrcamentoPropria } from './porta-propria.js';
import { ServicoOrcamento, type SessaoOrcamento } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0211O';
const ANO = 2031;
const EVENTOS = {
  criado: 'financeiro.orcamento.criado',
  linhas: 'financeiro.orcamento.linhasGravadas',
  aprovado: 'financeiro.orcamento.aprovado',
  descartado: 'financeiro.orcamento.descartado',
};
const CODIGOS = { editar: 'financeiro.orcamento.editar', aprovar: 'financeiro.orcamento.aprovar' };
const json = (d: unknown): unknown => (typeof d === 'string' ? JSON.parse(d) : d);
const doze = (v: number) => Array.from({ length: 12 }, () => v);

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('porta própria do orçamento (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaOrcamentoPropria;
  let servico: ServicoOrcamento;
  const ids = { est: 0, outro: 0, autor: 0, aprovador: 0, centro1: 0, centro2: 0, grupoR: 0, grupoD: 0 };
  const item = { receita: { g: 0, s: 0, i: 0 }, despesa: { g: 0, s: 0, i: 0 } };

  const limparVersoes = (e: Escritor) =>
    e
      .executar(
        `DELETE l FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
          WHERE v.estabelecimento_id IN (?, ?)`,
        [ids.est, ids.outro],
      )
      .then(() =>
        e.executar(
          "UPDATE versao_orcamento SET tipo_base = 'vazio', base_versao_orcamento_id = NULL WHERE estabelecimento_id IN (?, ?)",
          [ids.est, ids.outro],
        ),
      )
      .then(() =>
        e.executar('DELETE FROM versao_orcamento WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outro]),
      );

  function sessao(login: string, usuario: number, est = ids.est, hospital = `${P}A`): SessaoOrcamento {
    const porta: ContextoPorta = {
      cliente: CLIENTE,
      estabelecimento: est,
      usuario,
      correlacao: 'int-0211-orc',
      rede: 'teste',
      hospital,
    };
    return {
      rede: 'teste',
      hospital,
      login,
      porta,
      chaveIdempotencia: `t0211-${randomUUID()}`,
      pode: () => true,
      trilha: (evento, operacao, tabela, id, chave = null): RegistroTrilhaTela => ({
        estabelecimento: est,
        usuario,
        acao: 'operacao',
        entidade: tabela,
        entidadeId: id,
        dadosDepois: { evento, recurso: 'financeiro.orcamento', operacao, ...(chave ? { chave } : {}) },
        correlacao: 'int-0211-orc',
      }),
    };
  }

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-0211-orc-conferir' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-11-orc' }, async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO ORCAMENTO', 'ESTAB SINTETICO ORCAMENTO', agora],
        );
      ids.est = await estab(`${P}A`);
      ids.outro = await estab(`${P}B`);
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
      ids.autor = await usuario('l0211o.autor');
      ids.aprovador = await usuario('l0211o.aprova');
      const centro = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, cod],
          'INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.est, cod, `CENTRO SINTETICO ${cod}`, '2020-01-01', agora],
        );
      ids.centro1 = await centro('921101');
      ids.centro2 = await centro('921102');
      for (const tipo of ['receita', 'despesa'] as const) {
        const g = await garantir(
          e,
          'SELECT id FROM grupo_natureza_financeira WHERE codigo = ?',
          [`${P}-${tipo}`],
          'INSERT INTO grupo_natureza_financeira (codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${tipo}`, `GRUPO SINTETICO ${tipo.toUpperCase()}`, tipo, agora],
        );
        const s = await garantir(
          e,
          'SELECT id FROM subgrupo_natureza_financeira WHERE grupo_natureza_financeira_id = ? AND codigo = ?',
          [g, '01'],
          'INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, criado_em) VALUES (?, ?, ?, ?, ?)',
          [g, '01', `SUBGRUPO SINTETICO ${tipo.toUpperCase()}`, tipo, agora],
        );
        const i = await garantir(
          e,
          'SELECT id FROM natureza_financeira WHERE codigo = ?',
          [`${P}-${tipo}-1`],
          'INSERT INTO natureza_financeira (codigo, descricao, subgrupo_natureza_financeira_id, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [`${P}-${tipo}-1`, `ITEM SINTETICO ${tipo.toUpperCase()}`, s, tipo, agora],
        );
        item[tipo] = { g, s, i };
      }
      await limparVersoes(e);
    });
    porta = new PortaOrcamentoPropria(nucleo, CLIENTE);
    servico = new ServicoOrcamento(porta);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo
      .escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-11-orc' }, limparVersoes)
      .catch(() => undefined);
    await nucleo.encerrar();
  });

  const autor = () => sessao('l0211o.autor', ids.autor);
  const aprovador = () => sessao('l0211o.aprova', ids.aprovador);
  const linha = (tipo: 'receita' | 'despesa', centro: number, v: number) => ({
    centro,
    natureza: tipo,
    grupo: item[tipo].g,
    subgrupo: item[tipo].s,
    item: item[tipo].i,
    meses: doze(v),
    observacao: null,
  });

  it('apoio: centros do estabelecimento e itens do plano com a natureza; uma empresa', async () => {
    const a = await servico.apoio(autor(), CODIGOS, true);
    expect(a.centros.filter((c) => [ids.centro1, ids.centro2].includes(c.id)).map((c) => c.codigo)).toEqual([
      921101, 921102,
    ]);
    const meus = a.itens.filter((i) => [item.receita.i, item.despesa.i].includes(i.item));
    expect(meus.map((i) => [i.natureza, i.ativo])).toEqual(
      expect.arrayContaining([
        ['receita', true],
        ['despesa', true],
      ]),
    );
    expect((await porta.apoio(autor().porta)).empresas).toEqual([1]);
  });

  it('o ciclo: criar, lançar, versão velha recusada, consumo recusado, segregação, aprovar, revisão que substitui, descarte', async () => {
    // Criar (vazia): o cabeçalho, a versão 1 e a trilha da operação.
    const v1 = await servico.criar(
      autor(),
      { ano: ANO, empresa: 1, descricao: 'Orcamento sintetico', base: { tipo: 'vazio' } },
      EVENTOS,
    );
    expect(v1).toMatchObject({ numero: 1, linhas: 0, descartadas: 0 });
    const cab = await ler<{ situacao: string; versao: number; tipo_base: string; criado_por: number }>(
      'SELECT situacao, versao, tipo_base, criado_por, vigencia_inicio, vigencia_fim FROM versao_orcamento WHERE id = ?',
      [v1.id],
    );
    expect(cab).toMatchObject({ situacao: 'rascunho', versao: 1, tipo_base: 'vazio', criado_por: ids.autor });
    const t = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'versao_orcamento' AND entidade_id = ?",
      [v1.id],
    );
    expect(Number(t?.n)).toBe(1);

    // Lançar: duas linhas (uma sem centro).
    const g1 = await servico.gravarLinhas(
      autor(),
      v1.id,
      { versao: 1, linhas: [linha('receita', ids.centro1, 100_00), linha('despesa', 0, 50_00)] },
      EVENTOS,
    );
    expect(g1).toMatchObject({ versao: 2, mudou: true, incluidas: 2 });
    const linhas = await porta.linhas(autor().porta, v1.id);
    expect(linhas.map((l) => [l.natureza, l.centro, l.totalCentavos])).toEqual([
      ['receita', ids.centro1, 1200_00],
      ['despesa', 0, 600_00],
    ]);
    const semCentro = await ler<{ c: unknown }>(
      "SELECT centro_custo_id AS c FROM linha_orcamento WHERE versao_orcamento_id = ? AND natureza = 'despesa'",
      [v1.id],
    );
    expect(semCentro?.c).toBeNull();
    // Contrato de efeito da gravação das linhas: a trilha do cabeçalho conta as incluídas, e a operação não publica
    // mensagem de saída (nenhuma linha em integracao_mensagem para a versão).
    const tl1 = await ler<{ d: unknown }>(
      "SELECT dados_depois AS d FROM trilha_auditoria WHERE entidade = 'versao_orcamento' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [v1.id],
    );
    expect(json(tl1?.d)).toMatchObject({
      operacao: 'orcamento.linhas.gravar',
      dados: { linhasIncluidas: 2 },
    });
    const saida = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE entidade = 'versao_orcamento' AND entidade_id = ?",
      [v1.id],
    );
    expect(Number(saida?.n)).toBe(0);
    // Alterar uma e tirar a outra (zerada): uma linha fica, a versão sobe.
    const g2 = await servico.gravarLinhas(
      autor(),
      v1.id,
      { versao: 2, linhas: [linha('receita', ids.centro1, 200_00), linha('despesa', 0, 0)] },
      EVENTOS,
    );
    expect(g2).toMatchObject({ versao: 3, alteradas: 1, removidas: 1 });
    // A alteração sobe a versão da linha; a remoção é lógica (excluido_em/excluido_por), e as duas entram nas escritas
    // registradas da trilha.
    const brutas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-0211-orc-conferir' }, (l) =>
      l.consultar<{
        id: number;
        natureza: string;
        versao: number;
        excluido_em: unknown;
        excluido_por: unknown;
      }>(
        'SELECT id, natureza, versao, excluido_em, excluido_por FROM linha_orcamento WHERE versao_orcamento_id = ? ORDER BY sequencia',
        [v1.id],
      ),
    );
    expect(brutas.map((b) => [b.natureza, Number(b.versao), b.excluido_em !== null, b.excluido_por])).toEqual(
      [
        ['receita', 2, false, null],
        ['despesa', 2, true, ids.autor],
      ],
    );
    const tl2 = await ler<{ d: unknown }>(
      "SELECT dados_depois AS d FROM trilha_auditoria WHERE entidade = 'versao_orcamento' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [v1.id],
    );
    const d2 = json(tl2?.d) as { escritas: { acao: string; tabela: string; id: number }[] };
    expect(d2).toMatchObject({ dados: { linhasAlteradas: 1, linhasRemovidas: 1, linhasIncluidas: 0 } });
    expect(
      d2.escritas
        .filter((x) => x.tabela === 'linha_orcamento')
        .map((x) => [x.acao, x.id])
        .sort(),
    ).toEqual(brutas.map((b) => ['alteracao', Number(b.id)]).sort());
    expect((await porta.versao(autor().porta, v1.id))?.totaisPorNatureza).toEqual({
      receita: 2400_00,
      despesa: 0,
      consumo: 0,
    });
    // A versão lida velha: recusada pelo serviço e pela trava da porta (nada muda).
    await expect(
      servico.gravarLinhas(
        autor(),
        v1.id,
        { versao: 2, linhas: [linha('despesa', ids.centro2, 1)] },
        EVENTOS,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      porta.gravarLinhas(
        autor().porta,
        v1.id,
        2,
        { incluir: [linha('despesa', ids.centro2, 1)], alterar: [], remover: [] },
        {
          login: 'l0211o.autor',
          chaveIdempotencia: `t0211-${randomUUID()}`,
          trilha: autor().trilha('x', 'alterar', 'linha_orcamento', v1.id),
        },
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    // Consumo sem insumo: recusado com a mensagem de negócio.
    await expect(
      porta.gravarLinhas(
        autor().porta,
        v1.id,
        3,
        {
          incluir: [
            {
              centro: ids.centro1,
              natureza: 'consumo',
              grupo: 0,
              subgrupo: 0,
              item: 0,
              meses: doze(1),
              observacao: null,
            },
          ],
          alterar: [],
          remover: [],
        },
        {
          login: 'l0211o.autor',
          chaveIdempotencia: `t0211-${randomUUID()}`,
          trilha: autor().trilha('x', 'alterar', 'linha_orcamento', v1.id),
        },
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'consumo-sem-insumo' } });
    expect((await porta.versao(autor().porta, v1.id))?.versao).toBe(3);

    // Segregação: quem montou não aprova; outra pessoa aprova (oficial, aprovador e observação).
    await expect(
      servico.aprovar(autor(), v1.id, { versao: 3, observacao: null }, EVENTOS),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await servico.aprovar(aprovador(), v1.id, { versao: 3, observacao: 'ok sintetico' }, EVENTOS),
    ).toEqual({
      substituida: null,
    });
    const ap = await porta.versao(autor().porta, v1.id);
    expect(ap).toMatchObject({
      situacao: 'aprovado',
      aprovadoPor: 'l0211o.aprova',
      observacaoAprovacao: 'ok sintetico',
      versao: 4,
    });
    const of = await ler<{ oficial: number; aprovador_usuario_id: number }>(
      'SELECT oficial, aprovador_usuario_id FROM versao_orcamento WHERE id = ?',
      [v1.id],
    );
    expect([Number(of?.oficial), Number(of?.aprovador_usuario_id)]).toEqual([1, ids.aprovador]);

    // Revisão: cópia da aprovada, montada por quem aprovou e aprovada pelo autor; a primeira passa a substituída.
    const v2 = await servico.criar(
      aprovador(),
      { ano: ANO, empresa: 1, descricao: 'Revisao sintetica', base: { tipo: 'versao', id: v1.id } },
      EVENTOS,
    );
    expect(v2).toMatchObject({ numero: 2, linhas: 1 });
    expect((await porta.versao(autor().porta, v2.id))?.base).toBe(`cópia de ${ANO} v1`);
    expect(await servico.aprovar(autor(), v2.id, { versao: 1, observacao: null }, EVENTOS)).toEqual({
      substituida: v1.id,
    });
    expect((await porta.versao(autor().porta, v1.id))?.situacao).toBe('substituido');
    const velha = await ler<{ oficial: number }>('SELECT oficial FROM versao_orcamento WHERE id = ?', [
      v1.id,
    ]);
    expect(Number(velha?.oficial)).toBe(0);

    // Descarte de um rascunho, com o motivo e quem descartou.
    const v3 = await servico.criar(
      autor(),
      { ano: ANO, empresa: 1, descricao: 'Para descartar', base: { tipo: 'vazio' } },
      EVENTOS,
    );
    await servico.descartar(autor(), v3.id, { versao: 1, motivo: 'teste de descarte' }, EVENTOS);
    expect(await porta.versao(autor().porta, v3.id)).toMatchObject({
      situacao: 'descartado',
      descartadoPor: 'l0211o.autor',
      motivoDescarte: 'teste de descarte',
    });
    expect((await servico.versoes(autor(), ANO)).map((v) => v.numero)).toEqual([3, 2, 1]);
  });

  it('comparativo e versão do realizado (ano sem movimento): consultas válidas, sem linhas e com o aviso', async () => {
    const r = await porta.realizado(autor().porta, 1, ANO - 1);
    expect(r).toEqual({ agregado: [], rateados: [], ultimoMovimento: null, ultimoMesConsumo: null });
    const v = await servico.criar(
      autor(),
      { ano: ANO, empresa: 1, descricao: 'Do realizado', base: { tipo: 'realizado', ajusteCentesimos: 500 } },
      EVENTOS,
    );
    expect((await porta.versao(autor().porta, v.id))?.base).toBe(`realizado de ${ANO - 1} +5,00%`);
    const cmp = await servico.comparativo(
      autor(),
      v.id,
      { visao: 'linha' },
      new Date(`${ANO}-06-01T00:00:00Z`),
    );
    expect(cmp.linhas).toEqual([]);
    expect(cmp.avisos[0]).toContain('Ainda não há realizado');
  });

  it('realizado com movimento: rateio por centro, renegociado e previsão de fora; consumo fica de fora da versão, contado', async () => {
    const ANO_R = ANO - 3;
    const n = `${P}R`;
    const limparRealizado = (e: Escritor) =>
      e
        .executar(
          'DELETE r FROM rateio_lancamento r JOIN titulo_pagar t ON t.id = r.titulo_pagar_id WHERE t.estabelecimento_id = ? AND t.numero LIKE ?',
          [ids.est, `${n}%`],
        )
        .then(() =>
          e.executar('DELETE FROM titulo_pagar WHERE estabelecimento_id = ? AND numero LIKE ?', [
            ids.est,
            `${n}%`,
          ]),
        )
        .then(() =>
          e.executar('DELETE FROM consumo_centro_custo WHERE estabelecimento_id = ? AND ano = ?', [
            ids.est,
            ANO_R,
          ]),
        );
    await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-02-11-orc-realizado' },
      async (e) => {
        const agora = new Date();
        await limparRealizado(e);
        const credor = await garantir(
          e,
          'SELECT id FROM tipo_credor WHERE codigo = ?',
          [n],
          "INSERT INTO tipo_credor (codigo, descricao, natureza, criado_em) VALUES (?, 'CREDOR SINTETICO', 'fornecedor', ?)",
          [n, agora],
        );
        const doc = await garantir(
          e,
          'SELECT id FROM tipo_documento_financeiro WHERE codigo = ?',
          [n],
          "INSERT INTO tipo_documento_financeiro (codigo, descricao, criado_em) VALUES (?, 'DOCUMENTO SINTETICO', ?)",
          [n, agora],
        );
        const forn = await garantir(
          e,
          'SELECT id FROM empresa_fornecedora WHERE razao_social = ?',
          ['FORNECEDOR SINTETICO L0211O'],
          "INSERT INTO empresa_fornecedora (tipo_pessoa, razao_social, cnpj, criado_em) VALUES ('juridica', ?, '00000000021101', ?)",
          ['FORNECEDOR SINTETICO L0211O', agora],
        );
        const titulo = (
          sufixo: string,
          centro: number | null,
          data: string,
          cent: number,
          extra: { situacao?: string; tipo?: string } = {},
        ) =>
          e.inserir(
            `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
             numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido, natureza_financeira_id, centro_custo_id,
             situacao, tipo_titulo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ids.est,
              `${n}${sufixo}`,
              credor,
              forn,
              doc,
              `${n}${sufixo}`,
              data,
              data,
              (cent / 100).toFixed(2),
              (cent / 100).toFixed(2),
              item.despesa.i,
              centro,
              extra.situacao ?? 'aberto',
              extra.tipo ?? 'normal',
              agora,
            ],
          );
        await titulo('1', ids.centro1, `${ANO_R}-03-10`, 100_00);
        const rateado = await titulo('2', null, `${ANO_R}-04-10`, 100_00);
        for (const [seq, centro, cent] of [
          [1, ids.centro1, 60_00],
          [2, ids.centro2, 40_00],
        ] as const)
          await e.inserir(
            'INSERT INTO rateio_lancamento (titulo_pagar_id, sequencia, natureza_financeira_id, centro_custo_id, percentual, valor, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [rateado, seq, item.despesa.i, centro, cent / 100, (cent / 100).toFixed(2), agora],
          );
        await titulo('3', ids.centro1, `${ANO_R}-05-10`, 500_00, { situacao: 'renegociado' });
        await titulo('4', ids.centro1, `${ANO_R}-06-10`, 700_00, { tipo: 'previsao' });
        const grupoInsumo = await garantir(
          e,
          'SELECT id FROM grupo_insumo WHERE codigo = ?',
          [n],
          "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GRUPO SINTETICO', 'material', ?)",
          [n, agora],
        );
        const unidade = await garantir(
          e,
          'SELECT id FROM unidade_medida WHERE codigo = ?',
          [n],
          "INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, 'UNIDADE SINTETICA', 'US', ?)",
          [n, agora],
        );
        const insumo = await garantir(
          e,
          'SELECT id FROM insumo WHERE codigo = ?',
          [n],
          "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em) VALUES (?, 'INSUMO SINTETICO', 'material', ?, ?, ?)",
          [n, grupoInsumo, unidade, agora],
        );
        const local = await garantir(
          e,
          'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, n],
          "INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'LOCAL SINTETICO', 'almoxarifado', ?)",
          [ids.est, n, agora],
        );
        await e.inserir(
          `INSERT INTO consumo_centro_custo (estabelecimento_id, ocorrido_em, centro_custo_id, insumo_id, local_estoque_id, ano, mes,
           valor_liquido, criado_em) VALUES (?, ?, ?, ?, ?, ?, 7, 250.00, ?)`,
          [ids.est, agora, ids.centro2, insumo, local, ANO_R, agora],
        );
      },
    );
    try {
      const r = await porta.realizado(autor().porta, 1, ANO_R);
      const chave = (x: { natureza: string; codigoCentro: number | null; mes: number; centavos: number }) =>
        `${x.natureza}|${x.codigoCentro}|${x.mes}|${x.centavos}`;
      expect(r.agregado.map(chave).sort()).toEqual(
        [
          `despesa|${ids.centro1}|3|10000`,
          `despesa|${ids.centro1}|4|6000`,
          `despesa|${ids.centro2}|4|4000`,
          `consumo|${ids.centro2}|7|25000`,
        ].sort(),
      );
      expect(r.ultimoMesConsumo).toBe(7);
      // A versão do realizado sai (o consumo por centro fica de fora até o modelo guardá-lo, contado nas descartadas).
      const v = await servico.criar(
        autor(),
        {
          ano: ANO_R + 1,
          empresa: 1,
          descricao: 'Do realizado com movimento',
          base: { tipo: 'realizado', ajusteCentesimos: 0 },
        },
        EVENTOS,
      );
      expect(v).toMatchObject({ linhas: 2, consumoDeFora: 1 });
      expect(v.descartadas).toBeGreaterThanOrEqual(1);
      expect((await porta.versao(autor().porta, v.id))?.totaisPorNatureza).toEqual({
        despesa: 200_00,
        receita: 0,
        consumo: 0,
      });
    } finally {
      await nucleo.escrever(
        { cliente: CLIENTE, correlacao: 'limpeza-teste-02-11-orc-realizado' },
        limparRealizado,
      );
    }
  });

  it('outro estabelecimento: não lê a versão nem grava nela', async () => {
    const [v] = await servico.versoes(autor(), ANO);
    const outro = sessao('l0211o.autor', ids.autor, ids.outro, `${P}B`);
    expect(await porta.versao(outro.porta, v!.id)).toBeNull();
    expect(await porta.linhas(outro.porta, v!.id)).toEqual([]);
    await expect(
      porta.descartar(outro.porta, v!.id, v!.versao, 'outro estabelecimento', {
        login: 'l0211o.autor',
        chaveIdempotencia: `t0211-${randomUUID()}`,
        trilha: outro.trilha('x', 'alterar', 'versao_orcamento', v!.id),
      }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
