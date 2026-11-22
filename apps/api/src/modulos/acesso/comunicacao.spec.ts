// M27 pelo serviço com a porta EM MEMÓRIA (nada conecta a banco; contas sintéticas): as mensagens (regra 7: sem dado
// do paciente no texto, o paciente como contexto só com acesso ao prontuário, o texto fora da trilha), a leitura e a
// ciência que resolve o aviso, o canal que avisa depois da gravação (regra 8) e não avisa na falha, os destinos sem
// conta ativa, o teto de destinatários, a idempotência do envio, a central de avisos, as mensagens anteriores e o
// dicionário pessoal (inclusão, repetição, recusas e exclusão). A mesma bateria roda no banco próprio em
// comunicacao-porta-propria.int.spec.ts. As rotas HTTP voltam a ser testadas com o módulo acesso registrado.
import { describe, expect, it } from 'vitest';
import { ServicoComunicacao } from './aplicacao/comunicacao.js';
import type { ContextoComunicacao } from './comunicacao-porta.js';
import { PortaComunicacaoMemoria } from './comunicacao-porta-memoria.js';

const c: ContextoComunicacao = {
  cliente: 'teste',
  estabelecimento: 1,
  usuario: 1,
  correlacao: 'teste-m27',
  rede: 'rede-teste',
  hospital: 'aa',
};
const autor = (login: string) => ({ login, estacao: 'TESTE', correlacao: 'teste-m27' });
const octx = (login: string, chave: string) => ({ ...c, chaveIdempotencia: chave, login });

function montar() {
  const porta = new PortaComunicacaoMemoria({ estado: () => 'verde' });
  const avisados: string[] = [];
  const s = new ServicoComunicacao(porta, {
    avisar: (chave) => {
      avisados.push(chave);
      return 1;
    },
  });
  return { porta, s, avisados };
}

const msg = (destino: string, extra: Record<string, unknown> = {}) => ({
  assunto: 'Assunto sintético',
  texto: 'Texto sintético da mensagem de teste',
  destinos: [{ tipo: 'usuario' as const, valor: destino }],
  cienciaObrigatoria: false,
  contextoAtendimento: null,
  ...extra,
});

