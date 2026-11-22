// Porta do portal do médico externo em memória (sessão sintética de dev/ci, E2E): o corpo clínico SINTÉTICO (um
// cirurgião com três registros: o de cirurgião da agenda sintética do M18, o de prestador do repasse sintético do M33 e
// o do número do conselho de um solicitante sintético do M26) e o vínculo das contas, com as mesmas recusas do banco.
// A situação da conta vem da porta do M26 (a mesma memória do portal de resultados). Nada vai à cópia.
import { recusa } from '@sgh/nucleo';
import { cboDe } from '../pep/registro-porta-memoria.js';
import type {
  AtoContaMedicoRegistrado,
  ContextoPortalMedico,
  GravadorPortalMedico,
  NotificacaoCriticoMedico,
  PortaPortalMedico,
  ProfissionalCorpoClinico,
  TrilhaPortalMedico,
  TrocaEmailMedico,
  VinculoMedicoExterno,
} from './porta.js';
import { conferirAtoContaMedico } from './regras-conta.js';

/** O corpo clínico sintético (o profissional e as inscrições no conselho). */
export const CORPO_CLINICO_SINTETICO: readonly ProfissionalCorpoClinico[] = [
  {
    id: 6801,
    nome: 'CIRURGIAO SINTETICO A',
    registros: [
      // O cirurgião da agenda sintética do bloco (M18: ID_CRM 5001, CRM 9001).
      { id: 5001, codigo: 9001, uf: 'SP', numero: '9001' },
      // O prestador do repasse sintético (M33: código 7001).
      { id: 5101, codigo: 7001, uf: 'SP', numero: '7001' },
      // O número do conselho do solicitante sintético 54321/SP (M26): o registro que vai no pedido de cirurgia.
      { id: 5102, codigo: 54321, uf: 'SP', numero: '54321' },
    ],
    vinculoAssistencial: [5001, 5101, 5102],
  },
  {
    id: 6802,
    nome: 'OUTRA MEDICA SINTETICA B',
    registros: [{ id: 5106, codigo: 88888, uf: 'SP', numero: '88888' }],
    vinculoAssistencial: [5106],
  },
  // W0-10 (E2E de "meus pacientes", do crítico e da assinatura remota): o clínico cujo registro é o do médico sintético
  // interno SINT.MEDICO na memória do PEP (cboDe): o que esse login registra no episódio vira vínculo assistencial dele.
  {
    id: 6803,
    nome: 'CLINICO SINTETICO C',
    registros: [{ id: cboDe('SINT.MEDICO')!, codigo: 66013, uf: 'SP', numero: '66013' }],
    vinculoAssistencial: [cboDe('SINT.MEDICO')!],
  },
];

type SituacaoDaConta = (c: ContextoPortalMedico, acesso: number) => Promise<string | null>;
/** W0-10: muda a situação da conta na memória do M26 (a mesma que o login do portal lê). */
type DefinirSituacao = (c: ContextoPortalMedico, acesso: number, situacao: string) => void;
/** W0-10: muda a senha (resumo) ou o e-mail da conta na memória do M26. */
type DefinirCredencial = (
  c: ContextoPortalMedico,
  acesso: number,
  x: { senhaResumo?: string; email?: string },
) => void;

export class PortaPortalMedicoMemoria implements PortaPortalMedico {
  readonly destino = 'memoria' as const;
  /** Linhas da trilha "gravadas" (os testes conferem o evento e o alvo). */
  readonly trilhas: TrilhaPortalMedico[] = [];
  private readonly vinculosPorHospital = new Map<string, Map<number, VinculoMedicoExterno>>();
  private readonly atos: (AtoContaMedicoRegistrado & { hospital: string; acesso: number })[] = [];
  private proximoAto = 1;
  private readonly trocas: (TrocaEmailMedico & { hospital: string; tokenResumo: string })[] = [];
  /** W0-10 (M5): as notificações de crítico (uma por aviso e conta). */
  private readonly notificacoes: (NotificacaoCriticoMedico & { hospital: string; acesso: number })[] = [];

