// Integração da porta PRÓPRIA da avaliação de desempenho (F2.2, lote 03-02) contra o MariaDB do cliente de teste da
// onda 3 (f22_o3), com massa SINTÉTICA: o contrato de efeito das gravações do ciclo (a linha, o modelo pela escala, a
// versão, a exclusão lógica e a trilha), as recusas (versão desatualizada, modelo ausente, nome repetido, ciclo de
// outro estabelecimento) e a mesma bateria básica na memória e no banco. A avaliação
// dos casos de notas nasce direto no SQL do teste, com os itens, e prova lançar notas, finalizar, dar ou
// registrar a ciência e excluir: linhas, versão, trilha da operação, nenhuma mensagem de saída e as recusas. As
// competências, a abertura pela porta, a correção e o PDI têm o caso próprio.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  ctxO3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from './massa.spec-util.js';
import type { ContextoAvaliacao, PortaAvaliacao } from './porta-avaliacao.js';
import { PortaAvaliacaoMemoria } from './porta-avaliacao-memoria.js';
import { PortaAvaliacaoPropria } from './porta-propria.js';

const trilha = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'ciclo_avaliacao',
  entidadeId: id,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-l0302',
});
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
const trilhaAval = (id: number): TrilhaDaGravacao => ({ ...trilha(id), entidade: 'avaliacao_desempenho' });
const ciclo = (nome: string, notaMax = 5) =>
  ({
    nome,
    tipo: 'periodico',
    inicio: '2026-01-01',
    fim: '2026-12-31',
    prazo: '2027-01-31',
    notaMax,
    por: '',
  }) as const;

