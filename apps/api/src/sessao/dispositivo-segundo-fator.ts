// Segundo fator pela chave do dispositivo (WebAuthn com biometria local; 01-ADM L62, DP-45 decidida em 26/11):
//   - CredencialDispositivoPropria: a tabela credencial_dispositivo (02_ADM/99w) pelo Executor, com trilha;
//   - ServicoDispositivoSegundoFator: as cerimônias de cadastro e de validação. O desafio vive só no armazém de
//     sessões (uso único, validade de 5 minutos); a conferência da resposta é a regra do domínio (@sgh/dominio-acesso).
// O servidor guarda só a chave pública: nenhum dado biométrico passa por aqui.
import { createHash, randomUUID } from 'node:crypto';
import {
  conferirCadastroCredencial,
  conferirLimiteDispositivos,
  conferirValidacaoCredencial,
  ErroWebAuthn,
  gerarDesafioWebAuthn,
  normalizarNomeDispositivo,
  opcoesCadastroCredencial,
  opcoesValidacaoCredencial,
  servidorDaUrlPublica,
  VALIDADE_DESAFIO_SEGUNDOS,
  type CredencialCadastrada,
  type RespostaCadastro,
  type RespostaValidacao,
} from '@sgh/dominio-acesso';
import { definirOperacao, type Executor, recusa, restricaoViolada } from '@sgh/nucleo';
import { z } from 'zod';
import type { NucleoAcessoEmail } from './acesso-email-proprio.js';
import type { ArmazemSessao } from './armazem.js';
import type { ResolverEstabelecimentoPin } from './porta-pin-propria.js';

export const TABELA_CREDENCIAL_DISPOSITIVO = 'credencial_dispositivo';
const ENTRADA = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Quem age (a própria conta) e de onde. */
export interface AtorDispositivo {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

export interface DispositivoTela {
  readonly id: number;
  readonly nome: string;
  readonly criadoEm: string;
  readonly ultimoUsoEm: string | null;
}

interface CredencialGuardada {
  readonly id: number;
  readonly idCredencial: string;
  readonly chavePublica: string;
  readonly contador: number;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export class CredencialDispositivoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoAcessoEmail,
    private readonly resolver: ResolverEstabelecimentoPin,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private onde(rede: string, hospital: string): { cliente: string; estabelecimento: number } {
    const r = this.resolver(rede, hospital);
    if (!r.cliente || r.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não está no banco do cliente.');
    return { cliente: r.cliente, estabelecimento: r.estabelecimento };
  }

  private ler<T>(
    a: Pick<AtorDispositivo, 'rede' | 'hospital'>,
    f: Parameters<NucleoAcessoEmail['lerSomente']>[1],
  ) {
    const o = this.onde(a.rede, a.hospital);
    return this.nucleo.lerSomente(
      { cliente: o.cliente, estabelecimento: o.estabelecimento, correlacao: 'acesso-dispositivo' },
      f,
    ) as Promise<T>;
  }

  /** Id da conta (ativa) pelo login. */
  async idUsuario(a: Pick<AtorDispositivo, 'rede' | 'hospital' | 'login'>): Promise<number | null> {
    const u = await this.ler<Record<string, unknown> | null>(a, (l) =>
      l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]),
    );
    return u ? Number(u['id']) : null;
  }

  /** Os dispositivos ativos da conta (mais recentes primeiro). */
  async listar(a: Pick<AtorDispositivo, 'rede' | 'hospital' | 'login'>): Promise<DispositivoTela[]> {
    const linhas = await this.ler<Record<string, unknown>[]>(a, (l) =>
      l.consultar(
        `SELECT d.id, d.nome, d.criado_em, d.ultimo_uso_em FROM credencial_dispositivo d
           JOIN usuario u ON u.id = d.usuario_id
          WHERE u.login = ? AND u.excluido_em IS NULL AND d.revogada_em IS NULL
          ORDER BY d.criado_em DESC, d.id DESC`,
        [a.login],
      ),
    );
    return linhas.map((r) => ({
      id: Number(r['id']),
      nome: String(r['nome']),
      criadoEm: iso(r['criado_em'])!,
      ultimoUsoEm: iso(r['ultimo_uso_em']),
    }));
  }

