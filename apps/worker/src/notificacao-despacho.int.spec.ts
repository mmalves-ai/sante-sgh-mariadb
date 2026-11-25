// Contrato de efeito do despachante agendado da notificação por regra (01-ADM L76) no MariaDB (f22_o5):
// - em produção, o ciclo consolida os avisos do canal de e-mail num envio (envio_notificacao + um item por aviso em
//   envio_notificacao_aviso) e o entrega: a situação passa a "enviado" com a tentativa contada; só a contagem vai na
//   mensagem;
// - o ciclo seguinte não reenvia o mesmo aviso pelo mesmo canal;
// - sem provedor do canal, o envio fica "falhou" com o motivo e a tentativa contada;
// - fora de produção, o envio do canal externo fica "capturado" e nada sai.
// - o envio que falhou volta a pendente só depois da espera e é entregue de novo (falha passageira: nova tentativa
//   contada, erro limpo na entrega); com as tentativas esgotadas, não repete mais.
// Massa sintética (prefixo L76D), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { PortaDespachoNotificacaoPropria } from './notificacao-despacho-propria.js';
import { cicloDespacho } from './notificacao-despacho.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const P = 'L76D';
const AGORA = new Date('2026-11-25T12:00:00.000Z');

describe.skipIf(SEM_BANCO)('despachante da notificação por regra sobre o banco próprio', () => {
  const nucleo = new NucleoProprio();
  let porta: PortaDespachoNotificacaoPropria;
  let est: AlvoEstabelecimento;
  const ids = { est: 0, usuario: 0, regra: 0 };
  // Canais de e-mail externos ativos no cliente (o sintético e os que o cliente já tem): cada um consolida os avisos.
  let k = 0;

  const linhas = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l76d' }, (l) => l.consultar(sql, p));
  const envios = () =>
    linhas(
      `SELECT en.situacao, en.tentativas, en.quantidade_avisos AS q, en.erro,
              (SELECT COUNT(*) FROM envio_notificacao_aviso ea WHERE ea.envio_notificacao_id = en.id) AS itens
         FROM envio_notificacao en JOIN canal_notificacao c ON c.id = en.canal_notificacao_id
        WHERE en.estabelecimento_id = ? AND c.codigo = ? ORDER BY en.id`,
      [ids.est, `${P}E`],
    );
  const avisar = (quantos: number) =>
    escrever(nucleo, async (e) => {
      for (let i = 0; i < quantos; i++)
        await e.inserir(
          `INSERT INTO notificacao_usuario (estabelecimento_id, usuario_id, regra_alerta_id, titulo, texto, gravidade,
              chave_agrupamento, gerada_em, criado_em) VALUES (?, ?, ?, 'AVISO SINTETICO', 'TEXTO SINTETICO', 'atencao', ?, ?, ?)`,
          [ids.est, ids.usuario, ids.regra, `${P}-assunto`, new Date(AGORA.getTime() - 10 * 60_000), AGORA],
        );
    });

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      if (ids.est) {
        await e.executar(
          'DELETE ea FROM envio_notificacao_aviso ea JOIN envio_notificacao en ON en.id = ea.envio_notificacao_id WHERE en.estabelecimento_id = ?',
          [ids.est],
        );
        await e.executar('DELETE FROM envio_notificacao WHERE estabelecimento_id = ?', [ids.est]);
        await e.executar('DELETE FROM notificacao_usuario WHERE estabelecimento_id = ?', [ids.est]);
      }
      await e.executar(`DELETE FROM regra_alerta WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM regra_consolidacao_notificacao WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM canal_notificacao WHERE codigo LIKE '${P}%'`, []);
      await e.executar(`DELETE FROM cenario_alerta WHERE codigo LIKE '${P}%'`, []);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    garantirCliente();
    await escrever(nucleo, async (e) => {
      ids.est = await garantirEstabelecimento(e, P);
    });
    await limpar();
    await escrever(nucleo, async (e) => {
      const hoje = new Date();
      ids.usuario = await garantirUsuario(e, `${P}.U`);
      await e.executar('UPDATE usuario SET email = ? WHERE id = ?', [
        `${P.toLowerCase()}@exemplo.invalid`,
        ids.usuario,
      ]);
      await e.inserir(
        "INSERT INTO canal_notificacao (codigo, descricao, tipo_canal, externo, exige_contato, ordem, criado_em) VALUES (?, 'EMAIL SINTETICO', 'email', TRUE, TRUE, 999, ?)",
        [`${P}E`, hoje],
      );
      const cenario = await e.inserir(
        "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES (?, 'CENARIO SINTETICO L76D', 'sintetico', ?)",
        [P, hoje],
      );
      const rc = await e.inserir(
        `INSERT INTO regra_consolidacao_notificacao (estabelecimento_id, codigo, nome, janela_minutos, chave_agrupamento,
            formato, ativo, criado_em) VALUES (?, ?, 'CONSOLIDACAO SINTETICA', 1, 'regra', 'contagem', TRUE, ?)`,
        [ids.est, `${P}RC`, hoje],
      );
      ids.regra = await e.inserir(
        `INSERT INTO regra_alerta (estabelecimento_id, codigo, nome, cenario_alerta_id, mensagem, notifica_tela,
            notifica_email, regra_consolidacao_notificacao_id, vigencia_inicio, criado_em)
          VALUES (?, ?, 'REGRA SINTETICA L76D', ?, 'MENSAGEM SINTETICA', FALSE, TRUE, ?, '2026-01-01', ?)`,
        [ids.est, `${P}R`, cenario, rc, hoje],
      );
    });
    porta = new PortaDespachoNotificacaoPropria(nucleo, CLIENTE);
    const alvo = (await porta.estabelecimentos()).find((x) => x.id === ids.est);
    if (!alvo) throw new Error('estabelecimento sintético inativo');
    est = alvo;
    k = (await porta.canais()).filter((c) => c.tipo === 'email' && c.externo).length;
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('produção: consolida os 3 avisos num envio de e-mail e entrega só com a contagem', async () => {
    await avisar(3);
    const saidas: { para: string; assunto: string; texto: string }[] = [];
    const r = await cicloDespacho(porta, est, {
      producao: true,
      agora: AGORA,
      entregadores: { email: async (para, assunto, texto) => void saidas.push({ para, assunto, texto }) },
    });
    expect(r).toMatchObject({ envios: k, avisos: 3 * k, entregues: k, falhas: 0 });
    expect(saidas).toHaveLength(k);
    expect(saidas[0]).toEqual({
      para: 'l76d@exemplo.invalid',
      assunto: 'Você tem 3 avisos no sistema',
      texto: expect.stringContaining('Meus avisos'),
    });
    expect(await envios()).toEqual([{ situacao: 'enviado', tentativas: 1, q: 3, erro: null, itens: 3 }]);
  });

  it('o ciclo seguinte não reenvia o mesmo aviso pelo mesmo canal', async () => {
    const r = await cicloDespacho(porta, est, { producao: true, agora: AGORA, entregadores: {} });
    expect(r).toMatchObject({ envios: 0, entregues: 0, falhas: 0 });
    expect(await envios()).toHaveLength(1);
  });

  it('sem provedor do canal: o envio fica "falhou" com o motivo e a tentativa contada', async () => {
    await avisar(1);
    const r = await cicloDespacho(porta, est, { producao: true, agora: AGORA, entregadores: {} });
    expect(r).toMatchObject({ envios: k, falhas: k, entregues: 0 });
    const [, segundo] = await envios();
    expect(segundo).toMatchObject({ situacao: 'falhou', tentativas: 1, q: 1, itens: 1 });
    expect(String(segundo?.['erro'])).toContain('sem provedor');
  });

  it('fora de produção: o envio do canal externo fica "capturado" e nada sai', async () => {
    await avisar(2);
    let saiu = 0;
    const r = await cicloDespacho(porta, est, {
      producao: false,
      agora: AGORA,
      entregadores: { email: async () => void saiu++ },
    });
    expect(r).toMatchObject({ envios: k, avisos: 2 * k, entregues: 0, falhas: 0 });
    expect(saiu).toBe(0);
    const [, , terceiro] = await envios();
    expect(terceiro).toMatchObject({ situacao: 'capturado', tentativas: 1, q: 2, itens: 2 });
  });

  it('falha passageira: o envio que falhou repete depois da espera e é entregue com a tentativa contada', async () => {
    const em = (horas: number) => new Date(Date.now() + horas * 3_600_000);
    const ok = { email: async () => undefined };
    // Ainda dentro da espera (15 min por tentativa): não repete.
    const cedo = await cicloDespacho(porta, est, { producao: true, agora: new Date(), entregadores: ok });
    expect(cedo).toMatchObject({ repetidos: 0, entregues: 0, falhas: 0 });
    expect((await envios())[1]).toMatchObject({ situacao: 'falhou', tentativas: 1 });
    // Passada a espera, repete; o SMTP falha de novo: volta a "falhou", com a segunda tentativa contada.
    const caiu = await cicloDespacho(porta, est, {
      producao: true,
      agora: em(2),
      entregadores: {
        email: async () => {
          throw new Error('smtp fora do ar');
        },
      },
    });
    expect(caiu).toMatchObject({ repetidos: k, falhas: k, entregues: 0 });
    const segundo = (await envios())[1];
    expect(segundo).toMatchObject({ situacao: 'falhou', tentativas: 2 });
    expect(String(segundo?.['erro'])).toContain('Falha na entrega');
    // Mais adiante, o SMTP voltou: repete e entrega; o erro sai do envio.
    const voltou = await cicloDespacho(porta, est, { producao: true, agora: em(4), entregadores: ok });
    expect(voltou).toMatchObject({ repetidos: k, entregues: k, falhas: 0 });
    expect((await envios())[1]).toMatchObject({
      situacao: 'enviado',
      tentativas: 3,
      erro: null,
      q: 1,
      itens: 1,
    });
  });

  it('tentativas esgotadas: o envio que falhou não repete mais', async () => {
    await escrever(nucleo, (e) =>
      e.executar(
        `UPDATE envio_notificacao en JOIN canal_notificacao c ON c.id = en.canal_notificacao_id
            SET en.situacao = 'falhou', en.tentativas = 5
          WHERE en.estabelecimento_id = ? AND c.codigo = ? AND en.situacao = 'enviado' AND en.quantidade_avisos = 1`,
        [ids.est, `${P}E`],
      ),
    );
    const r = await cicloDespacho(porta, est, {
      producao: true,
      agora: new Date(Date.now() + 48 * 3_600_000),
      entregadores: { email: async () => undefined },
    });
    expect(r.repetidos).toBe(0);
    expect((await envios())[1]).toMatchObject({ situacao: 'falhou', tentativas: 5 });
  });
});
