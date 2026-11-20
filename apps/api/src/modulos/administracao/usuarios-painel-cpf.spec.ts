// W1-01 (parte 3c): GET /api/administracao/acesso/usuarios-cpf. O controlador direto com a fonte em memória (dados
// sintéticos, o CPF trocado pela receita da fonte) e com uma fonte falsa que falha (503, nada inventado).
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { FonteAdministracao } from './fonte.js';
import {
  estadoM10Sintetico,
  fonteAdministracaoMemoria,
  reiniciarEstadoM10Sintetico,
} from './fonte-memoria.js';
import { UsuariosController } from './usuarios.controller.js';

const req = {
  headers: {},
  sgh: {
    sessao: {
      rede: 'rede-sint',
      estabelecimentoAtivo: 'pc',
      usuario: { login: 'SINT.GESTOR' },
      perfil: { perfil: 'gestor-acessos', complementares: [] },
      permissoes: ['acesso.usuario.ler'],
    },
  },
} as unknown as RequisicaoAutorizada;
const resolvedor = { idSessao: () => null } as unknown as ResolvedorSessao;

describe('painel de identidade única na tela de Usuários', () => {
  it('lista sem CPF e CPF repetido sem o número do CPF', async () => {
    const fonte = {
      destino: 'legado',
      painelCpf: async () => ({
        semCpf: [
          { login: 'ANA', nome: 'Ana', grupo: 'MEDICOS', ativo: true, bloqueado: false },
          { login: 'TV1', nome: null, grupo: 'PAINEIS', ativo: true, bloqueado: false },
        ],
        duplicadas: [
          { login: 'B1', nome: null, grupo: 'X', ativo: true, bloqueado: false, chave: '4471' },
          { login: 'B2', nome: null, grupo: 'X', ativo: true, bloqueado: true, chave: '4471' },
        ],
      }),
    } as unknown as FonteAdministracao;
    const ctl = new UsuariosController(fonte, null, resolvedor);
    const p = await ctl.painelCpf(req);
    expect(p.semCpf.map((x) => x.login)).toEqual(['ANA']);
    expect(p.dispensadasSemCpf).toBe(1);
    expect(p.duplicados).toEqual([{ chave: '1', contas: expect.any(Array) }]);
    expect(p.duplicados[0]!.contas.map((x) => x.login)).toEqual(['B1', 'B2']);
    expect(JSON.stringify(p)).not.toContain('4471');
    expect(p.destino).toBe('legado');
  });

  it('sem ler o banco: 503 (nada é inventado)', async () => {
    const fonte = {
      destino: 'legado',
      painelCpf: async () => {
        throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
      },
    } as unknown as FonteAdministracao;
    const e = await new UsuariosController(fonte, null, resolvedor).painelCpf(req).catch((x: unknown) => x);
    expect((e as ErroProblema).getStatus()).toBe(503);
  });

  it('fonte em memória: o CPF repetido entre dois logins aparece no painel; sem CPF, os ativos', async () => {
    reiniciarEstadoM10Sintetico();
    const fonte = fonteAdministracaoMemoria(
      { registrar: async () => undefined } as never,
      {} as never,
      'dev',
    );
    const ctl = new UsuariosController(fonte, null, resolvedor);
    const antes = await ctl.painelCpf(req);
    expect(antes.duplicados).toEqual([]);
    const [a, b] = [...estadoM10Sintetico().usuarios.values()].filter((u) => u.ativo);
    a!.cpf = '52998224725';
    b!.cpf = '52998224725';
    const p = await ctl.painelCpf(req);
    expect(p.duplicados).toHaveLength(1);
    expect(p.duplicados[0]!.contas.map((x) => x.login).sort()).toEqual([a!.login, b!.login].sort());
    expect(p.semCpf.some((x) => x.login === a!.login)).toBe(false);
    expect(JSON.stringify(p)).not.toContain('52998224725');
    reiniciarEstadoM10Sintetico();
  });
});
