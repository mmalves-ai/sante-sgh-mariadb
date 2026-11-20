// Regras 7 e 8 (M34) na cópia, em transação DESFEITA: o efeito externo só pela outbox, na MESMA transação do fato (o
// parceiro e o evento de teste entram juntos; o ponto de salvamento desfeito leva os dois: a transação que falha não
// deixa evento); a entrega é idempotente pela chave do evento (a unicidade do banco recusa a segunda); a entrada é
// deduplicada pela chave do parceiro (a repetida devolve a primeira); a outbox nunca recebe o que um gatilho já envia
// (o serviço recusa o evento dos gatilhos no parceiro). Privacidade: o CPF, o nome e o texto clínico injetados na
// mensagem não aparecem nas SGH_INTG_* nem na trilha. Só contagens no log.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  chaveEvento,
  type Escritor,
  fonteCatalogoArquivo,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemConteudoMemoria } from './armazem-conteudo.js';
import { ServicoEntrada } from '../aplicacao/receber.js';
import { novaCredencial, resumoDoSegredo } from '../aplicacao/credencial.js';
import { portaIntegracaoNaTransacao } from '../porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;
const ctx = () => ({ rede: nucleo.rede, hospital: cod, traceId: 'int-m34-outbox' });

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

const trilha = (op: string) => ({
  rede: 'x',
  hospital: 'x',
  usuario: 'SGH.TESTE',
  evento: 'integracao.parceiro.alterado',
  recurso: 'integracao.parceiro',
  operacao: op,
  tabelaAlvo: 'SGH_INTG_PARCEIRO',
  idAlvo: null,
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: 'int-m34',
  correlacao: 'int-m34-outbox',
});

const PARCEIRO = {
  codigo: 'int-teste-m34',
  nome: 'Parceiro de integração (teste)',
  tipo: 'apoio',
  canal: 'oie-apoio-orm',
  escopos: ['resultado.enviar'],
  eventos: ['integracao.teste'],
  limiteTentativas: 3,
  finalidade: 'Teste de integração do marco.',
  baseLegal: 'tutela-da-saude',
};

async function porta(e: Escritor) {
  const executor = nucleo.criarExecutor({
    catalogo: fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo')),
  });
  return portaIntegracaoNaTransacao(e, executor);
}

