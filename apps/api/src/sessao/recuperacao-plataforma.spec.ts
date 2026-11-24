// Família acesso-email: "Esqueci a senha" e código no e-mail do administrador da plataforma (unidade, banco falso).
import type { Escritor, Leitor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from './armazem.js';
import { ServicoCodigoEmail } from './codigo-email.js';
import { emailAcessoMemoria } from './email-acesso.js';
import type { NucleoPlataforma } from './fonte-plataforma.js';
import {
  PEDIDOS_PLATAFORMA_POR_CONTA_HORA,
  RESPOSTA_RECUPERACAO_PLATAFORMA,
  ServicoRecuperacaoPlataforma,
} from './recuperacao-plataforma.js';

interface Adm {
  id: number;
  email: string;
  ativo: boolean;
  login: string;
  metodo_segundo_fator: string;
  resumo_senha: string;
  troca_obrigatoria: boolean;
}

function bancoFalso(adms: Adm[]) {
  const eventos: { id: number; tipo: string }[] = [];
  const linha = (a: Adm | undefined) => (a ? { ...a } : null);
  const leitor = {
    uma: (sql: string, p: unknown[]) =>
      Promise.resolve(
        linha(
          sql.includes('a.email = ?') ? adms.find((a) => a.email === p[0]) : adms.find((a) => a.id === p[0]),
        ),
      ),
  } as unknown as Leitor;
  const escritor = {
    executar: (sql: string, p: unknown[]) => {
      if (sql.includes('INSERT INTO credencial_administrador_evento')) {
        eventos.push({
          id: Number(p[0]),
          tipo: sql.includes("'senha_recuperada'")
            ? 'senha_recuperada'
            : sql.includes("'segundo_fator_metodo_alterado'")
              ? 'segundo_fator_metodo_alterado'
              : String(p[1]),
        });
        return Promise.resolve(1);
      }
      const a = adms.find((x) => x.id === p[p.length - 1]);
      if (!a) return Promise.resolve(0);
      if (sql.includes('metodo_segundo_fator = ?')) a.metodo_segundo_fator = String(p[0]);
      else {
        a.resumo_senha = String(p[0]);
        a.troca_obrigatoria = true;
      }
      return Promise.resolve(1);
    },
  } as unknown as Escritor;
  const nucleo: NucleoPlataforma = {
    lerPlataforma: (_c, fn) => fn(leitor),
    escreverPlataforma: (_c, fn) => fn(escritor),
  };
  return { nucleo, eventos };
}

const adm = (id: number, email: string, ativo = true): Adm => ({
  id,
  email,
  ativo,
  login: `adm${id}`,
  metodo_segundo_fator: 'aplicativo',
  resumo_senha: '$argon2id$antigo',
  troca_obrigatoria: false,
});

function montar(adms: Adm[]) {
  const banco = bancoFalso(adms);
  const email = emailAcessoMemoria();
  const armazem = new ArmazemMemoria();
  const s = new ServicoRecuperacaoPlataforma(
    banco.nucleo,
    armazem,
    email,
    new ServicoCodigoEmail(armazem, email),
    {
      linkTela: 'http://127.0.0.1/plataforma/recuperar-senha',
      cifrar: (x) => Promise.resolve(`$argon2id$teste$${x.length}`),
    },
  );
  return { s, email, banco, adms };
}

const tokenDe = (texto: string) => /token=([A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? '';

describe('ServicoRecuperacaoPlataforma', () => {
  it('mesma resposta exista ou não a conta; só a conta ativa recebe o link', async () => {
    const { s, email, banco } = montar([
      adm(1, 'ativo@exemplo.invalid'),
      adm(2, 'inativo@exemplo.invalid', false),
    ]);
    for (const e of ['ATIVO@exemplo.invalid', 'inativo@exemplo.invalid', 'ninguem@exemplo.invalid'])
      expect(await s.pedir(e, '10.0.0.1', 'c1')).toEqual({ mensagem: RESPOSTA_RECUPERACAO_PLATAFORMA });
    await s.aguardarEnvios();
    expect(email.enviadas.map((m) => m.para)).toEqual(['ativo@exemplo.invalid']);
    expect(banco.eventos).toEqual([{ id: 1, tipo: 'recuperacao_pedida' }]);
  });

  it('token de uso único vira senha provisória com troca obrigatória', async () => {
    const { s, email, adms, banco } = montar([adm(1, 'ativo@exemplo.invalid')]);
    await s.pedir('ativo@exemplo.invalid', null, 'c1');
    await s.aguardarEnvios();
    const token = tokenDe(email.enviadas[0]?.texto ?? '');
    expect(token).toHaveLength(43);
    const r = await s.usar(token, null, 'c2');
    expect(r.trocaObrigatoria).toBe(true);
    expect(r.senhaProvisoria.length).toBeGreaterThanOrEqual(16);
    expect(adms[0]?.troca_obrigatoria).toBe(true);
    expect(adms[0]?.resumo_senha).toMatch(/^\$argon2id\$teste/);
    expect(banco.eventos.at(-1)).toEqual({ id: 1, tipo: 'senha_recuperada' });
    await expect(s.usar(token, null, 'c3')).rejects.toMatchObject({ codigo: 'token-invalido', status: 400 });
  });

  it('pedido novo invalida o token anterior', async () => {
    const { s, email } = montar([adm(1, 'ativo@exemplo.invalid')]);
    await s.pedir('ativo@exemplo.invalid', null, 'c1');
    await s.aguardarEnvios();
    await s.pedir('ativo@exemplo.invalid', null, 'c1');
    await s.aguardarEnvios();
    const [t1, t2] = email.enviadas.map((m) => tokenDe(m.texto));
    await expect(s.usar(t1 ?? '', null, 'c')).rejects.toMatchObject({ codigo: 'token-invalido' });
    await expect(s.usar(t2 ?? '', null, 'c')).resolves.toMatchObject({ trocaObrigatoria: true });
  });

  it('limite por conta conta antes de saber se ela existe (429 igual para todos)', async () => {
    const { s } = montar([]);
    for (let k = 0; k < PEDIDOS_PLATAFORMA_POR_CONTA_HORA; k++)
      await s.pedir('ninguem@exemplo.invalid', `ip${k}`, 'c');
    await expect(s.pedir('ninguem@exemplo.invalid', 'ip-novo', 'c')).rejects.toMatchObject({ status: 429 });
  });

  it('e-mail inválido é 400 e sem envio montado é 503', async () => {
    const { s } = montar([]);
    await expect(s.pedir('sem-arroba', null, 'c')).rejects.toMatchObject({ status: 400 });
    const banco = bancoFalso([]);
    const sem = new ServicoRecuperacaoPlataforma(banco.nucleo, new ArmazemMemoria(), null, null, {
      linkTela: 'x',
    });
    expect(sem.disponivel).toBe(false);
    await expect(sem.pedir('a@b.c', null, 'c')).rejects.toMatchObject({ status: 503 });
  });

  it('segundo fator: escolhe o e-mail, emite e confere o código uma vez', async () => {
    const { s, email, banco } = montar([adm(5, 'adm5@exemplo.invalid')]);
    expect(await s.metodoSegundoFator(5)).toBe('aplicativo');
    await s.escolherMetodoSegundoFator(5, 'email', null, 'c');
    expect(await s.metodoSegundoFator(5)).toBe('email');
    await s.emitirCodigo(5, null, 'c');
    const codigo = /(\d{6})/.exec(email.enviadas[0]?.texto ?? '')?.[1] ?? '';
    expect(await s.conferirCodigo(5, '000000' === codigo ? '111111' : '000000', null, 'c')).toBe('invalido');
    expect(await s.conferirCodigo(5, codigo, null, 'c')).toBe('ok');
    expect(await s.conferirCodigo(5, codigo, null, 'c')).toBe('invalido');
    expect(banco.eventos.map((e) => e.tipo)).toEqual([
      'segundo_fator_metodo_alterado',
      'codigo_email_enviado',
      'codigo_email_recusado',
      'codigo_email_conferido',
      'codigo_email_recusado',
    ]);
    await expect(s.escolherMetodoSegundoFator(5, 'sms' as never, null, 'c')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('segundo fator: quem usa o aplicativo não recebe nem confere código por e-mail (409)', async () => {
    const { s, email, banco } = montar([adm(6, 'adm6@exemplo.invalid')]);
    expect(await s.metodoSegundoFator(6)).toBe('aplicativo');
    await expect(s.emitirCodigo(6, null, 'c')).rejects.toMatchObject({
      codigo: 'metodo-nao-escolhido',
      status: 409,
    });
    await expect(s.conferirCodigo(6, '123456', null, 'c')).rejects.toMatchObject({
      codigo: 'metodo-nao-escolhido',
      status: 409,
    });
    expect(email.enviadas).toHaveLength(0);
    expect(banco.eventos).toHaveLength(0);
  });
});
