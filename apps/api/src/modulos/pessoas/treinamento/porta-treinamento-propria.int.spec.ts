// Integração da porta própria dos treinamentos contra o MariaDB real (cliente f22_o3, criado por
// `python3 -I tools/db/criar_cliente.py f22_o3 "Teste F2.2 onda 3"`). Massa SINTÉTICA (dois estabelecimentos, um usuário
// de serviço, cargo, função, setor e dois colaboradores com CPF fictício), montada de forma idempotente; as linhas do
// treinamento são apagadas antes e depois. Contrato de efeito: as linhas, a versão, a trilha e as recusas (versão
// desatualizada, entrada fora do modelo, outro estabelecimento). Nada de dado real; só códigos e contagens.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/modulos/pessoas/treinamento/porta-treinamento-propria.int.spec.ts
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chaveFuncao } from '@sgh/dominio-pessoas';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/configuracao-fonte.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import type { ContextoTreinamento, GravadorTreinamento, PortaTreinamento } from './porta-treinamento.js';
import { PortaTreinamentoMemoria } from './porta-treinamento-memoria.js';
import { PortaTreinamentoPropria } from './porta-treinamento-propria.js';
import { ServicoTreinamento } from './servico-treinamento.js';

const CLIENTE = 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const FUNCAO = 'Técnico de enfermagem F2211';
const CURSO = `F2211-${Date.now().toString(36)}`;

const codigoDe = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => 'ok',
    (e: unknown) =>
      (e as { problema?: { codigo?: string } }).problema?.codigo ??
      (e as { extras?: { codigo?: string } }).extras?.codigo ??
      `outro: ${(e as Error).message}`,
  );
