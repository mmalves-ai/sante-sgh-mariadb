// Contrato de efeito do orçamento estatístico e dos indicadores orçamentários por setor (C1-129; ficha 07-FIN linha
// 131) contra o MariaDB real, cliente de teste (SGH_CLIENTE_TESTE, padrão f22_o5), com o serviço da API por cima. Massa
// SINTÉTICA "C1129E" (nenhuma pessoa real): um estabelecimento, dois setores, um usuário, um grupo, um dado estatístico
// com o realizado agregado de 2032 e 2033 e a versão do orçamento de 2033 em elaboração. Prova o que fica no banco:
// indicador_orcamentario (inclusão, alteração pela versão, código repetido e regra do domínio recusados),
// valor_estatistico_orcado (linha do setor com a sequência, a projeção e o ajuste; alteração pela versão da célula;
// retirada lógica com excluido_em/excluido_por e volta pela mesma chave), a trilha na mesma transação, o painel orçado ×
// realizado com as parcelas e as recusas (versão aprovada fechada, célula lida velha, mês fora da vigência).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { ServicoEstatisticasOrcamento } from './estatisticas-orcamento.js';
import { PortaEstatisticasOrcamentoPropria } from './estatisticas-orcamento-propria.js';
import { PortaOrcamentoPropria } from './porta-propria.js';
import type { SessaoOrcamento } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C1129E';
const ANO = 2033;
const EV = {
  indicador: 'financeiro.orcamento.indicadorGravado',
  estatistica: 'financeiro.orcamento.estatisticaGravada',
};
const json = (d: unknown): unknown => (typeof d === 'string' ? JSON.parse(d) : d);