  constructor(
    private readonly situacao: SituacaoDaConta,
    private readonly agora: () => Date = () => new Date(),
    private readonly definirSituacao: DefinirSituacao | null = null,
    private readonly definirCredencial: DefinirCredencial | null = null,
  ) {}

  /** O ato sem motivo (troca de senha ou de e-mail) no histórico da conta. */
  private atoDeTroca(
    c: ContextoPortalMedico,
    acesso: number,
    ato: 'troca-senha' | 'troca-email',
    por: string,
  ) {
    const id = this.proximoAto++;
    this.atos.push({
      id,
      hospital: c.hospital,
      acesso,
      ato,
      situacaoAnterior: 'ativo',
      motivo: null,
      pedidosPendentes: 0,
      decisaoPedidos: null,
      usuario: por,
      em: this.agora().toISOString().slice(0, 19),
    });
    return id;
  }

  private credencial(c: ContextoPortalMedico, acesso: number, x: { senhaResumo?: string; email?: string }) {
    if (!this.definirCredencial) throw new Error('memória sem a credencial da conta do M26');
    this.definirCredencial(c, acesso, x);
  }

  private v(c: ContextoPortalMedico): Map<number, VinculoMedicoExterno> {
    let m = this.vinculosPorHospital.get(c.hospital);
    if (!m) {
      m = new Map();
      this.vinculosPorHospital.set(c.hospital, m);
    }
    return m;
  }

