// W0-09 na cópia (transação desfeita): o ciclo de vida dos registros da implantação nas tabelas SGH_ (script 1122).
// O mapa de dependências da versão da trilha (packages/legado: dependencias-coexistencia.ts) confere com as FKs
// declaradas no catálogo do banco; a versão com conclusões é recusada (409 com a contagem) e inativada; a sem vínculo é
// excluída com o retrato na SGH_HIST_EXCLUSAO e a anterior volta a vigente; a conclusão estornada fica na tabela e sai
// da leitura; o item do critério e o da checklist do desligamento voltam a pendente (CHECK do banco) com o evento na
// SGH_CRUD_EVENTO. Só contagens e códigos na saída.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  DEPENDENCIAS_TRILHA_COEX,
  exigirTravaDaCopia,
  fksParaTrilhaCoex,
  lerConclusoesTreino,
  lerConfiguracaoNucleo,
  lerItensDesligamento,
  lerItensLigar,
  lerTrilhasCoex,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoCicloCoex } from './aplicacao/ciclo.js';
import { portaCoexistenciaNaTransacao } from './porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  FB_POOL_TETO: '2',
};

let nucleo: NucleoLegado;
let hospital = '';

beforeAll(async () => {
  exigirTravaDaCopia();
  nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const saude = await nucleo.partida();
  hospital = saude.find((s) => s.disponivel)?.codigo ?? '';
  if (!hospital) throw new Error('Nenhum estabelecimento da cópia disponível.');
});
afterAll(async () => {
  await nucleo?.encerrar();
});

const sessao = (): SessaoCadastro =>
  ({
    req: { headers: {}, ip: '127.0.0.1' },
    porta: { rede: nucleo.rede, hospital },
    rede: nucleo.rede,
    hospital,
    login: 'SGH.TESTE',
    pode: () => true,
  }) as unknown as SessaoCadastro;
const ctx = () => ({ rede: nucleo.rede, hospital, traceId: 'integracao-w009-coex' });
const linha = (tabela: string) => ({
  rede: nucleo.rede,
  hospital,
  usuario: 'SGH.TESTE',
  evento: 'coexistencia.treino.registrado',
  recurso: 'config.coexistencia',
  operacao: 'int-w009',
  tabelaAlvo: tabela,
  idAlvo: null,
  chaveNaturalAlvo: null,
  resultado: 'sucesso' as const,
  estacao: 'int-w009',
  correlacao: 'int-w009-coex',
});
async function erroDe(
  p: Promise<unknown>,
): Promise<{ status: number; codigo: string | undefined; extras: unknown }> {
  try {
    await p;
  } catch (e) {
    const x = e as { getStatus?: () => number; extras?: { codigo?: string } };
    return { status: x.getStatus?.() ?? 0, codigo: x.extras?.codigo, extras: x.extras };
  }
  throw new Error('esperava a recusa');
}