  /** As credenciais ativas, com a chave e o contador (para a validação). */
  async ativas(a: Pick<AtorDispositivo, 'rede' | 'hospital' | 'login'>): Promise<CredencialGuardada[]> {
    const linhas = await this.ler<Record<string, unknown>[]>(a, (l) =>
      l.consultar(
        `SELECT d.id, d.identificador_credencial, d.chave_publica, d.contador_assinatura
           FROM credencial_dispositivo d JOIN usuario u ON u.id = d.usuario_id
          WHERE u.login = ? AND u.excluido_em IS NULL AND d.revogada_em IS NULL`,
        [a.login],
      ),
    );
    return linhas.map((r) => ({
      id: Number(r['id']),
      idCredencial: String(r['identificador_credencial']),
      chavePublica: String(r['chave_publica']),
      contador: Number(r['contador_assinatura']),
    }));
  }

  private async executar<T>(
    a: AtorDispositivo,
    nome: string,
    op: Parameters<Executor['executar']>[0],
    entrada: z.infer<typeof ENTRADA>,
  ): Promise<T> {
    const o = this.onde(a.rede, a.hospital);
    const usuario = await this.idUsuario(a);
    const r = await this.executor.executar(op, o.cliente, entrada, {
      cliente: o.cliente,
      estabelecimento: o.estabelecimento,
      usuario,
      correlacao: (a.correlacao || 'acesso-dispositivo').slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    });
    return r.resultado as T;
  }

