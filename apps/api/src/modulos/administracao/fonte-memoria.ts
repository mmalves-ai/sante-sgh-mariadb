// Fonte das telas do M10 EM MEMÓRIA (dev/ci com a sessão sintética; E2E): os usuários sintéticos (as contas da
// fonte sintética e os criados pela tela), os escopos, o termo, a estrutura e os leitos sintéticos, os pedidos do
// titular e as revisões de quebra de vidro, com as MESMAS regras e recusas das receitas (login exato e livre, CPF
// não repetido, ninguém a si mesmo, versão, leito ocupado, acomodação no espelho…). O grupo, as opções e o
// bloqueio vivem no estado sintético do acesso (o que a sessão sintética lê): bloquear aqui impede o login e
// derruba as sessões. A trilha vai ao registrador da API. Nada vai à cópia; nenhum dado real.
import { flagAceita } from '@sgh/contratos';
import { z } from 'zod';
import { ErroOperacao } from '@sgh/nucleo';
import { CATALOGO_COMPLETO } from '../../autorizacao/catalogo.js';
import type { RegistradorTrilha, RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import {
  aceitouTermoSintetico,
  CONFIG_SINTETICA,
  CONTAS_SINTETICAS,
  estadoAcessoSintetico,
} from '../acesso/fonte-sintetica.js';
import { NOMES_PAPEL } from '../acesso/gestao-fonte.js';
import type { FonteAdministracao } from './fonte.js';
import {
  type AcaoMenu,
  type ContextoGestao,
  type Ctx,
  type FichaUsuario,
  type FiltroTrilha,
  type ItemEscopo,
  type LinhaTrilhaLida,
  type ModuloSistema,
  OPERACOES_GESTAO,
  type PedidoTitularLido,
  type PoliticaLogin,
  type QuebraVidro,
  type TrilhaGestao,
} from './tipos.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const NOME_SINTETICO = 'Usuário sintético (desenvolvimento)';
const hojeIso = () => new Date().toISOString().slice(0, 10);

interface UsuarioMem {
  readonly login: string;
  readonly id: number;
  nome: string;
  ativo: boolean;
  cpf: string | null;
  senhaDefinida: boolean;
}

interface AcomodacaoMem {
  readonly bloco: string;
  readonly acomodacao: string;
  nome: string;
  andar: number | null;
  leitos: number;
  sexo: string;
  tipo: number;
  convenio: string;
  centroCusto: number | null;
  localConta: number | null;
}

interface LeitoMem {
  readonly id: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  status: 'A' | 'I';
  reg: number;
  ramal: number | null;
  andar: number | null;
}

interface PedidoMem extends Omit<
  PedidoTitularLido,
  'situacao' | 'identidadeVerificada' | 'fundamento' | 'decididoPor' | 'decididoEm' | 'versao'
> {
  situacao: string;
  identidadeVerificada: boolean;
  fundamento: string | null;
  decididoPor: string | null;
  decididoEm: Date | null;
  versao: number;
  readonly hospital: string;
}

/**
 * Revisão do W0-10 (M3): os pedidos do titular abertos pelo portal do paciente em memória, vistos e tratados pela área
 * de privacidade, como a SGH_AUD_PEDIDO_TITULAR única na cópia (sem a ponte, o pedido de portabilidade do portal nunca
 * chegava a 'atendido' na sessão sintética e o download do pacote IPS ficava sem caminho de ponta a ponta).
 */
export interface PedidoPortalParaPrivacidade {
  readonly id: string;
  readonly protocolo: string;
  readonly tipo: string;
  readonly situacao: string;
  readonly abertoEm: string;
  readonly prazo: string;
  readonly decididoEm: string | null;
  readonly fundamento: string | null;
  readonly motivoCancelamento: string | null;
  readonly paciente: number;
  readonly prontuario: number | null;
}
export interface PontePedidosPortalMemoria {
  listar(hospital: string): PedidoPortalParaPrivacidade[];
  decidir(
    hospital: string,
    id: string,
    situacao: 'identidade-verificada' | 'atendido' | 'negado',
    fundamento: string | null,
  ): void;
}
/** O id do pedido do portal na lista da privacidade (fora da faixa dos pedidos do balcão em memória). */
export const BASE_ID_PEDIDO_PORTAL = 900_000_000;

/** Estado das telas do M10 em memória (um por processo). */
export class EstadoM10Sintetico {
  /** Revisão do W0-10: a ponte aos pedidos do portal do paciente em memória (ligada pela aplicação). */
  pedidosDoPortal: PontePedidosPortalMemoria | null = null;
  readonly usuarios = new Map<string, UsuarioMem>();
  readonly escopos = new Map<string, Record<string, Set<string>>>();
  readonly setores = new Map<string, Set<string>>();
  readonly blocos = new Map<string, { nome: string; andares: number | null }>();
  readonly acomodacoes = new Map<string, AcomodacaoMem>();
  readonly leitos = new Map<number, LeitoMem>();
  /** Espelho sintético (o que os gatilhos manteriam), com divergências de demonstração para a conferência. */
  readonly espelhoExtra: { bloco: string; acomodacao: string; leito: string; ativo: boolean }[] = [];
  readonly pedidos: PedidoMem[] = [];
  readonly revisoes = new Map<string, { classificacao: string; por: string; em: Date }>();
  readonly termo = {
    id: 1,
    texto:
      'TERMO DE USO DO PRONTUÁRIO ELETRÔNICO (texto sintético de desenvolvimento). Declaro que usarei o prontuário só para a assistência e as finalidades autorizadas, guardarei sigilo das informações e não compartilharei a minha senha.',
    desde: '2020-12-16',
    publicadoPor: 'ADMIN',
  };
  /** W1-01 (parte 6b): versões anteriores do termo, com os aceites congelados (imutáveis), a mais nova primeiro. */
  readonly termosAnteriores: {
    id: number;
    texto: string;
    desde: string;
    publicadoPor: string;
    aceites: { login: string; em: string }[];
  }[] = [];
  private seq = 1000;

  constructor() {
    let i = 0;
    for (const login of Object.keys(CONTAS_SINTETICAS))
      this.usuarios.set(login, {
        login,
        id: 900000 + i++,
        nome: NOME_SINTETICO,
        ativo: CONTAS_SINTETICAS[login]?.ativo ?? true,
        cpf: null,
        senhaDefinida: CONTAS_SINTETICAS[login]?.senha !== null,
      });
    this.blocos.set('INT-1', { nome: 'Internação 1º andar (sintético)', andares: 1 });
    this.blocos.set('UTI-1', { nome: 'UTI adulto (sintético)', andares: 1 });
    const ac = (bloco: string, acomodacao: string, nome: string, leitos: number) =>
      this.acomodacoes.set(`${bloco}|${acomodacao}`, {
        bloco,
        acomodacao,
        nome,
        andar: 1,
        leitos,
        sexo: 'A',
        tipo: 1,
        convenio: 'A',
        centroCusto: 300100,
        localConta: 11,
      });
    ac('INT-1', '101', 'Apartamento 101', 2);
    ac('INT-1', '102', 'Enfermaria 102', 3);
    ac('UTI-1', 'UTI-A', 'UTI adulto A', 3);
    const le = (bloco: string, acomodacao: string, leito: string, status: 'A' | 'I' = 'A', reg = 0) => {
      const id = ++this.seq;
      this.leitos.set(id, { id, bloco, acomodacao, leito, status, reg, ramal: 0, andar: 1 });
    };
    le('INT-1', '101', 'A', 'A', 7001);
    le('INT-1', '101', 'B');
    le('INT-1', '102', 'A');
    le('INT-1', '102', 'B', 'I');
    le('UTI-1', 'UTI-A', '01', 'A', 7002);
    le('UTI-1', 'UTI-A', '02');
    // Divergência de demonstração: um registro de conferência sem leito no cadastro.
    this.espelhoExtra.push({ bloco: 'UTI-1', acomodacao: 'UTI-A', leito: '03', ativo: true });
  }

  novoId(): number {
    return ++this.seq;
  }

  escoposDe(login: string): Record<string, Set<string>> {
    let e = this.escopos.get(login);
    if (!e) {
      e = {
        unidade: new Set(['1']),
        local: new Set(),
        convenio: new Set(),
        convenioFaturamento: new Set(),
        tipoAgenda: new Set(),
        tipoProntuario: new Set(),
      };
      this.escopos.set(login, e);
    }
    return e;
  }
}

let estado: EstadoM10Sintetico | null = null;
export function estadoM10Sintetico(): EstadoM10Sintetico {
  return (estado ??= new EstadoM10Sintetico());
}
/** Testes: volta ao estado semeado. */
export function reiniciarEstadoM10Sintetico(): void {
  estado = null;
}

const OPCOES_ESCOPO: Record<string, ItemEscopo[]> = {
  unidade: [
    { valor: '1', rotulo: 'Unidade sintética 1' },
    { valor: '2', rotulo: 'Unidade sintética 2' },
  ],
  local: [
    { valor: '10', rotulo: 'Consultório sintético A' },
    { valor: '11', rotulo: 'Consultório sintético B' },
  ],
  convenio: [
    { valor: '305', rotulo: 'Operadora Alfa (sintética)' },
    { valor: '306', rotulo: 'Operadora Beta (sintética)' },
  ],
  convenioFaturamento: [
    { valor: '305', rotulo: 'Operadora Alfa (sintética)' },
    { valor: '306', rotulo: 'Operadora Beta (sintética)' },
  ],
  tipoAgenda: [
    { valor: '1', rotulo: '1' },
    { valor: '2', rotulo: '2' },
  ],
  tipoProntuario: [
    { valor: 'A', rotulo: 'A' },
    { valor: 'E', rotulo: 'E' },
  ],
};

const versaoUsuario = (u: UsuarioMem, grupo: string | null, bloqueado: boolean) =>
  JSON.stringify([u.nome, grupo ?? '', u.ativo ? 'T' : 'F', bloqueado ? 'T' : 'F']);
const versaoLeito = (l: LeitoMem) =>
  JSON.stringify([l.status, String(l.ramal ?? ''), String(l.andar ?? ''), String(l.reg)]);
/** A versão da linha sintética como número (resumo estável das colunas da trava). */
const versaoNumerica = (texto: string): number => {
  let h = 0;
  for (const ch of texto) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};
const versaoAcomodacao = (a: AcomodacaoMem) =>
  JSON.stringify([a.nome, String(a.andar ?? ''), String(a.leitos), a.sexo, String(a.tipo), a.convenio]);

/**
 * W1-01 (parte 3b): letras das permissões complementares de cada login na memória (as três sintéticas da ficha),
 * presas ao estado sintético do M10 (somem quando ele é refeito).
 */
const FLAGS_INICIAIS: Readonly<Record<string, string>> = { EXCPAC: 'F', EXCATE: 'F', ALTAPAC: 'T' };
const flagsMem = new WeakMap<object, Map<string, Record<string, string>>>();
function flagsDe(m: object, login: string): Record<string, string> {
  let porLogin = flagsMem.get(m);
  if (!porLogin) flagsMem.set(m, (porLogin = new Map()));
  let f = porLogin.get(login);
  if (!f) porLogin.set(login, (f = { ...FLAGS_INICIAIS }));
  return f;
}

/** Aceites sintéticos da versão vigente: os implícitos das contas (até a 1ª republicação) e os dados pela tela. */
function aceitesSinteticos(desde: string): { login: string; em: string }[] {
  const acesso = estadoAcessoSintetico();
  const implicitos = acesso.termoRepublicado
    ? []
    : Object.entries(CONTAS_SINTETICAS)
        .filter(([, c]) => c.termoAceito !== false)
        .map(([login]) => ({ login, em: desde }));
  return [...implicitos, ...[...acesso.aceitesTermo].map((login) => ({ login, em: hojeIso() }))];
}

/** As regras das receitas do M10 sobre o estado sintético. */
function aplicarM10(nome: string, e: Record<string, unknown>, operador: string): Record<string, unknown> {
  const m = estadoM10Sintetico();
  const acesso = estadoAcessoSintetico();
  const usuario = (login: unknown) => {
    const u = m.usuarios.get(String(login));
    if (!u) throw recusa('usuario-inexistente', 'Usuário inexistente.');
    return u;
  };
  const aSiMesmo = (login: unknown, msg: string) => {
    if (String(login) === operador) throw recusa('a-si-mesmo', msg);
  };
  const escopo =
    /^acesso\.(conceder|retirar)(Unidade|Local|Convenio|ConvenioFaturamento|TipoAgenda|TipoProntuario)Usuario$/.exec(
      nome,
    );
  if (escopo) {
    const [, acao, tipo = ''] = escopo;
    aSiMesmo(e['login'], 'Ninguém altera o próprio escopo (segregação de funções).');
    const u = usuario(e['login']);
    const chave = `${tipo.charAt(0).toLowerCase()}${tipo.slice(1)}`;
    const set = m.escoposDe(u.login)[chave] as Set<string>;
    const v = String(e['valor']);
    if (acao === 'conceder') {
      if (!(OPCOES_ESCOPO[chave] ?? []).some((o) => o.valor === v))
        throw recusa('valor-inexistente', 'Escolha um valor existente.');
      if (set.has(v)) throw recusa('ja-concedido', 'O usuário já tem este escopo.');
      set.add(v);
    } else {
      if (!set.has(v)) throw recusa('nao-concedido', 'O usuário não tem este escopo.');
      set.delete(v);
    }
    return { idUsuario: u.id };
  }
  switch (nome) {
    case 'acesso.criarUsuario': {
      const login = String(e['login']);
      if (m.usuarios.has(login)) throw recusa('login-existente', 'Já existe usuário com este login.');
      const cpf = e['cpf'] ? String(e['cpf']) : null;
      if (cpf && [...m.usuarios.values()].some((x) => x.cpf === cpf))
        throw recusa('cpf-em-uso', 'Este CPF já é de outro usuário.');
      const g = String(e['grupo']);
      if (acesso.grupos.get(g) !== true)
        throw recusa(
          acesso.grupos.has(g) ? 'grupo-inativo' : 'grupo-inexistente',
          'Grupo inexistente ou inativo.',
        );
      const id = m.novoId();
      m.usuarios.set(login, {
        login,
        id,
        nome: String(e['nomeCompleto']),
        ativo: true,
        cpf,
        senhaDefinida: false,
      });
      acesso.contas.set(login, { id, grupo: g, papeis: new Map([[4, true]]), flags: [], conselho: false });
      return { idUsuario: id };
    }
    case 'acesso.alterarUsuario': {
      aSiMesmo(e['login'], 'Ninguém altera o próprio cadastro de acesso (segregação de funções).');
      const u = usuario(e['login']);
      const grupo = acesso.contas.get(u.login)?.grupo ?? null;
      if (versaoUsuario(u, grupo, acesso.bloqueio.get(u.login) ?? false) !== e['versao'])
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Operação recusada',
          'O usuário foi alterado por outra pessoa desde a leitura. Releia a ficha.',
        );
      // W1-01: a troca de CPF exige justificativa e nunca usa o CPF de outro login (a mesma regra da receita).
      const cpf = typeof e['cpf'] === 'string' ? e['cpf'] : null;
      if (cpf !== null && cpf !== u.cpf) {
        if (typeof e['justificativa'] !== 'string' || e['justificativa'].trim().length < 10)
          throw recusa('justificativa-obrigatoria', 'A troca do CPF exige justificativa.');
        const outro = [...m.usuarios.values()].find((x) => x.cpf === cpf && x.login !== u.login);
        if (outro) throw recusa('cpf-em-uso', `Este CPF já é do login ${outro.login}: um CPF por pessoa.`);
        u.cpf = cpf;
      }
      u.nome = String(e['nomeCompleto']);
      return { idUsuario: u.id };
    }
    // W1-01 (parte 3b): as mesmas recusas da receita (a si mesmo, letra nunca vista, colisão pela letra lida).
    case 'acesso.alterarFlagsUsuario': {
      aSiMesmo(e['login'], 'Ninguém altera as próprias permissões complementares (segregação de funções).');
      const u = usuario(e['login']);
      const pedidas = (e['flags'] ?? []) as { coluna: string; ligado: boolean; antes: string | null }[];
      const fora = pedidas.filter((f) => !flagAceita(f.coluna, f.ligado));
      if (fora.length)
        throw recusa(
          'flag-sem-letra',
          `Permissão sem a letra medida neste estabelecimento: ${fora.map((f) => f.coluna).join(', ')}.`,
        );
      const atuais = flagsDe(m, u.login);
      if (pedidas.some((f) => (atuais[f.coluna] ?? '') !== (f.antes ?? '')))
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Operação recusada',
          'As permissões foram alteradas por outra pessoa desde a leitura. Releia a ficha.',
        );
      for (const f of pedidas) atuais[f.coluna] = f.ligado ? 'T' : 'F';
      return { idUsuario: u.id, linhas: 1 };
    }
    case 'acesso.bloquearUsuario':
    case 'acesso.desbloquearUsuario': {
      const bloquear = nome === 'acesso.bloquearUsuario';
      aSiMesmo(e['login'], 'Ninguém bloqueia nem desbloqueia a si mesmo.');
      const u = usuario(e['login']);
      const atual = acesso.bloqueio.get(u.login) ?? CONTAS_SINTETICAS[u.login]?.bloqueado ?? false;
      if (atual === bloquear)
        throw recusa(
          bloquear ? 'ja-bloqueado' : 'ja-livre',
          bloquear ? 'O usuário já está bloqueado.' : 'O usuário não está bloqueado.',
        );
      acesso.bloqueio.set(u.login, bloquear);
      return { idUsuario: u.id };
    }
    // W1-01 (parte 6b): as mesmas recusas da receita acesso.publicarTermo; a anterior fica com os aceites dela.
    case 'acesso.publicarTermo': {
      if ((e['termoAnterior'] ?? null) !== m.termo.id)
        throw recusa(
          'termo-desatualizado',
          'Outra versão do termo foi publicada desde que a tela abriu; recarregue.',
        );
      const norm = (t: unknown) =>
        String(t ?? '')
          .replace(/\r\n/g, '\n')
          .trim();
      if (norm(e['texto']) === norm(m.termo.texto))
        throw recusa('texto-igual', 'O texto é igual ao da versão vigente: nada a publicar.');
      m.termosAnteriores.unshift({ ...m.termo, aceites: aceitesSinteticos(m.termo.desde) });
      const anterior = m.termo.id;
      m.termo.id = m.novoId();
      m.termo.texto = norm(e['texto']);
      m.termo.desde = hojeIso();
      m.termo.publicadoPor = operador;
      acesso.aceitesTermo.clear();
      acesso.termoRepublicado = true;
      return { id: m.termo.id, anterior };
    }
    case 'acesso.aceitarTermo': {
      if (Number(e['termo']) !== m.termo.id)
        throw recusa('termo-desatualizado', 'O termo mudou desde que a tela abriu.');
      if (acesso.aceitesTermo.has(operador))
        throw recusa('ja-aceito', 'Você já aceitou esta versão do termo.');
      acesso.aceitesTermo.add(operador);
      return { id: m.novoId(), termo: m.termo.id };
    }
    case 'organizacao.incluirAcomodacao': {
      const k = `${String(e['bloco'])}|${String(e['acomodacao'])}`;
      if (!m.blocos.has(String(e['bloco']))) throw recusa('bloco-inexistente', 'Bloco inexistente.');
      if (m.acomodacoes.has(k)) throw recusa('acomodacao-existente', 'Já existe esta acomodação no bloco.');
      // Os códigos conferidos no cadastro de origem, como a receita do banco (os sintéticos da memória).
      if (Number(e['centroCusto']) !== 300100)
        throw recusa('centro-custo-inexistente', 'Centro de custo inexistente ou inativo.');
      if (Number(e['localConta']) !== 11)
        throw recusa('local-conta-inexistente', 'Local de conta inexistente ou inativo.');
      if (Number(e['acomodacaoTiss']) !== 3)
        throw recusa('acomodacao-tiss-inexistente', 'Tipo de acomodação TISS inexistente.');
      m.acomodacoes.set(k, {
        bloco: String(e['bloco']),
        acomodacao: String(e['acomodacao']),
        nome: String(e['nome']),
        andar: Number(e['andar']),
        leitos: Number(e['leitos']),
        sexo: String(e['sexo']),
        tipo: Number(e['tipo']),
        convenio: String(e['convenio']),
        centroCusto: Number(e['centroCusto']),
        localConta: Number(e['localConta']),
      });
      return { id: m.novoId() };
    }
    case 'organizacao.alterarAcomodacao': {
      const a = m.acomodacoes.get(`${String(e['bloco'])}|${String(e['acomodacao'])}`);
      if (!a) throw recusa('acomodacao-inexistente', 'Acomodação inexistente.');
      if (String(versaoNumerica(versaoAcomodacao(a))) !== String(e['versao']))
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Operação recusada',
          'A acomodação foi alterada por outra pessoa desde a leitura. Releia.',
        );
      if (e['nome'] !== undefined) a.nome = String(e['nome']);
      if (e['andar'] !== undefined) a.andar = Number(e['andar']);
      if (e['leitos'] !== undefined) a.leitos = Number(e['leitos']);
      return { id: 0 };
    }
    case 'organizacao.incluirLeito': {
      const k = `${String(e['bloco'])}|${String(e['acomodacao'])}`;
      if (!m.acomodacoes.has(k)) throw recusa('acomodacao-inexistente', 'Acomodação inexistente no bloco.');
      const ja = [...m.leitos.values()].some(
        (l) => `${l.bloco}|${l.acomodacao}` === k && l.leito === e['leito'],
      );
      if (ja) throw recusa('leito-existente', 'Já existe este leito na acomodação.');
      if (m.espelhoExtra.some((x) => `${x.bloco}|${x.acomodacao}` === k && x.leito === e['leito']))
        throw recusa(
          'leito-no-espelho',
          'Já existe registro de conferência para este leito: confira a conferência de leitos antes de incluir.',
        );
      const id = m.novoId();
      m.leitos.set(id, {
        id,
        bloco: String(e['bloco']),
        acomodacao: String(e['acomodacao']),
        leito: String(e['leito']),
        status: 'A',
        reg: 0,
        ramal: e['ramal'] === undefined ? 0 : Number(e['ramal']),
        andar: Number(e['andar']),
      });
      return { id };
    }
    case 'organizacao.alterarLeito':
    case 'organizacao.inativarLeito':
    case 'organizacao.reativarLeito': {
      const l = m.leitos.get(Number(e['id']));
      if (!l) throw recusa('leito-inexistente', 'Leito inexistente.');
      if (String(versaoNumerica(versaoLeito(l))) !== String(e['versao']))
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Operação recusada',
          'O leito foi alterado por outra pessoa desde a leitura. Releia.',
        );
      if (nome === 'organizacao.alterarLeito') {
        if (e['ramal'] !== undefined) l.ramal = e['ramal'] === null ? 0 : Number(e['ramal']);
        if (e['andar'] !== undefined) l.andar = Number(e['andar']);
      } else if (nome === 'organizacao.inativarLeito') {
        if (l.status === 'I') throw recusa('ja-inativo', 'O leito já está inativo.');
        if (l.reg > 0)
          throw recusa(
            'leito-ocupado',
            'Leito ocupado não é inativado: dê alta ou transfira o paciente antes.',
          );
        l.status = 'I';
      } else {
        if (l.status === 'A') throw recusa('ja-ativo', 'O leito já está ativo.');
        l.status = 'A';
      }
      return { id: l.id };
    }
    default:
      // ADR 0022: grupos, opções e papéis do legado no estado sintético do acesso.
      acesso.aplicar(nome, e, operador);
      return {};
  }
}

