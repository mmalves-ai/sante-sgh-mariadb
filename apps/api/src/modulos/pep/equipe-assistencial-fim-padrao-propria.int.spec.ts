// Contrato de efeito da equipe assistencial ligada ao resto do hospital (03-PEP L94, C2-064) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, atendimentos e setor fictícios (com as
// chaves estrangeiras ligadas: catálogos pelos ids já existentes do cliente), funções de equipe do teste e o vínculo da
// conta com o profissional nesse estabelecimento; usuário, paciente e profissionais são ids já existentes (só lidos).
// Prova o que fica no banco: o vínculo assistencial pela equipe para a CONTA da sessão (só com atendimento aberto), o
// mesmo vínculo valendo na guarda de outra rota clínica (notas do paciente) pelo provedor global VINCULO_ASSISTENCIAL,
// a fila de pendências pelos destinatários, o fim do atendimento encerrando a equipe NA MESMA TRANSAÇÃO das operações
// reais pelo executor (atendimento.encerrar-atendimento, atendimento.cancelar-atendimento, internacao.dar-alta) com os
// vigentes saindo com o motivo e nada apagado, o internacao.cancelar-alta reabrindo-a (participação nova; a antiga no
// histórico), e a equipe padrão do setor (gravada, sugerida ao atendimento do setor, aplicada numa transação com os
// ignorados, desativada). A internação usa a massa da internação (massa-adt.spec-util, marca própria).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { definirOperacao, type Escritor, NucleoProprio, type TxOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
// O faturamento entra primeiro: o ciclo conta-entrada → quebra-conta → regras comerciais → operações do faturamento
// só se resolve quando as operações do faturamento abrem a cadeia (é a ordem que o servidor carrega).
import '../faturamento/operacoes.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
} from '../adt/massa-adt.spec-util.js';
import { carimboVersao } from '../adt/operacoes.js';
import { PortaAdtPropria } from '../adt/porta-propria.js';
import { PortaAtendimentoPropria } from '../atendimento/porta-propria.js';
import {
  encerrarEquipeNoFimDoAtendimento,
  reabrirEquipeDoAtendimento,
  TABELAS_EQUIPE_ATENDIMENTO,
} from './equipe-fim-atendimento.js';
import { PortaEquipePainelPropria } from './equipe-painel-propria.js';
import { NotasPacienteController } from './notas-paciente.controller.js';
import { NotasPacientePropria } from './notas-paciente-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { VinculoAssistencialPelaEquipe } from './vinculo-pela-equipe.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2064eq';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  prof: [number, number];
  atd: number;
  atdSetor: number;
  atdEnc: number;
  atdCanc: number;
  motivoCanc: number;
  setor: number;
  fResp: number;
  fEnf: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE m FROM equipe_assistencial_membro m JOIN equipe_assistencial_paciente q
        ON q.id = m.equipe_assistencial_paciente_id WHERE q.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM equipe_assistencial_paciente WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE m FROM equipe_assistencial_padrao_membro m JOIN equipe_assistencial_padrao q
        ON q.id = m.equipe_assistencial_padrao_id WHERE q.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM equipe_assistencial_padrao WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE c FROM cancelamento_atendimento c JOIN atendimento a ON a.id = c.atendimento_id
      WHERE a.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM integracao_mensagem WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(
    `DELETE h FROM atendimento_situacao_historico h JOIN atendimento a ON a.id = h.atendimento_id
      WHERE a.estabelecimento_id IN ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
  for (const t of ['categoria_atendimento', 'fonte_pagadora', 'motivo_cancelamento_operacao'])
    await e.executar(`DELETE FROM ${t} WHERE codigo = ?`, [P]);
  await e.executar(`DELETE FROM lotacao_profissional WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar("DELETE FROM funcao_equipe_assistencial WHERE codigo IN ('c2064-resp','c2064-enf')");
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)(
  'Equipe assistencial: vínculo, fila, fim do atendimento e equipe padrão (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaEquipePainelPropria;
    let m: Massa;
    const ctx = () => ({
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.usuario,
      correlacao: P,
      rede: 'rede-teste',
      hospital: P,
    });
    const ler = <T>(sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
    /** Uma transação do executor, como a da alta e do encerramento do atendimento (com a trilha). */
    const naTransacao = async (nome: string, fn: (tx: TxOperacao) => Promise<unknown>) => {
      const op = definirOperacao({
        nome,
        tabelas: ['atendimento', ...TABELAS_EQUIPE_ATENDIMENTO],
        entrada: z.object({}).strict(),
        gravar: async (tx: TxOperacao) => {
          await fn(tx);
          return { id: m.atd };
        },
        alvo: () => ({ tabela: 'atendimento', id: m.atd }),
      });
      await nucleo.criarExecutor().executar(
        op,
        CLIENTE,
        {},
        {
          cliente: CLIENTE,
          estabelecimento: m.est,
          usuario: m.usuario,
          correlacao: P,
          chaveIdempotencia: `${nome}:${randomUUID()}`,
        },
      );
    };

    /** A sessão sintética com a restrição de vínculo ligada, como a de um estabelecimento que restringe o acesso. */
    const requisicao = (usuario: number, login: string) =>
      ({
        headers: { 'idempotency-key': `${P}-${randomUUID()}`, 'x-correlation-id': P },
        ip: '127.0.0.1',
        sgh: {
          real: false,
          ability: criarAbility(regrasDeAcesso(['pep.prontuario.ler', 'pep.evolucao.criar'], null)),
          sessao: {
            usuario: { id: String(usuario), nome: 'Conta sintética', login },
            rede: 'rede-teste',
            estabelecimentos: [],
            estabelecimentoAtivo: P,
            unidadeAtiva: null,
            permissoes: ['pep.prontuario.ler', 'pep.evolucao.criar'],
            restricaoVinculo: true,
            sintetica: true,
            bloqueioInatividadeSegundos: 0,
            expiraEm: '',
          },
        },
      }) as unknown as RequisicaoAutorizada;
    /** Contexto do atendimento (porta própria) e da gravação pelo executor, no estabelecimento da massa. */
    const ctxAtd = () => ({ ...ctx(), correlacao: `${P}-atd` });
    const gravacao = (extra: Record<string, unknown> = {}) => ({
      ...ctxAtd(),
      chaveIdempotencia: `${P}-${randomUUID()}`,
      login: 'teste.c2064',
      estacao: 'TESTE',
      ...extra,
    });
    const membrosDe = (atendimento: number) =>
      ler<Record<string, unknown>>(
        `SELECT m.profissional_id, m.fim_em, m.motivo_saida, e.situacao, e.fim_em AS equipe_fim
           FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
          WHERE e.atendimento_id = ? ORDER BY m.sequencia`,
        [atendimento],
      );

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
        const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
        const profs = await e.consultar(
          'SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 2',
        );
        const cboMed = await e.uma(
          "SELECT MIN(id) AS id FROM ocupacao_cbo WHERE codigo_cbo LIKE '225%' AND ativo = TRUE",
        );
        const cboEnf = await e.uma(
          "SELECT MIN(id) AS id FROM ocupacao_cbo WHERE codigo_cbo LIKE '2235%' AND ativo = TRUE",
        );
        if (!usuario?.['id'] || !paciente?.['id'] || profs.length < 2 || !cboMed?.['id'] || !cboEnf?.['id'])
          throw new Error(
            'O cliente de teste precisa de usuário, paciente, dois profissionais e o CBO carregado.',
          );
        const est = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
        );
        const fResp = await e.inserir(
          `INSERT INTO funcao_equipe_assistencial (codigo, descricao, categoria, responsavel_principal, criado_em)
         VALUES ('c2064-resp', 'Médico assistente (teste)', 'medica', TRUE, ?)`,
          [agora],
        );
        const fEnf = await e.inserir(
          `INSERT INTO funcao_equipe_assistencial (codigo, descricao, categoria, responsavel_principal, criado_em)
         VALUES ('c2064-enf', 'Enfermeiro de referência (teste)', 'enfermagem', FALSE, ?)`,
          [agora],
        );
        // Catálogos do atendimento com as chaves estrangeiras ligadas: os do teste (código próprio, apagados no fim) e o
        // caráter TISS pelo código público (garantido como nas massas vizinhas).
        const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma(sel, p);
          return l ? Number(l['id']) : e.inserir(ins, pi);
        };
        const cat = {
          categoria: await garantir(
            'SELECT id FROM categoria_atendimento WHERE codigo = ?',
            [P],
            'INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)',
            [P, 'Consulta (teste da equipe)', 'ambulatorio', agora],
          ),
          carater: await garantir(
            "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = '1'",
            [],
            "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('1', 'Eletivo', 'teste', ?)",
            [agora],
          ),
          fonte: await garantir(
            'SELECT id FROM fonte_pagadora WHERE codigo = ?',
            [P],
            "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
            [P, `PARTICULAR ${P}`, agora],
          ),
          motivo: await garantir(
            'SELECT id FROM motivo_cancelamento_operacao WHERE codigo = ?',
            [P],
            'INSERT INTO motivo_cancelamento_operacao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
            [P, 'Aberto por engano (teste da equipe)', agora],
          ),
        };
        {
          const setor = await e.inserir(
            `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, 'Setor sintético', 'assistencial', ?)`,
            [est, `${P}-s`, agora],
          );
          const atender = (numero: string, setorId: number | null) =>
            e.inserir(
              `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                est,
                numero,
                paciente['id'],
                cat.categoria,
                cat.carater,
                cat.fonte,
                profs[0]!['id'],
                setorId,
                agora,
                agora,
              ],
            );
          const atd = await atender(`${P}-1`, null);
          const atdSetor = await atender(`${P}-2`, setor);
          const atdEnc = await atender(`${P}-3`, null);
          const atdCanc = await atender(`${P}-4`, null);
          const lotar = (prof: unknown, cbo: unknown) =>
            e.inserir(
              `INSERT INTO lotacao_profissional (profissional_id, estabelecimento_id, ocupacao_cbo_id, vigencia_inicio, criado_em)
             VALUES (?, ?, ?, DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), ?)`,
              [prof, est, cbo, agora],
            );
          await lotar(profs[0]!['id'], cboMed['id']);
          await lotar(profs[1]!['id'], cboEnf['id']);
          // A conta da sessão responde como o 1º profissional NESTE estabelecimento (vínculo vigente).
          await e.inserir(
            `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
           VALUES (?, ?, ?, DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY), ?)`,
            [usuario['id'], est, profs[0]!['id'], agora],
          );
          return {
            est,
            usuario: Number(usuario['id']),
            paciente: Number(paciente['id']),
            prof: [Number(profs[0]!['id']), Number(profs[1]!['id'])] as [number, number],
            atd,
            atdSetor,
            atdEnc,
            atdCanc,
            motivoCanc: cat.motivo,
            setor,
            fResp,
            fEnf,
          };
        }
      });
      porta = new PortaEquipePainelPropria(nucleo, CLIENTE);
    }, 120_000);

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
      await nucleo.encerrar();
    });

    it('vínculo pela equipe vale para a conta da sessão e a fila de pendências mostra o paciente com o papel', async () => {
      expect(await porta.vinculoDoUsuario(ctx(), m.paciente)).toBe(false);
      expect(await porta.filaDaEquipe(ctx())).toEqual([]);
      await porta.incluirMembro(ctx(), m.atd, { profissional: m.prof[0], funcao: m.fResp });
      expect(await porta.vinculoDoUsuario(ctx(), m.paciente)).toBe(true);
      const fila = await porta.filaDaEquipe(ctx());
      expect(fila.map((f) => [f.atendimento, f.paciente, f.responsavel])).toEqual([
        [m.atd, m.paciente, true],
      ]);
      // Outra conta (sem vínculo com profissional aqui) não tem vínculo nem fila.
      const outra = { ...ctx(), usuario: 987_654_321 };
      expect(await porta.vinculoDoUsuario(outra, m.paciente)).toBe(false);
      expect(await porta.filaDaEquipe(outra)).toEqual([]);
    });

    it('o vínculo pela equipe vale na guarda de outra rota clínica (notas do paciente) pelo provedor global', async () => {
      const notas = new NotasPacientePropria(nucleo, CLIENTE);
      const montar = () => {
        const trilha = new RegistradorTrilhaMemoria();
        const ctrl = new NotasPacienteController(
          new EstadoProntuario(),
          trilha,
          notas,
          null,
          null,
          new VinculoAssistencialPelaEquipe(porta),
          null,
        );
        return { trilha, ctrl };
      };
      // Membro da equipe vigente (incluído no teste anterior, atendimento aberto): lê as notas do paciente.
      const dentro = montar();
      await expect(
        dentro.ctrl.doPaciente(m.paciente, requisicao(m.usuario, 'teste.c2064')),
      ).resolves.toBeTruthy();
      expect(dentro.trilha.eventos.some((e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo)).toBe(
        false,
      );
      // Conta fora da equipe: 403 sem-vinculo, a tentativa na trilha, nada gravado.
      const fora = montar();
      await expect(
        fora.ctrl.doPaciente(m.paciente, requisicao(987_654_321, 'teste.c2064.fora')),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        fora.ctrl.gravar(
          { acao: 'registrar', paciente: m.paciente, tipo: 1, texto: 'Sem vínculo' },
          requisicao(987_654_321, 'teste.c2064.fora'),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        fora.trilha.eventos.some(
          (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === m.paciente,
        ),
      ).toBe(true);
      // A porta sintética sem pares (o que cada controller usava sem o provedor) não dá vínculo a ninguém.
      const sintetico = new NotasPacienteController(
        new EstadoProntuario(),
        new RegistradorTrilhaMemoria(),
        notas,
        null,
        null,
        new VinculoSintetico(),
        null,
      );
      await expect(
        sintetico.doPaciente(m.paciente, requisicao(m.usuario, 'teste.c2064')),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('os passos do fim e da reabertura numa transação do executor: vigentes saem com o motivo; reabrir não duplica', async () => {
      await porta.incluirMembro(ctx(), m.atd, {
        profissional: m.prof[1],
        funcao: m.fEnf,
        recebeNotificacao: true,
      });
      // Um membro saiu antes, por outro motivo: não volta na reabertura.
      const equipe = await porta.equipe(ctx(), m.atd);
      const enf = equipe.membros.find((x) => x.profissional === m.prof[1])!;
      await porta.encerrarMembro(ctx(), enf.id, { motivo: 'troca de plantão' });
      await naTransacao('teste.c2064.alta', async (tx) => {
        const agora = new Date();
        await tx.executar(
          "UPDATE atendimento SET situacao = 'encerrado', desfecho = 'alta', saida_em = ? WHERE id = ?",
          [agora, m.atd],
        );
        await encerrarEquipeNoFimDoAtendimento(tx, m.atd, agora);
      });
      const [eq] = await ler<Record<string, unknown>>(
        'SELECT id, situacao, fim_em FROM equipe_assistencial_paciente WHERE atendimento_id = ?',
        [m.atd],
      );
      expect([eq!['situacao'], eq!['fim_em'] !== null]).toEqual(['encerrada', true]);
      const membros = await ler<Record<string, unknown>>(
        'SELECT profissional_id, fim_em, motivo_saida FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ? ORDER BY sequencia',
        [eq!['id']],
      );
      expect(
        membros.map((x) => [Number(x['profissional_id']), x['fim_em'] !== null, x['motivo_saida']]),
      ).toEqual([
        [m.prof[0], true, 'Fim do atendimento'],
        [m.prof[1], true, 'troca de plantão'],
      ]);
      expect(await porta.vinculoDoUsuario(ctx(), m.paciente)).toBe(false);
      expect(await porta.filaDaEquipe(ctx())).toEqual([]);

      await naTransacao('teste.c2064.cancelar_alta', async (tx) => {
        await tx.executar(
          "UPDATE atendimento SET situacao = 'em_atendimento', desfecho = NULL, saida_em = NULL WHERE id = ?",
          [m.atd],
        );
        await reabrirEquipeDoAtendimento(tx, m.atd, new Date());
      });
      const [eq2] = await ler<Record<string, unknown>>(
        'SELECT situacao, fim_em FROM equipe_assistencial_paciente WHERE id = ?',
        [eq!['id']],
      );
      expect([eq2!['situacao'], eq2!['fim_em']]).toEqual(['ativa', null]);
      const depois = await ler<Record<string, unknown>>(
        'SELECT profissional_id, fim_em FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ? ORDER BY sequencia',
        [eq!['id']],
      );
      // Histórico intacto (2 linhas fechadas) e o médico de volta numa linha nova; o enfermeiro que saiu antes, não.
      expect(depois.map((x) => [Number(x['profissional_id']), x['fim_em'] === null])).toEqual([
        [m.prof[0], false],
        [m.prof[1], false],
        [m.prof[0], true],
      ]);
      expect(await porta.vinculoDoUsuario(ctx(), m.paciente)).toBe(true);
      // Reabrir de novo não duplica nada.
      await naTransacao('teste.c2064.cancelar_alta', (tx) =>
        reabrirEquipeDoAtendimento(tx, m.atd, new Date()),
      );
      const n = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM equipe_assistencial_membro WHERE equipe_assistencial_paciente_id = ?',
        [eq!['id']],
      );
      expect(Number(n[0]!.n)).toBe(3);
    });

    it('atendimento.encerrar-atendimento e atendimento.cancelar-atendimento (executor) encerram a equipe na mesma transação', async () => {
      const atd = new PortaAtendimentoPropria(nucleo, CLIENTE);
      for (const a of [m.atdEnc, m.atdCanc]) {
        await porta.incluirMembro(ctx(), a, { profissional: m.prof[0], funcao: m.fResp });
        await porta.incluirMembro(ctx(), a, { profissional: m.prof[1], funcao: m.fEnf });
      }
      await atd.executar(
        ctxAtd(),
        'atendimento.encerrarAtendimento',
        { atendimento: m.atdEnc, desfecho: 'evasao' },
        gravacao(),
      );
      const [a1] = await ler<Record<string, unknown>>(
        'SELECT situacao, desfecho FROM atendimento WHERE id = ?',
        [m.atdEnc],
      );
      expect([a1!['situacao'], a1!['desfecho']]).toEqual(['encerrado', 'evasao']);
      const enc = await membrosDe(m.atdEnc);
      expect(
        enc.map((x) => [
          Number(x['profissional_id']),
          x['fim_em'] !== null,
          x['motivo_saida'],
          x['situacao'],
        ]),
      ).toEqual([
        [m.prof[0], true, 'Fim do atendimento', 'encerrada'],
        [m.prof[1], true, 'Fim do atendimento', 'encerrada'],
      ]);
      expect(enc[0]!['equipe_fim']).not.toBeNull();

      await atd.executar(
        ctxAtd(),
        'atendimento.cancelarAtendimento',
        {
          atendimento: m.atdCanc,
          motivo: m.motivoCanc,
          justificativa: 'Aberto por engano no teste da equipe',
        },
        gravacao({ reautenticadoEm: Date.now() }),
      );
      const [a2] = await ler<Record<string, unknown>>('SELECT situacao FROM atendimento WHERE id = ?', [
        m.atdCanc,
      ]);
      expect(a2!['situacao']).toBe('cancelado');
      const canc = await membrosDe(m.atdCanc);
      expect(canc.map((x) => [x['fim_em'] !== null, x['motivo_saida'], x['situacao']])).toEqual([
        [true, 'Fim do atendimento', 'encerrada'],
        [true, 'Fim do atendimento', 'encerrada'],
      ]);
      // Nada apagado: as 4 participações continuam no histórico.
      const n = await ler<{ n: number }>(
        `SELECT COUNT(*) AS n FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
          WHERE e.atendimento_id IN (?, ?) AND m.excluido_em IS NULL`,
        [m.atdEnc, m.atdCanc],
      );
      expect(Number(n[0]!.n)).toBe(4);
    });

    it('equipe padrão do setor: grava, é sugerida ao atendimento do setor, aplica com os ignorados e desativa', async () => {
      const membros = [
        { funcao: m.fResp, profissional: m.prof[0], responsavel: true },
        { funcao: m.fEnf, profissional: m.prof[1] },
        { funcao: m.fEnf, profissional: null },
      ];
      await expect(porta.gravarPadrao(ctx(), { nome: 'Sem alvo', membros })).rejects.toMatchObject({
        problema: { status: 422 },
      });
      const { id } = await porta.gravarPadrao(ctx(), {
        nome: 'Equipe do setor sintético',
        setor: m.setor,
        membros,
      });
      await expect(
        porta.gravarPadrao(ctx(), { nome: 'Equipe do setor sintético', setor: m.setor, membros }),
      ).rejects.toMatchObject({ problema: { status: 409 } });
      const lidos = await porta.padroes(ctx(), m.atdSetor);
      expect(lidos.sugeridos).toEqual([id]);
      expect(lidos.itens.find((p) => p.id === id)!.membros.map((x) => x.sequencia)).toEqual([1, 2, 3]);
      expect((await porta.padroes(ctx(), m.atd)).sugeridos).toEqual([]);

      const r = await porta.aplicarPadrao(ctx(), m.atdSetor, id);
      expect([r.incluidos, r.ignorados]).toEqual([2, [{ sequencia: 3, codigo: 'funcao-sem-profissional' }]]);
      const [eq] = await ler<Record<string, unknown>>(
        'SELECT equipe_assistencial_padrao_id, situacao FROM equipe_assistencial_paciente WHERE atendimento_id = ?',
        [m.atdSetor],
      );
      expect([Number(eq!['equipe_assistencial_padrao_id']), eq!['situacao']]).toEqual([id, 'ativa']);
      const de = await ler<Record<string, unknown>>(
        `SELECT m.profissional_id, m.responsavel_principal, m.recebe_notificacao FROM equipe_assistencial_membro m
         JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
        WHERE e.atendimento_id = ? ORDER BY m.sequencia`,
        [m.atdSetor],
      );
      expect(de.map((x) => [Number(x['profissional_id']), Number(x['responsavel_principal'])])).toEqual([
        [m.prof[0], 1],
        [m.prof[1], 0],
      ]);
      // Aplicar de novo não repete ninguém.
      const r2 = await porta.aplicarPadrao(ctx(), m.atdSetor, id);
      expect(r2.incluidos).toBe(0);
      expect(r2.ignorados.map((x) => x.codigo)).toEqual([
        'ja-na-equipe',
        'ja-na-equipe',
        'funcao-sem-profissional',
      ]);

      const versao = lidos.itens.find((p) => p.id === id)!.versao;
      await porta.desativarPadrao(ctx(), id, { versao });
      const [q] = await ler<Record<string, unknown>>(
        'SELECT ativo FROM equipe_assistencial_padrao WHERE id = ?',
        [id],
      );
      expect(Number(q!['ativo'])).toBe(0);
      expect((await porta.padroes(ctx(), m.atdSetor)).sugeridos).toEqual([]);
      await expect(porta.aplicarPadrao(ctx(), m.atdSetor, id)).rejects.toMatchObject({
        problema: { status: 404 },
      });
    });
  },
);

// A alta e o cancelamento da alta da internação pelas operações reais (internacao.dar-alta e internacao.cancelar-alta),
// na massa da internação (cliente da onda 3, marca própria 'Q'). A equipe entra pelo preparo (linhas sintéticas).
describe.skipIf(SEM_BANCO)('Equipe assistencial na alta da internação (contrato de efeito)', () => {
  let m: MassaAdt | null = null;
  let adt: PortaAdtPropria;
  let funcao = 0;
  let internacao = 0;
  let atendimento = 0;
  const M = () => m!;
  const FUNCAO = 'c2064-adt';
  const executar = (op: string, entrada: unknown) =>
    adt
      .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
      .then((r) => r.resultado as Record<string, unknown>);
  const membros = (atd: number) =>
    M().nucleo.lerSomente({ cliente: CLIENTE_ADT, correlacao: P }, (l) =>
      l.consultar(
        `SELECT m.profissional_id, m.fim_em, m.motivo_saida, e.situacao
           FROM equipe_assistencial_membro m
           JOIN equipe_assistencial_paciente e ON e.id = m.equipe_assistencial_paciente_id
          WHERE e.atendimento_id = ? ORDER BY m.sequencia`,
        [atd],
      ),
    );
  const limparEquipe = (e: Escritor, ests: readonly number[]) =>
    e
      .executar(
        `DELETE m FROM equipe_assistencial_membro m JOIN equipe_assistencial_paciente q
            ON q.id = m.equipe_assistencial_paciente_id WHERE q.estabelecimento_id IN (?, ?)`,
        [...ests],
      )
      .then(() =>
        e.executar('DELETE FROM equipe_assistencial_paciente WHERE estabelecimento_id IN (?, ?)', [...ests]),
      )
      .then(() => e.executar('DELETE FROM funcao_equipe_assistencial WHERE codigo = ?', [FUNCAO]));

  beforeAll(async () => {
    m = await prepararMassaAdt('Q');
    adt = new PortaAdtPropria(M().nucleo);
    await M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: `preparo-${P}` }, async (e) => {
      await limparEquipe(e, [M().est, M().outro]);
      funcao = await e.inserir(
        `INSERT INTO funcao_equipe_assistencial (codigo, descricao, categoria, responsavel_principal, criado_em)
         VALUES (?, 'Médico assistente (teste da alta)', 'medica', TRUE, ?)`,
        [FUNCAO, new Date()],
      );
    });
    const r = await executar('internacao.internar', {
      paciente: M().pacientes[0]!,
      leito: { bloco: 'B1', acomodacao: 'Q1', leito: '01' },
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
    });
    internacao = Number(r['internacao']);
    atendimento = Number(
      (
        await lerAdt<{ a: number }>(M(), 'SELECT atendimento_id AS a FROM internacao WHERE id = ?', [
          internacao,
        ])
      )?.a,
    );
    // A equipe vigente do atendimento da internação (o médico assistente da massa como responsável).
    await M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: `preparo-${P}` }, async (e) => {
      const agora = new Date();
      const eq = await e.inserir(
        `INSERT INTO equipe_assistencial_paciente (estabelecimento_id, atendimento_id, paciente_id, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?)`,
        [M().est, atendimento, M().pacientes[0], agora, agora],
      );
      await e.inserir(
        `INSERT INTO equipe_assistencial_membro (equipe_assistencial_paciente_id, sequencia, profissional_id,
           funcao_equipe_assistencial_id, responsavel_principal, inicio_em, criado_em)
         VALUES (?, 1, ?, ?, TRUE, ?, ?)`,
        [eq, M().medico, funcao, agora, agora],
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (!m) return;
    await m.nucleo
      .escrever({ cliente: CLIENTE_ADT, correlacao: `limpeza-${P}` }, (e) =>
        limparEquipe(e, [M().est, M().outro]),
      )
      .catch(() => undefined);
    await encerrarMassaAdt(m);
  });

  it('internacao.dar-alta encerra a equipe na mesma transação; internacao.cancelar-alta a reabre com participação nova', async () => {
    const versao = await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [
      internacao,
    ]);
    await executar('internacao.darAlta', {
      internacao,
      motivo: M().motivoSaida,
      medicoAlta: M().medico,
      versao: carimboVersao(versao?.versao),
    });
    expect(
      (await membros(atendimento)).map((x) => [x['fim_em'] !== null, x['motivo_saida'], x['situacao']]),
    ).toEqual([[true, 'Fim do atendimento', 'encerrada']]);

    await executar('internacao.cancelarAlta', {
      internacao,
      justificativa: 'Alta dada no paciente errado',
      motivoCancelamento: M().motivoCancelamentoAlta,
    });
    // A participação antiga fica no histórico (fechada) e o médico volta numa linha nova; a equipe, ativa.
    expect(
      (await membros(atendimento)).map((x) => [
        Number(x['profissional_id']),
        x['fim_em'] === null,
        x['motivo_saida'],
        x['situacao'],
      ]),
    ).toEqual([
      [M().medico, false, 'Fim do atendimento', 'ativa'],
      [M().medico, true, null, 'ativa'],
    ]);
  });
});
