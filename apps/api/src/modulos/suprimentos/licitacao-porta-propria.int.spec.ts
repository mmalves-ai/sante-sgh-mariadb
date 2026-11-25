// Contrato de efeito do processo de contratação pública na porta própria (C2-017, 09-AREA linha 81; Lei 14.133/2021)
// contra o MariaDB real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo executor do núcleo:
// a dispensa por valor abre o termo de referência (processo_licitatorio e os itens), a pesquisa de preços grava a
// pesquisa e os preços (o descartado fica gravado, fora da conta, com a justificativa), a sessão fecha a pesquisa com o
// valor estimado pela mediana, as propostas gravam a proposta do fornecedor e o preço por item, o julgamento grava o
// resultado, o vencedor e o valor adjudicado e quem julgou; quem conduziu não homologa (nada gravado) e a autoridade
// homologa (processo, item e proposta vencedora homologados). O reenvio pela mesma chave não grava de novo, a versão
// velha é recusada, o número repetido é recusado, o documento emitido entra no histórico, o processo deserto grava o
// motivo e o item deserto; outro estabelecimento não vê o processo. O histórico é só de inclusão.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import {
  esquemaAvancarLicitacao,
  esquemaCriarLicitacao,
  esquemaRegistrarPrecoLicitacao,
  esquemaRegistrarPropostaLicitacao,
  type ParametrosLicitacao,
} from '@sgh/contratos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaLicitacaoPropria } from './licitacao-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