/**
 * Árvore sintética de opções (dev/ci): do catálogo de permissões, cada código `modulo.recurso.acao` com opção do
 * legado vira módulo (nível 0) → recurso (nível 1) → opção (nível 2, o ID real da opção). Com o banco, a árvore é
 * a de TBOPCOES (fonte do legado).
 */
function arvoreSintetica(): { opcoes: AcaoMenu[]; modulos: ModuloSistema[] } {
  const porModulo = new Map<string, Map<string, { id: number; titulo: string }[]>>();
  const vistas = new Set<number>();
  for (const p of CATALOGO_COMPLETO) {
    const [mod = '', rec = '', acao = ''] = p.codigo.split('.');
    for (const id of p.opcoesLegado) {
      if (vistas.has(id)) continue;
      vistas.add(id);
      const r = porModulo.get(mod) ?? new Map<string, { id: number; titulo: string }[]>();
      r.set(rec, [...(r.get(rec) ?? []), { id, titulo: `${acao} (opção ${id})` }]);
      porModulo.set(mod, r);
    }
  }
  const opcoes: AcaoMenu[] = [];
  const modulos: ModuloSistema[] = [];
  let idModulo = 0;
  let idSintetico = -1;
  for (const [mod, recursos] of [...porModulo].sort((a, b) => a[0].localeCompare(b[0]))) {
    idModulo++;
    modulos.push({ id: idModulo, sistema: 'SGH', executavel: null, nome: mod });
    let indice = 0;
    const no = (id: number, nivel: number, titulo: string) =>
      opcoes.push({
        id,
        modulo: idModulo,
        indice: indice++,
        nivel,
        ativo: true,
        avulsa: false,
        nome: titulo,
        titulo,
      });
    no(idSintetico--, 0, mod);
    for (const [rec, itens] of [...recursos].sort((a, b) => a[0].localeCompare(b[0]))) {
      no(idSintetico--, 1, rec);
      for (const i of itens) no(i.id, 2, i.titulo);
    }
  }
  return { opcoes, modulos };
}
let arvoreMemoria: ReturnType<typeof arvoreSintetica> | null = null;

