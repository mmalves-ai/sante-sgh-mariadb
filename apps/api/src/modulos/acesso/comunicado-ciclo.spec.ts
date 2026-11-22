// W0-09: o ciclo de vida do comunicado pelo serviço com a porta EM MEMÓRIA (as mesmas recusas da porta própria, que
// roda a mesma sequência no banco em aplicacao/comunicado-ciclo.int.spec.ts): o texto ainda não lido se corrige com
// motivo (o anterior fica no evento); o lido não se edita; a vigência só encurta; o encerramento leva o motivo e
// mantém o comunicado visível a quem leu; nada do texto vai à trilha. Contas sintéticas.
import { describe, expect, it } from 'vitest';
import { ServicoComunicacao } from './aplicacao/comunicacao.js';
import type { ContextoComunicacao } from './comunicacao-porta.js';
import { PortaComunicacaoMemoria } from './comunicacao-porta-memoria.js';

const c: ContextoComunicacao = {
  cliente: 'teste',
  estabelecimento: 1,
  usuario: 1,
  correlacao: 'teste-w009',
  rede: 'rede-teste',
  hospital: 'aa',
};
const autor = (login: string) => ({ login, estacao: 'TESTE', correlacao: 'teste-w009' });

async function publicado() {
  const porta = new PortaComunicacaoMemoria({ estado: () => 'verde' });
  const s = new ServicoComunicacao(porta, null);
  const agora = Date.now();
  const r = await s.publicar(
    c,
    autor('SINT.GESTOR'),
    {
      assunto: 'Comunicado sintético',
      texto: 'Texto original do comunicado.',
      destinos: [{ tipo: 'usuario', valor: 'SINT.MEDICO' }],
      cienciaObrigatoria: true,
      vigenciaInicio: new Date(agora - 3_600_000).toISOString(),
      vigenciaFim: new Date(agora + 10 * 86_400_000).toISOString(),
    },
    `teste-w009-${agora}`,
  );
  return { porta, s, id: r.id, agora };
}

describe('ciclo do comunicado (memória)', () => {
  it('corrige com motivo o texto não lido; o evento guarda só o tamanho e o resumo do anterior', async () => {
    const { porta, s, id } = await publicado();
    const d = await s.corrigirComunicado(c, autor('SINT.GESTOR'), id, {
      assunto: 'Comunicado sintético',
      texto: 'Texto corrigido do comunicado.',
      motivo: 'Erro de digitação',
    });
    expect(d).toMatchObject({ texto: 'Texto corrigido do comunicado.', podeCorrigir: true });
    expect(d.eventos).toHaveLength(1);
    expect(d.eventos[0]).toMatchObject({
      evento: 'correcao',
      motivo: 'Erro de digitação',
      por: 'SINT.GESTOR',
    });
    expect(d.eventos[0]!.antes).toMatch(
      /^versão anterior: assunto com 20 caracteres, texto com 29 caracteres \(resumo [0-9a-f]{16}\)$/,
    );
    expect(d.eventos[0]!.antes).not.toContain('Texto original');
    expect(JSON.stringify(porta.trilhaDe('aa'))).not.toContain('Texto corrigido');
  });

  it('lido: a correção é recusada; a vigência só encurta; o encerramento mantém o lido visível', async () => {
    const { s, id, agora } = await publicado();
    await s.abrir(c, autor('SINT.MEDICO'), id);
    await expect(
      s.corrigirComunicado(c, autor('SINT.GESTOR'), id, { assunto: 'x', texto: 'y', motivo: 'z' }),
    ).rejects.toMatchObject({ problema: { codigo: 'comunicado-ja-lido' } });
    await expect(
      s.encurtarVigencia(c, autor('SINT.GESTOR'), id, {
        vigenciaFim: new Date(agora + 20 * 86_400_000).toISOString(),
        motivo: 'estender',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-invalida' } });
    await s.encurtarVigencia(c, autor('SINT.GESTOR'), id, {
      vigenciaFim: new Date(agora + 5 * 86_400_000).toISOString(),
      motivo: 'Prazo menor',
    });
    const d = await s.encerrarComunicado(c, autor('SINT.GESTOR'), id, { motivo: 'Substituído' });
    expect(d).toMatchObject({
      motivoEncerramento: 'Substituído',
      encerradoPor: 'SINT.GESTOR',
      podeCorrigir: false,
    });
    expect(d.eventos.map((e) => e.evento)).toEqual(['vigencia', 'encerramento']);
    const visto = (await s.caixa(c, 'SINT.MEDICO')).recebidas.find((m) => m.id === id);
    expect(visto?.motivoEncerramento).toBe('Substituído');
    await expect(
      s.encerrarComunicado(c, autor('SINT.GESTOR'), id, { motivo: 'de novo' }),
    ).rejects.toMatchObject({
      problema: { codigo: 'comunicado-encerrado' },
    });
  });

  it('o mesmo pedido com outro conteúdo é recusado (idempotência divergente); igual devolve o mesmo', async () => {
    const porta = new PortaComunicacaoMemoria({ estado: () => 'verde' });
    const s = new ServicoComunicacao(porta, null);
    const agora = Date.now();
    const e = {
      assunto: 'Comunicado sintético',
      texto: 'Texto original do comunicado.',
      destinos: [{ tipo: 'usuario' as const, valor: 'SINT.MEDICO' }],
      cienciaObrigatoria: false,
      vigenciaInicio: new Date(agora - 3_600_000).toISOString(),
      vigenciaFim: new Date(agora + 86_400_000).toISOString(),
    };
    const r = await s.publicar(c, autor('SINT.GESTOR'), e, 'teste-divergente');
    expect(await s.publicar(c, autor('SINT.GESTOR'), e, 'teste-divergente')).toMatchObject({
      id: r.id,
      repetida: true,
    });
    await expect(
      s.publicar(c, autor('SINT.GESTOR'), { ...e, texto: 'Outro texto.' }, 'teste-divergente'),
    ).rejects.toMatchObject({ problema: { codigo: 'idempotencia-divergente' } });
  });

  it('a ciência do comunicado resolve só o aviso do comunicado, nunca o da mensagem com o mesmo número', async () => {
    const { s, id } = await publicado();
    const aviso = (objetoTabela: string, evento: string) =>
      s.emitir(c, autor('SINT.GESTOR'), {
        login: 'SINT.MEDICO',
        tipo: 'ciencia-pendente',
        gravidade: 'atencao',
        modulo: 'acesso',
        evento,
        titulo: 'Aviso sintético',
        link: `/mensagens?id=${id}`,
        objetoTabela,
        objetoChave: String(id),
      });
    const daMensagem = await aviso('mensagem_interna', 'acesso.mensagem.enviada');
    const doComunicado = await aviso('comunicado', 'acesso.comunicado.publicado');
    await s.ciencia(c, autor('SINT.MEDICO'), id, 'comunicado');
    const central = (await s.avisos(c, 'SINT.MEDICO', 0)).avisos;
    expect(central.find((x) => x.id === doComunicado)?.estado).toBe('resolvido');
    expect(central.find((x) => x.id === daMensagem)?.estado).toBe('novo');
  });

  it('comunicado inexistente: 404', async () => {
    const { s } = await publicado();
    await expect(s.comunicado(c, 987_654)).rejects.toMatchObject({ status: 404 });
  });
});
