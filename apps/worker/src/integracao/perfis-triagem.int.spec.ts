// Contrato de efeito da ENTREGA dos perfis de prioridade ao sistema de triagem (F3.9, 08-INTG L140) pelo worker,
// contra o MariaDB real (cliente de teste). A mensagem MFN^M13 é gravada com as mesmas colunas que a porta da API grava
// (`classificacao-externa-propria.ts`, enviarPerfis): a fila de envio do estabelecimento a traz com o parceiro HL7 do
// sistema de triagem e a ordem do sistema; o conteúdo que o enviador HL7 manda é exatamente o gravado; a mensagem de
// outro estabelecimento ou de outro tipo não é entregue como perfis; o ciclo de entrega manda por MLLP (receptor de
// teste no loopback, porta efêmera) e grava a mensagem como enviada com o ACK. Massa SINTÉTICA (códigos c1027w);
// nenhuma pessoa. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { deMllp, emMllp, EVENTO_ENVIO_PERFIS_TRIAGEM, montarPerfisHl7 } from '@sgh/dominio-integracao';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AcessoIntegracao, acessoDoNucleo } from './acesso.js';
import { cicloEntrega, ErroEntrega } from './entrega.js';
import { type ConfiguracaoEnviadores, conteudoHl7, criarEnviador } from './enviadores.js';
import { conteudoPerfisTriagem } from './perfis-triagem.js';
import * as porta from './porta-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const EST = 'c1027w';
const EST2 = 'c1027w2';
const SIS = 'c1027w-tri';
const PAR = 'c1027w-par';
const CANAL = 'oie-classificacao-adt';
const FONTE = 'teste-c1027w';
const PONTO = `parceiro.${PAR}.saida`;
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

async function limpar(e: Escritor): Promise<void> {
  const ests = '(SELECT x.id FROM (SELECT id FROM estabelecimento WHERE codigo IN (?, ?)) x)';
  const msgs = `(SELECT y.id FROM (SELECT id FROM mensagem_integracao_saida WHERE estabelecimento_id IN ${ests}) y)`;
  await e.executar(`DELETE FROM falha_integracao WHERE mensagem_integracao_saida_id IN ${msgs}`, [EST, EST2]);
  await e.executar(`DELETE FROM mensagem_integracao_saida WHERE estabelecimento_id IN ${ests}`, [EST, EST2]);
  await e.executar(`DELETE FROM ponto_integracao WHERE estabelecimento_id IN ${ests}`, [EST, EST2]);
  await e.executar('DELETE FROM parceiro_dados WHERE codigo = ?', [PAR]);
  await e.executar('DELETE FROM sistema_externo WHERE codigo = ?', [SIS]);
  await e.executar('DELETE FROM evento_hl7 WHERE versao_fonte = ?', [FONTE]);
}

/** Um receptor MLLP de teste no loopback: guarda o que chegou e responde o ACK AA com o MSH-10 recebido. */
function receptorMllp(): Promise<{ servidor: Server; porta: number; recebidas: string[] }> {
  const recebidas: string[] = [];
  const servidor = createServer((s) => {
    let buf: Uint8Array = new Uint8Array(0);
    s.on('data', (d: Buffer) => {
      const junto = new Uint8Array(buf.length + d.length);
      junto.set(buf);
      junto.set(d, buf.length);
      const r = deMllp(junto);
      buf = r.resto;
      for (const msg of r.mensagens) {
        recebidas.push(msg);
        const controle = msg.split('\r')[0]!.split('|')[9] ?? '';
        s.write(
          emMllp(
            `MSH|^~\\&|TRIAGEM|TESTE|SGH|C1027W|20261125000000||ACK^M13^ACK|A${controle}|T|2.5.1\rMSA|AA|${controle}`,
          ),
        );
      }
    });
  });
  return new Promise((ok) =>
    servidor.listen(0, '127.0.0.1', () => {
      const a = servidor.address();
      ok({ servidor, porta: typeof a === 'object' && a ? a.port : 0, recebidas });
    }),
  );
}

