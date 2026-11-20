// A porta do saneamento (M59-F4) na fonte SINTÉTICA do dev/ci (nada na cópia): os grupos, as opções e os usuários vêm
// AO VIVO do estado sintético do acesso (estado-sintetico.ts), o mesmo em que a gestão em memória grava as receitas do
// M10 (troca de grupo, bloqueio, retirada das opções). Assim o que o saneamento aplica aparece no painel e nas
// permissões efetivas, como no banco. O plano e o uso das opções ficam na porta em memória (a base desta classe).
// Massa própria e só sintética: dois grupos de acesso amplo sem outro uso nos testes (MASTER_SEM_FINANCEIRO, com dois
// usuários, e MASTER_CONSULTA_FINANCEIRO, sem ativos: o que se dissolve) e o uso das opções nos últimos 180 dias.
import type { UsuarioGrupoLido } from '@sgh/legado';
import { CONTAS_SINTETICAS, estadoAcessoSintetico } from '../fonte-sintetica.js';
import type { EstadoAcessoSintetico } from '../estado-sintetico.js';
import { PortaSaneamentoMemoria } from './porta-memoria.js';
import type { GrupoComOpcoes } from './porta.js';

/** As opções do MASTER_SEM_FINANCEIRO sintético: as dos grupos sintéticos ANESTESIA, COORD_ENFERMAGEM e ENFERMAGEM e mais uma. */
const OPCOES_MSF = [6813, 6814, 6829, 2227, 2293, 5056, 5059, 2582, 1169];
/** O grupo sem ativos (o que se dissolve): duas opções. */
const OPCOES_MCF = [1169, 2324];

/** Usuários sintéticos do saneamento (não entram no sistema: são só alvos da decisão). */
export const ALVOS_SANEAMENTO_SINTETICOS = {
  /** Usa opções de ANESTESIA e uma de COORD_ENFERMAGEM: a troca para ANESTESIA perde opção usada (exige aprovação). */
  emUso: 'SINT.SANEAR.ALVO1',
  /** Não entra há mais de 180 dias e não usa nada: o candidato ao bloqueio. */
  semUso: 'SINT.SANEAR.ALVO2',
} as const;

const DIA = 86_400_000;

interface AlvoSintetico {
  readonly id: number;
  readonly nome: string;
  readonly diasSemAcesso: number;
  readonly uso: Readonly<Record<number, number>>;
}

const ALVOS: Readonly<Record<string, AlvoSintetico>> = {
  [ALVOS_SANEAMENTO_SINTETICOS.emUso]: {
    id: 990_591,
    nome: 'Usuário sintético do saneamento 1',
    diasSemAcesso: 2,
    uso: { 6813: 41, 6814: 12, 5056: 7 },
  },
  [ALVOS_SANEAMENTO_SINTETICOS.semUso]: {
    id: 990_592,
    nome: 'Usuário sintético do saneamento 2',
    diasSemAcesso: 240,
    uso: {},
  },
};

/** Semeia, uma vez por estado, os grupos e os alvos sintéticos do saneamento. */
function semear(e: EstadoAcessoSintetico): void {
  if (!e.grupos.has('MASTER_SEM_FINANCEIRO')) {
    e.grupos.set('MASTER_SEM_FINANCEIRO', true);
    e.opcoesGrupo.set('MASTER_SEM_FINANCEIRO', new Set(OPCOES_MSF));
  }
  if (!e.grupos.has('MASTER_CONSULTA_FINANCEIRO')) {
    e.grupos.set('MASTER_CONSULTA_FINANCEIRO', true);
    e.opcoesGrupo.set('MASTER_CONSULTA_FINANCEIRO', new Set(OPCOES_MCF));
  }
  for (const [login, a] of Object.entries(ALVOS))
    if (!e.contas.has(login))
      e.contas.set(login, {
        id: a.id,
        grupo: 'MASTER_SEM_FINANCEIRO',
        papeis: new Map([[4, true]]),
        flags: [],
        conselho: false,
      });
}

export class PortaSaneamentoSintetica extends PortaSaneamentoMemoria {
  constructor(
    private readonly estado: () => EstadoAcessoSintetico = estadoAcessoSintetico,
    private readonly agora: () => number = () => Date.now(),
  ) {
    super(agora);
  }

  private e(): EstadoAcessoSintetico {
    const e = this.estado();
    semear(e);
    return e;
  }

  /** As contas do estado como o legado as lê (ativo, bloqueio e a última entrada). */
  private lidos(): UsuarioGrupoLido[] {
    const e = this.e();
    const hoje = this.agora();
    return [...e.contas].map(([login, c]) => {
      const alvo = ALVOS[login];
      const conta = CONTAS_SINTETICAS[login];
      return {
        login,
        idUsuario: c.id,
        nome: alvo?.nome ?? 'Usuário sintético (desenvolvimento)',
        grupo: c.grupo,
        ativo: conta?.ativo ?? true,
        bloqueado: e.bloqueio.get(login) ?? conta?.bloqueado ?? false,
        ultimoAcesso: new Date(hoje - (alvo?.diasSemAcesso ?? 1) * DIA).toISOString().slice(0, 10),
      };
    });
  }

  private sincronizar(): void {
    this.usuariosMem.clear();
    for (const u of this.lidos()) {
      this.usuariosMem.set(u.login, u);
      if (!this.usoMem.has(u.login))
        this.usoMem.set(
          u.login,
          new Map(Object.entries(ALVOS[u.login]?.uso ?? {}).map(([k, v]) => [Number(k), v])),
        );
    }
    this.gruposMem.clear();
    const e = this.e();
    for (const [g, ativo] of e.grupos)
      this.gruposMem.set(g, { ativo, opcoes: new Set(e.opcoesGrupo.get(g)) });
  }

  override async grupos(h: string, nomes: readonly string[]) {
    this.sincronizar();
    return super.grupos(h, nomes);
  }

  override async usuarios(h: string, grupo: string) {
    this.sincronizar();
    return super.usuarios(h, grupo);
  }

  override async usuario(h: string, login: string) {
    this.sincronizar();
    return super.usuario(h, login);
  }

  override async gruposComOpcoes(): Promise<GrupoComOpcoes[]> {
    this.sincronizar();
    return super.gruposComOpcoes();
  }
}