describe.skipIf(!PODE)('outbox, idempotência e entrada na cópia (regras 7 e 8)', () => {
  it('o fato e o evento na mesma transação; o ponto desfeito leva os dois juntos', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const p = await porta(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const chave = `fato:integracao.teste:${cod}:int-1:sem-carimbo`;
      await e.executar('SAVEPOINT M34_FALHA');
      await p.gravarSgh(c, trilha('criar'), async (g) => {
        await g.criarParceiro(PARCEIRO, 'SGH.TESTE');
        await g.outbox({ tipo: 'integracao.teste', chave, carga: { parceiro: PARCEIRO.codigo } });
      });
      const conta = async () => {
        const [x] = await e.consultar(
          `SELECT (SELECT COUNT(*) FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?) O,
                  (SELECT COUNT(*) FROM SGH_INTG_PARCEIRO WHERE HOSPITAL = ? AND CODIGO = ?) P FROM RDB$DATABASE`,
          [chaveEvento(chave), cod, PARCEIRO.codigo],
          { teto: 1 },
        );
        return { outbox: Number(x?.['O']), parceiro: Number(x?.['P']) };
      };
      expect(await conta()).toEqual({ outbox: 1, parceiro: 1 });
      // A "falha" depois do fato: desfeito o ponto, nem o fato nem o evento ficam.
      await e.executar('ROLLBACK TO SAVEPOINT M34_FALHA');
      expect(await conta()).toEqual({ outbox: 0, parceiro: 0 });
    });
  });

  it('a mesma entrega não cria outra mensagem (a unicidade do banco); a entrada repetida devolve a primeira', async () => {
    await nucleo.desfazendoNaCopia(ctx(), async (e) => {
      const p = await porta(e);
      const c = { rede: nucleo.rede, hospital: cod };
      const chave = `fato:integracao.teste:${cod}:int-2:sem-carimbo`;
      const cred = novaCredencial(PARCEIRO.codigo);
      await p.gravarSgh(c, trilha('criar'), async (g) => {
        await g.criarParceiro(PARCEIRO, 'SGH.TESTE');
        await g.gravarCredencial(PARCEIRO.codigo, cred.clienteId, resumoDoSegredo(cred.segredo), 'SGH.TESTE');
        await g.alterarParceiro(PARCEIRO.codigo, { ...PARCEIRO, ativo: true }, 'SGH.TESTE');
        const idOutbox = await g.outbox({
          tipo: 'integracao.teste',
          chave,
          carga: { parceiro: PARCEIRO.codigo },
        });
        const n = {
          idOutbox,
          chaveEvento: chaveEvento(chave),
          tipoEvento: 'integracao.teste',
          parceiro: PARCEIRO.codigo,
          chaveOrdem: `estabelecimento:${cod}`,
          tabelaFato: null,
          idFato: null,
        };
        expect(await g.registrarEnvio(n)).toBe(true);
        expect(await g.registrarEnvio(n)).toBe(false);
      });
      // A unicidade do banco também recusa (a corrida de dois consumidores).
      await expect(
        e.executar(
          `INSERT INTO SGH_INTG_ENVIO (ID, HOSPITAL, ID_OUTBOX, CHAVE_EVENTO, TIPO_EVENTO, PARCEIRO, CHAVE_ORDEM)
           SELECT NEXT VALUE FOR SGH_GEN_INTG_ENVIO, HOSPITAL, ID_OUTBOX, CHAVE_EVENTO, TIPO_EVENTO, PARCEIRO, CHAVE_ORDEM
             FROM SGH_INTG_ENVIO WHERE HOSPITAL = ? AND CHAVE_EVENTO = ?`,
          [cod, chaveEvento(chave)],
        ),
      ).rejects.toThrow(/SGH_UQ_INTG_ENVIO_EVENTO|unique|violation/i);
      // A entrada: a mesma chave do parceiro devolve a primeira. Privacidade: o CPF, o nome e o texto injetados no
      // conteúdo ficam só no armazém, nunca no banco.
      const armazem = new ArmazemConteudoMemoria();
      const entrada = new ServicoEntrada(p, armazem);
      const conteudo = [
        'MSH|^~\\&|LAB|LABX|SANTE|PC|20261022080000||ORU^R01^ORU_R01|INT-M34-0001|T|2.5',
        'PID|1||1^^^^PI||FICTICIO^PACIENTE INJETADO||19800101|F|||||||||||11144477735',
        'OBR|1|999999999|AP-INT|GLI^GLICOSE',
        'OBX|1|NM|GLI^GLICOSE||92|mg/dL|70-99||||F',
        'NTE|1||Texto clinico injetado: suspeita de diabetes.',
      ].join('\r');
      const pedido = {
        hospital: cod,
        rede: nucleo.rede,
        autorizacao: `Basic ${Buffer.from(`${cred.clienteId}:${cred.segredo}`).toString('base64')}`,
        idempotencia: null,
        corpo: { parceiro: PARCEIRO.codigo, tipo: 'ORU^R01', conteudo },
        estacao: 'int-m34',
      };
      const a = await entrada.receber(pedido);
      const b = await entrada.receber(pedido);
      expect(a.repetida).toBe(false);
      expect(b).toMatchObject({ id: a.id, repetida: true, chaveParceiro: 'INT-M34-0001' });
      const linhas = await e.consultar(
        `SELECT r.TIPO, r.CHAVE_PARCEIRO, r.HASH_CONTEUDO, r.CHAVE_S3, r.DETALHE, r.SITUACAO FROM SGH_INTG_RECEBIDA r
          WHERE r.HOSPITAL = ? AND r.PARCEIRO = ?`,
        [cod, PARCEIRO.codigo],
        { teto: 10 },
      );
      expect(linhas).toHaveLength(1);
      const trilhaLinhas = await e.consultar(
        "SELECT EVENTO, CHAVE_NATURAL_ALVO, OPERACAO FROM SGH_TRILHA WHERE CORRELACAO = ? OR ESTACAO = 'int-m34'",
        [a.resumo.slice(0, 64)],
        { teto: 50 },
      );
      const tudo = JSON.stringify([linhas, trilhaLinhas]);
      for (const proibido of ['11144477735', 'INJETADO', 'FICTICIO', 'diabetes', 'GLICOSE'])
        expect(tudo).not.toContain(proibido);
      expect([...armazem.objetos.values()][0]).toContain('INJETADO');
    });
  });
});
