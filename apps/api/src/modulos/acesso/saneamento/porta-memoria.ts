// A porta do saneamento (M59-F4) em memória: unitários e a fonte sintética do dev/ci (nada vai à cópia). Guarda os
// grupos (com as opções), os usuários sintéticos, o uso das opções e o plano; as regras de situação e do CHECK do banco
// (ninguém aprova o que propôs nem a si; uma decisão viva por alvo) são as mesmas da gravação SGH_.
import { type ItemSaneamento, RESERVA_APLICACAO_MINUTOS } from '@sgh/contratos';
import type { NovoItemSaneamentoSgh, TrilhaSaneamento, UsuarioGrupoLido } from '@sgh/legado';
import type { GrupoComOpcoes, PortaSaneamento } from './porta.js';

const VIVAS = new Set(['proposto', 'aprovado', 'falhou']);

export class PortaSaneamentoMemoria implements PortaSaneamento {
  readonly gruposMem = new Map<string, { ativo: boolean; opcoes: Set<number> }>();
  readonly usuariosMem = new Map<string, UsuarioGrupoLido>();
  readonly usoMem = new Map<string, Map<number, number>>();
  readonly itens: ItemSaneamento[] = [];
  readonly trilhas: TrilhaSaneamento[] = [];
  readonly titulosMem = new Map<number, string>();
  prontoMem = true;
  private seq = 0;

  constructor(private readonly relogio: () => number = () => Date.now()) {}

  comGrupo(nome: string, opcoes: readonly number[], ativo = true): this {
    this.gruposMem.set(nome, { ativo, opcoes: new Set(opcoes) });
    return this;
  }

  comUsuario(u: UsuarioGrupoLido, uso: Readonly<Record<number, number>> = {}): this {
    this.usuariosMem.set(u.login, u);
    this.usoMem.set(u.login, new Map(Object.entries(uso).map(([k, v]) => [Number(k), v])));
    return this;
  }

  private doGrupo(g: string, u: UsuarioGrupoLido): boolean {
    return u.grupo === g || (g === 'SEM GRUPO' && u.grupo === null);
  }

  async pronto(): Promise<boolean> {
    return this.prontoMem;
  }

  async grupos(_h: string, nomes: readonly string[]) {
    return nomes.map((grupo) => {
      const g = this.gruposMem.get(grupo);
      const us = [...this.usuariosMem.values()].filter((u) => this.doGrupo(grupo, u));
      return {
        grupo,
        existe: g !== undefined,
        ativo: g?.ativo ?? false,
        usuarios: us.length,
        ativos: us.filter((u) => u.ativo && !u.bloqueado).length,
        opcoes: g?.opcoes.size ?? 0,
      };
    });
  }

  async usuarios(_h: string, grupo: string) {
    return [...this.usuariosMem.values()]
      .filter((u) => this.doGrupo(grupo, u))
      .sort((a, b) => Number(this.inativo(a)) - Number(this.inativo(b)) || a.login.localeCompare(b.login));
  }

  private inativo(u: UsuarioGrupoLido): boolean {
    return !u.ativo || u.bloqueado;
  }

  async usuario(_h: string, login: string) {
    return this.usuariosMem.get(login) ?? null;
  }

  async gruposComOpcoes(): Promise<GrupoComOpcoes[]> {
    return [...this.gruposMem].map(([grupo, g]) => ({ grupo, ativo: g.ativo, opcoes: [...g.opcoes] }));
  }

  async titulos(_h: string, ids: readonly number[]) {
    return new Map(ids.map((id) => [id, this.titulosMem.get(id) ?? `Opção ${id}`]));
  }

  async uso(_h: string, grupo: string) {
    const r = new Map<string, Map<number, number>>();
    for (const u of (await this.usuarios(_h, grupo)).filter((x) => !this.inativo(x))) {
      const m = this.usoMem.get(u.login);
      if (m && m.size > 0) r.set(u.login, new Map(m));
    }
    return r;
  }

