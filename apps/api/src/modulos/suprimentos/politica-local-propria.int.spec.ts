// F3.6 (05-SUP linha 3): contrato de efeito da política do local de estoque e da concessão do usuário por
// classificação, na porta própria contra o MariaDB real (cliente de teste; massa SINTÉTICA, nenhuma pessoa real). O
// que o cadastro do local guarda passa a decidir as gravações: tipo de pedido atendido, só urgente, setores
// atendidos, o que o local guarda, atendimento em parte; e a concessão do usuário por grupo decide o que ele
// requisita, movimenta e compra. Cada recusa é conferida pelo que NÃO ficou no banco, e cada liberação pelo que ficou.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
const LOCAIS_DA_MASSA = "SELECT id FROM local_estoque WHERE codigo LIKE 'F22L0314%'";
let k = 0;

describe.skipIf(SEM_BANCO)('política do local e concessão por classificação (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let outroGrupo: number;
  let setorDoCentro: number;
  let outroSetor: number;
  const acesso = { cliente: CLIENTE, correlacao: 't-f36-politica' };
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente(acesso, (l) => l.consultar<T>(sql, p));
  const gravar = (sql: string, p: unknown[] = []) => nucleo.escrever(acesso, (e) => e.executar(sql, p));
  const op = (nome: string, entrada: unknown) =>
    porta.executar(c, `suprimentos.${nome}`, entrada, {
      ...c,
      chaveIdempotencia: `f36p-${RODADA}-${++k}`,
    });
  const conta = async (sql: string, p: unknown[] = []) =>
    Number((await ler<{ q: unknown }>(sql, p))[0]?.q ?? 0);
  const requisicoes = () =>
    conta('SELECT COUNT(*) AS q FROM requisicao_material WHERE atendente_local_estoque_id = ?', [m.localA]);
  const saldo = (local: number) =>
    conta('SELECT quantidade AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
      local,
      m.insumo,
    ]);
  const requisicao = (extra: Record<string, unknown> = {}, quantidade = 1) => ({
    destino: 2,
    local: m.localA,
    centroCusto: m.centroCusto,
    localConsumo: 1,
    itens: [{ item: m.insumo, quantidade }],
    ...extra,
  });
  const saida = (quantidade: number, extra: Record<string, unknown> = {}) => ({
    destino: 2,
    local: m.localA,
    centroCusto: m.centroCusto,
    localConsumo: 1,
    itens: [{ item: m.insumo, quantidade }],
    ...extra,
  });
  /** Volta os locais e o usuário ao cadastro sem política (cada teste marca o que prova). */
  const zerar = async () => {
    await gravar(
      `UPDATE local_estoque SET atende_solicitacao_setor = FALSE, atende_solicitacao_paciente = FALSE,
              atende_transferencia = FALSE, permite_atendimento_parcial = TRUE, apenas_urgente = FALSE
        WHERE codigo LIKE 'F22L0314%'`,
    );
    await gravar(`DELETE FROM local_estoque_setor WHERE local_estoque_id IN (${LOCAIS_DA_MASSA})`);
    await gravar(`DELETE FROM local_estoque_classificacao WHERE local_estoque_id IN (${LOCAIS_DA_MASSA})`);
    await gravar(
      "DELETE FROM usuario_estoque_classificacao WHERE usuario_id IN (SELECT id FROM usuario WHERE login LIKE 'F22L0314%')",
    );
  };
  const limparSetores = () => gravar("DELETE FROM setor_funcional WHERE codigo LIKE 'F22L0314%'");

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    // O que este arquivo cria e a limpeza da massa não conhece sai antes dela (sobra de rodada interrompida).
    await zerar();
    await limparSetores();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'f36-politica') } as ContextoSuprimentos;
    await nucleo.escrever(acesso, async (e) => {
      outroGrupo = await inserirMinimo(e, 'grupo_insumo', { natureza: 'material' }, `${m.marca}H`);
      setorDoCentro = await inserirMinimo(
        e,
        'setor_funcional',
        {
          estabelecimento_id: m.estA,
          codigo: `${m.marca}S1`,
          nome: 'SETOR DO CENTRO',
          tipo: 'assistencial',
          centro_custo_id: m.centroCusto,
        },
        m.marca,
      );
      outroSetor = await inserirMinimo(
        e,
        'setor_funcional',
        { estabelecimento_id: m.estA, codigo: `${m.marca}S2`, nome: 'OUTRO SETOR', tipo: 'assistencial' },
        m.marca,
      );
    });
  }, 120_000);

  beforeEach(async () => {
    await zerar();
  });

  afterAll(async () => {
    if (nucleo) {
      await zerar();
      await limparSetores();
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  it('tipo de pedido: o local que marcou só paciente recusa a requisição de setor e a transferência', async () => {
    const antes = await requisicoes();
    // Sem nenhuma marcação o local atende (cadastro ainda não configurado).
    await op('requisitarMaterial', requisicao());
    expect(await requisicoes()).toBe(antes + 1);
    await gravar('UPDATE local_estoque SET atende_solicitacao_paciente = TRUE WHERE id = ?', [m.localA]);
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('local-nao-atende-setor');
    expect(await requisicoes()).toBe(antes + 1);
    const saldoA = await saldo(m.localA);
    const saldoA2 = await saldo(m.localA2);
    const transferencia = {
      origem: m.localA,
      destino: m.localA2,
      itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
    };
    expect(await codigoDe(op('transferir', transferencia))).toBe('local-nao-atende-transferencia');
    expect([await saldo(m.localA), await saldo(m.localA2)]).toEqual([saldoA, saldoA2]);
    await gravar(
      'UPDATE local_estoque SET atende_solicitacao_setor = TRUE, atende_transferencia = TRUE WHERE id = ?',
      [m.localA],
    );
    await op('requisitarMaterial', requisicao());
    expect(await requisicoes()).toBe(antes + 2);
    await op('transferir', transferencia);
    expect([await saldo(m.localA), await saldo(m.localA2)]).toEqual([saldoA - 1, saldoA2 + 1]);
  });

  it('só urgente: a requisição comum é recusada e a urgente fica gravada como urgente', async () => {
    await gravar('UPDATE local_estoque SET apenas_urgente = TRUE WHERE id = ?', [m.localA]);
    const antes = await requisicoes();
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('local-so-urgente');
    expect(await requisicoes()).toBe(antes);
    const r = await op('requisitarMaterial', requisicao({ urgente: true }));
    expect(
      await ler('SELECT urgente, situacao FROM requisicao_material WHERE id = ?', [
        Number(r.resultado['id']),
      ]),
    ).toMatchObject([{ urgente: 1, situacao: 'solicitada' }]);
  });

  it('setores atendidos: o local com lista só recebe a requisição do setor que está nela', async () => {
    const liga = (setor: number, tipo = 'ambos') =>
      nucleo.escrever(acesso, (e) =>
        inserirMinimo(
          e,
          'local_estoque_setor',
          { local_estoque_id: m.localA, setor_funcional_id: setor, tipo_atendimento: tipo },
          m.marca,
        ),
      );
    await liga(outroSetor);
    const antes = await requisicoes();
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('setor-nao-atendido');
    expect(await requisicoes()).toBe(antes);
    // O setor do centro ligado só para dispensação não libera a requisição.
    const id = await liga(setorDoCentro, 'dispensacao');
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('setor-nao-atendido');
    await gravar("UPDATE local_estoque_setor SET tipo_atendimento = 'requisicao' WHERE id = ?", [id]);
    await op('requisitarMaterial', requisicao());
    expect(await requisicoes()).toBe(antes + 1);
  });

  it('classificação do local: o que o local não guarda não é requisitado, não sai, não entra por transferência', async () => {
    const classe = (local: number, grupo: number) =>
      nucleo.escrever(acesso, (e) =>
        inserirMinimo(
          e,
          'local_estoque_classificacao',
          { local_estoque_id: local, grupo_insumo_id: grupo },
          m.marca,
        ),
      );
    const idA = await classe(m.localA, outroGrupo);
    const antes = await requisicoes();
    const saldoA = await saldo(m.localA);
    const saldoA2 = await saldo(m.localA2);
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('item-fora-do-local');
    expect(await codigoDe(op('registrarSaida', saida(1)))).toBe('item-fora-do-local');
    expect(await requisicoes()).toBe(antes);
    expect(await saldo(m.localA)).toBe(saldoA);
    // O grupo do item entra na classificação: a requisição e a saída passam.
    await gravar('UPDATE local_estoque_classificacao SET grupo_insumo_id = ? WHERE id = ?', [m.grupo, idA]);
    await op('requisitarMaterial', requisicao());
    await op('registrarSaida', saida(1));
    expect(await requisicoes()).toBe(antes + 1);
    expect(await saldo(m.localA)).toBe(saldoA - 1);
    // O destino que não guarda o grupo recusa a transferência; nada sai da origem.
    await classe(m.localA2, outroGrupo);
    expect(
      await codigoDe(
        op('transferir', {
          origem: m.localA,
          destino: m.localA2,
          itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
        }),
      ),
    ).toBe('item-fora-do-local');
    expect([await saldo(m.localA), await saldo(m.localA2)]).toEqual([saldoA - 1, saldoA2]);
  });

  it('atendimento em parte: o local que não permite só atende a requisição inteira', async () => {
    await gravar('UPDATE local_estoque SET permite_atendimento_parcial = FALSE WHERE id = ?', [m.localA]);
    const r = await op('requisitarMaterial', requisicao({}, 2));
    const id = Number(r.resultado['id']);
    const saldoA = await saldo(m.localA);
    expect(await codigoDe(op('registrarSaida', saida(1, { requisicao: id })))).toBe(
      'atendimento-parcial-nao-permitido',
    );
    expect(await saldo(m.localA)).toBe(saldoA);
    expect(await ler('SELECT situacao FROM requisicao_material WHERE id = ?', [id])).toMatchObject([
      { situacao: 'solicitada' },
    ]);
    await op('registrarSaida', saida(2, { requisicao: id }));
    expect(await saldo(m.localA)).toBe(saldoA - 2);
    expect(await ler('SELECT situacao FROM requisicao_material WHERE id = ?', [id])).toMatchObject([
      { situacao: 'atendida' },
    ]);
  });

  it('concessão do usuário por grupo: requisitar, movimentar e comprar pesam cada um; retirar não abre tudo', async () => {
    const concede = (grupo: number, extra: Record<string, unknown> = {}) =>
      nucleo.escrever(acesso, (e) =>
        inserirMinimo(
          e,
          'usuario_estoque_classificacao',
          {
            estabelecimento_id: m.estA,
            usuario_id: m.usuario,
            grupo_insumo_id: grupo,
            permite_requisitar: true,
            permite_movimentar: false,
            permite_comprar: false,
            vigencia_inicio: '2026-01-01',
            ...extra,
          },
          m.marca,
        ),
      );
    const pedido = {
      centroCusto: m.centroCusto,
      fornecedores: [m.fornecedor],
      itens: [{ item: m.insumo, quantidade: 1 }],
    };
    const pedidos = () =>
      conta('SELECT COUNT(*) AS q FROM pedido_compra WHERE estabelecimento_id = ?', [m.estA]);
    // A concessão é de outro grupo: o item fica fora para tudo.
    await concede(outroGrupo, { permite_movimentar: true, permite_comprar: true });
    const antes = await requisicoes();
    const saldoA = await saldo(m.localA);
    const pedidosAntes = await pedidos();
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('item-fora-do-escopo');
    expect(await codigoDe(op('registrarSaida', saida(1)))).toBe('item-fora-do-escopo');
    expect(await codigoDe(op('criarPedido', pedido))).toBe('item-fora-do-escopo');
    expect([await requisicoes(), await saldo(m.localA), await pedidos()]).toEqual([
      antes,
      saldoA,
      pedidosAntes,
    ]);
    // O grupo do item só para requisitar: requisita, mas não dá saída nem compra.
    const id = await concede(m.grupo);
    await op('requisitarMaterial', requisicao());
    expect(await requisicoes()).toBe(antes + 1);
    expect(await codigoDe(op('registrarSaida', saida(1)))).toBe('item-fora-do-escopo');
    expect(await codigoDe(op('criarPedido', pedido))).toBe('item-fora-do-escopo');
    expect([await saldo(m.localA), await pedidos()]).toEqual([saldoA, pedidosAntes]);
    await gravar(
      'UPDATE usuario_estoque_classificacao SET permite_movimentar = TRUE, permite_comprar = TRUE WHERE id = ?',
      [id],
    );
    await op('registrarSaida', saida(1));
    await op('criarPedido', pedido);
    expect([await saldo(m.localA), await pedidos()]).toEqual([saldoA - 1, pedidosAntes + 1]);
    // Vigência encerrada em todas: o usuário que já teve concessão não volta a ver todos os itens.
    await gravar(
      "UPDATE usuario_estoque_classificacao SET vigencia_fim = '2026-01-02' WHERE usuario_id = ? AND estabelecimento_id = ?",
      [m.usuario, m.estA],
    );
    expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('item-fora-do-escopo');
    expect(await requisicoes()).toBe(antes + 1);
  });

  it('concessão só por classificação de despesa: vale pela classificação do grupo do item, e o grupo sem ela fica fora', async () => {
    const despesa = await nucleo.escrever(acesso, (e) =>
      inserirMinimo(e, 'classificacao_despesa', { codigo: `${m.marca}CD`.slice(0, 30) }, m.marca),
    );
    try {
      await nucleo.escrever(acesso, (e) =>
        inserirMinimo(
          e,
          'usuario_estoque_classificacao',
          {
            estabelecimento_id: m.estA,
            usuario_id: m.usuario,
            classificacao_despesa_id: despesa,
            permite_requisitar: true,
            permite_movimentar: true,
            permite_comprar: false,
            vigencia_inicio: '2026-01-01',
          },
          m.marca,
        ),
      );
      const antes = await requisicoes();
      const saldoA = await saldo(m.localA);
      // O grupo do item ainda não tem classificação de despesa: a concessão só por despesa não o cobre.
      await gravar('UPDATE grupo_insumo SET classificacao_despesa_id = NULL WHERE id = ?', [m.grupo]);
      expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('item-fora-do-escopo');
      expect(await codigoDe(op('registrarSaida', saida(1)))).toBe('item-fora-do-escopo');
      expect([await requisicoes(), await saldo(m.localA)]).toEqual([antes, saldoA]);
      // O grupo ganha a classificação: o item passa a ser requisitado e a sair pelo que a concessão marcou.
      await gravar('UPDATE grupo_insumo SET classificacao_despesa_id = ? WHERE id = ?', [despesa, m.grupo]);
      await op('requisitarMaterial', requisicao());
      await op('registrarSaida', saida(1));
      expect([await requisicoes(), await saldo(m.localA)]).toEqual([antes + 1, saldoA - 1]);
      // A ação continua pesando: a concessão não marcou comprar.
      const pedido = {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 1 }],
      };
      expect(await codigoDe(op('criarPedido', pedido))).toBe('item-fora-do-escopo');
      // Outra classificação no grupo: o item volta a ficar fora.
      const outra = await nucleo.escrever(acesso, (e) =>
        inserirMinimo(e, 'classificacao_despesa', { codigo: `${m.marca}CE`.slice(0, 30) }, m.marca),
      );
      await gravar('UPDATE grupo_insumo SET classificacao_despesa_id = ? WHERE id = ?', [outra, m.grupo]);
      expect(await codigoDe(op('requisitarMaterial', requisicao()))).toBe('item-fora-do-escopo');
      expect(await requisicoes()).toBe(antes + 1);
    } finally {
      await gravar('UPDATE grupo_insumo SET classificacao_despesa_id = NULL WHERE id = ?', [m.grupo]);
      await gravar(
        "DELETE FROM usuario_estoque_classificacao WHERE usuario_id IN (SELECT id FROM usuario WHERE login LIKE 'F22L0314%')",
      );
      await gravar('DELETE FROM classificacao_despesa WHERE codigo LIKE ?', [`${m.marca}C%`]);
    }
  });

  it('confere saldo desligado é só informativo: a saída sem saldo continua recusada e o saldo não fica negativo', async () => {
    await gravar('UPDATE local_estoque SET verifica_saldo = FALSE WHERE id = ?', [m.localA]);
    try {
      const saldoA = await saldo(m.localA);
      expect(await codigoDe(op('registrarSaida', saida(saldoA + 1)))).toBe('saldo-insuficiente');
      expect(await saldo(m.localA)).toBe(saldoA);
    } finally {
      await gravar('UPDATE local_estoque SET verifica_saldo = TRUE WHERE id = ?', [m.localA]);
    }
  });
});
