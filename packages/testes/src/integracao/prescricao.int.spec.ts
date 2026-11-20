// Prescrição na cópia (ficha do M24, seção 10), pelo EXECUTOR, em transação desfeita (ROLLBACK): um médico da cópia
// (login e CBO só em memória) prescreve para um atendimento aberto um medicamento por intervalo e um cuidado, com os
// horários previstos pela grade da unidade; o relido pelos leitores da prescrição confere item a item (plano,
// frequência, via, horários pendentes 'P') e a prova guardada (SGH_PEP_PRESC_DOC) confere com o hash do estado do
// legado; outra prescrição no mesmo período é recusada (uma ativa por atendimento e período); o adendo entra marcado
// como incluído depois; a suspensão do item marca os horários 'S' com o mesmo conjunto de quem suspende; a
// suspensão da prescrição fecha o resto (justificativa com o corpus CP1252, relida igual); o ROLLBACK devolve tudo
// (maiores chaves e contagens SGH_). Também: a disputa com o item suspenso pelo outro sistema enquanto o médico copia
// (recusa, sem sobrescrever), a trava de outra conexão além do LOCK TIMEOUT ("registro em edição") e a exceção do
// TRG_PRPRESC_BIU traduzida. Saída só com contagens.
import {
  atendimentoDaPrescricao,
  dadosClinicosDoPaciente,
  ErroOperacao,
  hashLegadoDaPrescricao,
  itensDaPrescricao,
  operacao,
  prescricoesRecentes,
  problemaDaOperacao,
  provaDaPrescricao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  estadoPrescricao,
  prescritorDaCopia,
} from '../massa/reproducao-prescricao.js';
import { CORPUS_CP1252 } from '../massa/reproducao-pep-m23.js';
import {
  justificativaDaSuspensao,
  marcasContaEstoque,
  prescricoesDepoisDe,
  semContaNemEstoque,
  suspenderItemComoOLegado,
  suspensaoDaPrescricao,
  suspensaoIncompletaComoOLegado,
  travarPrescricaoComoOLegado,
} from '../massa/simulacao-legado-m24.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

/** Documento do evento sem item novo (o cabeçalho é congelado na prescrição). */
const DOC_MINIMO =
  '<?xml version="1.0" encoding="Windows-1252" standalone="no"?><documento><versaoXML>1</versaoXML></documento>';