describe('comunicação interna (memória)', () => {
  it('envia, avisa depois da gravação, abre (leitura) e dá ciência (resolve o aviso); texto fora da trilha', async () => {
    const { porta, s, avisados } = montar();
    const r = await s.enviar(
      c,
      autor('SINT.GESTOR'),
      msg('SINT.MEDICO', { cienciaObrigatoria: true }),
      'teste-envio-1',
    );
    expect(r).toMatchObject({ destinatarios: 1, repetida: false });
    expect(avisados).toEqual(['aa|SINT.MEDICO']);
    expect(
      await s.enviar(
        c,
        autor('SINT.GESTOR'),
        msg('SINT.MEDICO', { cienciaObrigatoria: true }),
        'teste-envio-1',
      ),
    ).toMatchObject({
      id: r.id,
      repetida: true,
    });
    expect(avisados.length).toBe(1);
    const caixa = await s.caixa(c, 'SINT.MEDICO');
    expect(caixa.naoLidas).toBeGreaterThan(0);
    expect(caixa.cienciasPendentes).toBe(1);
    const aberta = await s.abrir(c, autor('SINT.MEDICO'), r.id);
    expect(aberta.lidaEm).not.toBeNull();
    const ciente = await s.ciencia(c, autor('SINT.MEDICO'), r.id);
    expect(ciente.cienciaEm).not.toBeNull();
    const central = await s.avisos(c, 'SINT.MEDICO', 0);
    expect(central.avisos.find((x) => x.link === `/mensagens?id=${r.id}`)?.estado).toBe('resolvido');
    const trilha = JSON.stringify(porta.trilhaDe('aa'));
    expect(trilha).not.toContain('Texto sintético');
    expect(porta.trilhaDe('aa').some((l) => l.entidade === 'mensagem_interna' && l.entidadeId === r.id)).toBe(
      true,
    );
    const enviada = (await s.caixa(c, 'SINT.GESTOR')).enviadas.find((x) => x.id === r.id);
    expect(enviada).toMatchObject({ destinatarios: 1, lidas: 1, ciencias: 1 });
  });

  it('recusas: dado do paciente, destino sem conta ativa (sem gravar nem avisar), contexto sem acesso', async () => {
    const { s, avisados } = montar();
    await expect(
      s.enviar(
        c,
        autor('SINT.GESTOR'),
        msg('SINT.MEDICO', { texto: 'CPF 123.456.789-09' }),
        'teste-recusa-1',
      ),
    ).rejects.toMatchObject({ extras: { codigo: 'dado-do-paciente' } });
    await expect(s.enviar(c, autor('SINT.GESTOR'), msg('NINGUEM'), 'teste-recusa-2')).rejects.toMatchObject({
      extras: { codigo: 'destino-sem-usuario' },
    });
    await expect(
      s.enviar(c, autor('SINT.GESTOR'), msg('SINT.MEDICO', { contextoAtendimento: 10 }), 'teste-recusa-3'),
    ).rejects.toMatchObject({ extras: { codigo: 'contexto-sem-acesso' } });
    expect(avisados).toEqual([]);
    await expect(s.abrir(c, autor('SINT.MEDICO'), 999_999)).rejects.toMatchObject({ status: 404 });
  });

  it('grupo: expande os usuários ativos do grupo; um aviso por destinatário', async () => {
    const { s, avisados } = montar();
    const r = await s.enviar(
      c,
      autor('SINT.GESTOR'),
      { ...msg('x'), destinos: [{ tipo: 'grupo', valor: 'MEDICOS' }] },
      'teste-grupo-1',
    );
    expect(r.destinatarios).toBeGreaterThan(0);
    expect(avisados.length).toBe(r.destinatarios);
  });

  it('central de avisos: emitir sem repetir, marcar lido e resolver', async () => {
    const { s } = montar();
    const novo = {
      login: 'SINT.MEDICO',
      tipo: 'resultado-liberado',
      gravidade: 'informacao' as const,
      modulo: 'sadt',
      evento: 'sadt.resultado.liberado',
      titulo: 'Resultado liberado (teste)',
      link: '/exames',
      objetoTabela: 'resultado_exame',
      objetoChave: '7',
    };
    const id = await s.emitir(c, autor('SINT.GESTOR'), novo);
    expect(id).not.toBeNull();
    expect(await s.mudarAviso(c, autor('SINT.MEDICO'), id!, 'lido')).toBe(true);
    expect(await s.mudarAviso(c, autor('SINT.MEDICO'), id!, 'resolvido')).toBe(true);
    const central = await s.avisos(c, 'SINT.MEDICO', 3);
    expect(central).toMatchObject({ versao: 3 });
    expect(central.avisos.find((x) => x.id === id)?.estado).toBe('resolvido');
  });

  it('mensagens anteriores e dicionário pessoal', async () => {
    const { s, porta } = montar();
    expect((await s.anteriores(c, 'SINT.MEDICO')).length).toBe(2);
    expect(await s.anteriores(c, 'SINT.GESTOR')).toEqual([]);
    expect(await s.gravarPalavra(c, 'incluir', 'Ecocardiograma', octx('SINT.MEDICO', 'teste-dic-1'))).toEqual(
      {
        repetida: false,
      },
    );
    expect(await s.gravarPalavra(c, 'incluir', 'Ecocardiograma', octx('SINT.MEDICO', 'teste-dic-1'))).toEqual(
      {
        repetida: true,
      },
    );
    await expect(
      s.gravarPalavra(c, 'incluir', 'Ecocardiograma', octx('SINT.MEDICO', 'teste-dic-2')),
    ).rejects.toMatchObject({ problema: { codigo: 'palavra-existente' } });
    const dic = await s.dicionario(c, 'SINT.MEDICO');
    expect(dic.palavras.map((p) => p.palavra)).toHaveLength(1);
    expect(dic.gravacao).toEqual({ incluir: null, excluir: null });
    await s.gravarPalavra(c, 'excluir', 'Ecocardiograma', octx('SINT.MEDICO', 'teste-dic-3'));
    expect((await s.dicionario(c, 'SINT.MEDICO')).palavras).toEqual([]);
    expect(
      porta
        .trilhaDe('aa')
        .filter((l) => l.entidade === 'dicionario_usuario')
        .map((l) => l.acao),
    ).toEqual(['inclusao', 'exclusao']);
  });
});
