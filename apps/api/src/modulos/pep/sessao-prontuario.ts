// Estado curto do prontuário por sessão (ficha do M15, regras 11, 12 e 13), em memória do processo e sem dado
// clínico nem nome: o motivo de acesso da primeira abertura de cada paciente na sessão (lista fechada), a marca
// de que a abertura do prontuário dele já foi à trilha do legado (a Consulta do RES sai uma vez por paciente na
// sessão, como o Delphi grava ao selecionar o paciente) e as aberturas recentes de cada usuário (só o ID do paciente e o instante) para os alertas ao Auditor. A sessão é
// identificada pela rede, o estabelecimento, o login e o fim da sessão (12 h no máximo). Com mais de uma
// instância da API, o motivo é pedido de novo na outra (fica a pendência de levar ao armazém compartilhado).
import type { MotivoAcessoProntuario } from '@sgh/contratos';
import type { AberturaRecente } from '@sgh/dominio-pep';

export const PRAZO_MOTIVO_MS = 12 * 3_600_000;
export const TETO_SESSOES = 20_000;
export const TETO_ABERTURAS = 500;

export interface ChaveSessao {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly fimDaSessao: string | null;
}

const chave = (s: ChaveSessao) => [s.rede, s.hospital, s.login, s.fimDaSessao ?? ''].join('\u0001');

export class EstadoProntuario {
  private readonly motivos = new Map<
    string,
    {
      readonly em: number;
      readonly porPaciente: Map<number, MotivoAcessoProntuario>;
      readonly abertos: Set<number>;
    }
  >();
  private readonly aberturas = new Map<string, AberturaRecente[]>();
  constructor(private readonly agora: () => number = Date.now) {}

  motivo(s: ChaveSessao, paciente: number): MotivoAcessoProntuario | null {
    const m = this.motivos.get(chave(s));
    if (!m || this.agora() - m.em > PRAZO_MOTIVO_MS) return null;
    return m.porPaciente.get(paciente) ?? null;
  }

  registrarMotivo(s: ChaveSessao, paciente: number, motivo: MotivoAcessoProntuario): void {
    const k = chave(s);
    let m = this.motivos.get(k);
    if (!m || this.agora() - m.em > PRAZO_MOTIVO_MS) {
      m = { em: this.agora(), porPaciente: new Map(), abertos: new Set() };
      this.motivos.set(k, m);
    }
    m.porPaciente.set(paciente, motivo);
    if (this.motivos.size > TETO_SESSOES) {
      const primeira = this.motivos.keys().next().value;
      if (primeira !== undefined) this.motivos.delete(primeira);
    }
  }

  /**
   * Primeira leitura do paciente nesta sessão (depois do motivo)? Marca e responde true só na primeira vez; a
   * marca dura o mesmo que o motivo. `desfazer` tira a marca (a trilha da abertura falhou: a próxima tenta de novo).
   */
  primeiraLeitura(s: ChaveSessao, paciente: number): { primeira: boolean; desfazer: () => void } {
    const m = this.motivos.get(chave(s));
    if (!m || this.agora() - m.em > PRAZO_MOTIVO_MS || m.abertos.has(paciente))
      return { primeira: false, desfazer: () => undefined };
    m.abertos.add(paciente);
    return { primeira: true, desfazer: () => void m.abertos.delete(paciente) };
  }

  /** Aberturas recentes do usuário (antes da nova) e registra a nova. */
  abrir(
    hospital: string,
    login: string,
    paciente: number,
  ): { recentes: AberturaRecente[]; nova: AberturaRecente } {
    const k = `${hospital}\u0001${login}`;
    const recentes = this.aberturas.get(k) ?? [];
    const nova = { paciente, em: this.agora() };
    const lista = [...recentes, nova].slice(-TETO_ABERTURAS);
    this.aberturas.set(k, lista);
    if (this.aberturas.size > TETO_SESSOES) {
      const primeira = this.aberturas.keys().next().value;
      if (primeira !== undefined) this.aberturas.delete(primeira);
    }
    return { recentes, nova };
  }
}
