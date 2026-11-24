// Contrato de efeito (F3.9-Q3) das gravações próprias da comissão, da reunião e do sorteio da revisão de prontuários,
// contra o MariaDB do cliente de teste (SGH_CLIENTE_TESTE). Só dados sintéticos, nos estabelecimentos da massa 'K3'.
// Confere no banco: a comissão e a composição como pessoas (o profissional pela conta, o externo pelo nome, o papel
// pela função), a alteração que só muda o que mudou (o membro que sai fica com a exclusão lógica, a versão anterior com
// a composição na trilha), a reunião com a presença de cada membro e o quórum apurado, o sorteio com a amostra em
// revisão e as recusas sem gravar (versão, presente de fora, checklist ausente, competência já sorteada, amostra
// repetida, atendimento de fora, dependentes na inativação).
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravadorGestao } from './porta-gestao.js';
import {
  CLIENTE_QUA,
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { LeiturasGestaoComplementoD } from './porta-propria-complemento-d.js';
import { LeiturasGestaoComplementoQ2 } from './porta-propria-complemento-q2.js';
import {
  dependentesDaComissao,
  gravacoesComissaoSorteio,
  TABELAS_COMISSAO_SORTEIO,
} from './porta-propria-comissao-sorteio.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'comissao_hospitalar',
  entidadeId: null,
  correlacao: 'teste-qualidade-comissao-sorteio',
};
const NUM = randomInt(100_000_000, 999_999_999);
const AGORA = '2026-11-20T10:00:00';
const RESUMO = 'a'.repeat(64);

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ErroOperacao) return `${e.problema.status}:${e.problema.codigo}`;
    throw e;
  }
}