  async gravar<T>(
    c: ContextoPortalMedico,
    fn: (g: GravadorPortalMedico) => Promise<T>,
    trilha: TrilhaPortalMedico | null,
  ): Promise<T> {
    const m = this.v(c);
    const r = await fn({
      vincular: async (x) => {
        const p = CORPO_CLINICO_SINTETICO.find((y) => y.id === x.profissional);
        if (!p || p.registros.length === 0)
          throw recusa('profissional-sem-registro', 'O profissional não tem registro no corpo clínico.', {
            campos: ['profissional'],
          });
        // Só a conta vigente prende o profissional (a desligada tem profissional null; a encerrada não conta).
        const outras = [...m.values()].filter(
          (y) => y.profissional === x.profissional && y.acesso !== x.acesso,
        );
        const vigentes = await Promise.all(
          outras.map(async (y) => (await this.situacao(c, y.acesso)) !== 'encerrado'),
        );
        if (vigentes.some(Boolean))
          throw recusa(
            'profissional-em-outra-conta',
            'O profissional já está ligado a outra conta do portal.',
            {
              campos: ['profissional'],
            },
          );
        if ((await this.situacao(c, x.acesso)) !== 'ativo')
          throw recusa('conta-inativa', 'A conta do portal não está ativa.');
        m.set(x.acesso, {
          acesso: x.acesso,
          profissional: x.profissional,
          vinculadoPor: x.por,
          vinculadoEm: this.agora().toISOString().slice(0, 19),
        });
      },
      desvincular: async (x) => {
        const atual = m.get(x.acesso);
        if (!atual || atual.profissional === null)
          throw recusa('sem-vinculo', 'A conta do portal não está ligada a um profissional.');
        m.set(x.acesso, {
          ...atual,
          profissional: null,
          vinculadoPor: x.por,
          vinculadoEm: this.agora().toISOString().slice(0, 19),
        });
      },
      atoConta: async (x) => {
        const anterior = await this.situacao(c, x.acesso);
        if (anterior === null) throw recusa('conta-inexistente', 'A conta do portal não existe.');
        const situacao = conferirAtoContaMedico(anterior, x);
        if (!this.definirSituacao) throw new Error('memória sem a situação da conta do M26');
        this.definirSituacao(c, x.acesso, situacao);
        const id = this.proximoAto++;
        this.atos.push({
          id,
          hospital: c.hospital,
          acesso: x.acesso,
          ato: x.ato,
          situacaoAnterior: anterior,
          motivo: x.motivo.trim(),
          pedidosPendentes: x.pedidosPendentes,
          decisaoPedidos: x.pedidosPendentes > 0 ? x.decisaoPedidos : null,
          usuario: x.por,
          em: this.agora().toISOString().slice(0, 19),
        });
        return { situacao, anterior, id };
      },
      trocarSenha: async (x) => {
        if ((await this.situacao(c, x.acesso)) !== 'ativo')
          throw recusa('conta-nao-ativa', 'Só a conta ativa troca a senha.');
        this.credencial(c, x.acesso, { senhaResumo: x.senhaResumo });
        return { id: this.atoDeTroca(c, x.acesso, 'troca-senha', x.por) };
      },
      pedirTrocaEmail: async (x) => {
        for (const t of this.trocas)
          if (t.hospital === c.hospital && t.acesso === x.acesso && t.situacao === 'pendente')
            Object.assign(t, { situacao: 'cancelada' });
        const id = this.trocas.length + 1;
        this.trocas.push({
          id,
          hospital: c.hospital,
          acesso: x.acesso,
          emailNovo: x.emailNovo,
          tokenResumo: x.tokenResumo,
          validoAte: x.validoAte,
          envio: x.envio,
          situacao: 'pendente',
        });
        return { id };
      },
      cancelarTrocaEmail: async (troca) => {
        const t = this.trocas.find((y) => y.hospital === c.hospital && y.id === troca);
        if (!t || t.situacao !== 'pendente')
          throw recusa('troca-nao-pendente', 'O pedido de troca do e-mail não está mais pendente.');
        Object.assign(t, { situacao: 'cancelada' });
      },
      confirmarTrocaEmail: async (x) => {
        const t = this.trocas.find((y) => y.hospital === c.hospital && y.tokenResumo === x.tokenResumo);
        if (!t || t.situacao !== 'pendente' || t.validoAte <= x.agora)
          throw recusa(
            'link-invalido',
            'Este link de confirmação não vale mais. Peça a troca do e-mail de novo.',
          );
        if ((await this.situacao(c, t.acesso)) !== 'ativo')
          throw recusa('conta-nao-ativa', 'Só a conta ativa troca o e-mail.');
        this.credencial(c, t.acesso, { email: t.emailNovo });
        Object.assign(t, { situacao: 'confirmada' });
        return {
          acesso: t.acesso,
          emailNovo: t.emailNovo,
          id: this.atoDeTroca(c, t.acesso, 'troca-email', x.por),
        };
      },
      notificarCritico: async (x) => {
        if (x.envio === 'desligado' && !x.motivo?.trim())
          throw recusa('motivo-obrigatorio', 'A notificação desligada guarda o motivo.');
        if (
          this.notificacoes.some(
            (y) => y.hospital === c.hospital && y.aviso === x.aviso && y.acesso === x.acesso,
          )
        )
          return false;
        this.notificacoes.push({
          hospital: c.hospital,
          acesso: x.acesso,
          aviso: x.aviso,
          envio: x.envio,
          motivo: x.motivo,
          em: this.agora().toISOString().slice(0, 19),
        });
        return true;
      },
    });
    if (trilha) this.trilhas.push(trilha);
    return r;
  }

  async registrarLeitura(_c: ContextoPortalMedico, trilha: TrilhaPortalMedico): Promise<void> {
    this.trilhas.push(trilha);
  }

  async vinculos(c: ContextoPortalMedico, acessos: readonly number[]) {
    const m = this.v(c);
    return new Map(
      acessos.filter((a) => m.has(a)).map((a) => [a, { ...(m.get(a) as VinculoMedicoExterno) }]),
    );
  }

  async trocaEmailPendente(c: ContextoPortalMedico, acesso: number): Promise<TrocaEmailMedico | null> {
    const t = this.trocas.findLast(
      (y) => y.hospital === c.hospital && y.acesso === acesso && y.situacao === 'pendente',
    );
    return t ? this.semToken(t) : null;
  }

