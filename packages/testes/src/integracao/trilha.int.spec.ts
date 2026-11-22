// Trilha de auditoria do núcleo sobre o MariaDB real (cliente f22_o5), em transação DESFEITA. Substitui os specs da
// trilha dupla e da cadeia sobre a cópia do sistema de origem (trilha.int.spec.ts e trilha-cadeia.int.spec.ts antigos):
// lá a trilha nova e a antiga eram gravadas lado a lado; aqui há UMA trilha (trilha_auditoria), gravada pelo executor
// na mesma transação da operação. Prova: (1) inclusão e alteração do mesmo registro deixam duas linhas, na ordem, com
// estabelecimento, ação, entidade, id, correlação, a operação, as escritas, o "antes" relido com trava (versão 1) e o
// "depois" (versão 2); (2) a recusa por versão velha não deixa linha; (3) o ROLLBACK leva a trilha junto com a
// gravação; (4) ação fora do vocabulário é recusada pelo núcleo e, por SQL direto, pela restrição do banco.
// Saída só com contagens, ids e códigos; massa sintética (estabelecimento de teste); nada fica no banco.
// Melhoria: o "antes" da alteração é o registro relido sob trava (não um retrato montado pela tela).
// Melhoria: a ação da trilha tem vocabulário fechado nas duas pontas (lista do núcleo e CHECK ck_trilha_auditoria_acao).
// Melhoria: a recusa por conflito de versão não deixa rastro parcial (nem linha, nem trilha).
// Lacuna registrada (saida/05-05.json): a cadeia de integridade da trilha (fecho diário por hash, que detectava evento
// alterado) não tem tabela no modelo; a verificação de integridade fica indisponível até o DDL pedido.
import { gravarTrilha } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alterarEstabelecimento,
  type Ambiente,
  CLIENTE,
  chaveNova,
  codigoDe,
  codigoSintetico,
  contar,
  ctxOperacao,
  desfeito,
  incluirEstabelecimento,
  MARCA,
  num,
  prepararAmbiente,
  SEM_BANCO,
} from './escrita.spec-util.js';

type LinhaLida = {
  id: number;
  estabelecimento_id: number | null;
  acao: string;
  entidade: string;
  entidade_id: number | null;
  correlacao: string | null;
  operacao: string | null;
  escritas: number | null;
  antes_versao: string | null;
  depois_versao: string | null;
};

const LER_TRILHA = `SELECT id, estabelecimento_id, acao, entidade, entidade_id, correlacao,
    JSON_VALUE(dados_depois, '$.operacao') AS operacao,
    JSON_LENGTH(dados_depois, '$.escritas') AS escritas,
    JSON_VALUE(dados_antes, '$.versao') AS antes_versao,
    JSON_VALUE(dados_depois, '$.resultado.versao') AS depois_versao
  FROM trilha_auditoria WHERE correlacao = ? ORDER BY id`;

