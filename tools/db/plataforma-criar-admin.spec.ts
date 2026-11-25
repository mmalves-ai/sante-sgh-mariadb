// plataforma:criar-admin sem banco nem SMTP: argumentos, travas, convite igual ao da API (resumo e validade) e
// envio pelo caminho da API, sem link, token ou senha na saída.
import { hashConvite } from '@sgh/dominio-acesso';
import type { Escritor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { emailAcessoMemoria } from '../../apps/api/src/sessao/email-acesso.ts';
import { CONVITE_HORAS } from '../../apps/api/src/modulos/suporte/servico-plataforma.ts';
import {
  CONVITE_HORAS_INICIAL,
  EVENTO_CONVITE,
  EVENTO_CRIADA,
  analisarArgumentos,
  emailDoDono,
  envioPeloCanalDoDono,
  decidir,
  executar,
} from './plataforma-criar-admin.ts';

interface Conta {
  id: number;
  email: string;
  papel: string;
  ativo: boolean;
  senha: string | null;
  convite: string | null;
  ate: Date | null;
}

/** Banco plataforma de mentira: só o que o comando consulta e grava. */
function bancoFalso(contas: Conta[] = []) {
  const eventos: { evento: string; alvo: number; detalhe: string; estacao: string }[] = [];
  const w = {
    consultarParaAtualizar: (sql: string, p: readonly unknown[] = []) => {
      if (sql.includes('resumo_senha IS NOT NULL AS com_senha'))
        return Promise.resolve(
          contas
            .filter((c) => c.email === p[0])
            .map((c) => ({ id: c.id, papel: c.papel, com_senha: c.senha ? 1 : 0 }) as Linha),
        );
      return Promise.resolve(
        contas
          .filter((c) => c.papel === 'plataforma' && c.ativo && c.senha)
          .map((c) => ({ id: c.id }) as Linha),
      );
    },
    inserir: (sql: string, p: readonly unknown[] = []) => {
      if (sql.includes('INSERT INTO conta_plataforma_evento')) {
        eventos.push({
          evento: String(p[0]),
          alvo: Number(p[1]),
          detalhe: String(p[2]),
          estacao: String(p[3]),
        });
        return Promise.resolve(eventos.length);
      }
      const id = contas.length + 1;
      contas.push({
        id,
        email: String(p[0]),
        papel: 'plataforma',
        ativo: true,
        senha: null,
        convite: String(p[2]),
        ate: p[3] as Date,
      });
      return Promise.resolve(id);
    },
    executar: (_sql: string, p: readonly unknown[] = []) => {
      const c = contas.find((x) => x.id === p[3] && !x.senha);
      if (!c) return Promise.resolve(0);
      c.convite = String(p[0]);
      c.ate = p[1] as Date;
      return Promise.resolve(1);
    },
  } as unknown as Escritor;
  return { contas, eventos, escrever: <T>(fn: (e: Escritor) => Promise<T>) => fn(w) };
}

const AGORA = new Date('2026-11-24T12:00:00Z');
const ARGS = ['--email', 'Dono@Exemplo.invalid', '--nome', 'Administrador da plataforma'];

function rodar(b: ReturnType<typeof bancoFalso>, env: Record<string, string> = { AMBIENTE: 'dev' }) {
  const email = emailAcessoMemoria();
  const saida: string[] = [];
  const r = executar(ARGS, {
    env: { WEB_ENDERECO: 'https://painel.exemplo.invalid:5311/', ...env },
    email,
    escrever: b.escrever,
    agora: () => AGORA,
    saida: (l) => saida.push(l),
  });
  return { r, email, saida };
}

describe('plataforma:criar-admin', () => {
  it('argumentos: --email e --nome obrigatórios, e-mail em minúsculas, nada além deles', () => {
    expect(analisarArgumentos(['--', '--email=A@B.invalid', '--nome', ' Fulano '])).toEqual({
      email: 'a@b.invalid',
      nome: 'Fulano',
    });
    expect(() => analisarArgumentos(['--nome', 'x'])).toThrow('--email é obrigatório');
    expect(() => analisarArgumentos(['--email', 'a@b.invalid'])).toThrow('--nome é obrigatório');
    expect(() => analisarArgumentos(['--email', 'sem-arroba', '--nome', 'x'])).toThrow('fora do formato');
    expect(() => analisarArgumentos(['--email', 'a@b.invalid', '--nome', 'x', '--senha=1'])).toThrow(
      'argumento desconhecido',
    );
    expect(() => analisarArgumentos(['--email', '--nome', 'x'])).toThrow('--email sem valor');
  });

  it('decisão: só a inicialização; reconvida a conta da plataforma sem senha', () => {
    expect(decidir({ plataformaAtivasComSenha: 1, contaDoEmail: null }).acao).toBe('recusar');
    expect(decidir({ plataformaAtivasComSenha: 0, contaDoEmail: null })).toEqual({ acao: 'criar' });
    expect(
      decidir({ plataformaAtivasComSenha: 0, contaDoEmail: { id: 7, papel: 'plataforma', comSenha: false } }),
    ).toEqual({ acao: 'reconvidar', id: 7 });
    expect(
      decidir({ plataformaAtivasComSenha: 0, contaDoEmail: { id: 7, papel: 'plataforma', comSenha: true } })
        .acao,
    ).toBe('recusar');
    expect(
      decidir({ plataformaAtivasComSenha: 0, contaDoEmail: { id: 7, papel: 'suporte', comSenha: false } })
        .acao,
    ).toBe('recusar');
  });

  it('a validade do convite é a mesma da API', () => {
    expect(CONVITE_HORAS_INICIAL).toBe(CONVITE_HORAS);
  });

  it('cria a conta sem senha com o convite da API, audita a inicialização e envia sem imprimir o link', async () => {
    const b = bancoFalso();
    const { r, email, saida } = rodar(b);
    expect((await r).acao).toBe('criar');
    expect(b.contas).toHaveLength(1);
    const c = b.contas[0]!;
    expect(c).toMatchObject({ email: 'dono@exemplo.invalid', papel: 'plataforma', senha: null });
    expect(c.ate?.getTime()).toBe(AGORA.getTime() + CONVITE_HORAS * 3600_000);
    expect(b.eventos).toEqual([
      {
        evento: EVENTO_CRIADA,
        alvo: 1,
        detalhe: JSON.stringify({ motivo: 'inicializacao-da-plataforma', papel: 'plataforma' }),
        estacao: 'TERMINAL',
      },
    ]);
    expect(email.enviadas).toHaveLength(1);
    const m = email.enviadas[0]!;
    expect(m.para).toBe('dono@exemplo.invalid');
    const token = /\/plataforma\/convite\?token=([A-Za-z0-9_-]+)\n/.exec(m.texto)?.[1] ?? '';
    expect(m.texto).toContain('https://painel.exemplo.invalid:5311/plataforma/convite?token=');
    expect(hashConvite(token)).toBe(c.convite);
    expect(saida).toEqual(['convite enviado para dono@exemplo.invalid']);
    expect(saida.join('')).not.toContain(token);
  });

  it('conta do e-mail sem senha: convite novo (o antigo deixa de valer) e reenvio', async () => {
    const b = bancoFalso([
      {
        id: 3,
        email: 'dono@exemplo.invalid',
        papel: 'plataforma',
        ativo: true,
        senha: null,
        convite: 'velho',
        ate: null,
      },
    ]);
    const { r, email } = rodar(b);
    expect(await r).toEqual({ acao: 'reconvidar', id: 3 });
    expect(b.contas[0]!.convite).not.toBe('velho');
    expect(b.eventos.map((e) => e.evento)).toEqual([EVENTO_CONVITE]);
    expect(email.enviadas).toHaveLength(1);
  });

  it('recusa: já há plataforma ativa com senha (nada gravado nem enviado)', async () => {
    const b = bancoFalso([
      {
        id: 1,
        email: 'outro@exemplo.invalid',
        papel: 'plataforma',
        ativo: true,
        senha: '$argon2id$x',
        convite: null,
        ate: null,
      },
    ]);
    const { r, email } = rodar(b);
    await expect(r).rejects.toThrow('recusado: já existe conta da plataforma ativa com senha');
    expect(b.contas).toHaveLength(1);
    expect(b.eventos).toEqual([]);
    expect(email.enviadas).toEqual([]);
  });

  it('recusa em produção e sem envio configurado, antes de gravar', async () => {
    const b = bancoFalso();
    await expect(rodar(b, { AMBIENTE: 'producao' }).r).rejects.toThrow('recusado em produção');
    await expect(
      executar(ARGS, { env: { AMBIENTE: 'dev' }, email: null, escrever: b.escrever }),
    ).rejects.toThrow('envio de e-mail não configurado');
    expect(b.contas).toEqual([]);
  });
});

describe('entrega pelo canal do dono (decisão do dono, 24/11/2026)', () => {
  it('o e-mail do dono vem de DONO_EMAIL, senão o padrão do aviso da obra', () => {
    expect(emailDoDono({ DONO_EMAIL: 'Dono@Exemplo.dev' })).toBe('dono@exemplo.dev');
    expect(emailDoDono({})).toBe('mmalves@hal-ai.com');
  });
  it('recusa entregar a quem não é o dono, sem chamar o canal', async () => {
    const porta = envioPeloCanalDoDono({ DONO_EMAIL: 'dono@exemplo.dev' }, '/inexistente');
    await expect(porta.enviar({ para: 'outra@exemplo.dev', assunto: 'x', texto: 'link' })).rejects.toThrow(
      'só entrega ao e-mail do dono',
    );
  });
});
