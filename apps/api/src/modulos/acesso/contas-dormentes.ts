// W1-01 (parte 9a): a ROTINA DAS CONTAS DORMENTES. Lê as contas ativas e livres com a última conexão, as exceções
// justificadas vigentes, os gestores de acessos ativos e os parâmetros do estabelecimento; avalia pela regra pura
// (avaliarDormencia, @sgh/dominio-acesso) e bloqueia cada conta dormente pelo executor do M04 (acesso.bloquearUsuario,
// uma transação por conta). Cada bloqueio e a rodada vão à trilha (quem: o responsável da rotina;
// o que: dias sem acesso e o limite; nunca senha nem dado de pessoa). O gestor recebe o aviso com o resumo (bloqueadas,
// poupadas e falhas). O relógio é injetado (`agora`): os testes simulam o tempo. Uma rodada por estabelecimento de cada vez.
import {
  avaliarDormencia,
  type AvaliacaoDormencia,
  type ContaDormenciaLida,
  type ContaDormente,
  type ExcecaoDormenciaVigente,
  type ParametrosDormencia,
} from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';

export const OPERACAO_BLOQUEIO_DORMENTE = 'acesso.bloquearUsuario';
export const EVENTO_DORMENTE_BLOQUEADA = 'acesso.conta-dormente.bloqueada';
export const EVENTO_DORMENCIA_RODADA = 'acesso.contas-dormentes.rodada';
const FUSO = 'America/Sao_Paulo';

export interface LinhaTrilhaDormencia {
  readonly evento: string;
  readonly login: string | null;
  readonly resultado: 'sucesso' | 'falha';
  readonly diferenca: string;
}

/**
 * Quem e como a rotina executa o bloqueio: o responsável (login do gestor de acessos), a correlação da rodada e a chave
 * de idempotência por conta (a rodada repetida no mesmo dia não bloqueia duas vezes).
 */
export interface ContextoRotinaDormencia {
  readonly rede: string;
  readonly hospital: string;
  readonly responsavel: string;
  readonly chaveIdempotencia: string;
  readonly correlacao: string;
  readonly estacao: string;
}

export interface PortaDormencia {
  contas(rede: string, hospital: string): Promise<ContaDormenciaLida[]>;
  excecoes(rede: string, hospital: string): Promise<ExcecaoDormenciaVigente[]>;
  gestoresAtivos(rede: string, hospital: string): Promise<string[]>;
  parametros(rede: string, hospital: string): Promise<ParametrosDormencia>;
  receita(nome: string, hospital: string): { readonly ligada: boolean; readonly motivo: string | null };
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoRotinaDormencia): Promise<void>;
  trilha(rede: string, hospital: string, l: LinhaTrilhaDormencia, correlacao: string): Promise<void>;
}

export interface AvisoDormencia {
  readonly rede: string;
  readonly hospital: string;
  readonly hoje: string;
  readonly bloqueadas: readonly ContaDormente[];
  readonly poupadas: readonly ContaDormente[];
  readonly falhas: readonly { login: string; codigo: string }[];
}

export interface DependenciasDormencia {
  readonly porta: PortaDormencia;
  /** Aviso ao gestor de acessos do estabelecimento (só logins, dias e situação). */
  readonly avisar?: (a: AvisoDormencia) => Promise<void>;
  readonly agora?: () => number;
  /** O login que responde pela rotina na trilha e no executor (o gestor que a configurou). */
  readonly responsavel: (rede: string, hospital: string) => Promise<string | null>;
}

export interface ResultadoRodadaDormencia {
  readonly hospital: string;
  readonly hoje: string;
  readonly ligada: boolean;
  /** Por que nada foi bloqueado (rotina desligada, operação desligada, sem responsável); null se rodou. */
  readonly motivo: string | null;
  readonly bloqueadas: ContaDormente[];
  readonly poupadas: ContaDormente[];
  readonly falhas: { login: string; codigo: string }[];
}

export class ServicoContasDormentes {
  private readonly emRodada = new Set<string>();

