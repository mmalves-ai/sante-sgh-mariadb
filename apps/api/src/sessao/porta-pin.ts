// W1-01 (parte 11b2): a PORTA do PIN da troca rápida. Tipos neutros e as portas sem banco: memória (dev/ci, com as
// mesmas regras: uma linha viva por usuário, encerrada sem o hash) e indisponível. A gravação sobre o banco do cliente
// (tabela pin_troca_rapida) é a PortaPinPropria, em porta-pin-propria.ts. Só o hash Argon2id (PHC, feito pelo servidor) passa por aqui; o PIN em claro nunca.
import { recusa } from '@sgh/nucleo';

/** Linha da trilha de um evento do PIN (quem, onde, o quê), sem a tabela-alvo nem a diferença. */
export interface TrilhaPin {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly resultado: string;
  readonly estacao: string | null;
  readonly correlacao: string;
}

/** Situação do PIN para tela e regra (sem o hash). */
export interface SituacaoPinLida {
  readonly definido: boolean;
  readonly bloqueado: boolean;
  readonly falhas: number;
  readonly criadoEm: Date | null;
  readonly bloqueadoEm: Date | null;
}

/** O PIN vivo com o hash, só para a conferência no servidor. */
export interface PinVivoLido extends SituacaoPinLida {
  readonly id: string;
  readonly hashPhc: string;
}

export interface NovoPin {
  /** usuario.id */
  readonly idUsuario: number;
  readonly login: string;
  /** O hash Argon2id em formato PHC (feito pelo servidor). O PIN em claro nunca chega aqui. */
  readonly hashPhc: string;
  readonly por: string;
  readonly motivo: string;
}

export interface ResultadoConferenciaPin {
  /** Certo e o PIN ainda livre: a troca pode seguir. */
  readonly aceito: boolean;
  /** Falhas seguidas depois desta conferência (null: o PIN já estava bloqueado ou encerrado). */
  readonly falhas: number | null;
  /** Esta falha atingiu o teto e bloqueou o PIN agora. */
  readonly bloqueouAgora: boolean;
}

export interface ConferenciaPin {
  readonly id: string;
  readonly login: string;
  readonly certo: boolean;
  /** Erros seguidos que bloqueiam (parâmetro acesso.trocaRapida.tentativasPin). */
  readonly teto?: number;
}

export interface PortaPin {
  /** banco: gravação no banco do cliente (porta-pin-propria.ts). */
  readonly destino: 'banco' | 'memoria' | 'indisponivel';
  situacao(rede: string, hospital: string, login: string): Promise<SituacaoPinLida>;
  /** O vivo COM o hash: só para a conferência no servidor. */
  vivo(rede: string, hospital: string, login: string): Promise<PinVivoLido | null>;
  definir(
    rede: string,
    hospital: string,
    p: NovoPin,
    t: TrilhaPin,
  ): Promise<{ id: string; anterior: 'nenhum' | 'definido' | 'bloqueado' }>;
  retirar(
    rede: string,
    hospital: string,
    p: { readonly login: string; readonly por: string; readonly motivo: string },
    t: TrilhaPin,
  ): Promise<{ id: string; anterior: 'definido' | 'bloqueado' }>;
  /** Revisão (achado 4): a contagem e o bloqueio são decididos pela gravação (atômica), não pela leitura anterior. */
  conferencia(
    rede: string,
    hospital: string,
    p: ConferenciaPin,
    t: TrilhaPin,
  ): Promise<ResultadoConferenciaPin>;
}

interface LinhaPin {
  id: string;
  hospital: string;
  login: string;
  hashPhc: string | null;
  situacao: 'vivo' | 'substituido' | 'retirado';
  falhas: number;
  criadoEm: Date;
  bloqueadoEm: Date | null;
  motivo: string | null;
}

