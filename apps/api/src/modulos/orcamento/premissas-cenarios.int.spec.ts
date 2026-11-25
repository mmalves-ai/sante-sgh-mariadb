// Contrato de efeito das premissas e cenários do orçamento (C1-125; ficha 07-FIN linha 129) contra o MariaDB real,
// cliente de teste (SGH_CLIENTE_TESTE, padrão f22_o2), com o serviço da API por cima. Massa SINTÉTICA "C1125P" (nenhuma
// pessoa real): um estabelecimento, dois usuários e a versão do orçamento em elaboração. Prova o que fica no banco:
// cenario_orcamento (inclusão, alteração pela versão, código repetido recusado), premissa_orcamento (inclusão com a
// sequência, alteração, retirada lógica com excluido_em/excluido_por), versao_orcamento.cenario_orcamento_id (escolha) e
// a projeção com as parcelas; a trilha de cada gravação na mesma transação; e as recusas (regra do domínio, versão
// aprovada fechada, versão lida velha).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaOrcamentoPropria } from './porta-propria.js';
import { ServicoPremissasOrcamento } from './premissas-cenarios.js';
import { PortaPremissasOrcamentoPropria } from './premissas-cenarios-propria.js';
import { ServicoOrcamento, type SessaoOrcamento } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C1125P';
const ANO = 2033;
const EV_ORC = {
  criado: 'financeiro.orcamento.criado',
  linhas: 'financeiro.orcamento.linhasGravadas',
  aprovado: 'financeiro.orcamento.aprovado',
  descartado: 'financeiro.orcamento.descartado',
};
const EV = {
  premissa: 'financeiro.orcamento.premissaGravada',
  cenario: 'financeiro.orcamento.cenarioGravado',
};
const json = (d: unknown): unknown => (typeof d === 'string' ? JSON.parse(d) : d);

