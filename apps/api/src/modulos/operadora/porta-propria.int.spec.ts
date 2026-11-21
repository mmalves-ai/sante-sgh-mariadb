// Integração da porta própria da operadora (F0 e F1) contra o MariaDB real, no cliente de teste da onda 2 (f22_o2).
// Massa SINTÉTICA (códigos "L0210"/"9021", nenhuma pessoa real). Contrato de efeito de cada gravação: as linhas, a
// versão e a trilha na mesma transação; e as recusas (versão velha, registro na ANS repetido, cartão de desconto ainda
// sem modelo, outro estabelecimento). Também: a regravação do produto sem mudança (nenhuma linha nova) e com preço novo
// (a tabela anterior encerrada, nada apagado), a operadora que não é a principal, a carteirinha e o contratante pela
// sequência do cliente com a mesma operadora em dois estabelecimentos, o CPF de outra pessoa e a alteração do
// beneficiário sem regravar o cadastro de pessoas. No fim, a massa de negócio e os catálogos sintéticos são apagados; ficam os
// domínios e os estabelecimentos de teste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { cnpjSintetico, cpfSintetico, numeroCarteirinha } from '@sgh/dominio-operadora';
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  PODE,
  prepararBase,
} from './infra/copia.spec-util.js';
import type { ContextoOperadora, DadosBeneficiario, DadosProduto, GravadorOperadora } from './porta.js';
import { PortaOperadoraPropria } from './porta-propria.js';

const P = 'L0210';
const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];

