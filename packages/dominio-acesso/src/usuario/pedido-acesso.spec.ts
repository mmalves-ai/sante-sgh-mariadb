// W1-01 (parte 10a): regra do pedido de acesso (dois níveis, segregação, período com fim, concessão que expira).
import { describe, expect, it } from 'vitest';
import {
  concessaoDoPedido,
  diaSeguinte,
  nivelDoPedido,
  situacaoConcessao,
  validarCancelamentoPedidoAcesso,
  validarDecisaoPedidoAcesso,
  validarNovoPedidoAcesso,
  type PedidoAcessoLido,
} from './pedido-acesso.js';

const HOJE = '2026-11-19';
const novo = (v: Record<string, unknown> = {}) => ({
  login: 'SINT.A',
  perfil: 'faturista',
  setor: 'FATURAMENTO',
  inicio: '2026-11-20',
  fim: '2026-12-20',
  motivo: 'cobrir as férias da faturista',
  ...v,
});
const ctx = (v: Record<string, unknown> = {}) => ({
  hoje: HOJE,
  contaAtiva: true,
  perfisConhecidos: ['faturista', 'recepcao'],
  perfisVigentes: ['recepcao'],
  perfisEmAndamento: [] as string[],
  ...v,
});
const pedido = (v: Partial<PedidoAcessoLido> = {}): PedidoAcessoLido => ({
  login: 'SINT.A',
  perfil: 'faturista',
  setor: 'FATURAMENTO',
  inicio: '2026-11-20',
  fim: '2026-12-20',
  situacao: 'pendente',
  setorPor: null,
  ...v,
});
const papeis = (v: Record<string, boolean> = {}) => ({
  gestorDoSetor: false,
  gestorAcessos: false,
  setorTemGestor: true,
  ...v,
});
const cod = (r: { codigo: string } | null) => r?.codigo ?? null;