describe.skipIf(SEM_BANCO_O3)('porta própria da avaliação contra o MariaDB (f22_o3)', () => {
  let m: MassaPessoasO3;
  let porta: PortaAvaliacaoPropria;
  let c: ContextoAvaliacao;
  let fora: ContextoAvaliacao;
  let gestor: ContextoAvaliacao;
  let avaliador = 0;
  let criterios: number[] = [];
  const ler = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3', correlacao: 't' },
      (l) => l.consultar<Record<string, unknown>>(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['q'] ?? 0);
  /** Linhas que a avaliação deixa no estabelecimento da massa (para provar que a recusa nada grava). */
  const pegada = async () => [
    await contar('SELECT COUNT(*) AS q FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.est]),
    await contar('SELECT COUNT(*) AS q FROM ciclo_avaliacao WHERE estabelecimento_id = ?', [m.est]),
    await contar('SELECT COUNT(*) AS q FROM avaliacao_desempenho WHERE estabelecimento_id = ?', [m.est]),
  ];
  const saidas = (id: number) =>
    contar(
      "SELECT COUNT(*) AS q FROM integracao_mensagem WHERE entidade IN ('avaliacao_desempenho', 'ciclo_avaliacao') AND entidade_id = ?",
      [id],
    );
  const eventos = (id: number, evento: string) =>
    contar(
      "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'avaliacao_desempenho' AND entidade_id = ? AND JSON_VALUE(dados_depois, '$.dados.avaliacaoEvento') = ?",
      [id, evento],
    );
  /** A avaliação em rascunho (pendente) com um item por critério do modelo, gravada direto no SQL do teste. */
  const novaAvaliacao = async (nomeCiclo: string): Promise<{ ciclo: number; id: number }> => {
    const cid = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirCiclo({ ...ciclo(nomeCiclo), por: m.login }),
    );
    const id = await m.nucleo.escrever(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3', correlacao: 'massa-avaliacao-l0302' },
      async (e) => {
        const a = await e.inserir(
          "INSERT INTO avaliacao_desempenho (estabelecimento_id, ciclo_avaliacao_id, colaborador_id, avaliador_colaborador_id, tipo, situacao, criado_em, criado_por) VALUES (?, ?, ?, ?, 'gestor', 'pendente', ?, ?)",
          [m.est, cid, m.colaborador, avaliador, new Date(), m.usuario],
        );
        for (const [i, k] of criterios.entries())
          await e.inserir(
            'INSERT INTO avaliacao_desempenho_item (avaliacao_desempenho_id, sequencia, criterio_avaliacao_id, criado_em) VALUES (?, ?, ?, ?)',
            [a, i + 1, k, new Date()],
          );
        return a;
      },
    );
    return { ciclo: cid, id };
  };

  beforeAll(async () => {
    m = await prepararMassaO3('A');
    porta = new PortaAvaliacaoPropria(m.nucleo);
    c = ctxO3(m.est, m.usuario);
    fora = ctxO3(m.outro, m.usuario);
    gestor = ctxO3(m.est, m.gestor);
    // Os critérios do modelo da massa e o colaborador avaliador (o gestor), sintéticos e reaproveitados.
    const x = await m.nucleo.escrever(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3', correlacao: 'massa-criterios-l0302' },
      async (e) => {
        const ks: number[] = [];
        for (const [i, cod] of ['L0302-COMUNICACAO', 'L0302-TRABALHO-EQUIPE'].entries()) {
          const r = await e.uma<{ id: number }>(
            'SELECT id FROM criterio_avaliacao WHERE modelo_avaliacao_id = ? AND codigo = ?',
            [m.modelo, cod],
          );
          ks.push(
            r
              ? Number(r.id)
              : await e.inserir(
                  "INSERT INTO criterio_avaliacao (modelo_avaliacao_id, sequencia, codigo, nome, tipo, nota_minima, nota_maxima, criado_em) VALUES (?, ?, ?, ?, 'competencia', 1, 5, ?)",
                  [m.modelo, i + 1, cod, `CRITERIO SINTETICO ${i + 1}`, new Date()],
                ),
          );
        }
        const cpf = '00030209999';
        const g = await e.uma<{ id: number }>('SELECT id FROM colaborador WHERE cpf = ?', [cpf]);
        const sexo = await e.uma<{ id: number }>('SELECT id FROM sexo ORDER BY id LIMIT 1', []);
        const av = g
          ? Number(g.id)
          : await e.inserir(
              "INSERT INTO colaborador (usuario_id, nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, 'GESTOR SINTETICO L0302', ?, '1985-01-01', ?, '07', ?)",
              [m.gestor, cpf, Number(sexo?.id), new Date()],
            );
        // Dois modelos vigentes com a mesma escala (3): a escolha do modelo tem de recusar a ambiguidade.
        for (const cod of ['L0302-DES-3A', 'L0302-DES-3B'])
          if (!(await e.uma('SELECT id FROM modelo_avaliacao WHERE codigo = ?', [cod])))
            await e.inserir(
              "INSERT INTO modelo_avaliacao (codigo, nome, tipo, escala_minima, escala_maxima, vigencia_inicio, criado_em) VALUES (?, 'MODELO SINTETICO AMBIGUO', 'desempenho', 1, 3, '2020-01-01', ?)",
              [cod, new Date()],
            );
        return { ks, av };
      },
    );
    criterios = x.ks;
    avaliador = x.av;
  }, 60_000);
  afterAll(() => encerrarMassaO3(m));

  it('incluir o ciclo: a linha com o modelo da escala, a versão 1 e a trilha; só no estabelecimento da sessão', async () => {
    const id = await porta.gravarSgh(
      c,
      (x: number) => trilha(x),
      (g) => g.incluirCiclo({ ...ciclo('Ciclo 2026'), por: m.login }),
    );
    const [l] = await ler(
      'SELECT estabelecimento_id, modelo_avaliacao_id, situacao, versao FROM ciclo_avaliacao WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({
      estabelecimento_id: m.est,
      modelo_avaliacao_id: m.modelo,
      situacao: 'aberto',
      versao: 1,
    });
    const tr = await ler(
      "SELECT id FROM trilha_auditoria WHERE entidade = 'ciclo_avaliacao' AND entidade_id = ?",
      [id],
    );
    expect(tr.length).toBeGreaterThanOrEqual(1);
    expect(await porta.ciclo(c, id)).toMatchObject({
      nome: 'Ciclo 2026',
      tipo: 'periodico',
      notaMax: 5,
      situacao: 'aberto',
      versao: 1,
    });
    expect((await porta.ciclos(c)).map((x) => x.id)).toContain(id);
    expect(await porta.ciclo(fora, id)).toBeNull();
    expect((await porta.ciclos(fora)).map((x) => x.id)).not.toContain(id);
  });

  it('recusas: nome repetido, escala sem modelo, versão desatualizada e ciclo de outro estabelecimento', async () => {
    const id = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirCiclo({ ...ciclo('Ciclo recusas'), por: m.login }),
    );
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) => g.incluirCiclo({ ...ciclo('Ciclo recusas'), por: m.login })),
      ),
    ).toBe('ciclo-nome-em-uso');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) => g.incluirCiclo({ ...ciclo('Ciclo escala 7', 7), por: m.login })),
      ),
    ).toBe('modelo-avaliacao-ausente');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) => g.incluirCiclo({ ...ciclo('Ciclo escala 3', 3), por: m.login })),
      ),
    ).toBe('modelo-avaliacao-ambiguo');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(id), (g) =>
          g.alterarCiclo({ ...ciclo('Ciclo novo nome'), id, versao: 9, por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        porta.gravarSgh(fora, trilha(id), (g) =>
          g.alterarCiclo({ ...ciclo('Ciclo novo nome'), id, versao: 1, por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(await porta.ciclo(c, id)).toMatchObject({ nome: 'Ciclo recusas', versao: 1 });
  });

  it('alterar, encerrar (motivo na trilha) e excluir (lógica, com o retrato)', async () => {
    const id = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirCiclo({ ...ciclo('Ciclo efeito'), por: m.login }),
    );
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.alterarCiclo({ ...ciclo('Ciclo efeito alterado'), id, versao: 1, por: m.login }),
    );
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.situacaoCiclo({
        id,
        versao: 2,
        situacao: 'encerrado',
        motivo: 'Fim do período sintético',
        por: m.login,
      }),
    );
    expect(await porta.ciclo(c, id)).toMatchObject({
      nome: 'Ciclo efeito alterado',
      situacao: 'encerrado',
      versao: 3,
    });
    const tr = await ler(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'ciclo_avaliacao' AND entidade_id = ? AND motivo IS NOT NULL",
      [id],
    );
    expect(tr.map((x) => x['motivo'])).toContain('Fim do período sintético');
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.excluirCiclo({ id, versao: 3, motivo: 'Lançado em duplicidade', por: m.login }),
    );
    const [l] = await ler('SELECT excluido_em, excluido_por, versao FROM ciclo_avaliacao WHERE id = ?', [id]);
    expect(l?.['excluido_em']).not.toBeNull();
    expect(l).toMatchObject({ excluido_por: m.usuario, versao: 4 });
    expect(await porta.ciclo(c, id)).toBeNull();
    expect(await porta.dependencias(c, 'ciclo-avaliacao', id)).toEqual([]);
  });

  it('alterar o ciclo mantém o modelo; mudar a escala com avaliação recusa (escala-com-avaliacoes)', async () => {
    const { ciclo: id } = await novaAvaliacao('Ciclo com avaliação');
    await porta.gravarSgh(c, trilha(id), (g) =>
      g.alterarCiclo({
        ...ciclo('Ciclo com avaliação renomeado'),
        prazo: '2027-02-28',
        id,
        versao: 1,
        por: m.login,
      }),
    );
    const [l] = await ler('SELECT modelo_avaliacao_id, nome, versao FROM ciclo_avaliacao WHERE id = ?', [id]);
    expect(l).toMatchObject({
      modelo_avaliacao_id: m.modelo,
      nome: 'Ciclo com avaliação renomeado',
      versao: 2,
    });
    const antes = await pegada();
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(id), (g) =>
          g.alterarCiclo({ ...ciclo('Ciclo com avaliação renomeado', 7), id, versao: 2, por: m.login }),
        ),
      ),
    ).toBe('escala-com-avaliacoes');
    expect(await pegada()).toEqual(antes);
  });

  it('lançar notas, finalizar e registrar a ciência: linhas, versão, trilha da operação e nenhuma saída', async () => {
    const { id } = await novaAvaliacao('Ciclo avaliação efeito');
    const [k1, k2] = criterios as [number, number];
    // Recusas antes de gravar: versão velha, outro estabelecimento, competência fora da avaliação, nota faltando.
    const antes = await pegada();
    const notas = (n1: number | null) => [{ competencia: k1, nota: n1, comentario: null }];
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.lancarNotas({ id, versao: 9, parecer: null, notas: notas(4), por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        porta.gravarSgh(fora, trilhaAval(id), (g) =>
          g.lancarNotas({ id, versao: 1, parecer: null, notas: notas(4), por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.lancarNotas({
            id,
            versao: 1,
            parecer: null,
            notas: [{ competencia: 999_999_999, nota: 3, comentario: null }],
            por: m.login,
          }),
        ),
      ),
    ).toBe('competencia-fora-da-avaliacao');
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) => g.finalizarAvaliacao({ id, versao: 1, por: m.login })),
      ),
    ).toBe('avaliacao-incompleta');
    expect(await pegada()).toEqual(antes);

    await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.lancarNotas({ id, versao: 1, parecer: 'Parecer sintético', notas: notas(4), por: m.login }),
    );
    expect(
      (await ler('SELECT situacao, comentario, versao FROM avaliacao_desempenho WHERE id = ?', [id]))[0],
    ).toMatchObject({
      situacao: 'em_andamento',
      comentario: 'Parecer sintético',
      versao: 2,
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) => g.finalizarAvaliacao({ id, versao: 2, por: m.login })),
      ),
    ).toBe('avaliacao-incompleta');
    await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.lancarNotas({
        id,
        versao: 2,
        parecer: 'Parecer sintético',
        notas: [{ competencia: k2, nota: 5, comentario: 'Bom' }],
        por: m.login,
      }),
    );
    expect((await porta.notas(c, id)).map((x) => x.nota).sort()).toEqual([4, 5]);
    const itens = await ler(
      'SELECT nota, versao FROM avaliacao_desempenho_item WHERE avaliacao_desempenho_id = ? ORDER BY sequencia',
      [id],
    );
    expect(itens.map((x) => [Number(x['nota']), Number(x['versao'])])).toEqual([
      [4, 2],
      [5, 2],
    ]);

    await porta.gravarSgh(c, trilhaAval(id), (g) => g.finalizarAvaliacao({ id, versao: 3, por: m.login }));
    const [f] = await ler('SELECT situacao, concluida_em, versao FROM avaliacao_desempenho WHERE id = ?', [
      id,
    ]);
    expect(f).toMatchObject({ situacao: 'concluida', versao: 4 });
    expect(f?.['concluida_em']).not.toBeNull();
    expect(await porta.avaliacao(c, id)).toMatchObject({
      situacao: 'finalizada',
      finalizadaPor: m.login,
      cienciaPor: null,
      versao: 4,
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.lancarNotas({ id, versao: 4, parecer: null, notas: notas(1), por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.excluirAvaliacao({ id, versao: 4, motivo: 'Teste', por: m.login }),
        ),
      ),
    ).toBe('desatualizado');

    // A ciência colhida em papel e registrada pelo RH (o gestor da massa): modo, autor e observação são os dela.
    await porta.gravarSgh(gestor, trilhaAval(id), (g) =>
      g.ciencia({
        id,
        versao: 4,
        modo: 'registrada',
        observacao: 'Ciência em papel sintética',
        por: m.loginGestor,
      }),
    );
    const [ci] = await ler('SELECT ciencia_colaborador_em, versao FROM avaliacao_desempenho WHERE id = ?', [
      id,
    ]);
    expect(ci?.['ciencia_colaborador_em']).not.toBeNull();
    expect(ci?.['versao']).toBe(5);
    expect(await porta.avaliacao(c, id)).toMatchObject({
      situacao: 'ciente',
      finalizadaPor: m.login,
      cienciaPor: m.loginGestor,
      cienciaModo: 'registrada',
      cienciaObs: 'Ciência em papel sintética',
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.ciencia({ id, versao: 5, modo: 'proprio', observacao: null, por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    expect([await eventos(id, 'finalizacao'), await eventos(id, 'ciencia')]).toEqual([1, 1]);
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'avaliacao_desempenho' AND entidade_id = ?",
        [id],
      ),
    ).toBe(4);
    expect(await saidas(id)).toBe(0);
  });

  it('a ciência própria: o colaborador é o autor e o modo é o próprio', async () => {
    const { id } = await novaAvaliacao('Ciclo ciência própria');
    const todas = criterios.map((k) => ({ competencia: k, nota: 3, comentario: null }));
    await porta.gravarSgh(gestor, trilhaAval(id), (g) =>
      g.lancarNotas({ id, versao: 1, parecer: null, notas: todas, por: m.loginGestor }),
    );
    await porta.gravarSgh(gestor, trilhaAval(id), (g) =>
      g.finalizarAvaliacao({ id, versao: 2, por: m.loginGestor }),
    );
    await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.ciencia({ id, versao: 3, modo: 'proprio', observacao: null, por: m.login }),
    );
    expect(await porta.avaliacao(c, id)).toMatchObject({
      finalizadaPor: m.loginGestor,
      cienciaPor: m.login,
      cienciaModo: 'proprio',
      cienciaObs: null,
      versao: 4,
    });
  });

  it('excluir o rascunho: a avaliação e os itens com exclusão lógica, o retrato na trilha; recusa a versão velha', async () => {
    const { id } = await novaAvaliacao('Ciclo avaliação exclusão');
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.excluirAvaliacao({ id, versao: 2, motivo: 'Lançada em duplicidade', por: m.login }),
        ),
      ),
    ).toBe('desatualizado');
    await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.excluirAvaliacao({ id, versao: 1, motivo: 'Lançada em duplicidade', por: m.login }),
    );
    const [a] = await ler('SELECT excluido_em, excluido_por, versao FROM avaliacao_desempenho WHERE id = ?', [
      id,
    ]);
    expect(a?.['excluido_em']).not.toBeNull();
    expect(a).toMatchObject({ excluido_por: m.usuario, versao: 2 });
    const itens = await ler(
      'SELECT excluido_em, excluido_por, versao FROM avaliacao_desempenho_item WHERE avaliacao_desempenho_id = ?',
      [id],
    );
    expect(itens).toHaveLength(criterios.length);
    for (const i of itens) expect(i).toMatchObject({ excluido_por: m.usuario, versao: 2 });
    expect(itens.every((i) => i['excluido_em'] !== null)).toBe(true);
    const [t] = await ler(
      "SELECT motivo, JSON_LENGTH(dados_depois, '$.dados.retrato.itens') AS itens FROM trilha_auditoria WHERE entidade = 'avaliacao_desempenho' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [id],
    );
    expect(t).toMatchObject({ motivo: 'Lançada em duplicidade' });
    expect(Number(t?.['itens'])).toBe(criterios.length);
    expect(await porta.avaliacao(c, id)).toBeNull();
    expect(await saidas(id)).toBe(0);
  });

  it('competências, abertura, correção e PDI: linhas, leitura e recusas', async () => {
    const sufixo = String(Date.now()).slice(-8);
    const k = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirCompetencia({ nome: `Comunicação ${sufixo}`, descricao: null, por: m.login }),
    );
    expect(await porta.competencia(c, k)).toMatchObject({ nome: `Comunicação ${sufixo}`, ativo: true });
    expect(await porta.competencia(fora, k)).toBeNull();
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) =>
          g.incluirCompetencia({ nome: `Comunicação ${sufixo}`, descricao: null, por: m.login }),
        ),
      ),
    ).toBe('competencia-nome-em-uso');
    await porta.gravarSgh(c, trilha(), (g) =>
      g.ligarCompetenciaCargo({ cargo: m.cargo, competencia: k, por: m.login }),
    );
    expect((await porta.competenciasDoCargo(c, m.cargo)).map((x) => x.competencia)).toContain(k);
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) =>
          g.ligarCompetenciaCargo({ cargo: m.cargo, competencia: k, por: m.login }),
        ),
      ),
    ).toBe('competencia-ja-no-cargo');

    // Abertura: a competência vira o critério do modelo do ciclo, e a nota é lida pela competência.
    const cid = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirCiclo({ ...ciclo(`Ciclo abertura ${sufixo}`), por: m.login }),
    );
    const id = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirAvaliacao({
        ciclo: cid,
        vinculo: m.vinculo,
        cargo: m.cargo,
        marco: null,
        avaliador: m.loginGestor,
        competencias: [k],
        por: m.login,
      }),
    );
    expect(await porta.avaliacao(c, id)).toMatchObject({
      ciclo: cid,
      cargo: m.cargo,
      numero: 1,
      anterior: null,
      situacao: 'rascunho',
    });
    expect((await porta.notas(c, id)).map((x) => x.competencia)).toEqual([k]);
    await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.lancarNotas({
        id,
        versao: 1,
        parecer: null,
        notas: [{ competencia: k, nota: 4, comentario: null }],
        por: m.login,
      }),
    );
    await porta.gravarSgh(c, trilhaAval(id), (g) => g.finalizarAvaliacao({ id, versao: 2, por: m.login }));
    const fin = await porta.avaliacao(c, id);
    expect(fin).toMatchObject({ situacao: 'finalizada', finalizadaPor: m.login });

    // Correção: versão nova em rascunho com as notas copiadas; a anterior fica substituída.
    const nova = await porta.gravarSgh(c, trilhaAval(id), (g) =>
      g.corrigirAvaliacao({
        anterior: id,
        versao: fin!.versao,
        motivo: 'Nota lançada errada',
        avaliador: m.loginGestor,
        por: m.login,
      }),
    );
    expect(await porta.avaliacao(c, nova)).toMatchObject({
      numero: 2,
      anterior: id,
      motivoCorrecao: 'Nota lançada errada',
      situacao: 'rascunho',
    });
    expect((await porta.notas(c, nova))[0]).toMatchObject({ competencia: k, nota: 4 });
    expect((await porta.avaliacao(c, id))?.substituida).toBe(true);
    expect(
      await codigo(
        porta.gravarSgh(c, trilhaAval(id), (g) =>
          g.corrigirAvaliacao({
            anterior: id,
            versao: fin!.versao,
            motivo: 'De novo',
            avaliador: m.loginGestor,
            por: m.login,
          }),
        ),
      ),
    ).toBe('desatualizado');

    // PDI: inclusão, leitura com a competência e conclusão com o motivo.
    const p = await porta.gravarSgh(c, trilha(), (g) =>
      g.incluirPdi({
        vinculo: m.vinculo,
        avaliacao: id,
        competencia: k,
        curso: null,
        acao: 'Ação sintética',
        prazo: '2026-12-31',
        por: m.login,
      }),
    );
    expect(await porta.pdi(c, p)).toMatchObject({
      vinculo: m.vinculo,
      competencia: k,
      competenciaNome: `Comunicação ${sufixo}`,
      situacao: 'aberta',
    });
    expect(await porta.pdi(fora, p)).toBeNull();
    await porta.gravarSgh(c, trilha(), (g) =>
      g.situacaoPdi({
        id: p,
        versao: 1,
        situacao: 'concluida',
        concluidaEm: '2026-06-30',
        motivo: 'Concluída',
        por: m.login,
      }),
    );
    expect(await porta.pdi(c, p)).toMatchObject({
      situacao: 'concluida',
      concluidaEm: '2026-06-30',
      motivoSituacao: 'Concluída',
    });
    expect((await porta.pdiDoColaborador(c, m.vinculo)).map((x) => x.id)).toContain(p);

    // A competência em uso não se exclui (o cargo, as notas e o PDI contam).
    const kv = (await porta.competencia(c, k))!.versao;
    expect(
      await codigo(
        porta.gravarSgh(c, trilha(), (g) =>
          g.excluirCompetencia({ id: k, versao: kv, motivo: 'Teste', por: m.login }),
        ),
      ),
    ).toBe('competencia-com-vinculos');
    expect((await porta.dependencias(c, 'competencia', k)).map((x) => x.tabela).sort()).toEqual([
      'avaliacao_desempenho_item',
      'cargo_competencia',
      'plano_desenvolvimento',
    ]);
    expect(await porta.cargoDoVinculo(c, m.vinculo)).toBe(m.cargo);
    expect(await porta.cargoDoVinculo(fora, m.vinculo)).toBeNull();
  });

  describe('a mesma bateria na memória e no banco', () => {
    const fabricas: [string, () => [PortaAvaliacao, ContextoAvaliacao]][] = [
      ['memoria', () => [new PortaAvaliacaoMemoria(), ctxO3(1, null, 'pc')]],
      ['banco', () => [porta, c]],
    ];
    it.each(fabricas)(
      '%s: incluir, listar, alterar com a versão lida e recusar a versão velha',
      async (_n, f) => {
        const [p, ctx] = f();
        const id = await p.gravarSgh(ctx, trilha(), (g) =>
          g.incluirCiclo({ ...ciclo('Ciclo bateria'), por: m.login }),
        );
        const lido = await p.ciclo(ctx, id);
        expect(lido).toMatchObject({ nome: 'Ciclo bateria', notaMax: 5, situacao: 'aberto' });
        await p.gravarSgh(ctx, trilha(id), (g) =>
          g.alterarCiclo({ ...ciclo('Ciclo bateria 2'), id, versao: lido!.versao, por: m.login }),
        );
        expect(
          await codigo(
            p.gravarSgh(ctx, trilha(id), (g) =>
              g.alterarCiclo({ ...ciclo('Ciclo bateria 3'), id, versao: lido!.versao, por: m.login }),
            ),
          ),
        ).toBe('desatualizado');
        expect((await p.ciclos(ctx)).find((x) => x.id === id)?.nome).toBe('Ciclo bateria 2');
      },
    );
  });
});
