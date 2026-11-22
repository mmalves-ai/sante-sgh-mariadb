// Integração da porta PRÓPRIA da comunicação (M27) contra o MariaDB real (cliente f22_o2 da onda 2), pelo serviço.
// Contrato de efeito: a mensagem (mensagem_interna e um destinatário por usuário, com a versão), os avisos de cada
// destinatário (notificacao_usuario, sem repetir o mesmo evento e objeto), a trilha sem o texto, a idempotência do
// pedido (o reenvio devolve a mesma mensagem), a leitura e a ciência (que resolve o aviso), o dicionário pelo Executor
// (linha, trilha e recusas) e as mensagens anteriores (origem 'migracao'). Recusas: dado do paciente no texto, destino
// sem conta ativa no estabelecimento, outro estabelecimento. Massa sintética, limpa no fim.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoComunicacao } from './aplicacao/comunicacao.js';
import {
  type MassaComunicacao,
  montarMassaComunicacao,
  SEM_BANCO,
} from './aplicacao/massa-comunicacao.spec-util.js';
import { PortaComunicacaoPropria } from './comunicacao-porta-propria.js';

describe.skipIf(SEM_BANCO)('porta própria da comunicação contra o MariaDB (cliente f22_o2)', () => {
  let m: MassaComunicacao;
  let porta: PortaComunicacaoPropria;
  let s: ServicoComunicacao;
  const autor = () => ({ login: m.login.rem, estacao: 'INT-M27', correlacao: 'int-m27-propria' });
  beforeAll(async () => {
    m = await montarMassaComunicacao('p');
    await m.limpar();
    porta = new PortaComunicacaoPropria(m.nucleo);
    s = new ServicoComunicacao(porta, null);
  });
  afterAll(async () => {
    await m?.limpar();
    await m?.nucleo.encerrar();
  });

  it('destinatários: só contas ativas com vínculo no estabelecimento; grupo pelo perfil vigente; teto', async () => {
    const r = await porta.destinatarios(
      m.ctx('rem'),
      [
        { tipo: 'usuario', valor: m.login.d1 },
        { tipo: 'grupo', valor: m.grupo },
        { tipo: 'usuario', valor: m.login.outro },
        { tipo: 'usuario', valor: m.login.inativo },
      ],
      10,
    );
    expect(r.destinatarios.map((d) => d.login).sort()).toEqual([m.login.d1, m.login.d2].sort());
    expect(r.destinatarios.find((d) => d.login === m.login.d2)?.via).toBe(`grupo ${m.grupo}`);
    expect(r.desconhecidos).toEqual([`usuario ${m.login.outro}`, `usuario ${m.login.inativo}`]);
    expect((await porta.destinatarios(m.ctx('rem'), [{ tipo: 'grupo', valor: m.grupo }], 1)).passou).toBe(
      true,
    );
  });

  it('envia: linhas, avisos, trilha sem o texto e idempotência do pedido; leitura e ciência', async () => {
    const pedido = `int-m27-env-${Date.now()}`;
    const e = {
      assunto: 'Assunto de teste',
      texto: 'Texto sintético que não pode ir à trilha',
      destinos: [{ tipo: 'grupo' as const, valor: m.grupo }],
      cienciaObrigatoria: true,
      contextoAtendimento: null,
    };
    await expect(
      s.enviar(m.ctx('rem'), autor(), { ...e, texto: 'CPF 123.456.789-09 do paciente' }, `${pedido}-cpf`),
    ).rejects.toMatchObject({ extras: { codigo: 'dado-do-paciente' } });
    const r = await s.enviar(m.ctx('rem'), autor(), e, pedido);
    expect(r).toMatchObject({ destinatarios: 2, repetida: false });
    expect(await s.enviar(m.ctx('rem'), autor(), e, pedido)).toMatchObject({ id: r.id, repetida: true });
    // A mesma chave com outro conteúdo não devolve a mensagem antiga: é recusada e nada é gravado.
    await expect(
      s.enviar(m.ctx('rem'), autor(), { ...e, texto: 'Outro texto sintético' }, pedido),
    ).rejects.toMatchObject({ problema: { codigo: 'idempotencia-divergente' } });
    const quantas = await m.ler(
      'SELECT COUNT(*) AS n FROM mensagem_interna WHERE estabelecimento_id = ? AND id >= ?',
      [m.estA, r.id],
    );
    expect(Number(quantas[0]?.['n'])).toBe(1);
    const [msg] = await m.ler(
      'SELECT situacao, solicita_resposta, versao, estabelecimento_id FROM mensagem_interna WHERE id = ?',
      [r.id],
    );
    expect(msg).toMatchObject({ situacao: 'enviada', versao: 1 });
    expect(Number(msg?.['estabelecimento_id'])).toBe(m.estA);
    const ds = await m.ler(
      'SELECT lida, versao FROM mensagem_interna_destinatario WHERE mensagem_interna_id = ?',
      [r.id],
    );
    expect(ds.length).toBe(2);
    const av = await m.ler(
      'SELECT usuario_id, gravidade, lida FROM notificacao_usuario WHERE link = ? AND estabelecimento_id = ?',
      [`/mensagens?id=${r.id}`, m.estA],
    );
    expect(av.length).toBe(2);
    expect(av[0]).toMatchObject({ gravidade: 'atencao' });
    const tr = await m.ler(
      "SELECT dados_depois, estabelecimento_id, usuario_id FROM trilha_auditoria WHERE entidade = 'mensagem_interna' AND entidade_id = ?",
      [r.id],
    );
    expect(tr.length).toBe(1);
    expect(Number(tr[0]?.['usuario_id'])).toBe(m.id.rem);
    expect(String(tr[0]?.['dados_depois'])).not.toContain('Texto sintético');
    const idem = await m.ler(
      "SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'acesso.enviar-mensagem' AND chave = ?",
      [`mensagem:${pedido}`],
    );
    expect(Number(idem[0]?.['n'])).toBe(1);

    // d1 abre e dá ciência: a leitura, a resposta e o aviso resolvido; enviadas com as contagens.
    const caixa = await s.caixa(m.ctx('d1'), m.login.d1);
    expect(caixa.recebidas.find((x) => x.id === r.id && x.tipo === 'mensagem')).toMatchObject({
      remetente: m.login.rem,
      cienciaObrigatoria: true,
      lidaEm: null,
    });
    const d1 = { ...autor(), login: m.login.d1 };
    expect((await s.abrir(m.ctx('d1'), d1, r.id, 'mensagem')).lidaEm).not.toBeNull();
    expect((await s.ciencia(m.ctx('d1'), d1, r.id, 'mensagem')).cienciaEm).not.toBeNull();
    const central = await s.avisos(m.ctx('d1'), m.login.d1, 0);
    expect(central.avisos.find((x) => x.link === `/mensagens?id=${r.id}`)?.estado).toBe('resolvido');
    const enviada = (await s.caixa(m.ctx('rem'), m.login.rem)).enviadas.find((x) => x.id === r.id);
    expect(enviada).toMatchObject({ destinatarios: 2, lidas: 1, ciencias: 1 });

    // Outro estabelecimento não vê a mensagem.
    expect(await porta.recebida(m.ctx('d1', 'B'), m.login.d1, r.id, 'mensagem')).toBeNull();
    await expect(s.abrir(m.ctx('d1', 'B'), d1, r.id, 'mensagem')).rejects.toMatchObject({ status: 404 });
  });

  it('central de avisos: sem repetição do mesmo evento e objeto; lido e resolvido', async () => {
    const novo = {
      login: m.login.d2,
      tipo: 'resultado-liberado',
      gravidade: 'informacao' as const,
      modulo: 'sadt',
      evento: 'sadt.resultado.liberado',
      titulo: 'Resultado liberado (teste)',
      link: '/exames',
      objetoTabela: 'resultado_exame',
      objetoChave: '42',
    };
    const id = await s.emitir(m.ctx('rem'), autor(), novo);
    expect(id).not.toBeNull();
    expect(await s.emitir(m.ctx('rem'), autor(), novo)).toBeNull();
    const d2 = { ...autor(), login: m.login.d2 };
    expect(await s.mudarAviso(m.ctx('d2'), d2, id!, 'lido')).toBe(true);
    expect(await s.mudarAviso(m.ctx('d2'), d2, id!, 'lido')).toBe(false);
    expect(await s.mudarAviso(m.ctx('d2'), d2, id!, 'resolvido')).toBe(true);
    const [a] = await m.ler(
      'SELECT lida, resolvida, versao, detalhes FROM notificacao_usuario WHERE id = ?',
      [id],
    );
    expect(Number(a?.['versao'])).toBe(3);
    expect(String(a?.['detalhes'])).toContain('resultado-liberado');
    await expect(
      s.mudarAviso(m.ctx('d1'), { ...autor(), login: m.login.d1 }, id!, 'lido'),
    ).rejects.toMatchObject({
      problema: { codigo: 'aviso-inexistente' },
    });
  });

  it('ciência do comunicado resolve só o aviso do comunicado, não o da mensagem com o mesmo número', async () => {
    const agora = Date.now();
    const r = await s.publicar(
      m.ctx('rem'),
      autor(),
      {
        assunto: 'Comunicado para ciência',
        texto: 'Texto sintético do comunicado.',
        destinos: [{ tipo: 'usuario', valor: m.login.d1 }],
        cienciaObrigatoria: true,
        vigenciaInicio: new Date(agora - 60_000).toISOString(),
        vigenciaFim: new Date(agora + 86_400_000).toISOString(),
      },
      `int-m27-colisao-${agora}`,
    );
    const aviso = (objetoTabela: string, evento: string) =>
      s.emitir(m.ctx('rem'), autor(), {
        login: m.login.d1,
        tipo: 'ciencia-pendente',
        gravidade: 'atencao',
        modulo: 'acesso',
        evento,
        titulo: 'Aviso sintético',
        link: `/mensagens?id=${r.id}`,
        objetoTabela,
        objetoChave: String(r.id),
      });
    // O aviso de uma mensagem direta com o mesmo número (ids de tabelas diferentes) e o aviso do comunicado.
    const daMensagem = await aviso('mensagem_interna', 'acesso.mensagem.enviada');
    const doComunicado = await aviso('comunicado', 'acesso.comunicado.publicado');
    await s.ciencia(m.ctx('d1'), { ...autor(), login: m.login.d1 }, r.id, 'comunicado');
    const linhas = await m.ler(
      'SELECT id, resolvida, resolvida_por_usuario_id FROM notificacao_usuario WHERE id IN (?, ?)',
      [daMensagem, doComunicado],
    );
    const de = (id: number | null) => linhas.find((x) => Number(x['id']) === id);
    expect(Number(de(doComunicado)?.['resolvida'])).toBe(1);
    expect(Number(de(doComunicado)?.['resolvida_por_usuario_id'])).toBe(m.id.d1);
    expect(Number(de(daMensagem)?.['resolvida'])).toBe(0);
  });

  it('dicionário pelo Executor: linha, idempotência, recusas e exclusão', async () => {
    const k = `int-m27-dic-${Date.now()}`;
    expect(await s.gravarPalavra(m.ctx('d1'), 'incluir', 'Ecocardiograma', m.octx('d1', `${k}-1`))).toEqual({
      repetida: false,
    });
    expect(await s.gravarPalavra(m.ctx('d1'), 'incluir', 'Ecocardiograma', m.octx('d1', `${k}-1`))).toEqual({
      repetida: true,
    });
    await expect(
      s.gravarPalavra(m.ctx('d1'), 'incluir', 'Ecocardiograma', m.octx('d1', `${k}-2`)),
    ).rejects.toMatchObject({ problema: { codigo: 'palavra-existente' } });
    const dic = await s.dicionario(m.ctx('d1'), m.login.d1);
    expect(dic.palavras.length).toBe(1);
    expect(dic.palavras[0]?.fonetica).not.toBe('');
    expect(dic.gravacao).toEqual({ incluir: null, excluir: null });
    const tr = await m.ler(
      "SELECT acao FROM trilha_auditoria WHERE entidade = 'dicionario_usuario' AND usuario_id = ? ORDER BY id DESC LIMIT 1",
      [m.id.d1],
    );
    expect(tr[0]?.['acao']).toBe('inclusao');
    await s.gravarPalavra(m.ctx('d1'), 'excluir', 'Ecocardiograma', m.octx('d1', `${k}-3`));
    expect((await s.dicionario(m.ctx('d1'), m.login.d1)).palavras).toEqual([]);
    await expect(
      s.gravarPalavra(m.ctx('d1'), 'excluir', 'Ecocardiograma', m.octx('d1', `${k}-4`)),
    ).rejects.toMatchObject({ problema: { codigo: 'palavra-inexistente' } });
  });

  it('mensagens anteriores: só as trazidas pelo conector, fora da caixa', async () => {
    const agora = new Date();
    const id = await m.nucleo.escrever(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2', correlacao: 'f2201-anterior' },
      async (e) => {
        const mid = await e.inserir(
          `INSERT INTO mensagem_interna (estabelecimento_id, remetente_usuario_id, assunto, texto, situacao, enviada_em,
           origem, criado_em) VALUES (?, ?, 'Anterior', 'Mensagem sintética anterior', 'enviada', ?, 'migracao', ?)`,
          [m.estA, m.id.rem, agora, agora],
        );
        await e.inserir(
          `INSERT INTO mensagem_interna_destinatario (mensagem_interna_id, sequencia, destinatario_usuario_id, origem,
           criado_em) VALUES (?, 1, ?, 'migracao', ?)`,
          [mid, m.id.d2, agora],
        );
        return mid;
      },
    );
    const anteriores = await s.anteriores(m.ctx('d2'), m.login.d2);
    expect(anteriores.find((x) => x.sequencia === id)).toMatchObject({ origem: m.login.rem, lidaEm: null });
    expect(
      (await s.caixa(m.ctx('d2'), m.login.d2)).recebidas.some((x) => x.id === id && x.tipo === 'mensagem'),
    ).toBe(false);
  });
});
