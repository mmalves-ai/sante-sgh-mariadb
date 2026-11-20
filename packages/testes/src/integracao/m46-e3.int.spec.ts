// Etapa 3 do M46 sobre a cópia (ficha, seções 4, 5, 10 e 11), sempre em transação desfeita e sob a trava:
//   - as consultas do OPME com os tempos (os itens da classe 50 com o saldo do almoxarifado, os itens das contas de 200
//     internações e o rastreio reverso de um lote do estoque): só contagens e tempos;
//   - a seção 10 (o "rastreio-reverso" e a saída de OPME): a cirurgia agendada pelo executor e o OPME solicitado e
//     autorizado (só SGH_); a saída do OPME ao paciente internado com a conta aberta grava o rastreio na MESMA transação
//     (o lançamento da saída ligado), sobe a solicitação e a etapa; a mesma saída para a internação sem conta no período
//     é recusada e nada fica (nem o rastreio); o rastreio reverso pelo lote acha o consumo; o cancelamento da cirurgia
//     pelo caminho do outro sistema passa e a solicitação fica com a chave natural (nenhuma FK para a agenda); nenhuma
//     tabela antiga de OPME do estoque (GE*OPME) é tocada;
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import {
  avancarEtapaOpmeSgh,
  consumosOpmeDosAgendamentos,
  documentosCompraOpme,
  ErroOperacao,
  escritasDaTransacao,
  itensDaContaOpme,
  itensOpme,
  localComSaldoOpme,
  localDaSaidaOpme,
  operacao,
  rastreioReversoOpme,
  solicitacaoOpme,
  solicitarOpmeSgh,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { carregarDominiosVistos } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diaLivreDaSala, MARCA_CC_M18, profissionais } from '../massa/reproducao-cirurgia.js';
import {
  CENTRO_SETOR,
  internacaoComConta,
  internacaoSemConta,
  itemComSaldo,
  LOCAL_CENTRAL,
  localConsumo,
  opmeDaSaida,
  usuarioEstoque,
} from '../massa/reproducao-suprimentos.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
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

