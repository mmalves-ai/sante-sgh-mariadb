// Integração da entrada idempotente do parceiro (regra 8) de ponta a ponta contra o MariaDB real (cliente f22_o4;
// massa sintética): a credencial emitida pela porta própria, a mensagem guardada no armazém (memória aqui) e a
// mensagem de entrada com o arquivo e a trilha na mesma transação; a repetição devolve a primeira; credencial errada,
// parceiro desativado e escopo ausente são recusados sem gravar. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { novaCredencial, resumoDoSegredo } from '../aplicacao/credencial.js';
import { ServicoEntrada } from '../aplicacao/receber.js';
import type { ContextoIntegracao, TrilhaIntegracao } from '../porta.js';
import { PortaIntegracaoPropria } from '../porta-propria.js';
import { ArmazemConteudoMemoria } from './armazem-conteudo.js';
import {
  CLIENTE,
  garantirEstabelecimento,
  garantirPadroes,
  limparParceiro,
  SEM_BANCO,
} from './massa-integracao.spec-util.js';

const PARCEIRO = 'f2241-ent';
const A: ContextoIntegracao = { rede: 'rede-teste', hospital: 'f2241a', correlacao: 'teste-f2241-entrada' };
const ORU = [
  'MSH|^~\\&|LAB-APOIO|LABSINT|SANTE|SINTETICO|20261022080000||ORU^R01^ORU_R01|F2241-ENT-0001|T|2.5',
  'OBR|1|777|AP-F2241-0001|GLI^GLICOSE',
  'OBX|1|NM|GLI^GLICOSE||92|mg/dL|70-99||||F',
].join('\r');
const trilha: TrilhaIntegracao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'parceiro_dados',
  entidadeId: null,
  dadosDepois: { evento: 'integracao.parceiro.alterado', recurso: 'integracao.teste' },
  correlacao: 'teste-f2241-entrada',
};

describe.skipIf(SEM_BANCO)('entrada idempotente do parceiro contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaIntegracaoPropria;
  let servico: ServicoEntrada;
  const cred = novaCredencial(PARCEIRO);
  const basica = (segredo = cred.segredo) =>
    `Basic ${Buffer.from(`${cred.clienteId}:${segredo}`).toString('base64')}`;
  const pedido = (autorizacao: string, conteudo = ORU) => ({
    hospital: 'f2241a',
    rede: 'rede-teste',
    autorizacao,
    idempotencia: null,
    corpo: { parceiro: PARCEIRO, tipo: 'ORU^R01', conteudo },
    estacao: 'teste',
  });
  const sql = (q: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (l) => l.consultar(q, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2241' }, async (e) => {
      await limparParceiro(e, PARCEIRO);
      await garantirEstabelecimento(e, 'f2241a');
      await garantirPadroes(e);
    });
    porta = new PortaIntegracaoPropria(nucleo, CLIENTE);
    servico = new ServicoEntrada(porta, new ArmazemConteudoMemoria());
    await porta.gravar(A, trilha, async (g) => {
      await g.criarParceiro(
        {
          codigo: PARCEIRO,
          nome: 'Parceiro de entrada do lote 04-01',
          tipo: 'apoio',
          canal: null,
          escopos: ['resultado.enviar'],
          eventos: [],
          limiteTentativas: 3,
          finalidade: 'Teste automatizado da entrada.',
          baseLegal: 'tutela-da-saude',
        },
        'teste',
      );
      await g.gravarCredencial(PARCEIRO, cred.clienteId, resumoDoSegredo(cred.segredo), 'teste');
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f2241' }, (e) =>
      limparParceiro(e, PARCEIRO),
    );
    await nucleo.encerrar();
  });

  it('parceiro desativado não entra (403) e nada é gravado', async () => {
    await expect(servico.receber(pedido(basica()))).rejects.toMatchObject({ status: 403 });
    expect(
      await sql("SELECT id FROM mensagem_integracao_entrada WHERE chave_idempotencia = 'F2241-ENT-0001'"),
    ).toEqual([]);
  });

  it('a mensagem entra uma vez (conferir), com arquivo e trilha; a repetição devolve a primeira', async () => {
    await porta.gravar(A, trilha, async (g) => {
      const p = await porta.parceiro(A, PARCEIRO);
      return g.alterarParceiro(PARCEIRO, { ...p!, ativo: true }, 'teste');
    });
    const r1 = await servico.receber(pedido(basica()));
    expect(r1).toMatchObject({ situacao: 'conferir', repetida: false, chaveParceiro: 'F2241-ENT-0001' });
    const r2 = await servico.receber(pedido(basica()));
    expect(r2).toMatchObject({ id: r1.id, repetida: true });
    const linhas = await sql(
      `SELECT m.situacao, m.formato, a.chave_armazenamento IS NOT NULL AS guardado FROM mensagem_integracao_entrada m
         JOIN arquivo a ON a.id = m.arquivo_id WHERE m.id = ?`,
      [Number(r1.id)],
    );
    expect(linhas).toEqual([{ situacao: 'validada', formato: 'hl7v2', guardado: 1 }]);
    const t = await sql(
      "SELECT usuario_id, dados_depois FROM trilha_auditoria WHERE entidade = 'mensagem_integracao_entrada' AND entidade_id = ?",
      [Number(r1.id)],
    );
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t[0]?.['usuario_id']).toBeNull();
    // A trilha nunca leva o conteúdo.
    expect(JSON.stringify(t)).not.toContain('GLICOSE');
  });

  it('segredo errado (401) e escopo ausente (403) são recusados', async () => {
    await expect(servico.receber(pedido(basica(`${cred.segredo}x`)))).rejects.toMatchObject({ status: 401 });
    const adt = 'MSH|^~\\&|X|Y|SANTE|SINTETICO|20261022080000||ORM^O01|F2241-ENT-0002|T|2.5';
    await expect(
      servico.receber({
        ...pedido(basica(), adt),
        corpo: { parceiro: PARCEIRO, tipo: 'ORM^O01', conteudo: adt },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