describe('W1-01 (parte 10a): pedido de acesso (regra)', () => {
  it('novo: aceita o pedido completo e recusa conta inativa, perfil, setor, período, motivo, vigente e repetido', () => {
    expect(validarNovoPedidoAcesso(novo(), ctx())).toBeNull();
    expect(validarNovoPedidoAcesso(novo({ inicio: HOJE, fim: HOJE }), ctx())).toBeNull();
    expect(cod(validarNovoPedidoAcesso(novo(), ctx({ contaAtiva: false })))).toBe('conta-inativa');
    expect(cod(validarNovoPedidoAcesso(novo({ perfil: ' ' }), ctx()))).toBe('perfil-obrigatorio');
    expect(cod(validarNovoPedidoAcesso(novo({ perfil: 'xis' }), ctx()))).toBe('perfil-desconhecido');
    expect(validarNovoPedidoAcesso(novo({ perfil: 'xis' }), ctx({ perfisConhecidos: null }))).toBeNull();
    expect(cod(validarNovoPedidoAcesso(novo({ setor: '' }), ctx()))).toBe('setor-obrigatorio');
    expect(cod(validarNovoPedidoAcesso(novo({ inicio: '2026-02-30' }), ctx()))).toBe('periodo-invalido');
    expect(cod(validarNovoPedidoAcesso(novo({ inicio: '2026-11-18' }), ctx()))).toBe('periodo-invalido');
    expect(cod(validarNovoPedidoAcesso(novo({ fim: '2026-11-19' }), ctx()))).toBe('periodo-invalido');
    expect(validarNovoPedidoAcesso(novo({ fim: '2027-11-19' }), ctx())).toBeNull(); // 365 dias
    expect(cod(validarNovoPedidoAcesso(novo({ fim: '2027-11-20' }), ctx()))).toBe('periodo-invalido');
    expect(cod(validarNovoPedidoAcesso(novo({ motivo: 'curto' }), ctx()))).toBe('motivo-curto');
    expect(cod(validarNovoPedidoAcesso(novo({ perfil: 'recepcao' }), ctx()))).toBe('perfil-ja-vigente');
    expect(cod(validarNovoPedidoAcesso(novo(), ctx({ perfisEmAndamento: ['faturista'] })))).toBe(
      'pedido-repetido',
    );
  });

  it('níveis: pendente espera o setor, aprovado-setor espera o gestor de acessos, os outros não esperam', () => {
    expect(nivelDoPedido('pendente')).toBe('setor');
    expect(nivelDoPedido('aprovado-setor')).toBe('acessos');
    for (const s of ['aprovado', 'concedido', 'recusado', 'cancelado'] as const)
      expect(nivelDoPedido(s)).toBeNull();
  });

  it('1º nível: gestor do setor aprova; sem gestor no setor, o gestor de acessos; ninguém decide o próprio', () => {
    const d = (
      p: PedidoAcessoLido,
      por: string,
      pa = papeis(),
      dec: 'aprovar' | 'recusar' = 'aprovar',
      m = '',
    ) => cod(validarDecisaoPedidoAcesso(p, dec, m, por, pa, HOJE));
    expect(d(pedido(), 'SINT.CHEFE', papeis({ gestorDoSetor: true }))).toBeNull();
    expect(d(pedido(), 'SINT.GESTOR', papeis({ gestorAcessos: true }))).toBe('sem-papel');
    expect(d(pedido(), 'SINT.GESTOR', papeis({ gestorAcessos: true, setorTemGestor: false }))).toBeNull();
    expect(d(pedido(), 'sint.a', papeis({ gestorDoSetor: true, gestorAcessos: true }))).toBe('decidir-a-si');
    expect(d(pedido(), 'SINT.CHEFE', papeis({ gestorDoSetor: true }), 'recusar', 'curto')).toBe(
      'motivo-curto',
    );
    expect(
      d(pedido(), 'SINT.CHEFE', papeis({ gestorDoSetor: true }), 'recusar', 'não é do setor de faturamento'),
    ).toBeNull();
  });

  it('2º nível: só o gestor de acessos, pessoa diferente do 1º nível; período vencido não se aprova', () => {
    const p = pedido({ situacao: 'aprovado-setor', setorPor: 'SINT.CHEFE' });
    const d = (x: PedidoAcessoLido, por: string, pa = papeis(), hoje = HOJE) =>
      cod(validarDecisaoPedidoAcesso(x, 'aprovar', '', por, pa, hoje));
    expect(d(p, 'SINT.GESTOR', papeis({ gestorAcessos: true }))).toBeNull();
    expect(d(p, 'SINT.GESTOR', papeis({ gestorDoSetor: true }))).toBe('sem-papel');
    expect(d(p, 'sint.chefe', papeis({ gestorAcessos: true, gestorDoSetor: true }))).toBe('mesmo-aprovador');
    expect(d(p, 'SINT.GESTOR', papeis({ gestorAcessos: true }), '2026-12-21')).toBe('periodo-vencido');
    expect(d(p, 'SINT.GESTOR', papeis({ gestorAcessos: true }), '2026-12-20')).toBeNull();
    for (const s of ['aprovado', 'concedido', 'recusado', 'cancelado'] as const)
      expect(d(pedido({ situacao: s }), 'SINT.GESTOR', papeis({ gestorAcessos: true }))).toBe(
        'pedido-fechado',
      );
  });

  it('cancelar: só o solicitante, antes da concessão, com motivo', () => {
    const m = 'não preciso mais do acesso';
    expect(
      validarCancelamentoPedidoAcesso({ login: 'SINT.A', situacao: 'aprovado-setor' }, 'sint.a', m),
    ).toBeNull();
    // Revisão (achado 2): 'aprovado' (concessão a caminho) não se cancela; o perfil concedido se revoga.
    expect(cod(validarCancelamentoPedidoAcesso({ login: 'SINT.A', situacao: 'aprovado' }, 'sint.a', m))).toBe(
      'pedido-aprovado',
    );
    expect(cod(validarCancelamentoPedidoAcesso({ login: 'SINT.A', situacao: 'pendente' }, 'SINT.B', m))).toBe(
      'cancelar-de-outro',
    );
    expect(
      cod(validarCancelamentoPedidoAcesso({ login: 'SINT.A', situacao: 'concedido' }, 'SINT.A', m)),
    ).toBe('pedido-fechado');
    expect(
      cod(validarCancelamentoPedidoAcesso({ login: 'SINT.A', situacao: 'pendente' }, 'SINT.A', 'x')),
    ).toBe('motivo-curto');
  });

  it('concessão: início pedido ou hoje, fim exclusivo no dia seguinte, setor que aprovou; expira sozinha', () => {
    const c = concessaoDoPedido('42', { ...pedido(), motivo: ' cobrir as férias ' }, HOJE);
    expect(c).toEqual({
      login: 'SINT.A',
      perfil: 'faturista',
      inicio: '2026-11-20',
      fim: '2026-12-21',
      areaAprovou: 'FATURAMENTO',
      motivo: 'Pedido de acesso 42: cobrir as férias',
    });
    expect(concessaoDoPedido('42', { ...pedido(), motivo: 'x' }, '2026-11-25').inicio).toBe('2026-11-25');
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01');
    const ini = new Date(2026, 10, 20);
    const fim = new Date(2026, 11, 21);
    expect(situacaoConcessao(ini, fim, new Date(2026, 10, 19, 23, 59))).toBe('futura');
    expect(situacaoConcessao(ini, fim, new Date(2026, 11, 20, 23, 59))).toBe('vigente');
    expect(situacaoConcessao(ini, fim, new Date(2026, 11, 21, 0, 0))).toBe('expirada');
    expect(situacaoConcessao(ini, null, new Date(2030, 0, 1))).toBe('vigente');
  });
});
