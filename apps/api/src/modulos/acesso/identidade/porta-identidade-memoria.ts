// Porta da identidade em memória (testes unitários do M59-F2): usuários sintéticos, sem banco. Guarda o hash forte e o
// envelope do segredo só aqui dentro, como o banco guardaria; a trilha vai a uma lista para conferência.
import type {
  ContaIdentidade,
  CredencialForte,
  LinhaPolitica2faRegistrada,
  SegundoFatorRegistrado,
  TrilhaIdentidade,
} from './tipos-identidade.js';
import { legadoMudouDepoisDaForte, situacaoCredencial } from '@sgh/dominio-acesso';
import type { PortaIdentidade } from './servico-identidade.js';

interface UsuarioMemoria extends ContaIdentidade {
  forte?: CredencialForte & { hash: string };
  segundoFator?: SegundoFatorRegistrado & { ultimoPassoMs?: number };
}

export class PortaIdentidadeMemoria implements PortaIdentidade {
  readonly trilha: TrilhaIdentidade[] = [];
  readonly usuariosPorLogin = new Map<string, UsuarioMemoria>();
  readonly linhas: LinhaPolitica2faRegistrada[] = [];
  tabelas = true;
  private seq = 100;

  constructor(private readonly relogio: () => number = () => Date.now()) {}

  usuario(c: Partial<ContaIdentidade> & { login: string; id: number }): this {
    this.usuariosPorLogin.set(c.login, {
      nomeExibicao: c.login,
      ativo: true,
      bloqueado: false,
      grupo: null,
      senhaPresente: true,
      criptografada: true,
      comSalt: true,
      senhaAlteradaEm: new Date('2026-01-01T00:00:00Z'),
      ...c,
    });
    return this;
  }

  private u(login: string, id?: number): UsuarioMemoria | undefined {
    const u = this.usuariosPorLogin.get(login);
    return u && (id === undefined || u.id === id) ? u : undefined;
  }