describe.skipIf(!PODE)('porta própria da operadora (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaBase;
  let porta: PortaOperadoraPropria;
  let c: ContextoOperadora;
  let outro: ContextoOperadora;
  const sip = { terminologia: 0, g1: 0, g2: 0 };

  const linha =
    (entidade: string) =>
    (r: { id: number }): RegistroTrilhaTela => ({
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: r.id,
      dadosDepois: { evento: 'teste.l0210', recurso: 'operadora' },
      correlacao: 'teste-02-10',
    });
  const gravar = <T extends { id: number }>(entidade: string, fn: (g: GravadorOperadora) => Promise<T>) =>
    porta.gravar(c, linha(entidade), fn);
  const um = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) => l.uma<T & Record<string, unknown>>(sql, p));

  const limparCatalogos = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-10' }, async (e) => {
      await e.executar(
        "DELETE cr FROM item_assistencial_ans_criterio cr JOIN item_assistencial_ans i ON i.id = cr.item_assistencial_ans_id WHERE i.codigo LIKE 'L0210-%'",
      );
      await e.executar("DELETE FROM item_assistencial_ans WHERE codigo LIKE 'L0210-%'");
      await e.executar(
        "DELETE t FROM termo_terminologia t JOIN terminologia x ON x.id = t.terminologia_id WHERE x.codigo = 'L0210-TUSS'",
      );
      await e.executar("DELETE FROM terminologia WHERE codigo = 'L0210-TUSS'");
      await e.executar("DELETE FROM grupo_procedimento_operadora WHERE codigo LIKE '90210%'");
    });

  beforeAll(async () => {
    nucleo = criarNucleo();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await prepararBase(nucleo);
    await limparMassa(nucleo, m);
    await limparCatalogos();
    porta = new PortaOperadoraPropria(nucleo, CLIENTE);
    c = contexto(m);
    outro = contexto(m, true);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-10' }, async (e) => {
      const agora = new Date();
      sip.terminologia = await e.inserir(
        "INSERT INTO terminologia (codigo, nome, tipo, criado_em) VALUES ('L0210-TUSS', 'Procedimentos sintéticos', 'procedimento', ?)",
        [agora],
      );
      const termo = (codigo: string, d: string) =>
        e.inserir('INSERT INTO termo_terminologia (terminologia_id, codigo_termo, descricao, criado_em) VALUES (?, ?, ?, ?)', [
          sip.terminologia,
          codigo,
          d,
          agora,
        ]);
      const item = (codigo: string, ordem: number, fim: string | null) =>
        e.inserir(
          'INSERT INTO item_assistencial_ans (codigo, descricao, ordem, vigencia_inicio, vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [codigo, `Grupo sintético ${codigo}`, ordem, '2009-01-01', fim, agora],
        );
      sip.g1 = await item('L0210-G1', 1, null);
      sip.g2 = await item('L0210-G2', 2, '2020-12-31');
      const t1 = await termo('90210001', 'Consulta sintética 1');
      const t2 = await termo('90210002', 'Consulta sintética 2');
      const t3 = await termo('90210003', 'Exame sintético 3');
      let s = 0;
      for (const [g, t] of [
        [sip.g1, t1],
        [sip.g1, t2],
        [sip.g2, t3],
      ])
        await e.inserir(
          "INSERT INTO item_assistencial_ans_criterio (item_assistencial_ans_id, sequencia, tipo_criterio, procedimento_termo_terminologia_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [g, ++s, t, agora],
        );
      for (const [codigo, d] of [
        ['902101', 'Exames: classificação sintética L0210'],
        ['902102', 'Terapias: classificação sintética L0210'],
      ])
        await e.inserir(
          "INSERT INTO grupo_procedimento_operadora (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'procedimento', ?)",
          [codigo, d, agora],
        );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) await limparMassa(nucleo, m);
    await limparCatalogos();
    await nucleo.encerrar();
  });

  it('catálogos da ANS: grupos, procedimentos por chave e vigência, classificação por código e por nome', async () => {
    const grupos = await porta.gruposSip(c);
    expect(grupos).toEqual(expect.arrayContaining([{ id: sip.g1, nome: 'Grupo sintético L0210-G1' }]));
    const g1 = await porta.procedimentosSip(c, { grupo: sip.g1 });
    expect(g1.itens).toEqual([
      { procedimento: 90210001, nome: 'Consulta sintética 1', grupo: sip.g1, vigenciaInicial: '2009-01-01', vigenciaFinal: null },
      { procedimento: 90210002, nome: 'Consulta sintética 2', grupo: sip.g1, vigenciaInicial: '2009-01-01', vigenciaFinal: null },
    ]);
    expect(g1.proxima).toBeNull();
    // A chave da página: depois do primeiro, só o segundo do grupo.
    const apos = await porta.procedimentosSip(c, {
      grupo: sip.g1,
      apos: { procedimento: 90210001, grupo: sip.g1, vigenciaInicial: '2009-01-01' },
    });
    expect(apos.itens.map((i) => i.procedimento)).toEqual([90210002]);
    expect((await porta.procedimentosSip(c, { procedimento: 90210003 })).itens).toEqual([
      { procedimento: 90210003, nome: 'Exame sintético 3', grupo: sip.g2, vigenciaInicial: '2009-01-01', vigenciaFinal: '2020-12-31' },
    ]);
    // Vigentes em 2026: o grupo encerrado em 2020 sai.
    expect((await porta.procedimentosSip(c, { grupo: sip.g2, vigentesEm: '2026-10-24' })).itens).toEqual([]);
    expect((await porta.classificacoesAns(c, { busca: '902102' })).itens).toEqual([
      { codigo: 902102, nome: 'Terapias: classificação sintética L0210' },
    ]);
    const nome = await porta.classificacoesAns(c, { busca: 'sintética L0210' });
    expect(nome.itens.map((i) => i.codigo)).toEqual([902101, 902102]);
    // O curinga da busca não vira padrão.
    expect((await porta.classificacoesAns(c, { busca: '%_' })).itens).toEqual([]);
  });

  it('operadora: inclusão e alteração com a versão, o vínculo, o histórico e a trilha; versão velha e registro repetido recusados', async () => {
    const dados = {
      registroAns: '902101',
      cnpj: cnpjSintetico('902100000101'),
      razaoSocial: 'Operadora Sintética L0210',
      nomeFantasia: 'Sintética',
      modalidade: 'medicinaGrupo',
      situacao: 'ativa',
    };
    const { id } = await gravar('operadora_saude', (g) => g.gravarOperadora({ id: null, versao: null, dados, por: 'x' }));
    const lida = await porta.operadora(c, id);
    expect(lida).toMatchObject({ ...dados, id, versao: 1 });
    expect(await porta.operadora(outro, id)).toBeNull();
    expect((await porta.operadoras(c)).map((o) => o.id)).toEqual([id]);
    const vinculo = await um<{ principal: unknown }>(
      'SELECT principal FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ?',
      [id, m.est],
    );
    expect(Number(vinculo?.principal)).toBe(1);
    const trilha = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'operadora_saude' AND entidade_id = ? AND estabelecimento_id = ? AND usuario_id = ?",
      [id, m.est, m.usuario],
    );
    expect(Number(trilha?.n)).toBe(1);

    await gravar('operadora_saude', (g) =>
      g.gravarOperadora({ id, versao: 1, dados: { ...dados, situacao: 'inativa', nomeFantasia: null }, por: 'x' }),
    );
    expect(await porta.operadora(c, id)).toMatchObject({ situacao: 'inativa', nomeFantasia: null, versao: 2 });
    const hist = await um<{ n: unknown }>('SELECT COUNT(*) AS n FROM operadora_saude_historico WHERE operadora_saude_id = ?', [id]);
    expect(Number(hist?.n)).toBe(2);
    // Versão velha: conflito; nada muda.
    expect(await codigoDe(gravar('operadora_saude', (g) => g.gravarOperadora({ id, versao: 1, dados, por: 'x' })))).toBe(
      'conflito-versao',
    );
    expect((await porta.operadora(c, id))?.versao).toBe(2);
    // O mesmo registro na ANS com outro CNPJ: recusa de negócio pelo campo.
    expect(
      await codigoDe(
        gravar('operadora_saude', (g) =>
          g.gravarOperadora({ id: null, versao: null, dados: { ...dados, cnpj: cnpjSintetico('902100000102') }, por: 'x' }),
        ),
      ),
    ).toBe('registro-ans-em-uso');
    // Outro estabelecimento não altera a operadora deste.
    expect(
      await codigoDe(
        porta.gravar(outro, linha('operadora_saude'), (g) => g.gravarOperadora({ id, versao: 2, dados, por: 'x' })),
      ),
    ).toBe('nao-encontrado');
  });

  it('produto, contrato, beneficiários e carteirinha: o que fica no banco, as contagens, a elegibilidade e a baixa', async () => {
    const ope = (await porta.operadoras(c))[0]?.id ?? 0;
    expect(ope).toBeGreaterThan(0);
    const produto: DadosProduto = {
      operadora: ope,
      codigo: `${P}-P1`,
      nome: 'Plano sintético L0210',
      natureza: 'plano',
      registroAns: '902101001',
      tipoContratacao: 1,
      segmentacao: 'ambulatorialHospitalar',
      abrangencia: 'estadual',
      acomodacao: 2,
      coparticipacao: { tipo: 2, valor: 30 },
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
      precos: PRECOS,
      situacao: 'ativo',
    };
    const prod = await gravar('produto_plano', (g) => g.gravarProduto({ id: null, versao: null, dados: produto, por: 'x' }));
    expect(await porta.produto(c, prod.id)).toMatchObject({ ...produto, id: prod.id, versao: 1 });
    expect(await porta.produto(outro, prod.id)).toBeNull();
    await gravar('produto_plano', (g) =>
      g.gravarProduto({
        id: prod.id,
        versao: 1,
        dados: { ...produto, coparticipacao: { tipo: 3, valor: 25 }, carencias: { ...produto.carencias, demais: 90 } },
        por: 'x',
      }),
    );
    expect(await porta.produto(c, prod.id)).toMatchObject({
      coparticipacao: { tipo: 3, valor: 25 },
      carencias: { urgencia: 1, partos: 300, demais: 90, cpt: 24 },
      precos: PRECOS,
      versao: 2,
    });
    expect(
      await codigoDe(
        gravar('produto_plano', (g) =>
          g.gravarProduto({ id: null, versao: null, dados: { ...produto, codigo: `${P}-CD`, natureza: 'cartaoDesconto' }, por: 'x' }),
        ),
      ),
    ).toBe('modelo-pendente');

    // Regravação sem mudança: nenhuma linha nova nos satélites, nada apagado; só a versão do produto e a trilha.
    const satelites = async () => {
      const r = await um<Record<string, unknown>>(
        `SELECT (SELECT COUNT(*) FROM tabela_preco_plano WHERE codigo = ? OR codigo LIKE ?) AS tabelas,
                (SELECT COUNT(*) FROM tabela_preco_plano WHERE (codigo = ? OR codigo LIKE ?) AND situacao = 'vigente') AS vigentes,
                (SELECT COUNT(*) FROM tabela_preco_plano_faixa WHERE produto_plano_id = ?) AS faixas,
                (SELECT COUNT(*) FROM produto_plano_segmentacao WHERE produto_plano_id = ?) AS segmentacoes,
                (SELECT COUNT(*) FROM carencia_produto_contrato WHERE produto_plano_id = ?) AS carencias,
                (SELECT COUNT(*) FROM regra_coparticipacao r JOIN plano_comercializado pc ON pc.id = r.plano_comercializado_id
                  WHERE pc.produto_plano_id = ?) AS copart,
                (SELECT COUNT(*) FROM trilha_auditoria WHERE entidade = 'produto_plano' AND entidade_id = ?) AS trilhas`,
        [`PRODUTO-${prod.id}`, `PRODUTO-${prod.id}-V%`, `PRODUTO-${prod.id}`, `PRODUTO-${prod.id}-V%`, prod.id, prod.id, prod.id, prod.id, prod.id],
      );
      return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v)]));
    };
    const antes = await satelites();
    expect(antes).toMatchObject({ tabelas: 1, vigentes: 1, faixas: 10, segmentacoes: 1, carencias: 4, copart: 1, trilhas: 2 });
    const mesmo = { ...produto, coparticipacao: { tipo: 3, valor: 25 }, carencias: { ...produto.carencias, demais: 90 } };
    await gravar('produto_plano', (g) => g.gravarProduto({ id: prod.id, versao: 2, dados: mesmo, por: 'x' }));
    expect(await satelites()).toEqual({ ...antes, trilhas: 3 });
    // Preço novo: a tabela vigente se encerra (com o fim da vigência) e outra abre; as faixas antigas ficam.
    const NOVOS = PRECOS.map((v) => v + 10);
    await gravar('produto_plano', (g) => g.gravarProduto({ id: prod.id, versao: 3, dados: { ...mesmo, precos: NOVOS }, por: 'x' }));
    expect(await satelites()).toEqual({ ...antes, tabelas: 2, faixas: 20, trilhas: 4 });
    const encerrada = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM tabela_preco_plano WHERE codigo = ? AND situacao = 'encerrada' AND vigencia_fim IS NOT NULL",
      [`PRODUTO-${prod.id}`],
    );
    expect(Number(encerrada?.n)).toBe(1);
    expect(await porta.produto(c, prod.id)).toMatchObject({ precos: NOVOS, versao: 4 });
    // Outra segmentação: a anterior sai por exclusão lógica (a linha fica), a nova entra.
    await gravar('produto_plano', (g) =>
      g.gravarProduto({ id: prod.id, versao: 4, dados: { ...mesmo, precos: NOVOS, segmentacao: 'ambulatorial' }, por: 'x' }),
    );
    const segs = await um<Record<string, unknown>>(
      'SELECT COUNT(*) AS n, SUM(excluido_em IS NOT NULL) AS excluidas FROM produto_plano_segmentacao WHERE produto_plano_id = ?',
      [prod.id],
    );
    expect([Number(segs?.['n']), Number(segs?.['excluidas'])]).toEqual([2, 1]);
    expect((await porta.produto(c, prod.id))?.segmentacao).toBe('ambulatorial');
    await gravar('produto_plano', (g) => g.gravarProduto({ id: prod.id, versao: 5, dados: { ...mesmo, precos: NOVOS }, por: 'x' }));
    expect(await porta.produto(c, prod.id)).toMatchObject({ segmentacao: produto.segmentacao, versao: 6 });
    // Outra operadora no mesmo estabelecimento (não a principal): o produto ainda não guarda a dona, recusa explícita.
    const opeB = await gravar('operadora_saude', (g) =>
      g.gravarOperadora({
        id: null,
        versao: null,
        dados: {
          registroAns: '902103',
          cnpj: cnpjSintetico('902100000103'),
          razaoSocial: 'Operadora Secundária L0210',
          nomeFantasia: null,
          modalidade: 'medicinaGrupo',
          situacao: 'ativa',
        },
        por: 'x',
      }),
    );
    expect(
      await codigoDe(
        gravar('produto_plano', (g) =>
          g.gravarProduto({ id: prod.id, versao: 6, dados: { ...mesmo, precos: NOVOS, operadora: opeB.id }, por: 'x' }),
        ),
      ),
    ).toBe('modelo-pendente');
    expect((await porta.produto(c, prod.id))?.versao).toBe(6);

    const ctr = await gravar('contrato_plano', (g) =>
      g.gravarContrato({
        operadora: ope,
        id: null,
        versao: null,
        por: 'x',
        dados: {
          produto: prod.id,
          numero: `${P}-C1`,
          tipo: 1,
          tipoContratacao: 1,
          contratanteNome: 'CONTRATANTE SINTETICO L0210',
          contratanteBusca: 'CONTRATANTE SINTETICO L0210',
          contratanteDocumento: cpfSintetico('902100001'),
          formaReajuste: 1,
          mesReajuste: 5,
          tipoVigencia: 2,
          inicio: '2026-01-01',
          fim: null,
          diaVencimento: 10,
          situacao: 'ativo',
          motivoSituacao: null,
        },
      }),
    );
    expect(await porta.contrato(c, ctr.id)).toMatchObject({
      operadora: ope,
      produto: prod.id,
      numero: `${P}-C1`,
      tipo: 1,
      tipoContratacao: 1,
      contratanteNome: 'CONTRATANTE SINTETICO L0210',
      formaReajuste: 1,
      tipoVigencia: 2,
      diaVencimento: 10,
      beneficiariosAtivos: 0,
      versao: 1,
    });
    expect((await porta.contratos(c, { operadora: ope, nome: 'contratante sint' })).itens.map((x) => x.id)).toEqual([ctr.id]);
    expect((await porta.contratos(outro, { operadora: ope })).itens).toEqual([]);

    const base: DadosBeneficiario = {
      contrato: ctr.id,
      titular: null,
      vinculo: 1,
      nome: 'TITULAR SINTETICA L0210',
      nomeBusca: 'TITULAR SINTETICA L0210',
      nomeSocial: null,
      cpf: cpfSintetico('902100002'),
      nascimento: '1980-05-10',
      sexo: 'F',
      cns: null,
      nomeMae: 'MAE SINTETICA',
      inclusao: '2026-02-01',
      pacienteHospital: null,
    };
    const tit = await gravar('beneficiario_plano', async (g) => {
      const n = await g.proximaSequenciaCarteirinha();
      return g.incluirBeneficiario({ operadora: ope, dados: base, carteirinha: numeroCarteirinha('902101', n), validade: '2028-12-31', por: 'x' });
    });
    // O CPF já cadastrado com outro nome: é de outra pessoa (nada é gravado; a pessoa não muda).
    expect(
      await codigoDe(
        gravar('beneficiario_plano', (g) =>
          g.incluirBeneficiario({
            operadora: ope,
            dados: { ...base, nome: 'OUTRA PESSOA L0210', nascimento: '1990-01-01' },
            carteirinha: `${P}X${tit.id}`,
            validade: '2028-12-31',
            por: 'x',
          }),
        ),
      ),
    ).toBe('cpf-de-outra-pessoa');
    // O contratante: o mesmo documento com outro nome também é recusado.
    expect(
      await codigoDe(
        gravar('contrato_plano', (g) =>
          g.gravarContrato({
            operadora: ope,
            id: null,
            versao: null,
            por: 'x',
            dados: {
              produto: prod.id,
              numero: `${P}-CX`,
              tipo: 1,
              tipoContratacao: 1,
              contratanteNome: 'NOME QUE NAO E DO CPF',
              contratanteBusca: 'NOME QUE NAO E DO CPF',
              contratanteDocumento: cpfSintetico('902100001'),
              formaReajuste: 1,
              mesReajuste: 5,
              tipoVigencia: 2,
              inicio: '2026-01-01',
              fim: null,
              diaVencimento: 10,
              situacao: 'ativo',
              motivoSituacao: null,
            },
          }),
        ),
      ),
    ).toBe('documento-de-outra-pessoa');
    const dep = await gravar('beneficiario_plano', async (g) =>
      g.incluirBeneficiario({
        operadora: ope,
        dados: { ...base, titular: tit.id, vinculo: 5, nome: 'DEPENDENTE SINTETICO L0210', cpf: null, sexo: 'M' },
        carteirinha: `${P}D${tit.id}`,
        validade: '2028-12-31',
        por: 'x',
      }),
    );
    const t = await porta.beneficiario(c, tit.id);
    expect(t).toMatchObject({ contrato: ctr.id, titular: null, vinculo: 1, situacao: 'ativo', via: 1, operadora: ope });
    expect(await porta.beneficiario(outro, tit.id)).toBeNull();
    expect((await porta.dependentes(c, tit.id)).map((d) => [d.id, d.vinculo])).toEqual([[dep.id, 5]]);
    expect(await porta.contagensDoContrato(c, { contrato: ctr.id, cpf: base.cpf, exceto: null })).toEqual({
      titularesAtivos: 1,
      cpfNoContrato: 1,
    });
    expect(await porta.contagensDeUso(c, { contrato: ctr.id, produto: prod.id })).toEqual({
      beneficiariosVinculados: 2,
      contratosEmUso: 1,
    });
    const eleg = await porta.elegibilidade(c, t?.carteirinha ?? '');
    expect(eleg).toMatchObject({ beneficiario: { id: tit.id }, contrato: { situacao: 'ativo', inicio: '2026-01-01' }, produto: { id: prod.id } });
    const movs = await um<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id IN (?, ?) AND tipo_movimento = 'inclusao'",
      [tit.id, dep.id],
    );
    expect(Number(movs?.n)).toBe(2);

    // Nova via: a anterior é cancelada; a via sobe; a versão do beneficiário também.
    const dominios = await porta.dominiosBeneficiario(c);
    const perda = dominios.motivosSegundaVia.find((x) => x.nome === 'Perda (sintético)')?.codigo ?? 0;
    const via = await gravar('beneficiario_plano', (g) =>
      g.emitirVia({ id: tit.id, versao: 1, motivo: perda, validade: '2029-12-31', por: 'x' }),
    );
    expect(via.via).toBe(2);
    expect((await porta.vias(c, tit.id)).map((v) => [v.via, v.motivo, v.validade])).toEqual([
      [1, null, '2028-12-31'],
      [2, perda, '2029-12-31'],
    ]);
    const cancelada = await um<{ situacao: string }>('SELECT situacao FROM cartao_beneficiario WHERE beneficiario_plano_id = ? AND via = 1', [
      tit.id,
    ]);
    expect(cancelada?.situacao).toBe('cancelado');

    // Baixa do titular: o dependente ativo vai junto, cada um com o seu movimento; versão velha recusada.
    const pedido = dominios.motivosBaixa.find((x) => x.nome === 'A pedido (sintético)')?.codigo ?? 0;
    expect(
      await codigoDe(gravar('beneficiario_plano', (g) => g.baixarBeneficiario({ id: tit.id, versao: 1, motivo: pedido, data: '2026-06-30', por: 'x' }))),
    ).toBe('desatualizado');
    const baixa = await gravar('beneficiario_plano', (g) =>
      g.baixarBeneficiario({ id: tit.id, versao: 2, motivo: pedido, data: '2026-06-30', por: 'x' }),
    );
    expect(baixa).toEqual({ id: tit.id, dependentes: 1 });
    expect(await porta.beneficiario(c, dep.id)).toMatchObject({ situacao: 'excluido', exclusao: '2026-06-30', motivoBaixa: pedido });
    expect((await porta.contrato(c, ctr.id))?.beneficiariosAtivos).toBe(0);
    await gravar('beneficiario_plano', (g) => g.reativarBeneficiario({ id: tit.id, versao: 3, por: 'x' }));
    expect(await porta.beneficiario(c, tit.id)).toMatchObject({ situacao: 'ativo', exclusao: null, motivoBaixa: null, versao: 4 });
    const tipos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
      l.consultar<{ tipo_movimento: string }>(
        'SELECT tipo_movimento FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id = ? ORDER BY id',
        [tit.id],
      ),
    );
    expect(tipos.map((x) => x.tipo_movimento)).toEqual(['inclusao', 'exclusao', 'reativacao']);

    // Alteração do beneficiário: só os campos do beneficiário; a pessoa (cadastro único) não é regravada.
    const pessoaDe = () =>
      um<Record<string, unknown>>(
        `SELECT pf.versao, pf.nome, b.versao AS versao_b, DATE_FORMAT(b.data_adesao, '%Y-%m-%d') AS data_adesao,
                (SELECT COUNT(*) FROM trilha_auditoria t WHERE t.entidade = 'beneficiario_plano' AND t.entidade_id = b.id
                    AND t.estabelecimento_id = ? AND t.usuario_id = ?) AS trilhas
           FROM beneficiario_plano b JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id WHERE b.id = ?`,
        [m.est, m.usuario, tit.id],
      );
    const p0 = await pessoaDe();
    await gravar('beneficiario_plano', (g) =>
      g.alterarBeneficiario({ id: tit.id, versao: 4, dados: { ...base, inclusao: '2026-02-15' }, por: 'x' }),
    );
    const p1 = await pessoaDe();
    expect(Number(p1?.['versao_b'])).toBe(5);
    expect([p0?.['data_adesao'], p1?.['data_adesao']]).toEqual(['2026-02-01', '2026-02-15']);
    expect([Number(p1?.['versao']), p1?.['nome']]).toEqual([Number(p0?.['versao']), p0?.['nome']]);
    expect(Number(p1?.['trilhas'])).toBe(Number(p0?.['trilhas']) + 1);
    const ultimo = await um<{ tipo_movimento: string; contrato_plano_id: unknown }>(
      'SELECT tipo_movimento, contrato_plano_id FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id = ? ORDER BY id DESC LIMIT 1',
      [tit.id],
    );
    expect([ultimo?.tipo_movimento, Number(ultimo?.contrato_plano_id)]).toEqual(['alteracao', ctr.id]);
    // Dado pessoal diferente do gravado: recusa pelo campo (muda pelo cadastro de pessoas); nada muda.
    expect(
      await codigoDe(
        gravar('beneficiario_plano', (g) =>
          g.alterarBeneficiario({ id: tit.id, versao: 5, dados: { ...base, nome: 'NOME TROCADO L0210', inclusao: '2026-02-15' }, por: 'x' }),
        ),
      ),
    ).toBe('dados-pessoais-pelo-cadastro');
    // Versão velha e outro estabelecimento: recusa; nada muda.
    expect(
      await codigoDe(gravar('beneficiario_plano', (g) => g.alterarBeneficiario({ id: tit.id, versao: 4, dados: base, por: 'x' }))),
    ).toBe('desatualizado');
    expect(
      await codigoDe(
        porta.gravar(outro, linha('beneficiario_plano'), (g) => g.alterarBeneficiario({ id: tit.id, versao: 5, dados: base, por: 'x' })),
      ),
    ).toBe('desatualizado');
    const p2 = await pessoaDe();
    expect([Number(p2?.['versao_b']), Number(p2?.['versao']), p2?.['nome']]).toEqual([5, Number(p0?.['versao']), p0?.['nome']]);

    // A mesma operadora em dois estabelecimentos: carteirinha e contratante pela sequência do cliente, sem repetir.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-10' }, (e) =>
      e.inserir(
        'INSERT INTO operadora_saude_estabelecimento (operadora_saude_id, estabelecimento_id, principal, vigencia_inicio, criado_em) VALUES (?, ?, TRUE, ?, ?)',
        [ope, m.outroEst, '2020-01-01', new Date()],
      ),
    );
    const gravarOutro = <T extends { id: number }>(entidade: string, fn: (g: GravadorOperadora) => Promise<T>) =>
      porta.gravar(outro, linha(entidade), fn);
    const prodB = await gravarOutro('produto_plano', (g) =>
      g.gravarProduto({ id: null, versao: null, dados: { ...produto, codigo: `${P}-P2`, registroAns: '902101002' }, por: 'x' }),
    );
    const ctrB = await gravarOutro('contrato_plano', (g) =>
      g.gravarContrato({
        operadora: ope,
        id: null,
        versao: null,
        por: 'x',
        dados: {
          produto: prodB.id,
          numero: `${P}-C2`,
          tipo: 1,
          tipoContratacao: 1,
          contratanteNome: 'CONTRATANTE SINTETICO L0210 B',
          contratanteBusca: 'CONTRATANTE SINTETICO L0210 B',
          contratanteDocumento: cpfSintetico('902100004'),
          formaReajuste: 1,
          mesReajuste: 5,
          tipoVigencia: 2,
          inicio: '2026-01-01',
          fim: null,
          diaVencimento: 10,
          situacao: 'ativo',
          motivoSituacao: null,
        },
      }),
    );
    const titB = await gravarOutro('beneficiario_plano', async (g) => {
      const n = await g.proximaSequenciaCarteirinha();
      return g.incluirBeneficiario({
        operadora: ope,
        dados: { ...base, contrato: ctrB.id, nome: 'TITULAR SINTETICO L0210 B', cpf: cpfSintetico('902100005'), sexo: 'M' },
        carteirinha: numeroCarteirinha('902101', n),
        validade: '2028-12-31',
        por: 'x',
      });
    });
    const cartA = (await porta.beneficiario(c, tit.id))?.carteirinha ?? '';
    const cartB = (await porta.beneficiario(outro, titB.id))?.carteirinha ?? '';
    expect(cartB).toHaveLength(16);
    expect(cartB).not.toBe(cartA);
    expect(Number(cartB.slice(6, 15))).toBeGreaterThan(Number(cartA.slice(6, 15)));
    const codigos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10' }, (l) =>
      l.consultar<{ codigo: string }>(
        'SELECT k.codigo FROM contratante_plano k JOIN contrato_plano cp ON cp.contratante_plano_id = k.id WHERE cp.id IN (?, ?)',
        [ctr.id, ctrB.id],
      ),
    );
    expect(new Set(codigos.map((x) => x.codigo)).size).toBe(2);
    // O paciente do hospital: só a existência pelo id.
    expect(await porta.pacienteExiste(c, 2_000_000_000)).toBe(false);
  });
});
