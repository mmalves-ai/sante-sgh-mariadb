// Etapa 4 do M46 sobre a cópia (ficha, seções 4, 5, 10 e 11), sempre em transação desfeita e sob a trava:
//   - as consultas do consignado por fornecedor (os movimentos, os consumos em sala do consignado com a reposição e o
//     faturamento, o saldo do cadastro) e das capelas e dos itens a manipular, com os tempos: só contagens e tempos;
//   - o consignado: a remessa, o consumo em sala SINTÉTICO de material consignado (só SGH_), a reposição e o faturamento
//     ligado a uma nota da entrada do estoque (relida em GECADNFS e GELANNFS), o consumo reposto de novo recusado pela
//     chave única do banco; nenhuma tabela do estoque tocada (o controle de consignados não é ligado);
//   - a manipulação: a ordem do item validado (a avaliação SINTÉTICA, só SGH_), a dupla conferência pela mesma pessoa
//     recusada pelo próprio banco (CHECK), a conferência por outra pessoa e a baixa do insumo pelo EXECUTOR
//     (suprimentos.registrarSaida com o bloco `manipulacao`: a ordem passa a baixada com o lançamento da saída na MESMA
//     transação); a baixa da ordem não conferida é recusada e nada fica (nem a saída);
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import {
  abrirOrdemManipulacaoSgh,
  capelasManipulacao,
  conferirManipulacaoSgh,
  consumosConsignados,
  consumosOpmeDoPeriodo,
  ErroOperacao,
  escritasDaTransacao,
  gravarConsumoOpmeSgh,
  gravarMovimentosConsignadoSgh,
  itensAManipular,
  movimentosConsignado,
  notaEntradaConsignado,
  notasEntradaConsignado,
  operacao,
  ordemManipulacao,
  saldoCadastroConsignado,
  saldoConsignadoTravadoSgh,
  saldosConsignado,
  solicitacoesOpmeDoPeriodo,
  somenteSgh,
} from '@sgh/legado';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CENTRO_SETOR,
  internacaoComConta,
  itemComSaldo,
  LOCAL_CENTRAL,
  localConsumo,
  usuarioEstoque,
} from '../massa/reproducao-suprimentos.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;

