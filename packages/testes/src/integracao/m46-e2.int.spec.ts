// Etapa 2 do M46 sobre a cópia (ficha, seções 4, 6, 10 e 11), sempre em transação desfeita e sob a trava:
//   - os domínios do bloco lidos da cópia (os cinco locais e os cinco tipos de movimentação) e o tempo das leituras do
//     quadro do bloco (checklists, movimentos e códigos do painel de 100 agendamentos recentes; só contagens e tempos);
//   - a seção 10: a cirurgia agendada pelo executor, o checklist (entrada e pausa cirúrgica) e o rastreio (entrada com o
//     código do painel e a ida à sala) gravados em SGH_; o cancelamento pelo caminho do outro sistema (a cópia e a
//     exclusão da CCAGENDA pela receita compatível) PASSA, e os registros SGH_ ficam com a chave natural (sala, data e
//     hora) — a prova da regra 12 (nenhuma PRFA_* nem tabela antiga de movimentação tocada);
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import { LISTA_CHECKLIST_V1 } from '@sgh/contratos';
import {
  abrirChecklistSgh,
  checklistDoAgendamento,
  checklistsDosAgendamentos,
  codigosDoPainel,
  concluirMomentoChecklistSgh,
  confirmarItensChecklistSgh,
  contextoAnestesia,
  dominiosRastreio,
  ErroOperacao,
  escritasDaTransacao,
  movimentosDoAgendamento,
  movimentosDosAgendamentos,
  moverPacienteBlocoSgh,
  operacao,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { carregarDominiosVistos } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diaLivreDaSala, MARCA_CC_M18, profissionais } from '../massa/reproducao-cirurgia.js';
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
const USUARIO = 'SGH.TESTE.M46';
const respostas = (momento: string) =>
  LISTA_CHECKLIST_V1.itens
    .filter((i) => i.momento === momento)
    .map((i) => ({
      item: i.codigo,
      resposta: i.tipo === 'pergunta' ? ('nao' as const) : ('sim' as const),
      observacao: null,
    }));

