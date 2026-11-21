// Estado SINTÉTICO do acesso do legado e das tabelas SGH_ do acesso (ADR 0022), só em dev/ci com a fonte
// sintética: grupos, opções por grupo e por papel, papéis e grupo de cada conta sintética, perfis concedidos e
// o mapa. A fonte sintética (fonte-sintetica.ts) lê as concessões DAQUI, e a gestão em memória
// (gestao-fonte.ts) grava AQUI com as mesmas regras e recusas das receitas do legado: o que a tela concede
// muda as permissões efetivas da conta sintética, sem tocar a cópia. Um estado por processo (as duas
// instâncias da fonte sintética da API o compartilham). Nenhum dado real.
import type { ConcessoesLegado, PerfilConcedido, PermissaoDoPerfil } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import {
  diferencaPoliticaSenha,
  normalizarSenhasProibidas,
  type NovaPoliticaSenha,
  type PoliticaSenhaVigenteLida,
  limitesVigentes,
  type NovoLimiteSessao,
  type RegistroLimiteSessaoLido,
  type VersaoPoliticaSenhaLida,
  type ExcecaoDormenciaLida,
  type NovaExcecaoDormencia,
  type ConferenciaConselhoLida,
  type NovaConferenciaConselho,
  type RegistroConselhoUsuario,
  conferenciasConselhoVigentes,
  FONTES_CONFERENCIA_CONSELHO,
  SITUACOES_CONSELHO,
  type AlteracaoPerfilLida,
  type DecisaoMapaLida,
  ErroMotivoMapa,
  mapaMudaDecisao,
} from './tipos-gestao-acesso.js';
import { PedidoAcessoMemoria } from './pedido-acesso-memoria.js';
import { RecertificacaoMemoria } from './recertificacao-memoria.js';
import { RhMemoria } from './rh-memoria.js';

export interface ContaDoEstado {
  readonly id: number;
  grupo: string | null;
  readonly papeis: Map<number, boolean>;
  readonly flags: readonly string[];
  readonly conselho: boolean;
}

export interface ConcessaoSintetica {
  readonly id: string;
  readonly login: string;
  readonly perfil: string;
  inicio: Date;
  fim: Date | null;
  motivo: string | null;
  readonly concedidoPor: string;
  revogadoEm: Date | null;
  revogadoPor: string | null;
  revogadoMotivo?: string | null;
}

export interface LinhaMapaSintetica {
  readonly id: string;
  readonly tipo: 'grupo-perfil' | 'perfil-permissao';
  readonly grupo: string | null;
  readonly perfil: string;
  readonly permissao: string | null;
  readonly origem: 'proposta-automatica' | 'revisao-area';
  situacao: 'proposta' | 'aprovada' | 'recusada';
  aprovadoPor: string | null;
  aprovadoEm: Date | null;
}

export interface SementeConta {
  readonly login: string;
  readonly id: number;
  readonly concessoes: Partial<ConcessoesLegado>;
  /** Perfis complementares concedidos nominalmente desde o início (sem fim). */
  readonly perfis?: readonly string[];
}

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

export interface DescricaoGrupoSintetica {
  id: string;
  grupo: string;
  readonly versao: number;
  readonly descricao: string;
  readonly motivo: string;
  readonly criadoPor: string;
  readonly criadoEm: Date;
  situacao: 'vigente' | 'substituida' | 'retirada';
  encerradaEm: Date | null;
  encerradaPor: string | null;
}