describe.skipIf(SEM_BANCO)('premissas e cenários do orçamento (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let orcamento: PortaOrcamentoPropria;
  let porta: PortaPremissasOrcamentoPropria;
  let servico: ServicoPremissasOrcamento;
  let servicoOrc: ServicoOrcamento;
  const ids = { est: 0, autor: 0, aprovador: 0 };

  function sessao(login: string, usuario: number): SessaoOrcamento {
    const c: ContextoPorta = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario,
      correlacao: 'int-c1125',
      rede: 'teste',
      hospital: P,
    };
    return {
      rede: 'teste',
      hospital: P,
      login,
      porta: c,
      chaveIdempotencia: `c1125-${randomUUID()}`,
      pode: () => true,
      trilha: (evento, operacao, tabela, id): RegistroTrilhaTela => ({
        estabelecimento: ids.est,
        usuario,
        acao: 'operacao',
        entidade: tabela,
        entidadeId: id,
        dadosDepois: { evento, recurso: 'financeiro.orcamento', operacao },
        correlacao: 'int-c1125',
      }),
    };
  }
  const autor = () => sessao('c1125p.autor', ids.autor);
  const aprovador = () => sessao('c1125p.aprova', ids.aprovador);

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-c1125-conferir' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );
  const ultimaTrilha = (entidade: string, id: number) =>
    ler<{ d: unknown; acao: string }>(
      'SELECT dados_depois AS d, acao FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id DESC LIMIT 1',
      [entidade, id],
    );

  const limpar = async (e: Escritor) => {
    await e.executar('UPDATE versao_orcamento SET cenario_orcamento_id = NULL WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    await e.executar(
      `DELETE p FROM premissa_orcamento p JOIN versao_orcamento v ON v.id = p.versao_orcamento_id
        WHERE v.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar(
      `DELETE l FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
        WHERE v.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar('DELETE FROM versao_orcamento WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(`DELETE FROM cenario_orcamento WHERE codigo LIKE '${P}%'`, []);
    await limparTrilhaDaMassa(e, { ids: [ids.est] });
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1125' }, async (e) => {
      const agora = new Date();
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await garantir(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, 'ESTAB SINTETICO PREMISSAS', 'ESTAB SINTETICO PREMISSAS', agora],
      );
      const usuario = (login: string) =>
        garantir(
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
        );
      ids.autor = await usuario('c1125p.autor');
      ids.aprovador = await usuario('c1125p.aprova');
      await limpar(e);
    });
    orcamento = new PortaOrcamentoPropria(nucleo, CLIENTE);
    porta = new PortaPremissasOrcamentoPropria(nucleo, CLIENTE);
    servico = new ServicoPremissasOrcamento(orcamento, porta, 'financeiro.orcamento.editar');
    servicoOrc = new ServicoOrcamento(orcamento);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1125' }, limpar);
    await nucleo.encerrar?.();
  });

  it('cenário: cadastra, altera pela versão lida, recusa código repetido e tendência incoerente', async () => {
    const { id } = await servico.criarCenario(
      autor(),
      { codigo: `${P}-otim`, descricao: 'Otimista sintetico', tendencia: 'otimista', ajusteCentesimos: 550 },
      EV,
    );
    const c = await ler<{
      codigo: string;
      tendencia: string;
      percentual_ajuste: string;
      ativo: number;
      versao: number;
    }>('SELECT codigo, tendencia, percentual_ajuste, ativo, versao FROM cenario_orcamento WHERE id = ?', [
      id,
    ]);
    expect([
      c?.codigo,
      c?.tendencia,
      Number(c?.percentual_ajuste),
      Number(c?.ativo),
      Number(c?.versao),
    ]).toEqual([`${P}-OTIM`, 'otimista', 5.5, 1, 1]);
    expect((await ultimaTrilha('cenario_orcamento', id))?.acao).toBe('inclusao');
    await expect(
      servico.criarCenario(
        autor(),
        { codigo: `${P}-OTIM`, descricao: 'Repetido', tendencia: 'otimista', ajusteCentesimos: 100 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      servico.criarCenario(
        autor(),
        { codigo: `${P}-X`, descricao: 'Incoerente', tendencia: 'otimista', ajusteCentesimos: -100 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await servico.alterarCenario(
        autor(),
        id,
        {
          versao: 1,
          codigo: `${P}-OTIM`,
          descricao: 'Otimista revisto',
          tendencia: 'otimista',
          ajusteCentesimos: 1000,
        },
        EV,
      ),
    ).toEqual({ versao: 2 });
    await expect(
      servico.alterarCenario(
        autor(),
        id,
        { versao: 1, codigo: `${P}-OTIM`, descricao: 'Velha', tendencia: 'otimista', ajusteCentesimos: 200 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const lido = (await servico.cenarios(autor())).find((x) => x.id === id);
    expect(lido).toMatchObject({ ajusteCentesimos: 1000, descricao: 'Otimista revisto', versao: 2 });
  });

  it('premissas da versão: incluir, alterar, retirar (lógica), escolher o cenário, projeção e versão fechada', async () => {
    const v = await servicoOrc.criar(
      autor(),
      { ano: ANO, empresa: 1, descricao: 'Versao sintetica premissas', base: { tipo: 'vazio' } },
      EV_ORC,
    );
    // Um consumo sem centro, para a projeção ter parcela (o consumo por centro grava sem o insumo).
    await orcamento.gravarLinhas(
      autor().porta,
      v.id,
      1,
      {
        incluir: [
          {
            centro: 0,
            natureza: 'consumo',
            grupo: 0,
            subgrupo: 0,
            item: 0,
            meses: Array.from({ length: 12 }, () => 1000),
            observacao: null,
          },
        ],
        alterar: [],
        remover: [],
      },
      {
        login: 'c1125p.autor',
        chaveIdempotencia: `c1125-${randomUUID()}`,
        trilha: autor().trilha('x', 'alterar', 'linha_orcamento', v.id),
      },
    );

    // Regra do domínio na entrada: inflação sem percentual; reajuste acima de 20% sem justificativa.
    await expect(
      servico.incluirPremissa(
        autor(),
        v.id,
        { tipo: 'inflacao', descricao: 'IPCA', percentualCentesimos: null },
        EV,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      servico.incluirPremissa(
        autor(),
        v.id,
        { tipo: 'reajuste_tabela', descricao: 'Tabela propria', percentualCentesimos: 2500 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const a = await servico.incluirPremissa(
      autor(),
      v.id,
      {
        tipo: 'inflacao',
        descricao: 'IPCA projetado',
        percentualCentesimos: 450,
        justificativa: 'Boletim de mercado',
      },
      EV,
    );
    const b = await servico.incluirPremissa(
      autor(),
      v.id,
      { tipo: 'volume', descricao: 'Diarias de UTI', valorNumerico: 1825.5, unidade: 'diárias' },
      EV,
    );
    expect([a.sequencia, b.sequencia]).toEqual([1, 2]);
    const pa = await ler<{ tipo: string; percentual: string; criado_por: number; versao: number }>(
      'SELECT tipo, percentual, criado_por, versao FROM premissa_orcamento WHERE id = ?',
      [a.id],
    );
    expect([pa?.tipo, Number(pa?.percentual), Number(pa?.criado_por), Number(pa?.versao)]).toEqual([
      'inflacao',
      4.5,
      ids.autor,
      1,
    ]);
    const ta = await ultimaTrilha('premissa_orcamento', a.id);
    expect(ta?.acao).toBe('inclusao');
    expect((json(ta?.d) as { escritas: { tabela: string }[] }).escritas.map((x) => x.tabela)).toContain(
      'premissa_orcamento',
    );

    expect(
      await servico.alterarPremissa(
        autor(),
        v.id,
        a.id,
        { versao: 1, tipo: 'inflacao', descricao: 'IPCA revisto', percentualCentesimos: 480 },
        EV,
      ),
    ).toEqual({ versao: 2 });
    await expect(
      servico.alterarPremissa(
        autor(),
        v.id,
        a.id,
        { versao: 1, tipo: 'inflacao', descricao: 'Velha', percentualCentesimos: 500 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });

    await servico.retirarPremissa(autor(), v.id, b.id, { versao: 1 }, EV);
    const rb = await ler<{ excluido_em: unknown; excluido_por: number }>(
      'SELECT excluido_em, excluido_por FROM premissa_orcamento WHERE id = ?',
      [b.id],
    );
    expect(rb?.excluido_em).not.toBeNull();
    expect(Number(rb?.excluido_por)).toBe(ids.autor);

    // Escolha do cenário: grava na versão e a visão traz a projeção com as parcelas.
    const cen = (await servico.cenarios(autor())).find((x) => x.codigo === `${P}-OTIM`)!;
    const antes = (await orcamento.versao(autor().porta, v.id))!.versao;
    const esc = await servico.escolherCenario(autor(), v.id, { versao: antes, cenario: cen.id }, EV);
    expect(esc.versao).toBe(antes + 1);
    const cv = await ler<{ c: number }>(
      'SELECT cenario_orcamento_id AS c FROM versao_orcamento WHERE id = ?',
      [v.id],
    );
    expect(Number(cv?.c)).toBe(cen.id);
    const vis = await servico.daVersao(autor(), v.id);
    expect(vis.premissas.map((x) => [x.descricao, x.percentualCentesimos])).toEqual([['IPCA revisto', 480]]);
    expect(vis.cenario?.id).toBe(cen.id);
    expect(vis.projecao).toMatchObject({
      receitaBase: 0,
      receitaProjetada: 0,
      consumo: 12_000,
      resultadoProjetado: -12_000,
    });
    expect(vis.projecao?.conta).toContain('consumo 12000');
    // Versão lida velha na escolha.
    await expect(
      servico.escolherCenario(autor(), v.id, { versao: antes, cenario: null }, EV),
    ).rejects.toMatchObject({ status: 409 });

    // Aprovada por outra pessoa: a versão fecha para premissas e cenário.
    const atual = (await orcamento.versao(autor().porta, v.id))!.versao;
    await servicoOrc.aprovar(aprovador(), v.id, { versao: atual, observacao: null }, EV_ORC);
    await expect(
      servico.incluirPremissa(
        autor(),
        v.id,
        { tipo: 'cambio', descricao: 'Dolar', percentualCentesimos: 300 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fechada/i) });
    expect((await servico.daVersao(autor(), v.id)).editavel).toBe(false);
    // O cenário da versão aprovada fica como foi decidido: outro ajuste (ou tendência) é recusado no banco, a
    // descrição muda, e a projeção da aprovada não se mexe.
    const projAprovada = (await servico.daVersao(autor(), v.id)).projecao;
    const cenAtual = (await servico.cenarios(autor())).find((x) => x.id === cen.id)!;
    const base = {
      codigo: cenAtual.codigo,
      tendencia: cenAtual.tendencia,
      ajusteCentesimos: cenAtual.ajusteCentesimos,
    };
    await expect(
      servico.alterarCenario(
        aprovador(),
        cen.id,
        { ...base, versao: cenAtual.versao, descricao: cenAtual.descricao, ajusteCentesimos: 2000 },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409, detalhe: expect.stringMatching(/cenário novo/i) });
    await expect(
      servico.alterarCenario(
        aprovador(),
        cen.id,
        { ...base, versao: cenAtual.versao, descricao: cenAtual.descricao, tendencia: 'personalizado' },
        EV,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const ajusteNoBanco = await ler<{ p: string; versao: number }>(
      'SELECT percentual_ajuste AS p, versao FROM cenario_orcamento WHERE id = ?',
      [cen.id],
    );
    expect([Number(ajusteNoBanco?.p) * 100, Number(ajusteNoBanco?.versao)]).toEqual([
      cenAtual.ajusteCentesimos,
      cenAtual.versao,
    ]);
    expect(
      await servico.alterarCenario(
        aprovador(),
        cen.id,
        { ...base, versao: cenAtual.versao, descricao: 'Otimista da rede' },
        EV,
      ),
    ).toEqual({ versao: cenAtual.versao + 1 });
    expect((await servico.daVersao(autor(), v.id)).projecao).toEqual(projAprovada);
    // Nada apagado: as duas premissas seguem no banco (uma retirada).
    const n = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM premissa_orcamento WHERE versao_orcamento_id = ?',
      [v.id],
    );
    expect(Number(n?.n)).toBe(2);
  });
});