describe.skipIf(!PODE_ESCREVER)('M46 etapa 4 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  // Revisão do M46.4: o retrato inclui as tabelas do legado que o executor grava na baixa do insumo (o lançamento da
  // saída e o saldo do insumo no cadastro e no local), a trilha e a trava do saldo do consignado.
  const retrato = (insumo?: number) =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      consignado: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_CONSIGNADO'),
      trava: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_CONSIG_TRAVA'),
      manipulacao: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_MANIPULACAO'),
      rastreio: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_OPME_RASTREIO'),
      avaliacao: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_AVALIACAO_FARM'),
      trilha: await contar(l, 'SELECT COUNT(*) N FROM SGH_TRILHA'),
      gecadsai: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
      gelansai: await contar(l, 'SELECT MAX(ID_GELANSAI) N FROM GELANSAI'),
      ...(insumo
        ? {
            estoque: await contar(l, 'SELECT CAST(ESTOQUE * 1000 AS BIGINT) N FROM GEITENS WHERE COD = ?', [
              insumo,
            ]),
            local: await contar(
              l,
              'SELECT CAST(SUM(QTDE) * 1000 AS BIGINT) N FROM GEARMLOC WHERE ITEM = ? AND LOCAL = ?',
              [insumo, LOCAL_CENTRAL],
            ),
          }
        : {}),
    }));

  it('as consultas do consignado por fornecedor, das capelas e dos itens a manipular (só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const tMov: number[] = [];
      const tCons: number[] = [];
      let movimentos = 0;
      let consumos = 0;
      for (let i = 0; i < 10; i++) {
        let t = Date.now();
        movimentos = (await movimentosConsignado(l, a.cod, { fornecedor: null })).itens.length;
        tMov.push(Date.now() - t);
        t = Date.now();
        consumos = (await consumosConsignados(l, a.cod, {})).itens.length;
        tCons.push(Date.now() - t);
      }
      const tCad: number[] = [];
      let cadastro = 0;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        cadastro = (await saldoCadastroConsignado(l)).length;
        tCad.push(Date.now() - t);
      }
      const tCap: number[] = [];
      let capelas = 0;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        capelas = (await capelasManipulacao(l)).length;
        tCap.push(Date.now() - t);
      }
      const tFila: number[] = [];
      let fila = 0;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        fila = (await itensAManipular(l, a.cod, '2026-01-01')).itens.length;
        tFila.push(Date.now() - t);
      }
      // As listas do período do OPME (a etapa 3; a correção D-PERIODO-464: o período como data, não como texto).
      const opmeSolic = (await solicitacoesOpmeDoPeriodo(l, a.cod, '2026-10-01', '2026-10-31')).itens.length;
      const opmeCons = (await consumosOpmeDoPeriodo(l, a.cod, '2026-10-01', '2026-10-31')).itens.length;
      return {
        opmeSolic,
        opmeCons,
        movimentos,
        consumos,
        cadastro,
        capelas,
        fila,
        p95Movimentos: p95(tMov),
        p95Consumos: p95(tCons),
        p95Cadastro: p95(tCad),
        p95Capelas: p95(tCap),
        p95Fila: p95(tFila),
      };
    });
    // As medidas (só contagens e tempos) vão ao arquivo pedido, para as evidências.
    if (process.env['M464_MEDIDAS']) writeFileSync(process.env['M464_MEDIDAS'], JSON.stringify(r));
    expect(r.cadastro).toBeGreaterThanOrEqual(0);
    expect(r.opmeSolic + r.opmeCons).toBeGreaterThanOrEqual(0);
    expect(r.capelas).toBeGreaterThanOrEqual(1);
    expect(r.p95Movimentos + r.p95Consumos).toBeLessThan(1_000);
    expect(r.p95Cadastro).toBeLessThan(1_000);
    expect(r.p95Capelas).toBeLessThan(500);
    expect(r.p95Fila).toBeLessThan(1_000);
  });

  it('o consignado: remessa, consumo, reposição e faturamento pela nota da entrada; o consumo reposto de novo recusado; nada no estoque', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      // Uma nota da entrada do estoque com o fornecedor e um item (relida: só o código, o documento e o fornecedor).
      const [nf] = await e.consultar(
        `SELECT FIRST 1 n.ANO, n.MES, n.DOC, c.FORN, n.ITEM FROM GELANNFS n
           JOIN GECADNFS c ON c.ANO = n.ANO AND c.MES = n.MES AND c.DOC = n.DOC
          WHERE c.FORN > 0 ORDER BY n.ID_GELANNFS DESC`,
        [],
        { teto: 1, tempoMaximoMs: 60_000 },
      );
      const forn = num(nf?.['FORN']);
      const item = num(nf?.['ITEM']);
      const doc = { ano: num(nf?.['ANO']), mes: num(nf?.['MES']), doc: num(nf?.['DOC']) };
      const base = { hospital: a.cod, fornecedor: forn, item, usuario: 'SGH.TESTE' };
      const zero = {
        remessas: 0,
        reposicoes: 0,
        consumidos: 0,
        devolvidos: 0,
        saldo: 0,
        aRepor: 0,
        aFaturar: 0,
      };
      const saldoDoPar = async () =>
        (await saldosConsignado(e, a.cod, { fornecedor: forn, item })).itens[0] ?? { ...zero };
      const saldoAntes = await saldoDoPar();
      const linha = {
        quantidade: 1,
        nfNumero: null,
        nfSerie: null,
        nfEmissao: null,
        nfEntrada: null,
        lote: 'SINT-L1',
        serie: null,
        validade: '2030-12-31',
        motivo: null,
      };
      await gravarMovimentosConsignadoSgh(e, {
        ...base,
        chave: `m46e4-rem-${Date.now()}`,
        linhas: [{ ...linha, tipo: 'remessa', quantidade: 3, consumo: null, nfNumero: '900001' }],
      });
      const consumo = (
        await gravarConsumoOpmeSgh(e, {
          hospital: a.cod,
          solicitacao: null,
          versaoVista: null,
          mudanca: null,
          agendamento: 999_464_201,
          sala: 1,
          dataHora: '2026-10-26T08:00',
          reg: 999_464_202,
          paciente: null,
          cirurgiao: null,
          item,
          quantidade: 1,
          saida: { ano: 2026, mes: 10, doc: 999_464 },
          lancamento: 999_464_203,
          loteSaida: null,
          conta: 0,
          itemConta: null,
          lote: 'SINT-L1',
          serie: null,
          fabricante: 'FABRICANTE SINTETICO',
          modelo: null,
          registroAnvisa: '10000000001',
          validade: '2030-12-31',
          codigoLido: null,
          consignado: true,
          fornecedor: forn,
          semAutorizacao: {
            por: 'SGH.TESTE',
            motivo: 'Teste de integração sem solicitação (acentos: ç, ã, é).',
          },
          em: '2026-10-26T08:30',
          usuario: 'SGH.TESTE',
          chave: null,
        })
      ).id;
      await gravarMovimentosConsignadoSgh(e, {
        ...base,
        chave: `m46e4-rep-${Date.now()}`,
        linhas: [{ ...linha, tipo: 'reposicao', consumo }],
      });
      let repetida = 'gravou';
      try {
        await gravarMovimentosConsignadoSgh(e, {
          ...base,
          chave: `m46e4-rep2-${Date.now()}`,
          linhas: [{ ...linha, tipo: 'reposicao', consumo }],
        });
      } catch (x) {
        repetida = x instanceof ErroOperacao ? (x.problema.codigo ?? 'sem-codigo') : 'outro';
      }
      const nota = await notaEntradaConsignado(e, doc, item);
      // Revisão do M46.4: a lista das notas do fornecedor com o item (a escolha do faturamento), com o tempo.
      const tNotas = Date.now();
      const notas = await notasEntradaConsignado(e, forn, item);
      const msNotas = Date.now() - tNotas;
      await gravarMovimentosConsignadoSgh(e, {
        ...base,
        chave: `m46e4-fat-${Date.now()}`,
        linhas: [{ ...linha, tipo: 'faturamento', consumo, nfEntrada: doc }],
      });
      // Uma segunda remessa (sem consumo): a chave única do consumo só vale quando há consumo (a correção 0968).
      await gravarMovimentosConsignadoSgh(e, {
        ...base,
        chave: `m46e4-rem2-${Date.now()}`,
        linhas: [{ ...linha, tipo: 'remessa', quantidade: 1, consumo: null, nfNumero: '900002' }],
      });
      // A devolução ao fornecedor com o motivo acentuado (a correção 0469: o texto CP1252 numa coluna NONE).
      await gravarMovimentosConsignadoSgh(e, {
        ...base,
        chave: `m46e4-dev-${Date.now()}`,
        linhas: [
          { ...linha, tipo: 'devolucao', consumo: null, motivo: 'Devolução do material não usado no mês' },
        ],
      });
      const cs = await consumosConsignados(e, a.cod, { fornecedor: forn, ids: [consumo] });
      // Revisão do M46.4: o saldo somado no banco (sem o teto das listas) e o mesmo saldo relido depois da trava do par.
      const saldoDepois = await saldoDoPar();
      const travado = await saldoConsignadoTravadoSgh(somenteSgh(e), { ...base });
      const tabelas = (await escritasDaTransacao(e)).map((x) => x.tabela);
      return {
        repetida,
        nota,
        c: cs.itens[0],
        tabelas,
        saldoAntes,
        saldoDepois,
        travado,
        notas,
        msNotas,
        doc,
      };
    });
    expect(r.notas.some((n) => n.ano === r.doc.ano && n.mes === r.doc.mes && n.doc === r.doc.doc)).toBe(true);
    expect(r.msNotas).toBeLessThan(1_000);
    // Remessas 3 + 1, a reposição 1, o consumo 1 e a devolução 1: o saldo sobe 3.
    expect(r.saldoDepois.remessas - r.saldoAntes.remessas).toBe(4);
    expect(r.saldoDepois.reposicoes - r.saldoAntes.reposicoes).toBe(1);
    expect(r.saldoDepois.consumidos - r.saldoAntes.consumidos).toBe(1);
    expect(r.saldoDepois.devolvidos - r.saldoAntes.devolvidos).toBe(1);
    expect(r.saldoDepois.saldo - r.saldoAntes.saldo).toBe(3);
    expect(r.saldoDepois.aRepor).toBe(r.saldoAntes.aRepor);
    expect(r.saldoDepois.aFaturar).toBe(r.saldoAntes.aFaturar);
    expect(r.travado).toBe(r.saldoDepois.saldo);
    expect(r.tabelas).toContain('SGH_SUP_CONSIG_TRAVA');
    expect(r.repetida).toBe('consumo-ja-reposto');
    expect(r.nota).toMatchObject({ temItem: true });
    expect(r.c?.reposicao).not.toBeNull();
    expect(r.c?.faturamento?.nf).not.toBeNull();
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(await retrato()).toEqual(antes);
  });

  it('a manipulação: a ordem do item validado, a dupla conferência no banco e a baixa do insumo pelo executor na mesma transação', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await usuarioEstoque(e, login);
      const exec = (entrada: unknown) =>
        a.executor.executar(operacao('suprimentos.registrarSaida'), a.cod, entrada, ctxOperacao(a, login), {
          escritor: e,
        });
      const insumo = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 });
      const reg = await internacaoComConta(e);
      const cons = await localConsumo(e, CENTRO_SETOR);
      const [cap] = await capelasManipulacao(e);
      // A avaliação SINTÉTICA aprovada pela regra (só SGH_; sem FK para a prescrição).
      const [s] = await e.consultar(
        'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_AVALIACAO_FARM AS VARCHAR(20)) ID FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      const av = Number(s?.['ID']);
      await e.executar(
        `INSERT INTO SGH_SUP_AVALIACAO_FARM (ID, HOSPITAL, ID_PRLANGERAL, ID_PRPRESC, REG, CLASSE, DESTINO, PRIORIDADE,
           REGRA, ESTADO) VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, ?, 'comum', 'automatica', 3, 'teste', 'automatico')`,
        [String(av), a.cod, 999_464_301, 999_464_302, reg],
      );
      const fila = await itensAManipular(e, a.cod, '2026-01-01');
      const o = await abrirOrdemManipulacaoSgh(e, {
        hospital: a.cod,
        itemPrescrito: 999_464_301,
        avaliacao: av,
        reg,
        produto: null,
        capela: cap?.id ?? 1,
        grupo: cap?.grupos[0]?.id ?? null,
        insumo: insumo.item,
        local: LOCAL_CENTRAL,
        loteInsumo: 'SINT-INS',
        validadeInsumo: '2030-12-31',
        quantidade: 1,
        dose: null,
        validadeSobra: null,
        em: '2026-10-26T09:00',
        usuario: login,
        chave: `m46e4-ord-${Date.now()}`,
      });
      const saida = {
        destino: 1,
        origem: 'E',
        local: LOCAL_CENTRAL,
        centroCusto: CENTRO_SETOR,
        localConsumo: cons,
        atendimento: reg,
        itens: [{ item: insumo.item, quantidade: 1, lotes: [] }],
      };
      // A baixa da ordem ainda não conferida: recusada antes de gravar (nem a saída fica).
      const maxAntes = await contar(e, 'SELECT MAX(ID) N FROM GECADSAI');
      let semConferencia = 'gravou';
      try {
        await exec({ ...saida, manipulacao: { ordem: o.id, versaoVista: o.versao } });
      } catch (x) {
        semConferencia = x instanceof ErroOperacao ? (x.problema.codigo ?? 'sem-codigo') : 'outro';
      }
      const maxDepois = await contar(e, 'SELECT MAX(ID) N FROM GECADSAI');
      // A dupla conferência pela mesma pessoa: o banco recusa (CHECK), além do domínio.
      let mesmaPessoa = 'gravou';
      try {
        await conferirManipulacaoSgh(e, {
          hospital: a.cod,
          ordem: o.id,
          versaoVista: o.versao,
          situacao: 'conferida',
          observacao: null,
          em: '2026-10-26T09:10',
          usuario: login,
        });
      } catch (x) {
        mesmaPessoa = /CHECK|SGH_CK_SUP_MANIP_DUPLA|validation/i.test(String((x as Error).message))
          ? 'check'
          : 'outro';
      }
      return {
        fila: fila.itens.some((i) => i.itemPrescrito === 999_464_301),
        ordem: o.id,
        semConferencia,
        maxAntes,
        maxDepois,
        mesmaPessoa,
      };
    });
    expect(r.fila).toBe(true);
    expect(r.semConferencia).toBe('ordem-nao-conferida');
    expect(r.maxDepois).toBe(r.maxAntes);
    expect(r.mesmaPessoa).toBe('check');
    expect(await retrato()).toEqual(antes);
  });

  it('a manipulação: a conferência por outra pessoa e a baixa pelo executor ligam a ordem ao lançamento da saída', async () => {
    // O insumo da baixa (o mesmo que a transação escolhe): o saldo dele no cadastro e no local entra no retrato.
    const escolhido = await a.nucleo.lerSomente(ctx(a), (l) =>
      itemComSaldo(l as unknown as Escritor, { local: LOCAL_CENTRAL, minimo: 2 }),
    );
    const antes = await retrato(escolhido.item);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await usuarioEstoque(e, login);
      const insumo = await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 });
      if (insumo.item !== escolhido.item) throw new Error('O insumo da transação difere do retrato.');
      const reg = await internacaoComConta(e);
      const cons = await localConsumo(e, CENTRO_SETOR);
      const [s] = await e.consultar(
        'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_AVALIACAO_FARM AS VARCHAR(20)) ID FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      const av = Number(s?.['ID']);
      await e.executar(
        `INSERT INTO SGH_SUP_AVALIACAO_FARM (ID, HOSPITAL, ID_PRLANGERAL, ID_PRPRESC, REG, CLASSE, DESTINO, PRIORIDADE,
           REGRA, ESTADO) VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, ?, 'comum', 'automatica', 3, 'teste', 'automatico')`,
        [String(av), a.cod, 999_464_401, 999_464_402, reg],
      );
      const o = await abrirOrdemManipulacaoSgh(e, {
        hospital: a.cod,
        itemPrescrito: 999_464_401,
        avaliacao: av,
        reg,
        produto: null,
        capela: 1,
        grupo: null,
        insumo: insumo.item,
        local: LOCAL_CENTRAL,
        loteInsumo: 'SINT-INS',
        validadeInsumo: '2030-12-31',
        quantidade: 1,
        dose: null,
        validadeSobra: null,
        em: '2026-10-26T09:00',
        usuario: 'SGH.FARM.A',
        chave: `m46e4-ord2-${Date.now()}`,
      });
      const c = await conferirManipulacaoSgh(e, {
        hospital: a.cod,
        ordem: o.id,
        versaoVista: o.versao,
        situacao: 'conferida',
        observacao: null,
        em: '2026-10-26T09:10',
        usuario: 'SGH.FARM.B',
      });
      // A reprovação com a observação acentuada numa ordem paralela (a correção 0469).
      const [s2] = await e.consultar(
        'SELECT CAST(NEXT VALUE FOR SGH_GEN_SUP_AVALIACAO_FARM AS VARCHAR(20)) ID FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      await e.executar(
        `INSERT INTO SGH_SUP_AVALIACAO_FARM (ID, HOSPITAL, ID_PRLANGERAL, ID_PRPRESC, REG, CLASSE, DESTINO, PRIORIDADE,
           REGRA, ESTADO) VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, ?, ?, ?, 'comum', 'automatica', 3, 'teste', 'automatico')`,
        [String(s2?.['ID']), a.cod, 999_464_501, 999_464_502, reg],
      );
      const o2 = await abrirOrdemManipulacaoSgh(e, {
        hospital: a.cod,
        itemPrescrito: 999_464_501,
        avaliacao: Number(s2?.['ID']),
        reg,
        produto: null,
        capela: 1,
        grupo: null,
        insumo: insumo.item,
        local: LOCAL_CENTRAL,
        loteInsumo: 'SINT-INS',
        validadeInsumo: '2030-12-31',
        quantidade: 1,
        dose: 'Solução a 0,9%',
        validadeSobra: null,
        em: '2026-10-26T09:00',
        usuario: 'SGH.FARM.A',
        chave: `m46e4-ord3-${Date.now()}`,
      });
      await conferirManipulacaoSgh(e, {
        hospital: a.cod,
        ordem: o2.id,
        versaoVista: o2.versao,
        situacao: 'reprovada',
        observacao: 'Diluição diferente da prescrição médica',
        em: '2026-10-26T09:12',
        usuario: 'SGH.FARM.B',
      });
      const reprovada = await ordemManipulacao(e, a.cod, o2.id);
      const sai = await a.executor.executar(
        operacao('suprimentos.registrarSaida'),
        a.cod,
        {
          destino: 1,
          origem: 'E',
          local: LOCAL_CENTRAL,
          centroCusto: CENTRO_SETOR,
          localConsumo: cons,
          atendimento: reg,
          itens: [{ item: insumo.item, quantidade: 1, lotes: [] }],
          manipulacao: { ordem: o.id, versaoVista: c.versao },
        },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const [lanc] = await e.consultar(
        'SELECT ID_GELANSAI FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ?',
        [num(sai.resultado['ano']), num(sai.resultado['mes']), num(sai.resultado['doc'])],
        { teto: 1 },
      );
      const depois = await ordemManipulacao(e, a.cod, o.id);
      const antigas = await contar(e, 'SELECT COUNT(*) N FROM GEMANIPULMP');
      return { depois, lancamento: num(lanc?.['ID_GELANSAI']), antigas, reprovada };
    });
    expect(r.depois).toMatchObject({
      situacao: 'baixada',
      lancamento: r.lancamento,
      conferidoPor: 'SGH.FARM.B',
    });
    expect(r.lancamento).toBeGreaterThan(0);
    expect(r.antigas).toBe(0);
    expect(r.reprovada).toMatchObject({
      situacao: 'reprovada',
      observacao: 'Diluição diferente da prescrição médica',
    });
    expect(await retrato(escolhido.item)).toEqual(antes);
  });

  it('revisão do M46.4: duas devoluções simultâneas do mesmo fornecedor e item: a segunda espera a trava do par e recusa', async () => {
    const antes = await retrato();
    const par = { hospital: a.cod, fornecedor: 999_464_401, item: 999_464_402, usuario: 'SGH.TESTE' };
    const motivo = 'Devolução simultânea sintética do teste';
    const devolver = async (e: Escritor, chave: string) => {
      const es = somenteSgh(e);
      const saldo = await saldoConsignadoTravadoSgh(es, par);
      await gravarMovimentosConsignadoSgh(es, {
        ...par,
        chave,
        linhas: [
          {
            tipo: 'devolucao',
            quantidade: 1,
            consumo: null,
            nfNumero: null,
            nfSerie: null,
            nfEmissao: null,
            nfEntrada: null,
            lote: null,
            serie: null,
            validade: null,
            motivo,
          },
        ],
      });
      return saldo;
    };
    let soltar: () => void = () => undefined;
    let pronto: (v: string) => void = () => undefined;
    const primeiro = new Promise<string>((x) => (pronto = x));
    // A primeira transação trava o par, devolve e fica aberta (sem confirmar).
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      await devolver(e, `m46e4-dev-a-${Date.now()}`);
      pronto('gravou');
      await new Promise<void>((x) => (soltar = x));
    });
    const r1 = await primeiro;
    const t0 = performance.now();
    let r2 = 'gravou';
    try {
      await a.nucleo.desfazendoNaCopia(ctx(a), (e: Escritor) => devolver(e, `m46e4-dev-b-${Date.now()}`));
    } catch (x) {
      r2 =
        x instanceof ErroOperacao
          ? (x.problema.codigo ?? 'sem-codigo')
          : /lock|deadlock|conflict|PRIMARY or UNIQUE/i.test(String((x as Error).message))
            ? 'trava'
            : String((x as Error).message).slice(0, 80);
    }
    const ms = Math.round(performance.now() - t0);
    soltar();
    await segurando;
    console.log(`[${a.cod}] devolução simultânea: primeira ${r1}, segunda ${r2} em ${ms} ms`);
    expect(r1).toBe('gravou');
    expect(['trava', 'registro-em-edicao']).toContain(r2);
    expect(await retrato()).toEqual(antes);
  }, 300_000);
});