describe.skipIf(SEM_BANCO)('Entrega dos perfis de prioridade ao sistema de triagem pelo worker', () => {
  let nucleo: NucleoProprio;
  let acesso: AcessoIntegracao;
  let m: { est: number; est2: number; perfis: number; outroEst: number; outroTipo: number; conteudo: string };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: EST }, (l) => l.consultar(sql, p)) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${EST}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const garantirEst = async (codigo: string) => {
        const x = await e.uma('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
        if (x) return Number(x['id']);
        return e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
          [codigo, agora],
        );
      };
      const est = await garantirEst(EST);
      const est2 = await garantirEst(EST2);
      let padrao = await e.uma(
        "SELECT id FROM padrao_troca WHERE familia = 'hl7v2' AND ativo = TRUE ORDER BY id LIMIT 1",
      );
      if (!padrao)
        padrao = {
          id: await e.inserir(
            "INSERT INTO padrao_troca (codigo, descricao, familia, criado_em) VALUES ('c1027w-hl7v2', 'HL7 v2 (teste)', 'hl7v2', ?)",
            [agora],
          ),
        };
      const sis = await e.inserir(
        `INSERT INTO sistema_externo (codigo, nome, categoria, finalidade, criado_em)
         VALUES (?, 'Triagem (teste)', 'triagem', 'Classificação de risco (teste)', ?)`,
        [SIS, agora],
      );
      await e.executar(
        `INSERT INTO parceiro_dados (codigo, nome, tipo, sistema_externo_id, canal, escopos, finalidade, base_legal,
           criado_em) VALUES (?, 'Triagem (teste)', 'hl7', ?, ?, '[]', 'Classificação de risco (teste)',
           'tutela-da-saude', ?)`,
        [PAR, sis, CANAL, agora],
      );
      let ev = await e.uma(
        "SELECT id FROM evento_hl7 WHERE codigo_hl7 = 'MFN^M13' ORDER BY versao_hl7 DESC LIMIT 1",
      );
      if (!ev)
        ev = {
          id: await e.inserir(
            `INSERT INTO evento_hl7 (codigo_hl7, tipo_mensagem, codigo_evento, estrutura_mensagem, versao_hl7, descricao,
               vigencia_inicio, versao_fonte, criado_em)
             VALUES ('MFN^M13', 'MFN', 'M13', 'MFN_M13', '2.5.1', 'Arquivo mestre geral (teste)', '2000-01-01', ?, ?)`,
            [FONTE, agora],
          ),
        };
      const ponto = (estab: number) =>
        e.inserir(
          `INSERT INTO ponto_integracao (estabelecimento_id, codigo, nome, sistema_externo_id, padrao_troca_id, direcao,
             transporte, formato_conteudo, versao_padrao, ativo, criado_em)
           VALUES (?, ?, 'Triagem (teste) (saida)', ?, ?, 'saida', 'mllp', 'hl7v2', '2.5.1', TRUE, ?)`,
          [estab, PONTO, sis, padrao!['id'], agora],
        );
      const p1 = await ponto(est);
      const p2 = await ponto(est2);
      const conteudo = montarPerfisHl7(
        {
          aplicacaoOrigem: 'SGH',
          instituicaoOrigem: EST.toUpperCase(),
          aplicacaoDestino: SIS.toUpperCase(),
          dataHora: agora,
          controle: 'PRFc1027w00001125',
          processamento: 'T',
        },
        { versaoHl7: '2.5.1', separadorCampo: '|', caracteresCodificacao: '^~\\&', ativo: true },
        [
          { codigo: 'I', descricao: 'Idoso', condicao: 'idoso', ordem: 1 },
          { codigo: 'G', descricao: 'Gestante', condicao: 'gestante', ordem: 2 },
        ],
      );
      // As mesmas colunas que a porta da API grava no envio ativo dos perfis.
      const mensagem = (estab: number, pontoId: number, tipo: string, situacao: string, chave: string) =>
        e.inserir(
          `INSERT INTO mensagem_integracao_saida (estabelecimento_id, ponto_integracao_id, sistema_externo_id,
             evento_hl7_id, chave_idempotencia, correlacao, tipo_mensagem, formato, conteudo, hash_sha256, situacao,
             tentativas, tentativas_maximas, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'hl7v2', ?, ?, ?, 0, 5, ?)`,
          [
            estab,
            pontoId,
            sis,
            ev!['id'],
            chave,
            `perfis.${SIS}`,
            tipo,
            conteudo,
            sha(conteudo),
            situacao,
            agora,
          ],
        );
      return {
        est,
        est2,
        conteudo,
        perfis: await mensagem(
          est,
          p1,
          EVENTO_ENVIO_PERFIS_TRIAGEM,
          'pendente',
          `perfis:${SIS}:a:2026-11-25`,
        ),
        outroEst: await mensagem(
          est2,
          p2,
          EVENTO_ENVIO_PERFIS_TRIAGEM,
          'cancelada',
          `perfis:${SIS}:b:2026-11-25`,
        ),
        outroTipo: await mensagem(est, p1, 'integracao.outro', 'cancelada', `outro:${SIS}:2026-11-25`),
      };
    });
    acesso = acessoDoNucleo(nucleo, CLIENTE, 'teste-c1027w');
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${EST}` }, limpar);
    await nucleo.encerrar();
  }, 120_000);

  it('a fila traz a mensagem com o parceiro HL7 do sistema; o conteúdo é o gravado; outro estabelecimento ou tipo: nada', async () => {
    const fila = await acesso.ler(EST, (l) => porta.filaDeEnvio(l, EST));
    const nossa = fila.filter((f) => f.parceiro === PAR);
    expect(nossa.map((f) => [f.id, f.tipoEvento, f.situacao, f.chaveOrdem])).toEqual([
      [String(m.perfis), EVENTO_ENVIO_PERFIS_TRIAGEM, 'pendente', `perfis.${SIS}`],
    ]);
    const fila2 = await acesso.ler(EST2, (l) => porta.filaDeEnvio(l, EST2));
    expect(fila2.filter((f) => f.parceiro === PAR)).toEqual([]);

    const cfg: ConfiguracaoEnviadores = {
      ambiente: 'teste',
      produto: 'SGH',
      hostMllp: '127.0.0.1',
      simuladorRnds: null,
      destinoApi: () => null,
      ler: acesso.ler,
      agora: () => new Date(),
    };
    const parceiro = (await acesso.ler(EST, porta.lerParceiros)).find((p) => p.codigo === PAR)!;
    expect([parceiro.tipo, parceiro.canal]).toEqual(['hl7', CANAL]);
    expect(await conteudoHl7(cfg, parceiro, nossa[0]!, EST)).toBe(m.conteudo);
    expect(m.conteudo.startsWith('MSH|^~\\&|SGH|C1027W|C1027W-TRI|')).toBe(true);
    // Outro estabelecimento e outro tipo: o conteúdo dos perfis não sai (null), e o enviador recusa sem enviar.
    expect(await acesso.ler(EST, (l) => conteudoPerfisTriagem(l, EST, String(m.outroEst)))).toBeNull();
    expect(await acesso.ler(EST, (l) => conteudoPerfisTriagem(l, EST, String(m.outroTipo)))).toBeNull();
    expect(await acesso.ler(EST2, (l) => conteudoPerfisTriagem(l, EST2, String(m.perfis)))).toBeNull();
    await expect(conteudoHl7(cfg, parceiro, { ...nossa[0]!, id: String(m.outroEst) }, EST)).rejects.toThrow(
      ErroEntrega,
    );
  }, 60_000);

  it('o ciclo de entrega manda a MFN^M13 gravada por MLLP e grava a mensagem como enviada com o ACK', async () => {
    const r = await receptorMllp();
    try {
      const enviador = criarEnviador({
        ambiente: 'teste',
        produto: 'SGH',
        hostMllp: '127.0.0.1',
        simuladorRnds: null,
        destinoApi: () => null,
        ler: acesso.ler,
        agora: () => new Date(),
        portaDoCanal: (canal) => (canal === CANAL ? r.porta : 1),
      });
      const res = await cicloEntrega(acesso, EST, enviador, {
        agora: () => new Date(),
        tempoPorParceiroMs: 10_000,
      });
      expect(res).toMatchObject({ enviadas: 1, falhas: 0, mortas: 0 });
      expect(r.recebidas).toEqual([m.conteudo]);
      const [s] = await ler(
        'SELECT situacao, recibo, codigo_resposta, resposta, enviada_em FROM mensagem_integracao_saida WHERE id = ?',
        [m.perfis],
      );
      expect(s!['situacao']).toBe('enviada');
      expect(String(s!['recibo'] ?? s!['codigo_resposta'])).toBe('AA-PRFc1027w00001125');
      expect(s!['enviada_em']).not.toBeNull();
      // Nada saiu das mensagens canceladas nem do outro estabelecimento.
      const outras = await ler(
        'SELECT COUNT(*) AS n FROM mensagem_integracao_saida WHERE id IN (?, ?) AND situacao = ?',
        [m.outroEst, m.outroTipo, 'cancelada'],
      );
      expect(Number(outras[0]!['n'])).toBe(2);
    } finally {
      await new Promise((ok) => r.servidor.close(ok));
    }
  }, 60_000);
});
