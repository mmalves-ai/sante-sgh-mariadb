// Checagem da administração na cópia (ficha do M25, seção 10), pelo EXECUTOR, em transação desfeita (ROLLBACK): um
// médico da cópia prescreve (pep.prescrever, M24) e um profissional de enfermagem da cópia checa o primeiro horário
// (login e CBO só em memória). Confere: a prova pós-escrita (o horário relido "A"); a idempotência (a mesma chave
// devolve o resultado original, sem nova gravação); a checagem concorrente (o horário checado "pelo outro sistema" por
// SQL de teste entre a leitura e o "Salvar" é recusado, sem sobrescrever); a vigia (a mudança aparece na leitura
// incremental da janela); a regra 15 (nenhuma linha em FCLANEXT nem em GELANSAI, saldo igual); o ROLLBACK devolve
// tudo (maiores chaves e contagens SGH_). E o WITH LOCK sem espera: outra conexão segura um horário pendente gravado
// na cópia e a checagem devolve "registro em edição" na hora, nada gravado. E o aprazamento do novo (aprazar,
// reaprazar com o motivo e suprimir) gravado em SGH_PEP_APRAZAMENTO, com o horário da prescrição intacto (previsto e
// situação de aprazamento iguais). Saída só com contagens e tempos.
import {
  aprazamentosDosHorarios,
  ErroOperacao,
  gravarAprazamento,
  horarioPorId,
  mudancasNaJanela,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enfermagemDaCopia,
  entradaDaChecagem,
  estadoEnfermagem,
  horariosDaPrescricao,
} from '../massa/reproducao-enfermagem.js';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  prescritorDaCopia,
} from '../massa/reproducao-prescricao.js';
import { marcasContaEstoque, semContaNemEstoque } from '../massa/simulacao-legado-m24.js';
import {
  checarComoOLegado,
  horarioPendenteDaCopia,
  rastroDosHorarios,
  travarHorarioComoOLegado,
} from '../massa/simulacao-legado-m25.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const t0Teste = Date.now();
/** Progresso com o tempo (a cópia é compartilhada: um passo parado aparece no log). */
const passo = (s: string) => console.log(`[m25] ${s} (${Math.round((Date.now() - t0Teste) / 1000)} s)`);
const codigo = (x: unknown) => (x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : String(x));

