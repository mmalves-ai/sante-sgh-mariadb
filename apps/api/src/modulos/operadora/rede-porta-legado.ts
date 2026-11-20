// Porta da rede credenciada sobre o núcleo do legado (M56, etapa 4, F3): cada leitura numa transação curta READ ONLY
// no banco do estabelecimento; as gravações só do novo (SGH_OPE_PRESTADOR e SGH_OPE_PRESTADOR_MOV) numa transação
// SGH_ com a SGH_TRILHA junto (`somenteSgh` recusa qualquer escrita fora de SGH_). Em dev sobre a cópia compartilhada,
// as gravações são recusadas (`sghSoLeitura`).
import {
  alterarPrestadorSgh,
  credenciarPrestadorSgh,
  descredenciarPrestadorSgh,
  dominiosDaRede,
  gravarTrilha,
  type Leitor,
  listarConvenios,
  movimentosRps,
  type NucleoLegado,
  prestadoresDaRede,
  prestadorPorId,
  reincluirPrestadorSgh,
  relogioRecepcao,
  somenteSgh,
  totaisDaRede,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { portaIndisponivel } from '../exames/public-api.js';
import { type ContextoRede, METODOS_PORTA_REDE, type PortaRedeOperadora } from './rede-porta.js';

export function portaRedeOperadoraLegado(
  nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'>,
  opcoes: { readonly sghSoLeitura?: boolean } = {},
): PortaRedeOperadora {
  const ctx = (c: ContextoRede) => ({ rede: c.rede, hospital: c.hospital, traceId: 'operadora-rede' });
  const ler = <T>(c: ContextoRede, fn: (l: Leitor) => Promise<T>) => nucleo.lerSomente(ctx(c), fn);
  return {
    destino: 'legado',
    hoje: (c) => ler(c, async (l) => (await relogioRecepcao(l)).hoje),
    dominios: (c) => ler(c, (l) => dominiosDaRede(l)),
    convenios: (c) => ler(c, (l) => listarConvenios(l)),
    prestadores: (c, f) => ler(c, (l) => prestadoresDaRede(l, c.hospital, f)),
    prestador: (c, id) => ler(c, (l) => prestadorPorId(l, c.hospital, id)),
    totais: (c) => ler(c, (l) => totaisDaRede(l, c.hospital)),
    movimentos: (c, f) => ler(c, (l) => movimentosRps(l, c.hospital, f)),
    gravarSgh: (c, trilha, fn) => {
      if (opcoes.sghSoLeitura)
        return Promise.reject(
          new ErroProblema(
            'recurso-desligado',
            403,
            'Gravação desligada neste ambiente',
            'Neste ambiente de desenvolvimento o banco é só de leitura: a rede credenciada não é gravada.',
            { codigo: 'somente-leitura' },
          ),
        );
      return nucleo.gravarSgh(ctx(c), async (e0) => {
        const e = somenteSgh(e0);
        const h = c.hospital;
        const r = await fn({
          credenciar: (x) => credenciarPrestadorSgh(e, { hospital: h, ...x }),
          alterar: (x) => alterarPrestadorSgh(e, { hospital: h, ...x }),
          descredenciar: (x) => descredenciarPrestadorSgh(e, { hospital: h, ...x }),
          reincluir: (x) => reincluirPrestadorSgh(e, { hospital: h, ...x }),
        });
        await gravarTrilha(e, typeof trilha === 'function' ? trilha(r) : trilha);
        return r;
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaRedeOperadoraIndisponivel(): PortaRedeOperadora {
  return portaIndisponivel<PortaRedeOperadora>(METODOS_PORTA_REDE);
}
