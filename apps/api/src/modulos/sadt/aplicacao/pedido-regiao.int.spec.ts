// Contrato de efeito da região anatômica no pedido do exame (F8, 09-AREA linha 84, C2-032) no MariaDB real (cliente de
// teste; massa SINTÉTICA). Prova o que fica no banco: o exame pedido sem região grava a região padrão do exame em
// exame_item.regiao_anatomica_codificada_id; a região escolhida entre as admitidas é gravada; a região não ligada ao
// exame, ou já retirada dele, é recusada sem gravar nada; o exame sem região ligada fica com a coluna nula. Saída só com
// contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const CORR = { cliente: CLIENTE, correlacao: 't-c2032p' };
const SISTEMA = 'c2032p';

describe.skipIf(SEM_BANCO)('região anatômica no pedido do exame (MariaDB, cliente de teste)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoPedidoSadt;
  let m: MassaSadt | null = null;
  const reg = { mao: 0, punho: 0, retirada: 0, solta: 0 };
  const regiaoDoItem = async (item: number) =>
    nucleo.lerSomente(CORR, async (l) => {
      const r = await l.uma('SELECT regiao_anatomica_codificada_id AS r FROM exame_item WHERE id = ?', [
        item,
      ]);
      return r?.['r'] === null || r?.['r'] === undefined ? null : Number(r['r']);
    });
  const itensDoPedido = () =>
    nucleo.lerSomente(CORR, async (l) =>
      Number(
        (
          await l.uma(
            `SELECT COUNT(*) AS n FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
              WHERE r.atendimento_id = ?`,
            [m!.base.atendimento],
          )
        )?.['n'] ?? 0,
      ),
    );
  const pedir = (exame: number, regiao: number | null) =>
    servico.abrirPedido(contexto(m!), {
      atendimento: m!.base.atendimento,
      setor: exame === m!.exameImagem ? m!.setorImagem : m!.setorLab,
      exames: [{ exame, regiao }],
      confirmado: true,
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'C2R');
    servico = new ServicoPedidoSadt(nucleo);
    await nucleo.escrever(CORR, async (e) => {
      const agora = new Date();
      const regiao = (codigo: string) =>
        e.inserir(
          `INSERT INTO regiao_anatomica_codificada (sistema_codificacao, nivel, codigo_anatomico, descricao,
             regiao_superior_id, ativo, criado_em) VALUES (?, 'regiao', ?, ?, NULL, TRUE, ?)`,
          [SISTEMA, `${m!.marca}${codigo}`, `REGIAO SINTETICA ${codigo}`, agora],
        );
      reg.mao = await regiao('MAO');
      reg.punho = await regiao('PUNHO');
      reg.retirada = await regiao('RET');
      reg.solta = await regiao('SOLTA');
      const ligar = (r: number, padrao: boolean, ativo: boolean) =>
        e.inserir(
          `INSERT INTO exame_regiao_anatomica (exame_id, regiao_anatomica_codificada_id, padrao, ativo, desativado_em,
             criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
          [m!.exameImagem, r, padrao, ativo, ativo ? null : agora, agora],
        );
      await ligar(reg.mao, true, true);
      await ligar(reg.punho, false, true);
      await ligar(reg.retirada, false, false);
    });
  });

  afterAll(async () => {
    if (m) {
      await nucleo.escrever(CORR, async (e) => {
        await e.executar(
          `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id = ?`,
          [m!.base.est],
        );
        await e.executar(
          `UPDATE exame_item SET regiao_anatomica_codificada_id = NULL WHERE regiao_anatomica_codificada_id IN
             (SELECT id FROM regiao_anatomica_codificada WHERE sistema_codificacao = ?)`,
          [SISTEMA],
        );
        await e.executar(
          `DELETE x FROM exame_regiao_anatomica x JOIN regiao_anatomica_codificada r
              ON r.id = x.regiao_anatomica_codificada_id WHERE r.sistema_codificacao = ?`,
          [SISTEMA],
        );
        await e.executar('DELETE FROM regiao_anatomica_codificada WHERE sistema_codificacao = ?', [SISTEMA]);
      });
      await limparMassaSadt(nucleo, m);
    }
    await nucleo.encerrar();
  });

  it('sem região vale a padrão; a escolhida entre as admitidas é gravada; exame sem região fica nulo', async () => {
    const padrao = await pedir(m!.exameImagem, null);
    expect(await regiaoDoItem(padrao.itens[0]!.id)).toBe(reg.mao);
    const escolhida = await pedir(m!.exameImagem, reg.punho);
    expect(await regiaoDoItem(escolhida.itens[0]!.id)).toBe(reg.punho);
    const lab = await pedir(m!.exameLab, null);
    expect(await regiaoDoItem(lab.itens[0]!.id)).toBeNull();
  });

  it('região retirada do exame, não ligada a ele ou pedida num exame sem região é recusada sem gravar', async () => {
    const antes = await itensDoPedido();
    for (const [exame, regiao] of [
      [m!.exameImagem, reg.retirada],
      [m!.exameImagem, reg.solta],
      [m!.exameLab, reg.mao],
    ] as const) {
      const e = await pedir(exame, regiao).catch((x: unknown) => x);
      expect(codigoDe(e)).toBe('regiao-nao-admitida');
    }
    expect(await itensDoPedido()).toBe(antes);
  });
});