  async plano(h: string, grupo?: string) {
    return this.itens
      .filter((i) => (!grupo || i.grupoOrigem === grupo) && this.hospitalDe.get(i.id) === h)
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  async item(h: string, id: string) {
    const i = this.itens.find((x) => x.id === id);
    return i && this.hospitalDe.get(id) === h ? i : null;
  }

  private readonly hospitalDe = new Map<string, string>();

  private trocar(id: string, mudanca: Partial<ItemSaneamento>) {
    const k = this.itens.findIndex((x) => x.id === id);
    const atual = this.itens[k];
    if (atual) this.itens[k] = { ...atual, ...mudanca };
  }

  /** Reserva viva de aplicação (aplicadoPor e aplicadoEm com a situação ainda viva), como o SEM_RESERVA da gravação. */
  private reservado(i: ItemSaneamento): boolean {
    if (i.situacao === 'falhou' || i.aplicadoPor === null || i.aplicadoEm === null) return false;
    return this.relogio() - Date.parse(i.aplicadoEm) < RESERVA_APLICACAO_MINUTOS * 60_000;
  }

  private agoraIso() {
    return new Date(this.relogio()).toISOString();
  }

  async incluir(h: string, n: NovoItemSaneamentoSgh, t: TrilhaSaneamento) {
    if (n.login !== null && n.criadoPor === n.login) throw new Error('CHECK SGH_CK_ACESSO_SAN_A_SI');
    for (const i of this.itens)
      if (
        this.hospitalDe.get(i.id) === h &&
        VIVAS.has(i.situacao) &&
        !this.reservado(i) &&
        (n.login !== null ? i.login === n.login : i.login === null && i.grupoOrigem === n.grupoOrigem)
      )
        this.trocar(i.id, { situacao: 'descartado' });
    const id = String(++this.seq);
    this.hospitalDe.set(id, h);
    this.itens.push({
      id,
      grupoOrigem: n.grupoOrigem,
      login: n.login,
      idUsuario: n.idUsuario,
      decisao: n.decisao,
      grupoDestino: n.grupoDestino,
      perdasTotal: n.perdasTotal,
      perdasUsadas: n.perdasUsadas,
      exigeAprovacao: n.exigeAprovacao,
      situacao: 'proposto',
      motivo: n.motivo,
      criadoPor: n.criadoPor,
      criadoEm: this.agoraIso(),
      aprovacao: null,
      aplicadoEm: null,
      aplicadoPor: null,
      erro: null,
    });
    this.trilhas.push(t);
    return { id };
  }

  async aprovar(
    h: string,
    a: { id: string; area: string; aprovadoPor: string; motivo: string },
    t: TrilhaSaneamento,
  ) {
    const i = await this.item(h, a.id);
    if (!i || i.situacao !== 'proposto' || !i.exigeAprovacao) return false;
    if (a.aprovadoPor === i.criadoPor || a.aprovadoPor === i.login)
      throw new Error('CHECK SGH_CK_ACESSO_SAN_APROVA');
    this.trocar(a.id, {
      situacao: 'aprovado',
      aprovacao: { area: a.area, por: a.aprovadoPor, em: this.agoraIso(), motivo: a.motivo },
    });
    this.trilhas.push(t);
    return true;
  }

  async descartar(h: string, d: { id: string; por: string }, t: TrilhaSaneamento) {
    const i = await this.item(h, d.id);
    if (!i || !VIVAS.has(i.situacao) || this.reservado(i)) return false;
    this.trocar(d.id, { situacao: 'descartado' });
    this.trilhas.push(t);
    return true;
  }

  async reservar(h: string, r: { id: string; por: string }, t: TrilhaSaneamento) {
    const i = await this.item(h, r.id);
    if (!i || (i.situacao !== 'proposto' && i.situacao !== 'aprovado') || this.reservado(i)) return false;
    this.trocar(r.id, { aplicadoPor: r.por, aplicadoEm: this.agoraIso() });
    this.trilhas.push(t);
    return true;
  }

  async concluir(
    h: string,
    c: { id: string; por: string; resultado: 'aplicado' | 'falhou'; erro: string | null },
    t: TrilhaSaneamento,
  ) {
    const i = await this.item(h, c.id);
    if (!i || (i.situacao !== 'proposto' && i.situacao !== 'aprovado') || i.aplicadoPor !== c.por)
      return false;
    this.trocar(
      c.id,
      c.resultado === 'aplicado'
        ? { situacao: 'aplicado', aplicadoEm: this.agoraIso(), erro: null }
        : { situacao: 'falhou', erro: c.erro, aplicadoPor: null, aplicadoEm: null },
    );
    this.trilhas.push(t);
    return true;
  }
}