describe.skipIf(!PODE_ESCREVER)('checagem da administração na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let antes: number[];
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), async (l) => estadoEnfermagem(l));
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('checar, provar, repetir a chave, recusar a checagem concorrente, vigia e sem conta nem estoque; tudo desfeito', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const medico = await prescritorDaCopia(e, '2251');
      const enf = await enfermagemDaCopia(e, medico);
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const usados: number[] = [];
      const item = await itemDaForma(e, { tipo: 'medicamento', frequencia: 9, horarios: 3 }, 0, c, usados);
      const g = await gravacaoDe(e, at, medico, [item], c);
      const op = { escritor: e };
      const p = await a.executor.executar(
        operacao('pep.prescrever'),
        a.cod,
        g,
        ctxOperacao(a, medico.login),
        op,
      );
      const prescricao = num(p.resultado['prescricao']);
      passo('prescrito');
      const hs = (await horariosDaPrescricao(e, prescricao)).filter((h) => h.faixa === null);
      const [primeiro, segundo] = hs;
      if (!primeiro || !segundo) throw new Error('A prescrição de partida não gravou dois horários.');
      const marcas = await marcasContaEstoque(e, usados);
      passo('marcas da conta e do estoque');
      const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
      const agora = ag?.['T'] as Date;
      const comum = { prescricao, atendimento: at.id, paciente: at.paciente, cbo: enf.cbo };
      const entrada = entradaDaChecagem(
        { ...comum, horario: primeiro, situacao: 'A', quantidade: 1, justificativa: null },
        agora,
      );
      const chave = `int-m25-${Date.now().toString(36)}`;
      const t0 = performance.now();
      const r1 = await a.executor.executar(
        operacao('enfermagem.checarAdministracao'),
        a.cod,
        entrada,
        ctxOperacao(a, enf.login, chave),
        op,
      );
      const ms = performance.now() - t0;
      const relido = await horarioPorId(e, primeiro.id, a.cod);
      const ids = [primeiro.id, segundo.id];
      const depoisPrimeira = await rastroDosHorarios(e, ids);
      passo('checado e relido');
      // A mesma chave reenviada (a sincronização depois da queda de rede): o resultado original, sem gravar.
      const r2 = await a.executor.executar(
        operacao('enfermagem.checarAdministracao'),
        a.cod,
        entrada,
        ctxOperacao(a, enf.login, chave),
        op,
      );
      const depoisRepetida = await rastroDosHorarios(e, ids);
      passo('chave repetida');
      // Concorrência: o outro sistema checa o segundo horário entre a leitura ("P") e o "Salvar" do novo.
      const legado = await checarComoOLegado(e, segundo.id);
      const antesDaRecusa = await rastroDosHorarios(e, ids);
      let recusa = '';
      try {
        await a.executor.executar(
          operacao('enfermagem.checarAdministracao'),
          a.cod,
          entradaDaChecagem(
            { ...comum, horario: segundo, situacao: 'A', quantidade: 1, justificativa: null },
            agora,
          ),
          ctxOperacao(a, enf.login),
          op,
        );
      } catch (x) {
        recusa = codigo(x);
      }
      const estadoDepoisRecusa = await rastroDosHorarios(e, ids);
      passo('concorrente recusada');
      const vigia = await mudancasNaJanela(e, {
        inicio: new Date(agora.getTime() - 48 * 3_600_000),
        fim: new Date(agora.getTime() + 48 * 3_600_000),
        desde: new Date(agora.getTime() - 60_000),
      });
      passo('vigia lida');
      return {
        situacao: relido?.situacao ?? null,
        repetida: r2.repetida,
        mesmoResultado: JSON.stringify(r2.resultado) === JSON.stringify(r1.resultado),
        semNovaGravacao: JSON.stringify(depoisRepetida) === JSON.stringify(depoisPrimeira),
        legado,
        recusa,
        recusaSemGravar: JSON.stringify(estadoDepoisRecusa) === JSON.stringify(antesDaRecusa),
        vigiaViu: vigia.some((m) => m.id === primeiro.id && m.situacao === 'A'),
        contaEstoque: await semContaNemEstoque(e, marcas, usados),
        ms,
      };
    });
    expect({ ...r, ms: undefined }).toEqual({
      situacao: 'A',
      repetida: true,
      mesmoResultado: true,
      semNovaGravacao: true,
      legado: 1,
      recusa: 'horario-ja-checado',
      recusaSemGravar: true,
      vigiaViu: true,
      contaEstoque: { conta: 0, saida: 0, saldoIgual: true },
      ms: undefined,
    });
    console.log(`[${a.cod}] checagem na cópia em ${Math.round(r.ms)} ms`);
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => estadoEnfermagem(l));
    expect(depois).toEqual(antes);
  }, 1_500_000);

  it('WITH LOCK sem espera: outra conexão segura o horário e a checagem devolve "registro em edição", nada gravado', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => horarioPendenteDaCopia(l));
    if (!alvo) throw new Error('Nenhum horário pendente recente na cópia.');
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await travarHorarioComoOLegado(e, alvo.horario);
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let recusa = '';
    let situacao: string | null = null;
    const inicio = Date.now();
    try {
      await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const enf = await enfermagemDaCopia(e);
        const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
        try {
          await a.executor.executar(
            operacao('enfermagem.checarAdministracao'),
            a.cod,
            entradaDaChecagem(
              {
                prescricao: alvo.prescricao,
                atendimento: alvo.atendimento,
                paciente: alvo.paciente,
                cbo: enf.cbo,
                horario: { id: alvo.horario, item: alvo.item, previsto: ag?.['T'] as Date, faixa: null },
                situacao: 'A',
                quantidade: 1,
                justificativa: null,
              },
              ag?.['T'] as Date,
            ),
            ctxOperacao(a, enf.login),
            { escritor: e },
          );
        } catch (x) {
          recusa = codigo(x);
        }
        situacao = (await horarioPorId(e, alvo.horario, a.cod))?.situacao ?? null;
      });
    } finally {
      soltar();
      await segurando;
    }
    const ms = Date.now() - inicio;
    expect(recusa).toBe('registro-em-edicao');
    expect(situacao).toBe('P');
    console.log(`[${a.cod}] trava do horário: registro em edição em ${ms} ms`);
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => estadoEnfermagem(l));
    expect(depois).toEqual(antes);
  }, 1_200_000);

  it('aprazamento do novo: aprazar, reaprazar com motivo e suprimir em SGH_PEP_APRAZAMENTO; o horário fica intacto', async () => {
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => horarioPendenteDaCopia(l));
    if (!alvo) throw new Error('Nenhum horário pendente recente na cópia.');
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const antesH = await horarioPorId(e, alvo.horario, a.cod);
      if (!antesH) throw new Error('Horário de partida não relido.');
      // Soma de minutos sobre o texto local (sem fuso): o proposto é o previsto mais 30 e mais 60 minutos.
      const mais = (t: string, m: number) =>
        new Date(Date.parse(`${t.slice(0, 16)}:00Z`) + m * 60_000).toISOString().slice(0, 16);
      const base = {
        hospital: a.cod,
        horario: alvo.horario,
        item: alvo.item,
        paciente: alvo.paciente,
        previsto: antesH.previsto,
        usuario: 'SINT.ENF.PLANTAO',
      };
      const [c0] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_PEP_APRAZAMENTO WHERE HOSPITAL = ? AND ID_PRCHKGERAL = ?',
        [a.cod, alvo.horario],
        { teto: 1 },
      );
      const ids = [
        await gravarAprazamento(e, {
          ...base,
          acao: 'aprazar',
          proposto: mais(antesH.previsto, 30),
          confirmado: mais(antesH.previsto, 30),
          motivo: null,
        }),
        await gravarAprazamento(e, {
          ...base,
          acao: 'reaprazar',
          proposto: mais(antesH.previsto, 60),
          confirmado: mais(antesH.previsto, 60),
          motivo: 'paciente em exame de imagem',
        }),
        await gravarAprazamento(e, {
          ...base,
          acao: 'suprimir',
          proposto: antesH.previsto,
          confirmado: antesH.previsto,
          motivo: 'jejum para procedimento',
        }),
      ];
      const [c1] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_PEP_APRAZAMENTO WHERE HOSPITAL = ? AND ID_PRCHKGERAL = ?',
        [a.cod, alvo.horario],
        { teto: 1 },
      );
      const ultimo = (await aprazamentosDosHorarios(e, a.cod, [alvo.horario])).get(alvo.horario);
      const depoisH = await horarioPorId(e, alvo.horario, a.cod);
      passo('aprazamento gravado e relido');
      return {
        novos: num(c1?.['N'] ?? 0) - num(c0?.['N'] ?? 0),
        idsCrescentes: ids[0]! < ids[1]! && ids[1]! < ids[2]!,
        ultimaAcao: ultimo?.acao ?? null,
        ultimoMotivo: ultimo?.motivo ?? null,
        previstoIgual: depoisH?.previsto === antesH.previsto,
        aprazamentoIgual: depoisH?.aprazamento === antesH.aprazamento,
        situacaoIgual: depoisH?.situacao === antesH.situacao,
      };
    });
    expect(r).toEqual({
      novos: 3,
      idsCrescentes: true,
      ultimaAcao: 'suprimir',
      ultimoMotivo: 'jejum para procedimento',
      previstoIgual: true,
      aprazamentoIgual: true,
      situacaoIgual: true,
    });
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => estadoEnfermagem(l));
    expect(depois).toEqual(antes);
  }, 1_200_000);
});
