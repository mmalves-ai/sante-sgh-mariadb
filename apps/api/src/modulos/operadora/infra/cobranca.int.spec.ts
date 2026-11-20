// M56 (etapa 3, F2) na cópia. Duas partes:
//   1. o serviço da cobrança inteiro sobre o banco real, numa transação SEMPRE desfeita, em cima da carteira sintética
//      da F1 (operadora → plano individual com coparticipação de 30% → contrato de pessoa física com dia de vencimento →
//      titular e dependente): reajuste (no aniversário, registrado e cancelado), prévia e geração das mensalidades de
//      três competências (a segunda geração não repete; a inclusão direta repetida bate no índice único do banco),
//      lista e contagens (tempo), ficha com os itens, coparticipação e avulsa, baixa (valor conferido; versão velha
//      recusada), estorno, inadimplência (notificar → notificado), acordo das vencidas (parcelas e renegociadas) e
//      cancelamento; só SGH_OPE_COBRANCA, SGH_OPE_COBRANCA_ITEM, SGH_OPE_REAJUSTE, as da F1 e a SGH_TRILHA escritas;
//      depois do ROLLBACK, nada fica (o retrato do COUNT(*) de cada tabela da etapa e da trilha igual antes e depois, e
//      toda tabela escrita na transação está no retrato);
//   2. a porta do legado de verdade (READ ONLY): a fatia da cobrança desligada no estabelecimento (regra 1; M61: na transação desfeita), os tipos de
//      cobrança do domínio do banco iguais aos da regra 6 (1 a 4), as leituras sem a operadora e a gravação recusada em
//      dev sobre a cópia compartilhada (`sghSoLeitura`).
// Dados SINTÉTICOS; no log, só contagens, códigos e tempos.
import { TIPOS_COBRANCA_OPERADORA } from '@sgh/contratos';
import { somarCompetencia } from '@sgh/dominio-operadora';
import {
  type ChaveGravada,
  contarLinhas,
  escritasDaTransacao,
  incluirCobrancaSgh,
  lerDominioOperadora,
  type NucleoLegado,
  type PrerequisitoGravado,
  somenteSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import { portaCobrancaOperadoraLegado } from '../cobranca-porta-legado.js';
import { ServicoCobrancaOperadora } from '../cobranca-servico.js';
import {
  COD,
  codigoDe,
  criarNucleo,
  montarCarteira,
  PODE,
  servicoNaTransacao,
  sessao,
  USUARIO,
} from './copia.spec-util.js';
import { situacaoComChavesDesligadas } from './chaves-desligadas.spec-util.js';

let nucleo: NucleoLegado;
beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  await nucleo.verificarSchema(COD);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
});
const pre = (recurso: string, tipo: PrerequisitoGravado['tipo']): PrerequisitoGravado => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: USUARIO,
  alteradoEm: '2026-10-24T10:00:00',
});
const fonteLigada = {
  chaves: async () => [chave('operadora'), chave('operadora.beneficiarios'), chave('operadora.cobranca')],
  prerequisitos: async () => [pre('operadora', 'credenciamento'), pre('operadora.cobranca', 'contrato')],
} as unknown as FonteConfiguracao;

/** As tabelas SGH_ que o ciclo pode escrever (as da F1, as da F2 e a trilha): o retrato antes e depois do ROLLBACK. */
const TABELAS_DO_CICLO = [
  'SGH_OPE_OPERADORA',
  'SGH_OPE_PRODUTO',
  'SGH_OPE_CONTRATO',
  'SGH_OPE_BENEFICIARIO',
  'SGH_OPE_CARTEIRINHA',
  'SGH_OPE_PRESTADOR',
  'SGH_OPE_PRESTADOR_MOV',
  'SGH_OPE_COBRANCA',
  'SGH_OPE_COBRANCA_ITEM',
  'SGH_OPE_REAJUSTE',
  'SGH_TRILHA',
] as const;