  /** Grava a credencial conferida (limite por conta e identificador único). */
  async incluir(a: AtorDispositivo, c: CredencialCadastrada, nomeBruto: string): Promise<{ id: number }> {
    const nome = normalizarNomeDispositivo(nomeBruto);
    let alvo: number | null = null;
    const op = definirOperacao({
      nome: 'acesso.dispositivo.cadastrar',
      tabelas: [TABELA_CREDENCIAL_DISPOSITIVO],
      entrada: ENTRADA,
      gravar: async (tx) => {
        const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [a.login]);
        if (!u) throw recusa('usuario-inexistente', 'A conta não existe neste cliente.');
        const linhas = await tx.consultarParaAtualizar(
          'SELECT id FROM credencial_dispositivo WHERE usuario_id = ? AND revogada_em IS NULL',
          [Number(u['id'])],
          { teto: 100 },
        );
        try {
          conferirLimiteDispositivos(linhas.length);
        } catch (e) {
          if (e instanceof ErroWebAuthn) throw recusa(e.codigo, e.message);
          throw e;
        }
        try {
          alvo = await tx.incluir(TABELA_CREDENCIAL_DISPOSITIVO, {
            usuario_id: Number(u['id']),
            identificador_credencial: c.idCredencial,
            chave_publica: c.chavePublica,
            algoritmo: c.algoritmo,
            contador_assinatura: c.contador,
            nome,
            formato_atestado: c.formatoAtestado,
            verificacao_usuario: c.verificacaoUsuario,
          });
        } catch (e) {
          if (restricaoViolada(e)?.tipo === 'unica')
            throw recusa('credencial-ja-cadastrada', 'Este dispositivo já está cadastrado.');
          throw e;
        }
        return { id: alvo };
      },
      alvo: () => ({ tabela: TABELA_CREDENCIAL_DISPOSITIVO, id: alvo }),
      trilha: () => ({
        dados: {
          evento: 'acesso.dispositivo.cadastrado',
          recurso: 'acesso.sessao',
          operacao: 'acesso.dispositivo.cadastrar',
          resultado: 'sucesso',
          estacao: a.estacao,
          diferenca: `dispositivo: + ${nome}`,
        },
      }),
    });
    return this.executar(a, 'dispositivo-cadastrar', op, { login: a.login, nome });
  }

  /** Revoga um dispositivo da própria conta (a credencial deixa de valer na hora). */
  async revogar(a: AtorDispositivo, id: number): Promise<void> {
    let nome = '';
    const op = definirOperacao({
      nome: 'acesso.dispositivo.revogar',
      tabelas: [TABELA_CREDENCIAL_DISPOSITIVO],
      entrada: ENTRADA,
      gravar: async (tx) => {
        const [d] = await tx.consultarParaAtualizar(
          `SELECT d.id, d.nome, d.versao, d.revogada_em, u.id AS usuario FROM credencial_dispositivo d
             JOIN usuario u ON u.id = d.usuario_id WHERE d.id = ? AND u.login = ? AND u.excluido_em IS NULL`,
          [id, a.login],
          { teto: 1 },
        );
        if (!d || d['revogada_em'] != null)
          throw recusa('dispositivo-inexistente', 'O dispositivo não está cadastrado nesta conta.');
        nome = String(d['nome']);
        await tx.alterar(TABELA_CREDENCIAL_DISPOSITIVO, id, Number(d['versao']), {
          revogada_em: new Date(),
          revogada_por: Number(d['usuario']),
        });
        return { id };
      },
      alvo: () => ({ tabela: TABELA_CREDENCIAL_DISPOSITIVO, id }),
      trilha: () => ({
        dados: {
          evento: 'acesso.dispositivo.revogado',
          recurso: 'acesso.sessao',
          operacao: 'acesso.dispositivo.revogar',
          resultado: 'sucesso',
          estacao: a.estacao,
          diferenca: `dispositivo: - ${nome}`,
        },
      }),
    });
    await this.executar(a, 'dispositivo-revogar', op, { login: a.login, id });
  }

  /** Grava o uso aceito: o contador novo (só para frente, conferido de novo sob trava) e a hora. */
  async registrarUso(a: AtorDispositivo, id: number, contador: number): Promise<void> {
    const op = definirOperacao({
      nome: 'acesso.dispositivo.usar',
      tabelas: [TABELA_CREDENCIAL_DISPOSITIVO],
      entrada: ENTRADA,
      gravar: async (tx) => {
        const [d] = await tx.consultarParaAtualizar(
          'SELECT id, versao, contador_assinatura, revogada_em FROM credencial_dispositivo WHERE id = ?',
          [id],
          { teto: 1 },
        );
        if (!d || d['revogada_em'] != null)
          throw recusa('dispositivo-inexistente', 'O dispositivo foi removido.');
        const atual = Number(d['contador_assinatura']);
        if ((contador !== 0 || atual !== 0) && contador <= atual)
          throw recusa(
            'contador-regrediu',
            'O contador do dispositivo regrediu: a credencial pode ter sido copiada.',
          );
        await tx.alterar(TABELA_CREDENCIAL_DISPOSITIVO, id, Number(d['versao']), {
          contador_assinatura: contador,
          ultimo_uso_em: new Date(),
        });
        return { id };
      },
      alvo: () => ({ tabela: TABELA_CREDENCIAL_DISPOSITIVO, id }),
      trilha: () => ({
        dados: {
          evento: 'acesso.dispositivo.usado',
          recurso: 'acesso.sessao',
          operacao: 'acesso.dispositivo.usar',
          resultado: 'sucesso',
          estacao: a.estacao,
          diferenca: null,
        },
      }),
    });
    await this.executar(a, 'dispositivo-usar', op, { login: a.login, id, contador });
  }
}

/** As cerimônias (desafio no armazém de sessões; conferência no domínio; gravação na porta). */
export class ServicoDispositivoSegundoFator {
  private readonly servidor: string;
  private readonly origem: string;

  constructor(
    private readonly porta: CredencialDispositivoPropria,
    private readonly armazem: ArmazemSessao,
    urlPublica: string,
    private readonly nomeServidor = 'Sistema hospitalar',
  ) {
    const s = servidorDaUrlPublica(urlPublica);
    this.servidor = s.servidor;
    this.origem = s.origem;
  }