export class EstadoAcessoSintetico {
  readonly grupos = new Map<string, boolean>();
  /**
   * Revisão W1-01 (achado 6): os grupos INCLUÍDOS pela gestão neste processo (renomear leva o nome; excluir tira). A
   * lista da tela (lida ao vivo) os acrescenta em dev/ci, para a tela mostrar o que ela mesma gravou.
   */
  readonly gruposCriados = new Set<string>();
  readonly opcoesGrupo = new Map<string, Set<number>>();
  readonly opcoesPapel = new Map<number, Set<number>>();
  readonly contas = new Map<string, ContaDoEstado>();
  readonly concessoes: ConcessaoSintetica[] = [];
  /** W0-09: alterações de vigência e motivo (só inclusão; o anterior de cada uma). */
  readonly alteracoesPerfil: (AlteracaoPerfilLida & { readonly idConcessao: string })[] = [];
  readonly mapa: LinhaMapaSintetica[] = [];
  /** W0-09: histórico das decisões do mapa (SGH_ACESSO_MAPA_DECISAO na memória). */
  readonly decisoesMapa: (DecisaoMapaLida & { readonly idMapa: string })[] = [];
  /** M10: bloqueio feito pela tela de usuários (sobrepõe o da conta sintética). */
  readonly bloqueio = new Map<string, boolean>();
  /** M10: quem aceitou o termo vigente pela tela (a sessão sintética passa a não ter o termo pendente). */
  readonly aceitesTermo = new Set<string>();
  /** W1-01 (parte 6b): versão nova do termo publicada pela tela: o aceite implícito das contas sintéticas deixa de valer. */
  termoRepublicado = false;
  /** W1-01 (parte 4c): versões da descrição dos grupos, como a SGH_ACESSO_GRUPO_DESCR (nunca sobrescreve). */
  readonly descricoesGrupo: DescricaoGrupoSintetica[] = [];
  /** W1-01 (parte 5): versões da política de senha do Sante, como a SGH_ACESSO_POLITICA_SENHA (nunca sobrescreve). */
  readonly politicasSenha: { -readonly [K in keyof VersaoPoliticaSenhaLida]: VersaoPoliticaSenhaLida[K] }[] =
    [];
  /** W1-01 (parte 8): limites de sessões por perfil, como a SGH_ACESSO_LIMITE_SESSAO (só inclusão). */
  readonly limitesSessao: RegistroLimiteSessaoLido[] = [];
  /** W1-01 (parte 9b): exceções das contas dormentes, como a SGH_ACESSO_DORMENCIA_EXCECAO (só inclusão). */
  readonly excecoesDormencia: ExcecaoDormenciaLida[] = [];
  /** W1-01 (parte 11d): conferências do conselho, como a SGH_ACESSO_CONSELHO_CONFER (só inclusão). */
  readonly conferenciasConselho: ConferenciaConselhoLida[] = [];
  /** W1-01 (parte 9b): última conexão (AAAA-MM-DD) por login, como a TBSGHCONEXAO; ausente = nunca entrou. */
  readonly ultimoAcesso = new Map<string, string>();
  /** W1-01 (parte 9c2): campanhas de recertificação, como a SGH_ 1206 (nada se apaga). */
  readonly recert = new RecertificacaoMemoria();
  /** W1-01 (parte 10b): pedidos de acesso, como a SGH_ 1207 (nada se apaga). */
  readonly pedidos = new PedidoAcessoMemoria();
  /** W1-01 (parte 11a2): provisionamento pelo RH, como a SGH_ 1208 (vínculos sintéticos; nada se apaga). */
  readonly rh = new RhMemoria();
  private seq = 0;

  constructor(
    sementes: readonly SementeConta[],
    private readonly opcoesValidas: ReadonlySet<number>,
  ) {
    for (const s of sementes) {
      const c = s.concessoes;
      const grupo = c.grupo ?? null;
      if (grupo) {
        this.grupos.set(grupo, true);
        const set = this.opcoesGrupo.get(grupo) ?? new Set<number>();
        for (const o of c.opcoesGrupo ?? []) set.add(o);
        this.opcoesGrupo.set(grupo, set);
      }
      const papeis = new Map<number, boolean>();
      for (const p of c.papeis ?? [4]) {
        papeis.set(p, true);
        // As opções de papel das sementes ficam no papel especial (0 a 3), como em TBPAPEL_TBOPCOES.
        if (p !== 4) {
          const set = this.opcoesPapel.get(p) ?? new Set<number>();
          for (const o of c.opcoesPapel ?? []) set.add(o);
          this.opcoesPapel.set(p, set);
        }
      }
      this.contas.set(s.login, {
        id: s.id,
        grupo,
        papeis,
        flags: c.flags ?? [],
        conselho: c.conselho ?? false,
      });
      for (const perfil of s.perfis ?? [])
        this.concessoes.push({
          id: `semente-${s.login}-${perfil}`,
          login: s.login,
          perfil,
          inicio: new Date(0),
          fim: null,
          motivo: 'concessão sintética de desenvolvimento',
          concedidoPor: 'SINT.ADMIN',
          revogadoEm: null,
          revogadoPor: null,
        });
    }
    for (const p of [0, 1, 2, 3, 4]) if (!this.opcoesPapel.has(p)) this.opcoesPapel.set(p, new Set());
  }

  private novoId(): string {
    return String(Date.now() * 10 + (++this.seq % 10));
  }

