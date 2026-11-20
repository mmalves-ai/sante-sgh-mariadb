// Jornada assistencial ponta a ponta sobre a cópia (ficha do M27, seções 1, 10 e 11; cap-14 §14.2.4 J1, J4, J5 e J9;
// cap-15 §15.2.3): o MESMO paciente sintético atravessa "agendar → atender → internar → prescrever → evoluir → exame →
// alta" pelas operações dos marcos M17 a M26, todas pelo EXECUTOR do M04, numa transação só (DESFEITA no fim, sob a
// trava da cópia). Cada passo confere o efeito no banco (a linha que a assinatura do marco descreve), a trilha dupla
// (a do outro sistema e a SGH_), a conta que o gatilho do atendimento cria, o horário que a prescrição deixa para a
// enfermagem, o resultado liberado que a fila do médico vê como "resultado novo", e o leito liberado com a limpeza
// pedida na alta. A checagem à beira do leito é do M25 (não construído): o passo confere só o horário aprazado.
// Saída só com contagens e tempos (nenhum nome, nenhum valor de linha). Parte `hs` em Bloqueio (HS-1).
import { contarResultados, respostasSinteticas } from '@sgh/dominio-pep';
import {
  carregarDominiosVistos,
  type Escritor,
  FORMAS_PRESCREVER,
  guiasAguardandoAutorizacao,
  leiturasDaWorklistMedico,
  lerExameSadt,
  operacao,
  painelPacientes,
  registrarAltaMedica,
  senhasDoDia,
} from '@sgh/legado';
import { chamavel } from '@sgh/contratos';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agendaLivre, convenioAceito, diaUtil, entradaGrade, relogio } from '../massa/reproducao-agenda.js';
import { apoioDaFicha, marcacaoDeHojeDoPaciente } from '../massa/reproducao-atendimento.js';
import { apoioDaInternacao, leitoLivre } from '../massa/reproducao-internacao.js';
import { atendimento, gravacaoEvolucao, modeloPronto, profissional } from '../massa/reproducao-pep.js';
import { entradaAtestado, entradaReceita, profissionalDaCategoria } from '../massa/reproducao-pep-m23.js';
import {
  atendimentoAberto,
  atendimentoParaPrescrever,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  prescritorDaCopia,
} from '../massa/reproducao-prescricao.js';
import { geradorLivre, legadoChamaSenha, legadoEmiteSenha } from '../massa/reproducao-recepcao.js';
import {
  outroSistemaAbreContaSadtDoInternado,
  outroSistemaAlteraAInternacao,
} from '../massa/jornada-outro-sistema.js';
import {
  exameParametrizadoDoLaboratorio,
  prestadorELocalDoAto,
  profissionalComCbo,
} from '../massa/reproducao-sadt.js';
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

const m = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const tiposLogradouro = () =>
  carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos('RICADPAC', 'TPLGR') ??
  new Set<string>();

interface Passo {
  readonly passo: string;
  /** O passo inteiro (com a preparação da massa na cópia) e só as gravações pelo executor. */
  readonly ms: number;
  readonly gravacao: number;
  readonly efeito: string;
}