type L = Record<string, unknown>;
const k = () => `t-lic-${randomUUID()}`;
const MARCA = `DL${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
const PARAM: ParametrosLicitacao = {
  minimoPrecos: 3,
  metodoEstimativa: 'mediana',
  prazoRecursoDiasUteis: 3,
  prazoAvisoRegulamentoDiasUteis: 5,
  exigeParecer: false,
  limiteDispensaObras: 125_451.15,
  limiteDispensaDemais: 62_725.59,
};
const hoje = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe.skipIf(SEM_BANCO)('processo de contratação pública (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaLicitacaoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let cAutoridade: ContextoPortaM18;
  let agente = '';
  let autoridade = '';
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2017' }, (l) => l.uma<L>(sql, p));
  const conta = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const g = <T>(ctx: ContextoPortaM18, fn: Parameters<PortaLicitacao['gravarSgh']>[2]) =>
    porta.gravarSgh(ctx, { entidade: 'processo_licitatorio' } as never, fn) as Promise<T>;
  type PortaLicitacao = import('./licitacao-porta.js').PortaLicitacao;
  const versao = async (id: number) =>
    Number((await um('SELECT versao FROM processo_licitatorio WHERE id = ?', [id]))?.['versao']);
  const criar = (numero: string, chave = k()) =>
    esquemaCriarLicitacao.parse({
      chave,
      numero,
      regime: 'lei-14133',
      modalidade: 'dispensa',
      criterio: 'menor-preco',
      natureza: 'bens',
      objeto: 'Aquisição sintética de material de escritório',
      justificativa: 'Necessidade sintética de reposição do material de escritório do setor.',
      fundamento: 'Lei 14.133, art. 75, II',
      pesoTecnica: null,
      sigiloso: false,
      agente,
      centroCusto: null,
      itens: [
        {
          descricao: 'Caneta esferográfica azul sintética',
          itemEstoque: m.insumo,
          unidade: 'CX',
          quantidade: 10,
        },
      ],
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaLicitacaoPropria(nucleo);
    c = contexto(m, m.estA, 't-c2017') as ContextoPortaM18;
    cAutoridade = { ...c, usuario: m.usuario2 } as ContextoPortaM18;
    agente = String((await um('SELECT login FROM usuario WHERE id = ?', [m.usuario]))?.['login']);
    autoridade = String((await um('SELECT login FROM usuario WHERE id = ?', [m.usuario2]))?.['login']);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2017-limpa' }, async (e) => {
        const ps = `SELECT id FROM processo_licitatorio WHERE estabelecimento_id IN (?, ?)`;
        const par = [m.estA, m.estB];
        await e.executar(
          `DELETE FROM evento_processo_licitatorio WHERE processo_licitatorio_id IN (${ps})`,
          par,
        );
        await e.executar(
          `UPDATE processo_licitatorio_item SET vencedora_proposta_licitacao_item_id = NULL WHERE processo_licitatorio_id IN (${ps})`,
          par,
        );
        await e.executar(
          `DELETE FROM proposta_licitacao_item WHERE proposta_licitacao_id IN (SELECT id FROM proposta_licitacao WHERE processo_licitatorio_id IN (${ps}))`,
          par,
        );
        await e.executar(`DELETE FROM proposta_licitacao WHERE processo_licitatorio_id IN (${ps})`, par);
        await e.executar(
          `DELETE FROM pesquisa_preco_item WHERE pesquisa_preco_id IN (SELECT id FROM pesquisa_preco WHERE processo_licitatorio_id IN (${ps}))`,
          par,
        );
        await e.executar(`DELETE FROM pesquisa_preco WHERE processo_licitatorio_id IN (${ps})`, par);
        await e.executar(
          `DELETE FROM processo_licitatorio_item WHERE processo_licitatorio_id IN (${ps})`,
          par,
        );
        await e.executar(`DELETE FROM processo_licitatorio WHERE estabelecimento_id IN (?, ?)`, par);
        await e.executar(
          `DELETE FROM idempotencia_operacao WHERE operacao = 'suprimentos.licitacao.ato' AND estabelecimento_id IN (?, ?)`,
          par,
        );
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('dispensa do termo à homologação: o que fica no banco em cada ato, a chave, a versão e a segregação', async () => {
    const chaveCriar = k();
    const r = await g<{ licitacao: number; repetido: boolean }>(c, (x) =>
      x.criar({ entrada: criar(`${MARCA}/1`, chaveCriar), usuario: agente, parametros: PARAM }),
    );
    const id = r.licitacao;
    const proc = await um('SELECT * FROM processo_licitatorio WHERE id = ?', [id]);
    expect(proc).toMatchObject({
      estabelecimento_id: m.estA,
      modalidade: 'dispensa',
      regime: 'lei_14133',
      etapa: 'planejamento',
      agente_contratacao_usuario_id: m.usuario,
      metodo_estimativa: 'mediana',
    });
    expect(
      await conta('SELECT COUNT(*) AS n FROM processo_licitatorio_item WHERE processo_licitatorio_id = ?', [
        id,
      ]),
    ).toBe(1);
    // A mesma chave devolve o já gravado, sem processo novo; o número repetido com outra chave é recusado.
    const rep = await g<{ licitacao: number; repetido: boolean }>(c, (x) =>
      x.criar({ entrada: criar(`${MARCA}/1`, chaveCriar), usuario: agente, parametros: PARAM }),
    );
    expect(rep).toMatchObject({ licitacao: id, repetido: true });
    expect(
      await codigoDe(
        g(c, (x) => x.criar({ entrada: criar(`${MARCA}/1`), usuario: agente, parametros: PARAM })),
      ),
    ).toBe('numero-repetido');
    expect(
      await conta('SELECT COUNT(*) AS n FROM processo_licitatorio WHERE estabelecimento_id = ?', [m.estA]),
    ).toBe(1);

    const avancar = (para: Record<string, unknown>) =>
      versao(id).then((v) =>
        g<{ etapa: string }>(c, (x) =>
          x.avancar({
            licitacao: id,
            entrada: esquemaAvancarLicitacao.parse({ chave: k(), versao: v, ...para }),
            usuario: agente,
            parametros: PARAM,
          }),
        ),
      );
    await avancar({ para: 'pesquisa' });
    // A versão velha é recusada sem gravar.
    expect(
      await codigoDe(
        g(c, (x) =>
          x.avancar({
            licitacao: id,
            entrada: esquemaAvancarLicitacao.parse({ chave: k(), versao: 1, para: 'sessao' }),
            usuario: agente,
            parametros: PARAM,
          }),
        ),
      ),
    ).toBe('conflito-versao');

    const item = Number(
      (await um('SELECT id FROM processo_licitatorio_item WHERE processo_licitatorio_id = ?', [id]))?.['id'],
    );
    const precos: number[] = [];
    for (const [valor, fonte] of [
      [10, 'painel'],
      [12, 'similar'],
      [11, 'midia'],
      [50, 'nota-fiscal'],
    ] as const) {
      const v = await versao(id);
      const p = await g<{ registro: number }>(c, (x) =>
        x.preco({
          licitacao: id,
          entrada: esquemaRegistrarPrecoLicitacao.parse({
            chave: k(),
            versao: v,
            item,
            fonte,
            referencia: `Referência sintética ${fonte}`,
            valor,
            data: hoje(),
          }),
          usuario: agente,
          parametros: PARAM,
        }),
      );
      precos.push(p.registro);
    }
    // O preço fora da curva é descartado com a justificativa: continua gravado, fora da conta.
    const vd = await versao(id);
    await g(c, (x) =>
      x.descartarPreco({
        licitacao: id,
        preco: precos[3]!,
        entrada: {
          chave: k(),
          versao: vd,
          justificativa: 'Preço excessivo, muito acima dos demais pesquisados.',
        },
        usuario: agente,
        parametros: PARAM,
      }),
    );
    expect(
      await um(
        'SELECT considerado, motivo_desconsideracao, desconsiderado_por_usuario_id FROM pesquisa_preco_item WHERE id = ?',
        [precos[3]],
      ),
    ).toMatchObject({ considerado: 0, desconsiderado_por_usuario_id: m.usuario });
    expect(
      await conta(
        'SELECT COUNT(*) AS n FROM pesquisa_preco_item x JOIN pesquisa_preco p ON p.id = x.pesquisa_preco_id WHERE p.processo_licitatorio_id = ?',
        [id],
      ),
    ).toBe(4);

    await avancar({ para: 'sessao' });
    expect(
      await um('SELECT etapa, valor_estimado FROM processo_licitatorio WHERE id = ?', [id]),
    ).toMatchObject({
      etapa: 'sessao',
      valor_estimado: '110.00',
    });
    expect(
      await um('SELECT valor_unitario_estimado FROM processo_licitatorio_item WHERE id = ?', [item]),
    ).toMatchObject({ valor_unitario_estimado: '11.000000' });
    expect(
      await um(
        'SELECT situacao, valor_estimado_total FROM pesquisa_preco WHERE processo_licitatorio_id = ?',
        [id],
      ),
    ).toMatchObject({
      situacao: 'fechada',
      valor_estimado_total: '110.00',
    });

    for (const [fornecedor, valor] of [
      [m.fornecedor, 9.5],
      [m.fornecedor2, 10.2],
    ] as const) {
      const v = await versao(id);
      await g(c, (x) =>
        x.proposta({
          licitacao: id,
          entrada: esquemaRegistrarPropostaLicitacao.parse({
            chave: k(),
            versao: v,
            item,
            fornecedor,
            valor,
            marca: 'Marca sintética',
          }),
          usuario: agente,
          parametros: PARAM,
        }),
      );
    }
    expect(
      await conta('SELECT COUNT(*) AS n FROM proposta_licitacao WHERE processo_licitatorio_id = ?', [id]),
    ).toBe(2);

    await avancar({ para: 'julgado' });
    const julgado = await um(
      `SELECT i.resultado_julgamento, i.valor_adjudicado, i.situacao, pl.empresa_fornecedora_id AS vencedor, pi.resultado
         FROM processo_licitatorio_item i JOIN proposta_licitacao_item pi ON pi.id = i.vencedora_proposta_licitacao_item_id
         JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id WHERE i.id = ?`,
      [item],
    );
    expect(julgado).toMatchObject({
      resultado_julgamento: 'adjudicavel',
      valor_adjudicado: '9.500000',
      situacao: 'adjudicado',
      vencedor: m.fornecedor,
      resultado: 'vencedor',
    });
    expect(
      await um('SELECT julgado_por_usuario_id, julgado_em FROM processo_licitatorio WHERE id = ?', [id]),
    ).toMatchObject({
      julgado_por_usuario_id: m.usuario,
    });

    // Quem conduziu e julgou não homologa (segregação de funções): nada gravado.
    const vh = await versao(id);
    expect(
      await codigoDe(
        g(c, (x) =>
          x.homologar({
            licitacao: id,
            entrada: { chave: k(), versao: vh, observacao: null },
            usuario: agente,
            parametros: PARAM,
          }),
        ),
      ),
    ).toBe('licitacao-segregacao');
    expect(await versao(id)).toBe(vh);
    await g(cAutoridade, (x) =>
      x.homologar({
        licitacao: id,
        entrada: { chave: k(), versao: vh, observacao: null },
        usuario: autoridade,
        parametros: PARAM,
      }),
    );
    expect(
      await um(
        'SELECT etapa, homologado_por_usuario_id, data_homologacao FROM processo_licitatorio WHERE id = ?',
        [id],
      ),
    ).toMatchObject({ etapa: 'homologado', homologado_por_usuario_id: m.usuario2 });
    expect(
      await um(
        `SELECT pi.resultado, pi.valor_homologado, pi.quantidade_homologada FROM processo_licitatorio_item i
           JOIN proposta_licitacao_item pi ON pi.id = i.vencedora_proposta_licitacao_item_id WHERE i.id = ?`,
        [item],
      ),
    ).toMatchObject({
      resultado: 'homologado',
      valor_homologado: '9.500000',
      quantidade_homologada: '10.0000',
    });

    // O documento emitido entra no histórico (sem mudar a etapa nem a versão); o histórico tem cada ato.
    const vAntes = await versao(id);
    await g(c, (x) =>
      x.documento({
        licitacao: id,
        documento: {
          tipo: 'ata',
          emissao: `EM-${MARCA}`,
          sha256: 'a'.repeat(64),
          identificadorQr: 'QR-SINT',
          etapa: 'homologado',
        } as never,
        usuario: agente,
      }),
    );
    expect(await versao(id)).toBe(vAntes);
    const eventos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2017' }, (l) =>
      l.consultar<L>(
        'SELECT tipo, assunto, etapa_posterior FROM evento_processo_licitatorio WHERE processo_licitatorio_id = ? ORDER BY id',
        [id],
      ),
    );
    expect(eventos.map((e) => `${String(e['tipo'])}:${String(e['etapa_posterior'] ?? '')}`)).toEqual([
      'avanco:pesquisa',
      'avanco:sessao',
      'avanco:julgado',
      'homologacao:homologado',
      'documento:',
    ]);

    // O detalhe lido do banco monta o processo pelo domínio; outro estabelecimento não o vê.
    const d = await porta.detalhar(c, id, { parametros: PARAM, usuario: agente, conduz: true });
    expect(d).toMatchObject({ etapa: 'homologado' });
    expect(
      await porta.detalhar({ ...c, estabelecimento: m.estB } as ContextoPortaM18, id, {
        parametros: PARAM,
        usuario: agente,
        conduz: true,
      }),
    ).toBeNull();
    const lista = await porta.listar(c, { pagina: 1 } as never);
    expect(lista.itens.map((x) => x.id)).toContain(id);
    expect((await porta.painel(c)).porEtapa.homologado).toBe(1);
  }, 120_000);

  it('sessão sem proposta: o processo deserto grava o motivo e o item deserto', async () => {
    const r = await g<{ licitacao: number }>(c, (x) =>
      x.criar({ entrada: criar(`${MARCA}/2`), usuario: agente, parametros: PARAM }),
    );
    const id = r.licitacao;
    const passo = async (para: Record<string, unknown>) => {
      const v = await versao(id);
      return codigoDe(
        g(c, (x) =>
          x.avancar({
            licitacao: id,
            entrada: esquemaAvancarLicitacao.parse({ chave: k(), versao: v, ...para }),
            usuario: agente,
            parametros: PARAM,
          }),
        ),
      );
    };
    expect(await passo({ para: 'pesquisa' })).toBe('ok');
    const item = Number(
      (await um('SELECT id FROM processo_licitatorio_item WHERE processo_licitatorio_id = ?', [id]))?.['id'],
    );
    for (const fonte of ['painel', 'similar', 'midia'] as const) {
      const v = await versao(id);
      await g(c, (x) =>
        x.preco({
          licitacao: id,
          entrada: esquemaRegistrarPrecoLicitacao.parse({
            chave: k(),
            versao: v,
            item,
            fonte,
            referencia: `Referência sintética ${fonte}`,
            valor: 10,
            data: hoje(),
          }),
          usuario: agente,
          parametros: PARAM,
        }),
      );
    }
    expect(await passo({ para: 'sessao' })).toBe('ok');
    expect(
      await passo({
        para: 'deserto',
        justificativa: 'Nenhum fornecedor apresentou proposta na sessão sintética.',
      }),
    ).toBe('ok');
    expect(
      await um('SELECT etapa, motivo_encerramento FROM processo_licitatorio WHERE id = ?', [id]),
    ).toMatchObject({
      etapa: 'deserto',
      motivo_encerramento: 'Nenhum fornecedor apresentou proposta na sessão sintética.',
    });
    expect(
      await um('SELECT resultado_julgamento, situacao FROM processo_licitatorio_item WHERE id = ?', [item]),
    ).toMatchObject({ resultado_julgamento: 'deserto', situacao: 'deserto' });
  }, 120_000);
});
