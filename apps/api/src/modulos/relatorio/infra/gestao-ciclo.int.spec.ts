// W0-09 na cópia (transação desfeita): o ciclo do pedido de relatório e do envio agendado nas tabelas SGH_ (1121):
// corrigir o pedido aberto, a recusa depois da resposta, o cancelamento com motivo (CHECK do banco), a exclusão só do
// nunca atendido com o log no SGH_REL_EVENTO, e o envio que já rodou recusado pelo mapa de dependências
// (packages/legado: dependencias-relatorio.ts), conferido contra as FKs declaradas no catálogo do banco. Só contagens
// e códigos na saída.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  DEPENDENCIAS_RELATORIO,
  fksParaRelatorio,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaRelatorioNaTransacao } from '../porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;
const ctx = () => ({ rede: nucleo.rede, hospital: cod, traceId: 'int-w009-relatorio' });

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

const trilha = (recurso: string, op: string, tabela: string) => ({
  rede: nucleo.rede,
  hospital: cod,
  usuario: 'SGH.TESTE',
  evento: recurso === 'relatorio.pedido' ? 'relatorio.pedido.registrado' : 'relatorio.agendamento.alterado',
  recurso,
  operacao: op,
  tabelaAlvo: tabela,
  idAlvo: null,
  chaveNaturalAlvo: null,
  resultado: 'sucesso' as const,
  estacao: 'int-w009',
  correlacao: 'int-w009-relatorio',
});
const PEDIDO = {
  titulo: 'Pedido de teste W0-09',
  descricao: 'Descricao sintetica do pedido de teste do W0-09 com colunas e totais.',
  finalidade: 'Teste de integracao',
  area: 'Teste',
  prazo: '2099-12-31',
};

