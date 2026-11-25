// Integração da porta própria da lista de trabalho DICOM contra o MariaDB real (cliente f22_o2; massa SINTÉTICA).
// Contrato de efeito: o item (um por exame; o número de acesso pelo id; a modalidade do cadastro) e a mensagem ao PACS
// na fila de integração ligada a ele, com a trilha; o item repetido recusado; o reenvio com o mesmo número de acesso e a
// quantidade de envios conferida (409 se mudou); o status como mensagem de entrada, idempotente pela chave, o estudo
// arquivado em estudo_imagem e o status vigente sem regredir; outro estabelecimento não vê o item.
import { accessionDoItem, chaveIdempotenciaMwl } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import type { ContextoPacs } from './pacs-porta.js';
import { instanteCivil } from '../exames/relogio.js';
import { PortaPacsPropria } from './pacs-porta-propria.js';
import { PortaSadtPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('porta própria da lista de trabalho DICOM (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPacsPropria;
  let m: MassaSadt | null = null;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s09pac' }, (l) => l.uma(sql, p));
  const ctx = (est?: number) => contexto(m!, est) as ContextoPacs;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S9W');
    porta = new PortaPacsPropria(nucleo, new PortaSadtPropria(nucleo));
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('o exame pedido à noite é do dia civil do estabelecimento (o instante gravado já é o dia seguinte em UTC)', async () => {
    const c = ctx();
    const escrever = (sql: string, p: unknown[]) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: `t-${m!.marca}` }, (e) => e.executar(sql, p));
    const antes = await um('SELECT solicitado_em AS s FROM requisicao_exame WHERE id = ?', [
      m!.requisicaoImagem,
    ]);
    const fuso =
      String(
        (await um('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [m!.base.est]))?.['f'] ?? '',
      ) || 'America/Sao_Paulo';
    // 22:30 do dia 09/03 no fuso do estabelecimento (em UTC, a madrugada do dia 10 para os fusos do Brasil).
    const noite = instanteCivil('2026-03-09', '22:30', fuso);
    await escrever('UPDATE requisicao_exame SET solicitado_em = ? WHERE id = ?', [
      noite,
      m!.requisicaoImagem,
    ]);
    try {
      const doDia = (dia: string) =>
        porta.examesSemItem(c, { desde: dia, ate: dia, atos: [25], teto: 10 }).then((r) => r.itens);
      expect(await doDia('2026-03-09')).toEqual([{ exame: m!.itemImagem, ato: 25, data: '2026-03-09' }]);
      expect(await doDia('2026-03-10')).toEqual([]);
      expect(await doDia('2026-03-08')).toEqual([]);
    } finally {
      await escrever('UPDATE requisicao_exame SET solicitado_em = ? WHERE id = ?', [
        antes!['s'],
        m!.requisicaoImagem,
      ]);
    }
  });

  it('item com mensagem na fila, repetido recusado, reenvio conferido e status idempotente', async () => {
    const c = ctx();
    const { hoje } = await porta.relogio(c);
    expect((await porta.examesDoDia(c, hoje)).itens.map((x) => x.id)).toEqual([m!.itemImagem]);
    expect((await porta.examesSemItem(c, { desde: hoje, ate: hoje, atos: [25], teto: 10 })).itens).toEqual([
      { exame: m!.itemImagem, ato: 25, data: hoje },
    ]);
    const cad = await porta.modalidadeDoCadastro(c, [m!.itemImagem]);
    expect(cad.get(m!.itemImagem)).toEqual({ id: m!.modalidade, sigla: 'CT' });
    expect((await porta.modalidades(c)).some((x) => x.sigla === 'CT')).toBe(true);

    const registrar = () =>
      porta.gravarSgh(
        c,
        (r: { id: number }) => linhaTela(m!, 'sadt.mwl.enviada', 'item_lista_trabalho_imagem', r.id),
        (g) =>
          g.registrarItem({
            exame: m!.itemImagem,
            paciente: m!.base.paciente,
            chaveNatural: 'x',
            ato: 25,
            modalidade: cad.get(m!.itemImagem)!,
            accession: (n) => accessionDoItem(c.hospital, n),
            chaveIdempotencia: chaveIdempotenciaMwl(c.hospital, m!.itemImagem),
            origem: 'manual',
            por: m!.base.login,
          }),
      );
    const r = await registrar();
    expect(r.accession).toBe(accessionDoItem(c.hospital, r.id));
    expect(
      await um(
        'SELECT numero_acesso, quantidade_envios, situacao, integracao_mensagem_id FROM item_lista_trabalho_imagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      numero_acesso: r.accession,
      quantidade_envios: 1,
      situacao: 'na_fila',
      integracao_mensagem_id: Number(r.outbox),
    });
    expect(
      await um('SELECT direcao, situacao, ponto FROM integracao_mensagem WHERE id = ?', [Number(r.outbox)]),
    ).toMatchObject({
      direcao: 'saida',
      situacao: 'pendente',
      ponto: 'imagem.mwl',
    });
    expect(codigoDe(await registrar().catch((e: unknown) => e))).toBe('ja-na-worklist');
    const [i] = await porta.itens(c, [m!.itemImagem]);
    expect(i).toMatchObject({
      id: r.id,
      modalidade: 'CT',
      ato: 25,
      envios: 1,
      entrega: { situacao: 'pendente' },
    });
    expect(await porta.itens(ctx(m!.base.outroEst), [m!.itemImagem])).toEqual([]);
    expect((await porta.item(c, { accession: r.accession }))?.id).toBe(r.id);
    expect((await porta.itensDoPaciente(c, m!.base.paciente)).map((x) => x.id)).toEqual([r.id]);

    const reenviar = (envios: number) =>
      porta.gravarSgh(c, linhaTela(m!, 'sadt.mwl.enviada', 'item_lista_trabalho_imagem', r.id), (g) =>
        g.reenviar({
          id: r.id,
          envios,
          exame: m!.itemImagem,
          accession: r.accession,
          modalidade: 'CT',
          por: m!.base.login,
        }),
      );
    expect(await reenviar(1)).toMatchObject({ id: r.id, envios: 2 });
    expect(codigoDe(await reenviar(1).catch((e: unknown) => e))).toBe('conflito-versao');

    const status = (st: 'em-andamento' | 'concluido', chave: string, cs: ContextoPacs = c) =>
      porta.gravarSgh(cs, linhaTela(m!, 'sadt.estudo.status', 'integracao_mensagem', null), (g) =>
        g.registrarStatus({
          mwl: r.id,
          exame: m!.itemImagem,
          accession: r.accession,
          status: st,
          uidEstudo: '1.2.826.0.1.3680043.10.999',
          uidMpps: null,
          ocorridoEm: `${hoje}T10:00`,
          visualizador: null,
          chaveMensagem: chave,
          origem: 'simulador',
          por: m!.base.login,
        }),
      );
    const s1 = await status('concluido', `${m!.marca}-m1`);
    expect(s1.repetida).toBe(false);
    expect((await status('concluido', `${m!.marca}-m1`)).repetida).toBe(true);
    // A entrada do PACS (sem sessão): o contexto do estabelecimento sem usuário grava a mensagem e a trilha.
    const semUsuario = await status('em-andamento', `${m!.marca}-m2`, { ...c, usuario: null });
    expect(semUsuario.repetida).toBe(false);
    expect(
      await um(
        "SELECT criado_por, direcao FROM integracao_mensagem WHERE ponto <> 'imagem.mwl' AND referencia_externa = ?",
        [`${m!.marca}-m2`],
      ),
    ).toMatchObject({ criado_por: null, direcao: 'entrada' });
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'integracao_mensagem' AND correlacao = ? AND usuario_id IS NULL",
            [c.correlacao.slice(0, 64)],
          )
        )?.['n'],
      ),
    ).toBeGreaterThan(0);
    expect(
      await um(
        'SELECT situacao_estudo, uid_estudo, estudo_imagem_id IS NOT NULL AS e FROM item_lista_trabalho_imagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao_estudo: 'concluido',
      uid_estudo: '1.2.826.0.1.3680043.10.999',
      e: 1,
    });
    expect(
      await um('SELECT situacao, numero_acesso FROM estudo_imagem WHERE exame_item_id = ?', [m!.itemImagem]),
    ).toMatchObject({
      situacao: 'concluido',
      numero_acesso: r.accession,
    });
    const ss = await porta.status(c, [m!.itemImagem]);
    expect(ss.map((x) => x.status)).toEqual(['concluido', 'em-andamento']);
    expect(ss[0]).toMatchObject({
      mwl: r.id,
      exame: m!.itemImagem,
      origem: 'simulador',
      chaveMensagem: `${m!.marca}-m1`,
    });
  });
});