  /** Concessões do legado da conta (como lerConcessoesUsuario lê do banco). */
  concessoesDe(login: string): ConcessoesLegado | null {
    const c = this.contas.get(login);
    if (!c) return null;
    const ativos = [...c.papeis].filter(([, a]) => a).map(([p]) => p);
    return {
      grupo: c.grupo,
      opcoesGrupo: c.grupo ? [...(this.opcoesGrupo.get(c.grupo) ?? [])] : [],
      opcoesPapel: [...new Set(ativos.flatMap((p) => [...(this.opcoesPapel.get(p) ?? [])]))],
      papeis: ativos,
      flags: c.flags,
      conselho: c.conselho,
    };
  }

  perfisConcedidos(login: string, agora = new Date()): PerfilConcedido[] {
    return this.concessoes
      .filter((x) => x.login === login && !x.revogadoEm && (!x.fim || x.fim > agora))
      .map((x) => ({ perfil: x.perfil, inicio: x.inicio, fim: x.fim }));
  }

  mapaPerfis(): PermissaoDoPerfil[] {
    return this.mapa
      .filter((m) => m.tipo === 'perfil-permissao' && m.situacao === 'aprovada' && m.permissao)
      .map((m) => ({ perfil: m.perfil, permissao: m.permissao as string }));
  }

  perfisDoGrupo(grupo: string | null): string[] {
    if (!grupo) return [];
    return [
      ...new Set(
        this.mapa
          .filter((m) => m.tipo === 'grupo-perfil' && m.situacao === 'aprovada' && m.grupo === grupo)
          .map((m) => m.perfil),
      ),
    ].sort();
  }

  // ── As mesmas regras das receitas do legado (acesso/gravacao/permissoes.ts) ────────────────────

  private exigirConta(login: string): ContaDoEstado {
    const c = this.contas.get(login);
    if (!c) throw recusa('usuario-inexistente', 'Usuário inexistente.');
    return c;
  }

  private exigirGrupo(nome: string, ativo: boolean | null): void {
    const a = this.grupos.get(nome);
    if (a === undefined) throw recusa('grupo-inexistente', 'Grupo inexistente.');
    if (ativo === true && !a) throw recusa('grupo-inativo', 'Grupo inativo: reative o grupo antes.');
  }

  private exigirOpcoes(opcoes: readonly number[]): void {
    for (const o of opcoes)
      if (!this.opcoesValidas.has(o)) throw recusa('opcao-inexistente', `Opção ${o} inexistente.`);
  }

  private naoASiMesmo(login: string, operador: string): void {
    if (login === operador)
      throw recusa('a-si-mesmo', 'Ninguém altera o próprio acesso (segregação de funções).');
  }

  /** Decisão 17 (caminho indireto): nem o próprio grupo nem um papel ativo do operador. */
  private naoNoProprioGrupo(grupo: string, operador: string): void {
    if (this.contas.get(operador)?.grupo === grupo)
      throw recusa('a-si-mesmo', 'Ninguém altera o acesso do próprio grupo (segregação de funções).');
  }

  private naoNoProprioPapel(papel: number, operador: string): void {
    if (this.contas.get(operador)?.papeis.get(papel) === true)
      throw recusa('a-si-mesmo', 'Ninguém altera o acesso de um papel que tem (segregação de funções).');
  }

