// W1-01 (parte 11b2): a PORTA do PIN da troca rápida (SGH_ACESSO_PIN, migração 1209). Núcleo real: leitura READ ONLY e
// gravação na transação SGH_ com a trilha (legado/acesso/gravacao/pin-sgh.ts); dev/ci: memória com as mesmas regras
// (uma linha viva por usuário, encerrada sem o hash); sem núcleo: indisponível. Só o hash Argon2id (PHC, feito pelo
// servidor) passa por aqui; o PIN em claro nunca.
import {
  definirPin,
  lerPinVivo,
  lerSituacaoPin,
  type NovoPin,
  type NucleoLegado,
  type PinVivoLido,
  recusa,
  registrarConferenciaPin,
  type ResultadoConferenciaPin,
  retirarPin,
  type SituacaoPinLida,
  type TrilhaPin,
} from '@sgh/legado';

export interface ConferenciaPin {
  readonly id: string;
  readonly login: string;
  readonly certo: boolean;
  /** Erros seguidos que bloqueiam (parâmetro acesso.trocaRapida.tentativasPin). */
  readonly teto?: number;
}

export interface PortaPin {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
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

export function portaPinDoNucleo(nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>): PortaPin {
  const ctx = (rede: string, hospital: string, traceId = 'acesso-pin') => ({ rede, hospital, traceId });
  return {
    destino: 'legado',
    situacao: (rede, h, login) => nucleo.lerSomente(ctx(rede, h), (l) => lerSituacaoPin(l, login)),
    vivo: (rede, h, login) => nucleo.lerSomente(ctx(rede, h), (l) => lerPinVivo(l, login)),
    definir: (rede, h, p, t) => nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => definirPin(e, p, t)),
    retirar: (rede, h, p, t) => nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => retirarPin(e, p, t)),
    conferencia: (rede, h, p, t) =>
      nucleo.gravarSgh(ctx(rede, h, t.correlacao), (e) => registrarConferenciaPin(e, p, t)),
  };
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
