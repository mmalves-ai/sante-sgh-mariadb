// Contrato de efeito da equipe assistencial ligada ao resto do hospital (03-PEP L94, C2-064) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, atendimentos e setor fictícios (chaves de
// catálogo desligadas só no preparo), funções de equipe do teste e o vínculo da conta com o profissional nesse
// estabelecimento; usuário, paciente e profissionais são ids já existentes do cliente de teste (só lidos).
// Prova o que fica no banco: o vínculo assistencial pela equipe para a CONTA da sessão (só com atendimento aberto), a
// fila de pendências pelos destinatários, o fim do atendimento encerrando a equipe na mesma transação (vigentes com o
// motivo, nada apagado) e o cancelamento da alta reabrindo-a (participação nova; a antiga no histórico), e a equipe
// padrão do setor (gravada, sugerida ao atendimento do setor, aplicada numa transação com os ignorados, desativada).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Escritor, NucleoProprio, type TxOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  encerrarEquipeNoFimDoAtendimento,
  reabrirEquipeDoAtendimento,
  TABELAS_EQUIPE_ATENDIMENTO,
} from './equipe-fim-atendimento.js';
import { PortaEquipePainelPropria } from './equipe-painel-propria.js';

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
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
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
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        try {
          const setor = await e.inserir(
            `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
           VALUES (?, ?, 'Setor sintético', 'assistencial', ?)`,
            [est, `${P}-s`, agora],
          );
          const atender = (numero: string, setorId: number | null) =>
            e.inserir(
              `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em)
             VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?)`,
              [est, numero, paciente['id'], profs[0]!['id'], setorId, agora, agora],
            );
          const atd = await atender(`${P}-1`, null);
          const atdSetor = await atender(`${P}-2`, setor);
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
            setor,
            fResp,
            fEnf,
          };
        } finally {
          await e.executar('SET FOREIGN_KEY_CHECKS = 1');
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

    it('fim do atendimento encerra a equipe na mesma transação; o cancelamento da alta a reabre com participação nova', async () => {
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
