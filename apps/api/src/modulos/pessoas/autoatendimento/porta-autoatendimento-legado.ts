// Porta das solicitações do autoatendimento sobre o núcleo do legado (W0-06, parte 6b-2): leituras numa transação curta
// READ ONLY no banco do estabelecimento da sessão; gravações numa transação SGH_ (`somenteSgh`: nenhuma tabela do outro
// sistema) com a SGH_TRILHA junto, e o efeito da aprovação (férias, ajustes do ponto, correção do cadastro) no MESMO
// escritor (D-W006-SOLIC-EFEITO). Em dev sobre a cópia compartilhada, as gravações são recusadas com o motivo
// (`sghSoLeitura`): a prova da gravação é a integração, sob a trava da cópia e desfeita. Nenhuma operação do executor.
import {
  acessosAtestadoPesSgh,
  ajustesDaSolicitacaoPesSgh,
  atestadoPesSgh,
  decidirSolicitacaoPesSgh,
  desistirSolicitacaoPesSgh,
  type Escritor,
  gravarTrilha,
  incluirAtestadoPesSgh,
  incluirSolicitacaoPesSgh,
  type Leitor,
  ligarAjusteSolicitacaoPesSgh,
  listarSolicitacoesPesSgh,
  type NucleoLegado,
  relogioRecepcao,
  solicitacaoPesSgh,
  somenteSgh,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import { gravadorCalculoFolhaSgh } from '../folha/porta-calculo-legado.js';
import { gravadorPessoasSgh } from '../porta-legado.js';
import { gravadorPontoSgh } from '../ponto/porta-ponto-legado.js';
import {
  type ContextoAutoatendimento,
  type GravadorAutoatendimento,
  METODOS_PORTA_AUTOATENDIMENTO,
  type PortaAutoatendimento,
} from './porta-autoatendimento.js';

type Ler = <T>(c: ContextoAutoatendimento, fn: (l: Leitor) => Promise<T>) => Promise<T>;

function leituras(ler: Ler): Omit<PortaAutoatendimento, 'destino' | 'podeGravar' | 'executar' | 'gravarSgh'> {
  return {
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    solicitacoes: (c, f) => ler(c, (l) => listarSolicitacoesPesSgh(l, c.hospital, f)),
    solicitacao: (c, id) => ler(c, (l) => solicitacaoPesSgh(l, c.hospital, id)),
    ajustesDaSolicitacao: (c, id) => ler(c, (l) => ajustesDaSolicitacaoPesSgh(l, c.hospital, id)),
    acessosAtestado: (c, id) => ler(c, (l) => acessosAtestadoPesSgh(l, c.hospital, id)),
  };
}

/** `e` já é `somenteSgh`. */
function gravador(e: Escritor, c: ContextoAutoatendimento): GravadorAutoatendimento {
  const h = { hospital: c.hospital };
  return {
    solicitacao: (id) => solicitacaoPesSgh(e, c.hospital, id),
    incluirSolicitacao: (x) => incluirSolicitacaoPesSgh(e, { ...h, ...x }),
    incluirAtestado: (x) => incluirAtestadoPesSgh(e, { ...h, ...x }),
    decidirSolicitacao: (x) => decidirSolicitacaoPesSgh(e, { ...h, ...x }),
    desistirSolicitacao: (x) => desistirSolicitacaoPesSgh(e, { ...h, ...x }),
    ligarAjuste: (x) => ligarAjusteSolicitacaoPesSgh(e, { ...h, ...x }),
    ajustesDaSolicitacao: (id) => ajustesDaSolicitacaoPesSgh(e, c.hospital, id),
    atestado: (x) => atestadoPesSgh(e, { ...h, ...x }),
    ponto: gravadorPontoSgh(e, c),
    folha: gravadorCalculoFolhaSgh(e, c),
    pessoas: gravadorPessoasSgh(e, c),
  };
}

const recusaSoLeitura = () =>
  Promise.reject(
    new ErroProblema(
      'recurso-desligado',
      403,
      'Gravação desligada neste ambiente',
      'Neste ambiente de desenvolvimento o banco é só de leitura: as solicitações do autoatendimento não gravam.',
      { codigo: 'somente-leitura' },
    ),
  );

const semExecutor = () =>
  Promise.reject(
    new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'O autoatendimento não usa o executor.'),
  );

export function portaAutoatendimentoLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente'> & Partial<Pick<NucleoLegado, 'gravarSgh'>>,
  opcoes: { sghSoLeitura?: boolean } = {},
): PortaAutoatendimento {
  const ctx = (c: ContextoAutoatendimento) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'autoatendimento',
  });
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    gravarSgh: (c, trilha, fn) => {
      const gravar = nucleo.gravarSgh?.bind(nucleo);
      if (opcoes.sghSoLeitura || !gravar) return recusaSoLeitura();
      return gravar(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const r = await fn(gravador(e, c));
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
    ...leituras((c, fn) => nucleo.lerSomente(ctx(c), fn)),
  };
}

/** A mesma porta sobre UMA transação aberta (integração na cópia, sempre desfeita). */
export function portaAutoatendimentoNaTransacao(e: Escritor): PortaAutoatendimento {
  return {
    destino: 'legado',
    podeGravar: async () => ({ pode: true, codigo: null, motivo: null }),
    executar: semExecutor,
    async gravarSgh(c, trilha, fn) {
      const s = somenteSgh(e);
      const r = await fn(gravador(s, c));
      await gravarTrilha(s, typeof trilha === 'function' ? trilha(r) : trilha);
      return r;
    },
    ...leituras((_c, fn) => fn(e)),
  };
}

export function portaAutoatendimentoIndisponivel(): PortaAutoatendimento {
  return portaIndisponivel<PortaAutoatendimento>(METODOS_PORTA_AUTOATENDIMENTO);
}
