// Contrato de efeito da rotina diária de efetivação dos cancelamentos de contrato de plano vencidos (08-SGO L94,
// C2-108) sobre o MariaDB real (cliente f22_o5): o pedido com efeito hoje é efetivado pelo ciclo do worker (pedido
// efetivado, contrato encerrado com o fim no efeito, os dois beneficiários baixados com o motivo de exclusão ligado ao
// motivo do cancelamento e um movimento de exclusão cada, crédito de fatura em aberto com o saldo inteiro, trilha da
// operação); o pedido com efeito futuro e o de outro estabelecimento não mudam; o motivo sem baixa ligada fica nos
// recusados com o código, sem travar os demais; o segundo ciclo não repete. Massa sintética (referências obrigatórias em linhas
// sintéticas de verdade) montada com as chaves estrangeiras desligadas; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  efetivarVencidosDoEstabelecimento,
  PortaCancelamentoContratoPropria,
} from './cancelamento-contrato-propria.js';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

describe.skipIf(SEM_BANCO)('efetivação diária dos cancelamentos de contrato vencidos (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro = 0;
  let hoje = '';
  const contratos: number[] = [];
  const pedidos: Record<'vencido' | 'futuro' | 'semBaixa' | 'outro', number> = {
    vencido: 0,
    futuro: 0,
    semBaixa: 0,
    outro: 0,
  };
  const motivos: number[] = [];
  let motivoBaixa = 0;
  let produto = 0;
  // Referências obrigatórias do contrato e do beneficiário que a efetivação regrava com as chaves estrangeiras ligadas:
  // linhas sintéticas de verdade (nada inventado), apagadas no limpar.
  const refs: Record<string, number[]> = {};

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      for (const id of [est?.id, outro].filter(Boolean)) {
        const cs = (
          await e.consultar<{ id: unknown }>(
            "SELECT id FROM contrato_plano WHERE estabelecimento_id = ? AND numero LIKE 'C2108-%'",
            [id],
          )
        ).map((r) => Number(r.id));
        for (const c of cs) {
          await e.executar('DELETE m FROM movimento_cadastral_beneficiario m WHERE m.contrato_plano_id = ?', [
            c,
          ]);
          await e.executar('DELETE FROM beneficiario_plano WHERE contrato_plano_id = ?', [c]);
          await e.executar('DELETE FROM cancelamento_contrato_plano WHERE contrato_plano_id = ?', [c]);
          await e.executar('DELETE FROM credito_fatura_plano WHERE contrato_plano_id = ?', [c]);
          await e.executar(
            'DELETE FROM trilha_auditoria WHERE entidade = ? AND entidade_id IN (SELECT id FROM cancelamento_contrato_plano WHERE contrato_plano_id = ?)',
            ['cancelamento_contrato_plano', c],
          );
          await e.executar('DELETE FROM contrato_plano WHERE id = ?', [c]);
        }
      }
      if (produto) await e.executar('DELETE FROM produto_plano WHERE id = ?', [produto]);
      for (const [tabela, ids] of Object.entries(refs))
        for (const id of ids) await e.executar(`DELETE FROM ${tabela} WHERE id = ?`, [id]);
      await e.executar("DELETE FROM motivo_movimento_cadastral WHERE codigo LIKE 'c2108-%'");
      await e.executar("DELETE FROM motivo_cancelamento_contrato WHERE codigo LIKE 'c2108-%'");
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'c2108a'));
    outro = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'c2108b'));
    est = { cliente: CLIENTE, id: a, codigo: 'c2108a', fuso: 'America/Sao_Paulo' };
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const [h] = await e.consultar<{ h: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS h");
      hoje = String(h!.h);
      const agora = new Date();
      for (const i of [1, 2])
        motivos.push(
          await inserirSintetico(e, 'motivo_cancelamento_contrato', {
            codigo: `c2108-${i}`,
            descricao: `Motivo sintético ${i}`,
            tipo_cancelamento: 'pedido_contratante',
            ativo: 1,
            criado_em: agora,
          }),
        );
      motivoBaixa = await inserirSintetico(e, 'motivo_movimento_cadastral', {
        codigo: 'c2108-baixa',
        descricao: 'Baixa sintética',
        tipo_movimento: 'exclusao',
        ativo: 1,
        motivo_cancelamento_contrato_id: motivos[0],
        criado_em: agora,
      });
      // O movimento de exclusão leva o produto do contrato (chave estrangeira conferida na gravação): produto sintético.
      produto = await inserirSintetico(e, 'produto_plano', {
        origem: 'sistema',
        tipo_contratacao: 'coletivo_empresarial',
        abrangencia_geografica: 'estadual',
        formacao_preco: 'pre_estabelecido',
        natureza: 'plano',
        situacao_ans: 'ativo',
        estabelecimento_id: a,
        criado_em: agora,
      });
      const ref = async (tabela: string, valores: Record<string, unknown> = {}) => {
        const id = await inserirSintetico(e, tabela, valores);
        (refs[tabela] ??= []).push(id);
        return id;
      };
      const pessoas = [
        await ref('pessoa_fisica', { origem: 'sistema', criado_em: agora }),
        await ref('pessoa_fisica', { origem: 'sistema', criado_em: agora }),
      ];
      const operadora = await ref('operadora_saude', {
        modalidade: 'medicina_grupo',
        segmentacao: 'medico_hospitalar',
        situacao_registro: 'ativo',
        origem: 'sistema',
        criado_em: agora,
      });
      const contratante = await ref('contratante_plano', {
        natureza: 'pessoa_fisica',
        tipo_pessoa: 'fisica',
        pessoa_fisica_id: pessoas[0],
        situacao: 'ativa',
        origem: 'sistema',
        criado_em: agora,
      });
      const classificacao = await ref('classificacao_plano', {
        tipo_contratacao: 'coletivo_empresarial',
        criado_em: agora,
      });
      const planoComercializado = await ref('plano_comercializado', {
        formacao_preco: 'pre_estabelecido',
        situacao: 'ativo',
        origem: 'sistema',
        criado_em: agora,
      });
      const contrato = (estabelecimento: number, n: number) =>
        inserirSintetico(e, 'contrato_plano', {
          estabelecimento_id: estabelecimento,
          numero: `C2108-${n}`,
          inicio_vigencia: '2025-01-01',
          tipo_vigencia: 'indeterminada',
          situacao: 'em_cancelamento',
          forma_reajuste: 'ipca',
          produto_plano_id: produto,
          operadora_saude_id: operadora,
          contratante_plano_id: contratante,
          classificacao_plano_id: classificacao,
          mes_reajuste: 1,
          origem: 'sistema',
          criado_em: agora,
        });
      const pedido = (ctr: number, n: number, efeito: string, motivo: number) =>
        inserirSintetico(e, 'cancelamento_contrato_plano', {
          contrato_plano_id: ctr,
          protocolo: `C2108-P${n}`,
          solicitante: 'contratante',
          motivo_cancelamento_contrato_id: motivo,
          data_efeito: efeito,
          situacao: 'solicitado',
          origem: 'sistema',
          valor_credito: n === 1 ? 80.25 : null,
          criado_em: agora,
        });
      for (const [i, estab] of [a, a, a, outro].entries()) contratos.push(await contrato(estab, i + 1));
      for (const ctr of contratos)
        for (const k of [1, 2])
          await inserirSintetico(e, 'beneficiario_plano', {
            contrato_plano_id: ctr,
            inicio_vigencia: '2025-02-01',
            data_adesao: '2025-02-01',
            situacao: 'ativo',
            tipo: 'titular',
            origem: 'sistema',
            matricula: `C2108-${ctr}-${k}`,
            codigo_controle_ans: null,
            pessoa_fisica_id: pessoas[k - 1],
            plano_comercializado_id: planoComercializado,
            criado_em: agora,
          });
      pedidos.vencido = await pedido(contratos[0]!, 1, hoje, motivos[0]!);
      pedidos.futuro = await pedido(contratos[1]!, 2, '2999-12-31', motivos[0]!);
      pedidos.semBaixa = await pedido(contratos[2]!, 3, hoje, motivos[1]!);
      pedidos.outro = await pedido(contratos[3]!, 4, hoje, motivos[0]!);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c2108' }, (l) => l.consultar<T>(sql, p));

  it('efetiva o vencido com baixa e crédito, recusa o motivo sem baixa e não repete', async () => {
    const porta = new PortaCancelamentoContratoPropria(nucleo, CLIENTE);
    const r = await efetivarVencidosDoEstabelecimento(porta, est);
    expect({ efetivados: r.efetivados, recusados: r.recusados }).toEqual({
      efetivados: [pedidos.vencido],
      recusados: [{ id: pedidos.semBaixa, codigo: 'motivo-baixa-ausente' }],
    });
    expect(r.baixados).toBe(2);

    const sit = async (id: number) =>
      (
        await q<{ s: unknown }>('SELECT situacao AS s FROM cancelamento_contrato_plano WHERE id = ?', [id])
      )[0]!.s;
    expect(await sit(pedidos.vencido)).toBe('efetivado');
    expect(await sit(pedidos.futuro)).toBe('solicitado');
    expect(await sit(pedidos.semBaixa)).toBe('solicitado');
    expect(await sit(pedidos.outro)).toBe('solicitado');

    const ctr = await q<{ s: unknown; f: unknown }>(
      "SELECT situacao AS s, DATE_FORMAT(fim_vigencia, '%Y-%m-%d') AS f FROM contrato_plano WHERE id = ?",
      [contratos[0]],
    );
    expect(ctr.map((x) => [x.s, x.f])).toEqual([['encerrado', hoje]]);
    const bens = await q<{ s: unknown; d: unknown; m: unknown; n: unknown }>(
      `SELECT b.situacao AS s, DATE_FORMAT(b.data_exclusao, '%Y-%m-%d') AS d, b.motivo_movimento_cadastral_id AS m,
              (SELECT COUNT(*) FROM movimento_cadastral_beneficiario v WHERE v.beneficiario_plano_id = b.id
                 AND v.tipo_movimento = 'exclusao') AS n
         FROM beneficiario_plano b WHERE b.contrato_plano_id = ? ORDER BY b.id`,
      [contratos[0]],
    );
    expect(bens.map((x) => [x.s, x.d, Number(x.m), Number(x.n)])).toEqual([
      ['excluido', hoje, motivoBaixa, 1],
      ['excluido', hoje, motivoBaixa, 1],
    ]);
    const intocados = await q<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM beneficiario_plano WHERE contrato_plano_id IN (?, ?, ?) AND situacao = 'ativo'",
      [contratos[1], contratos[2], contratos[3]],
    );
    expect(Number(intocados[0]!.n)).toBe(6);
    const cred = await q<{ v: unknown; s: unknown; x: unknown }>(
      'SELECT valor AS v, saldo AS s, situacao AS x FROM credito_fatura_plano WHERE contrato_plano_id = ?',
      [contratos[0]],
    );
    expect(cred.map((x) => [Number(x.v), Number(x.s), x.x])).toEqual([[80.25, 80.25, 'aberto']]);
    const trilha = await q<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'cancelamento_contrato_plano' AND entidade_id = ?",
      [pedidos.vencido],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThan(0);

    const denovo = await efetivarVencidosDoEstabelecimento(porta, est);
    expect(denovo.efetivados).toEqual([]);
  }, 60_000);
});
