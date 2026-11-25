// Contrato de efeito do enviador de prescrição digital do worker (F8, 08-INTG L132) contra o MariaDB real (cliente de
// teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real) e o armazém de arquivos em pasta temporária.
// Prova o que fica no banco pela gravação REAL do retorno (operação integracao.prescricao_digital.retorno no Executor):
//   - o documento assinado é lido do armazém e vai anexado ao corpo que chega à plataforma (base64 e resumo);
//   - a aceita grava identificador, código, endereço, situação externa, conteúdo do retorno, a versão nova e a trilha;
//   - a rejeição fica no envio (rejeitada) e a entrega termina (a mensagem não volta à fila);
//   - a aceita atrasada de envio cancelado no hospital guarda o identificador, mantém o cancelamento e põe o pedido de
//     cancelamento na fila da plataforma (a receita não fica valendo lá).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { EVENTO_PRESCRICAO_DIGITAL_ENVIO, montarPedidoPrescricaoDigital } from '@sgh/dominio-integracao';
import {
  type ArmazemArquivosLocal,
  criarArmazemLocal,
  criarPastaArquivosTeste,
  type Escritor,
  NucleoProprio,
  type PastaArquivosTeste,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { limparTrilhaDaMassa } from '../teste/limpar-trilha.spec-util.js';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import type { EnvioEntrega, ParceiroEntrega } from './porta-propria.js';
import { type ConfiguracaoPrescricao, entregarPrescricaoDigital } from './prescricao-digital.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2018wk';
const PDF = `%PDF-1.7 receita assinada sintética ${randomUUID()}`;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM envio_prescricao_plataforma WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM mensagem_integracao_saida WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM ponto_integracao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar("DELETE FROM parceiro_dados WHERE codigo = 'c2018wk-par'");
    await e.executar("DELETE FROM sistema_externo WHERE codigo = 'c2018wk-plat'");
    await e.executar("DELETE FROM padrao_troca WHERE codigo = 'c2018wk-api'");
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Enviador de prescrição digital (contrato de efeito do retorno)', () => {
  let nucleo: NucleoProprio;
  let acesso: AcessoIntegracao;
  let pasta: PastaArquivosTeste;
  let armazem: ArmazemArquivosLocal;
  let m: { est: number; sis: number; ponto: number; arquivo: number };
  const parceiro = { codigo: 'c2018wk-par', tipo: 'api' } as ParceiroEntrega;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

  /** O envio pendente e a mensagem gravada como a API grava (receita, itens e a referência do arquivo assinado). */
  const novoEnvio = async (situacao = 'pendente', motivo: string | null = null) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `envio-${P}` }, async (e) => {
      const agora = new Date();
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const envio = await e.inserir(
          `INSERT INTO envio_prescricao_plataforma (estabelecimento_id, atendimento_id, paciente_id, profissional_id,
             sistema_externo_id, receita_medica_id, hash_documento, versao_api, situacao, cancelado_em,
             motivo_cancelamento, criado_em) VALUES (?, 999999, 999999, 999999, ?, 999999, ?, '1', ?, ?, ?, ?)`,
          [m.est, m.sis, 'a'.repeat(64), situacao, motivo ? agora : null, motivo, agora],
        );
        const conteudo = montarPedidoPrescricaoDigital({
          evento: EVENTO_PRESCRICAO_DIGITAL_ENVIO,
          envio,
          estabelecimento: P,
          receita: { numero: `${P}-${envio}`, emitidaEm: agora.toISOString(), validadeAte: null },
          documento: { codigoVerificacao: `${P}-${envio}`, hash: 'a'.repeat(64), arquivo: m.arquivo },
          itens: [
            {
              sequencia: 1,
              medicamento: 'Fármaco sintético',
              concentracao: '500 mg',
              formaFarmaceutica: 'comprimido',
              via: 'oral',
              posologia: '1 comprimido de 8 em 8 horas',
              quantidade: '1 caixa',
              usoContinuo: false,
            },
          ],
          identificadorExterno: null,
          motivo: null,
        });
        const msg = await e.inserir(
          `INSERT INTO mensagem_integracao_saida (estabelecimento_id, ponto_integracao_id, sistema_externo_id, entidade,
             entidade_id, chave_idempotencia, correlacao, tipo_mensagem, formato, conteudo, hash_sha256, situacao,
             tentativas, tentativas_maximas, criado_em)
           VALUES (?, ?, ?, 'envio_prescricao_plataforma', ?, ?, ?, ?, 'json', ?, ?, 'enviando', 0, 5, ?)`,
          [
            m.est,
            m.ponto,
            m.sis,
            envio,
            `prescricao-digital:envio:${envio}`,
            `prescricao-digital.${envio}`,
            EVENTO_PRESCRICAO_DIGITAL_ENVIO,
            conteudo,
            'c'.repeat(64),
            agora,
          ],
        );
        await e.executar(
          'UPDATE envio_prescricao_plataforma SET mensagem_integracao_saida_id = ? WHERE id = ?',
          [msg, envio],
        );
        return { envio, msg };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });

  const config = (ambiente: string, http?: typeof fetch): ConfiguracaoPrescricao => ({
    ambiente,
    destinoApi: () => 'https://plataforma.exemplo.invalid/receitas',
    ler: (h, fn) => acesso.ler(h, fn),
    gravar: (h, fn, o) => acesso.gravar(h, fn, o),
    lerArquivo: async (_h, id) => {
      const a = await armazem.ler(
        { cliente: CLIENTE, estabelecimento: null, usuario: null, correlacao: P },
        id,
      );
      return { conteudo: a.conteudo, tipoMime: a.metadado.tipoMime, hash: a.metadado.hash };
    },
    agora: () => new Date(),
    ...(http ? { http } : {}),
  });
  const envioEntrega = (msg: number) =>
    ({ id: String(msg), chaveEvento: `prescricao-digital:envio:${msg}` }) as EnvioEntrega;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    pasta = await criarPastaArquivosTeste(CLIENTE);
    armazem = criarArmazemLocal(nucleo, { raiz: pasta.raiz });
    const base = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const sis = await e.inserir(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES ('c2018wk-plat', 'Plataforma de prescrição (teste)', 'prontuario', 'Prescrição digital (teste)', ?)`,
        [agora],
      );
      await e.executar(
        `INSERT INTO parceiro_dados (codigo, nome, tipo, sistema_externo_id, finalidade, base_legal, criado_em)
         VALUES ('c2018wk-par', 'Plataforma (teste)', 'api', ?, 'Prescrição digital (teste)', 'tutela-da-saude', ?)`,
        [sis, agora],
      );
      let padrao = await e.uma(
        "SELECT id FROM padrao_troca WHERE familia IN ('api','proprio') AND ativo = TRUE ORDER BY id LIMIT 1",
      );
      if (!padrao)
        padrao = {
          id: await e.inserir(
            "INSERT INTO padrao_troca (codigo, descricao, familia, criado_em) VALUES ('c2018wk-api', 'API (teste)', 'api', ?)",
            [agora],
          ),
        };
      const ponto = await e.inserir(
        `INSERT INTO ponto_integracao (estabelecimento_id, codigo, nome, sistema_externo_id, padrao_troca_id, direcao,
           transporte, formato_conteudo, ativo, criado_em)
         VALUES (?, 'parceiro.c2018wk-par.saida', 'Plataforma (saida)', ?, ?, 'saida', 'http_rest', 'json', TRUE, ?)`,
        [est, sis, Number(padrao['id']), agora],
      );
      return { est, sis, ponto };
    });
    const g = await armazem.guardar(
      {
        conteudo: new TextEncoder().encode(PDF),
        nomeOriginal: 'receita-assinada.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'documento_assinado',
      },
      {
        cliente: CLIENTE,
        estabelecimento: base.est,
        usuario: null,
        correlacao: P,
        chaveIdempotencia: `${P}-${randomUUID()}`,
      },
    );
    m = { ...base, arquivo: g.id };
    acesso = acessoDoNucleo(nucleo, CLIENTE, `teste-${P}`);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await pasta?.apagar();
    await nucleo.encerrar?.();
  });

  it('o documento assinado chega anexado à plataforma e a aceita fica gravada no envio, com versão e trilha', async () => {
    const { envio, msg } = await novoEnvio();
    const http = vi.fn<(u: string, i: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            situacao: 'aceita',
            identificador: `${P}-ID-${envio}`,
            codigoValidacao: '246810',
            urlValidacao: `https://plataforma.exemplo.invalid/v/${envio}`,
            situacaoExterna: 'emitida',
          }),
        ),
    );
    const r = await entregarPrescricaoDigital(
      config('producao', http as unknown as typeof fetch),
      parceiro,
      envioEntrega(msg),
      P,
    );
    expect(r.recibo).toBe(`${P}-ID-${envio}`);
    const corpo = JSON.parse(String(http.mock.calls[0]![1].body)) as {
      documento: Record<string, unknown>;
      itens: unknown[];
    };
    expect(Buffer.from(String(corpo.documento['conteudoBase64']), 'base64').toString()).toBe(PDF);
    expect(corpo.documento['tipoMime']).toBe('application/pdf');
    expect(corpo.itens).toHaveLength(1);
    const [x] = await ler(
      `SELECT situacao, identificador_externo, codigo_validacao, url_validacao, situacao_externa, conteudo_retorno,
              enviado_em, retorno_em, versao, alterado_em FROM envio_prescricao_plataforma WHERE id = ?`,
      [envio],
    );
    expect(x).toMatchObject({
      situacao: 'aceita',
      identificador_externo: `${P}-ID-${envio}`,
      codigo_validacao: '246810',
      url_validacao: `https://plataforma.exemplo.invalid/v/${envio}`,
      situacao_externa: 'emitida',
    });
    expect(Number(x!['versao'])).toBe(2);
    expect(x!['retorno_em']).not.toBeNull();
    expect(x!['enviado_em']).not.toBeNull();
    const ret = x!['conteudo_retorno'];
    expect(typeof ret === 'string' ? JSON.parse(ret) : ret).toMatchObject({ situacao: 'aceita' });
    const trilha = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?
          AND JSON_VALUE(dados_depois, '$.operacao') = 'integracao.prescricao_digital.retorno'`,
      [m.est],
    );
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(1);
  });

  it('fora de produção o simulador recebe o corpo com o arquivo e a aceita fica gravada', async () => {
    const { envio, msg } = await novoEnvio();
    const r = await entregarPrescricaoDigital(config('dev'), parceiro, envioEntrega(msg), P);
    expect(r.recibo).toMatch(/^SIM-/);
    const [x] = await ler(
      'SELECT situacao, identificador_externo, url_validacao FROM envio_prescricao_plataforma WHERE id = ?',
      [envio],
    );
    expect(x).toMatchObject({ situacao: 'aceita', identificador_externo: r.recibo });
    expect(String(x!['url_validacao'])).toMatch(/^https:\/\/.+\.invalid\//);
  });

  it('a rejeição fica no envio e a entrega termina (sem volta à fila)', async () => {
    const { envio, msg } = await novoEnvio();
    const http = vi.fn(
      async () => new Response(JSON.stringify({ situacao: 'rejeitada', motivo: 'CRM inválido' })),
    );
    const r = await entregarPrescricaoDigital(
      config('producao', http as unknown as typeof fetch),
      parceiro,
      envioEntrega(msg),
      P,
    );
    expect(r.resposta).toMatch(/recusada pela plataforma: CRM inválido/);
    const [x] = await ler(
      'SELECT situacao, identificador_externo, situacao_externa FROM envio_prescricao_plataforma WHERE id = ?',
      [envio],
    );
    expect(x).toMatchObject({
      situacao: 'rejeitada',
      identificador_externo: null,
      situacao_externa: 'rejeitada',
    });
  });

  it('a aceita atrasada de envio cancelado guarda o identificador e põe o cancelamento na fila', async () => {
    const { envio, msg } = await novoEnvio('cancelada', 'Troca do tratamento');
    const r = await entregarPrescricaoDigital(config('dev'), parceiro, envioEntrega(msg), P);
    expect(r.resposta).toMatch(/cancelamento enviado à plataforma/);
    const [x] = await ler(
      'SELECT situacao, identificador_externo, codigo_validacao, motivo_cancelamento FROM envio_prescricao_plataforma WHERE id = ?',
      [envio],
    );
    expect(x).toMatchObject({
      situacao: 'cancelada',
      identificador_externo: r.recibo,
      codigo_validacao: null,
      motivo_cancelamento: 'Troca do tratamento',
    });
    const c = await ler(
      `SELECT situacao, tipo_mensagem, ponto_integracao_id, conteudo FROM mensagem_integracao_saida
        WHERE entidade = 'envio_prescricao_plataforma' AND entidade_id = ? AND id <> ?`,
      [envio, msg],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      situacao: 'pendente',
      tipo_mensagem: 'integracao.prescricao_digital.cancelamento',
    });
    expect(Number(c[0]!['ponto_integracao_id'])).toBe(m.ponto);
    expect(JSON.parse(String(c[0]!['conteudo']))).toMatchObject({
      identificadorExterno: r.recibo,
      motivo: 'Troca do tratamento',
      documento: null,
    });
  });
});