  constructor(private readonly d: DependenciasDormencia) {}

  hoje(): string {
    const agora = this.d.agora ? this.d.agora() : Date.now();
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(agora));
  }

  /** O estado da operação de bloqueio no estabelecimento (para a tela: a rodada diz por que não bloqueou). */
  bloqueio(hospital: string): { readonly ligada: boolean; readonly motivo: string | null } {
    return this.d.porta.receita(OPERACAO_BLOQUEIO_DORMENTE, hospital);
  }

  /** A avaliação sem gravar nada (tela do gestor: quem cairia hoje e por quê). */
  async previa(rede: string, hospital: string): Promise<AvaliacaoDormencia> {
    const [contas, excecoes, gestores, p] = await Promise.all([
      this.d.porta.contas(rede, hospital),
      this.d.porta.excecoes(rede, hospital),
      this.d.porta.gestoresAtivos(rede, hospital),
      this.d.porta.parametros(rede, hospital),
    ]);
    return avaliarDormencia(contas, this.hoje(), p, excecoes, gestores);
  }

  /** Uma rodada: avalia e bloqueia pelo executor (uma transação por conta); a falha de uma não para as outras. */
  async rodada(rede: string, hospital: string): Promise<ResultadoRodadaDormencia> {
    const chave = `${rede}|${hospital}`;
    if (this.emRodada.has(chave)) throw new Error('rodada-em-andamento');
    this.emRodada.add(chave);
    try {
      return await this.rodar(rede, hospital);
    } finally {
      this.emRodada.delete(chave);
    }
  }

  private async rodar(rede: string, hospital: string): Promise<ResultadoRodadaDormencia> {
    const a = await this.previa(rede, hospital);
    const correlacao = `dormentes-${hospital}-${a.hoje}`;
    const base = { hospital, hoje: a.hoje, poupadas: a.poupadas, bloqueadas: [], falhas: [] };
    let motivo: string | null = null;
    const responsavel = await this.d.responsavel(rede, hospital).catch(() => null);
    const receita = this.d.porta.receita(OPERACAO_BLOQUEIO_DORMENTE, hospital);
    if (!a.parametros.ligada) motivo = 'Rotina desligada no estabelecimento (acesso.contasDormentes.ligada).';
    else if (!receita.ligada)
      motivo = receita.motivo ?? 'Bloqueio de usuário desligado neste estabelecimento.';
    else if (!responsavel) motivo = 'Sem gestor de acessos ativo para responder pela rotina.';
    if (motivo) {
      const r = { ...base, ligada: false, motivo };
      await this.registrarRodada(rede, hospital, r, correlacao, a.previa.length);
      return r;
    }
    const bloqueadas: ContaDormente[] = [];
    const falhas: { login: string; codigo: string }[] = [];
    for (const c of a.bloquear) {
      try {
        await this.d.porta.executar(
          OPERACAO_BLOQUEIO_DORMENTE,
          hospital,
          { login: c.login },
          {
            rede,
            hospital,
            responsavel: responsavel!,
            chaveIdempotencia: `${correlacao}-${c.login}`.slice(0, 80),
            correlacao: correlacao.slice(0, 64),
            estacao: 'rotina-contas-dormentes',
          },
        );
        bloqueadas.push(c);
        await this.d.porta
          .trilha(
            rede,
            hospital,
            {
              evento: EVENTO_DORMENTE_BLOQUEADA,
              login: c.login,
              resultado: 'sucesso',
              diferenca: `conta ${c.tipo} sem acesso há ${c.diasSemAcesso} dias (último: ${c.ultimoAcesso}); limite: ${c.limiteDias}`,
            },
            correlacao,
          )
          .catch(() => undefined);
      } catch (e) {
        const codigo =
          e instanceof ErroOperacao ? (e.problema.codigo ?? `erro-${e.problema.status}`) : 'erro-inesperado';
        falhas.push({ login: c.login, codigo });
        await this.d.porta
          .trilha(
            rede,
            hospital,
            {
              evento: EVENTO_DORMENTE_BLOQUEADA,
              login: c.login,
              resultado: 'falha',
              diferenca: `falha: ${codigo}`,
            },
            correlacao,
          )
          .catch(() => undefined);
      }
    }
    const r = { ...base, ligada: true, motivo: null, bloqueadas, falhas };
    await this.registrarRodada(rede, hospital, r, correlacao, a.previa.length);
    if (bloqueadas.length || falhas.length || a.poupadas.length)
      await this.d
        .avisar?.({ rede, hospital, hoje: a.hoje, bloqueadas, poupadas: a.poupadas, falhas })
        .catch(() => undefined);
    return r;
  }

  private async registrarRodada(
    rede: string,
    hospital: string,
    r: ResultadoRodadaDormencia,
    correlacao: string,
    dormentes: number,
  ): Promise<void> {
    const excecoes = r.poupadas.filter((p) => p.situacao === 'excecao').length;
    await this.d.porta
      .trilha(
        rede,
        hospital,
        {
          evento: EVENTO_DORMENCIA_RODADA,
          login: null,
          resultado: r.falhas.length ? 'falha' : 'sucesso',
          diferenca: (r.motivo
            ? `não bloqueou: ${r.motivo}; dormentes: ${dormentes}`
            : `dormentes: ${dormentes}; bloqueadas: ${r.bloqueadas.length}; falhas: ${r.falhas.length}; poupadas por exceção: ${excecoes}`
          ).slice(0, 400),
        },
        correlacao,
      )
      .catch(() => undefined);
  }
}