  async trocaEmailPorToken(c: ContextoPortalMedico, tokenResumo: string): Promise<TrocaEmailMedico | null> {
    const t = this.trocas.find((y) => y.hospital === c.hospital && y.tokenResumo === tokenResumo);
    return t ? this.semToken(t) : null;
  }

  private semToken(t: TrocaEmailMedico): TrocaEmailMedico {
    return {
      id: t.id,
      acesso: t.acesso,
      emailNovo: t.emailNovo,
      validoAte: t.validoAte,
      envio: t.envio,
      situacao: t.situacao,
    };
  }

  async notificacoesCritico(c: ContextoPortalMedico, acesso: number): Promise<NotificacaoCriticoMedico[]> {
    return this.notificacoes
      .filter((y) => y.hospital === c.hospital && y.acesso === acesso)
      .reverse()
      .map((y) => ({ aviso: y.aviso, envio: y.envio, motivo: y.motivo, em: y.em }));
  }

  async atosConta(c: ContextoPortalMedico, acesso: number): Promise<AtoContaMedicoRegistrado[]> {
    return this.atos
      .filter((a) => a.hospital === c.hospital && a.acesso === acesso)
      .reverse()
      .map((a) => ({
        id: a.id,
        ato: a.ato,
        situacaoAnterior: a.situacaoAnterior,
        motivo: a.motivo,
        pedidosPendentes: a.pedidosPendentes,
        decisaoPedidos: a.decisaoPedidos,
        usuario: a.usuario,
        em: a.em,
      }));
  }

  /** W0-10 (M6): o login do sistema de cada profissional sintético (o autor dos documentos a assinar). */
  readonly loginsDoProfissional = new Map<number, string>([
    [6801, 'CIRURGIAO.SINTETICO'],
    [6803, 'SINT.MEDICO'],
  ]);

  async loginDoProfissional(_c: ContextoPortalMedico, profissional: number) {
    return this.loginsDoProfissional.get(profissional) ?? null;
  }

  async profissional(_c: ContextoPortalMedico, id: number) {
    return CORPO_CLINICO_SINTETICO.find((p) => p.id === id) ?? null;
  }

  async profissionais(_c: ContextoPortalMedico, ids: readonly number[]) {
    return new Map(CORPO_CLINICO_SINTETICO.filter((p) => ids.includes(p.id)).map((p) => [p.id, p]));
  }

  async donosDosCodigos(_c: ContextoPortalMedico, codigos: readonly number[]) {
    const m = new Map<number, Set<number>>();
    for (const p of [...CORPO_CLINICO_SINTETICO, ...this.registrosAvulsos])
      for (const r of p.registros as readonly { codigo: number }[])
        if (codigos.includes(r.codigo)) m.set(r.codigo, (m.get(r.codigo) ?? new Set()).add(p.id));
    return m;
  }

  /** Registros de outros profissionais (os testes simulam o código do conselho repetido). */
  readonly registrosAvulsos: ProfissionalCorpoClinico[] = [];

  async sugestoesEmLote(c: ContextoPortalMedico, pares: readonly { uf: string; numero: number }[]) {
    const m = new Map<string, { id: number; nome: string }[]>();
    for (const x of pares) m.set(`${x.uf}:${x.numero}`, await this.sugestoes(c, x.uf, x.numero));
    return m;
  }

  async sugestoes(_c: ContextoPortalMedico, uf: string, numero: number) {
    return CORPO_CLINICO_SINTETICO.filter((p) =>
      p.registros.some((r) => r.codigo === numero && r.uf === uf),
    ).map((p) => ({ id: p.id, nome: p.nome }));
  }

  async buscarProfissionais(_c: ContextoPortalMedico, texto: string) {
    const t = texto.trim().toUpperCase();
    if (t.length < 3) return [];
    return CORPO_CLINICO_SINTETICO.filter((p) => p.nome.startsWith(t)).map((p) => ({
      id: p.id,
      nome: p.nome,
    }));
  }
}