describe.skipIf(!PODE_ESCREVER)('M46 etapa 3 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  const tiposLogradouro =
    carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
    new Set<string>();

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      solic: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_OPME_SOLIC'),
      etapas: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_OPME_ETAPA'),
      rastreio: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_OPME_RASTREIO'),
      gecadsai: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
      ccagenda: await contar(l, 'SELECT MAX(ID) N FROM CCAGENDA'),
    }));

  it('as consultas do OPME: itens com saldo, itens das contas e o rastreio reverso de um lote (só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [hoje] = await l.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) D FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const dia = String(hoje?.['D'] ?? '').slice(0, 10);
      const tItens: number[] = [];
      let itens = 0;
      for (let i = 0; i < 10; i++) {
        const t = Date.now();
        itens = (await itensOpme(l, { termo: '', local: LOCAL_CENTRAL, hoje: dia })).itens.length;
        tItens.push(Date.now() - t);
      }
      const contas = (
        await l.consultar("SELECT FIRST 200 COD FROM FCCTAEXT WHERE TIPO_CTA = 'I' ORDER BY ID DESC", [], {
          teto: 200,
        })
      ).map((x) => num(x['COD']));
      // Os itens de OPME do período (318 itens distintos saíram em 2025: até 30 num mês).
      const itens50 = (
        await l.consultar('SELECT FIRST 30 COD FROM GEITENS WHERE CLASSIF = 50 ORDER BY COD', [], {
          teto: 30,
        })
      ).map((x) => num(x['COD']));
      const tConta: number[] = [];
      let lancados = 0;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        lancados = (await itensDaContaOpme(l, contas, itens50)).length;
        tConta.push(Date.now() - t);
      }
      // Um lote do estoque com saídas (o rastreio reverso conta as saídas do lote e procura os consumos em sala).
      const [lt] = await l.consultar(
        `SELECT FIRST 1 g.ITEM, s.LOTE FROM GERASVALSAIDLOTE s JOIN GELANSAI g ON g.ID_GELANSAI = s.ID_GELANSAI
          WHERE s.ID > (SELECT MAX(ID) - 1000 FROM GERASVALSAIDLOTE) AND s.LOTE > '' ORDER BY s.ID DESC`,
        [],
        { teto: 1, tempoMaximoMs: 60_000 },
      );
      const tRas: number[] = [];
      let saidasDoLote = 0;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        saidasDoLote = (
          await rastreioReversoOpme(l, a.cod, {
            item: num(lt?.['ITEM']),
            lote: String(lt?.['LOTE'] ?? ''),
            serie: null,
          })
        ).saidasDoLote;
        tRas.push(Date.now() - t);
      }
      // Correções da revisão: o local sugerido (o primeiro dos locais com saldo de OPME) e os documentos de compra
      // relidos (o pedido e a nota mais recentes do cadastro, só se existem).
      const locais = (
        await l.consultar('SELECT FIRST 20 COD FROM GELOCARM ORDER BY COD', [], { teto: 20 })
      ).map((x) => num(x['COD']));
      const tLocal: number[] = [];
      let sugerido: number | null = null;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        sugerido = await localComSaldoOpme(l, locais);
        tLocal.push(Date.now() - t);
      }
      const [ped] = await l.consultar(
        "SELECT FIRST 1 ANO, DOC, FORN FROM GECADPED WHERE OQUE = 'P' AND FORN > 0 ORDER BY ID DESC",
        [],
        { teto: 1 },
      );
      const [nfl] = await l.consultar(
        'SELECT FIRST 1 ANO, MES, DOC, FORN FROM GECADNFS ORDER BY ID DESC',
        [],
        {
          teto: 1,
        },
      );
      const tDoc: number[] = [];
      let docs: Awaited<ReturnType<typeof documentosCompraOpme>> | null = null;
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        docs = await documentosCompraOpme(l, {
          fornecedor: num(ped?.['FORN']),
          pedido: { ano: num(ped?.['ANO']), doc: num(ped?.['DOC']) },
          nf: { ano: num(nfl?.['ANO']), mes: num(nfl?.['MES']), doc: num(nfl?.['DOC']) },
        });
        tDoc.push(Date.now() - t);
      }
      const inexistente = await documentosCompraOpme(l, {
        fornecedor: 999_999_999,
        pedido: { ano: 2001, doc: 999_999_999 },
        nf: { ano: 2001, mes: 1, doc: 999_999_999 },
      });
      return {
        locaisConferidos: locais.length,
        sugeridoComSaldo: sugerido !== null,
        p95Local: p95(tLocal),
        pedidoAchado: (docs?.pedido?.fornecedores ?? []).includes(num(ped?.['FORN'])),
        fornecedorAchado: docs?.fornecedor !== null,
        nfAchada: docs?.nf?.fornecedor === num(nfl?.['FORN']),
        inexistentesRecusaveis:
          inexistente.fornecedor === null && inexistente.pedido === null && inexistente.nf === null,
        p95Documentos: p95(tDoc),
        itensComSaldo: itens < 5 ? '<5' : itens,
        p95Itens: p95(tItens),
        contas: contas.length,
        itensDaClasse: itens50.length,
        lancadosOpme: lancados < 5 ? '<5' : lancados,
        p95Conta: p95(tConta),
        loteComSaidas: saidasDoLote > 0,
        p95Rastreio: p95(tRas),
      };
    });
    console.log(`[${a.cod}] M46.3 consultas: ${JSON.stringify(r)}`);
    expect(r.contas).toBe(200);
    expect(r.loteComSaidas).toBe(true);
    // Metas da seção 4: itens p95 < 500 ms; conciliação p95 < 1 s; rastreio reverso p95 < 2 s.
    expect(r.p95Itens).toBeLessThan(500);
    expect(r.p95Conta).toBeLessThan(1_000);
    expect(r.p95Rastreio).toBeLessThan(2_000);
    expect(r).toMatchObject({
      sugeridoComSaldo: true,
      pedidoAchado: true,
      fornecedorAchado: true,
      nfAchada: true,
      inexistentesRecusaveis: true,
    });
    expect(r.p95Local).toBeLessThan(500);
    expect(r.p95Documentos).toBeLessThan(500);
  });

  it('seção 10: a saída de OPME com conta aberta grava o rastreio; com a conta fechada recusa; o rastreio reverso acha; o cancelamento passa', async () => {
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
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      await usuarioEstoque(e, login);
      // A cirurgia agendada (o paciente sintético) e o OPME pedido e autorizado para ela (só SGH_).
      const SALA = 1;
      await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario: login, acao: 'incluir' });
      const dia = await diaLivreDaSala(e, SALA);
      const [cir, an] = await profissionais(e, 2);
      const cpf = await cpfLivre(e, (Date.now() + 4631) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep))).resultado[
          'idPaciente'
        ],
      );
      const ag = await exec('cirurgia.agendarCirurgia', {
        sala: SALA,
        data: dia,
        hora: '0700',
        duracaoMin: 90,
        intervaloMin: 0,
        paciente: pac,
        reg: 0,
        atendimento: 'I',
        especialidade: 33,
        convenio: 306,
        procedimento: 30_101_271,
        anestesia: 1,
        equipe: { cirurgiao: cir, anestesista: an },
        pediatra: null,
        recursos: [],
        procedimentosAdicionais: [],
        carater: 2,
        solicitacao: null,
        excecao: null,
        observacao: `${MARCA_CC_M18}: integração M46.3`,
      });
      const agenda = num(ag.resultado['agendamento']);
      const item = (await itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2, classe: 50 })).item;
      const reg = await internacaoComConta(e);
      const s = await solicitarOpmeSgh(e, {
        hospital: a.cod,
        agendamento: agenda,
        sala: SALA,
        dataHora: `${dia}T07:00`,
        reg,
        paciente: pac,
        item,
        tuss: '70000014',
        quantidade: 1,
        fornecedor: null,
        justificativa: 'Integração M46.3: material especial (sintético).',
        consignado: false,
        em: `${dia}T06:00`,
        usuario: login,
        chave: null,
      });
      const aut = await avancarEtapaOpmeSgh(e, {
        hospital: a.cod,
        solicitacao: s.id,
        versaoVista: s.versao,
        etapa: 'autorizacao',
        em: `${dia}T06:10`,
        quantidade: 1,
        senha: 'SINT-SENHA',
        guia: 'SINT-GUIA',
        validade: '2030-12-31',
        usuario: login,
        chave: null,
        mudanca: {
          situacao: 'autorizada',
          autorizada: 1,
          senha: 'SINT-SENHA',
          guia: 'SINT-GUIA',
          validade: '2030-12-31',
        },
      });
      const cons = await localConsumo(e, CENTRO_SETOR);
      const saida = (atendimento: number, opme: ReturnType<typeof opmeDaSaida>) => ({
        destino: 1,
        origem: 'E',
        local: LOCAL_CENTRAL,
        centroCusto: CENTRO_SETOR,
        localConsumo: cons,
        atendimento,
        itens: [{ item, quantidade: 1, lotes: [] }],
        opme: { ...opme, agendamento: agenda, sala: SALA, dataHora: `${dia}T07:00`, paciente: pac },
      });
      // A saída com a conta aberta: o rastreio na mesma transação.
      const sai = await exec(
        'suprimentos.registrarSaida',
        saida(reg, opmeDaSaida({ solicitacao: s.id, versaoVista: aut.versao })),
      );
      const [lanc] = await e.consultar(
        'SELECT ID_GELANSAI FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ?',
        [num(sai.resultado['ano']), num(sai.resultado['mes']), num(sai.resultado['doc'])],
      );
      const consumos = await consumosOpmeDosAgendamentos(e, a.cod, [agenda]);
      // A devolução volta ao local de onde a saída partiu: o local relido da própria saída.
      const localDaSaida = consumos[0] ? await localDaSaidaOpme(e, consumos[0].saida) : null;
      const sol = await solicitacaoOpme(e, a.cod, s.id);
      // A conta fechada: recusada antes de gravar, nada fica.
      const rastreioAntes = await contar(
        e,
        'SELECT COUNT(*) N FROM SGH_SUP_OPME_RASTREIO WHERE ID_CCAGENDA = ?',
        [agenda],
      );
      let fechada = 'gravou';
      try {
        await exec(
          'suprimentos.registrarSaida',
          saida(
            await internacaoSemConta(e),
            opmeDaSaida({ solicitacao: null, versaoVista: null, semAutorizacaoPor: login }),
          ),
        );
      } catch (x) {
        fechada =
          x instanceof ErroOperacao ? (x.problema.codigo ?? 'recusa') : (x as Error).message.slice(0, 80);
      }
      const rastreioDepois = await contar(
        e,
        'SELECT COUNT(*) N FROM SGH_SUP_OPME_RASTREIO WHERE ID_CCAGENDA = ?',
        [agenda],
      );
      // O rastreio reverso pelo lote do consumo.
      const reverso = await rastreioReversoOpme(e, a.cod, { item, lote: 'L-SINT-463', serie: null });
      // O cancelamento pelo caminho do outro sistema (a cópia e a exclusão da agenda).
      let cancelamento = 'passou';
      try {
        await exec('cirurgia.cancelarCirurgia', {
          agendamento: agenda,
          motivo: 'PAC-CLINICO',
          solicitante: 'equipe',
          suspender: false,
        });
      } catch (x) {
        cancelamento =
          x instanceof ErroOperacao ? (x.problema.codigo ?? 'recusa') : (x as Error).message.slice(0, 80);
      }
      const agendaApagada = (await contar(e, 'SELECT COUNT(*) N FROM CCAGENDA WHERE ID = ?', [agenda])) === 0;
      const solFica = (await solicitacaoOpme(e, a.cod, s.id))?.id === s.id;
      const escritas = await escritasDaTransacao(e);
      return {
        rastreioLigado: consumos.length === 1 && consumos[0]?.lancamento === num(lanc?.['ID_GELANSAI']),
        rastreioConta: (consumos[0]?.conta ?? 0) > 0,
        situacao: sol?.situacao,
        consumida: sol?.consumida,
        etapas: sol?.etapas.map((x) => x.etapa),
        fechada,
        nadaNaFechada: rastreioDepois === rastreioAntes,
        reverso: reverso.expostos.some((x) => x.agendamento === agenda && x.atendimento === reg),
        localDaSaida: localDaSaida === LOCAL_CENTRAL,
        cancelamento,
        agendaApagada,
        solFica,
        opmeAntigoTocado: escritas.some((w) => /^GE[A-Z]*OPME/.test(w.tabela) || w.tabela === 'GEPARAM'),
        sghOpme: [
          ...new Set(escritas.filter((w) => w.tabela.startsWith('SGH_SUP_OPME')).map((w) => w.tabela)),
        ].sort(),
      };
    });
    console.log(`[${a.cod}] M46.3 seção 10: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({
      rastreioLigado: true,
      rastreioConta: true,
      situacao: 'consumida',
      consumida: 1,
      etapas: ['solicitacao', 'autorizacao', 'consumo'],
      fechada: 'sem-conta-convenio',
      nadaNaFechada: true,
      reverso: true,
      localDaSaida: true,
      cancelamento: 'passou',
      agendaApagada: true,
      solFica: true,
      opmeAntigoTocado: false,
    });
    expect(r.sghOpme).toEqual(['SGH_SUP_OPME_ETAPA', 'SGH_SUP_OPME_RASTREIO', 'SGH_SUP_OPME_SOLIC']);
    expect(await retrato()).toEqual(antes);
  });
});