describe('W0-09: ciclo de vida da implantação na cópia (desfeito no fim)', () => {
  it('o mapa de dependências cobre as FKs declaradas para SGH_CFG_COEX_TRILHA', async () => {
    await nucleo.lerSomente(ctx(), async (l) => {
      const fks = await fksParaTrilhaCoex(l);
      const mapa = DEPENDENCIAS_TRILHA_COEX.filter((d) => d.origem === 'fk');
      expect(fks.map((f) => `${f.tabela}(${f.colunas.join(',')})`).sort()).toEqual(
        mapa.map((d) => `${d.tabela}(${d.colunas.join(',')})`).sort(),
      );
    });
  });

  it('versão: recusa com a contagem, estorno, exclusão com retrato, inativação; itens voltam a pendente', async () => {
    const r = await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const porta = portaCoexistenciaNaTransacao(e);
      const c = { rede: nucleo.rede, hospital };
      const s = new ServicoCicloCoex(porta);
      const conta = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? 0);
      const papel = 'recepcao';
      const onda = 5;
      const publicar = () =>
        porta.gravarSgh(c, linha('SGH_CFG_COEX_TRILHA'), (g) =>
          g.publicarTrilha(
            {
              papel,
              onda,
              nome: 'Trilha W0-09',
              carga: '1h',
              tarefas: ['t1'],
              exercicio: 'Exercicio sintetico',
            },
            'SGH.TESTE',
          ),
        );
      const v1 = (await publicar()).versao;
      await porta.gravarSgh(c, linha('SGH_CFG_COEX_TREINO'), (g) =>
        g.registrarConclusoes(
          {
            pessoas: [
              { id: 999_999_901, login: 'SGH.INT.A' },
              { id: 999_999_902, login: 'SGH.INT.B' },
            ],
            papel,
            onda,
            versao: v1,
            turma: 'T-INT-W009',
            turno: null,
            concluidoEm: '2026-11-18',
            resultado: 'aprovado',
          },
          'SGH.TESTE',
        ),
      );
      // Revisão: segunda turma (2 turmas, 5 conclusões): o total é 5 (as turmas agrupam as mesmas linhas).
      await porta.gravarSgh(c, linha('SGH_CFG_COEX_TREINO'), (g) =>
        g.registrarConclusoes(
          {
            pessoas: [
              { id: 999_999_903, login: 'SGH.INT.C' },
              { id: 999_999_904, login: 'SGH.INT.D' },
              { id: 999_999_905, login: 'SGH.INT.E' },
            ],
            papel,
            onda,
            versao: v1,
            turma: 'T-INT-W009-B',
            turno: null,
            concluidoEm: '2026-11-18',
            resultado: 'aprovado',
          },
          'SGH.TESTE',
        ),
      );
      const recusa = await erroDe(
        s.retirarVersaoTrilha(sessao(), papel, String(onda), String(v1), { motivo: 'Teste de integracao' }),
      );
      // Estorno: a conclusão fica na tabela e sai da leitura.
      const minhas = (await lerConclusoesTreino(e, hospital)).filter(
        (x) => x.turma === 'T-INT-W009' && x.versao === v1,
      );
      await s.estornarConclusao(sessao(), minhas[0]!.id, { motivo: 'Estorno de teste' });
      const depoisEstorno = (await lerConclusoesTreino(e, hospital)).filter(
        (x) => x.turma === 'T-INT-W009',
      ).length;
      const naTabela = await conta(
        `SELECT COUNT(*) N FROM SGH_CFG_COEX_TREINO WHERE HOSPITAL = ? AND TURMA = ?`,
        [hospital, 'T-INT-W009'],
      );
      const estornoRepetido = await erroDe(
        s.estornarConclusao(sessao(), minhas[0]!.id, { motivo: 'Estorno de teste' }),
      );
      // A versão nova, sem vínculo: exclusão com retrato; a anterior volta a vigente.
      const v2 = (await publicar()).versao;
      const retratosAntes = await conta(
        `SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO WHERE HOSPITAL = ? AND TABELA = 'SGH_CFG_COEX_TRILHA'`,
        [hospital],
      );
      const exc = await s.retirarVersaoTrilha(sessao(), papel, String(onda), String(v2), {
        motivo: 'Versao publicada por engano',
      });
      const retratos =
        (await conta(
          `SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO WHERE HOSPITAL = ? AND TABELA = 'SGH_CFG_COEX_TRILHA'`,
          [hospital],
        )) - retratosAntes;
      const ina = await s.retirarVersaoTrilha(sessao(), papel, String(onda), String(v1), {
        motivo: 'Inativar a versao com historia',
        inativar: true,
      });
      const versoes = (await lerTrilhasCoex(e, hospital))
        .filter((t) => t.papel === papel && t.onda === onda)
        .map((t) => `${t.versao}:${t.situacao}`);
      // Revisão: publicar depois da exclusão não reaproveita o número da versão excluída (retrato e evento dela).
      const v3 = (await publicar()).versao;
      // Item do critério e da checklist do desligamento.
      await porta.gravarSgh(c, linha('SGH_CFG_COEX_LIGAR'), (g) =>
        g.gravarItensLigar(
          'agendamento',
          [{ item: 'tvs', situacao: 'cumprido', evidencia: 'chamado 123', em: '2026-11-18' }],
          'SGH.TESTE',
        ),
      );
      await s.voltarItemCriterioPendente(sessao(), 'agendamento', 'tvs', { motivo: 'Evidencia errada' });
      const ligar = (await lerItensLigar(e, hospital)).find(
        (x) => x.setor === 'agendamento' && x.item === 'tvs',
      );
      await porta.gravarSgh(c, linha('SGH_CFG_COEX_DESLIG'), (g) =>
        g.gravarItemDesligamento(
          {
            item: 'paineis-tv',
            situacao: 'aceito-como-perdido',
            contingencia: 'nenhuma',
            papelResponsavel: 'TI do hospital',
            evidencia: 'ata do teste',
          },
          'SGH.TESTE',
        ),
      );
      await s.voltarItemDesligamentoPendente(sessao(), 'paineis-tv', {
        motivo: 'Aceite registrado no item errado',
        senha: 'x',
      });
      const deslig = (await lerItensDesligamento(e, hospital)).find((x) => x.item === 'paineis-tv');
      const eventos = await e.consultar(
        `SELECT EVENTO, TABELA FROM SGH_CRUD_EVENTO WHERE HOSPITAL = ? AND CRIADO_POR = 'SGH.TESTE'
           AND TABELA STARTING WITH 'SGH_CFG_COEX_' ORDER BY ID`,
        [hospital],
        { teto: 50 },
      );
      return {
        recusa: {
          status: recusa.status,
          codigo: recusa.codigo,
          total: (recusa.extras as { total?: number }).total,
          dependentes: (
            recusa.extras as { dependentes?: { rotulo: string; quantidade: number }[] }
          ).dependentes?.map((x) => `${x.rotulo}:${x.quantidade}`),
        },
        depoisEstorno,
        naTabela,
        estornoRepetido: estornoRepetido.codigo,
        exc,
        retratos,
        ina: ina.resultado,
        versoes,
        v2,
        v3,
        ligar: ligar?.situacao,
        deslig: deslig?.situacao,
        eventos: eventos.map((x) => `${String(x['EVENTO']).trim()}:${String(x['TABELA']).trim()}`),
      };
    });
    expect(r.recusa).toEqual({
      status: 409,
      codigo: 'trilha-com-vinculos',
      total: 5,
      dependentes: ['turmas:2', 'conclusões de treinamento:5'],
    });
    expect(r.depoisEstorno).toBe(1);
    expect(r.naTabela).toBe(2);
    expect(r.estornoRepetido).toBe('conclusao-ja-estornada');
    expect(r.exc).toMatchObject({ resultado: 'excluida', promovida: expect.any(Number) });
    expect(r.retratos).toBe(1);
    expect(r.ina).toBe('inativada');
    expect(r.versoes.at(-1)).toMatch(/:retirada$/);
    expect(r.v3).toBe(r.v2 + 1);
    expect(r.ligar).toBe('pendente');
    expect(r.deslig).toBe('pendente');
    expect(r.eventos).toEqual([
      'inativado:SGH_CFG_COEX_TREINO',
      'excluido:SGH_CFG_COEX_TRILHA',
      'inativado:SGH_CFG_COEX_TRILHA',
      'alterado:SGH_CFG_COEX_LIGAR',
      'alterado:SGH_CFG_COEX_DESLIG',
    ]);
  });
});
