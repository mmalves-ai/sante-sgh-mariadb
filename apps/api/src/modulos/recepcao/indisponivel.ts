// Portas indisponíveis da recepção e da classificação: fora de dev/ci sem o núcleo, toda chamada responde 503 (nada
// lido nem gravado; falha fechada). O passo 0 da gravação responde "não pode" com o motivo.
import { ErroProblema } from '../../problema.filter.js';
import { METODOS_PORTA_CLASSIFICACAO, type PortaClassificacao } from './classificacao-porta.js';
import type { PortaRecepcao } from './porta.js';

const METODOS_DA_PORTA: ReadonlySet<string> = new Set([
  'executar',
  'gravar',
  'marcarUsoDispositivo',
  'relogio',
  'recepcoes',
  'guichesEmUso',
  'senhasDoDia',
  'senha',
  'aFrente',
  'agendados',
  'pacientesDasSenhas',
  'sigilosos',
  'fotos',
  'paineisTv',
  'usuariosTecnicos',
  'indicadores',
  'dispositivos',
  'modelosTermo',
  'termosDoPaciente',
  'signatariosTermo',
  'dispositivoDoToken',
]);

function indisponivel<P extends object>(metodos: ReadonlySet<string>): P {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy(
    {},
    {
      get: (_t, chave) => {
        if (chave === 'destino') return 'indisponivel';
        if (chave === 'podeGravar')
          return async () => ({
            pode: false,
            codigo: 'indisponivel',
            motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
          });
        return typeof chave === 'string' && metodos.has(chave) ? recusa : undefined;
      },
    },
  ) as P;
}

export function portaRecepcaoIndisponivel(): PortaRecepcao {
  return indisponivel<PortaRecepcao>(METODOS_DA_PORTA);
}

export function portaClassificacaoIndisponivel(): PortaClassificacao {
  return indisponivel<PortaClassificacao>(METODOS_PORTA_CLASSIFICACAO);
}

/** Porta de outro módulo ainda não montado (ex.: o atendimento): toda chamada responde 503, sem gancho do Nest. */
export function portaDeModuloAusente<P extends object>(): P {
  const recusar = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Funcionalidade indisponível',
        'O módulo de que esta tela depende não está ligado nesta instalação: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({} as P, {
    get: (_t, chave) => {
      if (chave === 'destino') return 'indisponivel';
      if (typeof chave !== 'string' || chave === 'then' || chave.startsWith('on')) return undefined;
      return recusar;
    },
  });
}