describe.skipIf(SEM_BANCO)('orçamento estatístico e indicadores por setor (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoEstatisticasOrcamento;
  const ids = { est: 0, usuario: 0, uti: 0, clinica: 0, grupo: 0, tipo: 0, versao: 0 };

  function sessao(): SessaoOrcamento {
    const c: ContextoPorta = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'int-c1129',
      rede: 'teste',
      hospital: P,
    };
    return {
      rede: 'teste',
      hospital: P,
      login: 'c1129e.autor',
      porta: c,
      chaveIdempotencia: `c1129-${randomUUID()}`,
      pode: () => true,
      trilha: (evento, operacao, tabela, id): RegistroTrilhaTela => ({
        estabelecimento: ids.est,
        usuario: ids.usuario,
        acao: 'operacao',
        entidade: tabela,
        entidadeId: id,
        dadosDepois: { evento, recurso: 'financeiro.orcamento', operacao },
        correlacao: 'int-c1129',
      }),
    };
  }

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-c1129-conferir' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );
  const ultimaTrilha = (entidade: string, id: number) =>
    ler<{ d: unknown; acao: string }>(
      'SELECT dados_depois AS d, acao FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id DESC LIMIT 1',
      [entidade, id],
    );
  const celula = (indicador: number, centro: number, mes: string) =>
    ler<{
      id: number;
      sequencia: number;
      q: string;
      p: string | null;
      a: string | null;
      versao: number;
      excluido_em: unknown;
      excluido_por: number | null;
      criado_por: number;
    }>(
      `SELECT id, sequencia, quantidade_orcada AS q, quantidade_projetada AS p, quantidade_ajuste AS a, versao,
              excluido_em, excluido_por, criado_por
         FROM valor_estatistico_orcado
        WHERE versao_orcamento_id = ? AND indicador_orcamentario_id = ? AND centro_custo_id = ? AND competencia = ?`,
      [ids.versao, indicador, centro, `${mes}-01`],
    );

  const limpar = async (e: Escritor) => {
    await e.executar(
      `DELETE o FROM valor_estatistico_orcado o JOIN versao_orcamento v ON v.id = o.versao_orcamento_id
        WHERE v.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar('DELETE FROM versao_orcamento WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(`DELETE FROM indicador_orcamentario WHERE codigo LIKE '${P}%'`, []);
    await e.executar(
      `DELETE s FROM estatistica_centro_mes s JOIN centro_custo cc ON cc.id = s.centro_custo_id
        WHERE cc.estabelecimento_id = ?`,
      [ids.est],
    );
    await limparTrilhaDaMassa(e, { ids: [ids.est] });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1129' }, async (e) => {
      const agora = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await garantir(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, 'ESTAB SINTETICO ESTATISTICO', 'ESTAB SINTETICO ESTATISTICO', agora],
      );
      ids.usuario = await garantir(
        'SELECT id FROM usuario WHERE login = ?',
        ['c1129e.autor'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['c1129e.autor', 'USUARIO SINTETICO C1129E', agora],
      );
      const centro = (codigo: string, nome: string) =>
        garantir(
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, codigo],
          `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, analitico, criado_em)
           VALUES (?, ?, ?, '2030-01-01', TRUE, ?)`,
          [ids.est, codigo, nome, agora],
        );
      ids.uti = await centro('912901', 'UTI SINTETICA C1129');
      ids.clinica = await centro('912902', 'CLINICA SINTETICA C1129');
      ids.grupo = await garantir(
        'SELECT id FROM grupo_indicador_orcamentario WHERE codigo = ?',
        [`${P}-G`],
        'INSERT INTO grupo_indicador_orcamentario (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-G`, 'Internacao sintetica', agora],
      );
      ids.tipo = await garantir(
        'SELECT id FROM tipo_dado_estatistico WHERE codigo = ?',
        [`${P}-PD`],
        "INSERT INTO tipo_dado_estatistico (codigo, descricao, unidade_medida, criado_em) VALUES (?, ?, 'paciente_dia', ?)",
        [`${P}-PD`, 'Pacientes-dia sinteticos', agora],
      );
      await limpar(e);
      // Realizado agregado: UTI 100, 120, 140 em out-dez/2032 e 210 em jan/2033; clínica 50 em jan/2033.
      for (const [c, mes, q] of [
        [ids.uti, '2032-10', 100],
        [ids.uti, '2032-11', 120],
        [ids.uti, '2032-12', 140],
        [ids.uti, '2033-01', 210],
        [ids.clinica, '2033-01', 50],
      ] as const)
        await e.inserir(
          `INSERT INTO estatistica_centro_mes (centro_custo_id, tipo_dado_estatistico_id, competencia, quantidade, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [c, ids.tipo, `${mes}-01`, q, agora],
        );
      ids.versao = await e.inserir(
        `INSERT INTO versao_orcamento (estabelecimento_id, ano, numero_versao, descricao, vigencia_inicio, vigencia_fim,
                                       situacao, criado_em, criado_por)
         VALUES (?, ?, 1, 'Versao sintetica estatistica', '2033-01-01', '2033-12-31', 'rascunho', ?, ?)`,
        [ids.est, ANO, agora, ids.usuario],
      );
    });
    const orcamento = new PortaOrcamentoPropria(nucleo, CLIENTE);
    const porta = new PortaEstatisticasOrcamentoPropria(nucleo, CLIENTE);
    servico = new ServicoEstatisticasOrcamento(
      orcamento,
      porta,
      'financeiro.orcamento.editar',
      () => new Date('2033-02-15T12:00:00Z'),
    );
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1129' }, limpar);
    await nucleo.encerrar?.();
  });

  let diarias = 0;

  it('indicador: cadastra, altera pela versão lida e recusa código repetido e projeção sem dado', async () => {
    const base = {
      codigo: `${P}-diarias`,
      descricao: 'Diarias sinteticas',
      grupoId: ids.grupo,
      tipoDadoId: ids.tipo,
      unidade: 'pacientes-dia',
      visao: 'acumulado',
      tipoProjecao: 'media',
      mesesProjecao: 3,
    };
    const { id } = await servico.criarIndicador(sessao(), base, EV);
    diarias = id;
    const x = await ler<{ codigo: string; visao: string; tipo_projecao: string; meses_projecao: number }>(
      'SELECT codigo, visao, tipo_projecao, meses_projecao FROM indicador_orcamentario WHERE id = ?',
      [id],
    );
    expect([x?.codigo, x?.visao, x?.tipo_projecao, Number(x?.meses_projecao)]).toEqual([
      `${P}-DIARIAS`,
      'acumulado',
      'media',
      3,
    ]);
    expect((await ultimaTrilha('indicador_orcamentario', id))?.acao).toBe('inclusao');
    await expect(servico.criarIndicador(sessao(), base, EV)).rejects.toMatchObject({ status: 409 });
    await expect(
      servico.criarIndicador(sessao(), { ...base, codigo: `${P}-X`, tipoDadoId: null }, EV),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await servico.alterarIndicador(sessao(), id, { ...base, versao: 1, descricao: 'Diarias revistas' }, EV),
    ).toEqual({ versao: 2 });
    await expect(
      servico.alterarIndicador(sessao(), id, { ...base, versao: 1, descricao: 'Velha' }, EV),
    ).rejects.toMatchObject({ status: 409 });
    const cat = await servico.catalogo(sessao());
    expect(cat.indicadores.find((i) => i.id === id)).toMatchObject({
      descricao: 'Diarias revistas',
      versao: 2,
    });
    expect(cat.grupos.some((g) => g.id === ids.grupo)).toBe(true);
    expect(cat.tiposDado.some((t) => t.id === ids.tipo)).toBe(true);
  });

  it('grade: projeção do realizado, linha gravada, alterada, retirada e de volta; painel com as parcelas', async () => {
    // A projeção da linha nova (média dos 3 meses anteriores à vigência: 120).
    const pr = await servico.projecao(sessao(), ids.versao, diarias, ids.uti);
    expect([pr.projecao['2033-01'], pr.projecao['2033-12'], pr.realizado['2033-01']]).toEqual([
      12_000, 12_000, 21_000,
    ]);

    const r1 = await servico.gravarLinha(
      sessao(),
      ids.versao,
      {
        indicador: diarias,
        centro: ids.uti,
        celulas: [
          { competencia: '2033-01', quantidade: 20_000, projetada: 12_000 },
          { competencia: '2033-02', quantidade: 18_000, projetada: 12_000 },
        ],
      },
      EV,
    );
    expect(r1).toEqual({ incluidas: 2, alteradas: 0, retiradas: 0 });
    await servico.gravarLinha(
      sessao(),
      ids.versao,
      { indicador: diarias, centro: ids.clinica, celulas: [{ competencia: '2033-01', quantidade: 6_000 }] },
      EV,
    );
    const jan = await celula(diarias, ids.uti, '2033-01');
    expect([
      Number(jan?.sequencia),
      Number(jan?.q),
      Number(jan?.p),
      Number(jan?.a),
      Number(jan?.versao),
    ]).toEqual([1, 200, 120, 80, 1]);
    expect(Number(jan?.criado_por)).toBe(ids.usuario);
    expect(Number((await celula(diarias, ids.clinica, '2033-01'))?.sequencia)).toBe(3);
    const t = await ultimaTrilha('versao_orcamento', ids.versao);
    expect(json(t?.d)).toMatchObject({
      dados: { indicador: diarias, centro: ids.clinica, incluidas: 1, tela: { evento: EV.estatistica } },
    });

    // Alteração pela versão da célula; a versão velha é recusada e nada muda.
    const r2 = await servico.gravarLinha(
      sessao(),
      ids.versao,
      {
        indicador: diarias,
        centro: ids.uti,
        celulas: [
          { competencia: '2033-01', quantidade: 21_000, projetada: 12_000, versao: 1 },
          { competencia: '2033-02', quantidade: 18_000, projetada: 12_000, versao: 1 },
        ],
      },
      EV,
    );
    expect(r2).toEqual({ incluidas: 0, alteradas: 1, retiradas: 0 });
    await expect(
      servico.gravarLinha(
        sessao(),
        ids.versao,
        {
          indicador: diarias,
          centro: ids.uti,
          celulas: [{ competencia: '2033-01', quantidade: 1, versao: 1 }],
        },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(Number((await celula(diarias, ids.uti, '2033-01'))?.q)).toBe(210);

    // Mês fora da vigência e quantidade negativa: recusa da regra do domínio.
    await expect(
      servico.gravarLinha(
        sessao(),
        ids.versao,
        { indicador: diarias, centro: ids.uti, celulas: [{ competencia: '2034-01', quantidade: 1 }] },
        EV,
      ),
    ).rejects.toMatchObject({ status: 400 });

    // Painel até fevereiro (acumulado): fevereiro ainda não apurado. A comparação usa só os meses com realizado
    // (UTI 210 × 210, no orçado; clínica 60 × 50); o orçado do período (UTI 210 + 180) segue visível à parte.
    const g = await servico.grade(sessao(), ids.versao, '2033-02');
    expect(g.meses).toHaveLength(12);
    expect(g.editavel).toBe(true);
    const linhaUti = g.linhas.find((l) => l.indicadorId === diarias && l.centroId === ids.uti)!;
    expect(linhaUti.celulas['2033-01']).toMatchObject({ orcadoCent: 21_000, versao: 2 });
    expect(linhaUti.realizado['2033-01']).toBe(21_000);
    const ind = g.painel.flatMap((x) => x.indicadores).find((i) => i.indicador.id === diarias)!;
    expect([ind.orcadoCent, ind.realizadoCent, ind.atingimentoDecimos, ind.orcadoPeriodoCent]).toEqual([
      27_000, 26_000, 963, 45_000,
    ]);
    const utiNoPainel = ind.porSetor.find((x) => x.centroId === ids.uti)!;
    expect([utiNoPainel.orcadoCent, utiNoPainel.realizadoCent, utiNoPainel.situacao]).toEqual([
      21_000,
      21_000,
      'no_orcado',
    ]);
    expect(ind.conta).toBe(
      'orçado 270 = UTI SINTETICA C1129 210 + CLINICA SINTETICA C1129 60; realizado 260 = UTI SINTETICA C1129 210 + CLINICA SINTETICA C1129 50; comparado só nos meses apurados (orçado do período 450 = UTI SINTETICA C1129 390 + CLINICA SINTETICA C1129 60)',
    );
    // Sem `ate`, o padrão é o mês corrente (fevereiro, sem apuração) e o painel não cai para "abaixo" por isso.
    const padrao = await servico.grade(sessao(), ids.versao, undefined);
    expect(padrao.ate).toBe('2033-02');
    const indPadrao = padrao.painel.flatMap((x) => x.indicadores).find((i) => i.indicador.id === diarias)!;
    expect(indPadrao.porSetor.find((x) => x.centroId === ids.uti)!.situacao).toBe('no_orcado');

    // Retirada lógica (célula esvaziada) e volta pela mesma chave.
    const r3 = await servico.gravarLinha(
      sessao(),
      ids.versao,
      {
        indicador: diarias,
        centro: ids.uti,
        celulas: [{ competencia: '2033-02', quantidade: null, versao: 1 }],
      },
      EV,
    );
    expect(r3).toEqual({ incluidas: 0, alteradas: 0, retiradas: 1 });
    const fev = await celula(diarias, ids.uti, '2033-02');
    expect(fev?.excluido_em).not.toBeNull();
    expect(Number(fev?.excluido_por)).toBe(ids.usuario);
    const r4 = await servico.gravarLinha(
      sessao(),
      ids.versao,
      { indicador: diarias, centro: ids.uti, celulas: [{ competencia: '2033-02', quantidade: 17_000 }] },
      EV,
    );
    expect(r4).toEqual({ incluidas: 1, alteradas: 0, retiradas: 0 });
    const volta = await celula(diarias, ids.uti, '2033-02');
    expect([volta?.id, volta?.excluido_em, Number(volta?.q), Number(volta?.versao)]).toEqual([
      fev?.id,
      null,
      170,
      3,
    ]);

    // Versão aprovada: fecha para quantidades; nada é apagado.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'aprovar-c1129' }, (e) =>
      e.executar(
        "UPDATE versao_orcamento SET situacao = 'aprovado', aprovado_em = NOW(3), aprovador_usuario_id = ? WHERE id = ?",
        [ids.usuario, ids.versao],
      ),
    );
    await expect(
      servico.gravarLinha(
        sessao(),
        ids.versao,
        { indicador: diarias, centro: ids.uti, celulas: [{ competencia: '2033-03', quantidade: 1 }] },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await servico.grade(sessao(), ids.versao, null)).editavel).toBe(false);
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM valor_estatistico_orcado WHERE versao_orcamento_id = ?',
      [ids.versao],
    );
    expect(Number(n?.n)).toBe(3);
  });
});