describe.skipIf(!PODE)('pedido e envio agendado: ciclo na cópia (W0-09; desfeito no fim)', () => {
  it('o mapa de dependências cobre todas as FKs declaradas para SGH_REL_PEDIDO e SGH_REL_AGENDAMENTO', async () => {
    await nucleo.lerSomente(ctx(), async (l) => {
      for (const alvo of ['pedido', 'agendamento'] as const) {
        const fks = await fksParaRelatorio(l, alvo);
        const mapa = DEPENDENCIAS_RELATORIO.filter((d) => d.alvo === alvo && d.origem === 'fk');
        expect(fks.map((f) => `${f.tabela}.${f.coluna}`).sort()).toEqual(
          mapa.map((d) => `${d.tabela}.${d.coluna}`).sort(),
        );
      }
    });
  });

  it('pedido: corrige o aberto, cancela com motivo, exclui só o nunca atendido (com log)', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaRelatorioNaTransacao(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const t = (op: string) => trilha('relatorio.pedido', op, 'SGH_REL_PEDIDO');
      const id = await porta.gravarSgh(c, t('criar'), (g) => g.criarPedido(PEDIDO, 'SGH.TESTE'));
      expect(await porta.dependencias(c, 'pedido', id)).toEqual([]);
      expect(
        await porta.gravarSgh(c, t('alterar'), (g) =>
          g.alterarPedido(id, { ...PEDIDO, titulo: 'Pedido corrigido W0-09' }, 'SGH.TESTE'),
        ),
      ).toBe(1);
      await porta.gravarSgh(c, t('alterar'), (g) =>
        g.registrarEvento(
          { alvo: 'pedido', id, evento: 'alteracao', antes: { titulo: PEDIDO.titulo }, motivo: 'Correcao' },
          'SGH.TESTE',
        ),
      );
      expect((await porta.pedido(c, id))?.titulo).toBe('Pedido corrigido W0-09');
      // Revisão: a linha anterior relida na transação, com trava (WITH LOCK), é a vigente.
      expect((await porta.gravarSgh(c, t('alterar'), (g) => g.lerPedidoTravado(id)))?.titulo).toBe(
        'Pedido corrigido W0-09',
      );
      // O curador responde: não se edita nem se exclui mais; o mapa mostra a resposta.
      await porta.gravarSgh(c, t('responder'), (g) =>
        g.responderPedido(
          id,
          { situacao: 'em-analise', relatorio: null, resposta: 'Em analise' },
          'SGH.TESTE',
        ),
      );
      expect(await porta.gravarSgh(c, t('alterar'), (g) => g.alterarPedido(id, PEDIDO, 'SGH.TESTE'))).toBe(0);
      expect(await porta.gravarSgh(c, t('excluir'), (g) => g.excluirPedido(id))).toBe(0);
      expect(await porta.dependencias(c, 'pedido', id)).toEqual([
        { grupo: 'resposta do curador', quantidade: 1, origem: 'logica' },
      ]);
      // Cancelar com motivo; o CHECK do banco exige motivo e quem.
      expect(
        await porta.gravarSgh(c, t('cancelar'), (g) => g.cancelarPedido(id, 'Prioridade mudou', 'SGH.TESTE')),
      ).toBe(1);
      const p = await porta.pedido(c, id);
      expect(p).toMatchObject({
        situacao: 'em-analise',
        canceladoPor: 'SGH.TESTE',
        motivoCancelamento: 'Prioridade mudou',
      });
      expect(
        await porta.gravarSgh(c, t('cancelar'), (g) => g.cancelarPedido(id, 'De novo', 'SGH.TESTE')),
      ).toBe(0);
      // O nunca atendido: exclui, e o evento (log) fica com a linha anterior.
      const id2 = await porta.gravarSgh(c, t('criar'), (g) => g.criarPedido(PEDIDO, 'SGH.TESTE'));
      await porta.gravarSgh(c, t('excluir'), async (g) => {
        await g.registrarEvento(
          { alvo: 'pedido', id: id2, evento: 'exclusao', antes: PEDIDO, motivo: 'Feito por engano' },
          'SGH.TESTE',
        );
        expect(await g.excluirPedido(id2)).toBe(1);
      });
      expect(await porta.pedido(c, id2)).toBeNull();
      const ev = await porta.eventos(c, 'pedido', id2);
      expect(ev.map((x) => x.evento)).toEqual(['exclusao']);
      expect(JSON.parse(ev[0]?.antes ?? '{}')).toMatchObject({ titulo: PEDIDO.titulo });
      expect((await porta.eventos(c, 'pedido', id)).map((x) => x.evento)).toEqual(['alteracao']);
    });
  });

  it('o CHECK do banco recusa o cancelamento sem motivo e o do pedido já respondido (publicado ou recusado)', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaRelatorioNaTransacao(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const id = await porta.gravarSgh(c, trilha('relatorio.pedido', 'criar', 'SGH_REL_PEDIDO'), (g) =>
        g.criarPedido(PEDIDO, 'SGH.TESTE'),
      );
      await expect(
        e.executar(
          "UPDATE SGH_REL_PEDIDO SET CANCELADO_EM = CURRENT_TIMESTAMP, CANCELADO_POR = 'SGH.TESTE' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)",
          [id],
        ),
      ).rejects.toThrow();
      // Revisão: o pedido já respondido como 'publicado' (executado) ou 'recusado'. A exclusão é recusada (0) com o
      // mapa listando a resposta do curador; o cancelamento pela porta é recusado (0); e o UPDATE direto, com
      // CANCELADO_EM/POR/MOTIVO completos, é rejeitado pelo CHECK SGH_CK_REL_PEDIDO_CANCELA (SITUACAO aberta).
      for (const resposta of [
        { situacao: 'publicado', relatorio: 'censo-diario', resposta: 'Publicado no catalogo' },
        { situacao: 'recusado', relatorio: null, resposta: 'Fora do escopo' },
      ]) {
        const t = (op: string) => trilha('relatorio.pedido', op, 'SGH_REL_PEDIDO');
        const idR = await porta.gravarSgh(c, t('criar'), (g) => g.criarPedido(PEDIDO, 'SGH.TESTE'));
        expect(
          await porta.gravarSgh(c, t('responder'), (g) => g.responderPedido(idR, resposta, 'SGH.TESTE')),
        ).toBe(1);
        expect((await porta.pedido(c, idR))?.situacao).toBe(resposta.situacao);
        expect(await porta.gravarSgh(c, t('excluir'), (g) => g.excluirPedido(idR))).toBe(0);
        expect(await porta.pedido(c, idR)).not.toBeNull();
        expect(await porta.dependencias(c, 'pedido', idR)).toEqual([
          { grupo: 'resposta do curador', quantidade: 1, origem: 'logica' },
        ]);
        expect(
          await porta.gravarSgh(c, t('cancelar'), (g) =>
            g.cancelarPedido(idR, 'Prioridade mudou', 'SGH.TESTE'),
          ),
        ).toBe(0);
        await expect(
          e.executar(
            `UPDATE SGH_REL_PEDIDO SET CANCELADO_EM = CURRENT_TIMESTAMP, CANCELADO_POR = 'SGH.TESTE',
               MOTIVO_CANCELAMENTO = 'Cancelamento direto' WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [idR],
          ),
        ).rejects.toThrow(/SGH_CK_REL_PEDIDO_CANCELA/);
      }
    });
  });

  it('envio: o que rodou é recusado pelo mapa (execução pela FK); o que nunca rodou se exclui com log', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaRelatorioNaTransacao(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const t = (op: string) => trilha('relatorio.agendamento', op, 'SGH_REL_AGENDAMENTO');
      const novo = (titulo: string) =>
        porta.gravarSgh(c, t('criar'), (g) =>
          g.criarAgendamento(
            {
              relatorio: 'atendimentosPorDia',
              titulo,
              parametros: { inicio: 'ontem', fim: 'ontem' },
              grupos: [],
              enderecos: ['teste@exemplo.invalid'],
              periodicidade: 'diaria',
              hora: 700,
              diaSemana: null,
              diaMes: null,
            },
            'SGH.TESTE',
            new Date('2099-01-01T07:00:00Z'),
          ),
        );
      const rodou = await novo('Envio que rodou');
      await porta.gravarSgh(c, t('enviar'), (g) =>
        g.registrarExecucao({
          relatorio: 'atendimentosPorDia',
          tipo: 'envio',
          formato: 'link',
          usuario: 'SGH.TESTE',
          parametros: '{}',
          linhas: 0,
          duracaoMs: 0,
          dadoPessoal: false,
          mascarado: true,
          justificativa: null,
          situacao: 'ok',
          agendamento: rodou,
        }),
      );
      expect(await porta.dependencias(c, 'agendamento', rodou)).toEqual([
        { grupo: 'envios e execuções registrados', quantidade: 1, origem: 'fk' },
      ]);
      expect(await porta.gravarSgh(c, t('excluir'), (g) => g.excluirAgendamento(rodou))).toBe(0);
      expect(await porta.agendamento(c, rodou)).not.toBeNull();
      expect((await porta.gravarSgh(c, t('alterar'), (g) => g.lerAgendamentoTravado(rodou)))?.relatorio).toBe(
        (await porta.agendamento(c, rodou))?.relatorio,
      );

      const engano = await novo('Envio por engano');
      expect(await porta.dependencias(c, 'agendamento', engano)).toEqual([]);
      await porta.gravarSgh(c, t('excluir'), async (g) => {
        await g.registrarEvento(
          {
            alvo: 'agendamento',
            id: engano,
            evento: 'exclusao',
            antes: { titulo: 'Envio por engano' },
            motivo: 'Engano',
          },
          'SGH.TESTE',
        );
        expect(await g.excluirAgendamento(engano)).toBe(1);
      });
      expect(await porta.agendamento(c, engano)).toBeNull();
      expect((await porta.eventos(c, 'agendamento', engano)).map((x) => x.evento)).toEqual(['exclusao']);
    });
  });
});
