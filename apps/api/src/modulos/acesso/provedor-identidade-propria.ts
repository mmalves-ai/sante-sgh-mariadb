// LOGIN ÚNICO CORPORATIVO no banco próprio (01-ADM L61): o cadastro do provedor de identidade do hospital
// (provedor_identidade, com a referência ao cofre, nunca o segredo), o perfil padrão por grupo do diretório
// (provedor_identidade_perfil) e o vínculo da conta local com o identificador externo (vinculo_identidade_externa).
// Nada se apaga: o provedor e o mapa de grupo saem pelo "ativo", o vínculo é desligado (ativo = falso, com quem e
// quando). A regra é a do domínio (provedor-externo.ts); a gravação vai pelo executor, com a trilha na mesma transação.
// A entrada pelo provedor (resolverEntrada) liga a identidade no primeiro acesso, quando o provedor permite e há uma só
// conta com o e-mail confirmado, e marca o último uso do vínculo.
import {
  type CadastroProvedor,
  conferirVinculoNovo,
  decidirEntradaExterna,
  padroesDoProtocolo,
  PROTOCOLOS_COM_ENTRADA,
  type ProtocoloProvedor,
  validarCadastroProvedor,
} from '@sgh/dominio-acesso';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_PROVEDOR_IDENTIDADE = Symbol('PORTA_PROVEDOR_IDENTIDADE');

const TABELAS = ['provedor_identidade', 'provedor_identidade_perfil', 'vinculo_identidade_externa'];
const TETO = 200;

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);
const invalido = (codigo: string, detalhe: string) =>
  new ErroOperacao(400, codigo, 'Dados inválidos', detalhe);
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string | Date).toISOString();
const vazioNulo = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

const textoOpc = (max: number) => z.string().max(max).nullish();
export const esquemaProvedor = z
  .object({
    id: z.number().int().positive().optional(),
    versao: z.number().int().positive().optional(),
    codigo: z.string().min(1).max(30),
    nome: z.string().min(1).max(150),
    protocolo: z.string().min(1).max(30),
    urlServidor: z.string().min(1).max(500),
    dominio: textoOpc(150),
    basePesquisa: textoOpc(300),
    filtroUsuario: textoOpc(300),
    emissor: textoOpc(500),
    clienteIdentificador: textoOpc(200),
    referenciaCofre: textoOpc(200),
    atributoLogin: textoOpc(100),
    atributoEmail: textoOpc(100),
    atributoGrupo: textoOpc(100),
    criaContaAutomatica: z.boolean().default(false),
    sincronizaPerfis: z.boolean().default(false),
    prioridade: z.number().int().min(1).max(99).default(1),
    ativo: z.boolean().default(true),
    /** Verdadeiro: vale só neste estabelecimento; falso: para todos os estabelecimentos do cliente. */
    soEsteEstabelecimento: z.boolean().default(false),
  })
  .strict();
export type EntradaProvedor = z.input<typeof esquemaProvedor>;

export const esquemaGrupo = z
  .object({
    grupoExterno: z.string().trim().min(1).max(300),
    perfil: z.string().trim().min(1).max(30),
    soEsteEstabelecimento: z.boolean().default(false),
  })
  .strict();
export const esquemaVinculo = z
  .object({
    login: z.string().trim().min(1).max(60),
    identificador: z.string().max(255),
    email: z.string().trim().email().max(254).nullish(),
  })
  .strict();
export const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();

export interface ProvedorTela {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly protocolo: string;
  readonly urlServidor: string;
  readonly dominio: string | null;
  readonly basePesquisa: string | null;
  readonly filtroUsuario: string | null;
  readonly emissor: string | null;
  readonly clienteIdentificador: string | null;
  readonly referenciaCofre: string | null;
  readonly atributoLogin: string;
  readonly atributoEmail: string | null;
  readonly atributoGrupo: string | null;
  readonly criaContaAutomatica: boolean;
  readonly sincronizaPerfis: boolean;
  readonly prioridade: number;
  readonly ativo: boolean;
  readonly soEsteEstabelecimento: boolean;
  readonly entradaLigada: boolean;
  readonly vinculosAtivos: number;
  readonly gruposAtivos: number;
}