  private chave(tipo: 'cadastro' | 'validacao', sessao: string): string {
    return `webauthn:${tipo}:${createHash('sha256').update(sessao).digest('hex')}`;
  }

  private expectativa(desafio: string) {
    return { desafio, origens: [this.origem], servidor: this.servidor, exigirVerificacaoUsuario: true };
  }

  private async desafioGuardado(
    tipo: 'cadastro' | 'validacao',
    sessao: string,
    login: string,
  ): Promise<string> {
    const bruto = await this.armazem.consumir(this.chave(tipo, sessao));
    const [quem, desafio] = (bruto ?? '').split(' ');
    if (!desafio || quem !== login) throw recusa('desafio-incorreto', 'A tentativa expirou: comece de novo.');
    return desafio;
  }

  listar(a: AtorDispositivo): Promise<DispositivoTela[]> {
    return this.porta.listar(a);
  }

  revogar(a: AtorDispositivo, id: number): Promise<void> {
    return this.porta.revogar(a, id);
  }

  async iniciarCadastro(sessao: string, a: AtorDispositivo, nomeExibicao: string) {
    const usuario = await this.porta.idUsuario(a);
    if (usuario === null) throw recusa('usuario-inexistente', 'A conta não existe neste cliente.');
    const existentes = await this.porta.ativas(a);
    const desafio = gerarDesafioWebAuthn();
    await this.armazem.gravar(
      this.chave('cadastro', sessao),
      `${a.login} ${desafio}`,
      VALIDADE_DESAFIO_SEGUNDOS,
    );
    // Identificador opaco da conta: resumo do cliente + id (nenhum dado pessoal vai ao dispositivo além do login).
    const idUsuario = createHash('sha256')
      .update(`${a.rede}:${usuario}`)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    return opcoesCadastroCredencial({
      desafio,
      servidor: this.servidor,
      nomeServidor: this.nomeServidor,
      idUsuario,
      login: a.login,
      nomeExibicao,
      existentes: existentes.map((c) => c.idCredencial),
    });
  }

  async concluirCadastro(sessao: string, a: AtorDispositivo, r: RespostaCadastro, nome: string) {
    const desafio = await this.desafioGuardado('cadastro', sessao, a.login);
    const c = paraRecusa(() => conferirCadastroCredencial(r, this.expectativa(desafio)));
    return this.porta.incluir(a, c, nome);
  }

  async iniciarValidacao(sessao: string, a: AtorDispositivo) {
    const ativas = await this.porta.ativas(a);
    if (ativas.length === 0) throw recusa('sem-dispositivo', 'A conta não tem dispositivo cadastrado.');
    const desafio = gerarDesafioWebAuthn();
    await this.armazem.gravar(
      this.chave('validacao', sessao),
      `${a.login} ${desafio}`,
      VALIDADE_DESAFIO_SEGUNDOS,
    );
    return opcoesValidacaoCredencial({
      desafio,
      servidor: this.servidor,
      credenciais: ativas.map((c) => c.idCredencial),
    });
  }

  /** Confere a assinatura do dispositivo; aceita, grava o contador. Devolve o id do dispositivo usado. */
  async concluirValidacao(sessao: string, a: AtorDispositivo, r: RespostaValidacao): Promise<{ id: number }> {
    const desafio = await this.desafioGuardado('validacao', sessao, a.login);
    const guardada = (await this.porta.ativas(a)).find((c) => c.idCredencial === r.idCredencial);
    if (!guardada) throw recusa('dispositivo-inexistente', 'O dispositivo não está cadastrado nesta conta.');
    const v = paraRecusa(() => conferirValidacaoCredencial(r, this.expectativa(desafio), guardada));
    await this.porta.registrarUso(a, guardada.id, v.contador);
    return { id: guardada.id };
  }
}

function paraRecusa<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErroWebAuthn) throw recusa(e.codigo, e.message);
    throw e;
  }
}