describe.skipIf(SEM_BANCO)(
  'trilha de auditoria do núcleo no MariaDB (cliente f22_o5, transação desfeita)',
  () => {
    let a: Ambiente;
    beforeAll(async () => {
      a = await prepararAmbiente();
    });
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('inclusão e alteração: duas linhas na ordem, com quem, onde, o quê, o antes relido e o depois', async () => {
      const correlacao = chaveNova('int-trilha');
      const r = await desfeito(a, async (e) => {
        const inc = await a.executor.executar(
          incluirEstabelecimento,
          CLIENTE,
          { codigo: codigoSintetico(), nome: `Hospital ${MARCA}` },
          ctxOperacao(a, { correlacao }),
          { escritor: e },
        );
        const id = num(inc.resultado['id']);
        await a.executor.executar(
          alterarEstabelecimento,
          CLIENTE,
          { id, versao: 1, nome: `Hospital ${MARCA} alterado` },
          ctxOperacao(a, { correlacao }),
          { escritor: e },
        );
        const linhas = await e.consultar<LinhaLida>(LER_TRILHA, [correlacao]);
        return { id, linhas };
      });
      expect(r.linhas).toHaveLength(2);
      const [inclusao, alteracao] = r.linhas;
      expect({
        acao: inclusao?.acao,
        entidade: inclusao?.entidade,
        entidadeId: num(inclusao?.entidade_id),
        estabelecimento: num(inclusao?.estabelecimento_id),
        operacao: inclusao?.operacao,
        escritas: num(inclusao?.escritas),
        antes: inclusao?.antes_versao ?? null,
      }).toEqual({
        acao: 'inclusao',
        entidade: 'estabelecimento',
        entidadeId: r.id,
        estabelecimento: a.estabelecimento,
        operacao: 'teste.nucleo.incluir',
        escritas: 1,
        antes: null,
      });
      expect({
        acao: alteracao?.acao,
        entidadeId: num(alteracao?.entidade_id),
        operacao: alteracao?.operacao,
        antes: num(alteracao?.antes_versao),
        depois: num(alteracao?.depois_versao),
        ordem: num(alteracao?.id) > num(inclusao?.id),
      }).toEqual({
        acao: 'alteracao',
        entidadeId: r.id,
        operacao: 'teste.nucleo.alterar',
        antes: 1,
        depois: 2,
        ordem: true,
      });
    });

    it('a recusa por versão velha não deixa linha nem trilha', async () => {
      const correlacao = chaveNova('int-trilha-recusa');
      const r = await desfeito(a, async (e) => {
        const inc = await a.executor.executar(
          incluirEstabelecimento,
          CLIENTE,
          { codigo: codigoSintetico(), nome: `Hospital ${MARCA}` },
          ctxOperacao(a),
          { escritor: e },
        );
        const id = num(inc.resultado['id']);
        let codigo = 'aceito';
        try {
          await a.executor.executar(
            alterarEstabelecimento,
            CLIENTE,
            { id, versao: 7, nome: `Hospital ${MARCA} velho` },
            ctxOperacao(a, { correlacao }),
            { escritor: e },
          );
        } catch (x) {
          codigo = codigoDe(x);
        }
        return {
          codigo,
          trilha: await contar(e, 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [
            correlacao,
          ]),
          versao: await contar(e, 'SELECT versao AS n FROM estabelecimento WHERE id = ?', [id]),
        };
      });
      expect(r).toEqual({ codigo: 'conflito-versao', trilha: 0, versao: 1 });
    });

    it('o ROLLBACK leva a trilha junto com a gravação', async () => {
      const correlacao = chaveNova('int-trilha-desfeita');
      const dentro = await desfeito(a, async (e) => {
        await a.executor.executar(
          incluirEstabelecimento,
          CLIENTE,
          { codigo: codigoSintetico(), nome: `Hospital ${MARCA}` },
          ctxOperacao(a, { correlacao }),
          { escritor: e },
        );
        return contar(e, 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [correlacao]);
      });
      const depois = await a.nucleo.lerSomente(
        { cliente: CLIENTE, correlacao: 'int-trilha-conferencia' },
        (l) => contar(l, 'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [correlacao]),
      );
      expect({ dentro, depois }).toEqual({ dentro: 1, depois: 0 });
    });

    it('ação fora do vocabulário: o núcleo recusa antes do banco e o banco recusa o SQL direto', async () => {
      const r = await desfeito(a, async (e) => {
        // Metade do núcleo: só conta como recusa a mensagem da lista ACOES_TRILHA (a CHECK do banco daria outro erro)
        // e nada pode ter chegado ao banco.
        let nucleo = 'aceito';
        try {
          await gravarTrilha(e, {
            estabelecimento: a.estabelecimento,
            usuario: null,
            // @ts-expect-error ação fora da lista de propósito
            acao: 'apagar',
            entidade: 'estabelecimento',
            entidadeId: null,
            correlacao: 'int-trilha-acao',
            ocorridoEm: new Date(),
          });
        } catch (x) {
          nucleo = x instanceof Error && x.message === 'Ação de trilha inválida.' ? 'recusado' : 'outro erro';
        }
        const depoisNucleo = await contar(
          e,
          'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?',
          ['int-trilha-acao'],
        );
        // Metade do banco: só a CHECK de vocabulário, pelo nome (nada de curinga que aceite FK ou outra restrição).
        let banco = 'aceito';
        try {
          await e.inserir(
            "INSERT INTO trilha_auditoria (ocorrido_em, acao, entidade, correlacao, criado_em, versao) VALUES (NOW(3), 'apagar', 'estabelecimento', 'int-trilha-acao', NOW(3), 1)",
          );
        } catch (x) {
          banco = /ck_trilha_auditoria_acao/.test(String(x)) ? 'recusado' : 'outro erro';
        }
        return { nucleo, depoisNucleo, banco };
      });
      expect(r).toEqual({ nucleo: 'recusado', depoisNucleo: 0, banco: 'recusado' });
    });
  },
);