  aplicar(operacao: string, e: Record<string, unknown>, operador: string): void {
    const opcoes = (e['opcoes'] as number[] | undefined) ?? [];
    switch (operacao) {
      case 'acesso.concederOpcoesGrupo': {
        const g = String(e['grupo']);
        this.exigirGrupo(g, true);
        this.naoNoProprioGrupo(g, operador);
        this.exigirOpcoes(opcoes);
        const set = this.opcoesGrupo.get(g) ?? new Set<number>();
        if (opcoes.some((o) => set.has(o)))
          throw recusa('opcao-ja-concedida', 'Alguma opção já está concedida ao grupo.');
        for (const o of opcoes) set.add(o);
        this.opcoesGrupo.set(g, set);
        return;
      }
      case 'acesso.revogarOpcoesGrupo': {
        const g = String(e['grupo']);
        this.exigirGrupo(g, null);
        this.naoNoProprioGrupo(g, operador);
        const set = this.opcoesGrupo.get(g) ?? new Set<number>();
        if (!opcoes.every((o) => set.has(o)))
          throw recusa('opcao-nao-concedida', 'Alguma opção não está concedida ao grupo.');
        for (const o of opcoes) set.delete(o);
        return;
      }
      case 'acesso.concederOpcoesPapel':
      case 'acesso.revogarOpcoesPapel': {
        const set = this.opcoesPapel.get(Number(e['papel']));
        if (!set) throw recusa('papel-inexistente', 'Papel SBIS inexistente.');
        this.naoNoProprioPapel(Number(e['papel']), operador);
        if (operacao === 'acesso.concederOpcoesPapel') {
          this.exigirOpcoes(opcoes);
          if (opcoes.some((o) => set.has(o)))
            throw recusa('opcao-ja-concedida', 'Alguma opção já está concedida ao papel.');
          for (const o of opcoes) set.add(o);
        } else {
          if (!opcoes.every((o) => set.has(o)))
            throw recusa('opcao-nao-concedida', 'Alguma opção não está concedida ao papel.');
          for (const o of opcoes) set.delete(o);
        }
        return;
      }
      case 'acesso.concederPapelUsuario':
      case 'acesso.reativarPapelUsuario':
      case 'acesso.revogarPapelUsuario': {
        const login = String(e['login']);
        this.naoASiMesmo(login, operador);
        const c = this.exigirConta(login);
        const p = Number(e['papel']);
        const atual = c.papeis.get(p);
        if (operacao === 'acesso.concederPapelUsuario') {
          if (atual === true) throw recusa('papel-ja-concedido', 'O usuário já tem este papel.');
          if (atual === false)
            throw recusa('papel-inativo', 'O usuário tem este papel inativo: use reativar.');
          c.papeis.set(p, true);
        } else if (operacao === 'acesso.reativarPapelUsuario') {
          if (atual !== false) throw recusa('papel-ja-ativo', 'O papel não está inativo.');
          c.papeis.set(p, true);
        } else {
          if (atual !== true) throw recusa('papel-nao-concedido', 'O usuário não tem este papel ativo.');
          if ([...c.papeis.values()].filter(Boolean).length <= 1)
            throw recusa('ultimo-papel', 'É o último papel ativo do usuário: conceda outro antes.');
          c.papeis.set(p, false);
        }
        return;
      }
      case 'acesso.trocarGrupoUsuario': {
        const login = String(e['login']);
        this.naoASiMesmo(login, operador);
        const c = this.exigirConta(login);
        const g = String(e['grupo']);
        this.exigirGrupo(g, true);
        if (c.grupo === g) throw recusa('mesmo-grupo', 'O usuário já é deste grupo.');
        c.grupo = g;
        return;
      }
      case 'acesso.criarGrupo': {
        const n = String(e['nome']);
        if ([...this.grupos.keys()].some((g) => g.toUpperCase() === n.toUpperCase()))
          throw recusa('grupo-existente', 'Já existe grupo com este nome.');
        this.grupos.set(n, true);
        this.opcoesGrupo.set(n, new Set());
        this.gruposCriados.add(n);
        return;
      }
      case 'acesso.desativarGrupo':
      case 'acesso.reativarGrupo': {
        const n = String(e['nome']);
        this.exigirGrupo(n, null);
        const ativo = this.grupos.get(n) === true;
        if (operacao === 'acesso.desativarGrupo') {
          if (!ativo) throw recusa('grupo-inativo', 'O grupo já está inativo.');
          if ([...this.contas.values()].some((c) => c.grupo === n))
            throw recusa('grupo-com-usuarios', 'O grupo tem usuário ativo: troque o grupo deles antes.');
          this.grupos.set(n, false);
        } else {
          if (ativo) throw recusa('grupo-ja-ativo', 'O grupo já está ativo.');
          this.naoNoProprioGrupo(n, operador);
          this.grupos.set(n, true);
        }
        return;
      }
      // W1-01 (parte 4b): renomear e excluir só o grupo sem dependente (logins ou opções), como a receita.
      case 'acesso.renomearGrupo':
      case 'acesso.excluirGrupo': {
        const n = String(e['nome']);
        this.exigirGrupo(n, null);
        const logins = [...this.contas.values()].filter((c) => c.grupo === n).length;
        const opcoes = this.opcoesGrupo.get(n)?.size ?? 0;
        // Revisão (achado 3): a campanha de recertificação por grupo guarda o nome no ALVO.
        const campanhas = this.recert
          .lerCampanhas()
          .filter((c) => c.escopo === 'grupo' && c.alvo === n).length;
        if (logins + opcoes + campanhas > 0)
          throw recusa(
            'com-dependentes',
            `Este grupo tem ${logins + opcoes + campanhas} registros dependentes. ${
              operacao === 'acesso.excluirGrupo'
                ? 'Inative o grupo em vez de excluir.'
                : 'O nome é a chave que esses registros guardam: crie um grupo novo, passe os logins para ele e inative este.'
            }`,
          );
        const ativo = this.grupos.get(n) === true;
        this.grupos.delete(n);
        this.opcoesGrupo.delete(n);
        if (operacao === 'acesso.renomearGrupo') {
          const novo = String(e['novoNome']);
          if ([...this.grupos.keys()].some((g) => g.toUpperCase() === novo.toUpperCase())) {
            this.grupos.set(n, ativo);
            throw recusa('grupo-existente', 'Já existe grupo com este nome.');
          }
          this.grupos.set(novo, ativo);
          this.opcoesGrupo.set(novo, new Set());
          if (this.gruposCriados.delete(n)) this.gruposCriados.add(novo);
          // Parte 4c: a descrição acompanha o nome novo (as do homônimo já excluído ficam).
          for (const d of this.versoesVivasDoGrupo(n)) d.grupo = novo;
        } else {
          this.gruposCriados.delete(n);
          for (const d of this.descricoesGrupo)
            if (d.grupo === n && d.situacao === 'vigente') {
              d.situacao = 'retirada';
              d.encerradaEm = new Date();
              d.encerradaPor = operador;
            }
        }
        return;
      }
      case 'acesso.bloquearUsuario': {
        // M59-F4: o saneamento bloqueia quem não entra há mais de 180 dias (a tela de usuários usa a fonte própria).
        const login = String(e['login']);
        this.naoASiMesmo(login, operador);
        this.exigirConta(login);
        if (this.bloqueio.get(login) === true) throw recusa('ja-bloqueado', 'O usuário já está bloqueado.');
        this.bloqueio.set(login, true);
        return;
      }
      default:
        throw new ErroOperacao(
          422,
          'operacao-desconhecida',
          'Operação desconhecida',
          'Operação fora da tela.',
        );
    }
  }