export const SERVICO_CONTAS_DORMENTES = Symbol('SERVICO_CONTAS_DORMENTES');
/** O despertar confere a cada hora; cada estabelecimento roda no máximo uma vez por dia (fuso de São Paulo). */
export const INTERVALO_DESPERTAR_DORMENTES_MS = 60 * 60_000;

/**
 * W1-01 (parte 9b): o DESPERTAR DIÁRIO da rotina (modelo: a vigia de reconciliação do W0-02). A cada hora, para cada
 * estabelecimento configurado que ainda não rodou hoje, uma rodada; com o parâmetro acesso.contasDormentes.ligada
 * desligado, nada é gravado (nem a trilha da rodada: a rodada manual pela tela registra o motivo). Uma passada de cada
 * vez; a falha de um estabelecimento não para os outros nem derruba a API.
 */
export class DespertarContasDormentes {
  private timer: ReturnType<typeof setInterval> | null = null;
  private emPassada = false;
  private readonly rodouEm = new Map<string, string>();

  constructor(
    private readonly servico: ServicoContasDormentes,
    private readonly porta: Pick<PortaDormencia, 'parametros'>,
    private readonly rede: string,
    private readonly hospitais: readonly string[],
  ) {}

  /** Uma passada: roda nos estabelecimentos ligados que ainda não rodaram hoje. */
  async passada(): Promise<ResultadoRodadaDormencia[]> {
    if (this.emPassada) return [];
    this.emPassada = true;
    try {
      const hoje = this.servico.hoje();
      const r: ResultadoRodadaDormencia[] = [];
      for (const h of this.hospitais) {
        if (this.rodouEm.get(h) === hoje) continue;
        try {
          const p = await this.porta.parametros(this.rede, h);
          this.rodouEm.set(h, hoje);
          if (!p.ligada) continue;
          r.push(await this.servico.rodada(this.rede, h));
        } catch {
          // a próxima passada do dia não repete: o gestor vê a prévia e pode rodar pela tela.
        }
      }
      return r;
    } finally {
      this.emPassada = false;
    }
  }

  iniciar(intervaloMs = INTERVALO_DESPERTAR_DORMENTES_MS): void {
    if (this.timer || this.hospitais.length === 0) return;
    this.timer = setInterval(() => void this.passada(), intervaloMs);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get ligadoODespertar(): boolean {
    return this.timer !== null;
  }
}