/** Dev/ci: o PIN em memória do processo (nada vai a banco); `trilha` recebe as mesmas linhas, sem o hash. */
export function portaPinMemoria(
  trilha: (t: TrilhaPin & { diferenca: string }) => void = () => undefined,
  agora: () => number = () => Date.now(),
): PortaPin & { linhas(): readonly Readonly<LinhaPin>[] } {
  const linhas: LinhaPin[] = [];
  let seq = 0;
  const vivas = (h: string, login: string) =>
    linhas.filter((x) => x.hospital === h && x.login === login && x.situacao === 'vivo');
  const viva = (h: string, login: string) => vivas(h, login).at(-1);
  const situacao = (x: LinhaPin | undefined): SituacaoPinLida => ({
    definido: Boolean(x),
    bloqueado: Boolean(x?.bloqueadoEm),
    falhas: x?.falhas ?? 0,
    criadoEm: x?.criadoEm ?? null,
    bloqueadoEm: x?.bloqueadoEm ?? null,
  });
  return {
    destino: 'memoria',
    linhas: () => linhas,
    situacao: (_r, h, login) => Promise.resolve(situacao(viva(h, login))),
    vivo(_r, h, login) {
      const x = viva(h, login);
      return Promise.resolve(x?.hashPhc ? { ...situacao(x), id: x.id, hashPhc: x.hashPhc } : null);
    },
    definir(_r, h, p, t) {
      if (!/^\$argon2id\$/.test(p.hashPhc))
        return Promise.reject(recusa('pin-sem-cifra', 'O PIN só é guardado cifrado.'));
      const atual = viva(h, p.login);
      const anterior = !atual ? 'nenhum' : atual.bloqueadoEm ? 'bloqueado' : 'definido';
      for (const v of vivas(h, p.login))
        Object.assign(v, { situacao: 'substituido', hashPhc: null, motivo: p.motivo });
      const id = String(++seq);
      linhas.push({
        id,
        hospital: h,
        login: p.login,
        hashPhc: p.hashPhc,
        situacao: 'vivo',
        falhas: 0,
        criadoEm: new Date(agora()),
        bloqueadoEm: null,
        motivo: null,
      });
      trilha({ ...t, diferenca: `PIN: ${anterior} -> definido; motivo: ${p.motivo}` });
      return Promise.resolve({ id, anterior });
    },
    retirar(_r, h, p, t) {
      const atual = viva(h, p.login);
      if (!atual) return Promise.reject(recusa('sem-pin', 'Este usuário não tem PIN de troca rápida.'));
      const anterior = atual.bloqueadoEm ? 'bloqueado' : 'definido';
      for (const v of vivas(h, p.login))
        Object.assign(v, { situacao: 'retirado', hashPhc: null, motivo: p.motivo });
      trilha({ ...t, diferenca: `PIN: ${anterior} -> retirado; motivo: ${p.motivo}` });
      return Promise.resolve({ id: atual.id, anterior });
    },
    conferencia(_r, h, p, t) {
      // Como o UPDATE atômico da gravação (achado 4): soma sobre o valor ATUAL, só no PIN vivo ainda livre.
      const x = linhas.find(
        (l) => l.id === p.id && l.hospital === h && l.situacao === 'vivo' && !l.bloqueadoEm,
      );
      if (p.certo) {
        if (x) x.falhas = 0;
        return Promise.resolve({ aceito: Boolean(x), falhas: x ? 0 : null, bloqueouAgora: false });
      }
      if (!x || x.falhas >= 10) return Promise.resolve({ aceito: false, falhas: null, bloqueouAgora: false });
      const teto = Math.min(Math.max(Math.trunc(p.teto ?? 5), 1), 10);
      x.falhas += 1;
      const bloqueouAgora = x.falhas >= teto;
      if (bloqueouAgora) {
        x.bloqueadoEm = new Date(agora());
        trilha({ ...t, diferenca: `PIN: definido -> bloqueado; motivo: ${x.falhas} erros seguidos` });
      }
      return Promise.resolve({ aceito: false, falhas: x.falhas, bloqueouAgora });
    },
  };
}

/** Sem núcleo (e fora de dev/ci): toda operação do PIN fica indisponível. */
export function portaPinIndisponivel(): PortaPin {
  const recusar = () => Promise.reject(new Error('PIN indisponível: sem acesso ao banco.'));
  return {
    destino: 'indisponivel',
    situacao: recusar,
    vivo: recusar,
    definir: recusar,
    retirar: recusar,
    conferencia: recusar,
  };
}