  /** As versões do grupo depois da última 'retirada' (a de um homônimo excluído fica com ele). */
  private versoesVivasDoGrupo(grupo: string): DescricaoGrupoSintetica[] {
    const doGrupo = this.descricoesGrupo.filter((d) => d.grupo === grupo);
    const corte = Math.max(0, ...doGrupo.filter((d) => d.situacao === 'retirada').map((d) => d.versao));
    return doGrupo.filter((d) => d.versao > corte);
  }

  /** W1-01 (parte 5): a versão em vigor no instante (a publicada de maior vigência já alcançada). */
  politicaSenhaVigente(agora: Date): PoliticaSenhaVigenteLida | null {
    const v = this.politicasSenha
      .filter((p) => p.situacao === 'publicada' && (p.vigenteDesde?.getTime() ?? 0) <= agora.getTime())
      .sort(
        (a, b) => (b.vigenteDesde?.getTime() ?? 0) - (a.vigenteDesde?.getTime() ?? 0) || b.versao - a.versao,
      )[0];
    if (!v) return null;
    const { versao, minimoCaracteres, exigeEspecial, exigeMinuscula, exigeMaiuscula, trocaDias, reusoDias } =
      v;
    return {
      versao,
      minimoCaracteres,
      exigeEspecial,
      exigeMinuscula,
      exigeMaiuscula,
      trocaDias,
      reusoDias,
      recusaNome: v.recusaNome,
      recusaNascimento: v.recusaNascimento,
      recusaComuns: v.recusaComuns,
      senhasProibidas: [...v.senhasProibidas],
    };
  }

  /** W1-01 (parte 5): publica a versão nova, com as mesmas recusas de publicarPoliticaSenha (legado). */
  publicarPoliticaSenha(
    p: NovaPoliticaSenha,
    agora: Date,
  ): { id: string; versao: number; anterior: number | null; diferenca: string[] } {
    if (p.vigenteDesde.getTime() < agora.getTime() - 60_000)
      throw recusa('vigencia-no-passado', 'A vigência começa agora ou no futuro.');
    const ultima = this.politicasSenha
      .filter((x) => x.situacao === 'publicada')
      .sort((a, b) => b.versao - a.versao)[0];
    if (ultima?.vigenteDesde && p.vigenteDesde.getTime() < ultima.vigenteDesde.getTime())
      throw recusa(
        'vigencia-anterior',
        `A vigência não pode ser anterior à da versão ${ultima.versao}; cancele a versão agendada antes.`,
      );
    const lista = normalizarSenhasProibidas(p.senhasProibidas);
    const diferenca = diferencaPoliticaSenha(ultima ?? null, { ...p, senhasProibidas: lista });
    if (ultima && diferenca.length === 0)
      throw recusa('sem-mudanca', 'As regras informadas são iguais às da última versão publicada.');
    const versao = Math.max(0, ...this.politicasSenha.map((x) => x.versao)) + 1;
    const id = this.novoId();
    this.politicasSenha.push({
      id,
      versao,
      minimoCaracteres: p.minimoCaracteres,
      exigeEspecial: p.exigeEspecial,
      exigeMinuscula: p.exigeMinuscula,
      exigeMaiuscula: p.exigeMaiuscula,
      trocaDias: p.trocaDias,
      reusoDias: p.reusoDias,
      recusaNome: p.recusaNome,
      recusaNascimento: p.recusaNascimento,
      recusaComuns: p.recusaComuns,
      senhasProibidas: lista,
      vigenteDesde: p.vigenteDesde,
      motivo: p.motivo,
      criadoPor: p.por,
      criadoEm: agora,
      situacao: 'publicada',
      canceladaEm: null,
      canceladaPor: null,
      motivoCancelamento: null,
    });
    return { id, versao, anterior: ultima?.versao ?? null, diferenca };
  }

