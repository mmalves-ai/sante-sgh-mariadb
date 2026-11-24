// Contrato de efeito dos limites do pedido de exame (F8, 05-SADT linha 6) no MariaDB real (cliente f22_o2; massa
// SINTÉTICA). Prova o que fica no banco: o cadastro da cota, do intervalo (repetição proibida no mesmo dia) e do
// bloqueio pelo último resultado, cada um com a trilha; a avaliação do pedido acusando os três na hora; a recusa com
// motivo sem gravar nada; a liberação justificada e autorizada registrada no item (liberacao_excecao_exame com o tipo,
// a regra e quem gravou); a desativação que não apaga. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoLimitesExame } from './limites-exame-propria.js';
import { ServicoPedidoSadt } from './pedido-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('limites do pedido de exame (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let pedidos: ServicoPedidoSadt;
  let limites: ServicoLimitesExame;
  let m: MassaSadt | null = null;
  const reqs: number[] = [];
  const regras = { cota: 0, intervalo: 0, resultado: 0 };
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f8l6' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f8l6' }, (l) => l.consultar(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'L6');
    pedidos = new ServicoPedidoSadt(nucleo);
    limites = new ServicoLimitesExame(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const est = m.base.est;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f8l6' }, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        for (const r of reqs) {
          await x(
            'DELETE l FROM liberacao_excecao_exame l JOIN exame_item ei ON ei.id = l.exame_item_id WHERE ei.requisicao_exame_id = ?',
            [r],
          );
          await x(
            'DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id WHERE ei.requisicao_exame_id = ?',
            [r],
          );
          await x('DELETE FROM exame_item WHERE requisicao_exame_id = ?', [r]);
          await x('DELETE FROM requisicao_exame WHERE id = ?', [r]);
        }
        await x('DELETE FROM cota_exame WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM intervalo_repeticao_exame WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM bloqueio_exame_resultado WHERE id = ?', [regras.resultado]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('cadastra, acusa na hora, recusa com motivo, libera com registro e desativa sem apagar', async () => {
    const c = contexto(m!);
    // Cadastro: validação na hora (a regra do domínio) antes de gravar.
    expect(
      codigoDe(
        await limites
          .incluirCota(c, { exame: m!.exameLab, periodo: 'mes', vigenciaInicio: '2020-01-01' })
          .catch((e: unknown) => e),
      ),
    ).toBe('cota-sem-limite');
    // A massa já pediu o exame do laboratório neste mês: a cota de 1 se esgota.
    regras.cota = (
      await limites.incluirCota(c, {
        exame: m!.exameLab,
        periodo: 'mes',
        quantidadeMaxima: 1,
        vigenciaInicio: '2020-01-01',
      })
    ).id;
    regras.intervalo = (
      await limites.incluirIntervalo(c, {
        exame: m!.exameImagem,
        mesmoDia: true,
        acao: 'exigir_justificativa',
        vigenciaInicio: '2020-01-01',
      })
    ).id;
    // O último resultado liberado do analito da massa existe: "diferente de um valor impossível" sempre casa.
    regras.resultado = (
      await limites.incluirBloqueioResultado(c, {
        exame: m!.exameLab,
        analito: m!.analito,
        operador: 'diferente',
        valor: '-999999',
        janelaDias: 3650,
        acao: 'alertar',
        mensagem: 'Resultado recente do paciente: confira a necessidade.',
      })
    ).id;
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade IN ('cota_exame','intervalo_repeticao_exame','bloqueio_exame_resultado')
          AND entidade_id IN (?, ?, ?)`,
        [regras.cota, regras.intervalo, regras.resultado],
      ),
    ).toBeGreaterThanOrEqual(3);
    const lista = await limites.listar(c);
    expect(lista.cotas.find((x) => x.id === regras.cota)?.usoNoPeriodo).toBeGreaterThanOrEqual(1);
    expect(lista.intervalos.find((x) => x.id === regras.intervalo)).toMatchObject({
      mesmoDia: true,
      conflitante: m!.exameImagem,
    });

    const pedido = {
      atendimento: m!.base.atendimento,
      setor: m!.setorLab,
      exames: [{ exame: m!.exameLab }, { exame: m!.exameImagem }],
      confirmado: false,
    };
    const av = await pedidos.avaliarPedido(c, pedido);
    expect(av.segue).toBe(false);
    expect(av.limites.map((x) => [x.tipo, x.regra, x.acao]).sort()).toEqual(
      [
        ['cota', regras.cota, 'bloquear'],
        ['intervalo', regras.intervalo, 'exigir_justificativa'],
        ['ultimo_resultado', regras.resultado, 'alertar'],
      ].sort(),
    );
    expect(av.codigo).toBe('limite-bloqueio');

    // Sem a permissão de autorizar, a justificativa não basta para o bloqueio da cota: nada é gravado.
    const antes = await contar('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [
      m!.base.paciente,
    ]);
    const justificado = {
      ...pedido,
      confirmado: true,
      justificativa: 'paciente oncológico em controle semanal',
    };
    expect(codigoDe(await pedidos.abrirPedido(c, justificado, false).catch((e: unknown) => e))).toBe(
      'limite-autorizacao',
    );
    expect(
      await contar('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [m!.base.paciente]),
    ).toBe(antes);

    // Com a permissão: grava e registra a liberação da cota e do intervalo (o alerta só pediu confirmação).
    const g = await pedidos.abrirPedido(c, justificado, true);
    reqs.push(g.requisicao);
    const libs = await todos(
      `SELECT l.tipo_bloqueio, l.cota_exame_id, l.intervalo_repeticao_exame_id, l.usuario_id, ei.exame_id
         FROM liberacao_excecao_exame l JOIN exame_item ei ON ei.id = l.exame_item_id
        WHERE ei.requisicao_exame_id = ? ORDER BY l.tipo_bloqueio`,
      [g.requisicao],
    );
    expect(libs.map((x) => [x['tipo_bloqueio'], Number(x['exame_id'])])).toEqual([
      ['cota', m!.exameLab],
      ['intervalo', m!.exameImagem],
    ]);
    expect(Number(libs[0]!['cota_exame_id'])).toBe(regras.cota);
    expect(Number(libs[1]!['intervalo_repeticao_exame_id'])).toBe(regras.intervalo);
    expect(Number(libs[0]!['usuario_id'])).toBe(m!.base.usuario);

    // Repetição proibida no mesmo dia: o exame de imagem já foi pedido hoje (agora pelo pedido acima).
    const soImagem = { ...pedido, exames: [{ exame: m!.exameImagem }], confirmado: true };
    const av2 = await pedidos.avaliarPedido(c, soImagem);
    expect(av2).toMatchObject({ segue: false, codigo: 'limite-justificativa' });
    expect(av2.limites[0]?.mensagem).toContain('mesmo dia');

    // Desativar não apaga: a regra fica, inativa, ligada à liberação já registrada; o pedido passa.
    await limites.desativar(c, 'intervalo', regras.intervalo);
    expect(
      await um('SELECT ativo FROM intervalo_repeticao_exame WHERE id = ?', [regras.intervalo]),
    ).toMatchObject({
      ativo: 0,
    });
    expect(codigoDe(await limites.desativar(c, 'intervalo', regras.intervalo).catch((e: unknown) => e))).toBe(
      'ja-inativa',
    );
    expect((await pedidos.avaliarPedido(c, soImagem)).segue).toBe(true);
  }, 60_000);
});
