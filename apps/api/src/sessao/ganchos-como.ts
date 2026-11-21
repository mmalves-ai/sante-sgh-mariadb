// Ganchos tardios do "login como" (integração da onda 2 da F2.2, pedido do lote 02-14). A base monta o ServicoSessao
// ANTES dos módulos registrados, mas quem sabe guardar, reautenticar e encerrar uma sessão "como" é o módulo suporte.
// A base entrega à sessão estes ganchos, que delegam ao que o suporte ligar depois. Enquanto nada estiver ligado,
// nenhuma sessão "como" vale: a guarda responde falso, a reautenticação recusa e o encerramento não faz nada.
import type { GuardaComo, RegistroComo } from './servico-sessao.js';

export interface ImplementacaoComo {
  readonly guarda: GuardaComo;
  readonly reautenticar: (como: RegistroComo, senha: string) => Promise<boolean>;
  readonly aoEncerrar: (como: RegistroComo, motivo: string) => Promise<void>;
}

export class GanchosComoTardios {
  private impl: ImplementacaoComo | null = null;

  /** O módulo suporte liga a implementação ao montar (uma vez por aplicação; a última ligação vale). */
  ligar(impl: ImplementacaoComo): void {
    this.impl = impl;
  }

  get ligado(): boolean {
    return this.impl !== null;
  }

  /** As três funções no formato da configuração do ServicoSessao. */
  paraSessao(): {
    guardaComo: GuardaComo;
    reautenticarAtor: (como: RegistroComo, senha: string) => Promise<boolean>;
    aoEncerrarComo: (como: RegistroComo, motivo: string) => Promise<void>;
  } {
    return {
      guardaComo: (c, rede, estabelecimento) =>
        this.impl ? this.impl.guarda(c, rede, estabelecimento) : Promise.resolve(false),
      reautenticarAtor: (c, senha) => (this.impl ? this.impl.reautenticar(c, senha) : Promise.resolve(false)),
      aoEncerrarComo: (c, motivo) => (this.impl ? this.impl.aoEncerrar(c, motivo) : Promise.resolve()),
    };
  }
}