/** A data `n` dias depois de `d` (AAAA-MM-DD). */
const dia = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('porta própria dos treinamentos contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTreinamentoPropria;
  let A: ContextoTreinamento;
  let B: ContextoTreinamento;
  let setor = 0;
  let v1 = 0;
  let v2 = 0;
  let tipoFluxo = 0;

  const limpar = (estabs: readonly number[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'int-03-11-limpeza' }, async (e) => {
      const m = estabs.map(() => '?').join(', ');
      await e.executar(
        `DELETE c FROM ciencia_procedimento c JOIN documento_qualidade d ON d.id = c.documento_qualidade_id WHERE d.estabelecimento_id IN (${m})`,
        estabs,
      );
      await e.executar(
        `DELETE p FROM presenca_treinamento p JOIN turma_treinamento t ON t.id = p.turma_treinamento_id WHERE t.estabelecimento_id IN (${m})`,
        estabs,
      );
      await e.executar(`DELETE FROM turma_treinamento WHERE estabelecimento_id IN (${m})`, estabs);
      await e.executar(
        `UPDATE documento_qualidade SET documento_qualidade_versao_id = NULL WHERE estabelecimento_id IN (${m})`,
        estabs,
      );
      await e.executar(
        `DELETE v FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id WHERE d.estabelecimento_id IN (${m})`,
        estabs,
      );
      await e.executar(`DELETE FROM documento_qualidade WHERE estabelecimento_id IN (${m})`, estabs);
      await e.executar(
        `DELETE o FROM treinamento_obrigatorio_funcao o JOIN funcao f ON f.id = o.funcao_id WHERE f.estabelecimento_id IN (${m})`,
        estabs,
      );
      await e.executar("DELETE FROM curso WHERE codigo LIKE 'F2211-%'", []);
    });

  beforeAll(async () => {
    const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
      cwd: RAIZ,
    }).toString();
    if (!lista.split('\n').some((l) => l.split('\t').includes(CLIENTE)))
      execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], {
        cwd: RAIZ,
      });
    nucleo = new NucleoProprio();
    porta = new PortaTreinamentoPropria(nucleo);
    const ids = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'int-03-11-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB SINTETICO ${codigo}`, `ESTAB SINTETICO ${codigo} LTDA`, agora],
        );
      const estA = await est('f2211a');
      const estB = await est('f2211b');
      const usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f2211.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f2211.teste', 'USUARIO SINTETICO F2211', agora],
      );
      const sexo = await garantir(
        e,
        'SELECT id FROM sexo WHERE codigo = ?',
        ['f2211'],
        'INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        ['f2211', 'SEXO SINTETICO', 'Z', agora],
      );
      const cbo = await garantir(
        e,
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        ['999311'],
        'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, ?, ?)',
        ['999311', 'OCUPACAO SINTETICA', agora],
      );
      const cargo = await garantir(
        e,
        'SELECT id FROM cargo WHERE codigo = ?',
        ['F2211'],
        'INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['F2211', 'Técnico sintético', cbo, '2020-01-01', agora],
      );
      const funcao = await garantir(
        e,
        'SELECT id FROM funcao WHERE estabelecimento_id = ? AND codigo = ?',
        [estA, 'F2211'],
        'INSERT INTO funcao (estabelecimento_id, codigo, nome, cargo_id, criado_em) VALUES (?, ?, ?, ?, ?)',
        [estA, 'F2211', FUNCAO, cargo, agora],
      );
      const setorA = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [estA, 'F2211'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
        [estA, 'F2211', 'SETOR SINTETICO F2211', agora],
      );
      const tipoVinculo = await garantir(
        e,
        'SELECT id FROM tipo_vinculo_trabalho WHERE codigo_cnes = ?',
        ['F2211'],
        "INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, criado_em) VALUES (?, 'vinculo', ?, ?, ?)",
        ['F2211', '99', 'VINCULO SINTETICO', agora],
      );
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_trabalhador WHERE codigo_esocial = ?',
        ['999'],
        "INSERT INTO categoria_trabalhador (codigo_esocial, descricao, grupo, criado_em) VALUES (?, ?, 'empregado', ?)",
        ['999', 'CATEGORIA SINTETICA', agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_documento_qualidade WHERE codigo = ?',
        ['F2211POP'],
        "INSERT INTO tipo_documento_qualidade (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'procedimento_operacional', ?)",
        ['F2211POP', 'POP SINTETICO', agora],
      );
      // O tipo de POP de publicação direta (sem o fluxo da qualidade), com a revisão a cada 24 meses.
      await e.executar(
        "UPDATE tipo_documento_qualidade SET exige_fluxo_completo = FALSE, prazo_revisao_meses = 24, ativo = TRUE WHERE codigo = 'F2211POP'",
        [],
      );
      // O tipo que exige o fluxo completo da qualidade (padrão do modelo).
      const tipoFluxo = await garantir(
        e,
        'SELECT id FROM tipo_documento_qualidade WHERE codigo = ?',
        ['F2211POPF'],
        "INSERT INTO tipo_documento_qualidade (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'procedimento_operacional', ?)",
        ['F2211POPF', 'POP SINTETICO COM FLUXO', agora],
      );
      const vinculo = async (k: number) => {
        const col = await garantir(
          e,
          'SELECT id FROM colaborador WHERE cpf = ?',
          [`9990311000${k}`],
          "INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, ?, '1990-01-01', ?, '07', ?)",
          [`COLABORADOR SINTETICO ${k}`, `9990311000${k}`, sexo, agora],
        );
        return garantir(
          e,
          'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ?',
          [estA, `F2211-${k}`],
          `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id,
             categoria_trabalhador_id, cargo_id, funcao_id, setor_funcional_id, data_admissao, salario_base, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2025-01-10', 1000, ?)`,
          [estA, col, `F2211-${k}`, tipoVinculo, categoria, cargo, funcao, setorA, agora],
        );
      };
      return { estA, estB, usuario, setorA, tipoFluxo, v1: await vinculo(1), v2: await vinculo(2) };
    });
    A = { cliente: CLIENTE, estabelecimento: ids.estA, usuario: ids.usuario, correlacao: 'int-03-11' };
    B = { ...A, estabelecimento: ids.estB };
    setor = ids.setorA;
    tipoFluxo = ids.tipoFluxo;
    v1 = ids.v1;
    v2 = ids.v2;
    await limpar([ids.estA, ids.estB]);
  }, 300_000);

  afterAll(async () => {
    if (A && B) await limpar([A.estabelecimento!, B.estabelecimento!]);
    await nucleo?.encerrar();
  });

  const trilha = (c: ContextoTreinamento, entidade: string): TrilhaDaGravacao => ({
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    acao: 'inclusao',
    entidade,
    entidadeId: null,
    correlacao: c.correlacao,
  });
  const g = <T>(
    fn: (x: GravadorTreinamento) => Promise<T>,
    c: ContextoTreinamento = A,
    entidade = 'turma_treinamento',
  ) => porta.gravarSgh(c, trilha(c, entidade), fn);
  const contar = (sql: string, ps: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-03-11' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, ps))?.n ?? 0),
    );

  it('curso, turma, presença com conclusão e ciência do POP, correção, retirada e POP versionado', async () => {
    const { hoje, agora } = await porta.relogio(A);
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(agora.slice(0, 10)).toBe(hoje);
    expect((await porta.unidades(A)).map((u) => u.codigo)).toContain(setor);

    // POP versão 1.
    const pop1 = await g(
      (x) =>
        x.incluirPop({
          codigo: 'F2211-POP',
          versao: 1,
          titulo: 'POP SINTETICO',
          unidade: null,
          vigencia: hoje,
          resumo: 'Resumo sintético',
          referencia: 'Ref sintética',
          alteracoes: null,
          por: 'f2211.teste',
        }),
      A,
      'documento_qualidade_versao',
    );
    const [p1] = await porta.pops(A, { vigentes: true });
    expect(p1).toMatchObject({
      id: pop1,
      codigo: 'F2211-POP',
      versao: 1,
      situacao: 'vigente',
      referencia: 'Ref sintética',
    });
    expect(p1?.publicadoPor).toBe('f2211.teste');
    expect(
      await contar(
        `SELECT COUNT(*) n FROM documento_qualidade_versao WHERE id = ? AND aprovador_usuario_id IS NULL AND aprovado_em IS NULL
           AND proxima_revisao = DATE_ADD(vigencia_inicio, INTERVAL 24 MONTH)`,
        [pop1],
      ),
    ).toBe(1);

    // Curso obrigatório para a função; o que o modelo ainda não guarda recusa.
    const camposCurso = {
      codigo: CURSO,
      titulo: 'NR 32 sintético',
      conteudo: 'Conteúdo sintético',
      categoria: 'nr32' as const,
      cargaMinimaMin: 60,
      validadeMeses: 12,
      obrigatorio: true,
      alvos: [{ tipo: 'funcao' as const, valor: chaveFuncao(FUNCAO) }],
      por: 'f2211.teste',
    };
    const curso = await g((x) => x.incluirCurso(camposCurso), A, 'curso');
    expect(await porta.curso(A, curso)).toMatchObject({
      categoria: 'nr32',
      obrigatorio: true,
      validadeMeses: 12,
      versao: 1,
    });
    expect((await porta.curso(A, curso))?.alvos).toEqual([{ tipo: 'funcao', valor: chaveFuncao(FUNCAO) }]);
    expect(
      await contar(
        'SELECT COUNT(*) n FROM treinamento_obrigatorio_funcao WHERE curso_id = ? AND excluido_em IS NULL',
        [curso],
      ),
    ).toBe(1);
    expect(
      await codigoDe(
        g((x) => x.incluirCurso({ ...camposCurso, codigo: `${CURSO}x`, categoria: 'pop' }), A, 'curso'),
      ),
    ).toBe('modelo-pendente');
    expect(
      await codigoDe(
        g(
          (x) =>
            x.incluirCurso({
              ...camposCurso,
              codigo: `${CURSO}y`,
              alvos: [{ tipo: 'unidade', valor: String(setor) }],
            }),
          A,
          'curso',
        ),
      ),
    ).toBe('modelo-pendente');
    expect(await codigoDe(g((x) => x.incluirCurso(camposCurso), A, 'curso'))).toBe('codigo-repetido');

    // Turma com o POP, número de negócio e inscrições.
    const turma = await g((x) =>
      x.incluirTurma({
        curso,
        inicio: hoje,
        fim: hoje,
        cargaMin: 120,
        instrutor: ' INSTRUTORA SINTETICA ',
        modalidade: 'em-servico',
        local: 'Sala sintética',
        pop: pop1,
        observacao: null,
        por: 'f2211.teste',
      }),
    );
    expect(await porta.turma(A, turma)).toMatchObject({
      pop: pop1,
      modalidade: 'em-servico',
      situacao: 'aberta',
      instrutor: 'INSTRUTORA SINTETICA',
      versao: 1,
    });
    expect(
      await contar("SELECT COUNT(*) n FROM turma_treinamento WHERE id = ? AND numero LIKE 'TR-%'", [turma]),
    ).toBe(1);
    await g(async (x) => {
      await x.incluirParticipante({ treinamento: turma, vinculo: v1, por: 'f2211.teste' });
      await x.incluirParticipante({ treinamento: turma, vinculo: v2, por: 'f2211.teste' });
    });
    expect((await porta.participantes(A, turma)).map((p) => p.vinculo).sort()).toEqual([v1, v2].sort());
    expect(
      await codigoDe(g((x) => x.incluirParticipante({ treinamento: turma, vinculo: v1, por: 'x' }))),
    ).toBe('ja-inscrito');

    // Presença com conclusão e a ciência do POP pela turma; a versão velha é recusada.
    const pa = (await porta.participantes(A, turma)).find((p) => p.vinculo === v1)!;
    await g(async (x) => {
      await x.registrarParticipacao({
        id: pa.id,
        versao: pa.versao,
        presenca: 'presente',
        aproveitamento: 'aprovado',
        conclusao: hoje,
        validoAte: '2099-12-31',
        observacao: 'Observação sintética',
        por: 'f2211.teste',
      });
      await x.incluirCiencia({ pop: pop1, vinculo: v1, treinamento: turma, por: 'f2211.teste' });
    });
    const pa2 = (await porta.participantes(A, turma)).find((p) => p.vinculo === v1)!;
    expect(pa2).toMatchObject({
      presenca: 'presente',
      aproveitamento: 'aprovado',
      conclusao: hoje,
      validoAte: '2099-12-31',
      versao: pa.versao + 1,
    });
    expect((await porta.turma(A, turma))?.concluintes).toBe(1);
    expect(await porta.conclusoes(A, [v1])).toEqual([
      { vinculo: v1, curso, conclusao: hoje, validoAte: '2099-12-31' },
    ]);
    expect((await porta.conclusoes(A, null)).filter((k) => k.curso === curso)).toHaveLength(1);
    expect(await porta.ciencias(A, { vinculo: v1 })).toEqual([
      expect.objectContaining({
        pop: pop1,
        vinculo: v1,
        origem: 'treinamento',
        treinamento: turma,
        registradoPor: 'f2211.teste',
      }),
    ]);
    expect(
      await codigoDe(g((x) => x.incluirCiencia({ pop: pop1, vinculo: v1, treinamento: null, por: 'x' }))),
    ).toBe('ja-ciente');
    expect(
      await codigoDe(
        g((x) =>
          x.registrarParticipacao({
            ...pa,
            versao: pa.versao,
            presenca: 'ausente',
            aproveitamento: null,
            conclusao: null,
            por: 'x',
          }),
        ),
      ),
    ).toBe('desatualizado');
    expect((await porta.participacoes(A, v1))[0]).toMatchObject({
      curso,
      treinamento: turma,
      turmaSituacao: 'aberta',
    });

    // Alteração da turma com o valor anterior na trilha.
    const t1 = (await porta.turma(A, turma))!;
    await g(async (x) => {
      await x.alterarTurma({
        id: turma,
        versao: t1.versao,
        inicio: hoje,
        fim: hoje,
        cargaMin: 180,
        instrutor: 'OUTRA',
        modalidade: 'presencial',
        local: null,
        pop: pop1,
        observacao: null,
        por: 'f2211.teste',
      });
      await x.registrarCorrecao({
        tabela: 'turma_treinamento',
        registro: turma,
        operacao: 'pessoas.turma.alterada',
        antes: { cargaMin: 120 },
        depois: { cargaMin: 180 },
        motivo: 'Motivo sintético',
        por: 'f2211.teste',
      });
    });
    expect((await porta.turma(A, turma))?.versao).toBe(t1.versao + 1);
    expect(await porta.correcoes(A, 'turma_treinamento', [turma])).toEqual([
      expect.objectContaining({
        operacao: 'pessoas.turma.alterada',
        antes: { cargaMin: 120 },
        depois: { cargaMin: 180 },
        motivo: 'Motivo sintético',
        por: 'f2211.teste',
      }),
    ]);
    expect(
      await contar(
        "SELECT COUNT(*) n FROM trilha_auditoria WHERE entidade = 'turma_treinamento' AND entidade_id = ?",
        [turma],
      ),
    ).toBeGreaterThanOrEqual(1);

    // Retirada: só sem presença; a linha fica (exclusão lógica) e a reinscrição a reaproveita.
    const pb = (await porta.participantes(A, turma)).find((p) => p.vinculo === v2)!;
    expect(
      await g((x) => x.retirarInscricao({ id: pa2.id, versao: pa2.versao, motivo: 'engano', por: 'x' })),
    ).toBe(false);
    expect(
      await g((x) =>
        x.retirarInscricao({ id: pb.id, versao: pb.versao, motivo: 'Inscrito por engano', por: 'x' }),
      ),
    ).toBe(true);
    expect((await porta.participantes(A, turma)).map((p) => p.vinculo)).toEqual([v1]);
    expect(
      await contar('SELECT COUNT(*) n FROM presenca_treinamento WHERE id = ? AND excluido_em IS NOT NULL', [
        pb.id,
      ]),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) n FROM trilha_auditoria WHERE entidade = 'presenca_treinamento' AND entidade_id = ? AND acao = 'exclusao'",
        [pb.id],
      ),
    ).toBe(1);
    expect(await g((x) => x.incluirParticipante({ treinamento: turma, vinculo: v2, por: 'x' }))).toBe(pb.id);

    // POP versão 2 substitui a 1; a revogação guarda o motivo.
    const pop2 = await g(
      async (x) => {
        await x.situacaoPop({ id: pop1, situacao: 'substituido', motivo: null, por: 'x' });
        return x.incluirPop({
          codigo: 'F2211-POP',
          versao: 2,
          titulo: 'POP SINTETICO V2',
          unidade: setor,
          vigencia: hoje,
          resumo: 'Resumo 2',
          referencia: null,
          alteracoes: 'Mudou',
          por: 'x',
        });
      },
      A,
      'documento_qualidade_versao',
    );
    expect(
      (await porta.pops(A, { codigo: 'F2211-POP' })).map((p) => [p.versao, p.situacao, p.unidade]),
    ).toEqual([
      [2, 'vigente', setor],
      [1, 'substituido', null],
    ]);
    expect(
      await codigoDe(g((x) => x.situacaoPop({ id: pop1, situacao: 'revogado', motivo: 'x', por: 'x' }))),
    ).toBe('desatualizado');
    await g((x) => x.situacaoPop({ id: pop2, situacao: 'revogado', motivo: 'Revogado sintético', por: 'x' }));
    expect(await porta.pop(A, pop2)).toMatchObject({
      situacao: 'revogado',
      motivo: 'Revogado sintético',
      alteracoes: 'Mudou',
    });

    // Vínculos e encerramento.
    expect((await porta.ativos(A, setor)).map((v) => v.id).sort()).toEqual([v1, v2].sort());
    expect((await porta.vinculos(A, [v1]))[0]).toMatchObject({
      id: v1,
      cargo: 'Técnico sintético',
      funcao: FUNCAO,
      unidade: setor,
      desligamento: null,
    });
    const t2 = (await porta.turma(A, turma))!;
    await g((x) =>
      x.situacaoTurma({ id: turma, versao: t2.versao, situacao: 'encerrada', motivo: null, por: 'x' }),
    );
    expect((await porta.turmas(A, { situacao: 'encerrada', curso })).map((t) => t.id)).toEqual([turma]);
    // A versão do POP da turma não muda com a v2 publicada e revogada nem com a alteração e o encerramento.
    expect((await porta.turma(A, turma))?.pop).toBe(pop1);

    // POP pela tela de treinamento: o documento em fluxo na qualidade e o tipo que exige o fluxo recusam.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'int-03-11-fluxo' }, async (e) => {
      const docId = await e.uma<{ id: number }>(
        "SELECT id FROM documento_qualidade WHERE estabelecimento_id = ? AND codigo = 'F2211-POP'",
        [A.estabelecimento],
      );
      await e.executar(
        `INSERT INTO documento_qualidade_versao (documento_qualidade_id, operacao, ocorrido_em, numero_versao, situacao, formato, conteudo, criado_em)
          VALUES (?, 'inclusao', ?, '3', 'rascunho', 'texto', 'Rascunho sintético', ?)`,
        [Number(docId!.id), new Date(), new Date()],
      );
      await e.executar(
        `INSERT INTO documento_qualidade (estabelecimento_id, codigo, titulo, tipo_documento_qualidade_id, dono_usuario_id, situacao, criado_em)
          VALUES (?, 'F2211-POPF', 'POP SINTETICO COM FLUXO', ?, ?, 'vigente', ?)`,
        [A.estabelecimento, tipoFluxo, A.usuario, new Date()],
      );
    });
    const novoPop = (codigo: string, versao: number) =>
      g(
        (x) =>
          x.incluirPop({
            codigo,
            versao,
            titulo: 'POP SINTETICO',
            unidade: null,
            vigencia: hoje,
            resumo: 'R',
            referencia: null,
            alteracoes: 'M',
            por: 'x',
          }),
        A,
        'documento_qualidade_versao',
      );
    expect(await codigoDe(novoPop('F2211-POP', 3))).toBe('pop-em-fluxo');
    expect(await codigoDe(novoPop('F2211-POPF', 1))).toBe('fluxo-da-qualidade');

    // Outro estabelecimento não vê nem grava.
    expect(await porta.turma(B, turma)).toBeNull();
    expect(await porta.ativos(B, null)).toEqual([]);
    expect(await porta.pops(B, {})).toEqual([]);
    expect(
      await codigoDe(g((x) => x.incluirParticipante({ treinamento: turma, vinculo: v1, por: 'x' }), B)),
    ).toBe('vinculo-inexistente');
  }, 300_000);

  it('serviço sobre a porta própria: regra 20, conclusão com a data real, pop-com-conclusao e a versão estável', async () => {
    const chave: ChaveLiberacao = {
      id: 'pessoas.treinamento',
      tipo: 'recurso',
      chave: 'pessoas.treinamento',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'teste sintético',
      alteradoPor: 'f2211.teste',
      alteradoEm: '2026-11-01T10:00:00',
    };
    const cumprido: PrerequisitoRecurso = {
      recurso: 'pessoas.treinamento',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: null,
      evidencia: 'conferência sintética',
      alteradoPor: 'f2211.teste',
      alteradoEm: '2026-11-01T10:00:00',
    };
    const trilhaApi = new RegistradorTrilhaMemoria();
    const config = fonteConfiguracaoMemoria(trilhaApi, {
      chavesIniciais: () => [chave],
      prerequisitosIniciais: () => [cumprido],
    });
    const servico = new ServicoTreinamento(porta, new PortaPessoasMemoria(), trilhaApi, config, null);
    let k = 0;
    const s = {
      req: {
        headers: { 'idempotency-key': `int-03-11-${Date.now()}-${++k}` },
        ip: '127.0.0.1',
        sgh: undefined,
      },
      hospital: 'f2211a',
      rede: '',
      login: 'f2211.teste',
      porta: A,
      pode: () => true,
    } as unknown as SessaoCadastro;
    const sess = () =>
      ({
        ...s,
        req: { ...(s.req as object), headers: { 'idempotency-key': `int-03-11-${Date.now()}-${++k}` } },
      }) as unknown as SessaoCadastro;
    const { hoje } = await porta.relogio(A);

    // O que o modelo não guarda recusa também pelo serviço.
    const curso = {
      codigo: `${CURSO}s`,
      titulo: 'Curso sintético do serviço',
      conteudo: 'Conteúdo sintético do serviço',
      categoria: 'nr32' as const,
      cargaMinimaMin: 60,
      validadeMeses: 12,
    };
    expect(await codigoDe(servico.incluirCurso(sess(), { ...curso, obrigatorio: true, alvos: [] }))).toBe(
      'modelo-pendente',
    );
    const idCurso = (
      await servico.incluirCurso(sess(), {
        ...curso,
        obrigatorio: true,
        alvos: [{ tipo: 'funcao', valor: FUNCAO }],
      })
    ).id;

    const pop = {
      codigo: 'F2211-SPOP',
      titulo: 'POP SINTETICO DO SERVICO',
      unidade: null,
      vigencia: hoje,
      resumo: 'Resumo sintético do serviço',
      referencia: null,
      alteracoes: null,
    };
    const popA = (await servico.publicarPop(sess(), pop as never)).id;
    const turma = (
      await servico.abrirTurma(sess(), {
        curso: idCurso,
        inicio: dia(hoje, -9),
        fim: hoje,
        cargaMin: 120,
        instrutor: 'INSTRUTORA SINTETICA',
        modalidade: 'presencial',
        local: null,
        pop: popA,
        observacao: null,
      })
    ).id;
    await servico.inscrever(sess(), { treinamento: turma, vinculos: [v1, v2] });
    const part = async (v: number) => (await porta.participantes(A, turma)).find((p) => p.vinculo === v)!;

    // Regra 20: a conclusão dá a ciência da versão trabalhada; a data real da conclusão fica.
    const r1 = await servico.registrarParticipacao(sess(), {
      treinamento: turma,
      vinculo: v1,
      presenca: 'presente',
      aproveitamento: 'aprovado',
      conclusao: dia(hoje, -5),
      observacao: null,
      versao: (await part(v1)).versao,
    });
    expect(r1.mensagem).toContain('ciência do POP');
    expect((await part(v1)).conclusao).toBe(dia(hoje, -5));
    expect((await porta.conclusoes(A, [v1])).filter((x) => x.curso === idCurso)).toEqual([
      expect.objectContaining({ conclusao: dia(hoje, -5) }),
    ]);
    expect(await porta.ciencias(A, { vinculo: v1, pops: [popA] })).toEqual([
      expect.objectContaining({ origem: 'treinamento', treinamento: turma }),
    ]);

    // A versão 2 do POP não muda a versão da turma.
    const popB = (
      await servico.publicarPop(sess(), { ...pop, vigencia: hoje, alteracoes: 'Mudança sintética' } as never)
    ).id;
    expect((await porta.turma(A, turma))?.pop).toBe(popA);

    // Alterar o período: a conclusão real (dia -5) cabe em [-9, -3]; fora dela, recusa; trocar o POP com conclusão, recusa.
    const alterar = async (x: Record<string, unknown>) =>
      servico.alterarTurma(sess(), {
        treinamento: turma,
        inicio: dia(hoje, -9),
        fim: dia(hoje, -3),
        cargaMin: 120,
        instrutor: 'INSTRUTORA SINTETICA',
        modalidade: 'presencial',
        local: 'Sala nova',
        pop: popA,
        observacao: null,
        motivo: 'Ajuste sintético do período',
        versao: (await porta.turma(A, turma))!.versao,
        ...x,
      } as never);
    expect(await codigoDe(alterar({}))).toBe('ok');
    expect((await porta.turma(A, turma))?.pop).toBe(popA);
    expect(await codigoDe(alterar({ fim: dia(hoje, -6) }))).toBe('conclusao-fora-do-periodo');
    expect(await codigoDe(alterar({ pop: popB }))).toBe('pop-com-conclusao');

    // Concluir depois da v2: a versão da turma (substituída) não vira ciência falsa da v2.
    const r2 = await servico.registrarParticipacao(sess(), {
      treinamento: turma,
      vinculo: v2,
      presenca: 'presente',
      aproveitamento: 'aprovado',
      conclusao: dia(hoje, -4),
      observacao: null,
      versao: (await part(v2)).versao,
    });
    expect(r2.mensagem).not.toContain('ciência do POP');
    expect(await porta.ciencias(A, { vinculo: v2 })).toEqual([]);
    const t = (await porta.turma(A, turma))!;
    expect(await codigoDe(servico.encerrarTurma(sess(), { treinamento: turma, versao: t.versao }))).toBe(
      'ok',
    );
    expect(await porta.turma(A, turma)).toMatchObject({ situacao: 'encerrada', pop: popA });
  }, 300_000);

  it('a mesma recusa do cadastro de cursos na memória e no banco (modelo-pendente)', async () => {
    const memoria = new PortaTreinamentoMemoria(new PortaPessoasMemoria());
    const casos: Array<[string, PortaTreinamento, ContextoTreinamento]> = [
      ['memória', memoria, { cliente: 'teste', estabelecimento: 1, usuario: null, correlacao: 'x' }],
      ['banco', porta, A],
    ];
    for (const [nome, p, c] of casos) {
      const base = {
        codigo: `${CURSO}m${nome.length}`,
        titulo: 'Paridade sintética',
        conteudo: 'Conteúdo sintético',
        categoria: 'nr32' as const,
        cargaMinimaMin: 60,
        validadeMeses: 12,
        obrigatorio: true,
        alvos: [{ tipo: 'funcao' as const, valor: chaveFuncao(FUNCAO) }],
        por: 'x',
      };
      const incluir = (x: Record<string, unknown>) =>
        codigoDe(p.gravarSgh(c, trilha(c, 'curso'), (gr) => gr.incluirCurso({ ...base, ...x } as never)));
      expect([nome, await incluir({ alvos: [] })]).toEqual([nome, 'modelo-pendente']);
      expect([nome, await incluir({ alvos: [{ tipo: 'unidade', valor: String(setor) }] })]).toEqual([
        nome,
        'modelo-pendente',
      ]);
      expect([nome, await incluir({ categoria: 'gestao' })]).toEqual([nome, 'modelo-pendente']);
      expect([nome, await incluir({ obrigatorio: false })]).toEqual([nome, 'modelo-pendente']);
    }
  });
});