describe.skipIf(!PODE)('cobrança e mensalidades da operadora na cópia (etapa 3, F2)', () => {
  it('o ciclo da cobrança sobre a carteira sintética, só SGH_, desfeito no fim', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-3' };
    // A trilha da cobrança do usuário do teste (pela leitura de @sgh/legado), antes e depois do ROLLBACK.
    const trilhaCobranca = async (l: Parameters<typeof trilhaDaOperadoraPorRecurso>[0]) =>
      (await trilhaDaOperadoraPorRecurso(l, COD, USUARIO))['operadora.cobranca'] ?? 0;
    const antes = await nucleo.lerSomente(ctx, trilhaCobranca);
    // O retrato: COUNT(*) de cada tabela do ciclo (só contagens).
    const retrato = () =>
      nucleo.lerSomente(ctx, async (l) => {
        const x: Record<string, number> = {};
        for (const t of TABELAS_DO_CICLO) x[t] = await contarLinhas(l, t);
        return x;
      });
    const retratoAntes = await retrato();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico: f1 } = servicoNaTransacao(e);
      const naTransacao = ((_c: unknown, fn: (l: typeof e) => Promise<unknown>) =>
        fn(e)) as NucleoLegado['lerSomente'];
      const porta = portaCobrancaOperadoraLegado({
        lerSomente: naTransacao,
        gravarSgh: naTransacao as never,
      });
      const servico = new ServicoCobrancaOperadora(
        porta,
        new ServicoSituacaoOperadora(fonteLigada, null),
        null,
        'dev',
      );
      const s = sessao(nucleo.rede);
      const k = await montarCarteira(f1, s, { registro: '990563', base: '99063', diaVencimento: 10 });
      const hoje = await porta.hoje(s.porta);
      const atual = hoje.slice(0, 7);
      const [c1, c2, c3] = [
        somarCompetencia(atual, -2),
        somarCompetencia(atual, -1),
        somarCompetencia(atual, 1),
      ];
      // Reajuste no aniversário (maio; o primeiro 12 meses depois do início): registrado e cancelado (não cobrado).
      const reaj = await servico.reajustar(s, {
        contrato: k.contrato,
        competencia: '2027-05',
        percentual: 6.91,
        tetoAns: 6.91,
        oficioAns: 'Ofício sintético da integração',
        motivo: 'Reajuste anual sintético',
      });
      const reajRepetido = await codigoDe(
        servico.reajustar(s, {
          contrato: k.contrato,
          competencia: '2027-05',
          percentual: 6.91,
          tetoAns: 6.91,
          oficioAns: 'Ofício sintético da integração',
          motivo: 'Reajuste anual sintético',
        }),
      );
      const reajustes = await servico.reajustes(s, { operadora: k.operadora });
      await servico.cancelarReajuste(s, reaj.id, 'Cancelado na integração sintética');
      // Mensalidades: prévia e geração de três competências; a segunda geração não repete.
      const previa = (await servico.mensalidades(
        s,
        { operadora: k.operadora, competencia: c3, contrato: null },
        false,
      )) as { quantidade: number; valorTotal: number };
      const geradas: number[] = [];
      for (const c of [c1, c2, c3])
        geradas.push(
          (
            (await servico.mensalidades(
              s,
              { operadora: k.operadora, competencia: c, contrato: k.contrato },
              true,
            )) as {
              geradas: number;
            }
          ).geradas,
        );
      const deNovo = (await servico.mensalidades(
        s,
        { operadora: k.operadora, competencia: c3, contrato: k.contrato },
        true,
      )) as { geradas: number; jaGeradas: number };
      // O índice único do banco recusa a mensalidade repetida mesmo sem o serviço.
      const indice = await codigoDe(
        incluirCobrancaSgh(somenteSgh(e), {
          hospital: COD,
          operadora: k.operadora,
          contrato: k.contrato,
          beneficiario: null,
          tipo: 1,
          competencia: c3,
          descricao: 'Repetida sintética',
          valor: 1,
          vencimento: `${c3}-10`,
          acordoOrigem: null,
          parcela: null,
          parcelas: null,
          itens: [],
          por: USUARIO,
        }),
      );
      // Lista (tempo), contagens e ficha.
      const tempos: number[] = [];
      let lista = await servico.cobrancas(s, { operadora: k.operadora, vencidas: false });
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        lista = await servico.cobrancas(s, { operadora: k.operadora, vencidas: false });
        tempos.push(performance.now() - t0);
      }
      tempos.sort((a, b) => a - b);
      const futura = lista.itens.find((x) => x.competencia === c3)!;
      const ficha = await servico.detalhe(s, futura.id);
      // Coparticipação do dependente e avulsa.
      const cp = await servico.coparticipacao(s, {
        beneficiario: k.dependente,
        competencia: c3,
        vencimento: `${c3}-10`,
        valorEvento: 250,
        descricao: 'Consulta sintética',
      });
      const av = await servico.avulsa(s, {
        contrato: k.contrato,
        beneficiario: null,
        competencia: c3,
        vencimento: `${c3}-10`,
        valor: 15,
        descricao: 'Taxa sintética',
      });
      // Baixa da futura em dia; versão velha; estorno; nova baixa.
      const errado = await codigoDe(
        servico.baixar(s, futura.id, {
          versao: futura.versao,
          pagoEm: hoje,
          valorPago: 1,
          dispensarEncargos: false,
          motivoDispensa: null,
        }),
      );
      const bx = await servico.baixar(s, futura.id, {
        versao: futura.versao,
        pagoEm: hoje,
        valorPago: futura.valor,
        dispensarEncargos: false,
        motivoDispensa: null,
      });
      // A versão velha numa cobrança em aberto chega ao banco: 0 linha alterada.
      const velha = await codigoDe(
        servico.cancelar(s, cp.id, { versao: cp.versao + 5, motivo: 'Versão velha sintética da integração' }),
      );
      const es = await servico.estornar(s, futura.id, {
        versao: bx.versao,
        motivo: 'Estorno sintético da integração',
      });
      await servico.baixar(s, futura.id, {
        versao: es.versao,
        pagoEm: hoje,
        valorPago: futura.valor,
        dispensarEncargos: false,
        motivoDispensa: null,
      });
      // Inadimplência: as duas vencidas (c1 e c2).
      const t1 = performance.now();
      const ina1 = await servico.inadimplencia(s, { operadora: k.operadora });
      const msInadimplencia = performance.now() - t1;
      await servico.notificar(s, {
        contrato: k.contrato,
        em: hoje,
        meio: 'carta-ar',
        referencia: 'AR sintético',
      });
      const ina2 = await servico.inadimplencia(s, { operadora: k.operadora });
      // Acordo das vencidas em 2 parcelas a partir de hoje.
      const vencidas = (await servico.cobrancas(s, { operadora: k.operadora, vencidas: true })).itens.filter(
        (x) => x.tipo === 1,
      );
      const acordo = await servico.acordo(s, {
        contrato: k.contrato,
        cobrancas: vencidas.map((x) => ({ id: x.id, versao: x.versao })),
        parcelas: 2,
        primeiroVencimento: hoje,
        dispensarEncargos: false,
        motivoDispensa: null,
      });
      const parcela = await servico.detalhe(s, acordo.parcelas[0]!);
      const totais = (await servico.cobrancas(s, { operadora: k.operadora, vencidas: false })).totais;
      await servico.cancelar(s, av.id, { versao: av.versao, motivo: 'Cancelamento sintético da integração' });
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      const trilha = (await trilhaCobranca(e)) - antes;
      return {
        operadora: k.operadora,
        reajRepetido,
        reajustes: reajustes.itens.length,
        previa,
        geradas,
        deNovo,
        indice,
        p95: tempos[Math.floor(tempos.length * 0.95) - 1] ?? tempos.at(-1)!,
        lista: lista.itens.length,
        ficha,
        cp: (await servico.detalhe(s, cp.id)).valor,
        errado,
        velha,
        ina1: ina1.itens.find((i) => i.contrato === k.contrato),
        ina2: ina2.itens.find((i) => i.contrato === k.contrato),
        msInadimplencia,
        vencidas: vencidas.length,
        acordo,
        parcela,
        totais,
        tabelas,
        trilha,
      };
    });
    expect(r.reajRepetido).toBe('reajuste-ja-registrado');
    expect(r.reajustes).toBe(1);
    // Titular de 46 anos na faixa 44 a 48 (200) e dependente de 11 (100), sem reajuste.
    expect(r.previa).toMatchObject({ quantidade: 1, valorTotal: 300 });
    expect(r.geradas).toEqual([1, 1, 1]);
    expect(r.deNovo).toMatchObject({ geradas: 0, jaGeradas: 1 });
    expect(r.indice).toBe('mensalidade-ja-gerada');
    expect(r.p95).toBeLessThan(300);
    expect(r.lista).toBe(3);
    expect(r.ficha.itens.map((i) => i.valor)).toEqual([200, 100]);
    expect(r.ficha.pagadorDocumento).toMatch(/^\*\*\*\./);
    expect(r.cp).toBe(75);
    expect(r.errado).toBe('valor-divergente');
    expect(r.velha).toBe('cobranca-desatualizada');
    expect(r.ina1).toMatchObject({ situacao: 'notificar', vencidas: 2, mensalidadesEmAtraso12m: 2 });
    expect(r.ina2).toMatchObject({ situacao: 'aguardando-prazo', notificacaoMeio: 'carta-ar' });
    expect(r.msInadimplencia).toBeLessThan(500);
    expect(r.vencidas).toBe(2);
    expect(r.acordo.parcelas).toHaveLength(2);
    expect(r.parcela).toMatchObject({ tipo: 4, parcela: 1, parcelas: 2 });
    expect(r.parcela.renegociadas).toHaveLength(2);
    // Abertas: as 2 parcelas, a coparticipação e a avulsa (cancelada depois); a futura foi paga.
    expect(r.totais).toMatchObject({ abertas: 4, pagasNoMes: 1 });
    // Só SGH_ (as da F1, as da F2 e a trilha); nenhuma tabela do outro sistema.
    expect(r.tabelas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining(['SGH_OPE_COBRANCA', 'SGH_OPE_COBRANCA_ITEM', 'SGH_OPE_REAJUSTE', 'SGH_TRILHA']),
    );
    // Uma linha de trilha por gravação da F2: 2 reajustes (registro e cancelamento), 3 gerações, coparticipação,
    // avulsa, 2 baixas e o estorno, notificação, acordo e cancelamento (a segunda geração não grava nada).
    expect(r.trilha).toBe(13);
    // Toda tabela escrita na transação está no retrato.
    expect(
      r.tabelas
        .filter((t) => !t.startsWith('RDB$'))
        .filter((t) => !(TABELAS_DO_CICLO as readonly string[]).includes(t)),
    ).toEqual([]);
    // ROLLBACK: nada fica (o retrato das contagens igual, e a trilha da cobrança do usuário do teste também).
    const retratoDepois = await retrato();
    expect(retratoDepois).toEqual(retratoAntes);
    expect(await nucleo.lerSomente(ctx, trilhaCobranca)).toBe(antes);
    const depois = portaCobrancaOperadoraLegado(nucleo, { sghSoLeitura: true });
    expect(
      (await depois.cobrancas({ rede: nucleo.rede, hospital: COD }, { operadora: r.operadora })).itens,
    ).toEqual([]);
    console.log(
      `[int-m56.3] ${COD}: ciclo F2 desfeito; tabelas escritas ${r.tabelas.length} (só SGH_), retrato de ${TABELAS_DO_CICLO.length} tabelas igual depois do ROLLBACK; trilha ${r.trilha}; lista p95 ${r.p95.toFixed(1)} ms; inadimplência ${r.msInadimplencia.toFixed(1)} ms; acordo ${r.acordo.parcelas.length} parcelas`,
    );
  });

  it('a porta do legado: a fatia desligada, os tipos de cobrança do banco (1 a 4), as leituras e a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: COD };
    const porta = portaCobrancaOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, COD, 'SINT.OPE.COBRANCA', [
      'operadora.cobranca',
      'operadora.mensagens',
    ]);
    expect(s.fatias.find((f) => f.chave === 'operadora.cobranca')?.situacao).toBe('desligada');
    expect(s.fatias.find((f) => f.chave === 'operadora.mensagens')?.situacao).toBe('desligada');
    const tipos = await nucleo.lerSomente({ ...c, traceId: 'int-m56-3' }, (l) =>
      lerDominioOperadora(l, 'TBTIPOCOBRANCASGO'),
    );
    expect(tipos.map((t) => t.id)).toEqual(Object.keys(TIPOS_COBRANCA_OPERADORA).map(Number));
    const hoje = await porta.hoje(c);
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t0 = performance.now();
    const lista = await porta.cobrancas(c, { operadora: 0 });
    const ina = await porta.inadimplentes(c, { operadora: 0, hoje });
    const ms = performance.now() - t0;
    expect(lista.itens).toEqual([]);
    expect(ina.itens).toEqual([]);
    expect(await porta.totais(c, 0, hoje)).toMatchObject({ abertas: 0 });
    expect(await porta.contrato(c, 0)).toBeNull();
    await expect(porta.gravarSgh(c, {} as never, async () => 1)).rejects.toMatchObject({ status: 403 });
    console.log(
      `[int-m56.3] ${COD}: fatia da cobrança e das mensagens desligadas; tipos de cobrança ${tipos.length} (iguais à regra 6); leituras vazias em ${ms.toFixed(1)} ms; gravação recusada em dev`,
    );
  });
});
