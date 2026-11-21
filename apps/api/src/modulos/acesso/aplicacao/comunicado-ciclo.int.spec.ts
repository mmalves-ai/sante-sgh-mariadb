// W0-09 contra o MariaDB (cliente de teste f22_o2): o ciclo de vida do comunicado na porta própria. Contrato de efeito:
// publicação (comunicado, público por usuário, trilha sem o texto, idempotência do pedido), correção antes da leitura
// (motivo, tamanho e resumo do anterior no evento da trilha, nunca o texto), recusa da correção depois da primeira leitura, vigência só encurtada,
// encerramento com motivo (some de quem não leu, continua para quem leu, sem ciência nova). Massa sintética.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaComunicacaoPropria } from '../comunicacao-porta-propria.js';
import { ServicoComunicacao } from './comunicacao.js';
import { type MassaComunicacao, montarMassaComunicacao, SEM_BANCO } from './massa-comunicacao.spec-util.js';

describe.skipIf(SEM_BANCO)('ciclo do comunicado sobre o banco próprio (f22_o2)', () => {
  let m: MassaComunicacao;
  let s: ServicoComunicacao;
  beforeAll(async () => {
    m = await montarMassaComunicacao('c');
    await m.limpar();
    s = new ServicoComunicacao(new PortaComunicacaoPropria(m.nucleo), null);
  });
  afterAll(async () => {
    await m?.limpar();
    await m?.nucleo.encerrar();
  });

  it('publica, corrige antes da leitura, recusa depois, encurta a vigência e encerra com motivo', async () => {
    const autor = { login: m.login.rem, estacao: 'INT-W009', correlacao: 'int-w009' };
    const agora = Date.now();
    const pedido = `int-w009-${agora}`;
    const e = {
      assunto: 'Comunicado de teste',
      texto: 'Texto sintético do comunicado que não vai à trilha.',
      destinos: [{ tipo: 'grupo' as const, valor: m.grupo }],
      cienciaObrigatoria: true,
      vigenciaInicio: new Date(agora - 3_600_000).toISOString(),
      vigenciaFim: new Date(agora + 10 * 86_400_000).toISOString(),
    };
    const r = await s.publicar(m.ctx('rem'), autor, e, pedido);
    expect(r).toMatchObject({ destinatarios: 2, repetida: false });
    expect(await s.publicar(m.ctx('rem'), autor, e, pedido)).toMatchObject({ id: r.id, repetida: true });
    const [k] = await m.ler('SELECT situacao, exige_ciencia, versao FROM comunicado WHERE id = ?', [r.id]);
    expect(k).toMatchObject({ situacao: 'publicado', versao: 1 });
    const pub = await m.ler('SELECT COUNT(*) AS n FROM comunicado_destinatario WHERE comunicado_id = ?', [r.id]);
    expect(Number(pub[0]?.['n'])).toBe(2);
    const tr = await m.ler(
      "SELECT dados_depois FROM trilha_auditoria WHERE entidade = 'comunicado' AND entidade_id = ? ORDER BY id",
      [r.id],
    );
    expect(tr.length).toBe(1);
    expect(String(tr[0]?.['dados_depois'])).not.toContain('Texto sintético');

    // Corrige antes de qualquer leitura: o texto anterior e o motivo vão ao evento.
    let d = await s.corrigirComunicado(m.ctx('rem'), autor, r.id, {
      assunto: 'Comunicado de teste (corrigido)',
      texto: 'Texto sintético corrigido.',
      motivo: 'Erro de digitação',
    });
    expect(d).toMatchObject({ assunto: 'Comunicado de teste (corrigido)', podeCorrigir: true });
    expect(d.eventos.map((x) => x.evento)).toEqual(['correcao']);
    expect(d.eventos[0]).toMatchObject({ motivo: 'Erro de digitação', por: m.login.rem });
    // A trilha é imutável: da versão anterior ficam só o tamanho e o resumo, nunca o assunto nem o texto.
    expect(d.eventos[0]?.antes).toMatch(/^versão anterior: assunto com 19 caracteres, texto com 51 caracteres/);
    const trCorrecao = await m.ler(
      "SELECT dados_depois FROM trilha_auditoria WHERE entidade = 'comunicado' AND entidade_id = ? ORDER BY id",
      [r.id],
    );
    expect(trCorrecao.length).toBe(2);
    for (const x of trCorrecao) {
      expect(String(x['dados_depois'])).not.toContain('Texto sintético');
      expect(String(x['dados_depois'])).not.toContain('Comunicado de teste');
    }

    // A primeira leitura de d1 trava a correção.
    const lida = await s.abrir(m.ctx('d1'), { ...autor, login: m.login.d1 }, r.id, 'comunicado');
    expect(lida.lidaEm).not.toBeNull();
    await expect(
      s.corrigirComunicado(m.ctx('rem'), autor, r.id, { assunto: 'x', texto: 'y', motivo: 'outra' }),
    ).rejects.toMatchObject({ problema: { codigo: 'comunicado-ja-lido' } });

    // Vigência: estender é recusado; encurtar grava a versão nova e o evento.
    await expect(
      s.encurtarVigencia(m.ctx('rem'), autor, r.id, {
        vigenciaFim: new Date(agora + 20 * 86_400_000).toISOString(),
        motivo: 'estender',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-invalida' } });
    await s.encurtarVigencia(m.ctx('rem'), autor, r.id, {
      vigenciaFim: new Date(agora + 5 * 86_400_000).toISOString(),
      motivo: 'Prazo menor',
    });
    const [k2] = await m.ler('SELECT versao FROM comunicado WHERE id = ?', [r.id]);
    expect(Number(k2?.['versao'])).toBe(3);

    // Encerra: some de d2 (não leu), continua para d1 (leu), sem ciência nova.
    d = await s.encerrarComunicado(m.ctx('rem'), autor, r.id, { motivo: 'Substituído' });
    expect(d).toMatchObject({ encerradoPor: m.login.rem, motivoEncerramento: 'Substituído', podeCorrigir: false });
    expect(d.eventos.map((x) => x.evento)).toEqual(['correcao', 'vigencia', 'encerramento']);
    expect((await s.caixa(m.ctx('d2'), m.login.d2)).recebidas.some((x) => x.id === r.id && x.tipo === 'comunicado')).toBe(
      false,
    );
    const visto = (await s.caixa(m.ctx('d1'), m.login.d1)).recebidas.find((x) => x.id === r.id && x.tipo === 'comunicado');
    expect(visto?.motivoEncerramento).toBe('Substituído');
    await expect(s.ciencia(m.ctx('d1'), { ...autor, login: m.login.d1 }, r.id, 'comunicado')).rejects.toMatchObject({
      problema: { codigo: 'comunicado-encerrado' },
    });
    await expect(s.encerrarComunicado(m.ctx('rem'), autor, r.id, { motivo: 'de novo' })).rejects.toMatchObject({
      problema: { codigo: 'comunicado-encerrado' },
    });
  });

  it('outro estabelecimento não vê nem muda o comunicado', async () => {
    const autor = { login: m.login.rem, estacao: 'INT-W009', correlacao: 'int-w009-b' };
    const agora = Date.now();
    const r = await s.publicar(
      m.ctx('rem'),
      autor,
      {
        assunto: 'Só do estabelecimento A',
        texto: 'Texto sintético.',
        destinos: [{ tipo: 'usuario', valor: m.login.d1 }],
        cienciaObrigatoria: false,
        vigenciaInicio: new Date(agora - 60_000).toISOString(),
        vigenciaFim: new Date(agora + 86_400_000).toISOString(),
      },
      `int-w009-b-${agora}`,
    );
    await expect(s.comunicado(m.ctx('rem', 'B'), r.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      s.encerrarComunicado(m.ctx('rem', 'B'), autor, r.id, { motivo: 'invasão' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