  prontas = async () => this.tabelas;
  conta = async (_h: string, login: string) => {
    const u = this.u(login);
    if (!u) return null;
    const c: Partial<UsuarioMemoria> = { ...u };
    delete c.forte;
    delete c.segundoFator;
    return c as ContaIdentidade;
  };
  forte = async (_h: string, login: string, id: number) => {
    const f = this.u(login, id)?.forte;
    if (!f) return null;
    const c: Partial<typeof f> = { ...f };
    delete c.hash;
    return c as CredencialForte;
  };
  autenticarForte: PortaIdentidade['autenticarForte'] = async (h, login, id, senha, conferir) => {
    const f = this.u(login, id)?.forte;
    if (!f) return null;
    const credencial = (await this.forte(h, login, id)) as CredencialForte;
    return { confere: await conferir(senha, f.hash), credencial };
  };
  gravarForte: PortaIdentidade['gravarForte'] = async (_h, c, t) => {
    const u = this.u(c.login, c.idUsuario);
    if (!u) throw new Error('sem usuário');
    u.forte = {
      id: String(++this.seq),
      algoritmo: c.algoritmo,
      parametros: c.parametros,
      origem: c.origem,
      criadaEm: new Date(this.relogio()),
      hash: c.hashPhc,
    };
    this.trilha.push(t);
  };
  segundoFator = async (_h: string, login: string, id: number) => this.u(login, id)?.segundoFator ?? null;
  iniciar2fa: PortaIdentidade['iniciar2fa'] = async (_h, c, t) => {
    const u = this.u(c.login, c.idUsuario);
    if (!u) throw new Error('sem usuário');
    if (u.segundoFator?.situacao === 'ativo') return null;
    const id = u.segundoFator?.id ?? String(++this.seq);
    u.segundoFator = {
      id,
      situacao: 'pendente',
      segredoEnvelope: c.segredoEnvelope,
      digitos: 6,
      passoSegundos: 30,
      criadoEm: new Date(this.relogio()),
      confirmadoEm: null,
      ultimaVerificacao: null,
    };
    this.trilha.push(t);
    return { id };
  };
  private porId(id: string): UsuarioMemoria | undefined {
    return [...this.usuariosPorLogin.values()].find((u) => u.segundoFator?.id === id);
  }
  confirmar2fa: PortaIdentidade['confirmar2fa'] = async (_h, id, t) => {
    const u = this.porId(id);
    if (!u?.segundoFator || u.segundoFator.situacao !== 'pendente') return false;
    u.segundoFator = { ...u.segundoFator, situacao: 'ativo', confirmadoEm: new Date(this.relogio()) };
    this.trilha.push(t);
    return true;
  };
  revogar2fa: PortaIdentidade['revogar2fa'] = async (_h, id, t) => {
    const u = this.porId(id);
    if (!u?.segundoFator || u.segundoFator.situacao === 'revogado') return false;
    u.segundoFator = { ...u.segundoFator, situacao: 'revogado', segredoEnvelope: '-' };
    this.trilha.push(t);
    return true;
  };
  marcar2fa: PortaIdentidade['marcar2fa'] = async (_h, id, instante) => {
    const u = this.porId(id);
    const f = u?.segundoFator;
    if (!u || !f || f.situacao !== 'ativo') return false;
    if (f.ultimoPassoMs !== undefined && f.ultimoPassoMs >= instante.getTime()) return false;
    u.segundoFator = { ...f, ultimoPassoMs: instante.getTime(), ultimaVerificacao: instante };
    return true;
  };
  politicas = async (h: string) => this.linhas.filter((l) => l.hospital === h);
  incluirPolitica: PortaIdentidade['incluirPolitica'] = async (_h, p, t) => {
    const id = String(++this.seq);
    this.linhas.unshift({
      id,
      ...p,
      valor: p.alvo === 'todos' ? null : p.valor,
      criadaEm: new Date(this.relogio()),
      encerradaEm: null,
    });
    this.trilha.push(t);
    return { id };
  };
  encerrarPolitica: PortaIdentidade['encerrarPolitica'] = async (_h, c, t) => {
    const i = this.linhas.findIndex((l) => l.id === c.id && l.hospital === c.hospital && !l.encerradaEm);
    if (i < 0) return false;
    this.linhas[i] = {
      ...(this.linhas[i] as LinhaPolitica2faRegistrada),
      encerradaEm: new Date(this.relogio()),
    };
    this.trilha.push(t);
    return true;
  };
  alterarPolitica: PortaIdentidade['alterarPolitica'] = async (h, a, t) => {
    const atual = this.linhas.find((l) => l.id === a.id && l.hospital === a.hospital && !l.encerradaEm);
    if (!atual) return null;
    await this.encerrarPolitica(h, { ...a, motivo: `Alterada: ${a.motivo}` }, t);
    const r = await this.incluirPolitica(
      h,
      {
        hospital: a.hospital,
        alvo: a.alvo,
        valor: a.valor,
        onda: atual.onda,
        inicio: atual.inicio,
        prazoAdesaoDias: a.prazoAdesaoDias,
        motivo: a.motivo,
        criadaPor: a.por,
      },
      t,
    );
    return { id: r.id, anterior: a.id };
  };
  usuarios: PortaIdentidade['usuarios'] = async (_h, f) => {
    const todos = [...this.usuariosPorLogin.values()]
      .filter((u) => !f.busca || u.login.toUpperCase().startsWith(f.busca.toUpperCase()))
      // Situação antes da paginação, como a porta própria faz no SQL.
      .filter(
        (u) =>
          !f.senha ||
          situacaoCredencial(u.forte ?? null, {
            presente: u.senhaPresente,
            criptografada: u.criptografada,
            comSalt: u.comSalt,
            alteradaEm: u.senhaAlteradaEm,
          }) === f.senha,
      )
      .sort((a, b) => a.login.localeCompare(b.login));
    const ini = (f.pagina - 1) * f.tamanho;
    const pagina = todos.slice(ini, ini + f.tamanho);
    return {
      itens: pagina.map((u) => {
        const { forte, segundoFator, ...c } = u;
        return {
          ...c,
          forteEm: forte?.criadaEm ?? null,
          forteAlgoritmo: forte?.algoritmo ?? null,
          segundoFator: segundoFator?.situacao ?? 'ausente',
        };
      }),
      temMais: todos.length > ini + f.tamanho,
    };
  };
  contagens: PortaIdentidade['contagens'] = async () => {
    const grupos = new Map<
      string,
      { k: Omit<Awaited<ReturnType<PortaIdentidade['contagens']>>[number], 'n'>; n: number }
    >();
    for (const u of this.usuariosPorLogin.values()) {
      if (!u.ativo || u.bloqueado) continue;
      const forteVigente =
        !!u.forte && (!u.senhaPresente || !legadoMudouDepoisDaForte(u.senhaAlteradaEm, u.forte.criadaEm));
      const k = {
        senhaPresente: u.senhaPresente,
        criptografada: u.criptografada,
        comSalt: u.comSalt,
        forteVigente,
        segundoFator: u.segundoFator?.situacao ?? ('ausente' as const),
      };
      const chave = JSON.stringify(k);
      const g = grupos.get(chave) ?? { k, n: 0 };
      g.n++;
      grupos.set(chave, g);
    }
    return [...grupos.values()].map((g) => ({ ...g.k, n: g.n }));
  };
}