describe.skipIf(!PODE_ESCREVER)('prescrição na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let antes: number[];
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), async (l) => estadoPrescricao(l));
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('prescrever, reler, recusar a segunda, adendo, suspender item e prescrição; tudo desfeito', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const medico = await prescritorDaCopia(e, '2251');
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const usados: number[] = [];
      const itens = [
        await itemDaForma(e, { tipo: 'medicamento', frequencia: 11, horarios: 4 }, 0, c, usados),
        await itemDaForma(e, { tipo: 'procedimento', frequencia: 9, horarios: 3 }, 1, c, usados),
      ];
      const g = await gravacaoDe(e, at, medico, itens, c);
      const op = { escritor: e };
      // Regra 16: nem a conta nem o estoque mudam com a prescrição (a conta segue pela saída de estoque).
      const marcas = await marcasContaEstoque(e, usados);
      const s = await a.executor.executar(
        operacao('pep.prescrever'),
        a.cod,
        g,
        ctxOperacao(a, medico.login),
        op,
      );
      const prescricao = num(s.resultado['prescricao']);
      const lidos = await itensDaPrescricao(e, prescricao);
      const previstos = g.itens.reduce((t, i) => t + i.horarios.length, 0);
      const prova = await provaDaPrescricao(e, a.cod, prescricao);
      const hash = await hashLegadoDaPrescricao(e, prescricao);

      let recusa = '';
      try {
        await a.executor.executar(operacao('pep.prescrever'), a.cod, g, ctxOperacao(a, medico.login), op);
      } catch (x) {
        recusa = x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : String(x);
      }

      const adendo = await itemDaForma(e, { tipo: 'procedimento', frequencia: 5, horarios: 2 }, 2, c, usados);
      const gAdendo = await gravacaoDe(e, at, medico, [adendo], c);
      const inc = await a.executor.executar(
        operacao('pep.incluirItem'),
        a.cod,
        {
          prescricao,
          paciente: at.paciente,
          atendimento: at.id,
          cbo: medico.cbo,
          item: gAdendo.itens[0],
          documento: gAdendo.documento,
          hashConteudo: gAdendo.hashConteudo,
          sgh: { ...gAdendo.sgh, itens: [], decisoes: [], fichas: [], futuras: [] },
        },
        ctxOperacao(a, medico.login),
        op,
      );
      const itemMed = lidos.find((x) => x.plano === 6)!;
      const susp = await a.executor.executar(
        operacao('pep.suspenderItem'),
        a.cod,
        {
          prescricao,
          item: itemMed.id,
          paciente: at.paciente,
          atendimento: at.id,
          cbo: medico.cbo,
          justificativa: 'Suspensao SINTETICO M24 por troca de conduta',
          correcao: null,
          documento: DOC_MINIMO,
          hashConteudo: g.hashConteudo,
          comoSuporte: false,
        },
        ctxOperacao(a, medico.login),
        op,
      );
      const depoisItem = await itensDaPrescricao(e, prescricao);
      const suspP = await a.executor.executar(
        operacao('pep.suspenderPrescricao'),
        a.cod,
        {
          prescricao,
          paciente: at.paciente,
          atendimento: at.id,
          cbo: medico.cbo,
          justificativa: `Suspensao SINTETICO M24 ${CORPUS_CP1252}`,
          documento: DOC_MINIMO,
          hashConteudo: g.hashConteudo,
          comoSuporte: false,
        },
        ctxOperacao(a, medico.login),
        op,
      );
      const fim = await itensDaPrescricao(e, prescricao);
      const js = await justificativaDaSuspensao(e, prescricao);
      const sit = (ls: typeof lidos) =>
        ls.flatMap((i) => i.horarios.filter((h) => !h.acessoria).map((h) => h.situacao)).join('');
      return {
        itens: lidos.length,
        planos: lidos.map((x) => x.plano).sort((x, y) => x - y),
        horarios: lidos.reduce((t, i) => t + i.horarios.filter((h) => !h.acessoria).length, 0),
        previstos,
        pendentes: /^P+$/.test(sit(lidos)),
        prova: prova.eventos.length === 1 && prova.eventos[0]?.hashLegado === hash,
        recusa,
        adendo: num(inc.resultado['item']) > 0 && fim.some((x) => x.incluidoEm !== null),
        suspensosItem: num(susp.resultado['horarios']),
        itemTodoS: depoisItem.find((x) => x.id === itemMed.id)!.horarios.every((h) => h.situacao === 'S'),
        suspensosPrescricao: num(suspP.resultado['horarios']),
        tudoS: /^S+$/.test(sit(fim)),
        corpus: String(js ?? '').trim() === `Suspensao SINTETICO M24 ${CORPUS_CP1252}`,
        contaEstoque: await semContaNemEstoque(e, marcas, usados),
      };
    });
    expect(r.itens).toBe(2);
    expect(r.planos).toEqual([6, 13]);
    expect(r.horarios).toBe(r.previstos);
    expect(r.pendentes).toBe(true);
    expect(r.prova).toBe(true);
    expect(r.recusa).toBe('outra-ativa-no-periodo');
    expect(r.adendo).toBe(true);
    expect(r.suspensosItem).toBeGreaterThan(0);
    expect(r.itemTodoS).toBe(true);
    expect(r.suspensosPrescricao).toBeGreaterThan(0);
    expect(r.tudoS).toBe(true);
    expect(r.corpus).toBe(true);
    expect(r.contaEstoque).toEqual({ conta: 0, saida: 0, saldoIgual: true });
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => estadoPrescricao(l));
    expect(depois).toEqual(antes);
  }, 300_000);

  it('disputa: item suspenso pelo outro sistema enquanto o médico copia — recusa, sem sobrescrever; exceção do gatilho traduzida', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const medico = await prescritorDaCopia(e, '2251');
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const usados: number[] = [];
      const itens = [
        await itemDaForma(e, { tipo: 'medicamento', frequencia: 11, horarios: 4 }, 0, c, usados),
        await itemDaForma(e, { tipo: 'procedimento', frequencia: 9, horarios: 3 }, 1, c, usados),
      ];
      const g = await gravacaoDe(e, at, medico, itens, c);
      const op = { escritor: e };
      const s = await a.executor.executar(
        operacao('pep.prescrever'),
        a.cod,
        g,
        ctxOperacao(a, medico.login),
        op,
      );
      const origem = num(s.resultado['prescricao']);
      const lidos = await itensDaPrescricao(e, origem);
      // A tela do novo abriu a cópia com os dois itens ativos; o outro sistema suspende o medicamento.
      const med = lidos.find((x) => x.plano === 6)!;
      await suspenderItemComoOLegado(e, med.id);
      const copia = await gravacaoDe(e, at, medico, itens, c, {
        periodo: 'depois',
        origem: { prescricao: origem, modo: 'copia', itens: lidos.map((x) => ({ item: x.id, ativo: true })) },
      });
      let recusa = '';
      try {
        await a.executor.executar(
          operacao('pep.copiarPrescricao'),
          a.cod,
          copia,
          ctxOperacao(a, medico.login),
          op,
        );
      } catch (x) {
        recusa = x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : String(x);
      }
      const n = await prescricoesDepoisDe(e, at.id, origem);
      const medDepois = (await itensDaPrescricao(e, origem)).find((x) => x.id === med.id)!;
      // A suspensão pela metade feita pelo outro sistema: o gatilho recusa e a recusa vem traduzida.
      let gatilho = '';
      try {
        await suspensaoIncompletaComoOLegado(e, origem);
      } catch (x) {
        gatilho = String(problemaDaOperacao(x).codigo ?? '');
      }
      return {
        recusa,
        novas: n,
        medicamentoSuspenso: medDepois.horarios.filter((h) => !h.acessoria).every((h) => h.situacao === 'S'),
        gatilho,
      };
    });
    expect(r).toEqual({
      recusa: 'origem-alterada',
      novas: 0,
      medicamentoSuspenso: true,
      gatilho: 'suspensao-incompleta',
    });
  }, 300_000);

  it('dados do paciente para o cálculo de dose (regra 12): cadastro e a última creatinina liberada, com as datas', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const at = await atendimentoDaPrescricao(l, (await prescricoesRecentes(l, 1))[0]!.atendimento);
      const d = await dadosClinicosDoPaciente(l, at!.paciente);
      return {
        pesoOk: d.pesoKg === null || (d.pesoKg > 0 && d.pesoKg < 500),
        dataPeso: d.pesoKg === null || d.dataPeso === null || /^\d{4}-\d{2}-\d{2}$/.test(d.dataPeso),
        creatininaOk:
          d.creatinina === null || (d.creatinina > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.dataCreatinina ?? '')),
        sexoOk: d.sexo === null || d.sexo === 'F' || d.sexo === 'M',
      };
    });
    expect(r).toEqual({ pesoOk: true, dataPeso: true, creatininaOk: true, sexoOk: true });
  }, 120_000);

  it('LOCK TIMEOUT: outra conexão segura a prescrição e a suspensão devolve "registro em edição", nada gravado', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => {
      for (const p of await prescricoesRecentes(l, 50)) {
        const s = await suspensaoDaPrescricao(l, p.prescricao);
        const at = await atendimentoDaPrescricao(l, p.atendimento);
        if (s === null && at) return { ...p, paciente: at.paciente };
      }
      return null;
    });
    if (!alvo) throw new Error('Nenhuma prescrição vigente recente na cópia.');
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await travarPrescricaoComoOLegado(e, alvo.prescricao);
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let codigo = '';
    let suspensa = true;
    const inicio = Date.now();
    try {
      await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const medico = await prescritorDaCopia(e, '2251');
        try {
          await a.executor.executar(
            operacao('pep.suspenderPrescricao'),
            a.cod,
            {
              prescricao: alvo.prescricao,
              paciente: alvo.paciente,
              atendimento: alvo.atendimento,
              cbo: medico.cbo,
              justificativa: 'Suspensao SINTETICO M24 com a linha travada',
              documento: DOC_MINIMO,
              hashConteudo: 'a'.repeat(64),
              comoSuporte: false,
            },
            ctxOperacao(a, medico.login),
            { escritor: e },
          );
        } catch (x) {
          codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : String(x);
        }
        suspensa = (await suspensaoDaPrescricao(e, alvo.prescricao)) !== null;
      });
    } finally {
      soltar();
      await segurando;
    }
    expect(codigo).toBe('registro-em-edicao');
    expect(suspensa).toBe(false);
    console.log(`[${a.cod}] trava: registro em edição em ${Date.now() - inicio} ms`);
  }, 1_200_000);
});
