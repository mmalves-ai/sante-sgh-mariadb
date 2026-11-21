// Integração da porta própria da expiração das reservas do NIR sobre o MariaDB real (cliente f22_o5; lote F2.2 05-15):
// só a vencida do estabelecimento aparece; expira uma vez (situação expirada, versão 2, encerrada_em, trilha); a
// solicitação reservada volta à análise e solta a reserva; a segunda expiração não altera nada; dois consumidores ao
// mesmo tempo expiram uma vez só; a reserva de outro estabelecimento é recusada. Massa sintética com as chaves
// estrangeiras desligadas só na montagem; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENTE, escrever, garantirCliente, garantirEstabelecimento, inserirSintetico, SEM_BANCO } from './importadores/integracao.spec-util.js';
import { PortaNirPropria } from './nir-reserva-propria.js';
import { cicloExpiracao } from './nir-reserva.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

describe.skipIf(SEM_BANCO)('expiração das reservas sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let outro: AlvoEstabelecimento;
  const ids = { pedido: 0, vencida: 0, valida: 0, disputa: 0, alheia: 0 };
  const situacoes: number[] = [];

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      for (const id of [est?.id, outro?.id].filter(Boolean)) {
        await e.executar('DELETE FROM reserva_leito WHERE estabelecimento_id = ?', [id]);
        await e.executar('DELETE FROM pedido_leito WHERE estabelecimento_id = ?', [id]);
      }
      await e.executar("DELETE FROM situacao_pedido_leito WHERE codigo LIKE 'F515%'");
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const a = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515n'));
    const b = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515m'));
    est = { cliente: CLIENTE, id: a, codigo: 'f515n', fuso: 'America/Sao_Paulo' };
    outro = { cliente: CLIENTE, id: b, codigo: 'f515m', fuso: 'America/Sao_Paulo' };
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      for (const [codigo, estado, ordem] of [
        ['F515RES', 'reservado', 9001],
        ['F515ANA', 'em_analise', 0],
      ] as const)
        situacoes.push(
          await inserirSintetico(e, 'situacao_pedido_leito', {
            codigo,
            descricao: `Sintética ${estado}`,
            estado,
            ordem_exibicao: ordem,
            criado_em: agora,
          }),
        );
      ids.pedido = await inserirSintetico(e, 'pedido_leito', {
        estabelecimento_id: a,
        numero: 'F515-1',
        paciente_id: 9_905_150,
        setor_origem: 'internacao',
        solicitante_profissional_id: 9_905_150,
        data_hora_pedido: new Date(agora.getTime() - 3 * 3_600_000),
        situacao_pedido_leito_id: situacoes[0],
        criado_em: agora,
      });
      const reserva = (estabelecimento: number, leito: number, pedido: number | null, validaAte: Date) =>
        inserirSintetico(e, 'reserva_leito', {
          estabelecimento_id: estabelecimento,
          leito_hospitalar_id: leito,
          pedido_leito_id: pedido,
          paciente_id: 9_905_150,
          reservado_em: new Date(validaAte.getTime() - 3_600_000),
          valida_ate: validaAte,
          situacao: 'ativa',
          criado_em: agora,
        });
      const passado = new Date(agora.getTime() - 3_600_000);
      ids.vencida = await reserva(a, 9_905_151, ids.pedido, passado);
      ids.valida = await reserva(a, 9_905_152, null, new Date(agora.getTime() + 3_600_000));
      ids.disputa = await reserva(a, 9_905_153, null, passado);
      ids.alheia = await reserva(b, 9_905_154, null, passado);
      await e.executar('UPDATE pedido_leito SET reserva_leito_id = ? WHERE id = ?', [ids.vencida, ids.pedido]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  it('só as vencidas do estabelecimento aparecem', async () => {
    const porta = new PortaNirPropria(nucleo, CLIENTE);
    const v = (await porta.vencidas(est, new Date())).map((x) => x.id);
    expect(v).toContain(ids.vencida);
    expect(v).toContain(ids.disputa);
    expect(v).not.toContain(ids.valida);
    expect(v).not.toContain(ids.alheia);
  });

  it('expira uma vez, a solicitação volta à análise e solta a reserva; a segunda não altera nada', async () => {
    const porta = new PortaNirPropria(nucleo, CLIENTE);
    expect(await porta.expirar(est, ids.vencida, new Date())).toEqual({ expirou: true, voltouAnalise: true });
    const r = await escrever(nucleo, (e) =>
      e.uma('SELECT situacao, versao, encerrada_em FROM reserva_leito WHERE id = ?', [ids.vencida]),
    );
    expect(r).toMatchObject({ situacao: 'expirada', versao: 2 });
    expect(r!['encerrada_em']).not.toBeNull();
    const p = await escrever(nucleo, (e) =>
      e.uma(
        'SELECT sp.estado, pl.reserva_leito_id, pl.versao FROM pedido_leito pl JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id WHERE pl.id = ?',
        [ids.pedido],
      ),
    );
    expect(p).toMatchObject({ estado: 'em_analise', reserva_leito_id: null, versao: 2 });
    const t = await escrever(nucleo, (e) =>
      e.uma("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'reserva_leito' AND entidade_id = ?", [ids.vencida]),
    );
    expect(Number(t!['n'])).toBe(1);
    expect(await porta.expirar(est, ids.vencida, new Date())).toEqual({ expirou: false, voltouAnalise: false });
  });

  it('dois consumidores ao mesmo tempo: uma expiração só', async () => {
    const [x, y] = await Promise.all([
      new PortaNirPropria(nucleo, CLIENTE).expirar(est, ids.disputa, new Date()),
      new PortaNirPropria(nucleo, CLIENTE).expirar(est, ids.disputa, new Date()),
    ]);
    expect([x.expirou, y.expirou].filter(Boolean)).toHaveLength(1);
    const r = await escrever(nucleo, (e) => e.uma('SELECT versao FROM reserva_leito WHERE id = ?', [ids.disputa]));
    expect(Number(r!['versao'])).toBe(2);
  });

  it('a reserva de outro estabelecimento é recusada; o ciclo do outro não vê a deste', async () => {
    const porta = new PortaNirPropria(nucleo, CLIENTE);
    await expect(porta.expirar(est, ids.alheia, new Date())).rejects.toThrow(/outro estabelecimento/);
    expect(await cicloExpiracao(porta, est, new Date())).toMatchObject({ expiradas: 0 });
  });
});