  /** W1-01 (parte 5): cancela a versão agendada (a que já está em vigor é recusada). */
  cancelarPoliticaSenha(
    c: { versao: number; motivo: string; por: string },
    agora: Date,
  ): { id: string; versao: number } {
    const v = this.politicasSenha.find((x) => x.versao === c.versao);
    if (!v) throw recusa('nao-encontrado', `A versão ${c.versao} da política não existe.`);
    if (v.situacao !== 'publicada') throw recusa('ja-cancelada', `A versão ${c.versao} já está cancelada.`);
    if (!v.vigenteDesde || v.vigenteDesde.getTime() <= agora.getTime())
      throw recusa(
        'ja-em-vigor',
        `A versão ${c.versao} já entrou em vigor e não se cancela: publique uma versão nova.`,
      );
    v.situacao = 'cancelada';
    v.canceladaEm = agora;
    v.canceladaPor = c.por;
    v.motivoCancelamento = c.motivo;
    return { id: v.id, versao: v.versao };
  }

  /** W1-01 (parte 8): os limites em vigor (a linha mais nova de cada perfil, sem as retiradas). */
  limitesSessaoVigentes(): Record<string, number> {
    return limitesVigentes(this.limitesSessao);
  }

  /** W1-01 (parte 8): linha nova do limite, com as mesmas recusas de definirLimiteSessao (legado). */
  definirLimiteSessao(p: NovoLimiteSessao): { id: string; anterior: number | null; limite: number | null } {
    if (p.limite !== null && (!Number.isInteger(p.limite) || p.limite < 1 || p.limite > 50))
      throw recusa('limite-invalido', 'O limite vai de 1 a 50 sessões.');
    const ultima = [...this.limitesSessao].reverse().find((x) => x.perfil === p.perfil);
    const anterior = ultima?.limite ?? null;
    if (p.limite === null && anterior === null)
      throw recusa('sem-limite', 'Este perfil não tem limite próprio para retirar.');
    if (p.limite !== null && anterior === p.limite)
      throw recusa('sem-mudanca', 'O limite informado é igual ao que já vale para este perfil.');
    const id = String(this.limitesSessao.length + 1);
    this.limitesSessao.push({
      id,
      perfil: p.perfil,
      limite: p.limite,
      situacao: p.limite === null ? 'retirado' : 'vigente',
      motivo: p.motivo,
      criadoPor: p.por,
      criadoEm: new Date(),
    });
    return { id, anterior, limite: p.limite };
  }

  /** W1-01 (parte 11d): o registro sintético de conselho de quem tem a categoria com conselho (um por conta). */
  registrosConselho(login: string): RegistroConselhoUsuario[] {
    return this.concessoesDe(login)?.conselho
      ? [
          {
            registro: 1,
            sigla: null,
            numero: null,
            uf: null,
            ocupacao: 'Registro sintético (desenvolvimento)',
          },
        ]
      : [];
  }

  /** W1-01 (parte 11d): a última conferência de cada registro sintético do login (para a autorização). */
  registrosConselhoConferidos(login: string): {
    registro: number;
    conferencia: { situacao: ConferenciaConselhoLida['situacao']; conferidoEm: string } | null;
  }[] {
    const v = conferenciasConselhoVigentes(this.conferenciasConselho.filter((x) => x.login === login));
    return this.registrosConselho(login).map((r) => {
      const c = v.get(r.registro);
      return {
        registro: r.registro,
        conferencia: c ? { situacao: c.situacao, conferidoEm: c.conferidoEm } : null,
      };
    });
  }

