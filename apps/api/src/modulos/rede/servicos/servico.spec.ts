// Registro dos serviços compartilhados da Rede (M57, etapa 3; regra 11) sobre a porta em memória (dois bancos
// SINTÉTICOS): cada registro no banco da sessão; a lista junta os bancos e pagina; o desligado fica fora; a alteração
// grava no banco do registro; a sessão "como" não altera outro banco; a regra 12 recusa antes de ler.
import { esquemaConsultaServicosRede, TETO_LISTA_SERVICOS_REDE } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { TrilhaRede } from '../tipos-indice.js';
import { PortaServicosRedeMemoria } from './porta-memoria.js';
import { ServicoServicosRede, type SessaoServicosRede } from './servico.js';
import { TETO_SERVICOS_POR_BANCO } from './tipos.js';

const REDE = 'rede-teste';
const lista = {
  redeConfigurada: () => REDE,
  estabelecimentos: () => [
    { codigo: 'pc', nome: 'Estabelecimento sintético A' },
    { codigo: 'sx', nome: 'Estabelecimento sintético B' },
  ],
};

function sessao(hospital = 'pc', extra: Partial<SessaoServicosRede> = {}): SessaoServicosRede {
  return {
    rede: REDE,
    hospital,
    login: 'SINT.DIRETORIA.REDE',
    como: false,
    liberados: new Set(['pc', 'sx']),
    trilha: (evento, operacao, id): TrilhaRede => ({
      estabelecimento: 1,
      usuario: 1,
      acao: 'operacao',
      entidade: 'servico_compartilhado_rede',
      entidadeId: id,
      dadosDepois: { evento, recurso: 'rede.servico', operacao, estabelecimento: hospital },
      correlacao: 'teste',
    }),
    ...extra,
  };
}

const novo = (titulo: string) => ({ area: 'compras' as const, titulo, estabelecimentos: ['pc', 'sx'] });
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'aceito';
  } catch (e) {
    return (e as { extras?: { codigo?: string } }).extras?.codigo ?? (e as { tipo?: string }).tipo ?? 'erro';
  }
};

