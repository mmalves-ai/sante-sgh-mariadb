// Porta PRÓPRIA da notificação compulsória (M48, etapa 4) sobre o MariaDB do cliente, pelo @sgh/nucleo.
// Lê o relógio do estabelecimento; o caso de agravo (notificacao_agravo, notificacao_agravo_resposta), o cadastro de
// agravos notificáveis (agravo_notificavel, agravo_notificavel_cid, agravo_pergunta) e os gatilhos por CID, exame e
// óbito aguardam o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as
// gravações recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
import { type NucleoQualidade, lerNoEstabelecimento, leituraPendente, liberacaoPendente, modeloPendente, relogioDoEstabelecimento } from './apoio-propria.js';
import type { ContextoAgravo, PortaAgravo } from './porta-agravo.js';

const RECURSO = 'A notificação compulsória (casos, gatilhos de exame e ficha)';

export class PortaAgravoPropria implements PortaAgravo {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoQualidade) {}

  readonly podeGravar: PortaAgravo['podeGravar'] = () => Promise.resolve(liberacaoPendente(RECURSO));

  readonly executar: PortaAgravo['executar'] = (_c, op) => Promise.reject(modeloPendente(`${RECURSO} (operação ${op})`));

  readonly gravarSgh: PortaAgravo['gravarSgh'] = () => Promise.reject(modeloPendente(RECURSO));

  relogio(c: ContextoAgravo) {
    return lerNoEstabelecimento(this.nucleo, c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

  cidsNotificaveis(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  cidDoCadastro(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  atendimentosComCid(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  obitos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  resultados(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  atendimento(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  declaracaoObito(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  exame(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  pacientes(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  unidades(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  modelosFicha(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  perguntasFicha(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  caso(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  casos(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  casosDesde(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  contagem(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }

  gatilhosExame(..._a: unknown[]): Promise<never> {
    void _a;
    return Promise.reject(leituraPendente(RECURSO));
  }
}