  /** W1-01 (parte 11d): linha nova da conferência, com as mesmas recusas de registrarConferenciaConselho (legado). */
  registrarConferenciaConselho(p: NovaConferenciaConselho): {
    id: string;
    anterior: string | null;
    atual: string;
  } {
    const observacao = p.observacao.trim();
    if (observacao.length < 10)
      throw recusa('observacao-curta', 'Descreva a conferência (ao menos 10 caracteres).');
    if (!(SITUACOES_CONSELHO as readonly string[]).includes(p.situacao))
      throw recusa('situacao-invalida', 'Situação no conselho fora da lista.');
    if (!(FONTES_CONFERENCIA_CONSELHO as readonly string[]).includes(p.fonte))
      throw recusa('fonte-invalida', 'Fonte da conferência fora da lista.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.conferidoEm))
      throw recusa('data-invalida', 'Informe o dia da consulta à fonte (AAAA-MM-DD).');
    if (p.conferidoEm > p.hoje)
      throw recusa('data-futura', 'O dia da consulta à fonte não pode ser depois de hoje.');
    if (!this.registrosConselho(p.login).some((r) => r.registro === p.registro))
      throw recusa(
        'registro-nao-vinculado',
        'Este registro de conselho não está ligado a um papel ativo do usuário.',
      );
    const ant =
      this.conferenciasConselho.find((x) => x.login === p.login && x.registro === p.registro) ?? null;
    if (ant && ant.conferidoEm > p.conferidoEm)
      throw recusa(
        'conferencia-anterior',
        `Já há conferência mais recente deste registro (${ant.conferidoEm}): registre a consulta mais nova.`,
      );
    const id = String(this.conferenciasConselho.length + 1);
    this.conferenciasConselho.unshift({
      id,
      login: p.login,
      registro: p.registro,
      situacao: p.situacao,
      conferidoEm: p.conferidoEm,
      fonte: p.fonte,
      observacao,
      criadoPor: p.por,
      criadoEm: new Date(),
    });
    return {
      id,
      anterior: ant ? `${ant.situacao} em ${ant.conferidoEm} (${ant.fonte})` : null,
      atual: `${p.situacao} em ${p.conferidoEm} (${p.fonte})`,
    };
  }

  /** W1-01 (parte 9b): linha nova da exceção, com as mesmas recusas de registrarExcecaoDormencia (legado). */
  registrarExcecaoDormencia(
    p: NovaExcecaoDormencia,
    existe: (login: string) => boolean,
  ): { id: string; anterior: string | null; atual: string | null } {
    const motivo = p.motivo.trim();
    if (motivo.length < 10) throw recusa('motivo-curto', 'Justifique a exceção (ao menos 10 caracteres).');
    if (!p.retirar && p.ate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(p.ate))
      throw recusa('prazo-invalido', 'Informe o prazo como data (AAAA-MM-DD) ou deixe sem prazo.');
    if (!existe(p.login)) throw recusa('usuario-inexistente', 'Usuário não encontrado.');
    const ant = this.excecoesDormencia.find((x) => x.login === p.login) ?? null;
    const rotulo = (x: { situacao: string; ate: string | null } | null) =>
      !x || x.situacao === 'retirada' ? null : (x.ate ?? 'sem prazo');
    if (p.retirar && (!ant || ant.situacao === 'retirada'))
      throw recusa('sem-excecao', 'Este usuário não tem exceção para retirar.');
    if (!p.retirar && ant?.situacao === 'vigente' && ant.ate === p.ate)
      throw recusa('sem-mudanca', 'A exceção informada é igual à que já vale para este usuário.');
    const id = String(this.excecoesDormencia.length + 1);
    const ate = p.retirar ? null : p.ate;
    const situacao = p.retirar ? 'retirada' : 'vigente';
    this.excecoesDormencia.unshift({
      id,
      login: p.login,
      ate,
      situacao,
      motivo,
      criadoPor: p.por,
      criadoEm: new Date(),
    });
    return { id, anterior: rotulo(ant), atual: rotulo({ situacao, ate }) };
  }

  /** W1-01 (parte 4c): versão nova da descrição; a vigente fica substituída; texto igual é recusado. */
  descreverGrupo(d: { grupo: string; descricao: string; motivo: string; por: string }): {
    id: string;
    versao: number;
    anterior: number | null;
  } {
    this.exigirGrupo(d.grupo, null);
    const doGrupo = this.descricoesGrupo.filter((x) => x.grupo === d.grupo);
    const viva = doGrupo.find((x) => x.situacao === 'vigente');
    if (viva?.descricao === d.descricao)
      throw recusa('sem-mudanca', 'A descrição informada é igual à vigente.');
    if (viva) {
      viva.situacao = 'substituida';
      viva.encerradaEm = new Date();
      viva.encerradaPor = d.por;
    }
    const versao = Math.max(0, ...doGrupo.map((x) => x.versao)) + 1;
    const id = this.novoId();
    this.descricoesGrupo.push({
      id,
      grupo: d.grupo,
      versao,
      descricao: d.descricao,
      motivo: d.motivo,
      criadoPor: d.por,
      criadoEm: new Date(),
      situacao: 'vigente',
      encerradaEm: null,
      encerradaPor: null,
    });
    return { id, versao, anterior: viva?.versao ?? null };
  }

  concederPerfil(c: Omit<ConcessaoSintetica, 'id' | 'revogadoEm' | 'revogadoPor'>): { id: string } {
    // O CHECK do banco: ninguém concede a si mesmo.
    if (c.concedidoPor === c.login) throw new Error('CHECK SGH_CK_ACESSO_PERFIL_A_SI');
    const id = this.novoId();
    this.concessoes.push({ ...c, id, revogadoEm: null, revogadoPor: null });
    return { id };
  }

  revogarPerfil(id: string, por: string, motivo?: string): { login: string; perfil: string } | null {
    const x = this.concessoes.find((c) => c.id === id && !c.revogadoEm);
    if (!x) return null;
    x.revogadoEm = new Date();
    x.revogadoPor = por;
    x.revogadoMotivo = motivo?.trim() || null;
    return { login: x.login, perfil: x.perfil };
  }

  /** W0-09: a mesma regra de alterarConcessaoPerfil (anterior na alteração; ninguém altera o próprio). */
  alterarPerfil(a: {
    id: string;
    inicio: Date;
    fim: Date | null;
    motivo: string;
    justificativa: string;
    por: string;
  }):
    | { situacao: 'ok'; login: string; perfil: string; alteracao: string }
    | { situacao: 'inexistente' }
    | { situacao: 'a-si-mesmo' } {
    const x = this.concessoes.find((c) => c.id === a.id && !c.revogadoEm);
    if (!x) return { situacao: 'inexistente' };
    if (x.login === a.por) return { situacao: 'a-si-mesmo' };
    const alteracao = this.novoId();
    this.alteracoesPerfil.unshift({
      id: alteracao,
      idConcessao: a.id,
      inicioAntes: x.inicio,
      fimAntes: x.fim,
      motivoAntes: x.motivo,
      inicio: a.inicio,
      fim: a.fim,
      motivo: a.motivo,
      justificativa: a.justificativa,
      alteradoPor: a.por,
      alteradoEm: new Date(),
    });
    x.inicio = a.inicio;
    x.fim = a.fim;
    x.motivo = a.motivo;
    return { situacao: 'ok', login: x.login, perfil: x.perfil, alteracao };
  }

  decidirMapa(
    d: Omit<LinhaMapaSintetica, 'id' | 'aprovadoPor' | 'aprovadoEm'> & {
      por: string;
      motivo?: string | null;
      usuariosAfetados?: number | null;
    },
  ): { id: string } {
    const decidida = d.situacao !== 'proposta';
    const x = this.mapa.find(
      (m) => m.tipo === d.tipo && m.grupo === d.grupo && m.perfil === d.perfil && m.permissao === d.permissao,
    );
    const anotar = (
      idMapa: string,
      antes: LinhaMapaSintetica['situacao'] | null,
      aprovadoPorAntes: string | null,
    ) =>
      this.decisoesMapa.push({
        id: this.novoId(),
        idMapa,
        situacaoAntes: antes,
        aprovadoPorAntes,
        situacao: d.situacao,
        motivo: d.motivo?.trim() || null,
        usuariosAfetados: d.usuariosAfetados ?? null,
        decididoPor: d.por,
        decididoEm: new Date(),
      });
    if (x) {
      if (mapaMudaDecisao(x.situacao, d.situacao) && (d.motivo?.trim().length ?? 0) < 5)
        throw new ErroMotivoMapa();
      anotar(x.id, x.situacao, x.aprovadoPor);
      x.situacao = d.situacao;
      x.aprovadoPor = decidida ? d.por : null;
      x.aprovadoEm = decidida ? new Date() : null;
      return { id: x.id };
    }
    const id = this.novoId();
    this.mapa.push({
      id,
      tipo: d.tipo,
      grupo: d.grupo,
      perfil: d.perfil,
      permissao: d.permissao,
      origem: d.origem,
      situacao: d.situacao,
      aprovadoPor: decidida ? d.por : null,
      aprovadoEm: decidida ? new Date() : null,
    });
    anotar(id, null, null);
    return { id };
  }
}