describe.skipIf(!PODE_ESCREVER)('jornada ponta a ponta na cópia pc (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente({ FB_POOL_TETO: '3' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('agendar → atender → internar → prescrever → evoluir → exame → alta: cada passo grava como o outro sistema', async () => {
    const passos: Passo[] = [];
    const inicio = performance.now();
    let trilhaLegadoDepois = 0;
    let trilhaSghDepois = 0;
    /** Os logins que gravam na jornada (os criados ou escolhidos na transação; só em memória). */
    const logins = new Set<string>();
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      let msGravacao = 0;
      const exec = async (nome: string, entrada: unknown, login: string) => {
        logins.add(login);
        const t0 = performance.now();
        try {
          return await a.executor.executar(operacao(nome), a.cod, entrada, ctxOperacao(a, login), {
            escritor: e,
          });
        } finally {
          msGravacao += performance.now() - t0;
        }
      };
      const passo = async <T>(nome: string, f: () => Promise<{ r: T; efeito: string }>): Promise<T> => {
        const t0 = performance.now();
        msGravacao = 0;
        const { r, efeito } = await f();
        passos.push({
          passo: nome,
          ms: Math.round(performance.now() - t0),
          gravacao: Math.round(msGravacao),
          efeito,
        });
        return r;
      };

      // 0. O operador sintético da recepção (criado pelo próprio executor, na transação).
      const operador = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await exec(
        'acesso.criarUsuarioIntegracao',
        usuarioSintetico('usuario-tecnico', operador),
        'SGH.JORNADA',
      );

      // 1. O paciente sintético (cadastro do M11).
      const pac = await passo('cadastro', async () => {
        const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
        const cep = await cepCompleto(e, tiposLogradouro());
        const r = await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep), operador);
        const id = num(r.resultado['idPaciente']);
        const [p] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [id], { teto: 1 });
        expect(num(p?.['PRONT'])).toBeGreaterThan(0);
        return { r: { id, pront: num(p?.['PRONT']) }, efeito: 'RICADPAC 1' };
      });

      // 2. Agendar (M17, J5): a grade gerada e a consulta marcada para o paciente.
      const marcacao = await passo('agendar', async () => {
        const ag = await agendaLivre(e);
        const rel = await relogio(e);
        const d = await diaUtil(e, ag, addDias(rel.hoje, 7));
        const g = entradaGrade(ag, d);
        await exec('agenda.gerarGrade', g, operador);
        const r = await exec(
          'agenda.agendarConsulta',
          {
            agenda: ag.id,
            data: d,
            hora: g.horarios[0]!.hora,
            paciente: pac.id,
            convenio: await convenioAceito(e, ag),
            retorno: false,
            canal: 'telefone',
          },
          operador,
        );
        const id = num(r.resultado['marcacao']);
        const n = await contar(e, 'SELECT COUNT(*) N FROM REPACAGD WHERE ID = ? AND PRONT = ?', [
          id,
          pac.pront,
        ]);
        expect(n).toBe(1);
        const h = await contar(
          e,
          `SELECT COUNT(*) N FROM REPACAGI WHERE NOME = ? AND CRM = 0 AND DATA = CAST(CAST(? AS VARCHAR(10)) AS DATE)
             AND HORA = ? AND PACIENTE <> ''`,
          [ag.nome, d, g.horarios[0]!.hora],
        );
        expect(h).toBe(1);
        return { r: id, efeito: 'REPACAGI ocupado + REPACAGD 1' };
      });

      // 3. A senha da recepção (M19, J5): o paciente chega e retira a senha no balcão.
      const senha = await passo('senha', async () => {
        const g = await geradorLivre(e, { tipo: '0' });
        const r = await exec(
          'recepcao.emitirSenha',
          { gerador: g.id, prioridade: '2', origem: 'balcao' },
          operador,
        );
        const id = num(r.resultado['senha']);
        expect(await contar(e, 'SELECT COUNT(*) N FROM TBSENHAATEND WHERE ID = ?', [id])).toBe(1);
        // A fila da recepção (M27) mostra a senha aguardando.
        return { r: { id, local: g.local }, efeito: 'TBSENHAATEND 1' };
      });

      // 4. Atender (M20, J5): a ficha da consulta aberta com a senha e a marcação de hoje do paciente; a conta nasce do
      //    gatilho do atendimento (o novo não lança nada na conta).
      const ficha = await passo('atender', async () => {
        const hoje = await marcacaoDeHojeDoPaciente(e, pac.pront);
        const ap = await apoioDaFicha(e, { tipoAte: 4 });
        const r = await exec(
          'atendimento.abrirAtendimento',
          {
            tipo: 'consulta',
            paciente: pac.id,
            convenio: ap.convenio,
            plano: 'PLANO SINTETICO',
            matricula: '900000000027',
            validadeCarteira: '2030-12-31',
            profissional: ap.profissional,
            especialidade: ap.especialidade,
            unidade: ap.unidade,
            centroCusto: ap.centroCusto,
            procedimento: ap.procedimento,
            carater: 'eletivo',
            cidPrincipal: ap.cid,
            senha: senha.id,
            local: senha.local,
            marcacao: hoje,
            tipoGuia: 'H',
          },
          operador,
        );
        const reg = num(r.resultado['reg']);
        const [f] = await e.consultar(
          'SELECT r.ID_ATCABECATEND C, r.ANOPRO, r.MESPRO FROM RECADATE r WHERE r.REG = ?',
          [reg],
          { teto: 1 },
        );
        expect(f).toBeTruthy();
        const conta = await contar(
          e,
          "SELECT COUNT(*) N FROM FCCTAEXT WHERE COD = ? AND TIPO_CTA = 'E' AND ANOPRO = ? AND MESPRO = ?",
          [reg, f!['ANOPRO'], f!['MESPRO']],
        );
        expect(conta).toBe(1);
        const ligada = await contar(e, 'SELECT COUNT(*) N FROM REPACAGD WHERE ID = ? AND REGISTRO = ?', [
          hoje,
          reg,
        ]);
        const guias = await guiasAguardandoAutorizacao(e, txt((await relogio(e)).hoje));
        return {
          r: { reg, cab: num(f!['C']) },
          efeito: `RECADATE 1, ATCABECATEND 1, conta do gatilho 1, marcação ligada ${ligada}; guias aguardando no dia ${m(guias.guias.length)}`,
        };
      });

      // 5. Internar (M21, J1): do ambulatório para um leito livre de enfermaria.
      const internacao = await passo('internar', async () => {
        const ai = await apoioDaInternacao(e);
        const leito = await leitoLivre(e, { tipo: 1 });
        const r = await exec(
          'internacao.internar',
          {
            paciente: pac.id,
            leito,
            convenio: ai.convenio,
            matricula: '900000000027',
            validadeCarteira: '2031-12-31',
            diariasAutorizadas: 1,
            acomodacaoPlano: 'ENFERMARIA',
            carater: 'urgencia',
            clinica: 'M',
            especialidade: ai.especialidade,
            medicoAssistente: ai.assistente,
            medicoSolicitante: ai.solicitante,
            cidPrincipal: ai.cid,
            cidSecundario: ai.cidSecundario,
            procedimento: ai.procedimento,
            centroCusto: ai.centroCusto,
            unidade: 4,
            origem: 'ambulatorio',
            isolamento: false,
          },
          operador,
        );
        const reg = num(r.resultado['reg']);
        const [c] = await e.consultar(
          "SELECT ID FROM ATCABECATEND WHERE COD_ATENDIMENTO = ? AND TP_ATENDIMENTO = 'I'",
          [reg],
          { teto: 1 },
        );
        const cab = num(c?.['ID']);
        expect(cab).toBeGreaterThan(0);
        expect(await contar(e, 'SELECT COUNT(*) N FROM RICTRLOC WHERE REG = ?', [reg])).toBeGreaterThan(0);
        // A fila do médico (M27, regra 2): o paciente aparece para o profissional do atendimento (o vínculo pelo CBO do
        // atendimento) e não aparece para um CBO sem vínculo.
        const [cb] = await e.consultar(
          'SELECT ID_TBCBOPRO_ATENDIMENTO C FROM ATCABECATEND WHERE ID = ?',
          [cab],
          {
            teto: 1,
          },
        );
        const cboDoAtendimento = num(cb?.['C']);
        const naFila = async (cbo: number) =>
          (
            await painelPacientes(e, {
              unidade: null,
              busca: String(pac.pront),
              meus: { cbos: [cbo], login: 'SGH.JORNADA', hospital: a.cod },
            })
          ).linhas.some((l) => l.atendimento === cab);
        const todos = await painelPacientes(e, { unidade: null, busca: String(pac.pront) });
        expect(todos.linhas.some((l) => l.atendimento === cab)).toBe(true);
        expect(cboDoAtendimento).toBeGreaterThan(0);
        expect(await naFila(cboDoAtendimento)).toBe(true);
        // O médico assistente da internação também tem vínculo (o cabeçalho leva o solicitante).
        expect(await naFila(ai.assistente)).toBe(true);
        // Um médico sem vínculo com o episódio: fora da fila.
        const [semVinculo] = await e.consultar(
          `SELECT FIRST 1 r.ID FROM TBCBOPRO r JOIN TBCBOSUS s ON s.ID = r.ID_TBCBOSUS
            WHERE s.COD STARTING WITH '225' AND COALESCE(r.ATIVO, 'T') <> 'F' AND r.ID NOT IN (?, ?) ORDER BY r.ID`,
          [ai.assistente, ai.solicitante],
          { teto: 1 },
        );
        expect(await naFila(num(semVinculo?.['ID']))).toBe(false);
        return {
          r: { reg, cab, ai, leito, cboDoAtendimento },
          efeito: `RICADINT 1, ATCABECATEND I 1, RICTRLOC ≥1; na fila do assistente e do profissional do cabeçalho (${cboDoAtendimento === ai.solicitante ? 'o solicitante' : 'outro'}); fora da fila sem vínculo`,
        };
      });

      // 6. Prescrever (M24, J1): a prescrição do período seguinte com um medicamento; os horários aprazados ficam para a
      //    enfermagem (a checagem é do M25).
      const prescricao = await passo('prescrever', async () => {
        const medico = await prescritorDaCopia(e, '2251');
        const at = await atendimentoAberto(e);
        expect(at.id).toBe(internacao.cab);
        const c = await cadastrosDoCenario(e);
        const forma = FORMAS_PRESCREVER['medicamento-intervalo'];
        if (!forma) throw new Error('Forma de prescrição do medicamento por intervalo ausente.');
        const usados: number[] = [];
        const itens = [];
        for (const [k, f] of forma.itens.entries()) itens.push(await itemDaForma(e, f, k, c, usados));
        const g = await gravacaoDe(e, at, medico, itens, c);
        const r = await exec('pep.prescrever', g, medico.login);
        const id = num(r.resultado['prescricao']);
        expect(
          await contar(e, 'SELECT COUNT(*) N FROM PRPRESC WHERE ID = ? AND ID_ATCABECATEND_INTEGRACAO = ?', [
            id,
            internacao.cab,
          ]),
        ).toBe(1);
        const linhas = await contar(e, 'SELECT COUNT(*) N FROM PRLANGERAL WHERE ID_PRPRESC = ?', [id]);
        const horarios = await contar(
          e,
          'SELECT COUNT(*) N FROM PRCHKGERAL h JOIN PRLANGERAL l ON l.ID = h.ID_PRLANGERAL WHERE l.ID_PRPRESC = ?',
          [id],
        );
        expect(linhas).toBeGreaterThan(0);
        expect(horarios).toBeGreaterThan(0);
        return {
          r: { id, medico },
          efeito: `PRPRESC 1, itens ${m(linhas)}, horários para a enfermagem ${m(horarios)}`,
        };
      });

      // 7. Evoluir (M22/M23, J1): a evolução médica no prontuário, pelo modelo de maior uso.
      const evolucao = await passo('evoluir', async () => {
        const mod = await modeloPronto(e, 'EVAM');
        const prof = await profissional(e, mod.id);
        const at = await atendimento(e, 'I');
        expect(at.id).toBe(internacao.cab);
        const g = await gravacaoEvolucao(e, a.cod, mod, prof, at, respostasSinteticas(mod.rep));
        const r = await exec('pep.registrarEvolucao', g, prof.login);
        const id = num(r.resultado['registro']);
        const n = await contar(
          e,
          'SELECT COUNT(*) N FROM PRCABEVOL WHERE ID_CABEVOL = ? AND ID_HTATENDIMENTO = ?',
          [id, at.retratos.htAtendimento],
        );
        expect(n).toBe(1);
        return { r: { id, at }, efeito: 'PRCABEVOL 1 (com o documento e o hash)' };
      });

      // 8. Exame (M26, J4): a conta do setor aberta pelo pedido, o exame do laboratório lançado, digitado e liberado; o
      //    resultado aparece na fila do médico como "resultado novo" até a visualização.
      const exame = await passo('exame', async () => {
        const med = await profissionalComCbo(e, ['225']);
        // A conta do setor do internado não abre pelo novo (é da internação; D-SADT-INT-27): a recusa conferida, e o
        // outro sistema a abre (simulado, como ele grava); o novo segue o exame dali (começado lá, terminado aqui).
        await expect(
          exec(
            'sadt.abrirRequisicao',
            { atendimento: internacao.cab, emissor: med.cbo, solicitante: med.cbo },
            med.login,
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'internacao-fora' } });
        await outroSistemaAbreContaSadtDoInternado(e, {
          cab: internacao.cab,
          reg: internacao.reg,
          pront: pac.pront,
        });
        expect(
          await contar(e, 'SELECT COUNT(*) N FROM SICADATE WHERE ID_ATCABECATEND = ?', [internacao.cab]),
        ).toBe(1);
        const tec = await profissionalComCbo(e, ['2212', '2234', '225335']);
        const ex = await exameParametrizadoDoLaboratorio(e);
        const pl = await prestadorELocalDoAto(e, 15);
        const r = await exec(
          'sadt.lancarExame',
          {
            atendimento: internacao.cab,
            ato: 15,
            atend: 'I',
            itens: [{ exame: ex, urgente: false }],
            executante: tec.cbo,
            prestador: pl.prestador,
            local: pl.local,
            solicitante: med.cbo,
            retratos: evolucao.at.retratos,
            confirmarAlertas: true,
            repeticaoMinimaHoras: 0,
          },
          tec.login,
        );
        const id = num(r.resultado['primeiro']);
        const lido = async () => {
          const x = await lerExameSadt(e, id);
          if (!x) throw new Error('Exame não relido.');
          return { id, chave: x.chave, versao: x.versao };
        };
        await exec(
          'sadt.registrarResultado',
          { exame: await lido(), elementos: [{ elemento: 0, numerico: 4.5, alfa: null, absoluta: null }] },
          tec.login,
        );
        await exec('sadt.liberarExame', { exames: [await lido()], responsavel: tec.cbo }, tec.login);
        expect(await contar(e, "SELECT COUNT(*) N FROM SILANEXA WHERE ID = ? AND RESLIB = 'T'", [id])).toBe(
          1,
        );
        expect(await contar(e, 'SELECT COUNT(*) N FROM SILIBERACAOEXAME WHERE ID_SILANEXA = ?', [id])).toBe(
          1,
        );
        // A fila do médico (M27, regra 4): o resultado liberado é "novo" até o médico abrir.
        const w = await leiturasDaWorklistMedico(e, {
          hospital: a.cod,
          login: prescricao.medico.login,
          pacientes: [pac.id],
          registros: [internacao.reg],
          desde: new Date(Date.now() - 2 * 86_400_000),
        });
        const doExame = w.resultados.filter((x) => x.exame === id);
        expect(doExame).toHaveLength(1);
        const c = contarResultados(
          doExame.map((x) => ({
            exame: x.exame,
            liberadoEm: x.liberadoEm,
            critico: false,
            visualizadoNoOutroSistema: x.visualizadoNoOutroSistema,
            vistoPeloMedico: x.vistoPeloMedico,
            ciencia: false,
          })),
        );
        expect(c.novos).toBe(1);
        return {
          r: id,
          efeito:
            'abrir a conta do setor do internado recusado (internacao-fora) e aberta por fora; SILANEXA liberado 1, SILIBERACAOEXAME 1; "resultado novo" na fila',
        };
      });
      void exame;

      // 9. Alta (M21, J1): a alta médica decidida (SGH_) e a saída administrativa; o leito liberado e a limpeza pedida.
      await passo('alta', async () => {
        const [v] = await e.consultar(
          'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RICADINT WHERE REG = ?',
          [internacao.reg],
          { teto: 1 },
        );
        await registrarAltaMedica(e, {
          hospital: e.hospital,
          reg: internacao.reg,
          pront: pac.pront,
          vinculo: internacao.ai.assistente,
          motivo: 12,
          destino: 'domicilio',
          sumarioAlta: null,
          previsaoSaida: null,
          observacao: null,
          usuario: 'SGH.JORNADA',
        });
        await exec(
          'internacao.darAlta',
          {
            internacao: internacao.reg,
            motivo: 12,
            medicoAlta: internacao.ai.assistente,
            versao: txt(v?.['V']),
          },
          operador,
        );
        // A alta no cabeçalho do atendimento vem do gatilho da internação (TRG_RICADINT_AU), como no outro sistema.
        const saida = await contar(
          e,
          `SELECT COUNT(*) N FROM ATCABECATEND WHERE ID = ? AND DATA_HORA_ALTA_MEDICA IS NOT NULL
             AND DATA_HORA_SAIDA_LEITO IS NOT NULL`,
          [internacao.cab],
        );
        expect(saida).toBe(1);
        expect(
          await contar(e, "SELECT COUNT(*) N FROM RICADINT WHERE REG = ? AND ALTA > DATE '1901-01-01'", [
            internacao.reg,
          ]),
        ).toBe(1);
        expect(await contar(e, 'SELECT COUNT(*) N FROM RILEITOS WHERE REG = ?', [internacao.reg])).toBe(0);
        const limpeza = await contar(e, 'SELECT COUNT(*) N FROM CHSOLICITLIMP WHERE ID_ATCABECATEND = ?', [
          internacao.cab,
        ]);
        expect(limpeza).toBeGreaterThan(0);
        return {
          r: null,
          efeito: `alta no cabeçalho pelo gatilho 1, RICADINT com alta 1, leito liberado, limpeza pedida ${m(limpeza)}`,
        };
      });

      // A fila do médico depois da alta: a internação não aparece mais (sem alta médica: só as abertas).
      const depois = await painelPacientes(e, {
        unidade: null,
        busca: String(pac.pront),
        meus: { cbos: [internacao.cboDoAtendimento], login: 'SGH.JORNADA', hospital: a.cod },
      });
      expect(depois.linhas.some((l) => l.atendimento === internacao.cab)).toBe(false);
      void ficha;
      void marcacao;

      // Trilha dupla dos logins da jornada, no dia (índice SGH_IDX_TRILHA_USUARIO): a própria em toda operação e a
      // ligação com a do outro sistema (ID_TBCABTRILHA) nas que ele registra.
      for (const login of logins) {
        const [t] = await e.consultar(
          `SELECT COUNT(*) N, COUNT(ID_TBCABTRILHA) L FROM SGH_TRILHA
            WHERE HOSPITAL = ? AND USUARIO = ? AND DIA = CURRENT_DATE`,
          [a.cod, login],
          { teto: 1 },
        );
        trilhaSghDepois += num(t?.['N']);
        trilhaLegadoDepois += num(t?.['L']);
      }
    });
    const total = Math.round(performance.now() - inicio);
    // Trilha dupla: a do outro sistema (as operações que ele registra) e a própria (todas).
    expect(trilhaSghDepois).toBeGreaterThanOrEqual(passos.length);
    expect(trilhaLegadoDepois).toBeGreaterThan(0);
    for (const p of passos)
      console.log(`[int-m27-jornada] ${p.passo}: gravação ${p.gravacao} ms (passo ${p.ms} ms) — ${p.efeito}`);
    console.log(
      `[int-m27-jornada] ${passos.length} passos em ${total} ms; trilha própria ${trilhaSghDepois} linha(s), ${trilhaLegadoDepois} ligada(s) à do outro sistema; tudo desfeito (ROLLBACK)`,
    );
  });

  it('J5 (ambulatório): agenda → confirmação → recepção → consulta → receita e atestado → retorno agendado', async () => {
    const linhas: string[] = [];
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const exec = (nome: string, entrada: unknown, login: string) =>
        a.executor.executar(operacao(nome), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      const operador = (await loginLivre(e, (Date.now() + 41) % 1_000_000_000)).toUpperCase();
      await exec(
        'acesso.criarUsuarioIntegracao',
        usuarioSintetico('usuario-tecnico', operador),
        'SGH.JORNADA',
      );
      const cpf = await cpfLivre(e, (Date.now() + 32_452_843) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro());
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep), operador))
          .resultado['idPaciente'],
      );
      const [pr] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [pac], { teto: 1 });
      const pront = num(pr?.['PRONT']);
      // Agenda: a grade e a marcação; a confirmação (a situação C é "confirmado").
      const ag = await agendaLivre(e);
      const d = await diaUtil(e, ag, addDias((await relogio(e)).hoje, 7));
      const g = entradaGrade(ag, d);
      await exec('agenda.gerarGrade', g, operador);
      const convenio = await convenioAceito(e, ag);
      const marcacao = num(
        (
          await exec(
            'agenda.agendarConsulta',
            {
              agenda: ag.id,
              data: d,
              hora: g.horarios[0]!.hora,
              paciente: pac,
              convenio,
              retorno: false,
              canal: 'telefone',
            },
            operador,
          )
        ).resultado['marcacao'],
      );
      await exec('agenda.confirmarConsulta', { marcacao }, operador);
      linhas.push('consulta marcada e confirmada');
      // Recepção e consulta: a senha e a ficha da consulta (a marcação de hoje do paciente, como a cópia permite).
      const ger = await geradorLivre(e, { tipo: '0' });
      const senha = num(
        (await exec('recepcao.emitirSenha', { gerador: ger.id, prioridade: '2', origem: 'balcao' }, operador))
          .resultado['senha'],
      );
      const hoje = await marcacaoDeHojeDoPaciente(e, pront);
      const ap = await apoioDaFicha(e, { tipoAte: 4 });
      const reg = num(
        (
          await exec(
            'atendimento.abrirAtendimento',
            {
              tipo: 'consulta',
              paciente: pac,
              convenio: ap.convenio,
              plano: 'PLANO SINTETICO',
              matricula: '900000000027',
              validadeCarteira: '2030-12-31',
              profissional: ap.profissional,
              especialidade: ap.especialidade,
              unidade: ap.unidade,
              centroCusto: ap.centroCusto,
              procedimento: ap.procedimento,
              carater: 'eletivo',
              cidPrincipal: ap.cid,
              senha,
              local: ger.local,
              marcacao: hoje,
              tipoGuia: 'H',
            },
            operador,
          )
        ).resultado['reg'],
      );
      const [c] = await e.consultar('SELECT ID_ATCABECATEND C FROM RECADATE WHERE REG = ?', [reg], {
        teto: 1,
      });
      const cab = num(c?.['C']);
      linhas.push('senha e ficha da consulta abertas');
      // Receita e atestado no prontuário da consulta (o modelo de impressão em uso, a trilha documental).
      const medico = await profissionalDaCategoria(e, true);
      const at = await atendimentoParaPrescrever(e, cab);
      const doc = { id: at.id, paciente: at.paciente, retratos: at.retratos };
      const rec = await exec(
        'pep.emitirDocumento',
        await entradaReceita(e, medico, doc, 'receita'),
        medico.login,
      );
      const ate = await exec(
        'pep.emitirDocumento',
        await entradaAtestado(e, medico, doc, 'atestado'),
        medico.login,
      );
      expect(
        await contar(e, 'SELECT COUNT(*) N FROM PRRECEITA WHERE ID_RECEITA = ?', [
          num(rec.resultado['origem']),
        ]),
      ).toBe(1);
      expect(
        await contar(e, 'SELECT COUNT(*) N FROM PRATESTREQIMP WHERE ID = ?', [num(ate.resultado['origem'])]),
      ).toBe(1);
      linhas.push('receita e atestado emitidos no atendimento da consulta');
      // Retorno agendado na mesma agenda (o horário seguinte da grade, marcado como retorno).
      const retorno = num(
        (
          await exec(
            'agenda.agendarConsulta',
            {
              agenda: ag.id,
              data: d,
              hora: g.horarios[1]!.hora,
              paciente: pac,
              convenio,
              retorno: true,
              canal: 'presencial',
            },
            operador,
          )
        ).resultado['marcacao'],
      );
      expect(
        await contar(e, 'SELECT COUNT(*) N FROM REPACAGD WHERE ID = ? AND PRONT = ?', [retorno, pront]),
      ).toBe(1);
      linhas.push('retorno agendado');
    });
    for (const l of linhas) console.log(`[int-m27-j5] ${l}`);
    expect(linhas).toHaveLength(4);
  });

  it('J2 (pronto atendimento): senha → atendimento no PA → prescrição no PA → exame → internação pelo PA', async () => {
    const linhas: string[] = [];
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const exec = (nome: string, entrada: unknown, login: string) =>
        a.executor.executar(operacao(nome), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      const operador = (await loginLivre(e, (Date.now() + 29) % 1_000_000_000)).toUpperCase();
      await exec(
        'acesso.criarUsuarioIntegracao',
        usuarioSintetico('usuario-tecnico', operador),
        'SGH.JORNADA',
      );
      const cpf = await cpfLivre(e, (Date.now() + 15_485_863) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro());
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep), operador))
          .resultado['idPaciente'],
      );
      // A senha do PA e o atendimento no pronto atendimento (horário especial, guia de urgência).
      // A senha do balcão (na cópia nenhum serviço de prioridade está livre hoje; a ordem legal é a regra 5).
      const g = await geradorLivre(e, { tipo: '0' });
      const senha = num(
        (await exec('recepcao.emitirSenha', { gerador: g.id, prioridade: '2', origem: 'balcao' }, operador))
          .resultado['senha'],
      );
      const ap = await apoioDaFicha(e, { tipoAte: 11 });
      const pa = await exec(
        'atendimento.abrirAtendimento',
        {
          tipo: 'pa',
          paciente: pac,
          convenio: ap.convenio,
          plano: 'PLANO SINTETICO',
          matricula: '900000000027',
          validadeCarteira: '2030-12-31',
          profissional: ap.profissional,
          especialidade: ap.especialidade,
          unidade: ap.unidade,
          centroCusto: ap.centroCusto,
          procedimento: ap.procedimento,
          carater: 'urgencia',
          cidPrincipal: ap.cid,
          senha,
          local: g.local,
          horarioEspecial: true,
          tipoGuia: 'E',
        },
        operador,
      );
      const regPa = num(pa.resultado['reg']);
      const [c] = await e.consultar(
        'SELECT ID_ATCABECATEND C, TIPO_ATE T FROM RECADATE WHERE REG = ?',
        [regPa],
        {
          teto: 1,
        },
      );
      const cabPa = num(c?.['C']);
      expect(num(c?.['T'])).toBe(11);
      linhas.push('senha → atendimento no PA (tipo 11)');

      // A prescrição no PA (o mesmo motor da prescrição da internação).
      const medico = await prescritorDaCopia(e, '2251');
      const at = await atendimentoParaPrescrever(e, cabPa);
      const cad = await cadastrosDoCenario(e);
      const forma = FORMAS_PRESCREVER['medicamento-intervalo'];
      if (!forma) throw new Error('Forma de prescrição ausente.');
      const usados: number[] = [];
      const itens = [];
      for (const [k, f] of forma.itens.entries()) itens.push(await itemDaForma(e, f, k, cad, usados));
      const presc = num(
        (await exec('pep.prescrever', await gravacaoDe(e, at, medico, itens, cad), medico.login)).resultado[
          'prescricao'
        ],
      );
      expect(
        await contar(e, 'SELECT COUNT(*) N FROM PRPRESC WHERE ID = ? AND ID_ATCABECATEND_INTEGRACAO = ?', [
          presc,
          cabPa,
        ]),
      ).toBe(1);
      linhas.push('prescrição no PA gravada no atendimento do PA');

      // O exame do PA: a conta do setor aberta pelo pedido (o PA é atendimento externo), lançado, digitado e liberado.
      const med = await profissionalComCbo(e, ['225']);
      await exec(
        'sadt.abrirRequisicao',
        { atendimento: cabPa, emissor: med.cbo, solicitante: med.cbo },
        med.login,
      );
      const tec = await profissionalComCbo(e, ['2212', '2234', '225335']);
      const ex = await exameParametrizadoDoLaboratorio(e);
      const pl = await prestadorELocalDoAto(e, 15);
      const id = num(
        (
          await exec(
            'sadt.lancarExame',
            {
              atendimento: cabPa,
              ato: 15,
              atend: 'E',
              itens: [{ exame: ex, urgente: true }],
              executante: tec.cbo,
              prestador: pl.prestador,
              local: pl.local,
              solicitante: med.cbo,
              retratos: at.retratos,
              confirmarAlertas: true,
              repeticaoMinimaHoras: 0,
            },
            tec.login,
          )
        ).resultado['primeiro'],
      );
      const lido = async () => {
        const x = await lerExameSadt(e, id);
        if (!x) throw new Error('Exame não relido.');
        return { id, chave: x.chave, versao: x.versao };
      };
      await exec(
        'sadt.registrarResultado',
        { exame: await lido(), elementos: [{ elemento: 0, numerico: 4.2, alfa: null, absoluta: null }] },
        tec.login,
      );
      await exec('sadt.liberarExame', { exames: [await lido()], responsavel: tec.cbo }, tec.login);
      expect(await contar(e, "SELECT COUNT(*) N FROM SILANEXA WHERE ID = ? AND RESLIB = 'T'", [id])).toBe(1);
      linhas.push('exame urgente do PA lançado, digitado e liberado');

      // A internação pelo PA (origem pa, o atendimento de origem).
      const ai = await apoioDaInternacao(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const int = await exec(
        'internacao.internar',
        {
          paciente: pac,
          leito,
          convenio: ai.convenio,
          matricula: '900000000027',
          validadeCarteira: '2031-12-31',
          diariasAutorizadas: 1,
          acomodacaoPlano: 'ENFERMARIA',
          carater: 'urgencia',
          clinica: 'M',
          especialidade: ai.especialidade,
          medicoAssistente: ai.assistente,
          medicoSolicitante: ai.solicitante,
          cidPrincipal: ai.cid,
          cidSecundario: ai.cidSecundario,
          procedimento: ai.procedimento,
          centroCusto: ai.centroCusto,
          unidade: 4,
          origem: 'pa',
          atendimentoOrigem: regPa,
          nivelCuidado: 'intermediario',
          isolamento: false,
        },
        operador,
      );
      const regInt = num(int.resultado['reg']);
      expect(await contar(e, 'SELECT COUNT(*) N FROM RICADINT WHERE REG = ?', [regInt])).toBe(1);
      linhas.push('internação pelo PA (origem e atendimento de origem)');
    });
    for (const l of linhas) console.log(`[int-m27-j2] ${l}`);
    expect(linhas).toHaveLength(4);
  });

  it('J10 (regra 9): começado no outro sistema e terminado no novo, e vice-versa; colisão quando a linha mudou', async () => {
    const linhas: string[] = [];
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const exec = (nome: string, entrada: unknown, login: string) =>
        a.executor.executar(operacao(nome), a.cod, entrada, ctxOperacao(a, login), { escritor: e });
      const operador = (await loginLivre(e, (Date.now() + 17) % 1_000_000_000)).toUpperCase();
      await exec(
        'acesso.criarUsuarioIntegracao',
        usuarioSintetico('usuario-tecnico', operador),
        'SGH.JORNADA',
      );
      const cpf = await cpfLivre(e, (Date.now() + 104_729) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro());
      const pac = num(
        (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep), operador))
          .resultado['idPaciente'],
      );
      const g = await geradorLivre(e, { tipo: '0' });
      // O novo emite a primeira senha do dia do gerador (o contador do dia nasce aqui).
      const doNovo = num(
        (await exec('recepcao.emitirSenha', { gerador: g.id, prioridade: '2', origem: 'balcao' }, operador))
          .resultado['senha'],
      );

      // 1. Começado no outro sistema, terminado no novo: a senha emitida no balcão de lá; o novo abre o atendimento.
      const numero = await legadoEmiteSenha(e, g.id, operador);
      const [x] = await e.consultar(
        'SELECT ID FROM TBSENHAATEND WHERE ID_TBGERASENHA = ? AND DATA_SENHA = CURRENT_DATE AND SENHA = ?',
        [g.id, numero],
        { teto: 1 },
      );
      const deLa = num(x?.['ID']);
      const naFila = async () =>
        (await senhasDoDia(e, a.cod, { geradores: [g.id] })).senhas.filter(chamavel).map((s) => s.id);
      expect(await naFila()).toEqual(expect.arrayContaining([doNovo, deLa]));
      const ap = await apoioDaFicha(e, { tipoAte: 4 });
      const ficha = await exec(
        'atendimento.abrirAtendimento',
        {
          tipo: 'consulta',
          paciente: pac,
          convenio: ap.convenio,
          plano: 'PLANO SINTETICO',
          matricula: '900000000027',
          validadeCarteira: '2030-12-31',
          profissional: ap.profissional,
          especialidade: ap.especialidade,
          unidade: ap.unidade,
          centroCusto: ap.centroCusto,
          procedimento: ap.procedimento,
          carater: 'eletivo',
          cidPrincipal: ap.cid,
          senha: deLa,
          local: g.local,
          tipoGuia: 'H',
        },
        operador,
      );
      const reg = num(ficha.resultado['reg']);
      expect(
        await contar(
          e,
          `SELECT COUNT(*) N FROM ATCABECATEND_TBSENHAATEND v JOIN RECADATE r ON r.ID_ATCABECATEND = v.ID_ATCABECATEND
            WHERE v.ID_TBSENHAATEND = ? AND r.REG = ?`,
          [deLa, reg],
        ),
      ).toBe(1);
      expect(await naFila()).not.toContain(deLa);
      linhas.push('senha emitida no outro sistema → atendimento aberto no novo (ligados; fora da fila)');

      // 2. Começado no novo, terminado no outro sistema: a senha do novo chamada no guichê de lá sai da fila do novo.
      await legadoChamaSenha(e, doNovo, 7, operador);
      expect(await naFila()).not.toContain(doNovo);
      linhas.push('senha emitida no novo → chamada no outro sistema (sai da fila da recepção do novo)');

      // 3. Colisão: o novo lê a internação; o outro sistema muda a linha (a previsão de alta); a saída do novo com a
      //    versão lida é recusada com o aviso de colisão e, relida, grava.
      const ai = await apoioDaInternacao(e);
      const leito = await leitoLivre(e, { tipo: 1 });
      const int = await exec(
        'internacao.internar',
        {
          paciente: pac,
          leito,
          convenio: ai.convenio,
          matricula: '900000000027',
          validadeCarteira: '2031-12-31',
          diariasAutorizadas: 1,
          acomodacaoPlano: 'ENFERMARIA',
          carater: 'urgencia',
          clinica: 'M',
          especialidade: ai.especialidade,
          medicoAssistente: ai.assistente,
          medicoSolicitante: ai.solicitante,
          cidPrincipal: ai.cid,
          cidSecundario: ai.cidSecundario,
          procedimento: ai.procedimento,
          centroCusto: ai.centroCusto,
          unidade: 4,
          origem: 'ambulatorio',
          isolamento: false,
        },
        operador,
      );
      const regInt = num(int.resultado['reg']);
      const versao = async () => {
        const [v] = await e.consultar(
          'SELECT CAST(DATA_HORA_ULTIMA_ATUALIZACAO AS VARCHAR(30)) V FROM RICADINT WHERE REG = ?',
          [regInt],
          { teto: 1 },
        );
        return txt(v?.['V']);
      };
      const lida = await versao();
      const [p] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [pac], { teto: 1 });
      await registrarAltaMedica(e, {
        hospital: e.hospital,
        reg: regInt,
        pront: num(p?.['PRONT']),
        vinculo: ai.assistente,
        motivo: 12,
        destino: 'domicilio',
        sumarioAlta: null,
        previsaoSaida: null,
        observacao: null,
        usuario: 'SGH.JORNADA',
      });
      await esperarUmSegundo();
      await outroSistemaAlteraAInternacao(e, regInt);
      expect(await versao()).not.toBe(lida);
      const saida = { internacao: regInt, motivo: 12, medicoAlta: ai.assistente };
      await expect(exec('internacao.darAlta', { ...saida, versao: lida }, operador)).rejects.toMatchObject({
        problema: { codigo: 'conflito-versao' },
      });
      expect(
        await contar(e, "SELECT COUNT(*) N FROM RICADINT WHERE REG = ? AND ALTA > DATE '1901-01-01'", [
          regInt,
        ]),
      ).toBe(0);
      await exec('internacao.darAlta', { ...saida, versao: await versao() }, operador);
      expect(
        await contar(e, "SELECT COUNT(*) N FROM RICADINT WHERE REG = ? AND ALTA > DATE '1901-01-01'", [
          regInt,
        ]),
      ).toBe(1);
      linhas.push(
        'internação lida no novo, alterada no outro sistema: saída recusada (conflito-versao); relida, grava',
      );
    });
    for (const l of linhas) console.log(`[int-m27-j10] ${l}`);
    expect(linhas).toHaveLength(3);
  });
});

const esperarUmSegundo = () => new Promise((r) => setTimeout(r, 1_100));

function addDias(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