export interface GrupoTela {
  readonly id: number;
  readonly versao: number;
  readonly grupoExterno: string;
  readonly perfil: string;
  readonly soEsteEstabelecimento: boolean;
  readonly ativo: boolean;
}

export interface VinculoTela {
  readonly id: number;
  readonly versao: number;
  readonly login: string;
  readonly identificador: string;
  readonly email: string | null;
  readonly vinculadoEm: string | null;
  readonly ultimoUsoEm: string | null;
  readonly ativo: boolean;
}

export interface ProvedorDeEntrada {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly protocolo: ProtocoloProvedor;
  readonly urlServidor: string;
  readonly emissor: string;
  readonly clienteIdentificador: string;
  readonly referenciaCofre: string | null;
  readonly atributoEmail: string;
  readonly atributoGrupo: string;
  readonly criaContaAutomatica: boolean;
}

export type ResultadoEntradaExterna =
  { readonly login: string; readonly vinculo: number; readonly novo: boolean } | { readonly recusa: string };

const COLUNAS_PROVEDOR = `p.id, p.versao, p.codigo, p.nome, p.protocolo, p.url_servidor, p.dominio, p.base_pesquisa,
  p.filtro_usuario, p.emissor, p.cliente_identificador, p.referencia_cofre, p.atributo_login, p.atributo_email,
  p.atributo_grupo, p.cria_conta_automatica, p.sincroniza_perfis, p.prioridade, p.ativo, p.estabelecimento_id`;

/** Os provedores do estabelecimento: os dele e os de todos (estabelecimento nulo). */
const DO_ESTABELECIMENTO = '(p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)';

function provedorDaLinha(r: Record<string, unknown>): Omit<ProvedorTela, 'vinculosAtivos' | 'gruposAtivos'> {
  const protocolo = String(r['protocolo']);
  return {
    id: num(r['id']),
    versao: num(r['versao']),
    codigo: String(r['codigo']),
    nome: String(r['nome']),
    protocolo,
    urlServidor: String(r['url_servidor']),
    dominio: txtOuNull(r['dominio']),
    basePesquisa: txtOuNull(r['base_pesquisa']),
    filtroUsuario: txtOuNull(r['filtro_usuario']),
    emissor: txtOuNull(r['emissor']),
    clienteIdentificador: txtOuNull(r['cliente_identificador']),
    referenciaCofre: txtOuNull(r['referencia_cofre']),
    atributoLogin: String(r['atributo_login']),
    atributoEmail: txtOuNull(r['atributo_email']),
    atributoGrupo: txtOuNull(r['atributo_grupo']),
    criaContaAutomatica: bool(r['cria_conta_automatica']),
    sincronizaPerfis: bool(r['sincroniza_perfis']),
    prioridade: num(r['prioridade']),
    ativo: bool(r['ativo']),
    soEsteEstabelecimento: numOuNull(r['estabelecimento_id']) !== null,
    entradaLigada: PROTOCOLOS_COM_ENTRADA.includes(protocolo as ProtocoloProvedor),
  };
}

export class PortaProvedorIdentidadePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'acesso.provedorIdentidade');
  }

  private async provedorDoEst(l: Leitor, est: number, id: number): Promise<Record<string, unknown>> {
    const r = await l.uma(
      `SELECT ${COLUNAS_PROVEDOR} FROM provedor_identidade p WHERE p.id = ? AND ${DO_ESTABELECIMENTO}`,
      [id, est],
    );
    if (!r) throw naoEncontrado('Provedor de identidade');
    return r;
  }

  /** Os provedores do estabelecimento, com os vínculos e os grupos ativos de cada um. */
  listar(c: ContextoPortaPropria): Promise<readonly ProvedorTela[]> {
    return this.ler(c, 'listar', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT ${COLUNAS_PROVEDOR},
                (SELECT COUNT(*) FROM vinculo_identidade_externa v
                  WHERE v.provedor_identidade_id = p.id AND v.ativo = TRUE AND v.excluido_em IS NULL) AS vinculos,
                (SELECT COUNT(*) FROM provedor_identidade_perfil g
                  WHERE g.provedor_identidade_id = p.id AND g.ativo = TRUE) AS grupos
           FROM provedor_identidade p
          WHERE ${DO_ESTABELECIMENTO}
          ORDER BY p.ativo DESC, p.prioridade, p.nome
          LIMIT ${TETO}`,
        [est.id],
        { teto: TETO },
      );
      return linhas.map((r) => ({
        ...provedorDaLinha(r),
        vinculosAtivos: num(r['vinculos']),
        gruposAtivos: num(r['grupos']),
      }));
    });
  }

  /** Cria ou altera (com a versão) o provedor; a validação por protocolo é a do domínio. */
  async gravarProvedor(c: ContextoPortaPropria, bruto: unknown): Promise<{ id: number; versao: number }> {
    const r = esquemaProvedor.safeParse(bruto);
    if (!r.success) throw invalido('entrada-invalida', r.error.issues[0]?.message ?? 'Dados inválidos.');
    const e = r.data;
    const cadastro: CadastroProvedor = {
      codigo: e.codigo.trim(),
      nome: e.nome.trim(),
      protocolo: e.protocolo,
      urlServidor: e.urlServidor,
      dominio: e.dominio ?? null,
      basePesquisa: e.basePesquisa ?? null,
      emissor: e.emissor ?? null,
      clienteIdentificador: e.clienteIdentificador ?? null,
      referenciaCofre: e.referenciaCofre ?? null,
    };
    const falhas = validarCadastroProvedor(cadastro);
    if (falhas.length) throw invalido(falhas[0]!, `Cadastro do provedor recusado: ${falhas.join(', ')}.`);
    const padrao = padroesDoProtocolo(e.protocolo as ProtocoloProvedor);
    return this.gravar(c, 'acesso.provedoridentidade.gravar', ['provedor_identidade'], async (tx, est) => {
      const valores = {
        estabelecimento_id: e.soEsteEstabelecimento ? est.id : null,
        codigo: cadastro.codigo,
        nome: cadastro.nome,
        protocolo: e.protocolo,
        url_servidor: e.urlServidor.trim(),
        dominio: vazioNulo(e.dominio),
        base_pesquisa: vazioNulo(e.basePesquisa),
        filtro_usuario: vazioNulo(e.filtroUsuario),
        emissor: vazioNulo(e.emissor),
        cliente_identificador: vazioNulo(e.clienteIdentificador),
        referencia_cofre: vazioNulo(e.referenciaCofre),
        atributo_login: vazioNulo(e.atributoLogin) ?? padrao.atributoLogin,
        atributo_email: vazioNulo(e.atributoEmail) ?? padrao.atributoEmail,
        atributo_grupo: vazioNulo(e.atributoGrupo) ?? padrao.atributoGrupo,
        cria_conta_automatica: e.criaContaAutomatica,
        sincroniza_perfis: e.sincronizaPerfis,
        prioridade: e.prioridade,
        ativo: e.ativo,
      };
      const [mesmo] = await tx.consultarParaAtualizar<Record<string, unknown>>(
        'SELECT id FROM provedor_identidade WHERE codigo = ?',
        [cadastro.codigo],
        { teto: 1 },
      );
      if (e.id === undefined) {
        if (mesmo) throw recusa('codigo-em-uso', 'Já existe um provedor com este código.');
        const id = await tx.incluir('provedor_identidade', valores);
        return { tabela: 'provedor_identidade', id, versao: 1 };
      }
      if (e.versao === undefined) throw invalido('versao-obrigatoria', 'Informe a versão do provedor.');
      const [atual] = await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT p.id FROM provedor_identidade p WHERE p.id = ? AND ${DO_ESTABELECIMENTO}`,
        [e.id, est.id],
        { teto: 1 },
      );
      if (!atual) throw naoEncontrado('Provedor de identidade');
      if (mesmo && num(mesmo['id']) !== e.id)
        throw recusa('codigo-em-uso', 'Já existe um provedor com este código.');
      const versao = await tx.alterar('provedor_identidade', e.id, e.versao, valores);
      return { tabela: 'provedor_identidade', id: e.id, versao };
    }).then((x) => ({ id: Number(x.id), versao: Number(x.versao) }));
  }

  grupos(c: ContextoPortaPropria, provedor: number): Promise<readonly GrupoTela[]> {
    return this.ler(c, 'grupos', async (l, est) => {
      await this.provedorDoEst(l, est.id, provedor);
      const linhas = await l.consultar(
        `SELECT g.id, g.versao, g.grupo_externo, pf.codigo AS perfil, g.estabelecimento_id, g.ativo
           FROM provedor_identidade_perfil g
           JOIN perfil_acesso pf ON pf.id = g.perfil_acesso_id
          WHERE g.provedor_identidade_id = ? AND (g.estabelecimento_id IS NULL OR g.estabelecimento_id = ?)
          ORDER BY g.ativo DESC, g.grupo_externo, pf.codigo
          LIMIT ${TETO}`,
        [provedor, est.id],
        { teto: TETO },
      );
      return linhas.map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        grupoExterno: String(r['grupo_externo']),
        perfil: String(r['perfil']),
        soEsteEstabelecimento: numOuNull(r['estabelecimento_id']) !== null,
        ativo: bool(r['ativo']),
      }));
    });
  }

  /** Mapa novo de grupo para perfil (o mesmo grupo e perfil ativos não se repetem; o inativo é reativado). */
  async incluirGrupo(c: ContextoPortaPropria, provedor: number, bruto: unknown): Promise<{ id: number }> {
    const r = esquemaGrupo.safeParse(bruto);
    if (!r.success) throw invalido('entrada-invalida', r.error.issues[0]?.message ?? 'Dados inválidos.');
    const e = r.data;
    return this.gravar(
      c,
      'acesso.provedoridentidade.grupo.incluir',
      ['provedor_identidade_perfil'],
      async (tx, est) => {
        await this.provedorDoEst(tx, est.id, provedor);
        const pf = await tx.uma(
          `SELECT id FROM perfil_acesso WHERE codigo = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          ORDER BY estabelecimento_id IS NULL LIMIT 1`,
          [e.perfil, est.id],
        );
        if (!pf) throw naoEncontrado('Perfil de acesso');
        const escopo = e.soEsteEstabelecimento ? est.id : null;
        const [existe] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, versao, ativo FROM provedor_identidade_perfil
          WHERE provedor_identidade_id = ? AND grupo_externo = ? AND perfil_acesso_id = ? AND escopo_estabelecimento = ?`,
          [provedor, e.grupoExterno, num(pf['id']), escopo ?? 0],
          { teto: 1 },
        );
        if (existe) {
          if (bool(existe['ativo'])) throw recusa('grupo-ja-mapeado', 'Este grupo já dá este perfil.');
          await tx.alterar('provedor_identidade_perfil', num(existe['id']), num(existe['versao']), {
            ativo: true,
          });
          return { tabela: 'provedor_identidade_perfil', id: num(existe['id']) };
        }
        const id = await tx.incluir('provedor_identidade_perfil', {
          provedor_identidade_id: provedor,
          grupo_externo: e.grupoExterno,
          perfil_acesso_id: num(pf['id']),
          estabelecimento_id: escopo,
          ativo: true,
        });
        return { tabela: 'provedor_identidade_perfil', id };
      },
    ).then((x) => ({ id: Number(x.id) }));
  }

  /** Desativa o mapa de grupo (a linha fica, com quem e quando). */
  async desativarGrupo(
    c: ContextoPortaPropria,
    grupo: number,
    bruto: unknown,
  ): Promise<{ id: number; versao: number }> {
    const r = esquemaVersao.safeParse(bruto);
    if (!r.success) throw invalido('entrada-invalida', 'Informe a versão.');
    return this.gravar(
      c,
      'acesso.provedoridentidade.grupo.desativar',
      ['provedor_identidade_perfil'],
      async (tx, est) => {
        const g = await tx.uma(
          `SELECT g.id, g.ativo FROM provedor_identidade_perfil g
           JOIN provedor_identidade p ON p.id = g.provedor_identidade_id
          WHERE g.id = ? AND ${DO_ESTABELECIMENTO}`,
          [grupo, est.id],
        );
        if (!g) throw naoEncontrado('Mapa de grupo');
        if (!bool(g['ativo'])) throw recusa('grupo-ja-inativo', 'O mapa de grupo já está inativo.');
        const versao = await tx.alterar('provedor_identidade_perfil', grupo, r.data.versao, { ativo: false });
        return { tabela: 'provedor_identidade_perfil', id: grupo, versao };
      },
    ).then((x) => ({ id: Number(x.id), versao: Number(x.versao) }));
  }

  vinculos(c: ContextoPortaPropria, provedor: number): Promise<readonly VinculoTela[]> {
    return this.ler(c, 'vinculos', async (l, est) => {
      await this.provedorDoEst(l, est.id, provedor);
      const linhas = await l.consultar(
        `SELECT v.id, v.versao, u.login, v.identificador_externo, v.email_externo, v.vinculado_em, v.ultimo_uso_em, v.ativo
           FROM vinculo_identidade_externa v
           JOIN usuario u ON u.id = v.usuario_id
          WHERE v.provedor_identidade_id = ? AND v.excluido_em IS NULL
          ORDER BY v.ativo DESC, u.login
          LIMIT ${TETO}`,
        [provedor],
        { teto: TETO },
      );
      return linhas.map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        login: String(r['login']),
        identificador: String(r['identificador_externo']),
        email: txtOuNull(r['email_externo']),
        vinculadoEm: iso(r['vinculado_em']),
        ultimoUsoEm: iso(r['ultimo_uso_em']),
        ativo: bool(r['ativo']),
      }));
    });
  }

  /** O gestor liga a conta local à identidade externa (a mesma identidade não liga duas contas). */
  async ligarVinculo(c: ContextoPortaPropria, provedor: number, bruto: unknown): Promise<{ id: number }> {
    const r = esquemaVinculo.safeParse(bruto);
    if (!r.success) throw invalido('entrada-invalida', r.error.issues[0]?.message ?? 'Dados inválidos.');
    const e = r.data;
    return this.gravar(
      c,
      'acesso.provedoridentidade.vinculo.ligar',
      ['vinculo_identidade_externa'],
      async (tx, est) => {
        await this.provedorDoEst(tx, est.id, provedor);
        const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [e.login]);
        if (!u) throw naoEncontrado('Conta');
        const identificador = e.identificador.trim();
        const daIdentidade = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id FROM vinculo_identidade_externa WHERE provedor_identidade_id = ? AND identificador_externo = ?',
          [provedor, identificador],
          { teto: 1 },
        );
        const daConta = await tx.consultarParaAtualizar<Record<string, unknown>>(
          'SELECT id FROM vinculo_identidade_externa WHERE provedor_identidade_id = ? AND usuario_id = ?',
          [provedor, num(u['id'])],
          { teto: 1 },
        );
        const falha = conferirVinculoNovo({
          identificador,
          identidadeJaLigada: daIdentidade.length > 0,
          contaJaLigada: daConta.length > 0,
        });
        if (falha === 'identificador-invalido') throw invalido(falha, 'Informe o identificador no provedor.');
        if (falha === 'identidade-ja-ligada')
          throw recusa(falha, 'Esta identidade já está ligada a uma conta (religue o vínculo existente).');
        if (falha === 'conta-ja-ligada')
          throw recusa(falha, 'A conta já tem vínculo neste provedor (religue o vínculo existente).');
        const id = await tx.incluir('vinculo_identidade_externa', {
          usuario_id: num(u['id']),
          provedor_identidade_id: provedor,
          identificador_externo: identificador,
          email_externo: e.email ?? null,
          vinculado_em: new Date(),
          ativo: true,
        });
        return { tabela: 'vinculo_identidade_externa', id };
      },
    ).then((x) => ({ id: Number(x.id) }));
  }

  /** Desliga (ativo = falso) ou religa o vínculo; a linha nunca se apaga. */
  async alternarVinculo(
    c: ContextoPortaPropria,
    vinculo: number,
    ativo: boolean,
    bruto: unknown,
  ): Promise<{ id: number; versao: number }> {
    const r = esquemaVersao.safeParse(bruto);
    if (!r.success) throw invalido('entrada-invalida', 'Informe a versão.');
    const nome = ativo
      ? 'acesso.provedoridentidade.vinculo.religar'
      : 'acesso.provedoridentidade.vinculo.desligar';
    return this.gravar(c, nome, ['vinculo_identidade_externa'], async (tx, est) => {
      const v = await tx.uma(
        `SELECT v.id, v.ativo FROM vinculo_identidade_externa v
           JOIN provedor_identidade p ON p.id = v.provedor_identidade_id
          WHERE v.id = ? AND v.excluido_em IS NULL AND ${DO_ESTABELECIMENTO}`,
        [vinculo, est.id],
      );
      if (!v) throw naoEncontrado('Vínculo');
      if (bool(v['ativo']) === ativo)
        throw recusa(
          'vinculo-sem-mudanca',
          ativo ? 'O vínculo já está ativo.' : 'O vínculo já está desligado.',
        );
      const versao = await tx.alterar('vinculo_identidade_externa', vinculo, r.data.versao, { ativo });
      return { tabela: 'vinculo_identidade_externa', id: vinculo, versao };
    }).then((x) => ({ id: Number(x.id), versao: Number(x.versao) }));
  }

  /** Tela de entrada: os provedores ativos com a entrada ligada (só código e nome; sem dado de pessoa). */
  provedoresDeEntrada(c: ContextoPortaPropria): Promise<readonly { codigo: string; nome: string }[]> {
    return this.ler(c, 'entrada.lista', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT p.codigo, p.nome FROM provedor_identidade p
          WHERE p.ativo = TRUE AND p.protocolo IN ('oidc') AND ${DO_ESTABELECIMENTO}
          ORDER BY p.prioridade, p.nome LIMIT 20`,
        [est.id],
        { teto: 20 },
      );
      return linhas.map((r) => ({ codigo: String(r['codigo']), nome: String(r['nome']) }));
    });
  }

  /** O provedor ativo para a entrada (o que a API precisa para o redirecionamento e a conferência do token). */
  provedorParaEntrada(c: ContextoPortaPropria, codigo: string): Promise<ProvedorDeEntrada | null> {
    return this.ler(c, 'entrada.provedor', async (l, est) => {
      const r = await l.uma(
        `SELECT ${COLUNAS_PROVEDOR} FROM provedor_identidade p
          WHERE p.codigo = ? AND p.ativo = TRUE AND ${DO_ESTABELECIMENTO}`,
        [codigo, est.id],
      );
      if (!r) return null;
      const p = provedorDaLinha(r);
      if (!p.entradaLigada || !p.emissor || !p.clienteIdentificador) return null;
      const padrao = padroesDoProtocolo(p.protocolo as ProtocoloProvedor);
      return {
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        protocolo: p.protocolo as ProtocoloProvedor,
        urlServidor: p.urlServidor,
        emissor: p.emissor,
        clienteIdentificador: p.clienteIdentificador,
        referenciaCofre: p.referenciaCofre,
        atributoEmail: p.atributoEmail ?? padrao.atributoEmail,
        atributoGrupo: p.atributoGrupo ?? padrao.atributoGrupo,
        criaContaAutomatica: p.criaContaAutomatica,
      };
    });
  }

  /**
   * A identidade conferida pelo provedor vira a conta local: o vínculo ativo entra (marca o último uso); sem vínculo,
   * o domínio decide se liga à única conta com o e-mail confirmado. A recusa volta como motivo (a API conta a
   * tentativa e registra na trilha). Grava com o usuário da própria conta (é ela quem entra).
   */
  async resolverEntrada(
    c: Omit<ContextoPortaPropria, 'usuario'>,
    provedor: number,
    identidade: {
      readonly sujeito: string;
      readonly email: string | null;
      readonly emailConfirmado: boolean;
    },
  ): Promise<ResultadoEntradaExterna> {
    const contexto = { ...c, usuario: null } as ContextoPortaPropria;
    const lido = await this.ler(contexto, 'entrada.resolver', async (l, est) => {
      const p = await this.provedorDoEst(l, est.id, provedor);
      const v = await l.uma(
        `SELECT v.id, v.usuario_id, u.login, v.ativo, v.valido_ate FROM vinculo_identidade_externa v
           JOIN usuario u ON u.id = v.usuario_id
          WHERE v.provedor_identidade_id = ? AND v.identificador_externo = ? AND v.excluido_em IS NULL`,
        [provedor, identidade.sujeito],
      );
      const contas =
        !v && identidade.email
          ? await l.consultar(
              `SELECT u.id, u.login FROM usuario u
                WHERE u.email = ? AND u.excluido_em IS NULL AND u.situacao = 'ativo'
                  AND NOT EXISTS (SELECT 1 FROM vinculo_identidade_externa x
                                   WHERE x.usuario_id = u.id AND x.provedor_identidade_id = ? AND x.excluido_em IS NULL)
                LIMIT 2`,
              [identidade.email, provedor],
              { teto: 2 },
            )
          : [];
      return { p, v, contas };
    });
    const decisao = decidirEntradaExterna({
      provedorAtivo: bool(lido.p['ativo']),
      criaContaAutomatica: bool(lido.p['cria_conta_automatica']),
      vinculo: lido.v
        ? {
            id: num(lido.v['id']),
            usuario: num(lido.v['usuario_id']),
            login: String(lido.v['login']),
            ativo: bool(lido.v['ativo']),
            validoAte: lido.v['valido_ate'] ? new Date(lido.v['valido_ate'] as string) : null,
          }
        : null,
      emailConfirmado: identidade.emailConfirmado,
      contasComEmail: lido.contas.map((x) => ({ usuario: num(x['id']), login: String(x['login']) })),
      agora: new Date(),
    });
    if (decisao.tipo === 'recusar') return { recusa: decisao.motivo };
    if (decisao.tipo === 'entrar') {
      const usuario = num(lido.v!['usuario_id']);
      await this.gravar(
        { ...contexto, usuario },
        'acesso.provedoridentidade.vinculo.uso',
        ['vinculo_identidade_externa'],
        async (tx) => {
          const [atual] = await tx.consultarParaAtualizar<Record<string, unknown>>(
            'SELECT versao FROM vinculo_identidade_externa WHERE id = ?',
            [decisao.vinculo],
            { teto: 1 },
          );
          await tx.alterar('vinculo_identidade_externa', decisao.vinculo, num(atual?.['versao']), {
            ultimo_uso_em: new Date(),
          });
          return { tabela: 'vinculo_identidade_externa', id: decisao.vinculo };
        },
      );
      return { login: decisao.login, vinculo: decisao.vinculo, novo: false };
    }
    const feito = await this.gravar(
      { ...contexto, usuario: decisao.usuario },
      'acesso.provedoridentidade.vinculo.novo',
      ['vinculo_identidade_externa'],
      async (tx) => {
        const id = await tx.incluir('vinculo_identidade_externa', {
          usuario_id: decisao.usuario,
          provedor_identidade_id: provedor,
          identificador_externo: identidade.sujeito,
          email_externo: identidade.email,
          vinculado_em: new Date(),
          ultimo_uso_em: new Date(),
          ativo: true,
        });
        return { tabela: 'vinculo_identidade_externa', id };
      },
    );
    return { login: decisao.login, vinculo: Number(feito.id), novo: true };
  }
}