describe('serviços compartilhados da Rede (serviço)', () => {
  it('cada registro no banco da sessão; a lista junta os bancos, mais recente primeiro, e pagina', async () => {
    let t = Date.parse('2026-10-25T10:00:00.000Z');
    const porta = new PortaServicosRedeMemoria(() => new Date((t += 60_000)));
    const s = new ServicoServicosRede(porta, lista);
    const a = await s.registrar(sessao('pc'), { ...novo('Compra A SINTETICA'), descricao: '  ' });
    const b = await s.registrar(sessao('sx'), novo('Compra B SINTETICA'));
    expect(a).toMatchObject({ estabelecimento: 'pc', descricao: null });
    expect(b.estabelecimento).toBe('sx');
    const l = await s.listar(sessao('pc'), { pagina: 1, porPagina: 1 });
    expect(l.total).toBe(2);
    expect(l.itens.map((x) => x.titulo)).toEqual(['Compra B SINTETICA']);
    const p2 = await s.listar(sessao('pc'), { pagina: 2, porPagina: 1 });
    expect(p2.itens.map((x) => x.titulo)).toEqual(['Compra A SINTETICA']);
    const filtro = await s.listar(sessao('pc'), {
      pagina: 1,
      porPagina: 20,
      area: 'laudos',
      situacao: 'adotada',
    });
    expect(filtro.total).toBe(0);
    // O desligado fica fora da lista.
    const soPc = await s.listar(sessao('pc', { liberados: new Set(['pc']) }), { pagina: 1, porPagina: 20 });
    expect(soPc.itens.map((x) => x.estabelecimento)).toEqual(['pc']);
    expect(soPc.estabelecimentos.map((e) => e.codigo)).toEqual(['pc']);
  });

  it('alterar no banco do registro; "como" não altera outro banco; desligado e fora da rede recusados', async () => {
    const porta = new PortaServicosRedeMemoria();
    const s = new ServicoServicosRede(porta, lista);
    const b = await s.registrar(sessao('sx'), novo('Compra B SINTETICA'));
    const r = await s.alterar(sessao('pc'), 'sx', b.id, {
      situacao: 'adotada',
      descricao: 'Feito SINTETICO',
    });
    expect(r).toMatchObject({ mudou: true, registro: { situacao: 'adotada', descricao: 'Feito SINTETICO' } });
    const vazio = await s.alterar(sessao('pc'), 'sx', b.id, { descricao: ' ' });
    expect(vazio.registro.descricao).toBeNull();
    expect(
      await codigo(s.alterar(sessao('pc', { como: true }), 'sx', b.id, { situacao: 'descartada' })),
    ).toBe('como-entre-bancos');
    expect(
      await codigo(
        s.alterar(sessao('pc', { liberados: new Set(['pc']) }), 'sx', b.id, { situacao: 'descartada' }),
      ),
    ).toBe('recurso-desligado');
    expect(await codigo(s.alterar(sessao('pc'), 'zz', 1, { situacao: 'adotada' }))).toBe('fora-da-rede');
    expect(await codigo(s.alterar(sessao('pc'), 'pc', 999, { situacao: 'adotada' }))).toBe('nao-encontrado');
    expect(await codigo(s.alterar(sessao('pc'), 'sx', b.id, { estabelecimentos: ['pc', 'zz'] }))).toBe(
      'entrada-invalida',
    );
    const area = await s.alterar(sessao('sx', { como: true }), 'sx', b.id, {
      area: 'laudos',
      titulo: 'Laudo B SINTETICO',
      estabelecimentos: ['sx'],
    });
    expect(area.registro).toMatchObject({ area: 'laudos', estabelecimentos: ['sx'] });
  });

  it('regra 12 e banco fora: recusa sem rede; a lista diz quem não respondeu', async () => {
    const porta = new PortaServicosRedeMemoria();
    const s = new ServicoServicosRede(porta, lista);
    expect(await codigo(s.listar(sessao('pc', { rede: '' }), { pagina: 1, porPagina: 20 }))).toBe(
      'rede-ausente',
    );
    expect(await codigo(s.listar(sessao('pc', { rede: 'outra' }), { pagina: 1, porPagina: 20 }))).toBe(
      'rede-diferente',
    );
    expect(await codigo(s.registrar(sessao('zz'), novo('X SINTETICO')))).toBe('fora-da-rede');
    expect(
      await codigo(s.registrar(sessao('pc'), { ...novo('X SINTETICO'), estabelecimentos: ['zz'] })),
    ).toBe('entrada-invalida');
    porta.fora.add('sx');
    const l = await s.listar(sessao('pc'), { pagina: 1, porPagina: 20 });
    expect(l.foraDoAr).toEqual(['sx']);
  });

  it('busca por parte do título ou da descrição, sem diferença de maiúsculas, nos dois bancos', async () => {
    const porta = new PortaServicosRedeMemoria();
    const s = new ServicoServicosRede(porta, lista);
    await s.registrar(sessao('pc'), { ...novo('Compra de luvas SINTETICA'), descricao: 'Fornecedor X' });
    await s.registrar(sessao('sx'), novo('Laudo de imagem SINTETICO'));
    await s.registrar(sessao('sx'), { ...novo('Outro SINTETICO'), descricao: 'inclui LUVAS também' });
    const l = await s.listar(sessao('pc'), { pagina: 1, porPagina: 20, busca: 'luvas' });
    expect(l.itens.map((x) => x.titulo).sort()).toEqual(['Compra de luvas SINTETICA', 'Outro SINTETICO']);
    expect(l.total).toBe(2);
    expect((await s.listar(sessao('pc'), { pagina: 1, porPagina: 20, busca: 'nada assim' })).total).toBe(0);
  });

  it('acima do teto de leitura por banco: o total é o que a lista pagina, com o aviso; a página além do teto é recusada', async () => {
    // O teto do contrato e o do repositório são o mesmo (a página além dele seria vazia).
    expect(TETO_LISTA_SERVICOS_REDE).toBe(TETO_SERVICOS_POR_BANCO);
    let t = Date.parse('2026-01-01T00:00:00.000Z');
    const porta = new PortaServicosRedeMemoria(() => new Date((t += 1000)));
    const s = new ServicoServicosRede(porta, lista);
    for (let k = 0; k < TETO_SERVICOS_POR_BANCO + 100; k++)
      await s.registrar(sessao(k % 3 === 0 ? 'sx' : 'pc'), novo(`Compra ${k} SINTETICA`));
    const ultima = Math.ceil(TETO_SERVICOS_POR_BANCO / 20);
    const l = await s.listar(sessao('pc'), { pagina: ultima, porPagina: 20 });
    expect(l.truncado).toBe(true);
    expect(l.total).toBe(TETO_SERVICOS_POR_BANCO);
    expect(l.itens).toHaveLength(20);
    // A junção é exata até o teto: a última página paginável é a dos registros 480 a 499 mais recentes.
    expect(l.itens[0]!.titulo).toBe(
      `Compra ${TETO_SERVICOS_POR_BANCO + 100 - 1 - (ultima - 1) * 20} SINTETICA`,
    );
    expect(await codigo(s.listar(sessao('pc'), { pagina: ultima + 1, porPagina: 20 }))).toBe(
      'entrada-invalida',
    );
    expect(esquemaConsultaServicosRede.safeParse({ pagina: ultima + 1, porPagina: 20 }).success).toBe(false);
    expect(esquemaConsultaServicosRede.safeParse({ pagina: ultima, porPagina: 20 }).success).toBe(true);
    const poucos = await s.listar(sessao('pc'), { pagina: 1, porPagina: 20, busca: 'Compra 7 SINTETICA' });
    expect(poucos).toMatchObject({ total: 1, truncado: false });
  });
});