/** O paciente sintético da memória (dev/E2E): ID interno e prontuário fictícios. */
export const PACIENTE_SINTETICO = { id: 999_000_001, prontuario: 900_001 } as const;

/** O pedido do portal em memória no formato da lista da privacidade (canal portal; id deslocado). */
function pedidoDoPortal(p: PedidoPortalParaPrivacidade): PedidoTitularLido {
  return {
    id: String(BASE_ID_PEDIDO_PORTAL + Number(p.id)),
    protocolo: p.protocolo,
    tipo: p.tipo,
    canal: 'portal',
    situacao: p.situacao,
    idPaciente: p.paciente,
    prontuario: p.prontuario,
    abertoEm: new Date(p.abertoEm),
    prazo: new Date(p.prazo),
    identidadeVerificada: p.situacao !== 'aberto' && p.situacao !== 'cancelado',
    fundamento: p.fundamento,
    decididoPor: null,
    decididoEm: p.decididoEm ? new Date(p.decididoEm) : null,
    registradoPor: 'SGH.PORTAL',
    versao: 1,
    motivoCancelamento: p.motivoCancelamento,
  };
}

export function fonteAdministracaoMemoria(
  trilha: RegistradorTrilha,
  /** Reservado (as chamadas antigas passam o catálogo de operações e o ambiente; a memória não os usa mais). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _reservado: unknown = null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ambiente = 'dev',
  quebrasMemoria: () => readonly {
    id: string;
    hospital: string;
    login: string;
    idPaciente: number;
    fim: Date;
    inicio?: Date;
    motivo?: string;
  }[] = () => [],
  /**
   * X-01: o profissional ligado ao login, lido da MESMA memória do cadastro de profissionais (a aba "Login do
   * sistema" grava ali), para a ficha do usuário e a do profissional nunca se desmentirem. Sem cadastro: nenhum.
   */
  profissionalDoLogin: (c: Ctx, login: string) => { id: number; nome: string } | null = () => null,
): FonteAdministracao {
  const m = () => estadoM10Sintetico();
  const acesso = () => estadoAcessoSintetico();
  const registrar = async (t: TrilhaGestao, tabela: string, id: string) => {
    await trilha.registrar({
      evento: t.evento,
      rede: t.rede,
      hospital: t.hospital,
      usuario: t.usuario,
      estacao: t.estacao ?? '',
      correlacao: t.correlacao,
      recurso: t.recurso,
      resultado: 'sucesso',
      tabelaAlvo: tabela,
      idAlvo: id,
    });
  };
  const ficha = (c: Ctx, login: string, auditor: boolean, comCpf: boolean): FichaUsuario | null => {
    const u = m().usuarios.get(login);
    if (!u) return null;
    const conta = acesso().contas.get(login);
    const grupo = conta?.grupo ?? null;
    const bloqueado = acesso().bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false;
    const esc = m().escoposDe(login);
    const rotulo = (tipo: string, v: string) => OPCOES_ESCOPO[tipo]?.find((o) => o.valor === v)?.rotulo ?? v;
    return {
      login,
      id: u.id,
      nome: u.nome,
      grupo,
      ativo: u.ativo,
      bloqueado,
      cpfInformado: u.cpf !== null,
      cpf: comCpf ? u.cpf : null,
      senhaDefinida: u.senhaDefinida,
      versao: [u.nome, grupo ?? '', u.ativo ? 'T' : 'F', bloqueado ? 'T' : 'F'],
      grupoAtivo: grupo ? (acesso().grupos.get(grupo) ?? null) : null,
      papeis: [...(conta?.papeis ?? new Map<number, boolean>())].map(([papel, ativo]) => ({
        papel,
        nome: NOMES_PAPEL[papel] ?? `Papel ${papel}`,
        ativo,
      })),
      escopos: Object.fromEntries(
        Object.entries(esc).map(([tipo, set]) => [
          tipo,
          [...set].sort().map((v) => ({ valor: v, rotulo: rotulo(tipo, v) })),
        ]),
      ),
      escoposConsulta: { centrosCusto: 0, locaisEstoque: 0, contasBancarias: 0 },
      flags: Object.entries(flagsDe(m(), login)).map(([coluna, letra]) => ({ coluna, letra })),
      conexoes: [{ modulo: 23, nome: 'P.E.P.', ultima: hojeIso() }],
      termo: {
        aceitouVigente: aceitouTermoSintetico(login),
        aceitoEm: '2026-01-02',
      },
      historicoSenha: auditor ? { trocas: 2, ultima: '2026-09-01' } : null,
      profissionalVinculado: profissionalDoLogin(c, login),
    };
  };
  const trilhaMem = (c: Ctx, f: FiltroTrilha): LinhaTrilhaLida[] => {
    const eventos = (trilha as Partial<RegistradorTrilhaMemoria>).eventos ?? [];
    return eventos
      .filter((x) => x.hospital === c.hospital)
      .filter((x) => !f.usuario || x.usuario === f.usuario)
      .filter((x) => !f.evento || x.evento === f.evento)
      .filter((x) => f.paciente === undefined || x.paciente === f.paciente)
      .slice(-f.limite)
      .reverse()
      .map((x) => ({
        id: `N${x.id}`,
        dataHora: ((x as { em?: string }).em ?? new Date().toISOString()).slice(0, 19),
        usuario: x.usuario,
        acao: x.evento,
        opcao: x.recurso ?? null,
        criticidade: null,
        estacao: x.estacao || null,
        alvo: x.tabelaAlvo ? `${x.tabelaAlvo}:${x.idAlvo ?? ''}` : null,
        paciente: x.paciente ?? null,
        resultado: x.resultado,
        atorReal: x.como ? `SUPORTE:${x.como.atorTipo}` : null,
      }));
  };
  return {
    destino: 'memoria',
    listarUsuarios(_c, f) {
      const t = (f.busca ?? '').trim().toUpperCase();
      const todos = [...m().usuarios.values()]
        .map((u) => ({
          login: u.login,
          nome: u.nome,
          grupo: acesso().contas.get(u.login)?.grupo ?? null,
          ativo: u.ativo,
          bloqueado: acesso().bloqueio.get(u.login) ?? CONTAS_SINTETICAS[u.login]?.bloqueado ?? false,
          ultimoAcesso: CONTAS_SINTETICAS[u.login] ? hojeIso() : null,
        }))
        .filter(
          (u) =>
            t.length < 2 || u.login.toUpperCase().includes(t) || (u.nome ?? '').toUpperCase().includes(t),
        )
        .filter((u) => !f.grupo || u.grupo === f.grupo)
        .filter((u) =>
          f.situacao === 'ativos'
            ? u.ativo && !u.bloqueado
            : f.situacao === 'inativos'
              ? !u.ativo
              : f.situacao === 'bloqueados'
                ? u.bloqueado
                : true,
        )
        .sort((a, b) => a.login.localeCompare(b.login));
      const ini = (f.pagina - 1) * f.porPagina;
      return Promise.resolve({ itens: todos.slice(ini, ini + f.porPagina), total: todos.length });
    },
    painelCpf() {
      const contas = [...m().usuarios.values()].map((u) => ({
        conta: {
          login: u.login,
          nome: u.nome,
          grupo: acesso().contas.get(u.login)?.grupo ?? null,
          ativo: u.ativo,
          bloqueado: acesso().bloqueio.get(u.login) ?? CONTAS_SINTETICAS[u.login]?.bloqueado ?? false,
        },
        cpf: u.cpf,
      }));
      const vezes = new Map<string, number>();
      for (const x of contas) if (x.cpf) vezes.set(x.cpf, (vezes.get(x.cpf) ?? 0) + 1);
      return Promise.resolve({
        semCpf: contas.filter((x) => !x.cpf && x.conta.ativo).map((x) => x.conta),
        duplicadas: contas.flatMap((x) =>
          x.cpf && (vezes.get(x.cpf) ?? 0) > 1
            ? [{ ...x.conta, chave: `m${[...vezes.keys()].indexOf(x.cpf)}` }]
            : [],
        ),
      });
    },
    // W1-01 (parte 11c): a memória é um banco só (o estabelecimento da sessão); a rede de vários bancos é a do núcleo.
    redeDoAcesso: (c) => ({ rede: c.rede, estabelecimentos: [{ codigo: c.hospital, nome: c.hospital }] }),
    contasDoCpf(_c, cpf) {
      const d = cpf.replace(/\D/g, '');
      return Promise.resolve(
        [...m().usuarios.values()]
          .filter((u) => u.cpf !== null && u.cpf.replace(/\D/g, '') === d)
          .sort((a, b) => a.login.localeCompare(b.login))
          .map((u) => ({
            login: u.login,
            nome: u.nome,
            grupo: acesso().contas.get(u.login)?.grupo ?? null,
            ativo: u.ativo,
            bloqueado: acesso().bloqueio.get(u.login) ?? CONTAS_SINTETICAS[u.login]?.bloqueado ?? false,
            perfis: [
              ...new Set(
                acesso()
                  .perfisConcedidos(u.login)
                  .map((p) => p.perfil),
              ),
            ].sort(),
          })),
      );
    },
    fichaUsuario: (c, login, auditor, opcoes) =>
      Promise.resolve(ficha(c, login, auditor, opcoes?.cpf === true)),
    opcoesEscopo: () => Promise.resolve(OPCOES_ESCOPO),
    setores: (_c, login) =>
      Promise.resolve(
        [...(m().setores.get(login) ?? new Set<string>())].map((b) => ({
          valor: b,
          rotulo: m().blocos.get(b)?.nome ?? b,
        })),
      ),
    grupos: () =>
      Promise.resolve(
        [...acesso().grupos].map(([nome, ativo]) => ({
          nome,
          ativo,
          usuariosAtivos: [...acesso().contas.values()].filter((c) => c.grupo === nome).length,
        })),
      ),
    async executar(nome, entrada, ctx: ContextoGestao) {
      const escopo =
        /^acesso\.(conceder|retirar)(Unidade|Local|Convenio|ConvenioFaturamento|TipoAgenda|TipoProntuario)Usuario$/.test(nome);
      const op =
        OPERACOES_GESTAO[nome] ??
        (escopo ? { evento: 'acesso.usuario.alterado', recurso: 'acesso.usuario', entrada: z.record(z.string(), z.unknown()) } : null);
      if (!op) throw new ErroOperacao(404, 'operacao-inexistente', 'Operação inexistente', 'Operação desconhecida.');
      const p = op.entrada.safeParse(entrada);
      if (!p.success)
        throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos.');
      const r = aplicarM10(nome, p.data as Record<string, unknown>, ctx.login);
      await trilha.registrar({
        evento: op.evento,
        rede: ctx.rede,
        hospital: ctx.hospital,
        usuario: ctx.login,
        estacao: ctx.estacao ?? '',
        correlacao: ctx.correlacao,
        recurso: op.recurso,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: nome,
      });
      return r;
    },
    receita: () => ({ estado: 'ligada' as const, ligada: true, motivo: null }),
    async setor(_c, p, acao, t) {
      if (p.por === p.login)
        throw recusa('a-si-mesmo', 'Ninguém altera o próprio escopo (segregação de funções).');
      if (!m().blocos.has(p.bloco)) throw recusa('bloco-inexistente', 'Setor (bloco) inexistente.');
      const set = m().setores.get(p.login) ?? new Set<string>();
      if (acao === 'conceder') {
        if (set.has(p.bloco)) throw recusa('ja-concedido', 'O usuário já tem este setor.');
        set.add(p.bloco);
      } else {
        if (!set.has(p.bloco)) throw recusa('nao-concedido', 'O usuário não tem este setor.');
        set.delete(p.bloco);
      }
      m().setores.set(p.login, set);
      await registrar(t, 'MEMORIA', `SETOR:${p.bloco}`);
    },
    arvore: () => Promise.resolve((arvoreMemoria ??= arvoreSintetica())),
    opcoesDoGrupo: (_c, grupo) =>
      Promise.resolve([...(acesso().opcoesGrupo.get(grupo) ?? [])].sort((a, b) => a - b)),
    opcoesDoPapel: (_c, papel) =>
      Promise.resolve([...(acesso().opcoesPapel.get(papel) ?? [])].sort((a, b) => a - b)),
    papeis: () =>
      Promise.resolve(
        [...acesso().opcoesPapel].map(([papel, ops]) => ({
          papel,
          nome: NOMES_PAPEL[papel] ?? `Papel ${papel}`,
          opcoes: ops.size,
          usuariosAtivos: [...acesso().contas.values()].filter((c) => c.papeis.get(papel)).length,
        })),
      ),
    politica: (): Promise<PoliticaLogin> =>
      Promise.resolve({
        senha: CONFIG_SINTETICA.senha,
        tempo: CONFIG_SINTETICA.tempo,
        limiteTentativas: CONFIG_SINTETICA.limiteTentativas,
        termoPeriodico: CONFIG_SINTETICA.termoPeriodico,
        quantidadePeriodoTermo: CONFIG_SINTETICA.quantidadePeriodoTermo,
        tipoPeriodoTermo: CONFIG_SINTETICA.quantidadePeriodoTermo !== null ? 'dias' : null,
      }),
    tiposAcessoProntuario: () =>
      Promise.resolve([
        { id: 1, descricao: 'Consultar' },
        { id: 2, descricao: 'Consultar e alterar' },
      ]),
    termoVigente: () =>
      Promise.resolve({
        ...m().termo,
        aceites: aceitesSinteticos(m().termo.desde).length,
        ultimos: [...acesso().aceitesTermo].map((login) => ({ login, em: hojeIso() })),
      }),
    termoAceito: (_c, login) => Promise.resolve(aceitouTermoSintetico(login)),
    versoesTermo: () =>
      Promise.resolve([
        {
          id: m().termo.id,
          desde: m().termo.desde,
          vigente: true,
          publicadoPor: m().termo.publicadoPor,
          aceites: aceitesSinteticos(m().termo.desde).length,
        },
        ...m().termosAnteriores.map((t) => ({
          id: t.id,
          desde: t.desde,
          vigente: false,
          publicadoPor: t.publicadoPor,
          aceites: t.aceites.length,
        })),
      ]),
    versaoTermo: (_c, id, pagina) => {
      const vig = m().termo.id === id;
      const t = vig
        ? { ...m().termo, aceites: aceitesSinteticos(m().termo.desde) }
        : m().termosAnteriores.find((x) => x.id === id);
      if (!t) return Promise.resolve(null);
      const p = Math.max(1, Math.trunc(pagina));
      return Promise.resolve({
        id: t.id,
        texto: t.texto,
        desde: t.desde,
        vigente: vig,
        aceites: t.aceites.length,
        pagina: p,
        itens: [...t.aceites].reverse().slice((p - 1) * 50, p * 50),
      });
    },
    quebras: (c) =>
      Promise.resolve(
        quebrasMemoria()
          .filter((q) => q.hospital === c.hospital)
          .map((q): QuebraVidro => ({
            id: q.id,
            login: q.login,
            idPaciente: q.idPaciente,
            prontuario: q.idPaciente === PACIENTE_SINTETICO.id ? PACIENTE_SINTETICO.prontuario : null,
            motivo: q.motivo ?? null,
            justificativa: null,
            inicio: q.inicio ?? null,
            fim: q.fim,
            revisao: m().revisoes.get(q.id) ?? null,
          }))
          .reverse(),
      ),
    async revisarQuebra(c, r, t) {
      const q = quebrasMemoria().find((x) => x.id === r.idEmergencia && x.hospital === c.hospital);
      if (!q) throw recusa('nao-encontrado', 'Acesso de emergência não encontrado.');
      if (q.login === r.login)
        throw recusa('a-si-mesmo', 'Ninguém revisa o próprio acesso de emergência (segregação de funções).');
      m().revisoes.set(q.id, { classificacao: r.classificacao, por: r.login, em: new Date() });
      await registrar(t, 'MEMORIA', `REVISAO:${q.id}`);
      return q.id;
    },
    estrutura: () =>
      Promise.resolve({
        empresa: {
          codigo: 1,
          nome: 'Empresa sintética de desenvolvimento',
          cnpj: '00000000000191',
          ativa: true,
        },
        hospital: {
          codigo: 1,
          nome: 'Hospital sintético',
          cnes: 1234567,
          cnpj: '00000000000191',
          municipio: 'Cidade Sintética',
          uf: 'MG',
          esfera: 'Privada',
          complexidade: 'Média complexidade',
          fusoHorario: '-03:00',
        },
        unidades: [
          { codigo: 0, nome: 'Não informada', cnes: null, ativa: true },
          { codigo: 1, nome: 'Unidade sintética 1', cnes: 1234567, ativa: true },
          { codigo: 2, nome: 'Unidade sintética 2', cnes: null, ativa: true },
        ],
      }),
    leitos: () => {
      const s = m();
      return Promise.resolve({
        blocos: [...s.blocos].map(([bloco, b]) => ({ bloco, nome: b.nome, andares: b.andares })),
        acomodacoes: [...s.acomodacoes.values()].map((a) => ({
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          nome: a.nome,
          andar: a.andar,
          leitosPrevistos: a.leitos,
          sexo: a.sexo || null,
          tipo: a.tipo,
          convenio: a.convenio || null,
          centroCusto: a.centroCusto,
          localConta: a.localConta,
          versao: versaoNumerica(versaoAcomodacao(a)),
        })),
        leitos: [...s.leitos.values()].map((l) => ({
          id: l.id,
          bloco: l.bloco,
          acomodacao: l.acomodacao,
          leito: l.leito,
          ativo: l.status !== 'I',
          ocupado: l.reg > 0,
          ramal: l.ramal,
          andar: l.andar,
          versao: versaoNumerica(versaoLeito(l)),
        })),
        opcoes: {
          tipos: [
            { valor: 1, rotulo: 'Apartamento' },
            { valor: 2, rotulo: 'Enfermaria' },
            { valor: 3, rotulo: 'UTI' },
          ],
          centrosCusto: [{ valor: 300100, rotulo: 'Internação (sintético)' }],
          locaisConta: [{ valor: 11, rotulo: 'Posto de enfermagem (sintético)' }],
          tiposTiss: [{ valor: 3, rotulo: 'Enfermaria (sintético)' }],
        },
      });
    },
    locaisComplementos: () =>
      Promise.resolve({
        guiches: [
          { numero: 1, recepcao: 'Recepção sintética' },
          { numero: 2, recepcao: 'Recepção sintética' },
        ],
        horarios: 2,
        encaminhamentos: 0,
        pesquisados: 1,
      }),
    alertas: () =>
      Promise.resolve([
        {
          id: 1,
          nome: 'Alerta sintético de aniversário',
          ativo: true,
          origem: 'paciente',
          exibicao: 1,
          idadeInicial: 0,
          idadeFinal: 140,
          cenario: 'Cenário sintético',
          gatilhos: [{ opcao: 'Localizar paciente', evento: 'Ao abrir' }],
          usuarios: 0,
        },
      ]),
    email: () =>
      Promise.resolve({
        servidores: [
          {
            id: 1,
            servidor: 'smtp.exemplo.invalid',
            porta: 587,
            ssl: true,
            usuarioDefinido: true,
            senhaDefinida: true,
          },
        ],
        modulos: [{ id: 1, nome: 'Prontuário' }],
      }),
    fiscais: () =>
      Promise.resolve({
        codigo: 1,
        nome: 'Empresa sintética de desenvolvimento',
        cnpj: '00000000000191',
        inscricaoEstadual: 'ISENTO',
        inscricaoMunicipal: null,
        cnae: '8610101',
        municipio: 'Cidade Sintética',
        uf: 'MG',
        optanteSimples: false,
        registroAns: null,
        tipoEmpresa: 'Matriz',
        cooperativa: null,
        construtora: null,
        ativa: true,
      }),
    backup: () =>
      Promise.resolve({
        situacoes: [
          { id: 1, descricao: 'Concluído' },
          { id: 2, descricao: 'Com erro' },
        ],
        procedimentos: [{ id: 1, descricao: 'Cópia completa' }],
      }),
    trilha: (c, f) => Promise.resolve(trilhaMem(c, f)),
    acessosProntuario: (c, f) =>
      Promise.resolve(
        trilhaMem(c, f)
          .filter((x) => x.paciente !== null)
          .map((x) => ({
            ...x,
            atendimento: null,
            prontuario: x.paciente === PACIENTE_SINTETICO.id ? PACIENTE_SINTETICO.prontuario : null,
          })),
      ),
    pacientesDoProntuario: (_c, prontuario) =>
      Promise.resolve(prontuario === PACIENTE_SINTETICO.prontuario ? [PACIENTE_SINTETICO.id] : []),
    exclusoes: () =>
      Promise.resolve({
        tipos: [
          { chave: 'atendimentos', rotulo: 'Atendimentos excluídos', quantidade: 0 },
          { chave: 'internacoes', rotulo: 'Internações excluídas', quantidade: 0 },
        ],
        conexoes: [{ modulo: 23, nome: 'P.E.P.', usuarios: 1 }],
      }),
    registrosExclusao: (_c, _r, f) =>
      Promise.resolve(
        f.pagina === 1 && (!f.usuario || f.usuario === 'SINT.ADMIN')
          ? [{ dataHora: `${hojeIso()}T08:00:00`, usuario: 'SINT.ADMIN', registro: 1, justificativa: null }]
          : [],
      ),
    conexoes: (_c, f) =>
      Promise.resolve(
        f.pagina === 1 && (!f.usuario || f.usuario === 'SINT.MEDICO')
          ? [{ dataHora: `${hojeIso()}T00:00:00`, usuario: 'SINT.MEDICO', modulo: 23, nome: 'P.E.P.' }]
          : [],
      ),
    pedidos: (c) =>
      Promise.resolve([
        ...m()
          .pedidos.filter((p) => p.hospital === c.hospital)
          .map((p) => ({ ...p })),
        ...(m().pedidosDoPortal?.listar(c.hospital) ?? []).map((p) => pedidoDoPortal(p)),
      ]),
    async registrarPedido(c, p, t) {
      const idPaciente =
        p.prontuario !== undefined
          ? p.prontuario === PACIENTE_SINTETICO.prontuario
            ? PACIENTE_SINTETICO.id
            : null
          : p.idPaciente === PACIENTE_SINTETICO.id
            ? PACIENTE_SINTETICO.id
            : null;
      if (idPaciente === null)
        throw recusa(
          'paciente-inexistente',
          p.prontuario !== undefined ? 'Nenhum paciente com este prontuário.' : 'Paciente não encontrado.',
        );
      const id = String(m().novoId());
      const ano = new Date().getFullYear();
      const protocolo = `${ano}-${id.padStart(6, '0')}`;
      const agora = new Date();
      m().pedidos.push({
        id,
        protocolo,
        tipo: p.tipo,
        canal: p.canal,
        situacao: 'aberto',
        idPaciente,
        prontuario: PACIENTE_SINTETICO.prontuario,
        abertoEm: agora,
        prazo: new Date(agora.getTime() + p.prazoDias * 86_400_000),
        identidadeVerificada: false,
        fundamento: null,
        decididoPor: null,
        decididoEm: null,
        registradoPor: p.por,
        versao: 1,
        motivoCancelamento: null,
        hospital: c.hospital,
      });
      await registrar(t, 'MEMORIA', protocolo);
      return { id, protocolo };
    },
    async tratarPedido(c, d, t) {
      const ponte = m().pedidosDoPortal;
      const doPortal =
        ponte && Number(d.id) > BASE_ID_PEDIDO_PORTAL
          ? ponte.listar(c.hospital).find((x) => Number(x.id) + BASE_ID_PEDIDO_PORTAL === Number(d.id))
          : undefined;
      if (ponte && doPortal) {
        const r = d.conferir(pedidoDoPortal(doPortal));
        if (r) throw recusa('transicao', r);
        const situacao =
          d.acao === 'confirmar-identidade'
            ? 'identidade-verificada'
            : d.acao === 'atender'
              ? 'atendido'
              : 'negado';
        ponte.decidir(
          c.hospital,
          doPortal.id,
          situacao,
          d.acao === 'confirmar-identidade' ? null : d.fundamento,
        );
        await registrar(t, 'MEMORIA', `${doPortal.protocolo}:${situacao}`);
        return { id: d.id, situacao };
      }
      const p = m().pedidos.find((x) => x.id === d.id && x.hospital === c.hospital);
      if (!p) throw recusa('pedido-inexistente', 'Pedido não encontrado.');
      const r = d.conferir(p as PedidoTitularLido);
      if (r) throw recusa('transicao', r);
      if (d.acao === 'confirmar-identidade') {
        p.identidadeVerificada = true;
        p.situacao = 'identidade-verificada';
      } else {
        p.situacao = d.acao === 'atender' ? 'atendido' : 'negado';
        p.fundamento = d.fundamento;
        p.decididoPor = d.por;
        p.decididoEm = new Date();
      }
      p.versao++;
      await registrar(t, 'MEMORIA', `${p.protocolo}:${p.situacao}`);
      return { id: p.id, situacao: p.situacao };
    },
    hoje: () => Promise.resolve(hojeIso()),
  };
}