describe.skipIf(SEM_BANCO_QUA)(
  `comissão, reunião e sorteio da revisão no banco próprio (${CLIENTE_QUA})`,
  () => {
    let m: MassaQualidade;
    let c: ReturnType<typeof ctxBanco>;
    const ids: Record<string, number> = {};
    const nomeProf = `PROFISSIONAL SINTETICO K3 ${NUM}`;
    const nomeComissao = `COMISSAO SINTETICA K3 ${NUM}`;

    const gravar = <R>(fn: (g: GravadorGestao) => Promise<R>) =>
      gravacaoDireta(m.nucleo.criarExecutor(), c, {
        nome: 'qualidade.gestao',
        tabelas: TABELAS_COMISSAO_SORTEIO,
        trilha: T,
        gravador: (tx, est, anotacao = { motivo: null, dados: null }) =>
          gravacoesComissaoSorteio(tx, est, anotacao) as unknown as GravadorGestao,
        fn,
      });
    const consulta = (sql: string, p: unknown[]) =>
      m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-k3' }, (e) =>
        e.consultar<Record<string, unknown>>(sql, p),
      );
    const membrosDaTela = (extra: { nome: string; funcao: string; login: string | null }[]) =>
      JSON.stringify([{ nome: 'Quem tem a conta', funcao: 'Presidente', login: m.loginGestor }, ...extra]);
    const comissao = (over: Partial<Parameters<GravadorGestao['registrarComissao']>[0]> = {}) =>
      gravar((g) =>
        g.registrarComissao({
          id: null,
          versao: null,
          tipo: 'prontuario',
          nome: nomeComissao,
          periodicidade: 'mensal',
          membros: membrosDaTela([
            { nome: 'Ana  Externa', funcao: 'Secretária', login: null },
            { nome: 'Bruno Externo', funcao: 'Enfermeiro do CTI', login: null },
          ]),
          ativa: true,
          agora: AGORA,
          usuario: m.login,
          ...over,
        }),
      );

    beforeAll(async () => {
      m = await prepararMassaQualidade('K3');
      c = ctxBanco(m.est, m.codigoEst, m.usuario);
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-teste-k3' }, async (e) => {
        const hoje = new Date('2026-11-01T10:00:00');
        const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
          (await e.uma<{ id: number }>(sel, p))?.id ?? e.inserir(ins, pi);
        await garantir(
          'SELECT id FROM tipo_comissao WHERE codigo = ?',
          ['prontuario'],
          "INSERT INTO tipo_comissao (codigo, descricao, criado_em) VALUES ('prontuario', 'Revisão de prontuários', ?)",
          [hoje],
        );
        await e.executar("UPDATE tipo_comissao SET ativo = TRUE WHERE codigo = 'prontuario'", []);
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          nomeProf,
          hoje,
        ]);
        ids['pf'] = pf;
        const prof = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, hoje],
        );
        ids['prof'] = prof;
        ids['vinculo'] = await e.inserir(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [m.gestor, prof, '2026-01-01', hoje],
        );
        const paciente = await e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
          [pf, NUM, hoje],
        );
        ids['paciente'] = paciente;
        const categoria = await garantir(
          'SELECT id FROM categoria_atendimento WHERE codigo = ?',
          ['sintk3_int'],
          "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES ('sintk3_int', 'Categoria sintética', 'internacao', ?)",
          [hoje],
        );
        const carater = await garantir(
          'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
          ['sk3'],
          "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('sk3', 'Caráter sintético', 'teste', ?)",
          [hoje],
        );
        const fonte = await garantir(
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          ['SINTK3'],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES ('SINTK3', 'Fonte sintética K3', 'particular', ?)",
          [hoje],
        );
        const atendimento = (est: number, k: string) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
            [est, `${NUM}${k}`, paciente, categoria, carater, fonte, prof, hoje, hoje],
          );
        ids['at1'] = await atendimento(m.est, '1');
        ids['at2'] = await atendimento(m.est, '2');
        ids['atOutro'] = await atendimento(m.outro, '3');
      });
    });

    afterAll(async () => {
      // Só o sintético desta execução, na ordem das chaves; a trilha fica (só de acréscimo).
      if (m)
        await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-k3' }, async (e) => {
          const run = (sql: string, p: unknown[]) => e.executar(sql, p).catch(() => undefined);
          const ests = [m.est, m.outro];
          await run(
            'DELETE p FROM reuniao_comissao_participante p JOIN reuniao_comissao r ON r.id = p.reuniao_comissao_id JOIN comissao_hospitalar ch ON ch.id = r.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run(
            'DELETE r FROM reuniao_comissao r JOIN comissao_hospitalar ch ON ch.id = r.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run('DELETE FROM revisao_prontuario WHERE estabelecimento_id IN (?, ?)', ests);
          await run('DELETE FROM sorteio_revisao_prontuario WHERE estabelecimento_id IN (?, ?)', ests);
          await run(
            'DELETE i FROM modelo_checklist_qualidade_item i JOIN modelo_checklist_qualidade_versao v ON v.id = i.modelo_checklist_qualidade_versao_id JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id JOIN comissao_hospitalar ch ON ch.id = q.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run(
            'DELETE v FROM modelo_checklist_qualidade_versao v JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id JOIN comissao_hospitalar ch ON ch.id = q.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run(
            'DELETE q FROM modelo_checklist_qualidade q JOIN comissao_hospitalar ch ON ch.id = q.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run(
            'DELETE mb FROM comissao_membro mb JOIN comissao_hospitalar ch ON ch.id = mb.comissao_hospitalar_id WHERE ch.estabelecimento_id IN (?, ?)',
            ests,
          );
          await run('DELETE FROM comissao_hospitalar WHERE estabelecimento_id IN (?, ?)', ests);
          await run('DELETE FROM atendimento WHERE id IN (?, ?, ?)', [
            ids['at1'],
            ids['at2'],
            ids['atOutro'],
          ]);
          await run('DELETE FROM paciente WHERE id = ?', [ids['paciente']]);
          await run('DELETE FROM usuario_profissional WHERE id = ?', [ids['vinculo']]);
          await run('DELETE FROM profissional WHERE id = ?', [ids['prof']]);
          await run('DELETE FROM pessoa_fisica WHERE id = ?', [ids['pf']]);
        });
      await encerrarMassaQualidade(m);
    });

    it('registrarComissao inclui a comissão e a composição como pessoas', async () => {
      const r = await comissao();
      expect(r).toMatchObject({ versao: 1, criada: true });
      ids['comissao'] = r.id;
      const [ch] = await consulta(
        'SELECT situacao, periodicidade_reuniao, nome FROM comissao_hospitalar WHERE id = ?',
        [r.id],
      );
      expect(ch).toMatchObject({ situacao: 'ativa', periodicidade_reuniao: 'mensal', nome: nomeComissao });
      const mb = await consulta(
        'SELECT colaborador_id, profissional_id, nome_externo, papel, funcao, excluido_em FROM comissao_membro WHERE comissao_hospitalar_id = ? ORDER BY id',
        [r.id],
      );
      expect(mb).toHaveLength(3);
      expect(mb[0]).toMatchObject({
        colaborador_id: null,
        profissional_id: ids['prof'],
        nome_externo: null,
        papel: 'presidente',
      });
      expect(mb[1]).toMatchObject({ nome_externo: 'Ana Externa', papel: 'secretario', funcao: 'Secretária' });
      expect(mb[2]).toMatchObject({
        nome_externo: 'Bruno Externo',
        papel: 'membro',
        funcao: 'Enfermeiro do CTI',
      });
      // A leitura da comissão mostra a pessoa do cadastro (não o nome digitado) e o login pelo vínculo do profissional.
      const lida = await new LeiturasGestaoComplementoQ2(m.nucleo).comissao(c, r.id);
      const membros = JSON.parse(lida!.membros) as { nome: string; funcao: string; login: string | null }[];
      expect(membros.map((x) => x.nome)).toEqual([nomeProf, 'Ana Externa', 'Bruno Externo']);
      expect(membros[0]!.login).toBe(m.loginGestor.toUpperCase());
      expect(membros[2]!.funcao).toBe('Enfermeiro do CTI');
    });

    it('registrarComissao recusa nome repetido, conta inexistente e conta sem cadastro, sem gravar', async () => {
      expect(await codigoDe(comissao())).toBe('409:comissao-duplicada');
      const outra = { nome: `${nomeComissao} B` };
      expect(
        await codigoDe(
          comissao({
            ...outra,
            membros: JSON.stringify([{ nome: 'X', funcao: 'Membro', login: 'nao.existe.k3' }]),
          }),
        ),
      ).toBe('409:usuario-inexistente');
      expect(
        await codigoDe(
          comissao({ ...outra, membros: JSON.stringify([{ nome: 'Y', funcao: 'Membro', login: m.login }]) }),
        ),
      ).toBe('409:conta-sem-cadastro');
      expect(await consulta('SELECT id FROM comissao_hospitalar WHERE nome = ?', [outra.nome])).toHaveLength(
        0,
      );
    });

    it('a alteração só muda o que mudou e guarda a versão anterior com a composição', async () => {
      const r = await comissao({
        id: ids['comissao']!,
        versao: 1,
        membros: membrosDaTela([
          { nome: 'Ana Externa', funcao: 'Secretária executiva', login: null },
          { nome: 'Carla Externa', funcao: 'Farmacêutica', login: null },
        ]),
        justificativa: 'Troca de membro da enfermagem',
      });
      expect(r).toMatchObject({ id: ids['comissao'], versao: 2, criada: false });
      const mb = await consulta(
        'SELECT nome_externo, funcao, excluido_em FROM comissao_membro WHERE comissao_hospitalar_id = ? ORDER BY id',
        [ids['comissao']],
      );
      expect(mb).toHaveLength(4); // nada é apagado: quem saiu fica com a exclusão lógica
      expect(mb[1]).toMatchObject({
        nome_externo: 'Ana Externa',
        funcao: 'Secretária executiva',
        excluido_em: null,
      });
      expect(mb[2]!['excluido_em']).not.toBeNull();
      expect(mb[3]).toMatchObject({ nome_externo: 'Carla Externa', excluido_em: null });
      const versoes = await new LeiturasGestaoComplementoD(m.nucleo).versoes(
        c,
        'comissao_hospitalar',
        ids['comissao']!,
      );
      expect(versoes.length).toBeGreaterThan(0);
      expect(JSON.stringify(versoes)).toContain('Bruno Externo');
      expect(
        await codigoDe(comissao({ id: ids['comissao']!, versao: 1, justificativa: 'Versão velha da tela' })),
      ).toBe('409:versao-desatualizada');
    });

    it('registrarReuniaoComissao grava a reunião, a presença de cada membro e o quórum', async () => {
      const reuniao = (presentes: string[], versaoComissao = 2) =>
        gravar((g) =>
          g.registrarReuniaoComissao({
            comissao: ids['comissao']!,
            versaoComissao,
            tipo: 'ordinaria',
            realizadaEm: '2026-11-19T14:00:00',
            pauta: 'Pauta sintética',
            ata: 'Ata sintética da reunião ordinária',
            presentes: JSON.stringify(presentes),
            membrosTotal: 3,
            presentesTotal: presentes.length,
            convidados: null,
            deliberacoes: null,
            agora: AGORA,
            usuario: m.login,
          }),
        );
      expect(await codigoDe(reuniao([nomeProf], 1))).toBe('409:versao-desatualizada');
      expect(await codigoDe(reuniao(['Bruno Externo']))).toBe('409:presente-fora-da-composicao');
      const r = await reuniao([nomeProf, 'ana externa']);
      const [x] = await consulta(
        'SELECT situacao, realizada_em, membros_quantidade, presentes_quantidade, quorum_atingido, versao_composicao FROM reuniao_comissao WHERE id = ?',
        [r.id],
      );
      expect(x).toMatchObject({
        situacao: 'realizada',
        membros_quantidade: 3,
        presentes_quantidade: 2,
        versao_composicao: 2,
      });
      expect(Number(x!['quorum_atingido'])).toBe(1);
      const p = await consulta(
        'SELECT presente FROM reuniao_comissao_participante WHERE reuniao_comissao_id = ? ORDER BY comissao_membro_id',
        [r.id],
      );
      expect(p.map((y) => Number(y['presente']))).toEqual([1, 1, 0]);
      expect(
        await consulta('SELECT id FROM reuniao_comissao WHERE comissao_hospitalar_id = ?', [ids['comissao']]),
      ).toHaveLength(1);
    });

    it('sortearRevisao grava o sorteio e a amostra; recusa sem checklist, repetido e de fora', async () => {
      const sortear = (over: Partial<Parameters<GravadorGestao['sortearRevisao']>[0]> = {}) =>
        gravar((g) =>
          g.sortearRevisao({
            comissao: ids['comissao']!,
            checklist: ids['checklist'] ?? 0,
            competencia: '2026-10',
            semente: 'semente-k3',
            universo: 5,
            resumoUniverso: RESUMO,
            amostra: [ids['at1']!, ids['at2']!].map((reg) => ({
              reg,
              paciente: ids['paciente']!,
              alta: '2026-10-10',
              clinica: '',
              medicoRegistro: null,
              medicoNome: null,
            })),
            agora: AGORA,
            usuario: m.login,
            ...over,
          }),
        );
      expect(await codigoDe(sortear())).toBe('409:checklist-ausente');
      await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-checklist-k3' }, async (e) => {
        const hoje = new Date('2026-11-01T10:00:00');
        const modelo = await e.inserir(
          `INSERT INTO modelo_checklist_qualidade (codigo, nome, finalidade, comissao_hospitalar_id, situacao, criado_em)
           VALUES (?, 'Checklist sintético K3', 'revisao_prontuario', ?, 'publicado', ?)`,
          [`SK3${NUM}`, ids['comissao'], hoje],
        );
        ids['checklist'] = await e.inserir(
          `INSERT INTO modelo_checklist_qualidade_versao (modelo_checklist_qualidade_id, operacao, ocorrido_em, numero_versao,
           situacao, vigencia_inicio, motivo_publicacao, publicado_em, publicador_usuario_id, criado_em)
           VALUES (?, 'inclusao', ?, 1, 'vigente', '2026-01-01', 'Publicação sintética', ?, ?, ?)`,
          [modelo, hoje, hoje, m.usuario, hoje],
        );
      });
      const umItem = (reg: number) => [
        {
          reg,
          paciente: ids['paciente']!,
          alta: '2026-10-10',
          clinica: '',
          medicoRegistro: null,
          medicoNome: null,
        },
      ];
      expect(
        await codigoDe(
          sortear({
            checklist: ids['checklist']!,
            amostra: [...umItem(ids['at1']!), ...umItem(ids['at1']!)],
          }),
        ),
      ).toBe('409:prontuario-repetido');
      expect(
        await codigoDe(sortear({ checklist: ids['checklist']!, amostra: umItem(ids['atOutro']!) })),
      ).toBe('409:prontuario-fora-do-universo');
      const r = await sortear({ checklist: ids['checklist']! });
      const [s] = await consulta(
        "SELECT situacao, DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia, quantidade, universo_quantidade, semente, hash_universo FROM sorteio_revisao_prontuario WHERE id = ?",
        [r.id],
      );
      expect(s).toMatchObject({
        situacao: 'sorteado',
        competencia: '2026-10-01',
        quantidade: 2,
        universo_quantidade: 5,
        semente: 'semente-k3',
        hash_universo: RESUMO,
      });
      const rv = await consulta(
        'SELECT atendimento_id, paciente_id, situacao, modelo_checklist_qualidade_versao_id AS chk FROM revisao_prontuario WHERE sorteio_revisao_prontuario_id = ? ORDER BY id',
        [r.id],
      );
      expect(rv.map((y) => [Number(y['atendimento_id']), y['situacao'], Number(y['chk'])])).toEqual([
        [ids['at1'], 'em_andamento', ids['checklist']],
        [ids['at2'], 'em_andamento', ids['checklist']],
      ]);
      expect(await codigoDe(sortear({ checklist: ids['checklist']! }))).toBe('409:competencia-ja-sorteada');
      expect(
        await consulta('SELECT id FROM sorteio_revisao_prontuario WHERE comissao_hospitalar_id = ?', [
          ids['comissao'],
        ]),
      ).toHaveLength(1);
    });

    it('inativar a comissão com checklist vigente e sorteio em andamento recusa sem gravar', async () => {
      const deps = await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'conferencia-k3' }, (e) =>
        dependentesDaComissao(e, m.est, ids['comissao']!),
      );
      expect(deps.map((d) => [d.dependente, d.quantidade])).toEqual([
        ['modelo_checklist_qualidade_versao', 1],
        ['sorteio_revisao_prontuario', 1],
      ]);
      expect(
        await codigoDe(
          comissao({
            id: ids['comissao']!,
            versao: 2,
            ativa: false,
            justificativa: 'Inativação sintética da comissão',
            conferirDependentes: true,
            membros: membrosDaTela([
              { nome: 'Ana Externa', funcao: 'Secretária executiva', login: null },
              { nome: 'Carla Externa', funcao: 'Farmacêutica', login: null },
            ]),
          }),
        ),
      ).toBe('409:com-dependentes');
      const [ch] = await consulta('SELECT situacao, versao FROM comissao_hospitalar WHERE id = ?', [
        ids['comissao'],
      ]);
      expect(ch).toMatchObject({ situacao: 'ativa', versao: 2 });
    });
  },
);
