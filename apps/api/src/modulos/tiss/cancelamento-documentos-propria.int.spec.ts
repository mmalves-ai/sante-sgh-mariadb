// Contrato de efeito do cancelamento de guia enviada e do envio de documentos anexos (06-FAT linha 28) contra o MariaDB
// real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste e guias fictícias; conta, paciente,
// fonte pagadora e usuário são ids já existentes do cliente (só lidos). Os arquivos ficam numa porta de arquivos de
// teste que grava o metadado na tabela `arquivo` e guarda o conteúdo na memória.
// Prova o que fica no banco: o pedido em rascunho com os itens pendentes; a guia não enviada recusada; o envio com a
// CANCELA_GUIA; o recibo com a guia cancelada (e a guia 'cancelada'), a outra em análise e o retorno complementar; o
// descarte do rascunho; o envio de documentos com número, tipo e formato no padrão; a ENVIO_DOCUMENTO; o recibo com
// protocolo e recusa. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import { PortaCancelamentoDocumentosTissPropria } from './cancelamento-documentos-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2091cd';

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo = ?';
  await e.executar(
    `DELETE i FROM envio_documento_tiss_item i JOIN envio_documento_tiss d ON d.id = i.envio_documento_tiss_id
      WHERE d.estabelecimento_id IN (${est})`,
    [P],
  );
  await e.executar(`DELETE FROM envio_documento_tiss WHERE estabelecimento_id IN (${est})`, [P]);
  await e.executar(
    `DELETE i FROM cancelamento_guia_item i JOIN cancelamento_guia c ON c.id = i.cancelamento_guia_id
      WHERE c.estabelecimento_id IN (${est})`,
    [P],
  );
  await e.executar(`DELETE FROM cancelamento_guia WHERE estabelecimento_id IN (${est})`, [P]);
  await e.executar(`DELETE FROM guia_tiss WHERE estabelecimento_id IN (${est})`, [P]);
  await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN (${est})`, [P]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)(
  'PortaCancelamentoDocumentosTissPropria contra o MariaDB (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaCancelamentoDocumentosTissPropria;
    let m: { usuario: number; est: number; conta: number; guias: number[]; naoEnviada: number };
    const conteudos = new Map<number, Buffer>();
    const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
    const um = async (sql: string, p: unknown[] = []) =>
      (await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)))[0]!;
    const todos = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
        const conta = await e.uma(
          'SELECT id, paciente_id, fonte_pagadora_id FROM conta_hospitalar ORDER BY id LIMIT 1',
        );
        if (!usuario?.['id'] || !conta?.['id'])
          throw new Error('O cliente de teste precisa de usuário e conta.');
        const est = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
        );
        const guia = (n: string, situacao: string) =>
          e.inserir(
            `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
             numero_guia_prestador, numero_guia_operadora, registro_ans, codigo_prestador_operadora, data_emissao,
             situacao, criado_em)
           VALUES (?, ?, 'sp_sadt', ?, ?, ?, ?, '999999', 'PRESTTESTE01', '2026-11-01', ?, ?)`,
            [
              est,
              conta['id'],
              conta['fonte_pagadora_id'],
              conta['paciente_id'],
              `${P}-${n}`,
              `OP${n}`,
              situacao,
              agora,
            ],
          );
        return {
          usuario: Number(usuario['id']),
          est,
          conta: Number(conta['id']),
          guias: [await guia('1', 'enviada'), await guia('2', 'aceita')],
          naoEnviada: await guia('3', 'em_lote'),
        };
      });
      const arquivos: Pick<ArquivosDoModulo, 'guardar' | 'ler'> = {
        async guardar(_h, e) {
          const conteudo = Buffer.from(e.conteudo);
          const id = await nucleo.escrever({ cliente: CLIENTE, correlacao: `arq-${P}` }, (w) =>
            w.inserir(
              `INSERT INTO arquivo (estabelecimento_id, entidade, finalidade, nome_original, tipo_mime, tamanho_bytes,
               hash_sha256, chave_armazenamento, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                m.est,
                e.entidade ?? null,
                e.finalidade,
                e.nomeOriginal,
                e.tipoMime,
                conteudo.length,
                createHash('sha256').update(conteudo).digest('hex'),
                `teste/${P}/${Date.now()}-${Math.random()}`,
                new Date(),
              ],
            ),
          );
          conteudos.set(id, conteudo);
          return { id, hash: '', reaproveitado: false };
        },
        async ler(_h, id) {
          const c = conteudos.get(id);
          return c ? { metadado: {} as never, conteudo: c } : null;
        },
      };
      porta = new PortaCancelamentoDocumentosTissPropria(nucleo, CLIENTE, arquivos as ArquivosDoModulo);
    }, 60_000);

    afterAll(async () => {
      if (nucleo) {
        await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
        await nucleo.encerrar();
      }
    });

    it('pedido, envio da CANCELA_GUIA, recibo guia a guia e retorno complementar', async () => {
      await expect(
        porta.solicitarCancelamento(ctx(), { guias: [m.naoEnviada], motivo: 'Guia emitida em duplicidade' }),
      ).rejects.toMatchObject({ problema: { status: 422 } });

      const p = await porta.solicitarCancelamento(ctx(), {
        guias: m.guias,
        motivo: 'Guia emitida em duplicidade',
      });
      expect(p.guias).toBe(2);
      const cg = await um('SELECT * FROM cancelamento_guia WHERE id = ?', [p.id]);
      expect(cg).toMatchObject({
        situacao: 'rascunho',
        motivo: 'Guia emitida em duplicidade',
        enviado_em: null,
      });
      expect(Number(cg['solicitado_por_usuario_id'])).toBe(m.usuario);
      const itens = await todos(
        'SELECT id, sequencia, guia_tiss_id, situacao FROM cancelamento_guia_item WHERE cancelamento_guia_id = ? ORDER BY sequencia',
        [p.id],
      );
      expect(itens.map((i) => [Number(i['guia_tiss_id']), i['situacao']])).toEqual([
        [m.guias[0], 'pendente'],
        [m.guias[1], 'pendente'],
      ]);
      // A guia num pedido vivo não entra em outro.
      await expect(
        porta.solicitarCancelamento(ctx(), { guias: [m.guias[0]!], motivo: 'Outro pedido da mesma guia' }),
      ).rejects.toMatchObject({ problema: { status: 422 } });

      const env = await porta.enviarCancelamento(ctx(), p.id, { versao: 1 });
      expect(env.situacao).toBe('enviado');
      expect(env.xml).toContain('<ans:tipoTransacao>CANCELA_GUIA</ans:tipoTransacao>');
      expect(env.xml).toContain(`<ans:numeroGuiaPrestador>${P}-1</ans:numeroGuiaPrestador>`);
      expect(
        (await um('SELECT enviado_em FROM cancelamento_guia WHERE id = ?', [p.id]))['enviado_em'],
      ).not.toBeNull();

      const [a, b] = itens.map((i) => Number(i['id']));
      const r = await porta.reciboCancelamento(ctx(), p.id, {
        versao: 2,
        protocolo: 'PROTCANC01',
        guias: [
          { item: a, status: '1' },
          { item: b, status: '4' },
        ],
      });
      expect(r).toMatchObject({ situacao: 'processado', canceladas: 1 });
      expect(
        await um('SELECT situacao, protocolo_operadora FROM cancelamento_guia WHERE id = ?', [p.id]),
      ).toMatchObject({
        situacao: 'processado',
        protocolo_operadora: 'PROTCANC01',
      });
      expect((await um('SELECT situacao FROM guia_tiss WHERE id = ?', [m.guias[0]]))['situacao']).toBe(
        'cancelada',
      );
      expect((await um('SELECT situacao FROM guia_tiss WHERE id = ?', [m.guias[1]]))['situacao']).toBe(
        'aceita',
      );
      expect(
        await um('SELECT situacao, retorno_codigo FROM cancelamento_guia_item WHERE id = ?', [b]),
      ).toMatchObject({
        situacao: 'em_analise',
        retorno_codigo: '4',
      });

      await porta.reciboCancelamento(ctx(), p.id, { versao: 3, guias: [{ item: b, status: '2' }] });
      expect((await um('SELECT situacao FROM cancelamento_guia_item WHERE id = ?', [b]))['situacao']).toBe(
        'nao_cancelada',
      );
      await expect(
        porta.reciboCancelamento(ctx(), p.id, { versao: 4, guias: [{ item: b, status: '1' }] }),
      ).rejects.toMatchObject({ problema: { status: 422 } });

      // A guia não cancelada volta a poder entrar num pedido; o rascunho é descartado sem apagar nada.
      const d = await porta.solicitarCancelamento(ctx(), {
        guias: [m.guias[1]!],
        motivo: 'Novo pedido da guia',
      });
      await porta.descartarCancelamento(ctx(), d.id, { versao: 1 });
      const desc = await um(
        'SELECT situacao, descartado_em, descartado_por_usuario_id FROM cancelamento_guia WHERE id = ?',
        [d.id],
      );
      expect(desc['situacao']).toBe('descartado');
      expect(desc['descartado_em']).not.toBeNull();
      expect(Number(desc['descartado_por_usuario_id'])).toBe(m.usuario);

      const visao = await porta.daGuia(ctx(), m.guias[1]!);
      expect(visao.cancelamentos.map((x) => x.situacao)).toEqual(['descartado', 'processado']);

      // A visão pela conta (a lista de guias mostra a conta): as três guias do estabelecimento, cada uma com os pedidos.
      const daConta = await porta.daConta(ctx(), m.conta);
      expect(daConta.guias.map((x) => x.guia.id)).toEqual([...m.guias, m.naoEnviada]);
      expect(daConta.guias[1]!.cancelamentos.map((x) => x.situacao)).toEqual(['descartado', 'processado']);
    });

    it('envio de documentos: registro, ENVIO_DOCUMENTO, recibo com protocolo e recusa', async () => {
      await expect(
        porta.registrarEnvio(ctx(), {
          guia: m.guias[1]!,
          documentos: [
            { nome: 'x.txt', tipoMime: 'text/plain', conteudoBase64: 'eA==', tipoDocumento: '02' },
          ],
        }),
      ).rejects.toMatchObject({ problema: { status: 422 } });

      const pdf = Buffer.from('%PDF-1.4 sintetico').toString('base64');
      const png = Buffer.from('PNG sintetico').toString('base64');
      const r = await porta.registrarEnvio(ctx(), {
        guia: m.guias[1]!,
        observacao: 'Laudos da guia',
        documentos: [
          { nome: 'laudo.pdf', tipoMime: 'application/pdf', conteudoBase64: pdf, tipoDocumento: '02' },
          {
            nome: 'exame.png',
            tipoMime: 'image/png',
            conteudoBase64: png,
            tipoDocumento: '12',
            observacao: 'Imagem',
          },
        ],
      });
      expect(r).toMatchObject({ numero: 'D0000001', documentos: 2 });
      expect(await um('SELECT * FROM envio_documento_tiss WHERE id = ?', [r.id])).toMatchObject({
        situacao: 'rascunho',
        numero_envio: 'D0000001',
        tipo_guia: 'sp_sadt',
        numero_guia_prestador: `${P}-2`,
        numero_guia_operadora: 'OP2',
      });
      const itens = await todos(
        `SELECT id, sequencia, tipo_documento_tiss, formato_documento_tiss, numero_documento, situacao
         FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ? ORDER BY sequencia`,
        [r.id],
      );
      expect(
        itens.map((i) => [
          i['tipo_documento_tiss'],
          i['formato_documento_tiss'],
          i['numero_documento'],
          i['situacao'],
        ]),
      ).toEqual([
        ['02', '02', 'D0000001-1', 'pendente'],
        ['12', '03', 'D0000001-2', 'pendente'],
      ]);

      const env = await porta.enviarDocumentos(ctx(), r.id, { versao: 1 });
      expect(env.mensagens).toHaveLength(2);
      expect(env.mensagens[0]!.xml).toContain('<ans:tipoTransacao>ENVIO_DOCUMENTO</ans:tipoTransacao>');
      expect(env.mensagens[0]!.xml).toContain(`<ans:documento>${pdf}</ans:documento>`);
      expect(
        (
          await todos('SELECT situacao FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ?', [
            r.id,
          ])
        ).map((x) => x['situacao']),
      ).toEqual(['enviado', 'enviado']);

      const [a, b] = itens.map((i) => Number(i['id']));
      expect(
        (
          await porta.reciboDocumentos(ctx(), r.id, {
            versao: 2,
            documentos: [{ item: a, protocolo: 'PDOC1' }],
          })
        ).situacao,
      ).toBe('enviado');
      expect(
        (
          await porta.reciboDocumentos(ctx(), r.id, {
            versao: 3,
            protocolo: 'PRET01',
            documentos: [{ item: b, erro: 'Ilegível' }],
          })
        ).situacao,
      ).toBe('recebido');
      const fim = await um(
        'SELECT situacao, retorno_em, numero_protocolo_retorno FROM envio_documento_tiss WHERE id = ?',
        [r.id],
      );
      expect(fim).toMatchObject({ situacao: 'recebido', numero_protocolo_retorno: 'PRET01' });
      expect(fim['retorno_em']).not.toBeNull();
      expect(
        await todos(
          'SELECT situacao, numero_protocolo_documento, observacao FROM envio_documento_tiss_item WHERE envio_documento_tiss_id = ? ORDER BY sequencia',
          [r.id],
        ),
      ).toEqual([
        { situacao: 'aceito', numero_protocolo_documento: 'PDOC1', observacao: null },
        { situacao: 'rejeitado', numero_protocolo_documento: null, observacao: 'Ilegível' },
      ]);

      // O rascunho é cancelado; o envio que já saiu, não.
      const outro = await porta.registrarEnvio(ctx(), {
        guia: m.guias[1]!,
        documentos: [
          { nome: 'laudo.pdf', tipoMime: 'application/pdf', conteudoBase64: pdf, tipoDocumento: '04' },
        ],
      });
      await porta.cancelarEnvio(ctx(), outro.id, { versao: 1 });
      expect(
        (await um('SELECT situacao FROM envio_documento_tiss WHERE id = ?', [outro.id]))['situacao'],
      ).toBe('cancelado');
      await expect(porta.cancelarEnvio(ctx(), r.id, { versao: 4 })).rejects.toMatchObject({
        problema: { status: 422 },
      });
      const visao = await porta.daGuia(ctx(), m.guias[1]!);
      expect(visao.envios.map((x) => x.situacao)).toEqual(['cancelado', 'recebido']);
    });
  },
);
