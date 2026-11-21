// Ficha de usuários: o número do CPF só para a conta da PLATAFORMA (pedido do dono de 17/11/2026). Gestor de acessos,
// suporte técnico e Auditor recebem `cpf: null` (e a fonte nem lê o número); a regra 10 continua conferindo o resto da
// ficha, e a trilha da consulta diz qual usuário foi lido e se o CPF foi mostrado (sem o valor). O controlador direto,
// com uma fonte falsa (nada conecta a banco); o CPF é sintético, montado em tempo de execução.
import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ComoResolvido, ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { FonteAdministracao } from './fonte.js';

/** A ficha que a fonte da administração devolve (o tipo é o da fonte, qualquer que seja o nome dele). */
type FichaDaFonte = NonNullable<Awaited<ReturnType<FonteAdministracao['fichaUsuario']>>>;
import { UsuariosController } from './usuarios.controller.js';

const CPF = `9${'0'.repeat(8)}17`;

function requisicao(o: {
  perfil?: string | null;
  como?: Pick<ComoResolvido, 'atorTipo' | 'modo'>;
}): RequisicaoAutorizada {
  return {
    headers: {},
    ...(o.como
      ? {
          sghComo: {
            sessao: 's-1',
            idConta: 'c-1',
            atorEmail: 'ator@sintetico.invalid',
            alvoNome: 'SINT.ADMIN',
            expiraMs: 0,
            motivo: null,
            rede: 'rede-sint',
            hospital: 'aa',
            alvoLogin: 'SINT.ADMIN',
            ...o.como,
          },
        }
      : {}),
    sgh: {
      sessao: {
        rede: 'rede-sint',
        estabelecimentoAtivo: 'aa',
        usuario: { login: 'SINT.ADMIN' },
        perfil: o.perfil === null ? null : { perfil: o.perfil ?? 'gestor-acessos', complementares: [] },
        permissoes: ['acesso.usuario.ler'],
      },
    },
  } as unknown as RequisicaoAutorizada;
}

function montar(cpfNoBanco: string | null = CPF) {
  const fichaUsuario = vi.fn(
    async (
      _c: unknown,
      login: string,
      _auditor: boolean,
      opcoes?: { cpf?: boolean },
    ): Promise<FichaDaFonte> => ({
      login,
      id: 77,
      nome: 'Usuario Sintetico',
      grupo: 'MEDICOS',
      ativo: true,
      bloqueado: false,
      cpfInformado: cpfNoBanco !== null,
      cpf: opcoes?.cpf ? cpfNoBanco : null,
      senhaDefinida: true,
      versao: ['Usuario Sintetico', 'MEDICOS', 'T', 'F'],
      grupoAtivo: true,
      papeis: [],
      escopos: {},
      escoposConsulta: { centrosCusto: 0, locaisEstoque: 0, contasBancarias: 0 },
      flags: [],
      conexoes: [],
      termo: { aceitouVigente: true, aceitoEm: null },
      historicoSenha: null,
      profissionalVinculado: null,
    }),
  );
  const fonte = {
    destino: 'memoria',
    fichaUsuario,
    setores: vi.fn(async () => []),
    receita: vi.fn(() => ({ ligada: true, motivo: null })),
  } as unknown as FonteAdministracao;
  const ctl = new UsuariosController(fonte, null, {} as ResolvedorSessao, null);
  return { ctl, fichaUsuario };
}

describe('ficha de usuários: CPF só para a conta da plataforma', () => {
  it('plataforma em acesso total vê o CPF; a trilha marca o alvo e "cpf:visto"', async () => {
    const { ctl, fichaUsuario } = montar();
    const req = requisicao({ perfil: null, como: { atorTipo: 'plataforma', modo: 'acesso-total' } });
    const f = await ctl.ficha('SINT.MEDICO', req);
    expect(f.usuario.cpf).toBe(CPF);
    expect(f.usuario.cpfInformado).toBe(true);
    expect(fichaUsuario.mock.calls[0]?.[3]).toEqual({ cpf: true });
    expect(req.sghAlvo).toEqual({ tabelaAlvo: 'TBUSERS', idAlvo: '77', chaveNaturalAlvo: 'ficha;cpf:visto' });
    expect(JSON.stringify(req.sghAlvo)).not.toContain(CPF);
  });

  it('plataforma na sessão "como" também vê', async () => {
    const { ctl } = montar();
    const f = await ctl.ficha('SINT.MEDICO', requisicao({ como: { atorTipo: 'plataforma', modo: 'como' } }));
    expect(f.usuario.cpf).toBe(CPF);
  });

  it('plataforma sem CPF no cadastro: null, sem a marca de CPF visto', async () => {
    const { ctl } = montar(null);
    const req = requisicao({ perfil: null, como: { atorTipo: 'plataforma', modo: 'acesso-total' } });
    const f = await ctl.ficha('SINT.MEDICO', req);
    expect(f.usuario).toMatchObject({ cpf: null, cpfInformado: false });
    expect(req.sghAlvo).toEqual({ tabelaAlvo: 'TBUSERS', idAlvo: '77' });
  });

  it('gestor de acessos não vê (a fonte nem lê o número)', async () => {
    const { ctl, fichaUsuario } = montar();
    const req = requisicao({ perfil: 'gestor-acessos' });
    const f = await ctl.ficha('SINT.MEDICO', req);
    expect(f.usuario).toMatchObject({ cpf: null, cpfInformado: true });
    expect(fichaUsuario.mock.calls[0]?.[3]).toEqual({ cpf: false });
    expect(JSON.stringify(f)).not.toContain(CPF);
    expect(req.sghAlvo).toEqual({ tabelaAlvo: 'TBUSERS', idAlvo: '77' });
  });

  it('suporte técnico na sessão "como" não vê', async () => {
    const { ctl, fichaUsuario } = montar();
    const f = await ctl.ficha('SINT.MEDICO', requisicao({ como: { atorTipo: 'suporte', modo: 'como' } }));
    expect(f.usuario.cpf).toBeNull();
    expect(fichaUsuario.mock.calls[0]?.[3]).toEqual({ cpf: false });
  });

  it('Auditor não vê', async () => {
    const { ctl } = montar();
    const f = await ctl.ficha('SINT.MEDICO', requisicao({ perfil: 'auditor' }));
    expect(f.usuario.cpf).toBeNull();
  });

  it('a regra 10 segue valendo para o resto da ficha: CPF fora do lugar recusa com 500', async () => {
    const { ctl, fichaUsuario } = montar();
    fichaUsuario.mockImplementationOnce(async (_c, login, _a, opcoes) => ({
      ...(await montar().fichaUsuario(_c, login, false, opcoes)),
      nome: CPF,
    }));
    const e = await ctl
      .ficha(
        'SINT.MEDICO',
        requisicao({ perfil: null, como: { atorTipo: 'plataforma', modo: 'acesso-total' } }),
      )
      .then(
        () => null,
        (x: unknown) => x,
      );
    expect(e).toBeInstanceOf(ErroProblema);
    expect((e as ErroProblema).getStatus()).toBe(500);
  });

  it('a ficha sai com Cache-Control: no-store (o CPF não fica em cache de navegador nem de proxy)', () => {
    const cabecalhos = Reflect.getMetadata(HEADERS_METADATA, UsuariosController.prototype.ficha) as
      { name: string; value: string }[] | undefined;
    expect(cabecalhos).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });
});