describe.skipIf(!PODE_ESCREVER)('M46 etapa 2 na cópia (transação desfeita)', () => {
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
      checklists: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_CHECKLIST'),
      itens: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_CHECKLIST_ITEM'),
      movimentos: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_MOVIMENTO'),
      codigos: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_PAINEL_CODIGO'),
      ccagenda: await contar(l, 'SELECT MAX(ID) N FROM CCAGENDA'),
      exccanc: await contar(l, 'SELECT COUNT(*) N FROM CCAGENDA_EXC_CANC'),
    }));

  it('os domínios do bloco e o tempo das leituras do quadro (só contagens e tempos)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const t0 = Date.now();
      const d = await dominiosRastreio(l);
      const msDominios = Date.now() - t0;
      const amostra = (
        await l.consultar('SELECT FIRST 100 ID FROM CCAGENDA ORDER BY ID DESC', [], { teto: 100 })
      ).map((x) => num(x['ID']));
      const tempos: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = Date.now();
        await checklistsDosAgendamentos(l, a.cod, amostra);
        await movimentosDosAgendamentos(l, a.cod, amostra);
        await codigosDoPainel(l, a.cod, '2026-10-25T08:00', amostra);
        tempos.push(Date.now() - t);
      }
      tempos.sort((x, y) => x - y);
      return {
        locais: d.locais.length,
        tipos: d.tipos.length,
        sala: d.locais.find((x) => x.id === 3)?.nome.includes('SALA') ?? false,
        msDominios,
        amostra: amostra.length,
        p95: tempos[Math.ceil(tempos.length * 0.95) - 1],
      };
    });
    console.log(`[${a.cod}] M46.2 domínios e quadro: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({ locais: 5, tipos: 5, sala: true });
    expect(r.p95).toBeLessThan(500);
  });

  it('seção 10: checklist e rastreio em SGH_; o cancelamento pelo caminho do outro sistema passa e a chave natural fica', async () => {
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
      const SALA = 1;
      await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario: login, acao: 'incluir' });
      const dia = await diaLivreDaSala(e, SALA);
      const [cir, an] = await profissionais(e, 2);
      const cpf = await cpfLivre(e, (Date.now() + 7927) % 90_000_000);
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
        observacao: `${MARCA_CC_M18}: integração M46.2`,
      });
      const id = num(ag.resultado['agendamento']);
      const contexto = await contextoAnestesia(e, id);
      const base = {
        hospital: a.cod,
        agendamento: id,
        sala: SALA,
        dataHora: `${dia}T07:00`,
        reg: 0,
        paciente: contexto?.paciente ?? null,
      };
      // O checklist: a entrada e a pausa cirúrgica concluídas (a versão otimista recusa a gravação velha).
      const k = await abrirChecklistSgh(e, { ...base, lista: 1, usuario: USUARIO });
      let v = k.versao;
      let mudou = '';
      for (const [momento, hora] of [
        ['inducao', '06:50'],
        ['incisao', '07:05'],
      ] as const) {
        v = (
          await confirmarItensChecklistSgh(e, {
            hospital: a.cod,
            checklist: k.id,
            versaoVista: v,
            momento,
            em: `${dia}T${hora}`,
            itens: respostas(momento),
            profissional: null,
            usuario: USUARIO,
            chave: `int-m462-${momento}-${Date.now()}`,
          })
        ).versao;
        v = (
          await concluirMomentoChecklistSgh(e, {
            checklist: k.id,
            versaoVista: v,
            momento,
            em: `${dia}T${hora}`,
            usuario: USUARIO,
          })
        ).versao;
      }
      try {
        await concluirMomentoChecklistSgh(e, {
          checklist: k.id,
          versaoVista: v - 1,
          momento: 'saida',
          em: `${dia}T09:00`,
          usuario: USUARIO,
        });
      } catch (x) {
        mudou = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      // O rastreio: a entrada com o código do painel e a ida à sala.
      const mov = {
        ...base,
        localAnterior: null,
        salaCirurgica: null,
        destino: null,
        observacao: null,
        estadoAgendamento: null,
        usuario: USUARIO,
        chave: null,
      };
      const ent = await moverPacienteBlocoSgh(e, {
        ...mov,
        ultimoVisto: 0,
        tipo: 'admissao',
        local: 1,
        em: `${dia}T06:30`,
        codigo: { dia, sortear: () => 'KMR-347', validoAte: `${dia}T23:59` },
      });
      await moverPacienteBlocoSgh(e, {
        ...mov,
        ultimoVisto: ent.sequencia,
        tipo: 'transferencia',
        local: 3,
        localAnterior: 1,
        salaCirurgica: SALA,
        em: `${dia}T06:55`,
        codigo: null,
      });
      const lido = await checklistDoAgendamento(e, a.cod, id, { travar: true });
      // O cancelamento pelo caminho do outro sistema (a cópia e a exclusão da CCAGENDA, como o Delphi faz).
      let cancelamento = 'passou';
      try {
        await exec('cirurgia.cancelarCirurgia', {
          agendamento: id,
          motivo: 'PAC-CLINICO',
          solicitante: 'equipe',
          suspender: false,
        });
      } catch (x) {
        cancelamento =
          x instanceof ErroOperacao ? (x.problema.codigo ?? 'recusa') : (x as Error).message.slice(0, 80);
      }
      const existe = await contar(e, 'SELECT COUNT(*) N FROM CCAGENDA WHERE ID = ?', [id]);
      const checklistDepois = await checklistDoAgendamento(e, a.cod, id);
      const movsDepois = await movimentosDoAgendamento(e, a.cod, id);
      const codigos = await codigosDoPainel(e, a.cod, `${dia}T08:00`, [id]);
      const chaveNatural = await contar(
        e,
        `SELECT COUNT(*) N FROM SGH_CC_CHECKLIST WHERE HOSPITAL = ? AND SALA = ? AND DATA_HORA = CAST(CAST(? AS VARCHAR(10)) || ' 07:00:00' AS TIMESTAMP)`,
        [a.cod, SALA, dia],
      );
      const escritas = await escritasDaTransacao(e);
      return {
        checklistVersao: lido?.versao,
        timeout: lido?.timeoutEm?.slice(11),
        itens: lido?.confirmacoes.length,
        versaoAntiga: mudou,
        codigo: ent.codigo,
        cancelamento,
        agendaApagada: existe === 0,
        checklistFica: checklistDepois?.id === k.id,
        movimentosFicam: movsDepois.length,
        codigoFica: codigos.get(id)?.codigo ?? null,
        chaveNatural,
        legadoAntigoTocado: escritas.some(
          (w) =>
            w.tabela.startsWith('PRFA_') ||
            w.tabela === 'CCMOVIMENTACAOPAC' ||
            w.tabela === 'CCLOCALIZACAOBLC',
        ),
        sghCirurgia: [
          ...new Set(escritas.filter((w) => w.tabela.startsWith('SGH_CC_')).map((w) => w.tabela)),
        ].sort(),
      };
    });
    console.log(`[${a.cod}] M46.2 seção 10: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({
      checklistVersao: 5,
      timeout: '07:05',
      itens: 14,
      versaoAntiga: 'checklist-mudou',
      codigo: 'KMR-347',
      cancelamento: 'passou',
      agendaApagada: true,
      checklistFica: true,
      movimentosFicam: 2,
      codigoFica: 'KMR-347',
      chaveNatural: 1,
      legadoAntigoTocado: false,
    });
    expect(r.sghCirurgia).toEqual(
      expect.arrayContaining([
        'SGH_CC_CHECKLIST',
        'SGH_CC_CHECKLIST_ITEM',
        'SGH_CC_MOVIMENTO',
        'SGH_CC_PAINEL_CODIGO',
      ]),
    );
    expect(await retrato()).toEqual(antes);
  });
});
